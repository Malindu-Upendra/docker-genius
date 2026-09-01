"""
baseline_models.py — DOCKER-GENIUS Forecaster Baseline Comparison

Trains/evaluates GRU, XGBoost, ARIMA, and a lightweight Transformer against
the exact same 70/15/15 temporal split used by train.py's stacked LSTM, so
the paper's baseline-comparison table cites real numbers instead of an
unsupported assertion that "LSTM outperforms X".

IMPORTANT — honesty note on the "Transformer" baseline:
    This is a small single-block multi-head self-attention encoder, NOT a
    full Temporal Fusion Transformer (TFT). TFT's variable-selection
    networks, gated residual networks, and quantile outputs are out of
    scope here given time constraints. In the paper, label this row
    "Transformer (lightweight, TFT-inspired)" — do not call it TFT.

Usage:
    python3 lstm/baseline_models.py [--data lstm/training_data.csv]

Outputs:
    lstm/baseline_report.json  — MAE/RMSE per model, same units as
                                   training_report.json's LSTM numbers, so
                                   the two can be dropped straight into one
                                   comparison table.
"""

import argparse
import json
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

import train as lstm_train  # reuse WINDOW_SIZE/HORIZON/FEATURES/splits/scaler

REPORT_PATH = Path(__file__).parent / "baseline_report.json"


# ── Shared data prep (identical split to lstm/train.py) ───────────────────────

def prepare_data(csv_path: str):
    from sklearn.preprocessing import MinMaxScaler

    df = lstm_train.load_data(csv_path)
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(df[lstm_train.FEATURES].values)

    X, y = lstm_train.make_windows(scaled)
    n = len(X)
    train_end = int(n * (1 - lstm_train.VAL_SPLIT - lstm_train.TEST_SPLIT))
    val_end   = int(n * (1 - lstm_train.TEST_SPLIT))

    splits = {
        "X_train": X[:train_end],       "y_train": y[:train_end],
        "X_val":   X[train_end:val_end], "y_val":   y[train_end:val_end],
        "X_test":  X[val_end:],          "y_test":  y[val_end:],
    }
    return df, scaler, splits, n, train_end, val_end


def inverse_all(scaler, arr_scaled: np.ndarray) -> np.ndarray:
    flat = arr_scaled.reshape(-1, lstm_train.N_FEATURES)
    return scaler.inverse_transform(flat).reshape(arr_scaled.shape)


def real_unit_errors(pred_real: np.ndarray, true_real: np.ndarray) -> dict:
    cpu_err = pred_real[:, :, 0] - true_real[:, :, 0]
    mem_err = pred_real[:, :, 1] - true_real[:, :, 1]
    return {
        "cpu_mae_pct":  round(float(np.mean(np.abs(cpu_err))), 3),
        "cpu_rmse_pct": round(float(np.sqrt(np.mean(cpu_err ** 2))), 3),
        "mem_mae_mb":   round(float(np.mean(np.abs(mem_err))), 3),
        "mem_rmse_mb":  round(float(np.sqrt(np.mean(mem_err ** 2))), 3),
    }


# ── GRU (same shape/hyperparameters as the LSTM, only the recurrent cell differs) ──

def run_gru(scaler, splits) -> dict:
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import GRU, Dense, Dropout, Reshape
    from tensorflow.keras.optimizers import Adam
    from tensorflow.keras.callbacks import EarlyStopping

    model = Sequential([
        GRU(lstm_train.LSTM_UNITS_1, return_sequences=True,
            input_shape=(lstm_train.WINDOW_SIZE, lstm_train.N_FEATURES)),
        Dropout(lstm_train.DROPOUT),
        GRU(lstm_train.LSTM_UNITS_2, return_sequences=False),
        Dropout(lstm_train.DROPOUT),
        Dense(lstm_train.HORIZON * lstm_train.N_FEATURES),
        Reshape((lstm_train.HORIZON, lstm_train.N_FEATURES)),
    ], name="baseline_gru")
    model.compile(optimizer=Adam(learning_rate=lstm_train.LEARNING_RATE),
                  loss="mse", metrics=["mae"])

    t0 = time.perf_counter()
    model.fit(splits["X_train"], splits["y_train"],
               validation_data=(splits["X_val"], splits["y_val"]),
               epochs=lstm_train.EPOCHS, batch_size=lstm_train.BATCH_SIZE,
               callbacks=[EarlyStopping(monitor="val_loss",
                                        patience=lstm_train.PATIENCE,
                                        restore_best_weights=True)],
               verbose=0)
    train_s = time.perf_counter() - t0

    pred = model.predict(splits["X_test"], verbose=0)
    errs = real_unit_errors(inverse_all(scaler, pred),
                             inverse_all(scaler, splits["y_test"]))
    errs["train_wall_time_s"] = round(train_s, 1)
    return errs


