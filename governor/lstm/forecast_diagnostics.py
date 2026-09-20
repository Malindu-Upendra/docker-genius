"""
forecast_diagnostics.py — DOCKER-GENIUS Forecast Usefulness Diagnostics

Added per supervisor review items #18 and #19:
  #18 "Forecast metrics do not measure controller usefulness" -- adds
      event-level precision/recall/false-alarm-rate/warning-lead-time for
      CPU utilisation events above the rule engine's own CPU_HIGH threshold
      (75%), computed on the corrected, leakage-free held-out test set
      (see train.py's make_embargoed_splits / NEXT_STEPS.md).
  #19 "Only a visually selected forecast window is shown" -- adds an
      aggregate error-by-horizon plot, a residual distribution, and an
      OBJECTIVE (rank-based, not eyeballed) selection of the best/median/
      worst test windows by per-window MAE.

Usage:
    python3 lstm/forecast_diagnostics.py [--data lstm/training_data.csv]

Outputs:
    lstm/forecast_diagnostics.json  -- event-level metrics + summary stats
    lstm/fig_forecast_diagnostics.png -- the aggregate figure for the paper
"""
import argparse
import json
from pathlib import Path

import numpy as np

import train as lstm_train

REPORT_PATH = Path(__file__).parent / "forecast_diagnostics.json"
FIG_PATH    = Path(__file__).parent / "fig_forecast_diagnostics.png"

CPU_EVENT_THRESHOLD = 75.0  # matches rule_engine.py's CPU_HIGH


def load_test_predictions(csv_path: str):
    import pickle
    from tensorflow.keras.models import load_model
    from sklearn.preprocessing import MinMaxScaler

    df = lstm_train.load_data(csv_path)
    with open(Path(__file__).parent / "scaler.pkl", "rb") as f:
        scaler: MinMaxScaler = pickle.load(f)
    scaled = scaler.transform(df[lstm_train.FEATURES].values)

    (_, _), (_, _), (X_test, y_test) = lstm_train.make_embargoed_splits(scaled)

    model = load_model(Path(__file__).parent / "model.keras")
    pred_scaled = model.predict(X_test, verbose=0)

    def inverse(arr):
        flat = arr.reshape(-1, lstm_train.N_FEATURES)
        return scaler.inverse_transform(flat).reshape(arr.shape)

    pred = inverse(pred_scaled)   # (n, H, 2)  [:,:,0]=cpu_pct  [:,:,1]=mem_mb
    true = inverse(y_test)
    return pred, true


def event_level_metrics(pred, true, threshold=CPU_EVENT_THRESHOLD):
    n, H, _ = true.shape
    cpu_true = true[:, :, 0]
    cpu_pred = pred[:, :, 0]

    true_event = (cpu_true > threshold).any(axis=1)
    pred_event = (cpu_pred > threshold).any(axis=1)

    tp = int(np.sum(true_event & pred_event))
    fn = int(np.sum(true_event & ~pred_event))
    fp = int(np.sum(~true_event & pred_event))
    tn = int(np.sum(~true_event & ~pred_event))

    recall    = tp / (tp + fn) if (tp + fn) else float("nan")
    precision = tp / (tp + fp) if (tp + fp) else float("nan")
    false_alarm_rate = fp / (fp + tn) if (fp + tn) else float("nan")

    # Warning lead time: for true positives, the first horizon step (in
    # seconds) at which the TRUE series crosses the threshold. Since the
    # entire H-step forecast is issued at t=0 (this is a batch, not a
    # streaming, forecast), correctly flagging that crossing anywhere in
    # the predicted horizon is equivalent to an alarm raised `lead` seconds
    # before the event actually occurs.
    lead_times = []
    for i in range(n):
        if true_event[i] and pred_event[i]:
            true_cross = int(np.argmax(cpu_true[i] > threshold))
            lead_times.append(true_cross)  # seconds of advance warning

    return {
        "threshold_pct": threshold,
        "n_test_windows": n,
        "n_true_events": int(true_event.sum()),
        "n_predicted_events": int(pred_event.sum()),
        "tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "recall": round(recall, 3) if recall == recall else None,
        "precision": round(precision, 3) if precision == precision else None,
        "false_alarm_rate": round(false_alarm_rate, 3) if false_alarm_rate == false_alarm_rate else None,
        "median_lead_time_s": round(float(np.median(lead_times)), 1) if lead_times else None,
        "mean_lead_time_s": round(float(np.mean(lead_times)), 1) if lead_times else None,
        "n_lead_time_samples": len(lead_times),
    }


