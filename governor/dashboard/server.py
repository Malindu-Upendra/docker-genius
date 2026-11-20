"""
DOCKER-GENIUS Monitor — server.py
Generic real-time monitoring dashboard for any Dockerised monolith.

Adapts to any application:
  - Docker Stats API  → always works (just needs container name)
  - semantic_db       → optional, shows tier breakdown (NexCore-specific or any app that logs requests)
  - nginx_log         → optional, shows latency from access log

Usage:
    pip install flask pyyaml mysql-connector-python
    python server.py [--config config.yaml]
"""

import argparse
import json
import os
import socket
import http.client
import threading
import time
import math
import urllib.request
import urllib.error
from collections import deque
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yaml
from flask import Flask, Response, render_template_string, jsonify

LIVE_STATE_PATH = Path(__file__).parent / "live_state.json"
LIVE_STATE_STALE_S = 30   # governor_loop isn't running (or died) if older than this

# ── Docker Stats ──────────────────────────────────────────────────────────────

SOCKET_PATHS = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),
]

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
    raise FileNotFoundError("Docker socket not found")

def docker_get(sock_path, path):
    c = UnixHTTP(sock_path)
    c.request("GET", path)
    r = c.getresponse()
    body = r.read().decode()
    c.close()
    return json.loads(body)

def cpu_pct(prev, curr):
    cd = curr["cpu_stats"]["cpu_usage"]["total_usage"] - prev["cpu_stats"]["cpu_usage"]["total_usage"]
    sd = curr["cpu_stats"]["system_cpu_usage"] - prev["cpu_stats"]["system_cpu_usage"]
    nc = curr["cpu_stats"].get("online_cpus") or len(curr["cpu_stats"]["cpu_usage"].get("percpu_usage",[1]))
    return (cd / sd * nc * 100.0) if sd > 0 else 0.0

# ── Shared metrics state ──────────────────────────────────────────────────────

class MetricsStore:
    def __init__(self, history_minutes=10):
        maxlen = history_minutes * 60 * 2   # 2 samples/sec
        self.cpu_history    = deque(maxlen=maxlen)
        self.mem_history    = deque(maxlen=maxlen)
        self.lock           = threading.Lock()
        # Current snapshot
        self.cpu_pct        = 0.0
        self.mem_mb         = 0.0
        self.mem_limit_mb   = 2048.0
        self.mem_pct        = 0.0
        self.docker_ok      = False
        self.db_ok          = False
        # Tier data (last N minutes)
        self.tier_stats     = {}   # {tier: {p50, p95, p99, count, breaches}}
        self.rps            = 0
        self.total_requests = 0
        self.error_rate     = 0.0
        # Governor state
        self.current_cpus   = 2.0
        self.current_mem_gb = 2.0
        # Endpoint-level exploration (optional — needs endpoint_column/method_column in config)
        self.endpoint_tracking = False
        self.top_endpoints  = []   # [{endpoint, method, tier, count, avg_ms, max_ms, errors}]
        self.slow_requests  = []   # [{endpoint, method, tier, latency_ms, status, ts}] — slowest in window
        self.error_log      = []   # [{endpoint, method, tier, latency_ms, status, ts}] — status >= 400, newest first
        # Per-tenant breakdown (optional — needs tenant_column in config)
        self.tenant_tracking = False
        self.tenant_stats   = []   # [{tenant, count, avg_ms, breaches}]
        # "Time since last..." — searched further back than the main window so
        # this stays meaningful even when nothing bad happened recently.
        self.last_breach_ts = None
        self.last_crash_ts  = None
        # TIER_3 worker-thread isolation pool (optional — app.base_url + isolation_pool in config)
        self.pool_ok     = False
        self.pool_active = 0
        self.pool_queued = 0
        self.pool_max    = 0

store = MetricsStore()

# ── Isolation pool poller (optional — polls the NestJS app's own /internal/pool-stats) ─

