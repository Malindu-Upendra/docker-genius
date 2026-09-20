"""
train.py — DOCKER-GENIUS LSTM Model Trainer

Reads telemetry CSV collected by collect_training_data.py, builds and trains
a two-layer stacked LSTM that forecasts CPU% and memory (MB) N steps ahead.

Architecture:
    Input  : (WINDOW_SIZE, 2)  — last WINDOW_SIZE seconds of [cpu_pct, mem_mb]
    Layer 1: LSTM(64, return_sequences=True) + Dropout(0.2)
    Layer 2: LSTM(32)           + Dropout(0.2)
    Output : Dense → Reshape → (HORIZON, 2)  — next HORIZON seconds

Outputs (saved alongside this script):
    lstm/model.keras         — trained Keras model
    lstm/scaler.pkl          — fitted MinMaxScaler (for live inference)
    lstm/train_plot.png      — loss curve (optional, requires matplotlib)
    lstm/training_report.json — full training config + held-out test MAE/RMSE
                                 (source of truth for the paper's LSTM details
                                 table — do not hand-write those numbers)

Usage:
    python3 lstm/train.py [--data lstm/training_data.csv]
"""

import argparse
import hashlib
import json
import pickle
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

# ── Hyper-parameters (match these in predictor.py) ────────────────────────────
WINDOW_SIZE  = 60      # history steps fed to LSTM  (60s at 1-s sampling)
HORIZON      = 30      # steps to forecast ahead    (30s at 1-s sampling)
FEATURES     = ["cpu_pct", "mem_mb"]
N_FEATURES   = len(FEATURES)

LSTM_UNITS_1  = 64
LSTM_UNITS_2  = 32
DROPOUT       = 0.2
EPOCHS        = 50
BATCH_SIZE    = 32
LEARNING_RATE = 0.001   # Adam — stated explicitly rather than left as an
                         # unstated framework default, since the paper's
                         # LSTM details table needs to cite a real number
VAL_SPLIT    = 0.20     # of the full dataset -- widened from the original
                         # 15% specifically to leave room for the EMBARGO
                         # (see below): at only 1,196 raw samples, a 15%
                         # val split leaves just ~89 raw rows once a
                         # 90-step embargo is cut from it, i.e. zero windows.
                         # 20% leaves ~149 raw rows -> 60 val windows.
TEST_SPLIT   = 0.20     # of the full dataset — held out, untouched by
                         # training/early-stopping/checkpointing (proposal
                         # §3.2 promises train/val/test with MAE/RMSE on
                         # held-out test sequences; the previous version of
                         # this script only had train/val). Also widened
                         # from 15% to 20% for the same embargo-headroom
                         # reason as VAL_SPLIT above.
PATIENCE     = 8        # early-stopping patience

MODEL_PATH    = Path(__file__).parent / "model.keras"
SCALER_PATH   = Path(__file__).parent / "scaler.pkl"
PLOT_PATH     = Path(__file__).parent / "train_plot.png"
REPORT_PATH   = Path(__file__).parent / "training_report.json"


# ── Data loading & windowing ──────────────────────────────────────────────────

def load_data(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, parse_dates=["ts"])
    df = df[FEATURES].dropna()
    if len(df) < WINDOW_SIZE + HORIZON + 10:
        print(f"[train] ERROR: only {len(df)} rows — need at least "
              f"{WINDOW_SIZE + HORIZON + 10}. Collect more data first.")
        sys.exit(1)
    print(f"[train] Loaded {len(df)} samples from {csv_path}")
    return df


def make_windows(values: np.ndarray):
    """Slide a (WINDOW_SIZE, N_FEATURES) window over the series."""
    X, y = [], []
    for i in range(len(values) - WINDOW_SIZE - HORIZON + 1):
        X.append(values[i : i + WINDOW_SIZE])
        y.append(values[i + WINDOW_SIZE : i + WINDOW_SIZE + HORIZON])
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


EMBARGO = WINDOW_SIZE + HORIZON  # >=90 steps, per the supervisor review's own
                                  # example: a window straddling a split
                                  # boundary lets the model see into the
                                  # "held-out" segment during training, so
                                  # the raw series must be split BEFORE
                                  # windowing, with a gap this wide removed
                                  # between segments (not created by slicing
                                  # the already-windowed X/y arrays).


