"""
cross_intensity_eval.py — DOCKER-GENIUS Cross-Intensity Generalisation Check

Addresses supervisor review item #10 ("Training and evaluation use the same
load intensity ... Test generalisation on workload profiles that were not
represented during training"). Evaluates the ALREADY-TRAINED LSTM (no
retraining) on freshly-collected telemetry from load intensities it never
saw during training: a lighter profile (N_TIER1=4, N_TIER3=1) and a
heavier profile (N_TIER1=12, N_TIER3=3), versus the trained-on intensity
(N_TIER1=8, N_TIER3=2 -- mixed_load.py's defaults, matching
training_data.csv).

Uses the model's own fitted scaler (scaler.pkl) to transform the new data
-- it is not re-fit -- so this is a genuine out-of-distribution test of
what the model already learned, not a new training run.

Usage:
    python3 lstm/cross_intensity_eval.py

Outputs:
    lstm/cross_intensity_report.json
"""
import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

import train as lstm_train

HERE = Path(__file__).parent
UNSEEN_PROFILES = {
    "light (n_tier1=4, n_tier3=1)":  HERE / "unseen_intensity_light.csv",
    "heavy (n_tier1=12, n_tier3=3)": HERE / "unseen_intensity_heavy.csv",
}


def trained_on_baseline(model, scaler):
    """The model's own held-out TEST split from training_data.csv (the same
    151 windows reported as 21.1% MAE elsewhere in the paper) -- NOT the
    full training series, which would unfairly include data the model was
    actually fit on. This is the fair, apples-to-apples baseline the
    unseen-intensity numbers below are compared against."""
    df = lstm_train.load_data(str(HERE / "training_data.csv"))
    scaled = scaler.transform(df[lstm_train.FEATURES].values)
    (_, _), (_, _), (X_test, y_test) = lstm_train.make_embargoed_splits(scaled)

    pred_scaled = model.predict(X_test, verbose=0)

    def inverse(arr):
        flat = arr.reshape(-1, lstm_train.N_FEATURES)
        return scaler.inverse_transform(flat).reshape(arr.shape)

    pred, true = inverse(pred_scaled), inverse(y_test)
    cpu_err = pred[:, :, 0] - true[:, :, 0]
    mem_err = pred[:, :, 1] - true[:, :, 1]
    return {
        "n_raw_samples": int(len(df)),
        "n_windows": int(len(X_test)),
        "cpu_mae_pct": round(float(np.mean(np.abs(cpu_err))), 3),
        "cpu_rmse_pct": round(float(np.sqrt(np.mean(cpu_err ** 2))), 3),
        "mem_mae_mb": round(float(np.mean(np.abs(mem_err))), 3),
        "mem_rmse_mb": round(float(np.sqrt(np.mean(mem_err ** 2))), 3),
        "true_cpu_mean": round(float(true[:, :, 0].mean()), 2),
        "true_cpu_max": round(float(true[:, :, 0].max()), 2),
    }


def evaluate(csv_path: Path, model, scaler):
    df = pd.read_csv(csv_path, parse_dates=["ts"])
    df = df[lstm_train.FEATURES].dropna()
    scaled = scaler.transform(df.values)  # NOT fit_transform -- reuse the trained scaler
    X, y = lstm_train.make_windows(scaled)
    if len(X) == 0:
        return None

    pred_scaled = model.predict(X, verbose=0)

    def inverse(arr):
        flat = arr.reshape(-1, lstm_train.N_FEATURES)
        return scaler.inverse_transform(flat).reshape(arr.shape)

    pred = inverse(pred_scaled)
    true = inverse(y)
    cpu_err = pred[:, :, 0] - true[:, :, 0]
    mem_err = pred[:, :, 1] - true[:, :, 1]
    return {
        "n_raw_samples": int(len(df)),
        "n_windows": int(len(X)),
        "cpu_mae_pct": round(float(np.mean(np.abs(cpu_err))), 3),
        "cpu_rmse_pct": round(float(np.sqrt(np.mean(cpu_err ** 2))), 3),
        "mem_mae_mb": round(float(np.mean(np.abs(mem_err))), 3),
        "mem_rmse_mb": round(float(np.sqrt(np.mean(mem_err ** 2))), 3),
        "true_cpu_mean": round(float(true[:, :, 0].mean()), 2),
        "true_cpu_max": round(float(true[:, :, 0].max()), 2),
    }


def main():
    from tensorflow.keras.models import load_model

    model = load_model(HERE / "model.keras")
    with open(HERE / "scaler.pkl", "rb") as f:
        scaler = pickle.load(f)

    report = {}

    baseline = trained_on_baseline(model, scaler)
    report["trained_on (n_tier1=8, n_tier3=2), held-out test split"] = baseline
    print(f"{'trained_on (held-out test split)':35s} n_windows={baseline['n_windows']:4d}  "
          f"CPU MAE={baseline['cpu_mae_pct']:6.2f}%  RMSE={baseline['cpu_rmse_pct']:6.2f}%  "
          f"(true CPU mean={baseline['true_cpu_mean']:.1f}%, max={baseline['true_cpu_max']:.1f}%)")

    for label, path in UNSEEN_PROFILES.items():
        if not path.exists():
            print(f"[cross-intensity] SKIP {label} -- {path} not found")
            continue
        result = evaluate(path, model, scaler)
        report[label] = result
        print(f"{label:35s} n_windows={result['n_windows']:4d}  "
              f"CPU MAE={result['cpu_mae_pct']:6.2f}%  RMSE={result['cpu_rmse_pct']:6.2f}%  "
              f"(true CPU mean={result['true_cpu_mean']:.1f}%, max={result['true_cpu_max']:.1f}%)")

    with open(HERE / "cross_intensity_report.json", "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nSaved -> {HERE / 'cross_intensity_report.json'}")


if __name__ == "__main__":
    main()
