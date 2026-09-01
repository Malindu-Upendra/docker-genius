"""
cadvisor_collector.py — DOCKER-GENIUS Phase 2 Telemetry Collector

Polls cAdvisor at 100ms intervals, computes CPU% and memory usage for the
erp_app container, and appends rows to a CSV for LSTM training.

Usage:
    python cadvisor_collector.py [--output metrics.csv] [--host localhost] [--port 8080]

Schema written to CSV:
    timestamp, cpu_pct, mem_mb, mem_limit_mb, mem_pct
"""

import argparse
import csv
import os
import sys
import time
import signal
import requests
from datetime import datetime, timezone

CONTAINER    = "erp_app"
INTERVAL_S   = 0.1        # 100 ms
BATCH_FLUSH  = 50         # flush to disk every N rows

# ── cAdvisor API paths ────────────────────────────────────────────────────────

def cadvisor_url(host: str, port: int) -> str:
    return f"http://{host}:{port}/api/v2.0/stats/{CONTAINER}?count=2&type=docker"

# ── CPU delta calculation ─────────────────────────────────────────────────────

def cpu_pct(prev: dict, curr: dict) -> float:
    """Compute CPU% from two consecutive cAdvisor stat snapshots."""
    cpu_delta  = curr["cpu"]["usage"]["total"] - prev["cpu"]["usage"]["total"]
    time_delta = (
        datetime.fromisoformat(curr["timestamp"].replace("Z", "+00:00")).timestamp()
        - datetime.fromisoformat(prev["timestamp"].replace("Z", "+00:00")).timestamp()
    )
    if time_delta <= 0:
        return 0.0
    # cpu_delta is in nanoseconds; time_delta in seconds → convert ns → s
    return (cpu_delta / 1e9) / time_delta * 100.0

# ── Main collector loop ───────────────────────────────────────────────────────

def run(host: str, port: int, output: str):
    url        = cadvisor_url(host, port)
    fieldnames = ["timestamp", "cpu_pct", "mem_mb", "mem_limit_mb", "mem_pct"]

    file_exists = os.path.isfile(output)
    fh   = open(output, "a", newline="", buffering=1)
    writer = csv.DictWriter(fh, fieldnames=fieldnames)
    if not file_exists:
        writer.writeheader()

    prev_stat  = None
    batch      = []
    row_count  = 0
    error_streak = 0

    def shutdown(sig, frame):
        print(f"\n[collector] Shutting down — {row_count} rows written to {output}")
        fh.close()
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"[collector] Polling cAdvisor at {url}")
    print(f"[collector] Writing metrics to {output}")
    print(f"[collector] Press Ctrl+C to stop\n")

    while True:
        tick = time.perf_counter()
        try:
            resp = requests.get(url, timeout=0.8)
            resp.raise_for_status()
            data  = resp.json()

            # cAdvisor v2 returns a dict keyed by container id/name
            stats_list = list(data.values())[0].get("stats", [])
            if len(stats_list) < 2:
                time.sleep(max(0, INTERVAL_S - (time.perf_counter() - tick)))
                continue

            curr = stats_list[-1]
            prev = stats_list[-2]

            mem_usage = curr["memory"]["usage"]
            mem_limit = curr["memory"]["limit"]
            if mem_limit == 0 or mem_limit > 1e14:   # guard against 'unlimited' sentinel
                mem_limit = 2 * 1024**3               # default 2 GB

            row = {
                "timestamp"    : datetime.now(timezone.utc).isoformat(),
                "cpu_pct"      : round(cpu_pct(prev, curr), 3),
                "mem_mb"       : round(mem_usage / 1024**2, 1),
                "mem_limit_mb" : round(mem_limit  / 1024**2, 1),
                "mem_pct"      : round(mem_usage  / mem_limit * 100.0, 2),
            }

            batch.append(row)
            row_count += 1
            error_streak = 0

            if len(batch) >= BATCH_FLUSH:
                writer.writerows(batch)
                fh.flush()
                batch.clear()
                print(f"\r[collector] {row_count} rows | CPU {row['cpu_pct']:5.1f}% | "
                      f"MEM {row['mem_mb']:6.0f}/{row['mem_limit_mb']:.0f} MB "
                      f"({row['mem_pct']:.1f}%)", end="", flush=True)

        except Exception as exc:
            error_streak += 1
            if error_streak % 10 == 1:
                print(f"\n[collector] cAdvisor unreachable ({exc}) — retrying...", file=sys.stderr)

        elapsed = time.perf_counter() - tick
        sleep_s = max(0, INTERVAL_S - elapsed)
        time.sleep(sleep_s)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS cAdvisor metric collector")
    ap.add_argument("--host",   default="localhost", help="cAdvisor host")
    ap.add_argument("--port",   default=8080, type=int, help="cAdvisor port")
    ap.add_argument("--output", default="metrics.csv", help="Output CSV path")
    args = ap.parse_args()
    run(args.host, args.port, args.output)
