"""
live_monitor.py — DOCKER-GENIUS Real-Time Research Monitor

Terminal dashboard that simultaneously shows:
  - Container CPU% and memory (from cAdvisor)
  - Tier-1 P95 latency and SLA violations (from semantic_request_logs DB)
  - Tier-3 response times
  - Live proof-of-contention: Tier-1 latency spike during Tier-3 bursts

Usage:
    python live_monitor.py [--cadvisor-host localhost] [--db-host localhost]

Requires: pip install requests mysql-connector-python
"""

import argparse
import os
import sys
import time
import threading
from collections import deque
from datetime import datetime, timezone, timedelta

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

try:
    import mysql.connector
except ImportError:
    sys.exit("pip install mysql-connector-python")

# ── Config ────────────────────────────────────────────────────────────────────
CONTAINER     = "erp_app"
CADVISOR_PORT = 8080
REFRESH_S     = 2.0
HISTORY_LEN   = 60          # keep 60 samples for sparkline

DB_CONFIG = {
    "host"    : "localhost",
    "port"    : 3306,
    "user"    : "root",
    "password": "root",
    "database": "demo_nexcore",
}

# ── Shared state ──────────────────────────────────────────────────────────────
state = {
    "cpu_pct"        : 0.0,
    "mem_mb"         : 0.0,
    "mem_limit_mb"   : 2048.0,
    "cpu_history"    : deque(maxlen=HISTORY_LEN),
    "t1_p50"         : 0.0,
    "t1_p95"         : 0.0,
    "t1_total"       : 0,
    "t1_breaches"    : 0,
    "t3_last_ms"     : 0.0,
    "t3_total"       : 0,
    "t3_avg_ms"      : 0.0,
    "last_db_update" : "—",
    "cadvisor_ok"    : False,
    "db_ok"          : False,
    "prev_cpu_stat"  : None,
}
lock = threading.Lock()

# ── cAdvisor poller ───────────────────────────────────────────────────────────

def cadvisor_poller(host: str, port: int):
    url = f"http://{host}:{port}/api/v2.0/stats/{CONTAINER}?count=2&type=docker"
    while True:
        try:
            resp = requests.get(url, timeout=0.8)
            resp.raise_for_status()
            data  = resp.json()
            stats = list(data.values())[0].get("stats", [])
            if len(stats) >= 2:
                curr, prev = stats[-1], stats[-2]
                cpu_delta  = curr["cpu"]["usage"]["total"] - prev["cpu"]["usage"]["total"]
                t_curr = datetime.fromisoformat(curr["timestamp"].replace("Z","+00:00")).timestamp()
                t_prev = datetime.fromisoformat(prev["timestamp"].replace("Z","+00:00")).timestamp()
                t_delta = t_curr - t_prev
                cpu = (cpu_delta / 1e9) / t_delta * 100.0 if t_delta > 0 else 0
                mem = curr["memory"]["usage"]
                lim = curr["memory"]["limit"]
                if lim == 0 or lim > 1e14:
                    lim = 2 * 1024**3
                with lock:
                    state["cpu_pct"]      = round(cpu, 1)
                    state["mem_mb"]       = round(mem / 1024**2, 1)
                    state["mem_limit_mb"] = round(lim / 1024**2, 1)
                    state["cpu_history"].append(round(cpu, 1))
                    state["cadvisor_ok"]  = True
        except Exception:
            with lock:
                state["cadvisor_ok"] = False
        time.sleep(0.1)

# ── DB poller (semantic_request_logs) ────────────────────────────────────────

