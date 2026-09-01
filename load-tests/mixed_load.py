"""
mixed_load.py — DOCKER-GENIUS Mixed-Tier Load Generator

Fires concurrent Tier-1 (POS checkout) and Tier-3 (bulk reports) requests
to prove resource contention and capture SLA violations.

Usage:
    python mixed_load.py --base-url http://localhost:3000 --duration 300 \
        --n-tier1 8 --n-tier3 3 --tier3-interval 8

The script:
  - Keeps N_TIER1 worker threads hammering POS checkout (Tier-1, target <150ms)
  - Runs N_TIER3 concurrent worker threads, each firing a Tier-3 bulk report
    (deliberately heavy — measured at 47-60s per call) every TIER3_INTERVAL
    seconds. A single sequential Tier-3 worker at a 20s interval only
    produces ~4 bursts in a 300s run and barely creates contention because
    Node's event loop isn't blocked waiting on MySQL I/O; running several
    of these concurrently is what actually saturates the shared container.
  - Prints a live table showing P50/P95/P99 by tier and SLA violation rate
  - Writes results to load_results.csv for analysis
"""

import argparse
import csv
import json
import os
import random
import sys
import threading
import time
from datetime import datetime, timezone
from statistics import median, quantiles

import requests

# ── Seed data (from demo_nexcore — TENANT_001 integer IDs) ───────────────────
PRODUCT_IDS = [
    646, 650, 654, 666, 682, 698, 713, 715,
    723, 732, 736, 745, 751, 760, 773, 775,
    780, 784, 787, 789,
]

TIER1_SLA_MS  = 150    # SLA threshold for POS (Tier-1)
N_TIER1       = 8      # concurrent Tier-1 worker threads
# Recalibrated after adding genuine CPU-bound work to bulk-generate
# (reports.service.ts's CPU_BURN_ITERATIONS) — earlier settings were tuned
# against a purely SQL-delegated "heavy" endpoint, which turned out to
# create contention in the MySQL container, not erp_app (the only
# container the governor monitors/scales; see NEXT_STEPS.md). With the
# CPU burn in place, Node's single-threaded event loop genuinely blocks
# during each Tier-3 call, so far fewer concurrent workers are needed.
# N_TIER3=3/interval=5 (33.6% breach in isolated validation) turned out to
# saturate the full 3-group harness to ~65-68% breach across ALL groups —
# too little headroom for any governance strategy to differentiate itself
# (see NEXT_STEPS.md §1e). This is quite sensitive to small changes
# (N_TIER3=3/interval=6 alone gave 38.2%, N_TIER3=2/interval=3 gave 55.6%)
# — N_TIER3=2/interval=4 was the calibration point landing in a moderate,
# differentiable 15-30% range (measured 17.8% in isolation).
N_TIER3       = 2      # concurrent Tier-3 burst workers
TIER3_INTERVAL = 4     # seconds each Tier-3 worker waits between its own bursts
PRINT_INTERVAL = 5     # seconds between stats printout

# ── Shared state ─────────────────────────────────────────────────────────────
results_lock  = threading.Lock()
results: list[dict] = []
stop_event    = threading.Event()
token_holder  = {"token": None}

# ── Auth ─────────────────────────────────────────────────────────────────────

def login(base: str, max_attempts: int = 5) -> str:
    """
    Retries with backoff. A prior group's heavy Tier-3 queries (measured at
    100+ seconds each) can still be draining server/DB capacity when the
    next group starts — a single 10s-timeout attempt failing outright used
    to abort the whole load run (and the harness would then silently report
    stale leftover KPI data instead of a real failure). Retrying gives the
    backend time to actually clear before we give up.
    """
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            resp = requests.post(f"{base}/api/auth/login",
                                 json={"email": "admin@colomboretail.lk", "password": "test123"},
                                 timeout=20)
            resp.raise_for_status()
            token = resp.json().get("access_token") or resp.json().get("token")
            if not token:
                raise ValueError(f"No token in response: {resp.json()}")
            return token
        except Exception as e:
            last_err = e
            wait_s = min(5 * attempt, 20)
            print(f"[load-gen] Login attempt {attempt}/{max_attempts} failed: {e} "
                  f"— retrying in {wait_s}s", file=sys.stderr)
            time.sleep(wait_s)
    raise RuntimeError(f"Login failed after {max_attempts} attempts: {last_err}")

def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# ── POS session helper ────────────────────────────────────────────────────────

_session_lock = threading.Lock()
_pos_session  = {"id": None}

def get_or_create_pos_session(base: str, token: str) -> str:
    with _session_lock:
        if _pos_session["id"]:
            return _pos_session["id"]
        resp = requests.get(f"{base}/api/pos/sessions/current",
                            headers=headers(token), timeout=5)
        if resp.status_code == 200 and resp.json().get("id"):
            _pos_session["id"] = resp.json()["id"]
        else:
            resp2 = requests.post(f"{base}/api/pos/sessions",
                                  headers=headers(token),
                                  json={"openingCash": 0},
                                  timeout=5)
            resp2.raise_for_status()
            _pos_session["id"] = resp2.json()["id"]
        return _pos_session["id"]

