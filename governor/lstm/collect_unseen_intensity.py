"""
collect_unseen_intensity.py — DOCKER-GENIUS Cross-Intensity Telemetry Collector

Addresses supervisor review item #10 ("Training and evaluation use the same
load intensity ... Test generalisation on workload profiles that were not
represented during training"). The LSTM was trained and evaluated entirely
on telemetry collected at ONE load intensity (N_TIER1=8, N_TIER3=2,
interval=4s -- see load-tests/mixed_load.py's defaults, which is what
training_data.csv was collected under). This script collects fresh
telemetry at two intensities the model has never seen -- a lighter and a
heavier profile -- with the container held at a fixed baseline allocation
(no governor running) so the recorded CPU/RAM pattern reflects the workload
itself, not a governor's reaction to it, matching how the original
training data was collected.

Usage:
    python3 lstm/collect_unseen_intensity.py --profile light --duration 300
    python3 lstm/collect_unseen_intensity.py --profile heavy --duration 300

Outputs:
    lstm/unseen_intensity_light.csv
    lstm/unseen_intensity_heavy.csv
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

# Trained-on / evaluated intensity: N_TIER1=8, N_TIER3=2, interval=4 (mixed_load.py defaults)
PROFILES = {
    "light": {"n_tier1": 4, "n_tier3": 1, "tier3_interval": 4},
    "heavy": {"n_tier1": 12, "n_tier3": 3, "tier3_interval": 4},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", choices=list(PROFILES), required=True)
    ap.add_argument("--duration", type=int, default=300)
    args = ap.parse_args()

    cfg = PROFILES[args.profile]
    out_path = Path(__file__).parent / f"unseen_intensity_{args.profile}.csv"
    out_path.unlink(missing_ok=True)

    print(f"[collect] Profile: {args.profile} -> {cfg}")
    updater = DockerUpdater(container="erp_app")
    reset_container(updater)  # fixed baseline, no governor -- same as training-data collection
    clear_request_logs()
    snapshot_transactional_data()
    reset_transactional_data()
    print("[collect] Waiting for app health...")
    wait_for_healthy()

    load_cmd = [
        sys.executable, str(LOAD_SCRIPT),
        "--duration", str(args.duration),
        "--n-tier1", str(cfg["n_tier1"]),
        "--n-tier3", str(cfg["n_tier3"]),
        "--tier3-interval", str(cfg["tier3_interval"]),
        "--output", "/dev/null" if sys.platform != "win32" else "NUL",
    ]
    collect_cmd = [
        sys.executable, str(Path(__file__).parent / "collect_training_data.py"),
        "--duration", str(args.duration + 5),
        "--output", str(out_path),
    ]

    print(f"[collect] Starting load generator ({args.duration}s)...")
    load_proc = subprocess.Popen(load_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)  # let load generator log in / warm up before sampling starts
    print(f"[collect] Starting telemetry collector...")
    collect_proc = subprocess.Popen(collect_cmd)

    collect_proc.wait()
    load_proc.wait(timeout=180)

    reset_container(updater)
    print(f"[collect] Done -> {out_path}")


if __name__ == "__main__":
    main()
