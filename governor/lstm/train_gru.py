"""
train_gru.py — DOCKER-GENIUS GRU Model Trainer

A second alternative forecaster (alongside ARIMA and the naive persistence
baseline) to test whether "architecture, not model choice, explains why
prediction doesn't help" holds beyond a single alternative model. GRU is
the natural second data point: same recurrent-network family as the LSTM,
same architecture/hyperparameters/training procedure as train.py's stacked
LSTM (only the recurrent cell type differs — see baseline_models.py's
run_gru(), which this script mirrors), so any difference in live governor
behaviour can be attributed to the forecaster's own dynamics rather than to
a confound in training setup.

Reuses train.py's exact data loading and embargoed temporal split (the
same leakage-corrected 60/20/20 split documented in the paper/thesis) so
results are directly comparable to the LSTM's and ARIMA's own numbers.

Outputs (saved alongside this script):
    lstm/gru_model.keras          — trained Keras GRU model
    lstm/gru_scaler.pkl           — fitted MinMaxScaler (for live inference)
    lstm/gru_training_report.json — held-out test MAE/RMSE, same format as
                                     train.py's training_report.json

Usage:
    python3 lstm/train_gru.py [--data lstm/training_data.csv]
"""

import argparse
import hashlib
import json
import pickle
import platform
import time
from pathlib import Path

import numpy as np

import train as lstm_train  # reuse WINDOW_SIZE/HORIZON/FEATURES/embargoed split

MODEL_PATH  = Path(__file__).parent / "gru_model.keras"
SCALER_PATH = Path(__file__).parent / "gru_scaler.pkl"
REPORT_PATH = Path(__file__).parent / "gru_training_report.json"


def build_gru_model():
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import GRU, Dense, Dropout, Reshape
    from tensorflow.keras.optimizers import Adam

    model = Sequential([
        GRU(lstm_train.LSTM_UNITS_1, return_sequences=True,
            input_shape=(lstm_train.WINDOW_SIZE, lstm_train.N_FEATURES)),
        Dropout(lstm_train.DROPOUT),
        GRU(lstm_train.LSTM_UNITS_2, return_sequences=False),
        Dropout(lstm_train.DROPOUT),
        Dense(lstm_train.HORIZON * lstm_train.N_FEATURES),
        Reshape((lstm_train.HORIZON, lstm_train.N_FEATURES)),
    ], name="docker_genius_gru")
    model.compile(optimizer=Adam(learning_rate=lstm_train.LEARNING_RATE),
                  loss="mse", metrics=["mae"])
    model.summary()
    return model


