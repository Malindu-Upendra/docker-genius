"""
run_confirmatory_v3.py — DOCKER-GENIUS Confirmatory Experiment (corrected)

Supersedes run_confirmatory.py (results archived under
confirmatory_results_v2_unnormalized_cpu/) to address a pre-submission Q1
review (DOCKER-GENIUS_Q1_Review.docx) that found the original confirmatory
design could not have produced anything other than a null result, for
reasons independent of presentation:

  B2 — Rule 1/Rule 3's CPU_HIGH/CPU_LOW thresholds were compared against
       the raw Docker-stats CPU% (100% = one full core), not normalised to
       the CURRENT core allocation the way memory's thresholds already
       are. Fixed in rule_engine.py (eval_cpu_norm = eval_cpu /
       current_cpus). This run uses the corrected rule engine.
  B4 — With 8 continuous Tier-1 workers, "TIER_1 active in the last 60s"
       was true for the entire run by construction, so the semantic gate
       could never contribute a measurable effect. mixed_load.py now
       supports a Tier-1 duty cycle (--tier1-active-s/--tier1-idle-s) so
       the gate can take both values within a run; gate state is logged
       every governor cycle (governor_loop.py) so the actual fraction of
       gated cycles is reported, not assumed.
  B5/B6 — The load generator was closed-loop (fixed worker pool, each
       waiting for its own response before sending the next request),
       which causes coordinated omission: tail latency and throughput
       become coupled by construction. mixed_load.py now generates Tier-1
       arrivals as an open-loop Poisson process at a fixed rate, with
       latency measured from the intended scheduled send time.
  B8 — Condition order within each replicate is now explicitly randomised
       (seeded, reproducible) and logged to run_order.json, instead of
       always running in the same fixed order.
  B11 — Per-request HTTP status (0 = connection error/timeout) is already
       in the KPI CSV; this script's summary reports non-2xx counts.
  A5/B1 — Adds a sixth condition, "isolation": the full system with
       Tier-3 CPU work routed to a worker thread (cpu-burn-pool.ts)
       instead of blocking the main event loop — the mechanism the
       original paper only validated with a single n=1 demo run
       (demo_results_isolated/). Running it through this same
       15-replicate, seed-paired protocol gives it the same statistical
       standing as the other conditions, and is a condition where
       additional CPU allocation can plausibly matter (worker threads can
       use more cores in parallel), unlike the other five.

Six conditions, all at the same locked rule-engine configuration:

  static_equal — Static allocation at an EQUAL-RESOURCE budget (matched to
                 the proactive hybrid's own observed average provisioning
                 cost in the prior run; kept as a fixed named constant).
  A_base       — Reactive, semantic-aware DISABLED  ("no semantic, no LSTM")
  B_semantic   — Reactive, semantic-aware ENABLED   ("semantic only")
  C_lstm       — Proactive, semantic-aware DISABLED ("LSTM only")
  D_full       — Proactive, semantic-aware ENABLED  ("full system")
  E_isolation  — Same as D_full, plus Tier-3 routed to a worker thread

A_base/B_semantic/C_lstm/D_full form the 2x2 (forecast x semantic) design
review item B12 asked for; static_equal and E_isolation sit outside that
factorial as the lower and (hoped-for) upper reference points.

Workload pairing: each replicate index uses one shared seed across all six
conditions (mixed_load.py --seed), so replicate N faces "the same" workload
mix in every condition — only the ORDER conditions run in is randomised
per replicate (review item B8), not the seed-to-replicate mapping.

Analysis is NOT done here — this script only produces the raw per-rep KPI
CSVs under experiment/confirmatory_results/reps/repN/<config>_kpi.csv (plus
a final pooled file per config) and the governor decision log per rep/config
(which now also carries the B4/D5 diagnostic columns).

Usage:
    python3 experiment/run_confirmatory_v3.py --repeats 15
    python3 experiment/run_confirmatory_v3.py --repeats 15 --include-unseen
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from docker_api.updater import DockerUpdater
from experiment.run_experiment import (
    run_group, reset_container, snapshot_transactional_data,
    load_kpi_csv, compute_summary, GroupFailedError,
    BASELINE_CPUS, BASELINE_MEM_GB,
)

RESULTS_DIR = Path(__file__).parent / "confirmatory_results"

# Equal-resource budget — kept as the same named constant the original
# confirmatory run used (Table X — G3: 3.73 cores average provisioning),
# so this remains comparable to it rather than silently re-measured.
EQUAL_RESOURCE_CPUS = 3.73

CONFIGS = [
    {"num": "static_equal", "label": "Static (Equal-Resource)",
     "mode": "static", "semantic_aware": True, "isolate_tier3": False,
     "static_cpus": EQUAL_RESOURCE_CPUS, "static_mem_gb": BASELINE_MEM_GB},
    {"num": "A_base", "label": "Reactive — No Semantic, No LSTM",
     "mode": "reactive", "semantic_aware": False, "isolate_tier3": False,
     "static_cpus": None, "static_mem_gb": None},
    {"num": "B_semantic", "label": "Reactive — Semantic Only",
     "mode": "reactive", "semantic_aware": True, "isolate_tier3": False,
     "static_cpus": None, "static_mem_gb": None},
    {"num": "C_lstm", "label": "Proactive — LSTM Only (No Semantic)",
     "mode": "proactive", "semantic_aware": False, "isolate_tier3": False,
     "static_cpus": None, "static_mem_gb": None},
    {"num": "D_full", "label": "Proactive — Full System (Semantic + LSTM)",
     "mode": "proactive", "semantic_aware": True, "isolate_tier3": False,
     "static_cpus": None, "static_mem_gb": None},
    {"num": "E_isolation", "label": "Full System + Request-Class Isolation",
     "mode": "proactive", "semantic_aware": True, "isolate_tier3": True,
     "static_cpus": None, "static_mem_gb": None},
]
CONFIG_BY_NUM = {c["num"]: c for c in CONFIGS}


def merge_rep_kpis_confirmatory(num: str, rep_labels: list[str]) -> Path:
    """Pool the named replicates' (e.g. rep1..repN, or 'unseen') KPI files
    into one file per config, same convention as the other two harnesses."""
    merged_path = RESULTS_DIR / f"{num}_kpi.csv"
    with open(merged_path, "w", newline="") as out:
        writer = None
        for rep_label in rep_labels:
            rep_path = RESULTS_DIR / "reps" / rep_label / f"{num}_kpi.csv"
            if not rep_path.exists():
                continue
            with open(rep_path) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if writer is None:
                        writer = csv.DictWriter(out, fieldnames=reader.fieldnames)
                        writer.writeheader()
                    writer.writerow(row)
    return merged_path


def run_pass(configs_to_run: list[str], rep_labels: list[str], seeds: list[int],
             duration: int, cooldown: int, updater: DockerUpdater,
             rep_summaries: dict[str, dict[str, dict]],
             tier1_active_s: float, tier1_idle_s: float,
             order_log: list[dict]) -> bool:
    """Runs one full sweep of configs_to_run for each (rep_label, seed) pair.
    Condition order within each replicate is shuffled with a seed derived
    from that replicate's own seed (review item B8), not run in a fixed
    order every time; the realised order is recorded in order_log."""
    any_run = False
    for rep_label, seed in zip(rep_labels, seeds):
        rep_dir = RESULTS_DIR / "reps" / rep_label
        order_rng = random.Random(f"order-{seed}")
        this_rep_configs = [c for c in configs_to_run]
        order_rng.shuffle(this_rep_configs)
        order_log.append({
            "rep": rep_label, "seed": seed, "order": this_rep_configs,
            "ts": datetime.now(timezone.utc).isoformat(),
        })

        for num in this_rep_configs:
            cfg = CONFIG_BY_NUM[num]
            if any_run:
                print(f"\n[harness] Cooldown {cooldown}s — letting metrics settle…")
                time.sleep(cooldown)

            group = {"num": cfg["num"], "label": cfg["label"], "mode": cfg["mode"]}
            kpi_path = rep_dir / f"{cfg['num']}_kpi.csv"
            gov_path = rep_dir / f"{cfg['num']}_governor.csv"
            if kpi_path.exists() and not os.environ.get("DG_FORCE_OVERWRITE"):
                print(f"\n[harness] SKIP — {kpi_path} already exists from a "
                      f"prior run. Set DG_FORCE_OVERWRITE=1 to overwrite "
                      f"deliberately, or archive/rename the existing "
                      f"confirmatory_results/ directory before re-running.")
                any_run = any_run or True
                continue
            print(f"\n[harness] === {rep_label} — config {cfg['num']} — seed {seed} ===")
            try:
                summary = run_group(
                    group, duration, updater, kpi_path, gov_path,
                    rep_label=f"  [{rep_label}]",
                    semantic_aware=cfg["semantic_aware"], seed=seed,
                    static_cpus=cfg["static_cpus"], static_mem_gb=cfg["static_mem_gb"],
                    isolate_tier3=cfg["isolate_tier3"],
                    tier1_idle_s=tier1_idle_s,
                    tier1_active_s=tier1_active_s,
                )
            except GroupFailedError as e:
                print(f"\n[harness] ✗ ABORTING — {e}")
                reset_container(updater)
                sys.exit(1)
            rep_summaries.setdefault(cfg["num"], {})[rep_label] = summary
            any_run = True
    return any_run


def main():
    global RESULTS_DIR
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS confirmatory experiment (corrected, v3)")
    ap.add_argument("--output-dir", type=str, default=None)
    ap.add_argument("--duration", type=int, default=300)
    ap.add_argument("--cooldown", type=int, default=90)
    ap.add_argument("--repeats", type=int, default=15,
                     help="Independent replicates per condition (paper design: 15)")
    ap.add_argument("--configs", type=str,
                     default="static_equal,A_base,B_semantic,C_lstm,D_full,E_isolation",
                     help="Comma-separated configs to run")
    ap.add_argument("--base-seed", type=int, default=2000,
                     help="Replicate i uses seed base-seed+i, identical across "
                          "all configs in that replicate (paired workloads). "
                          "Distinct from the original run's 1000-range seeds "
                          "so this corrected run's workload draws don't "
                          "silently reuse the pre-correction seed range.")
    ap.add_argument("--tier1-active-s", type=float, default=200.0,
                     help="Seconds of Tier-1 traffic per duty cycle (review B4)")
    ap.add_argument("--tier1-idle-s", type=float, default=100.0,
                     help="Seconds of NO Tier-1 traffic per duty cycle, so the "
                          "semantic gate can go false within a run (review B4)")
    ap.add_argument("--include-unseen", action="store_true")
    ap.add_argument("--unseen-seed", type=int, default=98999)
    args = ap.parse_args()

    if args.output_dir:
        RESULTS_DIR = Path(args.output_dir)
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    configs_to_run = args.configs.split(",")
    updater = DockerUpdater(container="erp_app")
    rep_summaries: dict[str, dict[str, dict]] = {}
    order_log: list[dict] = []

    print(f"\n{'━'*70}")
    print("  DOCKER-GENIUS Confirmatory Experiment v3 (corrected CPU metric,")
    print("  open-loop load, gated Tier-1 duty cycle, randomised run order,")
    print("  + request-class isolation arm)")
    print(f"  Configs : {configs_to_run}")
    print(f"  Duration: {args.duration}s  Cooldown: {args.cooldown}s  "
          f"Repeats: {args.repeats}")
    print(f"  Tier-1 duty cycle: {args.tier1_active_s}s on / {args.tier1_idle_s}s off")
    print(f"  Equal-resource static budget: {EQUAL_RESOURCE_CPUS} cores")
    print(f"{'━'*70}")

    snapshot_transactional_data()

    rep_labels = [f"rep{i}" for i in range(1, args.repeats + 1)]
    seeds = [args.base_seed + i for i in range(1, args.repeats + 1)]
    any_run = run_pass(configs_to_run, rep_labels, seeds,
                        args.duration, args.cooldown, updater, rep_summaries,
                        args.tier1_active_s, args.tier1_idle_s, order_log)

    if args.include_unseen:
        print(f"\n[harness] Locked-configuration held-out pass — "
              f"unseen seed {args.unseen_seed}")
        unseen_ran = run_pass(configs_to_run, ["unseen"], [args.unseen_seed],
                               args.duration, args.cooldown, updater, rep_summaries,
                               args.tier1_active_s, args.tier1_idle_s, order_log)
        any_run = any_run or unseen_ran

    with open(RESULTS_DIR / "run_order.json", "w") as f:
        json.dump(order_log, f, indent=2)

    if not any_run:
        return

    all_labels = list(rep_labels)
    if args.include_unseen:
        all_labels.append("unseen")

    summaries = []
    for cfg in CONFIGS:
        if cfg["num"] not in configs_to_run:
            continue
        merged_path = merge_rep_kpis_confirmatory(cfg["num"], rep_labels)
        rows = load_kpi_csv(merged_path)
        summaries.append(compute_summary(rows, f"{cfg['num']} — {cfg['label']}"))

    reset_container(updater)

    print(f"\n\n{'━'*70}")
    print("  CONFIRMATORY EXPERIMENT v3 COMPLETE (pooled across locked replicates)")
    print(f"{'━'*70}")
    header = f"{'Config':<42} {'T1 n':>6} {'P50':>7} {'P95':>7} {'P99':>7} {'Breaches':>9} {'Breach%':>8}"
    print(header)
    print("─" * 90)
    for s in summaries:
        print(f"  {s['group']:<40} {s['t1_count']:>6} "
              f"{s['t1_p50_ms']:>6.0f}ms {s['t1_p95_ms']:>6.0f}ms {s['t1_p99_ms']:>6.0f}ms "
              f"{s['t1_sla_breaches']:>9} {s['t1_breach_pct']:>7.1f}%")

    summary_path = RESULTS_DIR / "confirmatory_summary.txt"
    with open(summary_path, "w") as f:
        f.write(f"DOCKER-GENIUS Confirmatory Experiment v3 (corrected) — "
                f"{datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"Duration: {args.duration}s  Repeats: {args.repeats}  "
                f"Base seed: {args.base_seed}  Include unseen: {args.include_unseen}\n")
        f.write(f"Tier-1 duty cycle: {args.tier1_active_s}s on / {args.tier1_idle_s}s off\n\n")
        f.write(header + "\n" + "─"*90 + "\n")
        for s in summaries:
            f.write(f"  {s['group']:<40} {s['t1_count']:>6} "
                    f"{s['t1_p50_ms']:>6.0f}ms {s['t1_p95_ms']:>6.0f}ms {s['t1_p99_ms']:>6.0f}ms "
                    f"{s['t1_sla_breaches']:>9} {s['t1_breach_pct']:>7.1f}%\n")
        f.write("\nPer-replicate breach rates (raw input for run-level analysis):\n")
        for cfg in CONFIGS:
            if cfg["num"] not in configs_to_run:
                continue
            f.write(f"\n{cfg['num']} — {cfg['label']}\n")
            for rep_label in all_labels:
                s = rep_summaries.get(cfg["num"], {}).get(rep_label)
                if s:
                    f.write(f"  {rep_label:<8} breach%={s['t1_breach_pct']:>6.1f}  "
                            f"n={s['t1_count']}\n")

    print(f"\n[harness] Summary written to {summary_path}")
    print(f"[harness] Run order log written to {RESULTS_DIR / 'run_order.json'}")


if __name__ == "__main__":
    main()
