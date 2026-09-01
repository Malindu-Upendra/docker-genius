"""
kpi_processor.py — DOCKER-GENIUS KPI Time-Series Processor

Reads the raw per-request CSVs produced by the experiment harness and
produces two enriched outputs per group:

  group{N}_timeseries.csv   — rolling 10-second windows showing how
                               P50/P95/breach-rate evolve over time
                               (illustrates the governor's effect)

  group{N}_summary.csv      — single-row aggregate for Mann-Whitney input

Also merges all three groups into:
  all_groups_timeseries.csv — used for the comparison line-plot

Usage:
    python3 analysis/kpi_processor.py
    python3 analysis/kpi_processor.py --results experiment/results
"""

from __future__ import annotations

import argparse
import csv
import math
from datetime import datetime, timezone
from pathlib import Path

WINDOW_S    = 10      # rolling window width in seconds
TIER1_SLA   = 150.0   # ms — SLA threshold for TIER_1


# ── Statistics helpers ────────────────────────────────────────────────────────

def percentile(data: list[float], p: float) -> float:
    if not data:
        return 0.0
    s   = sorted(data)
    idx = max(0, math.ceil(len(s) * p / 100) - 1)
    return round(s[idx], 2)

def mean(data: list[float]) -> float:
    return round(sum(data) / len(data), 2) if data else 0.0


# ── Per-file processing ───────────────────────────────────────────────────────

def load_requests(path: Path) -> list[dict]:
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            try:
                rows.append({
                    "ts"        : datetime.fromisoformat(
                                    r["ts"].replace("Z", "+00:00")),
                    "tier"      : r["tier"],
                    "latency_ms": float(r["latency_ms"]),
                    "status"    : int(r["status"]),
                    "sla_breach": int(r["sla_breach"]),
                })
            except (KeyError, ValueError):
                pass
    rows.sort(key=lambda x: x["ts"])
    return rows


def build_timeseries(rows: list[dict], group_label: str) -> list[dict]:
    """
    Slide a WINDOW_S-second window over the request log.
    Each output row covers one window and reports TIER_1 statistics.
    """
    t1 = [r for r in rows if r["tier"] == "TIER_1"]
    if not t1:
        return []

    t_start = t1[0]["ts"]
    t_end   = t1[-1]["ts"]
    total_s = max(1.0, (t_end - t_start).total_seconds())
    windows = []

    t_cur = t_start
    step  = __import__("datetime").timedelta(seconds=WINDOW_S)

    while t_cur < t_end:
        w_end  = t_cur + step
        bucket = [r for r in t1
                  if t_cur <= r["ts"] < w_end]
        lats   = [r["latency_ms"] for r in bucket]
        breach = sum(r["sla_breach"] for r in bucket)

        windows.append({
            "group"       : group_label,
            "elapsed_s"   : round((t_cur - t_start).total_seconds(), 1),
            "window_s"    : WINDOW_S,
            "t1_count"    : len(bucket),
            "t1_rps"      : round(len(bucket) / WINDOW_S, 3),
            "t1_p50_ms"   : percentile(lats, 50),
            "t1_p95_ms"   : percentile(lats, 95),
            "t1_p99_ms"   : percentile(lats, 99),
            "t1_mean_ms"  : mean(lats),
            "t1_breaches" : breach,
            "t1_breach_pct": round(breach / len(bucket) * 100, 2)
                             if bucket else 0.0,
        })
        t_cur = w_end

    return windows


def build_summary(rows: list[dict], group_label: str) -> dict:
    t1   = [r for r in rows if r["tier"] == "TIER_1"]
    t3   = [r for r in rows if r["tier"] == "TIER_3"]
    lats = [r["latency_ms"] for r in t1]
    breach = sum(r["sla_breach"] for r in t1)

    t_start = t1[0]["ts"]  if t1 else None
    t_end   = t1[-1]["ts"] if t1 else None
    dur_s   = max(1.0, (t_end - t_start).total_seconds()) if t1 else 1.0

    return {
        "group"           : group_label,
        "t1_count"        : len(t1),
        "t1_rps"          : round(len(t1) / dur_s, 3),
        "t1_mean_ms"      : mean(lats),
        "t1_p50_ms"       : percentile(lats, 50),
        "t1_p95_ms"       : percentile(lats, 95),
        "t1_p99_ms"       : percentile(lats, 99),
        "t1_sla_breaches" : breach,
        "t1_breach_pct"   : round(breach / len(t1) * 100, 2) if t1 else 0.0,
        "t3_count"        : len(t3),
        "t3_mean_ms"      : mean([r["latency_ms"] for r in t3]),
        "duration_s"      : round(dur_s, 1),
    }


def write_csv(rows: list[dict], path: Path):
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"  → {path}  ({len(rows)} rows)")


# ── Main ──────────────────────────────────────────────────────────────────────

LABELS = {1: "Static Allocation", 2: "Reactive-Only", 3: "Proactive Hybrid"}

def main():
    ap = argparse.ArgumentParser(
        description="Process experiment KPI CSVs into time-series and summaries"
    )
    ap.add_argument("--results", default="experiment/results",
                    help="Path to experiment results directory")
    args  = ap.parse_args()
    rdir  = Path(args.results)
    odir  = rdir   # write outputs alongside inputs

    all_ts: list[dict]  = []
    summaries: list[dict] = []

    for num in (1, 2, 3):
        kpi_path = rdir / f"group{num}_kpi.csv"
        if not kpi_path.exists():
            print(f"[processor] group{num}_kpi.csv not found — skipping")
            continue

        label = LABELS[num]
        print(f"[processor] Processing group {num} — {label}")

        rows = load_requests(kpi_path)
        if not rows:
            print(f"  No valid rows in {kpi_path}")
            continue

        ts_rows = build_timeseries(rows, label)
        summary = build_summary(rows, label)

        write_csv(ts_rows, odir / f"group{num}_timeseries.csv")

        all_ts.extend(ts_rows)
        summaries.append(summary)

        print(f"  P50={summary['t1_p50_ms']}ms  "
              f"P95={summary['t1_p95_ms']}ms  "
              f"breach={summary['t1_breach_pct']}%  "
              f"n={summary['t1_count']}")

    if all_ts:
        write_csv(all_ts, odir / "all_groups_timeseries.csv")

    if summaries:
        write_csv(summaries, odir / "all_groups_summary.csv")
        print(f"\n[processor] ✅  Done — {len(summaries)} groups processed")
        print(f"[processor] Run analysis/mann_whitney.py next.")


if __name__ == "__main__":
    main()