def make_embargoed_splits(scaled: np.ndarray):
    """
    Split the raw scaled series chronologically into train/val/test segments
    first, drop an EMBARGO-step gap at each internal boundary, and only then
    slide windows independently within each segment. This guarantees no
    window's input or target ever spans two segments, closing the temporal-
    leakage gap the un-embargoed version of this split had (see
    NEXT_STEPS.md and the paper's Temporal Leakage discussion).
    """
    n_raw = len(scaled)
    train_end = int(n_raw * (1 - VAL_SPLIT - TEST_SPLIT))
    val_end   = int(n_raw * (1 - TEST_SPLIT))

    train_raw = scaled[: train_end - EMBARGO]
    val_raw   = scaled[train_end : val_end - EMBARGO]
    test_raw  = scaled[val_end :]

    X_train, y_train = make_windows(train_raw)
    X_val,   y_val   = make_windows(val_raw)
    X_test,  y_test  = make_windows(test_raw)
    return (X_train, y_train), (X_val, y_val), (X_test, y_test)


# ── Model builder ─────────────────────────────────────────────────────────────

def build_model():
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout, Reshape
    from tensorflow.keras.optimizers import Adam

    model = Sequential([
        LSTM(LSTM_UNITS_1, return_sequences=True,
             input_shape=(WINDOW_SIZE, N_FEATURES)),
        Dropout(DROPOUT),
        LSTM(LSTM_UNITS_2, return_sequences=False),
        Dropout(DROPOUT),
        Dense(HORIZON * N_FEATURES),
        Reshape((HORIZON, N_FEATURES)),
    ], name="docker_genius_lstm")

    model.compile(optimizer=Adam(learning_rate=LEARNING_RATE),
                  loss="mse", metrics=["mae"])
    model.summary()
    return model


# ── Training ──────────────────────────────────────────────────────────────────