def train(csv_path: str):
    from sklearn.preprocessing import MinMaxScaler
    from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint

    df = lstm_train.load_data(csv_path)

    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(df[lstm_train.FEATURES].values)

    (X_train, y_train), (X_val, y_val), (X_test, y_test) = \
        lstm_train.make_embargoed_splits(scaled)
    n = len(X_train) + len(X_val) + len(X_test)
    print(f"[train_gru] Windows (post-embargo) — train: {X_train.shape}  "
          f"val: {X_val.shape}  test: {X_test.shape}")
    if len(X_test) == 0:
        raise SystemExit("[train_gru] ERROR: empty test split — collect more data.")

    model = build_gru_model()

    callbacks = [
        EarlyStopping(monitor="val_loss", patience=lstm_train.PATIENCE,
                      restore_best_weights=True, verbose=1),
        ModelCheckpoint(str(MODEL_PATH), monitor="val_loss",
                        save_best_only=True, verbose=0),
    ]

    train_start = time.perf_counter()
    print(f"\n[train_gru] Training for up to {lstm_train.EPOCHS} epochs "
          f"(early stop patience={lstm_train.PATIENCE})…")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=lstm_train.EPOCHS,
        batch_size=lstm_train.BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )
    train_wall_s = time.perf_counter() - train_start
    epochs_run = len(history.history["loss"])

    with open(SCALER_PATH, "wb") as f:
        pickle.dump(scaler, f)
    print(f"[train_gru] Scaler saved → {SCALER_PATH}")
    print(f"[train_gru] Model  saved → {MODEL_PATH}")

    val_loss, val_mae_scaled = model.evaluate(X_val, y_val, verbose=0)

    test_pred_scaled = model.predict(X_test, verbose=0)

    def inverse_all(arr_scaled: np.ndarray) -> np.ndarray:
        flat = arr_scaled.reshape(-1, lstm_train.N_FEATURES)
        return scaler.inverse_transform(flat).reshape(arr_scaled.shape)

    test_pred = inverse_all(test_pred_scaled)
    test_true = inverse_all(y_test)

    cpu_err = test_pred[:, :, 0] - test_true[:, :, 0]
    mem_err = test_pred[:, :, 1] - test_true[:, :, 1]
    cpu_mae = float(np.mean(np.abs(cpu_err)))
    cpu_rmse = float(np.sqrt(np.mean(cpu_err ** 2)))
    mem_mae = float(np.mean(np.abs(mem_err)))
    mem_rmse = float(np.sqrt(np.mean(mem_err ** 2)))

    print(f"\n[train_gru] Val  MSE(scaled): {val_loss:.6f}  MAE(scaled): {val_mae_scaled:.6f}")
    print(f"[train_gru] Test CPU — MAE: {cpu_mae:.3f}%  RMSE: {cpu_rmse:.3f}%  "
          f"(n={len(X_test)} held-out windows)")
    print(f"[train_gru] Test MEM — MAE: {mem_mae:.3f} MB  RMSE: {mem_rmse:.3f} MB")

    single_window = X_test[:1] if len(X_test) else X_val[:1]
    model.predict(single_window, verbose=0)
    n_timing_runs = 20
    t0 = time.perf_counter()
    for _ in range(n_timing_runs):
        model.predict(single_window, verbose=0)
    inference_ms = (time.perf_counter() - t0) / n_timing_runs * 1000
    print(f"[train_gru] Inference time (single window, warm): {inference_ms:.2f} ms")

    try:
        import tensorflow as tf
        tf_version = tf.__version__
    except Exception:
        tf_version = "unknown"

    report = {
        "dataset": {
            "csv_path": str(csv_path),
            "raw_rows": int(len(df)),
            "windowed_samples": int(n),
            "train_samples": int(len(X_train)),
            "val_samples": int(len(X_val)),
            "test_samples": int(len(X_test)),
            "split": f"60%/20%/20% (train/val/test, temporal, no shuffle, "
                     f"{lstm_train.EMBARGO}-step embargo at each internal boundary)",
            "embargo_steps": lstm_train.EMBARGO,
        },
        "architecture": {
            "cell_type": "GRU",
            "window_size_steps": lstm_train.WINDOW_SIZE,
            "horizon_steps": lstm_train.HORIZON,
            "features": lstm_train.FEATURES,
            "gru_units": [lstm_train.LSTM_UNITS_1, lstm_train.LSTM_UNITS_2],
            "dropout": lstm_train.DROPOUT,
        },
        "training_config": {
            "optimizer": "Adam",
            "learning_rate": lstm_train.LEARNING_RATE,
            "loss": "mse",
            "batch_size": lstm_train.BATCH_SIZE,
            "max_epochs": lstm_train.EPOCHS,
            "epochs_run": epochs_run,
            "early_stopping_patience": lstm_train.PATIENCE,
            "train_wall_time_s": round(train_wall_s, 1),
        },
        "hardware": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor() or platform.machine(),
            "python_version": platform.python_version(),
            "tensorflow_version": tf_version,
        },
        "results": {
            "val_mse_scaled": round(float(val_loss), 6),
            "val_mae_scaled": round(float(val_mae_scaled), 6),
            "test_cpu_mae_pct": round(cpu_mae, 3),
            "test_cpu_rmse_pct": round(cpu_rmse, 3),
            "test_mem_mae_mb": round(mem_mae, 3),
            "test_mem_rmse_mb": round(mem_rmse, 3),
            "inference_time_ms_mean": round(inference_ms, 2),
            "inference_time_runs": n_timing_runs,
        },
        "checksums_sha256": {
            "gru_model.keras": hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(),
            "gru_scaler.pkl": hashlib.sha256(SCALER_PATH.read_bytes()).hexdigest(),
        },
    }
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[train_gru] Training report → {REPORT_PATH}")
    print("\n[train_gru] Training complete.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS GRU trainer")
    ap.add_argument("--data", default="lstm/training_data.csv",
                     help="Path to CSV from collect_training_data.py")
    args = ap.parse_args()
    train(args.data)
