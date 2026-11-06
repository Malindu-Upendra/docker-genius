"""
mixed_load.py — DOCKER-GENIUS Mixed-Tier Load Generator

Fires concurrent Tier-1 (POS checkout) and Tier-3 (bulk reports) requests
to prove resource contention and capture SLA violations.

Usage:
    python mixed_load.py --base-url http://localhost:3000 --duration 300 \
        --tier1-rate 10 --n-tier3 2 --tier3-interval 4

The script:
  - Fires Tier-1 (POS checkout, target <150ms) requests as an OPEN-LOOP
    Poisson arrival process at a fixed mean rate (--tier1-rate req/s).
    Each arrival is dispatched on its own short-lived thread so a slow
    request cannot delay when the NEXT arrival fires — arrivals are
    generated on a fixed schedule independent of how fast the server is
    responding. This avoids "coordinated omission": a closed-loop
    generator (a fixed pool of workers that each wait for their own
    response before sending the next request) self-throttles exactly
    when the server is slow, which hides queueing-induced tail latency
    and couples throughput to latency by construction (review item B5).
    Latency is measured from the request's INTENDED scheduled send time,
    not from when the thread actually got to run it (review item B6),
    so queueing delay under overload is counted, not hidden.
  - Optionally duty-cycles Tier-1 traffic on/off (--tier1-active-s /
    --tier1-idle-s) so the semantic layer's "TIER_1 active in the last
    60s" gate can actually take both values within a run — with
    continuous Tier-1 traffic the gate is true by construction for the
    entire run (review item B4). Default is continuous (no idle phase),
    matching prior behaviour, unless --tier1-idle-s > 0 is passed.
  - Runs N_TIER3 concurrent worker threads, each firing a Tier-3 bulk
    report (deliberately heavy — measured at 47-60s per call) every
    TIER3_INTERVAL seconds. A single sequential Tier-3 worker at a 20s
    interval only produces ~4 bursts in a 300s run and barely creates
    contention because Node's event loop isn't blocked waiting on MySQL
    I/O; running several of these concurrently is what actually
    saturates the shared container.
  - Prints a live table showing P50/P95/P99 by tier and SLA violation rate
  - Writes results to load_results.csv for analysis, including both
    intended-send-time and actual-send-time latency for Tier-1, and the
    HTTP status / connection-error code for every request (review item
    B11 — 0 = connection error/timeout, otherwise the HTTP status code,
    so availability can be computed from the KPI CSV without rerunning).
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

TIER1_SLA_MS   = 150    # SLA threshold for POS (Tier-1)
TIER1_RATE_RPS = 10.0   # open-loop mean arrival rate for Tier-1 (req/s)
TIER1_ACTIVE_S = None   # None/0 → continuous for the whole run (no idle phase)
TIER1_IDLE_S   = 0      # seconds Tier-1 goes silent each duty cycle (review B4)

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
# Off by default -- only for the illustrative OOM/pod-restart demo scenario,
# never for any statistically-reported experiment. Independent of
# research_mode, so enabling it cannot affect any already-reported result.
STRESS_MEMORY = os.environ.get("DG_STRESS_MEMORY", "0") == "1"
# Off by default -- routes the research-mode CPU burn onto a worker thread
# (see cpu-burn-pool.ts / review item #7) instead of blocking the main
# event loop. Independent of research_mode's own on/off state.
ISOLATE_TIER3 = os.environ.get("DG_ISOLATE_TIER3", "0") == "1"
PRINT_INTERVAL = 5     # seconds between stats printout

# ── Shared state ─────────────────────────────────────────────────────────────
results_lock  = threading.Lock()
results: list[dict] = []
stop_event    = threading.Event()
token_holder  = {"token": None}
dispatch_lock = threading.Lock()
_dispatch_count = {"n": 0}

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

# ── Tier-1 — open-loop Poisson arrivals ───────────────────────────────────────

def _fire_tier1_request(base: str, token: str, session_id: str, intended_ts: float,
                          wall_intended: str):
    """Sends one POS checkout request. `intended_ts` is the perf_counter()
    value this arrival was SCHEDULED for; latency is measured against it
    (not against when this thread actually started), so dispatch jitter and
    queueing delay under overload are counted as latency rather than
    hidden (review items B5/B6)."""
    actual_send = time.perf_counter()
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

    try:
        # A 5s timeout here used to censor the tail: under real contention
        # ~4.3% of requests were hitting that ceiling and getting recorded
        # at exactly ~5000ms regardless of how much longer they'd actually
        # have taken, which flattened the P95/P99 comparison across all
        # three experiment groups identically (see NEXT_STEPS.md §1c / §2
        # bug #9). 25s lets genuine tail latency up to that point actually
        # be measured instead of clipped.
        resp = requests.post(f"{base}/api/pos/checkout",
                             headers=headers(token),
                             json=payload, timeout=25)
        completed    = time.perf_counter()
        status       = resp.status_code
    except requests.exceptions.RequestException:
        completed    = time.perf_counter()
        status       = 0   # connection error / timeout (review B11)

    latency_ms_intended = (completed - intended_ts) * 1000
    latency_ms_actual   = (completed - actual_send) * 1000

    row = {
        "ts"                  : datetime.now(timezone.utc).isoformat(),
        "tier"                : "TIER_1",
        "endpoint"            : "/api/pos/checkout",
        "intended_send_ts"    : wall_intended,
        "latency_ms"          : round(latency_ms_intended, 2),   # primary metric (B6)
        "latency_ms_actual_send": round(latency_ms_actual, 2),   # for comparison only
        "status"              : status,
        "sla_breach"          : 1 if latency_ms_intended > TIER1_SLA_MS else 0,
    }
    with results_lock:
        results.append(row)


def tier1_dispatcher(base: str, rate_rps: float, active_s: float | None, idle_s: float):
    """Open-loop Poisson arrival generator for Tier-1. Schedules the next
    arrival's fire time by drawing from Exp(rate_rps) regardless of whether
    the previous arrival's request has completed — each arrival is handed
    to its own thread immediately (fire-and-forget), so slow responses
    cannot delay subsequent arrivals (unlike a closed-loop pool of workers
    that each wait for their own response before sending the next one)."""
    token = token_holder["token"]
    session_id = get_or_create_pos_session(base, token)

    cycle = (active_s + idle_s) if (idle_s and idle_s > 0) else None
    t_start = time.perf_counter()
    next_fire = t_start

    while not stop_event.is_set():
        now = time.perf_counter()

        if cycle:
            phase = (now - t_start) % cycle
            if phase >= active_s:
                # Idle phase of the duty cycle — no Tier-1 arrivals, so the
                # semantic layer's "TIER_1 active in the last 60s" gate can
                # actually go false during a run (review item B4).
                sleep_for = min(cycle - phase, 1.0)
                if stop_event.wait(timeout=sleep_for):
                    break
                continue

        if now >= next_fire:
            with dispatch_lock:
                _dispatch_count["n"] += 1
            wall_intended = datetime.now(timezone.utc).isoformat()
            threading.Thread(
                target=_fire_tier1_request,
                args=(base, token, session_id, next_fire, wall_intended),
                daemon=True,
            ).start()
            next_fire += random.expovariate(rate_rps)
        else:
            if stop_event.wait(timeout=min(next_fire - now, 0.01)):
                break

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
            payload = {"research_mode": True}
            if STRESS_MEMORY:
                payload["stress_memory"] = True
            if ISOLATE_TIER3:
                payload["isolate_tier3"] = True
            resp = requests.post(f"{base}/api/reports/bulk-generate",
                                 headers=headers(token),
                                 json=payload,
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
            "intended_send_ts": "",
            "latency_ms" : round(latency_ms, 2),
            "latency_ms_actual_send": round(latency_ms, 2),
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
        errors_t1 = sum(1 for r in snap if r["tier"] == "TIER_1" and r["status"] not in (200, 201))

        def pct(data, p):
            if not data: return 0
            return quantiles(sorted(data), n=100)[p-1] if len(data) >= 100 else max(data)

        print(f"\n{'─'*60}")
        print(f"  Elapsed: {elapsed:.0f}s / {duration}s")
        print(f"  Tier-1 (POS)    — n={len(t1):4d}  "
              f"P50={median(t1) if t1 else 0:6.0f}ms  "
              f"P95={pct(t1,95):6.0f}ms  "
              f"P99={pct(t1,99):6.0f}ms  "
              f"SLA breaches: {breaches} ({breach_pct:.1f}%)  "
              f"non-2xx/errors: {errors_t1}")
        print(f"  Tier-3 (Reports)— n={len(t3):4d}  "
              f"P50={median(t3) if t3 else 0:6.0f}ms  "
              f"P95={pct(t3,95):6.0f}ms")
        sla_color = "🔴" if breach_pct > 5 else ("🟡" if breach_pct > 1 else "🟢")
        print(f"  SLA status: {sla_color}  ({TIER1_SLA_MS}ms threshold)")
        print(f"{'─'*60}", flush=True)

# ── Main ──────────────────────────────────────────────────────────────────────

def run(base: str, duration: int, output: str,
        tier1_rate: float = TIER1_RATE_RPS,
        tier1_active_s: float | None = TIER1_ACTIVE_S,
        tier1_idle_s: float = TIER1_IDLE_S,
        n_tier3: int = N_TIER3,
        tier3_interval: int = TIER3_INTERVAL, seed: int | None = None):
    global N_TIER3, TIER3_INTERVAL
    N_TIER3, TIER3_INTERVAL = n_tier3, tier3_interval

    if tier1_active_s is None:
        tier1_active_s = duration  # continuous for the whole run by default

    if seed is not None:
        # Seeds the shared global RNG before any worker thread starts, so a
        # given seed reproduces the same statistical mix of item counts,
        # products, quantities, prices AND arrival timing across
        # conditions/replicates. Thread scheduling still interleaves
        # individual calls non-deterministically, so this pairs workloads
        # distributionally, not as a byte-identical request sequence.
        random.seed(seed)
        print(f"[load-gen] Workload seed: {seed}")

    print(f"[load-gen] Logging in to {base}...")
    try:
        token_holder["token"] = login(base)
        print(f"[load-gen] Authenticated OK")
    except Exception as e:
        print(f"[load-gen] Login failed: {e}", file=sys.stderr)
        sys.exit(1)

    get_or_create_pos_session(base, token_holder["token"])
    print(f"[load-gen] POS session ready — {_pos_session['id']}")
    tier1_desc = (f"Tier-1 open-loop @ {tier1_rate} req/s "
                  f"(continuous)" if tier1_idle_s <= 0 else
                  f"Tier-1 open-loop @ {tier1_rate} req/s "
                  f"(duty cycle: {tier1_active_s}s on / {tier1_idle_s}s off)")
    print(f"[load-gen] Starting {tier1_desc} + "
          f"{N_TIER3} Tier-3 burst workers (interval={TIER3_INTERVAL}s each)")
    print(f"[load-gen] Running for {duration}s — output: {output}\n")

    start        = time.perf_counter()
    tier3_threads = []

    dispatcher = threading.Thread(
        target=tier1_dispatcher, args=(base, tier1_rate, tier1_active_s, tier1_idle_s),
        daemon=True, name="tier1-dispatcher")
    dispatcher.start()

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

    # The dispatcher stops scheduling new arrivals promptly. In-flight
    # Tier-1 request threads are short (<25s timeout) so a brief join is
    # enough. Tier-3 workers are a different story: bulk-generate calls
    # measured at 100-125s. A daemon thread that gets abandoned here does NOT
    # stop the server from continuing to execute that query — it just makes
    # this process blind to when it finishes, so the NEXT group's cooldown
    # and health check silently start against a still-saturated backend
    # (this caused real login/pool failures in earlier runs). Join with a
    # generous timeout so the process — and therefore the harness's next
    # group — only proceeds once in-flight Tier-3 work has actually drained.
    dispatcher.join(timeout=5)
    time.sleep(26)  # drain window for the last fire-and-forget Tier-1 requests (25s timeout each)
    print("[load-gen] Waiting for in-flight Tier-3 bursts to finish "
          "(measured up to ~125s each)…")
    for t in tier3_threads:
        t.join(timeout=180)
        if t.is_alive():
            print(f"[load-gen] WARNING: a Tier-3 worker did not finish within "
                  f"180s — its request may still be running server-side.",
                  file=sys.stderr)

    # ── Write results CSV ────────────────────────────────────────────────────
    fieldnames = ["ts", "tier", "endpoint", "intended_send_ts", "latency_ms",
                  "latency_ms_actual_send", "status", "sla_breach"]
    with open(output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        with results_lock:
            writer.writerows(results)

    with results_lock:
        snap = list(results)

    t1 = [r["latency_ms"] for r in snap if r["tier"] == "TIER_1"]
    breaches = sum(r["sla_breach"] for r in snap if r["tier"] == "TIER_1")
    errors_t1 = sum(1 for r in snap if r["tier"] == "TIER_1" and r["status"] not in (200, 201))

    print(f"\n{'═'*60}")
    print(f"  FINAL SUMMARY")
    print(f"  Total Tier-1 requests : {len(t1)}")
    print(f"  SLA violations (>{TIER1_SLA_MS}ms): {breaches} ({breaches/len(t1)*100:.1f}%)" if t1 else "")
    print(f"  Non-2xx / connection errors (Tier-1): {errors_t1}")
    print(f"  Results saved to: {output}")
    print(f"{'═'*60}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS mixed-tier load generator")
    ap.add_argument("--base-url",  default="http://localhost:3000")
    ap.add_argument("--duration",  default=300, type=int, help="Run duration in seconds")
    ap.add_argument("--output",    default="load_results.csv")
    ap.add_argument("--tier1-rate", default=TIER1_RATE_RPS, type=float,
                     help="Open-loop Tier-1 mean arrival rate (requests/sec)")
    ap.add_argument("--tier1-active-s", default=None, type=float,
                     help="Seconds of Tier-1 traffic per duty cycle (default: whole run)")
    ap.add_argument("--tier1-idle-s", default=TIER1_IDLE_S, type=float,
                     help="Seconds of NO Tier-1 traffic per duty cycle (0 = continuous)")
    ap.add_argument("--n-tier3",   default=N_TIER3, type=int,
                     help="Concurrent Tier-3 (bulk report) burst workers")
    ap.add_argument("--tier3-interval", default=TIER3_INTERVAL, type=int,
                     help="Seconds each Tier-3 worker waits between its own bursts")
    ap.add_argument("--seed", default=None, type=int,
                     help="Seed the workload RNG for reproducible/paired runs across conditions")
    args = ap.parse_args()
    run(args.base_url, args.duration, args.output,
        tier1_rate=args.tier1_rate,
        tier1_active_s=args.tier1_active_s,
        tier1_idle_s=args.tier1_idle_s,
        n_tier3=args.n_tier3,
        tier3_interval=args.tier3_interval, seed=args.seed)
