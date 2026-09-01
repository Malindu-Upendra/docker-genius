"""
updater.py — DOCKER-GENIUS Docker Update API Client

Applies scaling decisions to a running container via the Docker Engine
Unix socket API (POST /containers/{name}/update).

No subprocess / CLI — communicates directly with the daemon socket so
latency is <5ms even on resource-constrained hosts.

Docker resource encoding:
  --cpus  N     →  NanoCpus  = N * 1_000_000_000
  --memory Xg   →  Memory    = X * 1024^3  (bytes)

Usage:
    from docker_api.updater import DockerUpdater
    u = DockerUpdater(container="erp_app")
    ok = u.apply(target_cpus=2.5, target_mem_gb=2.0)

    limits = u.get_limits()   # returns {"cpus": 2.5, "mem_gb": 2.0}
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import time
from datetime import datetime, timezone

SOCKET_PATHS = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),
]

# Guard rails — never push outside these bounds regardless of rule engine output
HARD_MIN_CPUS   = 0.5
HARD_MAX_CPUS   = 8.0
HARD_MIN_MEM_GB = 0.5
HARD_MAX_MEM_GB = 8.0


# ── Docker socket helpers ─────────────────────────────────────────────────────

class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, sock_path: str):
        super().__init__("localhost")
        self._sock_path = sock_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self._sock_path)


def _find_socket() -> str:
    for p in SOCKET_PATHS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(
        "Docker socket not found. Is Docker Desktop running?"
    )


def _docker_request(method: str, path: str, body: dict | None = None) -> dict:
    sock = _find_socket()
    conn = UnixHTTP(sock)
    headers = {"Content-Type": "application/json"}
    payload = json.dumps(body).encode() if body else b""
    conn.request(method, path, body=payload, headers=headers)
    resp = conn.getresponse()
    raw  = resp.read().decode()
    conn.close()
    return {"status": resp.status, "body": json.loads(raw) if raw.strip() else {}}


# ── DockerUpdater ─────────────────────────────────────────────────────────────

class DockerUpdater:
    """
    Applies CPU and memory limit changes to a named Docker container.

    All changes are logged with timestamp and verified by reading back
    the container's HostConfig after the update.
    """

    def __init__(self, container: str = "erp_app"):
        self.container = container
        self._history: list[dict] = []   # audit log for thesis analysis
        # Verify connectivity on init
        try:
            limits = self.get_limits()
            print(f"[updater] Connected — {container}  "
                  f"cpus={limits['cpus']}  mem={limits['mem_gb']:.2f}GB")
        except Exception as e:
            print(f"[updater] WARNING: could not read container limits — {e}")

    # ── Public API ────────────────────────────────────────────────────────────

    def get_limits(self) -> dict:
        """
        Return current resource limits for the container.

        Returns
        -------
        dict with keys: cpus (float), mem_gb (float), mem_mb (float)
        """
        resp = _docker_request("GET", f"/containers/{self.container}/json")
        if resp["status"] != 200:
            raise RuntimeError(
                f"Docker inspect failed: HTTP {resp['status']}  {resp['body']}"
            )
        host = resp["body"].get("HostConfig", {})
        nano  = host.get("NanoCpus", 0)
        mem   = host.get("Memory",   0)

        cpus   = round(nano / 1e9,       2) if nano > 0 else 0.0
        mem_gb = round(mem  / 1024 ** 3, 3) if mem  > 0 else 0.0
        return {"cpus": cpus, "mem_gb": mem_gb, "mem_mb": round(mem_gb * 1024, 1)}

    def apply(self, target_cpus: float, target_mem_gb: float) -> bool:
        """
        Apply new CPU and memory limits.

        Parameters
        ----------
        target_cpus   : desired CPU limit (e.g. 2.5)
        target_mem_gb : desired memory limit in GB (e.g. 2.0)

        Returns
        -------
        True if the update was applied and verified, False on failure.
        """
        # Clamp to hard limits — defence in depth
        cpus   = round(max(HARD_MIN_CPUS,   min(HARD_MAX_CPUS,   target_cpus)),   2)
        mem_gb = round(max(HARD_MIN_MEM_GB, min(HARD_MAX_MEM_GB, target_mem_gb)), 3)

        before = self.get_limits()

        # Skip if values are already correct (within float rounding)
        if abs(before["cpus"] - cpus) < 0.05 and abs(before["mem_gb"] - mem_gb) < 0.01:
            return True

        payload = {
            "NanoCpus"   : int(cpus * 1_000_000_000),
            "Memory"     : int(mem_gb * 1024 ** 3),
            "MemorySwap" : int(mem_gb * 1024 ** 3),  # disable swap = memory * 1
        }

        t0   = time.perf_counter()
        resp = _docker_request("POST",
                               f"/containers/{self.container}/update",
                               payload)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)

        if resp["status"] not in (200, 204):
            print(f"[updater] ERROR: Docker update failed — "
                  f"HTTP {resp['status']}  {resp['body']}")
            self._log(before, {"cpus": cpus, "mem_gb": mem_gb},
                      success=False, latency_ms=latency_ms)
            return False

        # Verify by reading back
        after = self.get_limits()
        success = (abs(after["cpus"] - cpus) < 0.05
                   and abs(after["mem_gb"] - mem_gb) < 0.01)

        self._log(before, after, success=success, latency_ms=latency_ms)

        if success:
            print(f"[updater] ✓  cpus {before['cpus']}→{after['cpus']}  "
                  f"mem {before['mem_gb']:.2f}→{after['mem_gb']:.2f}GB  "
                  f"({latency_ms}ms)")
        else:
            print(f"[updater] ✗  Update sent but verification failed — "
                  f"got cpus={after['cpus']} mem={after['mem_gb']}GB")
        return success

    def history(self) -> list[dict]:
        """Return the full audit log of all scaling events."""
        return list(self._history)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _log(self, before: dict, after: dict,
             success: bool, latency_ms: float):
        entry = {
            "ts"         : datetime.now(timezone.utc).isoformat(),
            "before_cpus": before["cpus"],
            "after_cpus" : after["cpus"],
            "before_mem" : before["mem_gb"],
            "after_mem"  : after["mem_gb"],
            "success"    : success,
            "latency_ms" : latency_ms,
        }
        self._history.append(entry)


# ── Quick self-test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Docker Updater self-test ===\n")

    u = DockerUpdater(container="erp_app")

    print("\n--- Reading current limits ---")
    limits = u.get_limits()
    print(f"cpus={limits['cpus']}  mem_gb={limits['mem_gb']}  mem_mb={limits['mem_mb']}")

    original_cpus   = limits["cpus"]   or 2.0
    original_mem_gb = limits["mem_gb"] or 2.0

    print("\n--- Test: scale up by 0.5 cpus ---")
    u.apply(target_cpus=original_cpus + 0.5, target_mem_gb=original_mem_gb)

    print("\n--- Test: restore original ---")
    u.apply(target_cpus=original_cpus, target_mem_gb=original_mem_gb)

    print(f"\nAudit log: {len(u.history())} entries")
    for e in u.history():
        print(f"  {e['ts']}  cpus {e['before_cpus']}→{e['after_cpus']}  "
              f"mem {e['before_mem']:.2f}→{e['after_mem']:.2f}GB  "
              f"ok={e['success']}  {e['latency_ms']}ms")

    print("\n✅  Docker updater test complete.")
