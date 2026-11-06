"""
make_confirmatory_figures.py — figures for the v3, six-condition confirmatory
experiment (paper review item G1).

Reads the per-replicate KPI CSVs under confirmatory_results/reps/ (the same
source analyze_confirmatory_v3.py uses) and produces two figures:

  fig9_confirmatory_breach_rates.png  — run-level SLA breach rate by
      condition (mean +/- SD bars, individual 15-replicate points jittered
      on top), with an inset detail panel for the isolation condition's own
      near-zero distribution (a broken/dual y-axis on one set of bars would
      make the two population widely different scales unreadable; a second,
      zoomed panel on the same data is used instead).

  fig10_confirmatory_latency.png — pooled P50/P95/P99 TIER_1 latency by
      condition, log-scaled y-axis (the five vertical-scaling conditions and
      isolation differ by 2-3 orders of magnitude, which a log scale shows
      without truncation).

Both figures use the six-slot categorical colour order validated for
adjacent-pair colourblind-safety (blue, orange, aqua, yellow, magenta,
green), fixed to the same condition in both figures, with direct value
labels so no reading depends on colour alone.

Usage:
    python3 experiment/make_confirmatory_figures.py
"""

from __future__ import annotations

import csv
import statistics
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

RESULTS_DIR = Path(__file__).parent / "confirmatory_results"
REPS_DIR = RESULTS_DIR / "reps"
OUT_DIR = Path(__file__).parent.parent.parent.parent / "03_Journal_Paper" / "figures"

CONFIGS = ["static_equal", "A_base", "B_semantic", "C_lstm", "D_full", "E_isolation"]
SHORT_LABELS = ["Static\n(equal-res.)", "Reactive\n(no sem.)", "Reactive\n(sem.)",
                "Proactive\n(LSTM)", "Proactive\n(full)", "Full hybrid\n+ isolation"]
REP_LABELS = [f"rep{i}" for i in range(1, 16)]

# Six-slot categorical order validated for adjacent-pair CVD safety
# (dataviz skill reference palette, light mode).
COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]
MUTED_DOT = "#52514e"
GRID = "#e1e0d9"
AXIS = "#898781"
TEXT_PRIMARY = "#0b0b0b"

# Matplotlib font sizes chosen so that, after LaTeX scales the figure down
# from this script's design width to the paper's \columnwidth (372pt =
# 5.15in, single-column sn-jnl layout), effective rendered text sits at a
# normal, comfortably readable ~11-14pt rather than the sub-8pt that a
# default-sized matplotlib figure produces once shrunk to column width.
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.size": 14,
    "axes.titlesize": 18,
    "axes.labelsize": 16,
    "xtick.labelsize": 13,
    "ytick.labelsize": 13,
    "legend.fontsize": 13,
    "axes.edgecolor": AXIS,
    "axes.linewidth": 1.0,
    "text.color": TEXT_PRIMARY,
    "axes.labelcolor": TEXT_PRIMARY,
    "xtick.color": TEXT_PRIMARY,
    "ytick.color": TEXT_PRIMARY,
})


def breach_pct_for(config: str, rep_label: str) -> float:
    path = REPS_DIR / rep_label / f"{config}_kpi.csv"
    with open(path) as f:
        rows = list(csv.DictReader(f))
    t1 = [r for r in rows if r["tier"] == "TIER_1"]
    breaches = sum(int(r["sla_breach"]) for r in t1)
    n = len(t1)
    return round(breaches / n * 100, 2) if n else 0.0


def load_series() -> dict[str, list[float]]:
    return {cfg: [breach_pct_for(cfg, rep) for rep in REP_LABELS] for cfg in CONFIGS}


