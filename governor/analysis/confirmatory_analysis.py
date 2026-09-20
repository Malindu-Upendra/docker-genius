"""
confirmatory_analysis.py — Run-level statistical analysis for the
DOCKER-GENIUS confirmatory experiment (Section 5.8 / sec:confirmatory of
the paper).

Reads the per-replicate breach rates reported by
experiment/run_confirmatory.py (see confirmatory_results/confirmatory_summary.txt)
and computes, for every pairwise comparison among the four locked
conditions:
  - a two-sided permutation test (exchanging run labels between the two
    conditions, not requests within a run -- the run is the unit of
    analysis, per Section sec:unit-of-analysis)
  - a run-level percentile bootstrap CI, absolute (pp) and relative (%)
  - Holm-Bonferroni correction across the full family of comparisons

The reserved unseen-workload seed's breach rate is reported separately,
descriptively, and is not pooled into the n=15 statistical test.

Usage:
    python3 analysis/confirmatory_analysis.py

Outputs:
    experiment/confirmatory_results/confirmatory_analysis.json
"""
import itertools
import json
from pathlib import Path

import numpy as np

RESULTS_DIR = Path(__file__).parent.parent / "experiment" / "confirmatory_results"
OUT_PATH = RESULTS_DIR / "confirmatory_analysis.json"

# Per-replicate TIER_1 breach rates (%), rep1..rep15, read from
# confirmatory_summary.txt's "Per-replicate breach rates" section.
DATA = {
    "static_equal": [19.6, 19.4, 19.3, 19.5, 19.6, 19.8, 19.4, 14.7, 18.1, 17.3, 19.4, 19.4, 11.7, 17.9, 19.2],
    "reactive":     [19.7, 19.9, 14.7, 19.5, 19.9, 19.4, 18.4, 19.6, 19.6, 19.8, 18.2, 15.1, 19.6, 18.4, 19.4],
    "lstm_only":    [19.5, 19.9, 19.4, 19.4, 19.1, 19.6, 18.5, 19.5, 16.3, 17.2, 14.2, 19.5, 19.3, 17.2, 19.6],
    "proactive":    [19.4, 19.2, 19.6, 18.9, 19.2, 20.0, 19.6, 19.5, 19.2, 19.4, 17.3, 17.2, 17.3, 18.1, 18.6],
}
UNSEEN = {"static_equal": 19.2, "reactive": 19.3, "lstm_only": 19.3, "proactive": 19.8}

N_PERM = 100_000
N_BOOT = 100_000
SEED = 42


def perm_test_two_sided(a, b, rng, n_perm=N_PERM):
    a, b = np.array(a), np.array(b)
    obs = np.mean(a) - np.mean(b)
    pooled = np.concatenate([a, b])
    n_a = len(a)
    count = 0
    for _ in range(n_perm):
        rng.shuffle(pooled)
        diff = np.mean(pooled[:n_a]) - np.mean(pooled[n_a:])
        if abs(diff) >= abs(obs) - 1e-12:
            count += 1
    return obs, (count + 1) / (n_perm + 1)


def bootstrap_ci(a, b, rng, n_boot=N_BOOT):
    a, b = np.array(a), np.array(b)
    na, nb = len(a), len(b)
    diffs = np.empty(n_boot)
    rel_diffs = np.empty(n_boot)
    for i in range(n_boot):
        sa = rng.choice(a, na, replace=True)
        sb = rng.choice(b, nb, replace=True)
        d = sa.mean() - sb.mean()
        diffs[i] = d
        rel_diffs[i] = d / sb.mean() * 100
    return (
        tuple(np.percentile(diffs, [2.5, 97.5])),
        tuple(np.percentile(rel_diffs, [2.5, 97.5])),
    )


def holm_bonferroni(p_values):
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adjusted = [0.0] * m
    prev = 0.0
    for rank, idx in enumerate(order):
        adj = min(max(p_values[idx] * (m - rank), prev), 1.0)
        adjusted[idx] = adj
        prev = adj
    return adjusted


def main():
    rng = np.random.default_rng(SEED)
    pairs = list(itertools.combinations(DATA.keys(), 2))
    results = []
    for g1, g2 in pairs:
        obs, p = perm_test_two_sided(DATA[g1], DATA[g2], rng)
        ci_abs, ci_rel = bootstrap_ci(DATA[g1], DATA[g2], rng)
        results.append({
            "pair": f"{g1} vs {g2}",
            "mean1": float(np.mean(DATA[g1])), "mean2": float(np.mean(DATA[g2])),
            "abs_diff": float(obs), "p_raw": float(p),
            "ci_abs": ci_abs, "ci_rel": ci_rel,
        })

    holm = holm_bonferroni([r["p_raw"] for r in results])
    for r, p_holm in zip(results, holm):
        r["p_holm"] = p_holm
        r["excludes_zero"] = not (r["ci_abs"][0] <= 0 <= r["ci_abs"][1])
        r["significant_holm"] = p_holm < 0.05

    for r in results:
        print(f"{r['pair']:35s} diff={r['abs_diff']:+.2f}pp  "
              f"CI=[{r['ci_abs'][0]:+.2f},{r['ci_abs'][1]:+.2f}]  "
              f"p_raw={r['p_raw']:.4f}  p_holm={r['p_holm']:.4f}  "
              f"excludes_zero={r['excludes_zero']}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({
            "results": results,
            "means": {k: float(np.mean(v)) for k, v in DATA.items()},
            "sds": {k: float(np.std(v, ddof=1)) for k, v in DATA.items()},
            "unseen": UNSEEN,
            "n_perm": N_PERM, "n_boot": N_BOOT, "rng_seed": SEED,
        }, f, indent=2)
    print(f"\nSaved -> {OUT_PATH}")


if __name__ == "__main__":
    main()
