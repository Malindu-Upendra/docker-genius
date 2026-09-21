"""
run_experiment.py — DOCKER-GENIUS 3-Group Experiment Controller

Runs the three experiment groups back-to-back under identical load:

  Group 1 — Static Allocation   : no governor, fixed resources (control)
  Group 2 — Reactive-Only       : rule engine on current CPU/RAM, no LSTM
  Group 3 — Proactive Hybrid    : full DOCKER-GENIUS (LSTM + rule engine)

Between groups:
  - Container resources are reset to the baseline (BASELINE_CPUS / BASELINE_MEM_GB)
  - semantic_request_logs is truncated for a clean slate
  - A COOLDOWN_S second pause lets metrics stabilise

Outputs (written to experiment/results/):
  group1_kpi.csv, group2_kpi.csv, group3_kpi.csv   — per-request KPIs
  group1_governor.csv, group2_governor.csv, ...     — governor decision logs
  experiment_summary.txt                            — human-readable summary

Usage:
    python3 experiment/run_experiment.py [--duration 300] [--cooldown 60]

Prerequisite for Group 3:
    Run lstm/collect_training_data.py + lstm/train.py first so that
    lstm/model.keras and lstm/scaler.pkl exist.
"""

from __future__ import annotations

import argparse
import csv
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import mysql.connector
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from docker_api.updater          import DockerUpdater
from experiment.governor_loop    import GovernorLoop

# ── Experiment parameters ─────────────────────────────────────────────────────
BASELINE_CPUS   = 2.0
BASELINE_MEM_GB = 2.0
APP_BASE_URL    = "http://localhost:3000"

LOAD_SCRIPT = str(
    Path(__file__).parent.parent.parent / "load-tests" / "mixed_load.py"
)
RESULTS_DIR = Path(__file__).parent / "results"


class GroupFailedError(RuntimeError):
    """Raised when a group's load generator did not complete successfully —
    surfacing this loudly beats silently reporting whatever stale KPI CSV
    happens to already be sitting on disk from a previous run."""

DB_CONFIG = {
    "host"    : "localhost",
    "port"    : 3307,
    "user"    : "root",
    "password": "rootpassword",
    "database": "demo_nexcore",
}