def fig_breach_rates(series: dict[str, list[float]]):
    means = [statistics.mean(series[c]) for c in CONFIGS]
    sds = [statistics.stdev(series[c]) for c in CONFIGS]
    x = np.arange(len(CONFIGS))
    rng = np.random.default_rng(20261105)

    # Two separate panels (small multiples), not an inset laid over the main
    # bars: the main panel's own bar heights span 0-90%, so any inset box
    # placed inside that axes would sit on top of real data. A dedicated,
    # narrower right-hand panel for the isolation condition's own near-zero
    # distribution avoids that collision entirely.
    fig, (ax, axz) = plt.subplots(
        1, 2, figsize=(11.2, 5.8), dpi=200,
        gridspec_kw={"width_ratios": [5, 1.6], "wspace": 0.3},
    )

    bars = ax.bar(x, means, yerr=sds, capsize=5, color=COLORS,
                   edgecolor="white", linewidth=1.2, width=0.56,
                   error_kw={"ecolor": TEXT_PRIMARY, "elinewidth": 1.4, "capthick": 1.4},
                   zorder=3)

    for i, cfg in enumerate(CONFIGS):
        pts = series[cfg]
        jitter = rng.uniform(-0.16, 0.16, size=len(pts))
        ax.scatter(x[i] + jitter, pts, s=22, color=MUTED_DOT, alpha=0.55,
                   edgecolor="none", zorder=4)

    for i, m in enumerate(means):
        label = f"{m:.2f}%" if m < 5 else f"{m:.1f}%"
        ax.annotate(label, (x[i], m + sds[i] + 3), ha="center", va="bottom",
                    fontsize=13, fontweight="bold", color=TEXT_PRIMARY, zorder=5)

    ax.set_xticks(x)
    ax.set_xticklabels(SHORT_LABELS, fontsize=11.5)
    ax.set_ylabel("Run-level TIER_1 SLA breach rate (%)")
    ax.set_ylim(0, 100)
    ax.set_title("Confirmatory Experiment — Breach Rate by Condition\n(mean $\\pm$ SD, 15 replicates, jittered points)", pad=12)
    ax.yaxis.set_major_formatter(mticker.PercentFormatter(decimals=0))
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.spines["left"].set_color(AXIS)
    ax.spines["bottom"].set_color(AXIS)

    # Right panel: zoomed detail on the isolation condition's own
    # near-zero spread, since it is visually flush with the x-axis at the
    # main panel's scale -- which is itself the headline finding, not a
    # rendering artefact.
    iso = series["E_isolation"]
    iso_jitter = rng.uniform(-0.15, 0.15, size=len(iso))
    iso_mean = statistics.mean(iso)
    axz.bar([0], [iso_mean], color=COLORS[5], edgecolor="white", linewidth=1.2,
            width=0.5, zorder=2)
    axz.scatter(iso_jitter, iso, s=30, color=TEXT_PRIMARY, alpha=0.65,
                edgecolor="none", zorder=3)
    axz.set_xlim(-0.6, 0.6)
    axz.set_ylim(0, 1.4)
    axz.set_xticks([0])
    axz.set_xticklabels(["Full hybrid\n+ isolation"], fontsize=12)
    axz.set_ylabel("Breach rate (%)", fontsize=13)
    axz.set_title(f"Isolation detail\n(mean {iso_mean:.2f}%,\nrange {min(iso):.1f}–{max(iso):.1f}%)",
                   fontsize=12.5, pad=10)
    axz.tick_params(axis="y", labelsize=12)
    axz.grid(axis="y", color=GRID, linewidth=0.7, zorder=0)
    axz.set_axisbelow(True)
    for spine in ("top", "right"):
        axz.spines[spine].set_visible(False)
    axz.spines["left"].set_color(AXIS)
    axz.spines["bottom"].set_color(AXIS)

    out = OUT_DIR / "fig9_confirmatory_breach_rates.png"
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    print(f"[figures] wrote {out}")
    plt.close(fig)


def fig_latency(summary_percentiles: dict[str, dict[str, float]]):
    metrics = ["P50", "P95", "P99"]
    x = np.arange(len(CONFIGS))
    width = 0.26

    fig, ax = plt.subplots(figsize=(8.4, 5.8), dpi=200)
    hatches = ["", "//", ".."]
    for j, metric in enumerate(metrics):
        vals = [summary_percentiles[c][metric] for c in CONFIGS]
        offset = (j - 1) * width
        bars = ax.bar(x + offset, vals, width=width * 0.92, color=COLORS,
                       alpha=[1.0, 0.72, 0.5][j], edgecolor="white", linewidth=0.8,
                       hatch=hatches[j], zorder=3, label=metric)

    ax.set_yscale("log")
    ax.set_xticks(x)
    ax.set_xticklabels(SHORT_LABELS, fontsize=11.5)
    ax.set_ylabel("TIER_1 latency, ms\n(log scale, pooled per condition)")
    ax.set_title("Confirmatory Experiment — Latency Percentiles by Condition\n",
                 pad=12, fontsize=17)
    ax.grid(axis="y", which="major", color=GRID, linewidth=0.8, zorder=0)
    ax.grid(axis="y", which="minor", color=GRID, linewidth=0.4, zorder=0, alpha=0.6)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.spines["left"].set_color(AXIS)
    ax.spines["bottom"].set_color(AXIS)

    # Legend keyed on hatch/alpha (metric), not colour (condition) -- colour
    # already carries condition identity, consistent with "identity never
    # color-alone" for the metric dimension here.
    import matplotlib.patches as mpatches
    legend_handles = [mpatches.Patch(facecolor="#898781", alpha=[1.0, 0.72, 0.5][j],
                                      hatch=hatches[j], edgecolor="white", label=metrics[j])
                       for j in range(3)]
    # Placed over the isolation condition's own bars (far right), which are
    # short enough on the log scale to leave that corner empty -- every
    # other column is tall enough up to 10^4 that a legend box there would
    # sit on top of real bars.
    ax.legend(handles=legend_handles, loc="upper right", frameon=False, title="Percentile")

    fig.tight_layout(rect=(0.0, 0.0, 1.0, 1.0))
    fig.subplots_adjust(left=0.16, top=0.88)
    out = OUT_DIR / "fig10_confirmatory_latency.png"
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    print(f"[figures] wrote {out}")
    plt.close(fig)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    series = load_series()
    fig_breach_rates(series)

    # Pooled P50/P95/P99 as already reported in confirmatory_summary.txt
    # (descriptive only, per Section 3.6.1's unit-of-analysis distinction).
    summary_percentiles = {
        "static_equal": {"P50": 1239, "P95": 2872, "P99": 6319},
        "A_base":       {"P50": 1262, "P95": 2908, "P99": 4576},
        "B_semantic":   {"P50": 1362, "P95": 3271, "P99": 5714},
        "C_lstm":       {"P50": 1269, "P95": 2884, "P99": 3639},
        "D_full":       {"P50": 1313, "P95": 3194, "P99": 10686},
        "E_isolation":  {"P50": 11,   "P95": 26,   "P99": 34},
    }
    fig_latency(summary_percentiles)


if __name__ == "__main__":
    main()