def aggregate_and_plot(pred, true):
    cpu_true, cpu_pred = true[:, :, 0], pred[:, :, 0]
    n, H = cpu_true.shape

    # Error by horizon step (MAE at each of the H forecast steps, across all windows)
    err = cpu_pred - cpu_true
    mae_by_step = np.mean(np.abs(err), axis=0)   # (H,)

    # Per-window MAE, for OBJECTIVE best/median/worst selection (rank-based,
    # not eyeballed) -- addresses review item #19 directly.
    per_window_mae = np.mean(np.abs(err), axis=1)  # (n,)
    order = np.argsort(per_window_mae)
    best_idx   = int(order[0])
    worst_idx  = int(order[-1])
    median_idx = int(order[len(order) // 2])

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 2, figsize=(11, 8))

    axes[0, 0].plot(range(1, H + 1), mae_by_step, marker="o", ms=3)
    axes[0, 0].set_title("CPU forecast MAE by horizon step")
    axes[0, 0].set_xlabel("Steps ahead (s)"); axes[0, 0].set_ylabel("MAE (pp)")

    axes[0, 1].hist(err.flatten(), bins=40)
    axes[0, 1].set_title("CPU forecast residual distribution\n(pred - true, all windows/steps)")
    axes[0, 1].set_xlabel("Residual (pp)"); axes[0, 1].set_ylabel("Count")

    for ax, idx, label in [
        (axes[1, 0], best_idx, f"Best window (rank 1/{n} by MAE)"),
        (axes[1, 1], worst_idx, f"Worst window (rank {n}/{n} by MAE)"),
    ]:
        ax.plot(range(1, H + 1), cpu_true[idx], label="Actual", lw=2)
        ax.plot(range(1, H + 1), cpu_pred[idx], label="Forecast", lw=2, ls="--")
        ax.axhline(CPU_EVENT_THRESHOLD, color="gray", ls=":", lw=1)
        ax.set_title(label + f" (MAE={per_window_mae[idx]:.1f}pp)")
        ax.set_xlabel("Steps ahead (s)"); ax.set_ylabel("CPU %")
        ax.legend(fontsize=8)

    fig.suptitle("DOCKER-GENIUS LSTM Forecast Diagnostics (held-out test set)")
    fig.tight_layout()
    fig.savefig(FIG_PATH, dpi=130)

    return {
        "mae_by_horizon_step": [round(float(x), 3) for x in mae_by_step],
        "best_window_idx": best_idx, "best_window_mae": round(float(per_window_mae[best_idx]), 3),
        "median_window_idx": median_idx, "median_window_mae": round(float(per_window_mae[median_idx]), 3),
        "worst_window_idx": worst_idx, "worst_window_mae": round(float(per_window_mae[worst_idx]), 3),
        "residual_mean": round(float(np.mean(err)), 3),
        "residual_std": round(float(np.std(err)), 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="lstm/training_data.csv")
    args = ap.parse_args()

    pred, true = load_test_predictions(args.data)
    events = event_level_metrics(pred, true)
    agg = aggregate_and_plot(pred, true)

    report = {"event_level": events, "aggregate": agg}
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))
    print(f"\n[diagnostics] Figure -> {FIG_PATH}")
    print(f"[diagnostics] Report -> {REPORT_PATH}")


if __name__ == "__main__":
    main()
