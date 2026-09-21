"""
collect_extended_training_data.py — DOCKER-GENIUS Extended LSTM Telemetry Collection

Addresses the "single, relatively short (1,196-sample) observation window"
limitation disclosed in the paper's Threats to Validity section (the LSTM
was trained and evaluated on ~20 minutes of telemetry). Collects a much
longer capture at the SAME trained-on load intensity (N_TIER1=8, N_TIER3=2,
tier3_interval=4 -- mixed_load.py's own defaults, matching training_data.csv)
so the model can be retrained and evaluated on substantially more data
without changing anything else about the setup.

Writes to a SEPARATE file (extended_training_data.csv) rather than
overwriting training_data.csv, so the existing 1,196-sample dataset used
throughout the already-completed experiments remains intact and untouched.

Same collection methodology as collect_unseen_intensity.py: container reset
to a fixed baseline allocation, no governor running, so the recorded
CPU/RAM pattern reflects the workload itself.

Usage:
    python3 lstm/collect_extended_training_data.py --duration 21600   # 6 hours
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from docker_api.updater import DockerUpdater
from experiment.run_experiment import (
    reset_container, clear_request_logs, snapshot_transactional_data,
    reset_transactional_data, wait_for_healthy,
)

LOAD_SCRIPT = Path(__file__).parent.parent.parent / "load-tests" / "mixed_load.py"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=int, default=21600, help="seconds (default 6h)")
    ap.add_argument("--output", default=str(Path(__file__).parent / "extended_training_data.csv"))
    args = ap.parse_args()

    out_path = Path(args.output)
    out_path.unlink(missing_ok=True)

    print(f"[collect-extended] duration={args.duration}s ({args.duration/3600:.1f}h) -> {out_path}")
    updater = DockerUpdater(container="erp_app")
    reset_container(updater)  # fixed baseline, no governor -- matches original training_data.csv collection
    clear_request_logs()
    snapshot_transactional_data()
    reset_transactional_data()
    print("[collect-extended] Waiting for app health...")
    wait_for_healthy()

    load_cmd = [
        sys.executable, str(LOAD_SCRIPT),
        "--duration", str(args.duration),
        "--output", "/dev/null",
    ]
    collect_cmd = [
        sys.executable, str(Path(__file__).parent / "collect_training_data.py"),
        "--duration", str(args.duration + 10),
        "--output", str(out_path),
    ]

    print(f"[collect-extended] Starting load generator (defaults: N_TIER1=8, N_TIER3=2, interval=4)...")
    load_proc = subprocess.Popen(load_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    print("[collect-extended] Starting telemetry collector...")
    collect_proc = subprocess.Popen(collect_cmd)

    collect_proc.wait()
    load_proc.wait(timeout=180)

    reset_container(updater)
    print(f"[collect-extended] Done -> {out_path}")


if __name__ == "__main__":
    main()