GROUPS = [
    {"num": 1, "label": "Static Allocation",  "mode": "static"},
    {"num": 2, "label": "Reactive-Only",       "mode": "reactive"},
    {"num": 3, "label": "Proactive Hybrid",    "mode": "proactive"},
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _db_conn():
    return mysql.connector.connect(**DB_CONFIG)

def wait_for_healthy(timeout: int = 180, poll_interval: float = 3.0) -> None:
    """
    Poll a REAL DB-backed operation (login) until it actually succeeds,
    rather than a fixed sleep or a plain HTTP ping. /api/docs used to be
    the check here, but it doesn't touch the connection pool at all (the
    semantic-logger insert is fire-and-forget, non-blocking) — so it
    reported "healthy" while the pool was still fully saturated by a prior
    group's straggling Tier-3 queries, and the load generator's login()
    would then fail or hang. Login is the exact operation that matters.
    """
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            r = requests.post(f"{APP_BASE_URL}/api/auth/login",
                              json={"email": "admin@colomboretail.lk",
                                    "password": "test123"},
                              timeout=8)
            if r.status_code < 300:
                return
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last_err = e
        time.sleep(poll_interval)
    raise GroupFailedError(
        f"App did not become healthy (login) within {timeout}s before group start: {last_err}")


def reset_container(updater: DockerUpdater, cpus: float = BASELINE_CPUS,
                     mem_gb: float = BASELINE_MEM_GB):
    """Reset erp_app to the given resource allocation (default: baseline)."""
    print(f"[harness] Resetting container → {cpus} cpus  {mem_gb}GB")
    updater.apply(cpus, mem_gb)

def clear_request_logs():
    """Truncate semantic_request_logs for a clean measurement window."""
    conn = _db_conn()
    cur  = conn.cursor()
    cur.execute("TRUNCATE TABLE semantic_request_logs")
    conn.commit()
    cur.close(); conn.close()
    print("[harness] semantic_request_logs cleared")


def snapshot_transactional_data():
    """
    Snapshot product_stocks once, before any groups run. reset_transactional_data()
    restores from this snapshot before every group so each of the N groups/reps
    starts from byte-identical stock levels — without this, checkouts
    permanently deplete qty_on_hand and later reps/groups see a different
    (increasingly depleted) starting state than earlier ones, which was one of
    two causes of the 5x-replication run converging to meaningless pooled
    results (see NEXT_STEPS.md §1c / §2 bug #9).
    """
    conn = _db_conn()
    cur  = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS product_stocks_baseline")
    cur.execute("CREATE TABLE product_stocks_baseline AS SELECT * FROM product_stocks")
    conn.commit()
    cur.close(); conn.close()
    print("[harness] product_stocks snapshot taken → product_stocks_baseline")


def reset_transactional_data():
    """
    Restore identical starting conditions before every group: wipe the
    invoices generated by the previous group/rep and restore stock levels
    from the pre-experiment snapshot. Without this, report-query cost
    (financial_aggregate, monthly_sales, etc. — all scan the full invoices
    table) grows monotonically across every group and rep instead of each
    one facing the same workload, and depleted stock can silently make
    later checkouts no-op (the UPDATE's `qty_on_hand >= ?` guard just
    matches 0 rows rather than erroring).
    """
    conn = _db_conn()
    cur  = conn.cursor()
    cur.execute("SET FOREIGN_KEY_CHECKS=0")
    cur.execute("TRUNCATE TABLE invoice_items")
    cur.execute("TRUNCATE TABLE invoices")
    cur.execute("SET FOREIGN_KEY_CHECKS=1")
    cur.execute("""
        UPDATE product_stocks ps
        JOIN product_stocks_baseline b ON b.id = ps.id
        SET ps.qty_on_hand = b.qty_on_hand,
            ps.qty_reserved = b.qty_reserved,
            ps.qty_on_order = b.qty_on_order
    """)
    conn.commit()
    cur.close(); conn.close()
    print("[harness] Transactional data reset — invoices cleared, stock restored")

def save_governor_log(decisions: list[dict], path: Path):
    if not decisions:
        return
    fieldnames = list(decisions[0].keys())
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(decisions)
    print(f"[harness] Governor log → {path}  ({len(decisions)} decisions)")

def load_kpi_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path) as f:
        return list(csv.DictReader(f))

def compute_summary(rows: list[dict], label: str) -> dict:
    t1 = [float(r["latency_ms"]) for r in rows if r["tier"] == "TIER_1"]
    t3 = [float(r["latency_ms"]) for r in rows if r["tier"] == "TIER_3"]
    breaches = sum(int(r["sla_breach"]) for r in rows if r["tier"] == "TIER_1")

    def pct(data, p):
        if not data: return 0.0
        s = sorted(data)
        idx = max(0, int(len(s) * p / 100) - 1)
        return round(s[idx], 1)

    duration_s = 1.0
    if rows:
        from datetime import datetime
        t_start = datetime.fromisoformat(rows[0]["ts"].replace("Z", "+00:00"))
        t_end   = datetime.fromisoformat(rows[-1]["ts"].replace("Z", "+00:00"))
        duration_s = max(1.0, (t_end - t_start).total_seconds())

    return {
        "group"           : label,
        "t1_count"        : len(t1),
        "t1_p50_ms"       : pct(t1, 50),
        "t1_p95_ms"       : pct(t1, 95),
        "t1_p99_ms"       : pct(t1, 99),
        "t1_sla_breaches" : breaches,
        "t1_breach_pct"   : round(breaches / len(t1) * 100, 2) if t1 else 0.0,
        "t1_rps"          : round(len(t1) / duration_s, 2),
        "t3_count"        : len(t3),
        "t3_p50_ms"       : pct(t3, 50),
    }


# ── Group runner ──────────────────────────────────────────────────────────────

