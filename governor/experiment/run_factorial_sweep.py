"""
run_factorial_sweep.py — DOCKER-GENIUS Rule-Engine Parameter Sensitivity Sweep
(independent one-at-a-time design, replicated)

Addresses supervisor review items #12 ("sensitivity sweep relies on single
runs") and #13 ("CPU step, memory step, and cooldown are changed
simultaneously"). The earlier sensitivity analysis (Section sec:sensitivity
of the paper) varied all three rule-engine parameters together, in a single
run, when moving from the conservative defaults (0.5 cores / 512MB / 6
cycles) to the aggressive configuration (1.5 cores / 1024MB / 2 cycles), so
it cannot say which of the three actually drove the observed change.

This script instead holds two parameters fixed at a centre point (1.0
cores / 768MB / 4 cycles) and varies the third across the reviewer's own
example range, one parameter at a time, replicated -- not a full 3x3x3
factorial (27 cells), but the standard "one-factor-at-a-time" design the
review's own example specifies:
    CPU step      in {0.5, 1.0, 1.5} cores   (mem=768MB, cooldown=4)
    Memory step   in {512, 768, 1024} MB     (cpu=1.0,   cooldown=4)
    Cooldown      in {2, 4, 6} cycles        (cpu=1.0,   mem=768MB)
The centre point (1.0, 768, 4) is shared across all three sweeps and run
only once. 7 distinct configurations in total.

Each configuration is run via run_experiment.py as a SEPARATE subprocess
(rule_engine.py's CPU_STEP/MEM_STEP_MB/COOLDOWN_CYCLES are module-level
globals read once at import time -- they cannot be changed mid-process,
hence one subprocess per configuration, matching the pattern already used
for the two-tenant scalability test). --groups 2,3 only (Static never
touches the rule engine). Each configuration's raw per-rep data is written
to its own output directory under factorial_sweep_results/, so no run
here can silently overwrite another's data the way the original
default-parameter run's data was lost (see NEXT_STEPS.md's data-retention
note).

Usage:
    python3 experiment/run_factorial_sweep.py [--repeats 5] [--duration 300] [--cooldown 90]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

RESULTS_DIR = Path(__file__).parent / "factorial_sweep_results"
RUN_EXPERIMENT = Path(__file__).parent / "run_experiment.py"

# (label, cpu_step, mem_step_mb, cooldown_cycles)
CONFIGS = [
    ("centre",        1.0, 768,  4),
    ("cpu_step_0.5",  0.5, 768,  4),
    ("cpu_step_1.5",  1.5, 768,  4),
    ("mem_step_512",  1.0, 512,  4),
    ("mem_step_1024", 1.0, 1024, 4),
    ("cooldown_2",    1.0, 768,  2),
    ("cooldown_6",    1.0, 768,  6),
]


def main():
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS one-at-a-time rule-engine parameter sweep")
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--duration", type=int, default=300)
    ap.add_argument("--cooldown", type=int, default=90)
    ap.add_argument("--configs", type=str, default=None,
                     help="Comma-separated subset of config labels to run "
                          "(default: all 7)")
    args = ap.parse_args()

    to_run = [c for c in CONFIGS if not args.configs or c[0] in args.configs.split(",")]
    print(f"[sweep] Running {len(to_run)} configuration(s), "
          f"{args.repeats} replicates each, --groups 2,3 only:")
    for label, cpu, mem, cd in to_run:
        print(f"  {label:16s} cpu_step={cpu}  mem_step_mb={mem}  cooldown={cd}")

    for label, cpu, mem, cd in to_run:
        out_dir = RESULTS_DIR / label
        if (out_dir / "experiment_summary.txt").exists() and not os.environ.get("DG_FORCE_OVERWRITE"):
            print(f"\n[sweep] SKIP {label} — {out_dir}/experiment_summary.txt already exists. "
                  f"Set DG_FORCE_OVERWRITE=1 to overwrite deliberately.")
            continue

        env = os.environ.copy()
        env["DG_CPU_STEP"] = str(cpu)
        env["DG_MEM_STEP_MB"] = str(mem)
        env["DG_COOLDOWN_CYCLES"] = str(cd)

        print(f"\n{'='*70}\n[sweep] === {label} (cpu={cpu} mem={mem} cooldown={cd}) ===\n{'='*70}")
        result = subprocess.run(
            [sys.executable, str(RUN_EXPERIMENT),
             "--groups", "2,3",
             "--repeats", str(args.repeats),
             "--duration", str(args.duration),
             "--cooldown", str(args.cooldown),
             "--output-dir", str(out_dir)],
            env=env,
        )
        if result.returncode != 0:
            print(f"[sweep] ✗ {label} FAILED (exit code {result.returncode}) — aborting sweep.")
            sys.exit(1)

    print(f"\n[sweep] All configurations complete. Results under {RESULTS_DIR}/<label>/")


if __name__ == "__main__":
    main()
