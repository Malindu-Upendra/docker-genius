"""
run_ablation.py — DOCKER-GENIUS Ablation Study

Isolates the contribution of each DOCKER-GENIUS component by running four
configurations, all under the identical load used by run_experiment.py:

  A — No Semantic + No LSTM   : rule engine reacts to current CPU/mem alone;
                                 no TIER_1 awareness at all (a "dumb"
                                 infrastructure-only reactive baseline —
                                 NOT the same as Group 1/Static in
                                 run_experiment.py, which has no rule engine
                                 running at all)
  B — Semantic Only, No LSTM  : current CPU/mem + TIER_1 awareness, no
                                 forecast (this is exactly Group 2 —
                                 Reactive-Only — from run_experiment.py)
  C — LSTM Only, No Semantic  : forecast-driven, but Rule 1/3/4 ignore
                                 TIER_1 activity/breaches entirely
  D — Full System             : forecast + semantic awareness (exactly
                                 Group 3 — Proactive Hybrid)

Configs B and D reuse the exact same mode strings as run_experiment.py's
Groups 2/3, just with semantic_aware explicit — this is intentional: it
lets the ablation numbers be cross-checked against the main 3-group
experiment's own results for consistency.

Outputs (written to experiment/ablation_results/):
  configA_kpi.csv, configB_kpi.csv, configC_kpi.csv, configD_kpi.csv
  configA_governor.csv, ... (governor decision logs)
  ablation_summary.txt

Usage:
    python3 experiment/run_ablation.py [--duration 300] [--cooldown 90] [--repeats 1]
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from docker_api.updater import DockerUpdater
from experiment.run_experiment import (
    run_group, reset_container, snapshot_transactional_data,
    load_kpi_csv, compute_summary, GroupFailedError, merge_rep_kpis,
)

RESULTS_DIR = Path(__file__).parent / "ablation_results"

CONFIGS = [
    {"num": "A", "label": "No Semantic + No LSTM", "mode": "reactive", "semantic_aware": False},
    {"num": "B", "label": "Semantic Only (no LSTM)", "mode": "reactive", "semantic_aware": True},
    {"num": "C", "label": "LSTM Only (no semantic)", "mode": "proactive", "semantic_aware": False},
    {"num": "D", "label": "Full System", "mode": "proactive", "semantic_aware": True},
]


def merge_rep_kpis_ablation(num: str, repeats: int) -> Path:
    """Same pooling logic as run_experiment.merge_rep_kpis, but for the
    ablation's string-keyed configs and results directory."""
    import csv
    merged_path = RESULTS_DIR / f"config{num}_kpi.csv"
    with open(merged_path, "w", newline="") as out:
        writer = None
        for rep in range(1, repeats + 1):
            rep_path = RESULTS_DIR / "reps" / f"rep{rep}" / f"config{num}_kpi.csv"
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


def main():
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS ablation study")
    ap.add_argument("--duration", type=int, default=300)
    ap.add_argument("--cooldown", type=int, default=90)
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--configs", type=str, default="A,B,C,D",
                     help="Comma-separated configs to run, e.g. --configs C,D")
    args = ap.parse_args()

    configs_to_run = args.configs.split(",")
    updater = DockerUpdater(container="erp_app")
    rep_summaries: dict[str, list[dict]] = {c["num"]: [] for c in CONFIGS}

    print(f"\n{'━'*65}")
    print("  DOCKER-GENIUS Ablation Study")
    print(f"  Configs : {configs_to_run}")
    print(f"  Duration: {args.duration}s  Cooldown: {args.cooldown}s  Repeats: {args.repeats}")
    print(f"{'━'*65}")

    snapshot_transactional_data()

    any_run = False
    for rep in range(1, args.repeats + 1):
        rep_label = f"  [rep {rep}/{args.repeats}]" if args.repeats > 1 else ""
        rep_dir = RESULTS_DIR / "reps" / f"rep{rep}"

        for cfg in CONFIGS:
            if cfg["num"] not in configs_to_run:
                continue
            if any_run:
                print(f"\n[harness] Cooldown {args.cooldown}s — letting metrics settle…")
                import time; time.sleep(args.cooldown)

            group = {"num": cfg["num"], "label": cfg["label"], "mode": cfg["mode"]}
            kpi_path = rep_dir / f"config{cfg['num']}_kpi.csv"
            gov_path = rep_dir / f"config{cfg['num']}_governor.csv"
            try:
                summary = run_group(group, args.duration, updater, kpi_path, gov_path,
                                     rep_label, semantic_aware=cfg["semantic_aware"])
            except GroupFailedError as e:
                print(f"\n[harness] ✗ ABORTING — {e}")
                reset_container(updater)
                sys.exit(1)
            rep_summaries[cfg["num"]].append(summary)
            any_run = True

    if not any_run:
        return

    summaries = []
    for cfg in CONFIGS:
        if cfg["num"] not in configs_to_run:
            continue
        merged_path = merge_rep_kpis_ablation(cfg["num"], args.repeats)
        rows = load_kpi_csv(merged_path)
        summaries.append(compute_summary(rows, f"{cfg['num']} — {cfg['label']}"))

    reset_container(updater)

    print(f"\n\n{'━'*65}")
    print("  ABLATION STUDY COMPLETE — FINAL SUMMARY")
    print(f"{'━'*65}")
    header = f"{'Config':<32} {'T1 n':>6} {'P50':>7} {'P95':>7} {'P99':>7} {'Breaches':>9} {'Breach%':>8}"
    print(header)
    print("─" * 78)
    for s in summaries:
        print(f"  {s['group']:<30} {s['t1_count']:>6} "
              f"{s['t1_p50_ms']:>6.0f}ms {s['t1_p95_ms']:>6.0f}ms {s['t1_p99_ms']:>6.0f}ms "
              f"{s['t1_sla_breaches']:>9} {s['t1_breach_pct']:>7.1f}%")

    summary_path = RESULTS_DIR / "ablation_summary.txt"
    with open(summary_path, "w") as f:
        f.write(f"DOCKER-GENIUS Ablation Study — {datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"Duration: {args.duration}s  Repeats: {args.repeats}\n\n")
        f.write(header + "\n" + "─"*78 + "\n")
        for s in summaries:
            f.write(f"  {s['group']:<30} {s['t1_count']:>6} "
                    f"{s['t1_p50_ms']:>6.0f}ms {s['t1_p95_ms']:>6.0f}ms {s['t1_p99_ms']:>6.0f}ms "
                    f"{s['t1_sla_breaches']:>9} {s['t1_breach_pct']:>7.1f}%\n")
    print(f"\n[harness] Summary saved → {summary_path}")


if __name__ == "__main__":
    main()