def pool_poller(cfg):
    pool_cfg = cfg.get("isolation_pool", {})
    if not pool_cfg.get("enabled"):
        return
    url = cfg["app"]["base_url"].rstrip("/") + pool_cfg.get("path", "/api/internal/pool-stats")
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                data = json.loads(resp.read().decode())
            with store.lock:
                store.pool_ok     = True
                store.pool_active = int(data.get("active", 0))
                store.pool_queued = int(data.get("queued", 0))
                store.pool_max    = int(data.get("maxConcurrent", 0))
        except Exception:
            with store.lock:
                store.pool_ok = False
        time.sleep(1)

# ── Live governor-loop state (optional — written by experiment/governor_loop.py) ──────

def read_live_governor_state():
    """Reads live_state.json if it exists and was written recently. Returns
    None if the file is missing or stale (governor loop not currently running
    live — formal experiments don't write this, so its absence is normal)."""
    try:
        mtime = LIVE_STATE_PATH.stat().st_mtime
        if time.time() - mtime > LIVE_STATE_STALE_S:
            return None
        with open(LIVE_STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return None

# ── Docker Stats poller ───────────────────────────────────────────────────────

def docker_poller(cfg):
    container  = cfg["app"]["container_name"]
    prev_stats = None
    sock       = None

    while True:
        try:
            # Re-discover socket on each failure (handles Docker Desktop restarts)
            if sock is None:
                sock = find_socket()

            s = docker_get(sock, f"/containers/{container}/stats?stream=false&one-shot=true")

            if prev_stats:
                cpu  = round(cpu_pct(prev_stats, s), 2)
                mem  = s["memory_stats"].get("usage", 0)
                lim  = s["memory_stats"].get("limit", 2*1024**3)
                if lim > 1e14: lim = 2*1024**3
                ts   = datetime.now(timezone.utc).isoformat()
                with store.lock:
                    store.cpu_pct      = cpu
                    store.mem_mb       = round(mem/1024**2, 1)
                    store.mem_limit_mb = round(lim/1024**2, 1)
                    store.mem_pct      = round(mem/lim*100, 2)
                    store.docker_ok    = True
                    store.cpu_history.append({"ts": ts, "v": cpu})
                    store.mem_history.append({"ts": ts, "v": store.mem_mb})

            prev_stats = s

            # Read current resource limits from inspect
            try:
                info  = docker_get(sock, f"/containers/{container}/json")
                host  = info.get("HostConfig", {})
                quota = host.get("NanoCpus", 0)
                memlim = host.get("Memory", 0)
                with store.lock:
                    if quota > 0:
                        store.current_cpus   = round(quota / 1e9, 2)
                    if memlim > 0:
                        store.current_mem_gb = round(memlim / 1024**3, 2)
            except Exception:
                pass

        except Exception:
            sock = None        # force socket re-discovery on next iteration
            prev_stats = None  # reset delta so first new sample is clean
            with store.lock:
                store.docker_ok = False
        time.sleep(0.5)

# ── DB poller (optional — any app with a request log table) ──────────────────

def db_poller(cfg):
    db_cfg = cfg.get("semantic_db", {})
    if not db_cfg.get("enabled"):
        return
    try:
        import mysql.connector
    except ImportError:
        print("[monitor] mysql-connector-python not installed — DB metrics disabled")
        return

    table      = db_cfg["table"]
    tier_col   = db_cfg["tier_column"]
    lat_col    = db_cfg["latency_column"]
    stat_col   = db_cfg["status_column"]
    ts_col     = db_cfg["timestamp_column"]
    endpoint_col = db_cfg.get("endpoint_column")
    method_col   = db_cfg.get("method_column")
    tenant_col   = db_cfg.get("tenant_column")
    track_endpoints = bool(endpoint_col and method_col)
    track_tenants   = bool(tenant_col)
    sla_map    = cfg.get("sla_thresholds", {"TIER_1": 150})
    window     = cfg["dashboard"]["history_minutes"]
    tier1_sla  = sla_map.get("TIER_1", 150)

    conn_args = {
        "host":     db_cfg["host"],
        "port":     db_cfg["port"],
        "user":     db_cfg["user"],
        "password": db_cfg["password"],
        "database": db_cfg["database"],
    }

    while True:
        try:
            conn = mysql.connector.connect(**conn_args)
            cur  = conn.cursor(dictionary=True)
            since = datetime.now(timezone.utc) - timedelta(minutes=window)

            # Per-tier aggregates
            cur.execute(f"""
                SELECT {tier_col} AS tier,
                       COUNT(*) AS n,
                       AVG({lat_col}) AS avg_ms,
                       SUM(CASE WHEN {stat_col} >= 400 THEN 1 ELSE 0 END) AS errors
                FROM {table}
                WHERE {ts_col} >= %s
                GROUP BY {tier_col}
            """, (since,))
            rows = {r["tier"]: r for r in cur.fetchall()}

            # P50/P95/P99 per tier
            tier_stats = {}
            total_reqs = 0
            total_errs = 0
            for tier, row in rows.items():
                cur.execute(f"""
                    SELECT {lat_col} AS ms FROM {table}
                    WHERE {tier_col} = %s AND {ts_col} >= %s
                    ORDER BY {lat_col}
                """, (tier, since))
                times = [r["ms"] for r in cur.fetchall()]
                sla   = sla_map.get(tier, 9999)
                tier_stats[tier] = {
                    "count"   : int(row["n"]),
                    "avg_ms"  : round(float(row["avg_ms"] or 0), 1),
                    "p50"     : float(_pct(times, 50)),
                    "p95"     : float(_pct(times, 95)),
                    "p99"     : float(_pct(times, 99)),
                    "breaches": int(sum(1 for ms in times if ms > sla)),
                    "sla_ms"  : int(sla),
                }
                total_reqs += row["n"]
                total_errs += row["errors"]

            # RPS over last 60 s — whole number, no decimals
            cur.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {ts_col} >= %s",
                        (datetime.now(timezone.utc) - timedelta(seconds=60),))
            rps_row = cur.fetchone()
            rps = int(round(float(rps_row["n"] if rps_row else 0) / 60.0))

            top_endpoints, slow_requests, error_log = [], [], []
            if track_endpoints:
                # Which endpoint is driving latency up — aggregated, worst avg first
                cur.execute(f"""
                    SELECT {endpoint_col} AS endpoint, {method_col} AS method, {tier_col} AS tier,
                           COUNT(*) AS n, AVG({lat_col}) AS avg_ms, MAX({lat_col}) AS max_ms,
                           SUM(CASE WHEN {stat_col} >= 400 THEN 1 ELSE 0 END) AS errors
                    FROM {table}
                    WHERE {ts_col} >= %s
                    GROUP BY {endpoint_col}, {method_col}, {tier_col}
                    ORDER BY avg_ms DESC
                    LIMIT 15
                """, (since,))
                for r in cur.fetchall():
                    top_endpoints.append({
                        "endpoint": r["endpoint"], "method": r["method"], "tier": r["tier"],
                        "count": int(r["n"]), "avg_ms": round(float(r["avg_ms"] or 0), 1),
                        "max_ms": int(r["max_ms"] or 0), "errors": int(r["errors"] or 0),
                    })

                # Individual slowest requests in the window — "explore which went high"
                cur.execute(f"""
                    SELECT {endpoint_col} AS endpoint, {method_col} AS method, {tier_col} AS tier,
                           {lat_col} AS latency_ms, {stat_col} AS status, {ts_col} AS ts
                    FROM {table}
                    WHERE {ts_col} >= %s
                    ORDER BY {lat_col} DESC
                    LIMIT 40
                """, (since,))
                for r in cur.fetchall():
                    slow_requests.append({
                        "endpoint": r["endpoint"], "method": r["method"], "tier": r["tier"],
                        "latency_ms": int(r["latency_ms"]), "status": int(r["status"]),
                        "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"]),
                    })

                # Crashed / failed endpoints (4xx + 5xx), newest first
                cur.execute(f"""
                    SELECT {endpoint_col} AS endpoint, {method_col} AS method, {tier_col} AS tier,
                           {lat_col} AS latency_ms, {stat_col} AS status, {ts_col} AS ts
                    FROM {table}
                    WHERE {ts_col} >= %s AND {stat_col} >= 400
                    ORDER BY {ts_col} DESC
                    LIMIT 40
                """, (since,))
                for r in cur.fetchall():
                    error_log.append({
                        "endpoint": r["endpoint"], "method": r["method"], "tier": r["tier"],
                        "latency_ms": int(r["latency_ms"]), "status": int(r["status"]),
                        "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"]),
                    })

            tenant_stats = []
            if track_tenants:
                cur.execute(f"""
                    SELECT {tenant_col} AS tenant, COUNT(*) AS n, AVG({lat_col}) AS avg_ms,
                           SUM(CASE WHEN {tier_col} = 'TIER_1' AND {lat_col} > %s THEN 1 ELSE 0 END) AS breaches
                    FROM {table}
                    WHERE {ts_col} >= %s
                    GROUP BY {tenant_col}
                    ORDER BY n DESC
                    LIMIT 10
                """, (tier1_sla, since))
                for r in cur.fetchall():
                    tenant_stats.append({
                        "tenant": str(r["tenant"]), "count": int(r["n"]),
                        "avg_ms": round(float(r["avg_ms"] or 0), 1), "breaches": int(r["breaches"] or 0),
                    })

            # "Time since last..." — looked up beyond the main window (24h back) so
            # these stay meaningful even when the recent window is clean.
            lookback = datetime.now(timezone.utc) - timedelta(hours=24)
            cur.execute(f"""
                SELECT MAX({ts_col}) AS ts FROM {table}
                WHERE {tier_col} = 'TIER_1' AND {lat_col} > %s AND {ts_col} >= %s
            """, (tier1_sla, lookback))
            row = cur.fetchone()
            last_breach_ts = row["ts"].isoformat() if row and row["ts"] else None

            cur.execute(f"""
                SELECT MAX({ts_col}) AS ts FROM {table}
                WHERE {stat_col} >= 400 AND {ts_col} >= %s
            """, (lookback,))
            row = cur.fetchone()
            last_crash_ts = row["ts"].isoformat() if row and row["ts"] else None

            cur.close()
            conn.close()

            with store.lock:
                store.tier_stats     = tier_stats
                store.total_requests = int(total_reqs)
                store.rps            = rps
                store.error_rate     = round(float(total_errs) / float(total_reqs) * 100, 1) if total_reqs else 0.0
                store.db_ok          = True
                store.endpoint_tracking = track_endpoints
                store.top_endpoints   = top_endpoints
                store.slow_requests   = slow_requests
                store.error_log       = error_log
                store.tenant_tracking = track_tenants
                store.tenant_stats    = tenant_stats
                store.last_breach_ts  = last_breach_ts
                store.last_crash_ts   = last_crash_ts

        except Exception as e:
            with store.lock:
                store.db_ok = False
        time.sleep(2)