def db_poller(db_cfg: dict):
    """Reads last 5 minutes of semantic_request_logs every 2s."""
    while True:
        try:
            conn = mysql.connector.connect(**db_cfg)
            cur  = conn.cursor(dictionary=True)

            since = datetime.now(timezone.utc) - timedelta(minutes=5)
            cur.execute("""
                SELECT priority_tier,
                       COUNT(*) AS n,
                       AVG(response_time_ms) AS avg_ms,
                       MAX(response_time_ms) AS max_ms,
                       SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
                FROM semantic_request_logs
                WHERE logged_at >= %s
                GROUP BY priority_tier
            """, (since,))
            rows = {r["priority_tier"]: r for r in cur.fetchall()}

            # P95 requires ordering — separate query for Tier-1
            cur.execute("""
                SELECT response_time_ms
                FROM semantic_request_logs
                WHERE priority_tier = 'TIER_1' AND logged_at >= %s
                ORDER BY response_time_ms
            """, (since,))
            t1_times = [r["response_time_ms"] for r in cur.fetchall()]

            cur.execute("""
                SELECT response_time_ms
                FROM semantic_request_logs
                WHERE priority_tier = 'TIER_3' AND logged_at >= %s
                ORDER BY response_time_ms
            """, (since,))
            t3_times = [r["response_time_ms"] for r in cur.fetchall()]

            cur.close()
            conn.close()

            def pct(lst, p):
                if not lst: return 0
                idx = max(0, int(len(lst) * p / 100) - 1)
                return sorted(lst)[idx]

            t1_row = rows.get("TIER_1", {})
            t3_row = rows.get("TIER_3", {})

            with lock:
                state["t1_p50"]       = round(pct(t1_times, 50), 1)
                state["t1_p95"]       = round(pct(t1_times, 95), 1)
                state["t1_total"]     = t1_row.get("n", 0)
                state["t1_breaches"]  = sum(1 for ms in t1_times if ms > 150)
                state["t3_last_ms"]   = round(pct(t3_times, 100), 1)   # max = last heavy op
                state["t3_total"]     = t3_row.get("n", 0)
                state["t3_avg_ms"]    = round(t3_row.get("avg_ms") or 0, 1)
                state["last_db_update"] = datetime.now().strftime("%H:%M:%S")
                state["db_ok"]        = True

        except Exception as e:
            with lock:
                state["db_ok"] = False
        time.sleep(REFRESH_S)

# ── Sparkline renderer ────────────────────────────────────────────────────────

SPARK_CHARS = " ▁▂▃▄▅▆▇█"

def sparkline(values, width=30, vmin=0, vmax=100):
    if not values:
        return " " * width
    recent = list(values)[-width:]
    out = []
    for v in recent:
        idx = int((v - vmin) / max(vmax - vmin, 1) * (len(SPARK_CHARS) - 1))
        out.append(SPARK_CHARS[max(0, min(idx, len(SPARK_CHARS)-1))])
    return "".join(out).ljust(width)

# ── Display ───────────────────────────────────────────────────────────────────

def color(text, code): return f"\033[{code}m{text}\033[0m"
def red(t):    return color(t, "91")
def yellow(t): return color(t, "93")
def green(t):  return color(t, "92")
def cyan(t):   return color(t, "96")
def bold(t):   return color(t, "1")

