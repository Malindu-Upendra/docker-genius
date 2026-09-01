"""
rule_engine.py — DOCKER-GENIUS Governance Rule Engine

Combines LSTM forecast + real-time semantic tier activity from the DB to
produce scaling decisions passed to the Docker Update API.

Four governance rules (from the research design):

  Rule 1 — Proactive CPU Scale-Up
      Trigger : LSTM peak_cpu_pct > CPU_HIGH  AND  TIER_1 is actively arriving
      Action  : increase cpus by CPU_STEP, up to MAX_CPUS
      Rationale: Pre-scale before the spike hits POS checkout latency

  Rule 2 — Proactive Memory Scale-Up
      Trigger : LSTM peak_mem_mb > MEM_HIGH_MB  (regardless of tier)
      Action  : increase memory by MEM_STEP_MB, up to MAX_MEM_GB
      Rationale: Prevent OOM kills which terminate all tenants instantly

  Rule 3 — CPU Cooldown (Scale-Down)
      Trigger : mean_cpu_pct (forecast or current) < CPU_LOW
                AND no TIER_1 SLA breach in the last window
                AND cooldown counter exhausted
      Action  : decrease cpus by CPU_STEP, down to MIN_CPUS
      Rationale: Return headroom to the host; avoid wasting cores

  Rule 4 — Memory Cooldown (Scale-Down)
      Trigger : mean_mem_mb < MEM_LOW_MB
                AND no TIER_1 SLA breach in the last window
                AND cooldown counter exhausted
      Action  : decrease memory by MEM_STEP_MB, down to MIN_MEM_GB
      Rationale: Return memory to the host pool

Supports two operating modes (set via RuleEngine.mode):
  "proactive"  — uses LSTM forecast  (Group 3 — full DOCKER-GENIUS)
  "reactive"   — ignores forecast, uses current observed values only
                 (Group 2 — reactive-only baseline)

Usage:
    from rule_engine.rule_engine import RuleEngine
    engine = RuleEngine(mode="proactive")
    decision = engine.evaluate(forecast=pred.predict(),
                                current_cpu=45.2,
                                current_mem_mb=820.0,
                                current_cpus=2.0,
                                current_mem_gb=2.0)
    if decision.action != "none":
        print(decision)
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

# ── Governance thresholds ─────────────────────────────────────────────────────
# CPU_STEP/MEM_STEP_MB/COOLDOWN_CYCLES are env-overridable (no rebuild needed —
# this module runs in the host venv, not the erp_app container) specifically to
# support the rule-engine sensitivity sweep in NEXT_STEPS.md §5 item 3: §1e/§1f
# found Proactive Hybrid's ranking against Reactive-Only flips between load
# regimes, and one hypothesis is that the default small step/long cooldown
# reacts too slowly relative to how fast conditions actually change.
CPU_HIGH      = 75.0    # % — trigger scale-up
CPU_LOW       = 25.0    # % — trigger scale-down
MEM_HIGH_PCT  = 78.0    # % of current limit — trigger memory scale-up
MEM_LOW_PCT   = 38.0    # % of current limit — trigger memory scale-down

CPU_STEP      = float(os.environ.get("DG_CPU_STEP", 0.5))     # cores added/removed per scaling event
MEM_STEP_MB   = float(os.environ.get("DG_MEM_STEP_MB", 512))  # MB  added/removed per scaling event

MIN_CPUS      = 1.0     # absolute floor
MAX_CPUS      = 4.0     # absolute ceiling (matches research VM spec)
MIN_MEM_GB    = 1.0     # absolute floor
MAX_MEM_GB    = 6.0     # absolute ceiling

COOLDOWN_CYCLES = int(os.environ.get("DG_COOLDOWN_CYCLES", 6))  # scale-down
                        # cycles to wait after any scale event (prevents
                        # oscillation; ~60s at 10s governor interval by default)

TIER1_WINDOW_S  = 60    # seconds of recent history to check for TIER_1 activity
TIER1_SLA_MS    = 150   # SLA threshold — breaches block scale-down

# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class TierStats:
    tier1_rps         : float = 0.0   # requests/sec in the last window
    tier1_breach_count: int   = 0     # SLA breaches in the last window
    tier3_rps         : float = 0.0

@dataclass
class ScalingDecision:
    action         : str   = "none"   # "scale_up_cpu" | "scale_up_mem" |
                                      # "scale_down_cpu" | "scale_down_mem" | "none"
    target_cpus    : float = 0.0
    target_mem_gb  : float = 0.0
    triggered_rule : str   = ""       # e.g. "Rule 1 — Proactive CPU Scale-Up"
    reason         : str   = ""       # human-readable reason (for thesis logging)
    ts             : str   = field(default_factory=lambda:
                                   datetime.now(timezone.utc).isoformat())

    def __str__(self):
        if self.action == "none":
            return f"[engine] No action — {self.reason}"
        return (f"[engine] {self.triggered_rule}\n"
                f"         Action : {self.action}\n"
                f"         CPUs   : {self.target_cpus}  |  "
                f"Memory : {self.target_mem_gb:.2f} GB\n"
                f"         Reason : {self.reason}")


# ── Rule Engine ───────────────────────────────────────────────────────────────

class RuleEngine:
    """
    Stateful governance engine — maintains cooldown counters and
    optionally queries the DB for semantic tier statistics.

    Parameters
    ----------
    mode : "proactive" | "reactive"
        proactive — uses LSTM forecast (Group 3)
        reactive  — ignores forecast, uses current observed values (Group 2)
    db_config : dict | None
        MySQL connection kwargs. If None, tier DB queries are skipped
        and tier stats default to zero (safe degraded mode).
    semantic_aware : bool
        True  — Rule 1 requires active TIER_1 traffic to scale up, and
                Rules 3/4 refuse to scale down while TIER_1 SLA breaches are
                occurring (the paper's "semantic traffic classification"
                component — the rule engine knows business priority).
        False — both semantic gates are removed: Rule 1 fires on CPU alone,
                Rules 3/4 scale down on CPU/mem alone. Used for the ablation
                study (NEXT_STEPS.md §5 item 5) to isolate the semantic
                layer's contribution independent of LSTM prediction.
    """

    def __init__(self, mode: str = "proactive", db_config: dict | None = None,
                 semantic_aware: bool = True):
        assert mode in ("proactive", "reactive"), \
            f"mode must be 'proactive' or 'reactive', got {mode!r}"
        self.mode           = mode
        self.db_config      = db_config
        self.semantic_aware = semantic_aware
        self._cpu_cooldown = 0   # cycles remaining before CPU scale-down allowed
        self._mem_cooldown = 0   # cycles remaining before memory scale-down allowed
        self._cycle     = 0
        print(f"[engine] Initialized — mode={mode}  semantic_aware={semantic_aware}  "
              f"cpu_high={CPU_HIGH}%  mem_high={MEM_HIGH_PCT}%  "
              f"cpu_step={CPU_STEP}  mem_step_mb={MEM_STEP_MB}  "
              f"cooldown={COOLDOWN_CYCLES}")

    # ── Public API ────────────────────────────────────────────────────────────

    def evaluate(
        self,
        forecast       : dict | None,
        current_cpu    : float,
        current_mem_mb : float,
        current_cpus   : float,
        current_mem_gb : float,
    ) -> ScalingDecision:
        """
        Evaluate all four rules and return the highest-priority decision.

        Parameters
        ----------
        forecast       : output of LSTMPredictor.predict() or None
        current_cpu    : live CPU% reading
        current_mem_mb : live memory reading in MB
        current_cpus   : current Docker cpu limit
        current_mem_gb : current Docker memory limit in GB
        """
        self._cycle += 1
        if self._cpu_cooldown > 0: self._cpu_cooldown -= 1
        if self._mem_cooldown > 0: self._mem_cooldown -= 1

        # Choose signal source based on mode
        if self.mode == "proactive" and forecast is not None:
            eval_cpu     = forecast["peak_cpu_pct"]
            eval_cpu_avg = forecast["mean_cpu_pct"]
            eval_mem_mb  = forecast["peak_mem_mb"]
            eval_mem_avg = forecast["mean_mem_mb"]
            source = "LSTM forecast"
        else:
            eval_cpu     = current_cpu
            eval_cpu_avg = current_cpu
            eval_mem_mb  = current_mem_mb
            eval_mem_avg = current_mem_mb
            source = "current observed"

        mem_limit_mb  = current_mem_gb * 1024
        mem_high_mb   = mem_limit_mb * MEM_HIGH_PCT  / 100
        mem_low_mb    = mem_limit_mb * MEM_LOW_PCT   / 100

        # Fetch DB tier stats (non-blocking; falls back gracefully)
        tier = self._get_tier_stats()

        # ── Rule 1 — Proactive CPU Scale-Up ──────────────────────────────────
        tier1_active = (tier.tier1_rps > 0) if self.semantic_aware else True
        if (eval_cpu > CPU_HIGH and tier1_active
                and current_cpus < MAX_CPUS):
            new_cpus = min(round(current_cpus + CPU_STEP, 2), MAX_CPUS)
            self._cpu_cooldown = COOLDOWN_CYCLES
            self._mem_cooldown = max(self._mem_cooldown, COOLDOWN_CYCLES // 2)
            return ScalingDecision(
                action         = "scale_up_cpu",
                target_cpus    = new_cpus,
                target_mem_gb  = current_mem_gb,
                triggered_rule = "Rule 1 — Proactive CPU Scale-Up",
                reason         = (f"{source} peak_cpu={eval_cpu:.1f}% > {CPU_HIGH}%  "
                                  f"TIER_1 rps={tier.tier1_rps:.2f}  "
                                  f"cpus {current_cpus}→{new_cpus}"),
            )

        # ── Rule 2 — Proactive Memory Scale-Up ───────────────────────────────
        if (eval_mem_mb > mem_high_mb
                and current_mem_gb < MAX_MEM_GB):
            new_mem_gb = min(
                round(current_mem_gb + MEM_STEP_MB / 1024, 3), MAX_MEM_GB
            )
            self._mem_cooldown = COOLDOWN_CYCLES
            return ScalingDecision(
                action         = "scale_up_mem",
                target_cpus    = current_cpus,
                target_mem_gb  = new_mem_gb,
                triggered_rule = "Rule 2 — Proactive Memory Scale-Up",
                reason         = (f"{source} peak_mem={eval_mem_mb:.0f}MB > "
                                  f"threshold {mem_high_mb:.0f}MB  "
                                  f"mem {current_mem_gb:.2f}→{new_mem_gb:.2f} GB"),
            )

        # ── Rule 3 — CPU Cooldown (Scale-Down) ───────────────────────────────
        no_recent_breach = (tier.tier1_breach_count == 0) if self.semantic_aware else True
        if (eval_cpu_avg < CPU_LOW
                and no_recent_breach
                and self._cpu_cooldown == 0
                and current_cpus > MIN_CPUS):
            new_cpus = max(round(current_cpus - CPU_STEP, 2), MIN_CPUS)
            self._cpu_cooldown = COOLDOWN_CYCLES
            return ScalingDecision(
                action         = "scale_down_cpu",
                target_cpus    = new_cpus,
                target_mem_gb  = current_mem_gb,
                triggered_rule = "Rule 3 — CPU Cooldown",
                reason         = (f"{source} mean_cpu={eval_cpu_avg:.1f}% < {CPU_LOW}%  "
                                  f"no SLA breaches  "
                                  f"cpus {current_cpus}→{new_cpus}"),
            )

        # ── Rule 4 — Memory Cooldown (Scale-Down) ────────────────────────────
        if (eval_mem_avg < mem_low_mb
                and no_recent_breach
                and self._mem_cooldown == 0
                and current_mem_gb > MIN_MEM_GB):
            new_mem_gb = max(
                round(current_mem_gb - MEM_STEP_MB / 1024, 3), MIN_MEM_GB
            )
            self._mem_cooldown = COOLDOWN_CYCLES
            return ScalingDecision(
                action         = "scale_down_mem",
                target_cpus    = current_cpus,
                target_mem_gb  = new_mem_gb,
                triggered_rule = "Rule 4 — Memory Cooldown",
                reason         = (f"{source} mean_mem={eval_mem_avg:.0f}MB < "
                                  f"threshold {mem_low_mb:.0f}MB  "
                                  f"no SLA breaches  "
                                  f"mem {current_mem_gb:.2f}→{new_mem_gb:.2f} GB"),
            )

        # No rule triggered
        return ScalingDecision(
            action  = "none",
            target_cpus   = current_cpus,
            target_mem_gb = current_mem_gb,
            reason  = (f"cycle={self._cycle}  {source}  "
                       f"cpu={eval_cpu:.1f}%  mem={eval_mem_mb:.0f}MB  "
                       f"tier1_rps={tier.tier1_rps:.2f}  "
                       f"cpu_cd={self._cpu_cooldown}  mem_cd={self._mem_cooldown}"),
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _get_tier_stats(self) -> TierStats:
        """Query semantic_request_logs for the last TIER1_WINDOW_S seconds."""
        if not self.db_config:
            return TierStats()
        try:
            import mysql.connector
            conn  = mysql.connector.connect(**self.db_config)
            cur   = conn.cursor(dictionary=True)
            since = datetime.now(timezone.utc) - timedelta(seconds=TIER1_WINDOW_S)

            cur.execute("""
                SELECT
                  priority_tier,
                  COUNT(*) AS n,
                  SUM(CASE WHEN priority_tier = 'TIER_1'
                                AND response_time_ms > %s THEN 1 ELSE 0 END) AS breaches
                FROM semantic_request_logs
                WHERE logged_at >= %s
                GROUP BY priority_tier
            """, (TIER1_SLA_MS, since))

            rows = {r["priority_tier"]: r for r in cur.fetchall()}
            cur.close(); conn.close()

            t1 = rows.get("TIER_1", {})
            t3 = rows.get("TIER_3", {})
            return TierStats(
                tier1_rps          = round(int(t1.get("n", 0)) / TIER1_WINDOW_S, 3),
                tier1_breach_count = int(t1.get("breaches", 0)),
                tier3_rps          = round(int(t3.get("n", 0)) / TIER1_WINDOW_S, 3),
            )
        except Exception as e:
            # DB unavailable — degrade gracefully (no tier context)
            return TierStats()


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Rule Engine self-test ===\n")

    engine = RuleEngine(mode="proactive", db_config=None)

    # Simulate a high-load forecast (Rule 1 should fire)
    high_forecast = {
        "peak_cpu_pct": 82.0, "mean_cpu_pct": 76.0,
        "peak_mem_mb": 1400.0, "mean_mem_mb": 1300.0,
        "horizon_steps": 30,
    }
    # Manually inject tier stats for test
    engine._get_tier_stats = lambda: TierStats(tier1_rps=3.5, tier1_breach_count=0, tier3_rps=0.1)

    d = engine.evaluate(high_forecast, current_cpu=60.0, current_mem_mb=1200.0,
                        current_cpus=2.0, current_mem_gb=2.0)
    print(d)
    assert d.action == "scale_up_cpu", f"Expected scale_up_cpu, got {d.action}"

    # Simulate low-load with cooldown exhausted (Rule 3 should fire)
    engine._cpu_cooldown = 0
    engine._mem_cooldown = 0
    engine._get_tier_stats = lambda: TierStats(tier1_rps=0.1, tier1_breach_count=0)
    low_forecast = {
        "peak_cpu_pct": 18.0, "mean_cpu_pct": 14.0,
        "peak_mem_mb": 500.0, "mean_mem_mb": 450.0,
        "horizon_steps": 30,
    }
    d2 = engine.evaluate(low_forecast, current_cpu=14.0, current_mem_mb=450.0,
                         current_cpus=2.5, current_mem_gb=2.0)
    print(d2)
    assert d2.action == "scale_down_cpu", f"Expected scale_down_cpu, got {d2.action}"

    print("\n✅  Rule engine tests passed.")