def _pct(lst, p):
    if not lst: return 0
    s = sorted(lst)
    idx = max(0, math.ceil(len(s) * p / 100) - 1)
    return round(float(s[idx]), 1)

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
_cfg = {}

@app.route("/")
def index():
    html_path = Path(__file__).parent / "index.html"
    return html_path.read_text()

def _governor_live_fields():
    state = read_live_governor_state()
    if not state:
        return {"governor_mode": None, "forecast_cpu_pct": None, "forecast_mem_mb": None, "scaling_decisions": []}
    latest = state.get("latest") or {}
    return {
        "governor_mode"    : state.get("mode"),
        "forecast_cpu_pct" : latest.get("forecast_cpu_pct"),
        "forecast_mem_mb"  : latest.get("forecast_mem_mb"),
        "scaling_decisions": state.get("recent_decisions", []),
    }

@app.route("/api/snapshot")
def snapshot():
    with store.lock:
        payload = {
            "app_name"      : _cfg["app"]["name"],
            "container"     : _cfg["app"]["container_name"],
            "cpu_pct"       : store.cpu_pct,
            "mem_mb"        : store.mem_mb,
            "mem_limit_mb"  : store.mem_limit_mb,
            "mem_pct"       : store.mem_pct,
            "docker_ok"     : store.docker_ok,
            "db_ok"         : store.db_ok,
            "tier_stats"    : store.tier_stats,
            "rps"           : store.rps,
            "total_requests": store.total_requests,
            "error_rate"    : store.error_rate,
            "current_cpus"  : store.current_cpus,
            "current_mem_gb": store.current_mem_gb,
            "endpoint_tracking": store.endpoint_tracking,
            "top_endpoints" : store.top_endpoints,
            "slow_requests" : store.slow_requests,
            "error_log"     : store.error_log,
            "tenant_tracking": store.tenant_tracking,
            "tenant_stats"  : store.tenant_stats,
            "last_breach_ts": store.last_breach_ts,
            "last_crash_ts" : store.last_crash_ts,
            "pool_ok"       : store.pool_ok,
            "pool_active"   : store.pool_active,
            "pool_queued"   : store.pool_queued,
            "pool_max"      : store.pool_max,
            "ts"            : datetime.now(timezone.utc).isoformat(),
        }
    payload.update(_governor_live_fields())
    return jsonify(payload)