def train(csv_path: str):
    from sklearn.preprocessing import MinMaxScaler
    from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint

    # 1. Load raw data
    df = load_data(csv_path)

    # 2. Fit scaler on full dataset
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(df[FEATURES].values)

    # 3. Split the RAW series chronologically first, drop an EMBARGO-step
    #    gap at each internal boundary, and only then window each segment
    #    independently -- see make_embargoed_splits() for why this order
    #    matters (temporal-leakage fix; supervisor review item #9).
    (X_train, y_train), (X_val, y_val), (X_test, y_test) = make_embargoed_splits(scaled)
    n = len(X_train) + len(X_val) + len(X_test)
    print(f"[train] Windows created (post-embargo) — "
          f"train: {X_train.shape}  val: {X_val.shape}  test: {X_test.shape}")
    print(f"[train] Train: {len(X_train)}  Val: {len(X_val)}  Test: {len(X_test)}  "
          f"(split {1-VAL_SPLIT-TEST_SPLIT:.0%}/{VAL_SPLIT:.0%}/{TEST_SPLIT:.0%}, "
          f"{EMBARGO}-step embargo at each internal boundary)")
    if len(X_test) == 0:
        print("[train] ERROR: test split is empty — collect more telemetry "
              "before training (need enough rows for a non-trivial held-out set).")
        sys.exit(1)

    # 5. Build model
    model = build_model()

    # 6. Callbacks
    callbacks = [
        EarlyStopping(monitor="val_loss", patience=PATIENCE,
                      restore_best_weights=True, verbose=1),
        ModelCheckpoint(str(MODEL_PATH), monitor="val_loss",
                        save_best_only=True, verbose=0),
    ]

    # 7. Train
    train_start = time.perf_counter()
    print(f"\n[train] Training for up to {EPOCHS} epochs "
          f"(early stop patience={PATIENCE})…")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )
    train_wall_s = time.perf_counter() - train_start
    epochs_run   = len(history.history["loss"])

    # 8. Save scaler
    with open(SCALER_PATH, "wb") as f:
        pickle.dump(scaler, f)
    print(f"[train] Scaler saved → {SCALER_PATH}")
    print(f"[train] Model  saved → {MODEL_PATH}")

    # 9. Evaluate on validation set (scaled-space loss, as tracked during training)
    val_loss, val_mae_scaled = model.evaluate(X_val, y_val, verbose=0)

    # 10. Evaluate on the HELD-OUT TEST set, in real units (%, MB) — this is
    #     the number that goes in the paper, not the validation metric above.
    test_pred_scaled = model.predict(X_test, verbose=0)   # (n_test, HORIZON, 2)

    def inverse_all(arr_scaled: np.ndarray) -> np.ndarray:
        """Inverse-transform a (n, HORIZON, 2) scaled array back to real units."""
        flat = arr_scaled.reshape(-1, N_FEATURES)
        return scaler.inverse_transform(flat).reshape(arr_scaled.shape)

    test_pred = inverse_all(test_pred_scaled)
    test_true = inverse_all(y_test)

    cpu_err = test_pred[:, :, 0] - test_true[:, :, 0]
    mem_err = test_pred[:, :, 1] - test_true[:, :, 1]
    cpu_mae = float(np.mean(np.abs(cpu_err)))
    cpu_rmse = float(np.sqrt(np.mean(cpu_err ** 2)))
    mem_mae = float(np.mean(np.abs(mem_err)))
    mem_rmse = float(np.sqrt(np.mean(mem_err ** 2)))

    print(f"\n[train] Val   MSE (scaled) : {val_loss:.6f}   "
          f"MAE (scaled): {val_mae_scaled:.6f}")
    print(f"[train] Test CPU — MAE: {cpu_mae:.3f}%   RMSE: {cpu_rmse:.3f}%   "
          f"(n={len(X_test)} held-out windows)")
    print(f"[train] Test MEM — MAE: {mem_mae:.3f} MB   RMSE: {mem_rmse:.3f} MB")

    # 11. Measure single-window inference latency (for the paper's
    #     "inference time" field) — average over several repeats, excluding
    #     the one-off graph-tracing cost of the very first call.
    single_window = X_test[:1] if len(X_test) else X_val[:1]
    model.predict(single_window, verbose=0)   # warm-up / trace
    n_timing_runs = 20
    t0 = time.perf_counter()
    for _ in range(n_timing_runs):
        model.predict(single_window, verbose=0)
    inference_ms = (time.perf_counter() - t0) / n_timing_runs * 1000

    print(f"[train] Inference time (single window, warm): "
          f"{inference_ms:.2f} ms  (mean of {n_timing_runs} runs)")

    # 12. Write the full training report — source of truth for the paper's
    #     LSTM details / reproducibility tables. Do not hand-transcribe
    #     these numbers elsewhere; regenerate this file and re-copy.
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
            "split": f"{1 - VAL_SPLIT - TEST_SPLIT:.0%}/{VAL_SPLIT:.0%}/{TEST_SPLIT:.0%} (train/val/test, temporal, no shuffle, {EMBARGO}-step embargo at each internal boundary)",
            "embargo_steps": EMBARGO,
        },
        "architecture": {
            "window_size_steps": WINDOW_SIZE,
            "horizon_steps": HORIZON,
            "features": FEATURES,
            "lstm_units": [LSTM_UNITS_1, LSTM_UNITS_2],
            "dropout": DROPOUT,
        },
        "training_config": {
            "optimizer": "Adam",
            "learning_rate": LEARNING_RATE,
            "loss": "mse",
            "batch_size": BATCH_SIZE,
            "max_epochs": EPOCHS,
            "epochs_run": epochs_run,
            "early_stopping_patience": PATIENCE,
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
            "model.keras": hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(),
            "scaler.pkl": hashlib.sha256(SCALER_PATH.read_bytes()).hexdigest(),
        },
    }
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[train] Training report → {REPORT_PATH}")

    # 13. Optional: save loss plot
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(1, 2, figsize=(12, 4))
        axes[0].plot(history.history["loss"],     label="train")
        axes[0].plot(history.history["val_loss"], label="val")
        axes[0].set_title("Loss (MSE)")
        axes[0].set_xlabel("Epoch"); axes[0].legend()
        axes[1].plot(history.history["mae"],      label="train")
        axes[1].plot(history.history["val_mae"],  label="val")
        axes[1].set_title("MAE")
        axes[1].set_xlabel("Epoch"); axes[1].legend()
        fig.suptitle("DOCKER-GENIUS LSTM Training")
        fig.tight_layout()
        fig.savefig(PLOT_PATH, dpi=120)
        print(f"[train] Loss plot  → {PLOT_PATH}")
    except Exception as e:
        print(f"[train] (plot skipped: {e})")

    print("\n[train] ✅  Training complete.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS LSTM trainer")
    ap.add_argument("--data", default="lstm/training_data.csv",
                    help="Path to CSV from collect_training_data.py")
    args = ap.parse_args()
    train(args.data)
