"""
forecast_diagnostics_multi.py — Event-level recall for the persistence and
GRU forecasters, on the exact same held-out test windows/threshold as
forecast_diagnostics.py's LSTM check, so the multi-model table in the paper
(LSTM 0%, ARIMA 6.3%, persistence/GRU below) is directly comparable.

Usage:
    python3 lstm/forecast_diagnostics_multi.py
"""
import json
import pickle
from pathlib import Path

import numpy as np

import train as lstm_train
from forecast_diagnostics import event_level_metrics, CPU_EVENT_THRESHOLD

HERE = Path(__file__).parent


def get_test_split():
    df = lstm_train.load_data("lstm/training_data.csv")
    with open(HERE / "scaler.pkl", "rb") as f:
        scaler = pickle.load(f)   # same scaler fit used for LSTM/GRU (same data, same fit call)
    scaled = scaler.transform(df[lstm_train.FEATURES].values)
    (_, _), (_, _), (X_test, y_test) = lstm_train.make_embargoed_splits(scaled)
    return df, scaler, X_test, y_test


def inverse(scaler, arr):
    flat = arr.reshape(-1, lstm_train.N_FEATURES)
    return scaler.inverse_transform(flat).reshape(arr.shape)


def persistence_predictions(X_test, y_test, scaler):
    last_obs = X_test[:, -1:, :]
    pred_scaled = np.repeat(last_obs, lstm_train.HORIZON, axis=1)
    return inverse(scaler, pred_scaled), inverse(scaler, y_test)


def gru_predictions(X_test, y_test):
    from tensorflow.keras.models import load_model
    with open(HERE / "gru_scaler.pkl", "rb") as f:
        gru_scaler = pickle.load(f)
    model = load_model(HERE / "gru_model.keras")
    pred_scaled = model.predict(X_test, verbose=0)
    return inverse(gru_scaler, pred_scaled), inverse(gru_scaler, y_test)


def main():
    df, scaler, X_test, y_test = get_test_split()

    report = {}

    pred, true = persistence_predictions(X_test, y_test, scaler)
    report["persistence"] = event_level_metrics(pred, true, CPU_EVENT_THRESHOLD)
    print(f"[diagnostics] Persistence — recall={report['persistence']['recall']}  "
          f"precision={report['persistence']['precision']}  "
          f"n_true_events={report['persistence']['n_true_events']}")

    pred, true = gru_predictions(X_test, y_test)
    report["gru"] = event_level_metrics(pred, true, CPU_EVENT_THRESHOLD)
    print(f"[diagnostics] GRU — recall={report['gru']['recall']}  "
          f"precision={report['gru']['precision']}  "
          f"n_true_events={report['gru']['n_true_events']}")

    out_path = HERE / "forecast_diagnostics_multi.json"
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[diagnostics] Report -> {out_path}")


if __name__ == "__main__":
    main()
