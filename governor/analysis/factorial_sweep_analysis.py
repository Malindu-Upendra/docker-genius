"""
factorial_sweep_analysis.py — Run-level analysis for the one-at-a-time
rule-engine parameter sensitivity sweep (supervisor review items #12/#13).

Reads the per-replicate TIER_1 breach rates from
experiment/factorial_sweep_results/<config>/reps/repN/group{2,3}_kpi.csv
(group 2 = Reactive-Only, group 3 = Proactive Hybrid) for all 7
configurations (a centre point plus each of CPU step / memory step /
cooldown varied independently, 5 replicates each -- see
experiment/run_factorial_sweep.py for the exact design), and for each of
the 3 parameters runs two-sided run-level permutation tests + run-level
bootstrap CIs comparing each non-centre level against the centre and
against each other, with Holm-Bonferroni correction applied across all 9
comparisons per strategy.

Usage:
    python3 analysis/factorial_sweep_analysis.py

Outputs:
    experiment/factorial_sweep_results/factorial_per_rep_breach.json
    experiment/factorial_sweep_results/analysis_<proactive|reactive>.json
"""
import csv
import json
from pathlib import Path

import numpy as np

RESULTS_DIR = Path(__file__).parent.parent / "experiment" / "factorial_sweep_results"
CONFIGS = ["centre", "cpu_step_0.5", "cpu_step_1.5", "mem_step_512", "mem_step_1024", "cooldown_2", "cooldown_6"]
GROUPS = {"2": "reactive", "3": "proactive"}
N_REPS = 5
N_PERM = 100_000
N_BOOT = 100_000
SEED = 7

COMPARISONS = [
    ("CPU step", "cpu_step_0.5", "centre"),
    ("CPU step", "cpu_step_1.5", "centre"),
    ("CPU step", "cpu_step_0.5", "cpu_step_1.5"),
    ("Memory step", "mem_step_512", "centre"),
    ("Memory step", "mem_step_1024", "centre"),
    ("Memory step", "mem_step_512", "mem_step_1024"),
    ("Cooldown", "cooldown_2", "centre"),
    ("Cooldown", "cooldown_6", "centre"),
    ("Cooldown", "cooldown_2", "cooldown_6"),
]


def load_per_rep_breach_rates():
    data = {}
    for cfg in CONFIGS:
        data[cfg] = {}
        for gnum, gname in GROUPS.items():
            rates = []
            for rep in range(1, N_REPS + 1):
                path = RESULTS_DIR / cfg / "reps" / f"rep{rep}" / f"group{gnum}_kpi.csv"
                rows = list(csv.DictReader(open(path)))
                t1 = [r for r in rows if r["tier"] == "TIER_1"]
                n = len(t1)
                breaches = sum(1 for r in t1 if r["sla_breach"] in ("1", "1.0", "True"))
                rates.append(round(breaches / n * 100, 2) if n else 0.0)
            data[cfg][gname] = rates
    return data


def perm_test(a, b, rng, n_perm=N_PERM):
    a, b = np.array(a), np.array(b)
    obs = np.mean(a) - np.mean(b)
    pooled = np.concatenate([a, b])
    na = len(a)
    count = 0
    for _ in range(n_perm):
        rng.shuffle(pooled)
        d = np.mean(pooled[:na]) - np.mean(pooled[na:])
        if abs(d) >= abs(obs) - 1e-12:
            count += 1
    return float(obs), (count + 1) / (n_perm + 1)


def bootstrap_ci(a, b, rng, n_boot=N_BOOT):
    a, b = np.array(a), np.array(b)
    na, nb = len(a), len(b)
    diffs = np.empty(n_boot)
    for i in range(n_boot):
        sa = rng.choice(a, na, replace=True)
        sb = rng.choice(b, nb, replace=True)
        diffs[i] = sa.mean() - sb.mean()
    return tuple(float(x) for x in np.percentile(diffs, [2.5, 97.5]))


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
    data = load_per_rep_breach_rates()
    with open(RESULTS_DIR / "factorial_per_rep_breach.json", "w") as f:
        json.dump(data, f, indent=2)

    for group in ["proactive", "reactive"]:
        rng = np.random.default_rng(SEED)
        results = []
        for param, c1, c2 in COMPARISONS:
            a, b = data[c1][group], data[c2][group]
            obs, p = perm_test(a, b, rng)
            ci = bootstrap_ci(a, b, rng)
            results.append({
                "param": param, "c1": c1, "c2": c2,
                "mean1": float(np.mean(a)), "mean2": float(np.mean(b)),
                "diff": obs, "ci": ci, "p_raw": p,
            })
        holm_p = holm_bonferroni([r["p_raw"] for r in results])
        for r, ph in zip(results, holm_p):
            r["p_holm"] = ph
            r["excludes_zero"] = not (r["ci"][0] <= 0 <= r["ci"][1])
            r["significant_holm"] = ph < 0.05
            print(f"[{group}] {r['param']:12s} {r['c1']:15s} vs {r['c2']:15s} "
                  f"diff={r['diff']:+.2f}pp CI=[{r['ci'][0]:+.2f},{r['ci'][1]:+.2f}] "
                  f"p_raw={r['p_raw']:.3f} p_holm={r['p_holm']:.3f}")
        with open(RESULTS_DIR / f"analysis_{group}.json", "w") as f:
            json.dump(results, f, indent=2)

    print(f"\nSaved -> {RESULTS_DIR}/factorial_per_rep_breach.json, analysis_proactive.json, analysis_reactive.json")


if __name__ == "__main__":
    main()