def render():
    os.system("clear")
    with lock:
        s = dict(state)
        hist = list(s["cpu_history"])

    cadv = green("● LIVE") if s["cadvisor_ok"] else red("● OFFLINE")
    db   = green("● LIVE") if s["db_ok"]       else red("● OFFLINE")

    breach_pct = (s["t1_breaches"] / s["t1_total"] * 100) if s["t1_total"] > 0 else 0
    sla_icon   = red("🔴 VIOLATED") if breach_pct > 5 else (yellow("🟡 WARNING") if breach_pct > 1 else green("🟢 OK"))

    cpu_color  = red if s["cpu_pct"] > 80 else (yellow if s["cpu_pct"] > 60 else green)
    mem_pct    = s["mem_mb"] / s["mem_limit_mb"] * 100 if s["mem_limit_mb"] > 0 else 0

    bar_len    = 30
    cpu_bar    = "█" * int(s["cpu_pct"] / 100 * bar_len)
    mem_bar    = "█" * int(mem_pct / 100 * bar_len)

    print(bold("╔══════════════════════════════════════════════════════════════╗"))
    print(bold("║        DOCKER-GENIUS  —  Live Research Monitor               ║"))
    print(bold("╚══════════════════════════════════════════════════════════════╝"))
    print(f"  cAdvisor: {cadv}          DB logs: {db}          {datetime.now().strftime('%H:%M:%S')}")
    print()

    print(bold("  ── Container Resources (erp_app) ──────────────────────────────"))
    cpu_pct_val = s["cpu_pct"]
    print(f"  CPU  {cpu_color(f'{cpu_pct_val:5.1f}%')}  [{cpu_color(cpu_bar.ljust(bar_len))}]")
    print(f"  MEM  {f'{mem_pct:5.1f}%'}  [{mem_bar.ljust(bar_len)}]  {s['mem_mb']:.0f}/{s['mem_limit_mb']:.0f} MB")
    print(f"  CPU sparkline (last {HISTORY_LEN}×100ms): {cyan(sparkline(hist, 30, 0, 100))}")
    print()

    print(bold("  ── Tier-1 POS Latency (last 5 min) ────────────────────────────"))
    p95_color = red if s["t1_p95"] > 150 else (yellow if s["t1_p95"] > 100 else green)
    t1_p95_val = s["t1_p95"]
    print(f"  P50: {s['t1_p50']:6.0f} ms    P95: {p95_color(f'{t1_p95_val:6.0f} ms')}    "
          f"Requests: {s['t1_total']}")
    print(f"  SLA ({cyan('150ms')} target):  {sla_icon}  "
          f"Breaches: {red(str(s['t1_breaches'])) if s['t1_breaches'] else green('0')} "
          f"({breach_pct:.1f}%)")
    print()

    print(bold("  ── Tier-3 Report Load (last 5 min) ─────────────────────────────"))
    t3_last_val = s["t3_last_ms"]
    t3_max_str = red(f'{t3_last_val:7.0f} ms') if t3_last_val > 5000 else f'{t3_last_val:7.0f} ms'
    print(f"  Requests: {s['t3_total']:4d}    Avg: {s['t3_avg_ms']:7.0f} ms    Max: {t3_max_str}")
    print()

    contention = s["t1_p95"] > 150 and s["t3_total"] > 0
    print(bold("  ── Research Hypothesis ─────────────────────────────────────────"))
    if contention:
        print(f"  {red('⚡ CONTENTION DETECTED')} — Tier-3 load is degrading Tier-1 latency")
        print(f"  This validates the DOCKER-GENIUS problem statement.")
    elif s["t3_total"] == 0:
        print(f"  {yellow('⏳ Waiting for Tier-3 activity...')} (run mixed_load.py)")
    else:
        print(f"  {green('✓ No contention yet')} — Tier-1 within SLA despite Tier-3 activity")
        print(f"  (May need more Tier-3 load to trigger contention)")
    print()
    print(f"  DB last updated: {s['last_db_update']}")
    print(bold("  ────────────────────────────────────────────────────────────────"))


def main(cadvisor_host, db_cfg):
    print("Starting DOCKER-GENIUS Live Monitor...")
    print("Starting background pollers...")

    t_cadv = threading.Thread(target=cadvisor_poller, args=(cadvisor_host, CADVISOR_PORT), daemon=True)
    t_db   = threading.Thread(target=db_poller,       args=(db_cfg,),                      daemon=True)
    t_cadv.start()
    t_db.start()

    print("Pollers running. Press Ctrl+C to exit.\n")
    try:
        while True:
            render()
            time.sleep(REFRESH_S)
    except KeyboardInterrupt:
        print("\nMonitor stopped.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cadvisor-host", default="localhost")
    ap.add_argument("--db-host",       default="localhost")
    ap.add_argument("--db-port",       default=3306, type=int)
    args = ap.parse_args()

    cfg = {**DB_CONFIG, "host": args.db_host, "port": args.db_port}
    main(args.cadvisor_host, cfg)
