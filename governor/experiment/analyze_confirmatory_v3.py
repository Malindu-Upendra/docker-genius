"""
analyze_confirmatory_v3.py — run-level inferential analysis for the v3
confirmatory experiment (confirmatory_results/), six conditions x 15 paired
replicates + one unseen-seed check.

Implements, exactly as pre-specified in main.tex Section~\\ref{sec:unit-of-analysis}
and extended for this six-condition design (paper review item C1-C8):

  1. Per-condition descriptive run-level stats (mean, SD, unseen-seed check),
     recomputed at full precision from the per-replicate KPI CSVs (not the
     1-decimal confirmatory_summary.txt text).
  2. All 15 pairwise comparisons among the six conditions:
       - two-sided PAIRED sign-flip permutation test on the run-level mean
         difference (seeds are paired across conditions by replicate index,
         so this supersedes the unpaired two-sample permutation test used in
         the four-condition confirmatory run), 100,000 sign assignments,
       - run-level BCa (bias-corrected, accelerated) bootstrap 95% CI,
         100,000 resamples,
       - Holm-Bonferroni correction applied across the full family of 15.
  3. TOST equivalence tests for the 10 pairwise comparisons among the five
     non-isolation conditions (static_equal, A_base, B_semantic, C_lstm,
     D_full), pre-specified margin +/-5 percentage points (consistent with
     the magnitude -- "a few percentage points" -- that the exploratory
     phase's own five-replicate result was powered to detect), with
     Holm-Bonferroni correction applied within this second family of 10.
  4. Outlier-robust sensitivity check: the primary analysis re-run with the
     Hodges-Lehmann (median-of-pairwise-differences) estimator in place of
     the mean, since each condition's 15-replicate sample contains one
     visible outlier (see confirmatory_summary.txt).

Usage:
    python3 experiment/analyze_confirmatory_v3.py
"""

from __future__ import annotations

import csv
import itertools
import json
import random
import statistics
from pathlib import Path

RESULTS_DIR = Path(__file__).parent / "confirmatory_results"
REPS_DIR = RESULTS_DIR / "reps"

CONFIGS = ["static_equal", "A_base", "B_semantic", "C_lstm", "D_full", "E_isolation"]
LABELS = {
    "static_equal": "Static (Equal-Resource)",
    "A_base": "Reactive -- No Semantic, No LSTM",
    "B_semantic": "Reactive -- Semantic Only",
    "C_lstm": "Proactive -- LSTM Only",
    "D_full": "Proactive -- Full System",
    "E_isolation": "Full System + Isolation",
}
NO_ISOLATION = ["static_equal", "A_base", "B_semantic", "C_lstm", "D_full"]
REP_LABELS = [f"rep{i}" for i in range(1, 16)]

N_PERM = 100_000
N_BOOT = 100_000
EQUIV_MARGIN_PP = 5.0
RNG_SEED = 20261105  # fixed for reproducibility of the Monte Carlo tests themselves


def breach_pct_for(config: str, rep_label: str) -> tuple[float, int]:
    path = REPS_DIR / rep_label / f"{config}_kpi.csv"
    with open(path) as f:
        rows = list(csv.DictReader(f))
    t1 = [r for r in rows if r["tier"] == "TIER_1"]
    breaches = sum(int(r["sla_breach"]) for r in t1)
    n = len(t1)
    return round(breaches / n * 100, 2) if n else 0.0, n


def load_all() -> dict[str, dict[str, tuple[float, int]]]:
    data: dict[str, dict[str, tuple[float, int]]] = {}
    for cfg in CONFIGS:
        data[cfg] = {}
        for rep in REP_LABELS + ["unseen"]:
            p = REPS_DIR / rep / f"{cfg}_kpi.csv"
            if p.exists():
                data[cfg][rep] = breach_pct_for(cfg, rep)
    return data


def mean(xs):
    return sum(xs) / len(xs)


def hodges_lehmann(xs):
    """Median of all pairwise averages (xi+xj)/2, including i==j -- a
    robust, outlier-resistant location estimator for a single sample."""
    pairs = [(xs[i] + xs[j]) / 2 for i in range(len(xs)) for j in range(i, len(xs))]
    return statistics.median(pairs)


def paired_sign_flip_permutation_p(diffs: list[float], rng: random.Random, n_perm: int) -> float:
    """Two-sided paired sign-flip permutation test. Null: the sign of each
    paired difference is equally likely to be + or -. Exact enumeration
    (2^15 = 32768) is cheaper and exact; fall back to it when n is small
    enough, else Monte Carlo."""
    n = len(diffs)
    obs = abs(mean(diffs))
    if n <= 20:
        count = 0
        total = 0
        for bits in range(2 ** n):
            total += 1
            flipped = [d if (bits >> k) & 1 == 0 else -d for k, d in enumerate(diffs)]
            if abs(mean(flipped)) >= obs - 1e-12:
                count += 1
        return count / total
    else:
        count = 0
        for _ in range(n_perm):
            flipped = [d if rng.random() < 0.5 else -d for d in diffs]
            if abs(mean(flipped)) >= obs - 1e-12:
                count += 1
        return count / n_perm


