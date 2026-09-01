"""
mann_whitney.py — DOCKER-GENIUS Statistical Analysis

Runs Mann-Whitney U tests on TIER_1 latency distributions across the three
experiment groups and produces publication-ready output for the thesis.

Tests performed (one-sided, H1: Group 3 has LOWER latency):
  • Group 1 vs Group 3  (Static vs Proactive Hybrid)
  • Group 2 vs Group 3  (Reactive-Only vs Proactive Hybrid)
  • Group 1 vs Group 2  (Static vs Reactive-Only — sanity check)

Effect size: rank-biserial correlation  r = 1 − (2U) / (n1·n2)
  |r| ≥ 0.10 → small,  ≥ 0.30 → medium,  ≥ 0.50 → large

Also generates (requires matplotlib):
  figures/latency_boxplot.png    — side-by-side TIER_1 latency distributions
  figures/latency_timeseries.png — P95 over experiment time, all 3 groups
  figures/breach_rate.png        — SLA breach % over time, all 3 groups

Usage:
    python3 analysis/mann_whitney.py
    python3 analysis/mann_whitney.py --results experiment/results
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from pathlib import Path

TIER1_SLA_MS = 150.0
ALPHA        = 0.05        # significance level


# ── Load data ─────────────────────────────────────────────────────────────────

def load_latencies(path: Path) -> list[float]:
    lats = []
    with open(path) as f:
        for r in csv.DictReader(f):
            if r.get("tier") == "TIER_1":
                try:
                    lats.append(float(r["latency_ms"]))
                except ValueError:
                    pass
    return lats


def load_timeseries(path: Path) -> list[dict]:
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            try:
                rows.append({
                    "group"        : r["group"],
                    "elapsed_s"    : float(r["elapsed_s"]),
                    "t1_p95_ms"    : float(r["t1_p95_ms"]),
                    "t1_breach_pct": float(r["t1_breach_pct"]),
                    "t1_rps"       : float(r["t1_rps"]),
                })
            except (KeyError, ValueError):
                pass
    return rows


# ── Mann-Whitney U (pure Python — no scipy required) ─────────────────────────

def mann_whitney_u(x: list[float], y: list[float]) -> tuple[float, float, float]:
    """
    Two-sample Mann-Whitney U test (one-sided: P(X > Y) < 0.5).

    Returns (U, z, p_value).
    Uses normal approximation with continuity correction (valid for n > 20).
    """
    nx, ny = len(x), len(y)
    if nx == 0 or ny == 0:
        return 0.0, 0.0, 1.0

    # Rank all observations together
    combined = [(v, 0) for v in x] + [(v, 1) for v in y]
    combined.sort(key=lambda t: t[0])

    ranks = [0.0] * len(combined)
    i = 0
    while i < len(combined):
        j = i
        while j < len(combined) - 1 and combined[j+1][0] == combined[i][0]:
            j += 1
        avg_rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[k] = avg_rank
        i = j + 1

    r_x = sum(ranks[k] for k, (_, g) in enumerate(combined) if g == 0)
    U   = r_x - nx * (nx + 1) / 2

    mu_u   = nx * ny / 2
    sigma_u = math.sqrt(nx * ny * (nx + ny + 1) / 12)
    if sigma_u == 0:
        return U, 0.0, 1.0

    z = (U - mu_u - 0.5) / sigma_u  # continuity correction, one-sided

    # One-sided p-value: H1 is X > Y (Group 1/2 latency higher than Group 3)
    # Large U (X beats Y often) → large z → small right-tail p
    p = 1 - _norm_cdf(z)
    return U, round(z, 4), round(p, 6)


def _norm_cdf(z: float) -> float:
    """Approximation of standard normal CDF."""
    return 0.5 * math.erfc(-z / math.sqrt(2))


def rank_biserial(U: float, n1: int, n2: int) -> float:
    """Effect size: rank-biserial correlation."""
    if n1 * n2 == 0:
        return 0.0
    return round(1 - (2 * U) / (n1 * n2), 4)


def effect_label(r: float) -> str:
    r = abs(r)
    if r >= 0.50: return "large"
    if r >= 0.30: return "medium"
    if r >= 0.10: return "small"
    return "negligible"


# ── Bootstrap confidence intervals ────────────────────────────────────────────
# Mann-Whitney's z/p tells you whether a difference is real; it doesn't say
# how big it plausibly is. A bootstrap CI on the breach-rate reduction (the
# number the primary hypothesis is actually stated in terms of) is what the
# journal checklist asks for alongside the effect size.

def _bootstrap_resample_mean_gt(lats: list[float], threshold: float,
                                 rng: random.Random) -> float:
    n = len(lats)
    idx = [rng.randrange(n) for _ in range(n)]
    breaches = sum(1 for i in idx if lats[i] > threshold)
    return breaches / n


def bootstrap_ci_breach_reduction(
    baseline: list[float], treatment: list[float],
    threshold: float = TIER1_SLA_MS, n_boot: int = 3000,
    ci: float = 0.95, seed: int = 42,
) -> tuple[float, float, float]:
    """
    Percentile bootstrap 95% CI for the % reduction in SLA breach rate from
    `baseline` to `treatment`: reduction = (rate_base - rate_treat) / rate_base * 100.

    Returns (point_estimate, lo, hi). Point estimate uses the full samples;
    lo/hi are the (1-ci)/2 and 1-(1-ci)/2 percentiles of the bootstrap
    distribution. Resamples baseline and treatment independently (unpaired).
    """
    rng = random.Random(seed)
    base_rate = sum(1 for v in baseline if v > threshold) / len(baseline)
    treat_rate = sum(1 for v in treatment if v > threshold) / len(treatment)
    point = round((base_rate - treat_rate) / base_rate * 100, 1) if base_rate else 0.0

    diffs = []
    for _ in range(n_boot):
        rb = _bootstrap_resample_mean_gt(baseline, threshold, rng)
        rt = _bootstrap_resample_mean_gt(treatment, threshold, rng)
        if rb == 0:
            continue
        diffs.append((rb - rt) / rb * 100)

    if not diffs:
        return point, point, point
    diffs.sort()
    lo_idx = int(len(diffs) * (1 - ci) / 2)
    hi_idx = int(len(diffs) * (1 - (1 - ci) / 2)) - 1
    lo = round(diffs[max(0, lo_idx)], 1)
    hi = round(diffs[min(len(diffs) - 1, hi_idx)], 1)
    return point, lo, hi


# ── Reporting ─────────────────────────────────────────────────────────────────

def describe(lats: list[float], label: str) -> dict:
    if not lats:
        return {}
    s = sorted(lats)
    def pct(p):
        idx = max(0, math.ceil(len(s) * p / 100) - 1)
        return round(s[idx], 1)
    breaches = sum(1 for v in lats if v > TIER1_SLA_MS)
    return {
        "group"      : label,
        "n"          : len(lats),
        "mean_ms"    : round(sum(lats) / len(lats), 1),
        "median_ms"  : pct(50),
        "p95_ms"     : pct(95),
        "p99_ms"     : pct(99),
        "max_ms"     : round(max(lats), 1),
        "breaches"   : breaches,
        "breach_pct" : round(breaches / len(lats) * 100, 2),
    }


def print_descriptive(stats: list[dict]):
    print(f"\n{'─'*72}")
    print("  Descriptive Statistics — TIER_1 Latency")
    print(f"{'─'*72}")
    hdr = f"  {'Group':<26} {'n':>6} {'Mean':>7} {'P50':>7} {'P95':>7} {'P99':>7} {'Breach%':>8}"
    print(hdr)
    print("  " + "─" * 70)
    for s in stats:
        print(f"  {s['group']:<26} {s['n']:>6} "
              f"{s['mean_ms']:>6.1f}ms "
              f"{s['median_ms']:>6.1f}ms "
              f"{s['p95_ms']:>6.1f}ms "
              f"{s['p99_ms']:>6.1f}ms "
              f"{s['breach_pct']:>7.1f}%")


def print_tests(test_results: list[dict]):
    print(f"\n{'─'*72}")
    print(f"  Mann-Whitney U Tests  (α = {ALPHA}, H₁: Group 3 < other)")
    print(f"{'─'*72}")
    print(f"  {'Comparison':<36} {'U':>10} {'z':>7} {'p':>10} {'r':>7} {'Effect':>10} {'Sig':>5}")
    print("  " + "─" * 70)
    for t in test_results:
        sig = "✓" if t["p"] < ALPHA else "✗"
        print(f"  {t['comparison']:<36} {t['U']:>10.0f} {t['z']:>7.3f} "
              f"{t['p']:>10.6f} {t['r']:>7.4f} {t['effect']:>10} {sig:>5}")


def save_report(stats, tests, rdir: Path, ci_results: list[dict] | None = None):
    path = rdir / "statistical_report.txt"
    with open(path, "w") as f:
        f.write("DOCKER-GENIUS — Statistical Analysis Report\n")
        f.write("=" * 72 + "\n\n")

        f.write("Descriptive Statistics — TIER_1 Latency\n")
        f.write("-" * 72 + "\n")
        for s in stats:
            f.write(f"  {s['group']}\n")
            f.write(f"    n={s['n']}  mean={s['mean_ms']}ms  "
                    f"P50={s['median_ms']}ms  P95={s['p95_ms']}ms  "
                    f"P99={s['p99_ms']}ms\n")
            f.write(f"    SLA breaches: {s['breaches']} ({s['breach_pct']}%)\n\n")

        f.write("\nMann-Whitney U Tests\n")
        f.write("-" * 72 + "\n")
        for t in tests:
            sig = "SIGNIFICANT" if t["p"] < ALPHA else "not significant"
            f.write(f"  {t['comparison']}\n")
            f.write(f"    U={t['U']:.0f}  z={t['z']:.3f}  p={t['p']:.6f}  "
                    f"r={t['r']:.4f} ({t['effect']} effect) — {sig}\n\n")

        if ci_results:
            f.write("\nSLA Breach Rate Reduction — Bootstrap 95% CI (n=3000 resamples)\n")
            f.write("-" * 72 + "\n")
            for c in ci_results:
                f.write(f"  {c['comparison']}: {c['reduction']}%  "
                        f"95% CI [{c['ci_lo']}%, {c['ci_hi']}%]\n")
            f.write("\n")

    print(f"\n  Report saved → {path}")


# ── Visualisation ─────────────────────────────────────────────────────────────

def plot_figures(data: dict[str, list[float]], ts_rows: list[dict], rdir: Path):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches
    except ImportError:
        print("  (matplotlib not installed — skipping plots)")
        return

    fig_dir = rdir / "figures"
    fig_dir.mkdir(exist_ok=True)

    COLORS = {
        "Static Allocation" : "#e74c3c",
        "Reactive-Only"     : "#f39c12",
        "Proactive Hybrid"  : "#27ae60",
    }
    groups_ordered = ["Static Allocation", "Reactive-Only", "Proactive Hybrid"]

    # ── Box plot ──────────────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(9, 5))
    box_data   = [data.get(g, []) for g in groups_ordered]
    box_colors = [COLORS[g] for g in groups_ordered]

    bp = ax.boxplot(box_data, patch_artist=True, notch=False,
                    showfliers=False, widths=0.5)
    for patch, color in zip(bp["boxes"], box_colors):
        patch.set_facecolor(color); patch.set_alpha(0.7)

    ax.axhline(TIER1_SLA_MS, color="red", linestyle="--", linewidth=1.2,
               label=f"SLA threshold ({TIER1_SLA_MS}ms)")
    ax.set_xticks([1, 2, 3])
    ax.set_xticklabels(["Group 1\nStatic", "Group 2\nReactive", "Group 3\nProactive"])
    ax.set_ylabel("TIER_1 Latency (ms)")
    ax.set_title("DOCKER-GENIUS — TIER_1 Latency Distribution by Group")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(fig_dir / "latency_boxplot.png", dpi=150)
    plt.close(fig)
    print(f"  → {fig_dir / 'latency_boxplot.png'}")

    if ts_rows:
        # ── P95 time-series ───────────────────────────────────────────────────
        fig, axes = plt.subplots(2, 1, figsize=(12, 7), sharex=False)

        for g in groups_ordered:
            grows = [r for r in ts_rows if r["group"] == g]
            if not grows:
                continue
            xs = [r["elapsed_s"] for r in grows]
            p95 = [r["t1_p95_ms"] for r in grows]
            bpct = [r["t1_breach_pct"] for r in grows]
            axes[0].plot(xs, p95,  label=g, color=COLORS[g], linewidth=1.5)
            axes[1].plot(xs, bpct, label=g, color=COLORS[g], linewidth=1.5)

        axes[0].axhline(TIER1_SLA_MS, color="red", linestyle="--",
                        linewidth=1, label="SLA 150ms")
        axes[0].set_ylabel("TIER_1 P95 Latency (ms)")
        axes[0].set_title("TIER_1 P95 Latency over Experiment Time")
        axes[0].legend(); axes[0].grid(alpha=0.3)

        axes[1].axhline(5.0, color="red", linestyle="--", linewidth=1,
                        label="5% target")
        axes[1].set_ylabel("SLA Breach Rate (%)")
        axes[1].set_xlabel("Elapsed time (s)")
        axes[1].set_title("TIER_1 SLA Breach Rate over Experiment Time")
        axes[1].legend(); axes[1].grid(alpha=0.3)

        fig.tight_layout()
        fig.savefig(fig_dir / "latency_timeseries.png", dpi=150)
        plt.close(fig)
        print(f"  → {fig_dir / 'latency_timeseries.png'}")


# ── Main ──────────────────────────────────────────────────────────────────────

LABELS = {1: "Static Allocation", 2: "Reactive-Only", 3: "Proactive Hybrid"}

def main():
    ap = argparse.ArgumentParser(
        description="Mann-Whitney U statistical analysis for DOCKER-GENIUS"
    )
    ap.add_argument("--results", default="experiment/results")
    args = ap.parse_args()
    rdir = Path(args.results)

    # Load per-group latencies
    data: dict[str, list[float]] = {}
    for num, label in LABELS.items():
        kpi_path = rdir / f"group{num}_kpi.csv"
        if kpi_path.exists():
            lats = load_latencies(kpi_path)
            if lats:
                data[label] = lats
                print(f"[analysis] Loaded group {num} — {len(lats)} TIER_1 requests")
            else:
                print(f"[analysis] group {num} — no TIER_1 rows found")
        else:
            print(f"[analysis] group{num}_kpi.csv not found — skipping")

    if len(data) < 2:
        print("[analysis] Need at least 2 groups to run tests. Run the experiment first.")
        return

    # Descriptive stats
    stats = [describe(data[label], label)
             for label in LABELS.values() if label in data]
    print_descriptive(stats)

    # Mann-Whitney U tests
    g1 = data.get("Static Allocation",  [])
    g2 = data.get("Reactive-Only",       [])
    g3 = data.get("Proactive Hybrid",    [])

    test_results = []
    pairs = [
        ("Group 1 (Static) vs Group 3 (Proactive)", g1, g3),
        ("Group 2 (Reactive) vs Group 3 (Proactive)", g2, g3),
        ("Group 1 (Static) vs Group 2 (Reactive)", g1, g2),
    ]
    for label, a, b in pairs:
        if not a or not b:
            continue
        U, z, p = mann_whitney_u(a, b)
        r = rank_biserial(U, len(a), len(b))
        test_results.append({
            "comparison": label,
            "n1": len(a), "n2": len(b),
            "U": U, "z": z, "p": p,
            "r": r, "effect": effect_label(r),
        })

    print_tests(test_results)

    # Reduction percentages + bootstrap 95% CI (the point estimate alone
    # doesn't say how precise it is — the CI does)
    ci_results = []
    if g1 and g3:
        p95_g1 = sorted(g1)[max(0, math.ceil(len(g1)*0.95)-1)]
        p95_g3 = sorted(g3)[max(0, math.ceil(len(g3)*0.95)-1)]
        reduction = round((p95_g1 - p95_g3) / p95_g1 * 100, 1) if p95_g1 else 0
        b_red, b_lo, b_hi = bootstrap_ci_breach_reduction(g1, g3)
        ci_results.append({"comparison": "G1 (Static) → G3 (Proactive)",
                            "reduction": b_red, "ci_lo": b_lo, "ci_hi": b_hi})
        print(f"\n  P95 reduction (G1→G3): {reduction}%")
        print(f"  SLA breach reduction  (G1→G3): {b_red}%  "
              f"95% CI [{b_lo}%, {b_hi}%]  "
              f"({'✓ meets' if b_red >= 30 else '✗ below'} 30% target)")
    if g2 and g3:
        b_red2, b_lo2, b_hi2 = bootstrap_ci_breach_reduction(g2, g3)
        ci_results.append({"comparison": "G2 (Reactive) → G3 (Proactive)",
                            "reduction": b_red2, "ci_lo": b_lo2, "ci_hi": b_hi2})
        print(f"  SLA breach reduction  (G2→G3): {b_red2}%  "
              f"95% CI [{b_lo2}%, {b_hi2}%]")

    # Load timeseries for plots
    ts_path = rdir / "all_groups_timeseries.csv"
    ts_rows = load_timeseries(ts_path) if ts_path.exists() else []

    # Save report and plots
    save_report(stats, test_results, rdir, ci_results)
    print("\n[analysis] Generating figures…")
    plot_figures(data, ts_rows, rdir)

    print("\n[analysis] ✅  Statistical analysis complete.")


if __name__ == "__main__":
    main()