# ── Tier-1 worker — POS checkout ─────────────────────────────────────────────

def tier1_worker(base: str, worker_id: int):
    token = token_holder["token"]
    session_id = get_or_create_pos_session(base, token)

    while not stop_event.is_set():
        n_items = random.randint(1, 4)
        items   = [
            {"productId": random.choice(PRODUCT_IDS),
             "quantity": random.randint(1, 3),
             "unitPrice": round(random.uniform(100, 5000), 2)}
            for _ in range(n_items)
        ]
        total   = sum(i["quantity"] * i["unitPrice"] for i in items)
        payload = {
            "sessionId"     : session_id,
            "items"         : items,
            "discountAmount": 0,
            "payments"      : [{"paymentMethodId": 1, "amount": round(total, 2)}],
        }

        t0 = time.perf_counter()
        try:
            # A 5s timeout here used to censor the tail: under real
            # contention ~4.3% of requests were hitting that ceiling and
            # getting recorded at exactly ~5000ms regardless of how much
            # longer they'd actually have taken, which flattened the P95/P99
            # comparison across all three experiment groups identically (see
            # NEXT_STEPS.md §1c / §2 bug #9). 25s lets genuine tail latency
            # up to that point actually be measured instead of clipped.
            resp = requests.post(f"{base}/api/pos/checkout",
                                 headers=headers(token),
                                 json=payload, timeout=25)
            latency_ms = (time.perf_counter() - t0) * 1000
            status     = resp.status_code
        except requests.exceptions.RequestException as e:
            latency_ms = (time.perf_counter() - t0) * 1000
            status     = 0

        row = {
            "ts"         : datetime.now(timezone.utc).isoformat(),
            "tier"       : "TIER_1",
            "endpoint"   : "/api/pos/checkout",
            "latency_ms" : round(latency_ms, 2),
            "status"     : status,
            "sla_breach" : 1 if latency_ms > TIER1_SLA_MS else 0,
        }
        with results_lock:
            results.append(row)

        # small think-time between checkouts (realistic cashier speed)
        time.sleep(random.uniform(0.05, 0.2))

# ── Tier-3 burst — bulk report ────────────────────────────────────────────────

def tier3_burst(base: str, worker_id: int = 0, interval: int = TIER3_INTERVAL):
    token = token_holder["token"]
    # Stagger workers so N concurrent bursts don't all start in lockstep —
    # spreads sustained overlapping load across the run instead of one
    # synchronized spike every `interval` seconds.
    stop_event.wait(timeout=worker_id * (interval / max(N_TIER3, 1)))
    while not stop_event.is_set():
        time.sleep(interval)
        if stop_event.is_set():
            break

        t0 = time.perf_counter()
        try:
            resp = requests.post(f"{base}/api/reports/bulk-generate",
                                 headers=headers(token),
                                 json={"research_mode": True},
                                 timeout=180)
            latency_ms = (time.perf_counter() - t0) * 1000
            status     = resp.status_code
        except requests.exceptions.RequestException:
            latency_ms = (time.perf_counter() - t0) * 1000
            status     = 0

        row = {
            "ts"         : datetime.now(timezone.utc).isoformat(),
            "tier"       : "TIER_3",
            "endpoint"   : "/api/reports/bulk-generate",
            "latency_ms" : round(latency_ms, 2),
            "status"     : status,
            "sla_breach" : 0,
        }
        with results_lock:
            results.append(row)
        print(f"\n[TIER-3 burst w{worker_id}] bulk-generate completed in "
              f"{latency_ms:.0f}ms (status {status})")

# ── Stats printer ─────────────────────────────────────────────────────────────

def stats_printer(duration: int, start: float):
    while not stop_event.is_set():
        time.sleep(PRINT_INTERVAL)
        elapsed = time.perf_counter() - start

        with results_lock:
            snap = list(results)

        t1 = [r["latency_ms"] for r in snap if r["tier"] == "TIER_1"]
        t3 = [r["latency_ms"] for r in snap if r["tier"] == "TIER_3"]
        breaches  = sum(r["sla_breach"] for r in snap if r["tier"] == "TIER_1")
        breach_pct = (breaches / len(t1) * 100) if t1 else 0

        def pct(data, p):
            if not data: return 0
            return quantiles(sorted(data), n=100)[p-1] if len(data) >= 100 else max(data)

        print(f"\n{'─'*60}")
        print(f"  Elapsed: {elapsed:.0f}s / {duration}s")
        print(f"  Tier-1 (POS)    — n={len(t1):4d}  "
              f"P50={median(t1) if t1 else 0:6.0f}ms  "
              f"P95={pct(t1,95):6.0f}ms  "
              f"P99={pct(t1,99):6.0f}ms  "
              f"SLA breaches: {breaches} ({breach_pct:.1f}%)")
        print(f"  Tier-3 (Reports)— n={len(t3):4d}  "
              f"P50={median(t3) if t3 else 0:6.0f}ms  "
              f"P95={pct(t3,95):6.0f}ms")
        sla_color = "🔴" if breach_pct > 5 else ("🟡" if breach_pct > 1 else "🟢")
        print(f"  SLA status: {sla_color}  ({TIER1_SLA_MS}ms threshold)")
        print(f"{'─'*60}", flush=True)

