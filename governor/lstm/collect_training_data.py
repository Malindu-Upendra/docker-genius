"""
collect_training_data.py — DOCKER-GENIUS LSTM Telemetry Collector

Polls Docker stats every SAMPLE_INTERVAL seconds and writes CPU/RAM readings
to a CSV file used to train the LSTM forecasting model.

Run this WHILE the load test is running to capture realistic load patterns:

    Terminal 1:  python3 ../load-tests/mixed_load.py --duration 600
    Terminal 2:  python3 lstm/collect_training_data.py --duration 600

Usage:
    python3 lstm/collect_training_data.py [--duration 600] [--output lstm/training_data.csv]
"""

import argparse
import csv
import http.client
import json
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────
SAMPLE_INTERVAL = 1.0          # seconds between samples (1s on Mac; 0.1s on Linux)
CONTAINER_NAME  = "erp_app"
SOCKET_PATHS    = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),
]

# ── Docker API helpers ────────────────────────────────────────────────────────

class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, sock_path):
        super().__init__("localhost")
        self._sock_path = sock_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self._sock_path)


def find_socket():
    for p in SOCKET_PATHS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("Docker socket not found at any known path")


def docker_get(sock_path, path):
    c = UnixHTTP(sock_path)
    c.request("GET", path)
    r = c.getresponse()
    body = r.read().decode()
    c.close()
    return json.loads(body)


def get_stats(sock_path, container):
    return docker_get(sock_path, f"/containers/{container}/stats?stream=false&one-shot=true")


def cpu_percent(prev, curr):
    cd = curr["cpu_stats"]["cpu_usage"]["total_usage"] - prev["cpu_stats"]["cpu_usage"]["total_usage"]
    sd = curr["cpu_stats"]["system_cpu_usage"]         - prev["cpu_stats"]["system_cpu_usage"]
    nc = curr["cpu_stats"].get("online_cpus") or len(
        curr["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
    )
    return round((cd / sd * nc * 100.0) if sd > 0 else 0.0, 3)


# ── Main collection loop ──────────────────────────────────────────────────────

def collect(duration: int, output: str):
    sock = find_socket()
    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    file_exists = out_path.exists()
    f = open(out_path, "a", newline="")
    writer = csv.DictWriter(f, fieldnames=["ts", "cpu_pct", "mem_mb", "mem_pct"])
    if not file_exists:
        writer.writeheader()

    print(f"[collector] Container : {CONTAINER_NAME}")
    print(f"[collector] Duration  : {duration}s")
    print(f"[collector] Interval  : {SAMPLE_INTERVAL}s")
    print(f"[collector] Output    : {output}")
    print(f"[collector] Sampling — Ctrl+C to stop early\n")

    prev_stats = None
    n = 0
    start = time.perf_counter()
    deadline = start + duration

    while time.perf_counter() < deadline:
        loop_start = time.perf_counter()
        try:
            curr = get_stats(sock, CONTAINER_NAME)

            if prev_stats is not None:
                cpu  = cpu_percent(prev_stats, curr)
                mem  = curr["memory_stats"].get("usage", 0)
                lim  = curr["memory_stats"].get("limit", 2 * 1024 ** 3)
                if lim > 1e14:          # Docker Desktop on Mac reports absurdly large limit
                    lim = 2 * 1024 ** 3
                mem_mb  = round(mem / 1024 ** 2, 2)
                mem_pct = round(mem / lim * 100, 3)
                ts = datetime.now(timezone.utc).isoformat()

                writer.writerow({"ts": ts, "cpu_pct": cpu, "mem_mb": mem_mb, "mem_pct": mem_pct})
                f.flush()
                n += 1

                elapsed = time.perf_counter() - start
                remaining = deadline - time.perf_counter()
                print(f"\r  [{n:5d} samples | {elapsed:5.0f}s elapsed | {remaining:5.0f}s left]"
                      f"  CPU={cpu:5.1f}%  MEM={mem_mb:6.1f}MB ({mem_pct:.1f}%)", end="", flush=True)

            prev_stats = curr

        except Exception as e:
            print(f"\n[collector] Warning: {e}")
            prev_stats = None

        # Sleep the remainder of the interval
        elapsed_loop = time.perf_counter() - loop_start
        sleep_for = max(0.0, SAMPLE_INTERVAL - elapsed_loop)
        time.sleep(sleep_for)

    f.close()
    print(f"\n\n[collector] Done — {n} samples written to {output}")
    return n


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS LSTM training data collector")
    ap.add_argument("--duration", type=int,  default=600,
                    help="Collection duration in seconds (default: 600)")
    ap.add_argument("--output",   type=str,  default="lstm/training_data.csv",
                    help="Output CSV path (default: lstm/training_data.csv)")
    args = ap.parse_args()

    try:
        collect(args.duration, args.output)
    except KeyboardInterrupt:
        print("\n[collector] Stopped by user")