# ── XGBoost (flattened window -> flattened horizon, multi-output regression) ──

def run_xgboost(scaler, splits) -> dict:
    from xgboost import XGBRegressor
    from sklearn.multioutput import MultiOutputRegressor

    def flat(a):
        return a.reshape(len(a), -1)

    Xtr, Xte = flat(splits["X_train"]), flat(splits["X_test"])
    ytr = flat(splits["y_train"])

    t0 = time.perf_counter()
    model = MultiOutputRegressor(
        XGBRegressor(n_estimators=300, max_depth=5, learning_rate=0.08,
                     subsample=0.9, colsample_bytree=0.9, random_state=42,
                     n_jobs=-1)
    )
    model.fit(Xtr, ytr)
    train_s = time.perf_counter() - t0

    pred_flat = model.predict(Xte)
    pred = pred_flat.reshape(splits["y_test"].shape)
    errs = real_unit_errors(inverse_all(scaler, pred),
                             inverse_all(scaler, splits["y_test"]))
    errs["train_wall_time_s"] = round(train_s, 1)
    return errs


# ── Lightweight Transformer (single self-attention block — see module docstring) ──

def run_transformer(scaler, splits) -> dict:
    from tensorflow.keras import layers, Model
    from tensorflow.keras.optimizers import Adam
    from tensorflow.keras.callbacks import EarlyStopping

    inputs = layers.Input(shape=(lstm_train.WINDOW_SIZE, lstm_train.N_FEATURES))
    proj = layers.Dense(32)(inputs)
    attn = layers.MultiHeadAttention(num_heads=4, key_dim=16)(proj, proj)
    x = layers.LayerNormalization()(proj + attn)
    ff = layers.Dense(64, activation="relu")(x)
    ff = layers.Dense(32)(ff)
    x = layers.LayerNormalization()(x + ff)
    x = layers.GlobalAveragePooling1D()(x)
    x = layers.Dense(64, activation="relu")(x)
    outputs = layers.Dense(lstm_train.HORIZON * lstm_train.N_FEATURES)(x)
    outputs = layers.Reshape((lstm_train.HORIZON, lstm_train.N_FEATURES))(outputs)

    model = Model(inputs, outputs, name="baseline_transformer")
    model.compile(optimizer=Adam(learning_rate=lstm_train.LEARNING_RATE),
                  loss="mse", metrics=["mae"])

    t0 = time.perf_counter()
    model.fit(splits["X_train"], splits["y_train"],
               validation_data=(splits["X_val"], splits["y_val"]),
               epochs=lstm_train.EPOCHS, batch_size=lstm_train.BATCH_SIZE,
               callbacks=[EarlyStopping(monitor="val_loss",
                                        patience=lstm_train.PATIENCE,
                                        restore_best_weights=True)],
               verbose=0)
    train_s = time.perf_counter() - t0

    pred = model.predict(splits["X_test"], verbose=0)
    errs = real_unit_errors(inverse_all(scaler, pred),
                             inverse_all(scaler, splits["y_test"]))
    errs["train_wall_time_s"] = round(train_s, 1)
    return errs


# ── ARIMA (univariate, real units, walk-forward via append(refit=False)) ─────

def _fit_best_arima(series: np.ndarray):
    from statsmodels.tsa.arima.model import ARIMA
    candidates = [(1, 1, 1), (2, 1, 2), (5, 1, 0)]
    best = None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for order in candidates:
            try:
                res = ARIMA(series, order=order).fit()
                if best is None or res.aic < best[0]:
                    best = (res.aic, order, res)
            except Exception:
                continue
    return best[1], best[2]