# ── Main ──────────────────────────────────────────────────────────────────────

def run(base: str, duration: int, output: str,
        n_tier1: int = N_TIER1, n_tier3: int = N_TIER3,
        tier3_interval: int = TIER3_INTERVAL):
    global N_TIER1, N_TIER3, TIER3_INTERVAL
    N_TIER1, N_TIER3, TIER3_INTERVAL = n_tier1, n_tier3, tier3_interval

    print(f"[load-gen] Logging in to {base}...")
    try:
        token_holder["token"] = login(base)
        print(f"[load-gen] Authenticated OK")
    except Exception as e:
        print(f"[load-gen] Login failed: {e}", file=sys.stderr)
        sys.exit(1)

    get_or_create_pos_session(base, token_holder["token"])
    print(f"[load-gen] POS session ready — {_pos_session['id']}")
    print(f"[load-gen] Starting {N_TIER1} Tier-1 workers + "
          f"{N_TIER3} Tier-3 burst workers (interval={TIER3_INTERVAL}s each)")
    print(f"[load-gen] Running for {duration}s — output: {output}\n")

    start        = time.perf_counter()
    tier1_threads = []
    tier3_threads = []

    for i in range(N_TIER1):
        t = threading.Thread(target=tier1_worker, args=(base, i), daemon=True)
        t.start(); tier1_threads.append(t)

    for i in range(N_TIER3):
        t3 = threading.Thread(target=tier3_burst, args=(base, i, TIER3_INTERVAL),
                              daemon=True)
        t3.start(); tier3_threads.append(t3)

    sp = threading.Thread(target=stats_printer, args=(duration, start), daemon=True)
    sp.start()

    try:
        time.sleep(duration)
    except KeyboardInterrupt:
        print("\n[load-gen] Interrupted")

    stop_event.set()

    # Tier-1 workers stop within one think-time cycle (<0.2s) — a short join
    # is enough. Tier-3 workers are a different story: bulk-generate calls
    # measured at 100-125s. A daemon thread that gets abandoned here does NOT
    # stop the server from continuing to execute that query — it just makes
    # this process blind to when it finishes, so the NEXT group's cooldown
    # and health check silently start against a still-saturated backend
    # (this caused real login/pool failures in earlier runs). Join with a
    # generous timeout so the process — and therefore the harness's next
    # group — only proceeds once in-flight Tier-3 work has actually drained.
    for t in tier1_threads:
        t.join(timeout=5)
    print("[load-gen] Waiting for in-flight Tier-3 bursts to finish "
          "(measured up to ~125s each)…")
    for t in tier3_threads:
        t.join(timeout=180)
        if t.is_alive():
            print(f"[load-gen] WARNING: a Tier-3 worker did not finish within "
                  f"180s — its request may still be running server-side.",
                  file=sys.stderr)

    # ── Write results CSV ────────────────────────────────────────────────────
    with open(output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ts","tier","endpoint","latency_ms","status","sla_breach"])
        writer.writeheader()
        with results_lock:
            writer.writerows(results)

    with results_lock:
        snap = list(results)

    t1 = [r["latency_ms"] for r in snap if r["tier"] == "TIER_1"]
    breaches = sum(r["sla_breach"] for r in snap if r["tier"] == "TIER_1")

    print(f"\n{'═'*60}")
    print(f"  FINAL SUMMARY")
    print(f"  Total Tier-1 requests : {len(t1)}")
    print(f"  SLA violations (>{TIER1_SLA_MS}ms): {breaches} ({breaches/len(t1)*100:.1f}%)" if t1 else "")
    print(f"  Results saved to: {output}")
    print(f"{'═'*60}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS mixed-tier load generator")
    ap.add_argument("--base-url",  default="http://localhost:3000")
    ap.add_argument("--duration",  default=300, type=int, help="Run duration in seconds")
    ap.add_argument("--output",    default="load_results.csv")
    ap.add_argument("--n-tier1",   default=N_TIER1, type=int,
                     help="Concurrent Tier-1 (POS) worker threads")
    ap.add_argument("--n-tier3",   default=N_TIER3, type=int,
                     help="Concurrent Tier-3 (bulk report) burst workers")
    ap.add_argument("--tier3-interval", default=TIER3_INTERVAL, type=int,
                     help="Seconds each Tier-3 worker waits between its own bursts")
    args = ap.parse_args()
    run(args.base_url, args.duration, args.output,
        n_tier1=args.n_tier1, n_tier3=args.n_tier3,
        tier3_interval=args.tier3_interval)
