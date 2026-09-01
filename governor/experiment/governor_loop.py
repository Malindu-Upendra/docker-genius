"""
governor_loop.py — DOCKER-GENIUS Governor Main Loop

Runs two background threads during an experiment group:

  Sampler (every SAMPLE_INTERVAL=1s — matches LSTM training cadence):
    1. Reads live CPU/RAM from Docker stats
    2. Feeds the reading into the LSTM predictor buffer

  Decision loop (every GOVERNOR_INTERVAL=10s):
    3. Reads the latest sampled CPU/RAM + current forecast
    4. Asks the rule engine for a scaling decision
    5. Applies the decision via the Docker Update API
    6. Appends an audit entry to the internal log

These two cadences are intentionally decoupled: the LSTM's 60-step window
and 30-step horizon are defined in samples, and the model was trained on
1 Hz telemetry, so the buffer must be fed at 1 Hz regardless of how often
the rule engine actually makes decisions.

Mode selection:
  "proactive" → uses LSTMPredictor  (Group 3 — full DOCKER-GENIUS)
  "reactive"  → uses current values only  (Group 2 — reactive baseline)
  "static"    → loop does not start at all  (Group 1 — control)
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

# Add governor root to path so sibling packages resolve
sys.path.insert(0, str(Path(__file__).parent.parent))

from docker_api.updater  import DockerUpdater
from rule_engine.rule_engine import RuleEngine

GOVERNOR_INTERVAL = 10   # seconds between rule-engine decision cycles
SAMPLE_INTERVAL   = 1    # seconds between telemetry samples fed to the LSTM
                         # buffer — MUST match collect_training_data.py's
                         # sampling rate (1 Hz). The predictor's 60-step
                         # window / 30-step horizon are defined in units of
                         # samples, so if this drifts from the training
                         # cadence the model is fed a differently-paced
                         # signal than it learned from.
CONTAINER         = os.environ.get("DG_CONTAINER", "erp_app")
SOCKET_PATHS      = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),
]

DB_CONFIG = {
    "host"    : "localhost",
    "port"    : int(os.environ.get("DG_DB_PORT", 3307)),
    "user"    : "root",
    "password": "rootpassword",
    "database": "demo_nexcore",
}


# ── Docker stats helper (re-used from telemetry) ──────────────────────────────

class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, sock_path):
        super().__init__("localhost")
        self._sock_path = sock_path
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self._sock_path)

def _find_socket():
    for p in SOCKET_PATHS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("Docker socket not found")

def _get_stats(container):
    sock = _find_socket()
    c = UnixHTTP(sock)
    c.request("GET", f"/containers/{container}/stats?stream=false&one-shot=true")
    r = c.getresponse()
    body = r.read().decode()
    c.close()
    return json.loads(body)

_prev_stats = None

def _read_cpu_mem(container: str) -> tuple[float, float]:
    """Return (cpu_pct, mem_mb) from Docker stats."""
    global _prev_stats
    curr = _get_stats(container)
    cpu  = 0.0
    if _prev_stats:
        cd = (curr["cpu_stats"]["cpu_usage"]["total_usage"]
              - _prev_stats["cpu_stats"]["cpu_usage"]["total_usage"])
        sd = (curr["cpu_stats"]["system_cpu_usage"]
              - _prev_stats["cpu_stats"]["system_cpu_usage"])
        nc = curr["cpu_stats"].get("online_cpus") or len(
            curr["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
        )
        cpu = round((cd / sd * nc * 100.0) if sd > 0 else 0.0, 2)
    _prev_stats = curr
    mem = curr["memory_stats"].get("usage", 0)
    lim = curr["memory_stats"].get("limit", 2 * 1024**3)
    if lim > 1e14:
        lim = 2 * 1024**3
    mem_mb = round(mem / 1024**2, 1)
    return cpu, mem_mb


# ── GovernorLoop ──────────────────────────────────────────────────────────────

class GovernorLoop:
    """
    Background governor thread for one experiment group.

    Parameters
    ----------
    mode     : "proactive" | "reactive" | "static"
    interval : seconds between govern cycles (default 10)
    """

    def __init__(self, mode: str, interval: int = GOVERNOR_INTERVAL,
                 semantic_aware: bool = True):
        assert mode in ("proactive", "reactive", "static")
        self.mode           = mode
        self.interval       = interval
        self.semantic_aware = semantic_aware
        self._stop    = threading.Event()
        self._thread  = None
        self._log: list[dict] = []

        # Latest telemetry reading, refreshed at SAMPLE_INTERVAL by the
        # sampler thread and consumed by the decision cycle every
        # `interval` seconds. Protected by _reading_lock.
        self._reading_lock = threading.Lock()
        self._latest_cpu    = 0.0
        self._latest_mem_mb = 0.0
        self._sample_stop   = threading.Event()
        self._sample_thread = None

        if mode == "static":
            return  # nothing to initialise

        self._updater = DockerUpdater(CONTAINER)
        self._engine  = RuleEngine(mode=mode, db_config=DB_CONFIG,
                                    semantic_aware=semantic_aware)
        self._predictor = None

        if mode == "proactive":
            try:
                from lstm.predictor import LSTMPredictor
                self._predictor = LSTMPredictor()
            except FileNotFoundError as e:
                print(f"[governor] WARNING: {e}")
                print("[governor] Falling back to reactive mode for this run.")
                self.mode = "reactive"
                self._engine = RuleEngine(mode="reactive", db_config=DB_CONFIG,
                                           semantic_aware=semantic_aware)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        if self.mode == "static":
            print("[governor] Static mode — no governor loop")
            return
        global _prev_stats
        _prev_stats = None   # reset delta for fresh CPU readings

        # Prime the latest reading synchronously so the first decision
        # cycle (which may fire before the sampler's first tick) has a
        # real value instead of the 0.0 default.
        try:
            cpu, mem_mb = _read_cpu_mem(CONTAINER)
            self._latest_cpu, self._latest_mem_mb = cpu, mem_mb
        except Exception as e:
            print(f"[governor] Initial read failed: {e}")

        self._sample_stop.clear()
        self._sample_thread = threading.Thread(
            target=self._sample_loop, daemon=True, name=f"sampler-{self.mode}")
        self._sample_thread.start()

        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True,
                                        name=f"governor-{self.mode}")
        self._thread.start()
        print(f"[governor] Loop started — mode={self.mode}  "
              f"decision_interval={self.interval}s  "
              f"sample_interval={SAMPLE_INTERVAL}s")

    def stop(self):
        if self.mode == "static" or self._thread is None:
            return
        self._sample_stop.set()
        if self._sample_thread:
            self._sample_thread.join(timeout=SAMPLE_INTERVAL + 5)
        self._stop.set()
        self._thread.join(timeout=self.interval + 5)
        print(f"[governor] Loop stopped — {len(self._log)} scaling decisions logged")

    def decisions(self) -> list[dict]:
        return list(self._log)

    # ── Internal loops ────────────────────────────────────────────────────────

    def _sample_loop(self):
        """Runs at SAMPLE_INTERVAL (1 Hz) — reads telemetry and feeds the
        LSTM buffer at the same cadence the model was trained on. This must
        stay decoupled from the (slower) decision cycle: a 60-sample window
        fed once per GOVERNOR_INTERVAL would span 600s of wall-clock time
        instead of the 60s the model expects."""
        while not self._sample_stop.is_set():
            tick_start = time.perf_counter()
            try:
                cpu, mem_mb = _read_cpu_mem(CONTAINER)
                with self._reading_lock:
                    self._latest_cpu, self._latest_mem_mb = cpu, mem_mb
                if self._predictor:
                    self._predictor.update(cpu, mem_mb)
            except Exception as e:
                print(f"[governor] Sample error: {e}")
            elapsed = time.perf_counter() - tick_start
            self._sample_stop.wait(timeout=max(0.0, SAMPLE_INTERVAL - elapsed))

    def _loop(self):
        while not self._stop.is_set():
            cycle_start = time.perf_counter()
            try:
                self._cycle()
            except Exception as e:
                print(f"[governor] Cycle error: {e}")
            # Sleep the remainder of the interval
            elapsed = time.perf_counter() - cycle_start
            self._stop.wait(timeout=max(0.0, self.interval - elapsed))

    def _cycle(self):
        _cycle_t0 = time.perf_counter()
        with self._reading_lock:
            cpu, mem_mb = self._latest_cpu, self._latest_mem_mb
        limits      = self._updater.get_limits()
        current_cpus   = limits["cpus"]   or 2.0
        current_mem_gb = limits["mem_gb"] or 2.0

        # LSTM buffer is fed continuously by _sample_loop at SAMPLE_INTERVAL;
        # here we just read the current forecast off the buffer.
        forecast = None
        if self._predictor:
            forecast = self._predictor.predict()   # None until buffer is full

        decision = self._engine.evaluate(
            forecast       = forecast,
            current_cpu    = cpu,
            current_mem_mb = mem_mb,
            current_cpus   = current_cpus,
            current_mem_gb = current_mem_gb,
        )

        entry = {
            "ts"           : datetime.now(timezone.utc).isoformat(),
            "cpu_pct"      : cpu,
            "mem_mb"       : mem_mb,
            "current_cpus" : current_cpus,
            "current_mem_gb": current_mem_gb,
            "action"       : decision.action,
            "target_cpus"  : decision.target_cpus,
            "target_mem_gb": decision.target_mem_gb,
            "rule"         : decision.triggered_rule,
            "reason"       : decision.reason,
            # Wall-clock time to read docker stats, run the LSTM forecast (if
            # proactive), and evaluate the rule engine — i.e. everything up
            # to the decision being ready, excluding the actual Docker Update
            # API call (measured separately as actuation latency) and the
            # fixed inter-cycle sleep. This is the metric the scalability
            # test compares between N=1 and N=2 concurrent governor instances.
            "cycle_ms"     : round((time.perf_counter() - _cycle_t0) * 1000, 2),
        }
        self._log.append(entry)

        if decision.action != "none":
            print(f"\n{decision}")
            self._updater.apply(decision.target_cpus, decision.target_mem_gb)
        else:
            # Print a brief heartbeat every cycle
            lstm_status = (f"LSTM buffer {self._predictor.buffer_fill()}"
                           if self._predictor else "reactive")
            print(f"[governor] cycle  cpu={cpu:5.1f}%  mem={mem_mb:6.0f}MB  "
                  f"cpus={current_cpus}  mem={current_mem_gb:.1f}GB  "
                  f"{lstm_status}")
