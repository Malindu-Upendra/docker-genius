"""
run_scalability_test.py — DOCKER-GENIUS Scalability Test (NEXT_STEPS.md §8)

Runs one tenant's full governance loop (proactive hybrid) against its own
independent erp_app + MySQL stack, for use as ONE of two OS-level processes
launched concurrently (--tenant 1 against the primary stack, --tenant 2
against docker-compose.tenant2.yml's mysql-2/erp-app-2) — never import this
module twice in one interpreter, since CONTAINER/DB_CONFIG in governor_loop
are read from DG_CONTAINER/DG_DB_PORT at *module import time*, so two
GovernorLoop instances in the same process would share one tenant's config.

This intentionally does NOT replicate run_experiment.py's 3-group design or
its 5x-replication harness — the scalability test is a single-run, small-n
correctness + overhead check (see NEXT_STEPS.md §8), not a new statistical
claim about governance effectiveness. It reuses run_experiment.py's proven
mixed_load.py load generator, but manages its own tenant-specific container,
DB connection, and result paths.

Usage (run as two separate, concurrent processes):
    python3 experiment/run_scalability_test.py --tenant 1 --duration 300 &
    python3 experiment/run_scalability_test.py --tenant 2 --duration 300 &
    wait

Outputs (written to experiment/scalability_results/):
    tenant{1,2}_kpi.csv        — per-request TIER_1/TIER_3 KPIs (from mixed_load.py)
    tenant{1,2}_governor.csv   — per-cycle governor decisions + cycle_ms timing
"""

from __future__ import annotations

import argparse
import os
import sys

# ── Tenant selection must happen BEFORE importing governor_loop, since that
#    module reads DG_CONTAINER / DG_DB_PORT into module-level globals at
#    import time (see governor_loop.py's CONTAINER / DB_CONFIG). ──
_pre = argparse.ArgumentParser(add_help=False)
_pre.add_argument("--tenant", type=int, choices=[1, 2], required=True)
_tenant_id = _pre.parse_known_args()[0].tenant

TENANTS = {
    1: {"container": "erp_app",   "db_port": 3307, "base_url": "http://localhost:3000"},
    2: {"container": "erp_app_2", "db_port": 3309, "base_url": "http://localhost:3001"},
}
_cfg = TENANTS[_tenant_id]
os.environ["DG_CONTAINER"] = _cfg["container"]
os.environ["DG_DB_PORT"]   = str(_cfg["db_port"])

import csv
import subprocess
import time
from pathlib import Path

import mysql.connector
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from docker_api.updater       import DockerUpdater
from experiment.governor_loop import GovernorLoop

BASELINE_CPUS   = 2.0
BASELINE_MEM_GB = 2.0
LOAD_SCRIPT = str(
    Path(__file__).parent.parent.parent / "load-tests" / "mixed_load.py"
)
RESULTS_DIR = Path(__file__).parent / "scalability_results"

DB_CONFIG = {
    "host"    : "localhost",
    "port"    : _cfg["db_port"],
    "user"    : "root",
    "password": "rootpassword",
    "database": "demo_nexcore",
}


def _db_conn():
    return mysql.connector.connect(**DB_CONFIG)


def wait_for_healthy(base_url: str, timeout: int = 180, poll_interval: float = 3.0) -> None:
    """Same real-login healthcheck as run_experiment.py, parametrised per tenant."""
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            r = requests.post(f"{base_url}/api/auth/login",
                               json={"email": "admin@colomboretail.lk",
                                     "password": "test123"},
                               timeout=5)
            if r.status_code < 300:
                return
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last_err = str(e)
        time.sleep(poll_interval)
    raise RuntimeError(f"[tenant{_tenant_id}] {base_url} never became healthy: {last_err}")


def clear_request_logs():
    """Best-effort — a failure here shouldn't abort the whole test."""
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute("TRUNCATE TABLE semantic_request_logs")
        conn.commit()
        cur.close(); conn.close()
    except Exception as e:
        print(f"[tenant{_tenant_id}] semantic_request_logs clear skipped: {e}")


def main():
    ap = argparse.ArgumentParser(parents=[_pre], description=__doc__)
    ap.add_argument("--duration", type=int, default=300)
    args = ap.parse_args()

    RESULTS_DIR.mkdir(exist_ok=True)
    tag = f"tenant{_tenant_id}"

    updater = DockerUpdater(_cfg["container"])
    print(f"[{tag}] resetting {_cfg['container']} -> "
          f"{BASELINE_CPUS} cpus / {BASELINE_MEM_GB}GB")
    updater.apply(BASELINE_CPUS, BASELINE_MEM_GB)

    print(f"[{tag}] waiting for {_cfg['base_url']} to become healthy...")
    wait_for_healthy(_cfg["base_url"])
    clear_request_logs()

    governor = GovernorLoop(mode="proactive")
    governor.start()

    kpi_path = RESULTS_DIR / f"{tag}_kpi.csv"
    print(f"[{tag}] launching load generator against {_cfg['base_url']} "
          f"for {args.duration}s -> {kpi_path}")
    load_proc = subprocess.Popen(
        [sys.executable, LOAD_SCRIPT,
         "--base-url", _cfg["base_url"],
         "--duration", str(args.duration),
         "--output", str(kpi_path)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    for line in load_proc.stdout:
        print(f"[{tag}][load] {line}", end="")
    ret = load_proc.wait(timeout=args.duration + 220)

    governor.stop()

    gov_path = RESULTS_DIR / f"{tag}_governor.csv"
    decisions = governor.decisions()
    if decisions:
        with open(gov_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(decisions[0].keys()))
            w.writeheader()
            w.writerows(decisions)
    print(f"[{tag}] governor log -> {gov_path} ({len(decisions)} cycles)")

    updater.apply(BASELINE_CPUS, BASELINE_MEM_GB)

    if ret != 0:
        print(f"[{tag}] WARNING: load generator exited with code {ret}")
        sys.exit(1)


if __name__ == "__main__":
    main()