def run_group(group: dict, duration: int, updater: DockerUpdater,
              kpi_path: Path, gov_path: Path, rep_label: str = "",
              semantic_aware: bool = True, seed: int | None = None,
              static_cpus: float | None = None, static_mem_gb: float | None = None):
    num   = group["num"]
    label = group["label"]
    mode  = group["mode"]

    print(f"\n{'═'*65}")
    print(f"  GROUP {num} — {label}{rep_label}  ({duration}s)")
    print(f"{'═'*65}")

    kpi_path.parent.mkdir(parents=True, exist_ok=True)
    gov_path.parent.mkdir(parents=True, exist_ok=True)

    # Delete any pre-existing KPI file for this group BEFORE running. If the
    # load generator later fails without writing a fresh one, compute_summary()
    # must see an empty/missing file and report zero — not silently re-read
    # stale data left over from a previous run and pass it off as this one's
    # result (this happened: a crashed Group 3 once reported an old July run's
    # numbers as if they were fresh).
    kpi_path.unlink(missing_ok=True)
    gov_path.unlink(missing_ok=True)

    # 1. Reset resources + clear logs + restore identical starting data
    reset_container(updater,
                     cpus=static_cpus if static_cpus is not None else BASELINE_CPUS,
                     mem_gb=static_mem_gb if static_mem_gb is not None else BASELINE_MEM_GB)
    clear_request_logs()
    reset_transactional_data()

    # Wait for the app to actually be responsive, not a fixed sleep — a prior
    # group's heavy Tier-3 queries (100+ seconds each, measured) can still be
    # draining server/DB capacity well past a short fixed pause.
    print("[harness] Waiting for app to be healthy before starting…")
    wait_for_healthy()

    # 2. Start governor (groups 2 + 3 only)
    governor = GovernorLoop(mode=mode, semantic_aware=semantic_aware)
    governor.start()

    # 3. Launch load test as subprocess
    print(f"[harness] Starting load test ({duration}s)…")
    load_cmd = [sys.executable, LOAD_SCRIPT,
                "--duration", str(duration),
                "--output",   str(kpi_path)]
    if seed is not None:
        load_cmd += ["--seed", str(seed)]
    load_proc = subprocess.Popen(
        load_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # 4. Stream load test output while governor runs
    try:
        start = time.perf_counter()
        while load_proc.poll() is None:
            line = load_proc.stdout.readline()
            if line:
                print(f"  [load] {line.rstrip()}")
            if time.perf_counter() - start > duration + 220:
                # mixed_load.py now deliberately joins its Tier-3 threads
                # (up to 180s each) before exiting, so it can legitimately
                # run well past `duration` — this guard is a true-hang
                # backstop, not the normal exit path.
                print("[harness] Timeout — killing load process")
                load_proc.terminate()
                break
    except KeyboardInterrupt:
        print("\n[harness] Interrupted — stopping group")
        load_proc.terminate()

    load_proc.wait()

    # 5. Stop governor
    governor.stop()

    # 6. Save governor decision log
    save_governor_log(governor.decisions(), gov_path)

    # 7. Fail loudly instead of silently reporting a bad/empty result
    if load_proc.returncode != 0:
        raise GroupFailedError(
            f"Group {num} ({label}) load generator exited with code "
            f"{load_proc.returncode} — see [load] output above for the cause.")
    if not kpi_path.exists() or kpi_path.stat().st_size == 0:
        raise GroupFailedError(
            f"Group {num} ({label}) produced no KPI data at {kpi_path}.")

    # 7. Load and summarise KPIs
    rows = load_kpi_csv(kpi_path)
    summary = compute_summary(rows, label)

    print(f"\n[harness] Group {num} summary:")
    print(f"          TIER-1  n={summary['t1_count']}  "
          f"P50={summary['t1_p50_ms']}ms  "
          f"P95={summary['t1_p95_ms']}ms  "
          f"P99={summary['t1_p99_ms']}ms")
    print(f"          SLA breaches: {summary['t1_sla_breaches']} "
          f"({summary['t1_breach_pct']}%)")

    return summary


# ── Main ──────────────────────────────────────────────────────────────────────

def merge_rep_kpis(num: int, repeats: int) -> Path:
    """Concatenate group{num}_kpi.csv from every replicate into the final
    pooled file at RESULTS_DIR/group{num}_kpi.csv (header written once) —
    this is the file mann_whitney.py reads, so no downstream changes are
    needed to analyse pooled multi-replicate data the same way as a single run."""
    merged_path = RESULTS_DIR / f"group{num}_kpi.csv"
    fieldnames = None
    with open(merged_path, "w", newline="") as out:
        writer = None
        for rep in range(1, repeats + 1):
            rep_path = RESULTS_DIR / "reps" / f"rep{rep}" / f"group{num}_kpi.csv"
            if not rep_path.exists():
                continue
            with open(rep_path) as f:
                reader = csv.DictReader(f)
                if writer is None:
                    fieldnames = reader.fieldnames
                    writer = csv.DictWriter(out, fieldnames=fieldnames)
                    writer.writeheader()
                for row in reader:
                    writer.writerow(row)
    return merged_path


def main():
    global RESULTS_DIR
    ap = argparse.ArgumentParser(
        description="DOCKER-GENIUS 3-group experiment controller"
    )
    ap.add_argument("--duration", type=int, default=300,
                    help="Duration per group in seconds (default: 300)")
    ap.add_argument("--cooldown", type=int, default=90,
                    help="Cooldown between groups in seconds (default: 90 — "
                         "Tier-3 bulk-generate calls measured at 100+ seconds "
                         "each can straggle past a shorter cooldown)")
    ap.add_argument("--groups",   type=str, default="1,2,3",
                    help="Comma-separated groups to run, e.g. --groups 1,3")
    ap.add_argument("--repeats",  type=int, default=1,
                    help="Replicates per group (proposal calls for 5). Each "
                         "rep's raw KPI CSV is kept under results/reps/repN/; "
                         "results/group*_kpi.csv is the pooled file across "
                         "all reps, which is what mann_whitney.py reads.")
    ap.add_argument("--output-dir", type=str, default=None,
                    help="Override the default experiment/results/ output "
                         "directory -- use a distinct path per sweep/config "
                         "so separate invocations never silently overwrite "
                         "each other's raw per-rep data (see NEXT_STEPS.md's "
                         "§1k data-retention gap for why this now exists).")
    args = ap.parse_args()

    if args.output_dir:
        RESULTS_DIR = Path(args.output_dir)
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    groups_to_run = [int(g) for g in args.groups.split(",")]
    updater       = DockerUpdater(container="erp_app")
    # rep_summaries[num] = list of per-rep summary dicts, for the
    # rep-by-rep variance report (run_experiment_reps.txt)
    rep_summaries: dict[int, list[dict]] = {g["num"]: [] for g in GROUPS}

    # Snapshot stock levels once, up front — every group/rep restores from
    # this same baseline (see reset_transactional_data()) so replicates are
    # actually identical trials, not a progressively depleted/bloated DB.
    snapshot_transactional_data()

    print(f"\n{'━'*65}")
    print(f"  DOCKER-GENIUS Experiment")
    print(f"  Groups  : {groups_to_run}")
    print(f"  Duration: {args.duration}s per group")
    print(f"  Cooldown: {args.cooldown}s between groups")
    print(f"  Repeats : {args.repeats}")
    print(f"{'━'*65}")

    any_group_run = False
    for rep in range(1, args.repeats + 1):
        rep_label = f"  [rep {rep}/{args.repeats}]" if args.repeats > 1 else ""
        rep_dir = RESULTS_DIR / "reps" / f"rep{rep}"

        for i, group in enumerate(GROUPS):
            if group["num"] not in groups_to_run:
                continue

            if any_group_run:   # cooldown between every group AND between reps
                print(f"\n[harness] Cooldown {args.cooldown}s — letting metrics settle…")
                time.sleep(args.cooldown)

            kpi_path = rep_dir / f"group{group['num']}_kpi.csv"
            gov_path = rep_dir / f"group{group['num']}_governor.csv"
            try:
                summary = run_group(group, args.duration, updater,
                                     kpi_path, gov_path, rep_label)
            except GroupFailedError as e:
                print(f"\n[harness] ✗ ABORTING — {e}")
                print("[harness] Resetting container to baseline before exit.")
                reset_container(updater)
                sys.exit(1)
            rep_summaries[group["num"]].append(summary)
            any_group_run = True

    # ── Pool replicates into the final per-group KPI files ───────────────────
    if not any_group_run:
        return

    summaries = []
    for group in GROUPS:
        if group["num"] not in groups_to_run:
            continue
        merged_path = merge_rep_kpis(group["num"], args.repeats)
        rows = load_kpi_csv(merged_path)
        summaries.append(compute_summary(rows, group["label"]))

    reset_container(updater)

    print(f"\n\n{'━'*65}")
    print("  EXPERIMENT COMPLETE — FINAL SUMMARY")
    print(f"{'━'*65}")
    header = f"{'Group':<26} {'T1 n':>6} {'P50':>7} {'P95':>7} {'P99':>7} {'Breaches':>9} {'Breach%':>8}"
    print(header)
    print("─" * 65)
    for s in summaries:
        print(f"  {s['group']:<24} {s['t1_count']:>6} "
              f"{s['t1_p50_ms']:>6.0f}ms "
              f"{s['t1_p95_ms']:>6.0f}ms "
              f"{s['t1_p99_ms']:>6.0f}ms "
              f"{s['t1_sla_breaches']:>9} "
              f"{s['t1_breach_pct']:>7.1f}%")
    print(f"{'━'*65}")

    # Save summary text
    summary_path = RESULTS_DIR / "experiment_summary.txt"
    with open(summary_path, "w") as f:
        f.write(f"DOCKER-GENIUS Experiment — {datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"Duration per group: {args.duration}s\n\n")
        f.write(header + "\n" + "─"*65 + "\n")
        for s in summaries:
            f.write(f"  {s['group']:<24} {s['t1_count']:>6} "
                    f"{s['t1_p50_ms']:>6.0f}ms "
                    f"{s['t1_p95_ms']:>6.0f}ms "
                    f"{s['t1_p99_ms']:>6.0f}ms "
                    f"{s['t1_sla_breaches']:>9} "
                    f"{s['t1_breach_pct']:>7.1f}%\n")
    print(f"\n[harness] Summary saved → {summary_path}")
    print(f"[harness] KPI CSVs      → {RESULTS_DIR}/group*_kpi.csv "
          f"(pooled across {args.repeats} rep(s))")
    print("[harness] Run analysis/mann_whitney.py next.")

    # ── Per-replicate variance report ─────────────────────────────────────────
    # The pooled file above is what mann_whitney.py analyses, but seeing each
    # rep's breach rate individually is what actually tells you whether an
    # effect is real or just this run — a single low-n run can look
    # significant purely from a couple of outlier requests (observed
    # first-hand: one run's Static P99 was 5003ms from a handful of stragglers).
    if args.repeats > 1:
        reps_path = RESULTS_DIR / "experiment_reps_summary.txt"
        with open(reps_path, "w") as f:
            f.write(f"DOCKER-GENIUS Per-Replicate Breakdown — "
                    f"{datetime.now(timezone.utc).isoformat()}\n")
            f.write(f"{args.repeats} replicate(s), {args.duration}s each\n\n")
            for group in GROUPS:
                if group["num"] not in groups_to_run:
                    continue
                f.write(f"{group['label']}\n")
                f.write(f"  {'Rep':<6} {'T1 n':>6} {'P50':>7} {'P95':>7} "
                        f"{'P99':>7} {'Breaches':>9} {'Breach%':>8}\n")
                for i, s in enumerate(rep_summaries[group["num"]], start=1):
                    f.write(f"  {i:<6} {s['t1_count']:>6} "
                            f"{s['t1_p50_ms']:>6.0f}ms {s['t1_p95_ms']:>6.0f}ms "
                            f"{s['t1_p99_ms']:>6.0f}ms {s['t1_sla_breaches']:>9} "
                            f"{s['t1_breach_pct']:>7.1f}%\n")
                breach_pcts = [s['t1_breach_pct'] for s in rep_summaries[group["num"]]]
                if breach_pcts:
                    mean_b = sum(breach_pcts) / len(breach_pcts)
                    spread = max(breach_pcts) - min(breach_pcts)
                    f.write(f"  → mean breach% across reps: {mean_b:.1f}%  "
                            f"(range {min(breach_pcts):.1f}%–{max(breach_pcts):.1f}%, "
                            f"spread {spread:.1f} points)\n\n")
        print(f"[harness] Per-replicate breakdown → {reps_path}")


if __name__ == "__main__":
    main()