def run_arima(df: pd.DataFrame, n_windows: int, train_end: int, val_end: int) -> dict:
    """
    Walk-forward ARIMA on the raw (unscaled) cpu_pct / mem_mb series.
    Fit order + parameters on history through the first test forecast
    origin (train+val, same information the LSTM had), then for each
    subsequent test window append the one new real observation and
    re-forecast without refitting — the standard efficient walk-forward
    pattern, not a full refit per window.
    """
    from statsmodels.tsa.arima.model import ARIMA

    W, H = lstm_train.WINDOW_SIZE, lstm_train.HORIZON
    results = {}
    for col, key in [("cpu_pct", "cpu"), ("mem_mb", "mem")]:
        series = df[col].values.astype(float)

        first_origin = val_end + W - 1     # index of last observed point for first test window
        order, res = _fit_best_arima(series[: first_origin + 1])

        preds, trues = [], []
        t0 = time.perf_counter()
        cur = res
        last_included = first_origin
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for i in range(val_end, n_windows):
                origin = i + W - 1
                if origin > last_included:
                    new_obs = series[last_included + 1: origin + 1]
                    cur = cur.append(new_obs, refit=False)
                    last_included = origin
                fc = cur.get_forecast(steps=H).predicted_mean
                preds.append(fc)
                trues.append(series[origin + 1: origin + 1 + H])
        fit_s = time.perf_counter() - t0

        preds = np.array(preds)
        trues = np.array(trues)
        err = preds - trues
        results[key] = {
            "order": order,
            "mae": round(float(np.mean(np.abs(err))), 3),
            "rmse": round(float(np.sqrt(np.mean(err ** 2))), 3),
            "wall_time_s": round(fit_s, 1),
        }

    return {
        "cpu_mae_pct":  results["cpu"]["mae"],
        "cpu_rmse_pct": results["cpu"]["rmse"],
        "mem_mae_mb":   results["mem"]["mae"],
        "mem_rmse_mb":  results["mem"]["rmse"],
        "cpu_order": results["cpu"]["order"],
        "mem_order": results["mem"]["order"],
        "train_wall_time_s": round(results["cpu"]["wall_time_s"]
                                    + results["mem"]["wall_time_s"], 1),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS baseline forecaster comparison")
    ap.add_argument("--data", default="lstm/training_data.csv")
    ap.add_argument("--models", default="gru,xgboost,transformer,arima",
                     help="Comma-separated subset to run")
    args = ap.parse_args()

    df, scaler, splits, n, train_end, val_end = prepare_data(args.data)
    print(f"[baseline] Windows: train={len(splits['X_train'])}  "
          f"val={len(splits['X_val'])}  test={len(splits['X_test'])}")

    requested = set(args.models.split(","))
    report = {"dataset": {"csv_path": args.data, "windowed_samples": n}}

    if "gru" in requested:
        print("[baseline] Training GRU…")
        report["gru"] = run_gru(scaler, splits)
        print(f"  GRU  — CPU MAE {report['gru']['cpu_mae_pct']}%  "
              f"RMSE {report['gru']['cpu_rmse_pct']}%")

    if "xgboost" in requested:
        print("[baseline] Training XGBoost…")
        report["xgboost"] = run_xgboost(scaler, splits)
        print(f"  XGB  — CPU MAE {report['xgboost']['cpu_mae_pct']}%  "
              f"RMSE {report['xgboost']['cpu_rmse_pct']}%")

    if "transformer" in requested:
        print("[baseline] Training lightweight Transformer…")
        report["transformer"] = run_transformer(scaler, splits)
        print(f"  Xfmr — CPU MAE {report['transformer']['cpu_mae_pct']}%  "
              f"RMSE {report['transformer']['cpu_rmse_pct']}%")

    if "arima" in requested:
        print("[baseline] Fitting ARIMA (walk-forward)…")
        report["arima"] = run_arima(df, n, train_end, val_end)
        print(f"  ARIMA— CPU MAE {report['arima']['cpu_mae_pct']}%  "
              f"RMSE {report['arima']['cpu_rmse_pct']}%")

    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n[baseline] Report saved → {REPORT_PATH}")
    print("[baseline] Cross-reference lstm/training_report.json for the LSTM's own numbers.")


if __name__ == "__main__":
    main()