@app.route("/api/history")
def history():
    with store.lock:
        return jsonify({
            "cpu" : list(store.cpu_history)[-120:],
            "mem" : list(store.mem_history)[-120:],
        })

@app.route("/stream")
def stream():
    """Server-Sent Events — pushes a snapshot every second."""
    def generate():
        while True:
            with store.lock:
                data = {
                    "cpu_pct"       : store.cpu_pct,
                    "mem_mb"        : store.mem_mb,
                    "mem_pct"       : store.mem_pct,
                    "mem_limit_mb"  : store.mem_limit_mb,
                    "docker_ok"     : store.docker_ok,
                    "db_ok"         : store.db_ok,
                    "tier_stats"    : store.tier_stats,
                    "rps"           : store.rps,
                    "error_rate"    : store.error_rate,
                    "current_cpus"  : store.current_cpus,
                    "current_mem_gb": store.current_mem_gb,
                    "endpoint_tracking": store.endpoint_tracking,
                    "top_endpoints" : store.top_endpoints,
                    "slow_requests" : store.slow_requests,
                    "error_log"     : store.error_log,
                    "tenant_tracking": store.tenant_tracking,
                    "tenant_stats"  : store.tenant_stats,
                    "last_breach_ts": store.last_breach_ts,
                    "last_crash_ts" : store.last_crash_ts,
                    "pool_ok"       : store.pool_ok,
                    "pool_active"   : store.pool_active,
                    "pool_queued"   : store.pool_queued,
                    "pool_max"      : store.pool_max,
                    "ts"            : datetime.now(timezone.utc).isoformat(),
                }
            data.update(_governor_live_fields())
            yield f"data: {json.dumps(data)}\n\n"
            time.sleep(_cfg["dashboard"]["refresh_ms"] / 1000)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    global _cfg
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()

    with open(args.config) as f:
        _cfg = yaml.safe_load(f)

    store.current_cpus   = _cfg["resource_limits"]["initial_cpus"]
    store.current_mem_gb = _cfg["resource_limits"]["initial_memory_gb"]

    print(f"[monitor] App:       {_cfg['app']['name']}")
    print(f"[monitor] Container: {_cfg['app']['container_name']}")
    print(f"[monitor] DB metrics: {'enabled' if _cfg.get('semantic_db',{}).get('enabled') else 'disabled'}")

    threading.Thread(target=docker_poller, args=(_cfg,), daemon=True).start()
    threading.Thread(target=db_poller,     args=(_cfg,), daemon=True).start()
    threading.Thread(target=pool_poller,   args=(_cfg,), daemon=True).start()

    port = _cfg["dashboard"]["port"]
    print(f"[monitor] Dashboard: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, threaded=True)

if __name__ == "__main__":
    main()
