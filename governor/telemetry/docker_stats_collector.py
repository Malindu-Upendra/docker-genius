"""
docker_stats_collector.py — DOCKER-GENIUS Telemetry Collector (Mac/Linux)

Uses the Docker Engine API directly — works on macOS AND Linux.
On the Linux research VM, prefer cadvisor_collector.py for 100ms precision;
use this script for local Mac development and validation.

Output CSV schema (same as cadvisor_collector.py):
    timestamp, cpu_pct, mem_mb, mem_limit_mb, mem_pct

Usage:
    python docker_stats_collector.py [--container erp_app] [--output metrics.csv] [--interval 0.5]
"""

import argparse
import csv
import json
import os
import signal
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

CONTAINER    = "erp_app"
INTERVAL_S   = 0.5          # 500ms on Mac (Docker-in-VM overhead; 100ms on Linux)
BATCH_FLUSH  = 20
FIELDNAMES   = ["timestamp", "cpu_pct", "mem_mb", "mem_limit_mb", "mem_pct"]

# Docker socket paths to try in order
SOCKET_PATHS = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),
    os.path.expanduser("~/Library/Containers/com.docker.docker/Data/docker.raw.sock"),
]

# ── Unix socket HTTP client (no external deps) ────────────────────────────────

import socket
import http.client

class UnixSocketHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path):
        super().__init__("localhost")
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.socket_path)


def docker_get(socket_path: str, path: str) -> dict:
    conn = UnixSocketHTTPConnection(socket_path)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read().decode()
    conn.close()
    return json.loads(body)


def find_socket() -> str:
    for p in SOCKET_PATHS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(
        "Docker socket not found. Is Docker Desktop running?\n"
        f"Tried: {SOCKET_PATHS}"
    )

# ── CPU% calculation (same formula as cAdvisor) ───────────────────────────────

def calc_cpu_pct(prev: dict, curr: dict) -> float:
    cpu_delta    = curr["cpu_stats"]["cpu_usage"]["total_usage"] \
                 - prev["cpu_stats"]["cpu_usage"]["total_usage"]
    system_delta = curr["cpu_stats"]["system_cpu_usage"] \
                 - prev["cpu_stats"]["system_cpu_usage"]
    num_cpus     = curr["cpu_stats"].get("online_cpus") \
                or len(curr["cpu_stats"]["cpu_usage"].get("percpu_usage", [1]))
    if system_delta <= 0:
        return 0.0
    return (cpu_delta / system_delta) * num_cpus * 100.0

# ── Main collector loop ───────────────────────────────────────────────────────

def run(container: str, output: str, interval: float):
    sock = find_socket()
    print(f"[collector] Docker socket: {sock}")
    print(f"[collector] Container:     {container}")
    print(f"[collector] Output:        {output}")
    print(f"[collector] Interval:      {interval*1000:.0f}ms")
    print(f"[collector] Press Ctrl+C to stop\n")

    file_exists = os.path.isfile(output)
    fh     = open(output, "a", newline="", buffering=1)
    writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
    if not file_exists:
        writer.writeheader()

    batch      = []
    row_count  = 0
    prev_stats = None
    error_streak = 0

    def shutdown(sig, frame):
        print(f"\n[collector] Stopped — {row_count} rows written to {output}")
        if batch:
            writer.writerows(batch)
        fh.close()
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        tick = time.perf_counter()
        try:
            stats = docker_get(sock, f"/containers/{container}/stats?stream=false&one-shot=true")

            if prev_stats is not None:
                cpu  = round(calc_cpu_pct(prev_stats, stats), 3)
                mem  = stats["memory_stats"].get("usage", 0)
                lim  = stats["memory_stats"].get("limit", 2 * 1024**3)
                if lim == 0 or lim > 1e14:
                    lim = 2 * 1024**3

                row = {
                    "timestamp"    : datetime.now(timezone.utc).isoformat(),
                    "cpu_pct"      : cpu,
                    "mem_mb"       : round(mem / 1024**2, 1),
                    "mem_limit_mb" : round(lim / 1024**2, 1),
                    "mem_pct"      : round(mem / lim * 100.0, 2),
                }
                batch.append(row)
                row_count += 1
                error_streak = 0

                if len(batch) >= BATCH_FLUSH:
                    writer.writerows(batch)
                    fh.flush()
                    batch.clear()
                    print(f"\r[collector] {row_count:5d} rows | "
                          f"CPU {row['cpu_pct']:5.1f}% | "
                          f"MEM {row['mem_mb']:6.0f}/{row['mem_limit_mb']:.0f} MB "
                          f"({row['mem_pct']:.1f}%)", end="", flush=True)

            prev_stats = stats

        except Exception as exc:
            error_streak += 1
            if error_streak % 20 == 1:
                print(f"\n[collector] Error: {exc}", file=sys.stderr)

        elapsed = time.perf_counter() - tick
        time.sleep(max(0, interval - elapsed))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS Docker Stats metric collector")
    ap.add_argument("--container", default=CONTAINER)
    ap.add_argument("--output",    default="metrics.csv")
    ap.add_argument("--interval",  default=INTERVAL_S, type=float, help="Poll interval in seconds")
    args = ap.parse_args()
    run(args.container, args.output, args.interval)