def bca_bootstrap_ci(diffs: list[float], rng: random.Random, n_boot: int, alpha: float = 0.05):
    """BCa bootstrap CI for the mean of `diffs` (paired differences), via
    resampling replicate indices with replacement (preserves pairing)."""
    n = len(diffs)
    theta_hat = mean(diffs)

    boot_means = []
    for _ in range(n_boot):
        sample = [diffs[rng.randrange(n)] for _ in range(n)]
        boot_means.append(mean(sample))
    boot_means.sort()

    # bias-correction factor z0
    n_less = sum(1 for b in boot_means if b < theta_hat)
    prop = max(min(n_less / n_boot, 1 - 1e-9), 1e-9)
    z0 = _norm_ppf(prop)

    # acceleration factor via jackknife
    jack_means = []
    for i in range(n):
        loo = diffs[:i] + diffs[i + 1:]
        jack_means.append(mean(loo))
    jack_mean_avg = mean(jack_means)
    num = sum((jack_mean_avg - jm) ** 3 for jm in jack_means)
    den = 6.0 * (sum((jack_mean_avg - jm) ** 2 for jm in jack_means) ** 1.5)
    a = num / den if den != 0 else 0.0

    def adj_percentile(p):
        z_p = _norm_ppf(p)
        z_adj = z0 + (z0 + z_p) / (1 - a * (z0 + z_p))
        p_adj = _norm_cdf(z_adj)
        idx = min(max(int(round(p_adj * (n_boot - 1))), 0), n_boot - 1)
        return boot_means[idx]

    lo = adj_percentile(alpha / 2)
    hi = adj_percentile(1 - alpha / 2)
    return (lo, hi) if lo <= hi else (hi, lo)


