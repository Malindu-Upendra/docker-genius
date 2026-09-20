"""
run_confirmatory.py — DOCKER-GENIUS Confirmatory Experiment

Implements the locked, pre-specified design described in the paper's
"Towards a Confirmatory Experiment" section (Section~\\ref{sec:confirmatory}):
a separate, higher-replicate comparison run only after the exploratory
tuning (run_experiment.py, run_ablation.py) already picked the aggressive
rule-engine configuration — this script does not re-tune anything.

Four conditions, all at that same locked rule-engine configuration:

  static_equal — Static allocation at an EQUAL-RESOURCE budget (matched to
                 the proactive hybrid's own observed average provisioning
                 cost, see Table X / secondary-metrics), not the original
                 conservative 2.0-core baseline. This controls for the
                 hybrid simply being given more average CPU.
  reactive     — Reactive-only, semantic-aware (same as Group 2 / ablation B)
  lstm_only    — Proactive, semantic classification disabled (ablation C)
  proactive    — Full system: proactive + semantic-aware (Group 3 / ablation D)

Workload pairing: each replicate index uses one shared seed across all four
conditions (mixed_load.py --seed), so replicate N faces "the same" workload
mix in every condition. A separate --unseen-seed, outside the seed range
used during exploratory tuning and normal replicates, is reserved for a
held-out check run only with --include-unseen, after the configuration and
replicate count are locked.

Analysis is NOT done here — this script only produces the raw per-rep KPI
CSVs under experiment/confirmatory_results/reps/repN/<config>_kpi.csv (plus
a final pooled file per config). Run the run-level permutation test /
bootstrap analysis described in Section~\\ref{sec:unit-of-analysis} on the
per-rep breach rates it produces.

Usage:
    python3 experiment/run_confirmatory.py --repeats 15
    python3 experiment/run_confirmatory.py --repeats 15 --include-unseen
"""

from __future__ import annotations

import argparse
import csv
import os
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

# Equal-resource budget: matched to the proactive hybrid's own observed
# average provisioning cost (Table X — G3: 3.73 cores). Kept as a named
# constant here (rather than recomputed) since it must stay fixed for the
# whole confirmatory run, independent of whatever the exploratory data
# happens to show if re-measured.
EQUAL_RESOURCE_CPUS = 3.73

CONFIGS = [
    {"num": "static_equal", "label": "Static (Equal-Resource)",
     "mode": "static", "semantic_aware": True,
     "static_cpus": EQUAL_RESOURCE_CPUS, "static_mem_gb": BASELINE_MEM_GB},
    {"num": "reactive", "label": "Reactive-Only (Semantic)",
     "mode": "reactive", "semantic_aware": True,
     "static_cpus": None, "static_mem_gb": None},
    {"num": "lstm_only", "label": "LSTM Only (No Semantic)",
     "mode": "proactive", "semantic_aware": False,
     "static_cpus": None, "static_mem_gb": None},
    {"num": "proactive", "label": "Full System (Proactive Hybrid)",
     "mode": "proactive", "semantic_aware": True,
     "static_cpus": None, "static_mem_gb": None},
]


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
             rep_summaries: dict[str, dict[str, dict]]) -> bool:
    """Runs one full sweep of configs_to_run for each (rep_label, seed) pair.
    Returns True if at least one group actually ran."""
    any_run = False
    for rep_label, seed in zip(rep_labels, seeds):
        rep_dir = RESULTS_DIR / "reps" / rep_label
        for cfg in CONFIGS:
            if cfg["num"] not in configs_to_run:
                continue
            if any_run:
                print(f"\n[harness] Cooldown {cooldown}s — letting metrics settle…")
                time.sleep(cooldown)

            group = {"num": cfg["num"], "label": cfg["label"], "mode": cfg["mode"]}
            kpi_path = rep_dir / f"{cfg['num']}_kpi.csv"
            gov_path = rep_dir / f"{cfg['num']}_governor.csv"
            if kpi_path.exists() and not os.environ.get("DG_FORCE_OVERWRITE"):
                print(f"\n[harness] SKIP — {kpi_path} already exists from a "
                      f"prior run. A superseded default-parameter comparison "
                      f"earlier in this project lost its raw per-replicate "
                      f"data this way; set DG_FORCE_OVERWRITE=1 to overwrite "
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
                )
            except GroupFailedError as e:
                print(f"\n[harness] ✗ ABORTING — {e}")
                reset_container(updater)
                sys.exit(1)
            rep_summaries.setdefault(cfg["num"], {})[rep_label] = summary
            any_run = True
    return any_run


def main():
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS confirmatory experiment")
    ap.add_argument("--duration", type=int, default=300)
    ap.add_argument("--cooldown", type=int, default=90)
    ap.add_argument("--repeats", type=int, default=15,
                     help="Independent replicates per condition (paper design: 15-20)")
    ap.add_argument("--configs", type=str,
                     default="static_equal,reactive,lstm_only,proactive",
                     help="Comma-separated configs to run")
    ap.add_argument("--base-seed", type=int, default=1000,
                     help="Replicate i uses seed base-seed+i, identical across "
                          "all configs in that replicate (paired workloads)")
    ap.add_argument("--include-unseen", action="store_true",
                     help="Also run one held-out pass at --unseen-seed, reserved "
                          "outside the base-seed range used above — only meaningful "
                          "once the configuration is locked")
    ap.add_argument("--unseen-seed", type=int, default=99999)
    args = ap.parse_args()

    configs_to_run = args.configs.split(",")
    updater = DockerUpdater(container="erp_app")
    rep_summaries: dict[str, dict[str, dict]] = {}

    print(f"\n{'━'*70}")
    print("  DOCKER-GENIUS Confirmatory Experiment (locked configuration)")
    print(f"  Configs : {configs_to_run}")
    print(f"  Duration: {args.duration}s  Cooldown: {args.cooldown}s  "
          f"Repeats: {args.repeats}")
    print(f"  Equal-resource static budget: {EQUAL_RESOURCE_CPUS} cores")
    print(f"{'━'*70}")

    snapshot_transactional_data()

    rep_labels = [f"rep{i}" for i in range(1, args.repeats + 1)]
    seeds = [args.base_seed + i for i in range(1, args.repeats + 1)]
    any_run = run_pass(configs_to_run, rep_labels, seeds,
                        args.duration, args.cooldown, updater, rep_summaries)

    if args.include_unseen:
        print(f"\n[harness] Locked-configuration held-out pass — "
              f"unseen seed {args.unseen_seed}")
        unseen_ran = run_pass(configs_to_run, ["unseen"], [args.unseen_seed],
                               args.duration, args.cooldown, updater, rep_summaries)
        any_run = any_run or unseen_ran

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
    print("  CONFIRMATORY EXPERIMENT COMPLETE (pooled across locked replicates)")
    print(f"{'━'*70}")
    header = f"{'Config':<34} {'T1 n':>6} {'P50':>7} {'P95':>7} {'P99':>7} {'Breaches':>9} {'Breach%':>8}"
    print(header)
    print("─" * 80)
    for s in summaries:
        print(f"  {s['group']:<32} {s['t1_count']:>6} "
              f"{s['t1_p50_ms']:>6.0f}ms {s['t1_p95_ms']:>6.0f}ms {s['t1_p99_ms']:>6.0f}ms "
              f"{s['t1_sla_breaches']:>9} {s['t1_breach_pct']:>7.1f}%")

    summary_path = RESULTS_DIR / "confirmatory_summary.txt"
    with open(summary_path, "w") as f:
        f.write(f"DOCKER-GENIUS Confirmatory Experiment — "
                f"{datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"Duration: {args.duration}s  Repeats: {args.repeats}  "
                f"Base seed: {args.base_seed}  Include unseen: {args.include_unseen}\n\n")
        f.write(header + "\n" + "─"*80 + "\n")
        for s in summaries:
            f.write(f"  {s['group']:<32} {s['t1_count']:>6} "
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

    print(f"\n[harness] Summary saved → {summary_path}")
    print("[harness] Run run-level permutation test + bootstrap "
          "(Section sec:unit-of-analysis) on the per-rep breach rates above.")


if __name__ == "__main__":
    main()