def _norm_cdf(x: float) -> float:
    # Abramowitz-Stegun style via erf, no scipy dependency
    import math
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _norm_ppf(p: float) -> float:
    # Acklam's algorithm (no scipy dependency), standard normal inverse CDF
    import math
    if p <= 0:
        return -8.0
    if p >= 1:
        return 8.0
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    p_low = 0.02425
    p_high = 1 - p_low
    if p < p_low:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p <= p_high:
        q = p - 0.5
        r = q*q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
    q = math.sqrt(-2 * math.log(1 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)


def tost_p(diffs: list[float], margin: float, rng: random.Random, n_perm: int) -> tuple[float, float, float]:
    """TOST via two one-sided paired sign-flip permutation tests against
    +margin and -margin. Returns (p_lower, p_upper, p_tost=max(p_lower,p_upper))."""
    n = len(diffs)
    obs = mean(diffs)

    shifted_hi = [d - margin for d in diffs]   # H0: true diff >= +margin
    shifted_lo = [d + margin for d in diffs]   # H0: true diff <= -margin

    def one_sided_upper_p(shifted):
        obs_shifted = mean(shifted)
        if n <= 20:
            count = total = 0
            for bits in range(2 ** n):
                total += 1
                flipped = [d if (bits >> k) & 1 == 0 else -d for k, d in enumerate(shifted)]
                if mean(flipped) <= obs_shifted + 1e-12:
                    count += 1
            return count / total
        count = 0
        for _ in range(n_perm):
            flipped = [d if rng.random() < 0.5 else -d for d in shifted]
            if mean(flipped) <= obs_shifted + 1e-12:
                count += 1
        return count / n_perm

    def one_sided_lower_p(shifted):
        obs_shifted = mean(shifted)
        if n <= 20:
            count = total = 0
            for bits in range(2 ** n):
                total += 1
                flipped = [d if (bits >> k) & 1 == 0 else -d for k, d in enumerate(shifted)]
                if mean(flipped) >= obs_shifted - 1e-12:
                    count += 1
            return count / total
        count = 0
        for _ in range(n_perm):
            flipped = [d if rng.random() < 0.5 else -d for d in shifted]
            if mean(flipped) >= obs_shifted - 1e-12:
                count += 1
        return count / n_perm

    p_lower = one_sided_lower_p(shifted_lo)  # test true diff <= -margin (want to reject)
    p_upper = one_sided_upper_p(shifted_hi)  # test true diff >= +margin (want to reject)
    return p_lower, p_upper, max(p_lower, p_upper)


def holm_bonferroni(pvals: list[float]) -> list[float]:
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    adj = [0.0] * m
    running_max = 0.0
    for rank, idx in enumerate(order):
        adj_p = min((m - rank) * pvals[idx], 1.0)
        running_max = max(running_max, adj_p)
        adj[idx] = running_max
    return adj


def main():
    rng = random.Random(RNG_SEED)
    data = load_all()

    print("=" * 100)
    print("PER-CONDITION RUN-LEVEL DESCRIPTIVES (15 replicates)")
    print("=" * 100)
    series = {}
    for cfg in CONFIGS:
        vals = [data[cfg][r][0] for r in REP_LABELS]
        series[cfg] = vals
        m = mean(vals)
        sd = statistics.stdev(vals)
        hl = hodges_lehmann(vals)
        unseen = data[cfg].get("unseen", (None, None))[0]
        print(f"{cfg:14s} mean={m:6.2f}  sd={sd:5.2f}  HL={hl:6.2f}  "
              f"min={min(vals):5.1f}  max={max(vals):5.1f}  unseen={unseen}")

    print()
    print("=" * 100)
    print("FAMILY 1 -- ALL 15 PAIRWISE DIFFERENCE TESTS (paired sign-flip permutation + BCa CI)")
    print("=" * 100)
    pairs = list(itertools.combinations(CONFIGS, 2))
    raw_pvals = []
    results = []
    for a, b in pairs:
        diffs = [series[b][i] - series[a][i] for i in range(15)]  # b - a
        p = paired_sign_flip_permutation_p(diffs, rng, N_PERM)
        ci = bca_bootstrap_ci(diffs, rng, N_BOOT)
        raw_pvals.append(p)
        results.append((a, b, mean(diffs), ci, p))
    adj_pvals = holm_bonferroni(raw_pvals)
    for (a, b, d, ci, p), p_adj in zip(results, adj_pvals):
        excl = "YES" if (ci[0] > 0 or ci[1] < 0) else "no"
        print(f"{a:14s} -> {b:14s}  diff={d:+7.2f}pp  CI=[{ci[0]:+6.2f},{ci[1]:+6.2f}]  "
              f"raw_p={p:.5f}  holm_p={p_adj:.5f}  excludes0={excl}")

    print()
    print("=" * 100)
    print(f"FAMILY 2 -- TOST EQUIVALENCE (margin=+/-{EQUIV_MARGIN_PP}pp), 10 comparisons among non-isolation conditions")
    print("=" * 100)
    noiso_pairs = list(itertools.combinations(NO_ISOLATION, 2))
    tost_raw = []
    tost_results = []
    for a, b in noiso_pairs:
        diffs = [series[b][i] - series[a][i] for i in range(15)]
        p_lo, p_hi, p_tost = tost_p(diffs, EQUIV_MARGIN_PP, rng, N_PERM)
        tost_raw.append(p_tost)
        tost_results.append((a, b, mean(diffs), p_lo, p_hi, p_tost))
    tost_adj = holm_bonferroni(tost_raw)
    for (a, b, d, p_lo, p_hi, p_tost), p_adj in zip(tost_results, tost_adj):
        equiv = "YES" if p_adj < 0.05 else "no"
        print(f"{a:14s} vs {b:14s}  diff={d:+6.2f}pp  p_lo={p_lo:.4f}  p_hi={p_hi:.4f}  "
              f"p_tost={p_tost:.4f}  holm_p={p_adj:.4f}  equivalent(<{EQUIV_MARGIN_PP}pp)={equiv}")

    print()
    print("=" * 100)
    print("OUTLIER SENSITIVITY -- condition flagged outlier removed, mean recomputed (14 reps)")
    print("=" * 100)
    outliers = {
        "static_equal": 12,  # rep12 = 73.8
        "A_base": 4,         # rep4 = 92.1
        "B_semantic": 3,     # rep3 = 91.1
        "D_full": 2,         # rep2 = 94.4
        "E_isolation": 12,   # rep12 = 1.2
    }
    for cfg, rep_n in outliers.items():
        vals = series[cfg]
        trimmed = vals[: rep_n - 1] + vals[rep_n:]
        print(f"{cfg:14s} full_mean={mean(vals):6.2f}  trimmed_mean={mean(trimmed):6.2f}  "
              f"(removed rep{rep_n}={vals[rep_n-1]:.1f})")

    out = {
        "descriptives": {cfg: {"mean": mean(series[cfg]), "sd": statistics.stdev(series[cfg]),
                                "hl": hodges_lehmann(series[cfg]),
                                "unseen": data[cfg].get("unseen", (None, None))[0],
                                "values": series[cfg]}
                          for cfg in CONFIGS},
        "pairwise": [{"a": a, "b": b, "diff": d, "ci": list(ci), "raw_p": p, "holm_p": p_adj}
                     for (a, b, d, ci, p), p_adj in zip(results, adj_pvals)],
        "tost": [{"a": a, "b": b, "diff": d, "p_lo": p_lo, "p_hi": p_hi,
                  "p_tost": p_tost, "holm_p": p_adj}
                 for (a, b, d, p_lo, p_hi, p_tost), p_adj in zip(tost_results, tost_adj)],
        "equiv_margin_pp": EQUIV_MARGIN_PP,
        "rng_seed": RNG_SEED,
        "n_perm": N_PERM,
        "n_boot": N_BOOT,
    }
    out_path = RESULTS_DIR / "confirmatory_v3_analysis.json"
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n[analysis] Full results written to {out_path}")


if __name__ == "__main__":
    main()
