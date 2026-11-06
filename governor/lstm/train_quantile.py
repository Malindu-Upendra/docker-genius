"""
train_quantile.py — DOCKER-GENIUS LSTM Trainer, Pinball (Quantile) Loss Variant

Motivation (paper review follow-up, D2): forecast_diagnostics.py found the
MSE-trained LSTM achieves 0% recall at detecting real CPU-above-75% events
in its own held-out test windows -- the model never once forecasts a value
above the threshold, despite 126 of 151 test windows actually containing
one. MSE loss trains a model to predict the conditional MEAN of the target
distribution; for a right-skewed series where high-CPU events are brief and
comparatively rare, the conditional mean sits well below those events, so a
perfectly-converged MSE-optimal forecaster is expected to look exactly like
this -- "conservative"/"variance-collapsed" is the predictable consequence
of the loss function, not necessarily a sign anything is broken.

This script re-trains the IDENTICAL architecture (same window/horizon,
same two-layer stacked LSTM, same embargoed temporal split, same train-only
scaler fit) with an asymmetric pinball (quantile) loss targeting the 90th
percentile instead of MSE, on both channels. A quantile-0.9 loss penalises
under-prediction nine times more heavily than over-prediction, which should
push the forecast toward the upper tail of the conditional distribution --
directly targeting the failure mode forecast_diagnostics.py identified,
rather than guessing that a different architecture or more data would fix
it (Section 5.8 already tested four different architectures/models under
ordinary MSE/least-squares-equivalent loss and found the same conservative
behaviour in three of the four neural/statistical ones).

This is a genuinely different experiment from everything else in the paper,
not a replacement for the MSE model used throughout -- the MSE model
remains the one driving the governor in every other result in this paper.
This script's output is evaluated once, for its own event-level recall,
and reported as a single additional data point in the forecast-usefulness
discussion.

Outputs:
    lstm/model_quantile.keras
    lstm/scaler_quantile.pkl
    lstm/training_report_quantile.json

Usage:
    python3 lstm/train_quantile.py [--data lstm/training_data.csv] [--quantile 0.9]
"""

import argparse
import hashlib
import json
import pickle
import platform
import time
from pathlib import Path

import numpy as np

import train as lstm_train

MODEL_PATH  = Path(__file__).parent / "model_quantile.keras"
SCALER_PATH = Path(__file__).parent / "scaler_quantile.pkl"
REPORT_PATH = Path(__file__).parent / "training_report_quantile.json"


def pinball_loss(quantile: float):
    """Asymmetric quantile (pinball) loss, standard form:
    L(y, yhat) = mean( max(q*(y-yhat), (q-1)*(y-yhat)) ).
    At q=0.5 this reduces to MAE; q>0.5 penalises under-prediction (yhat<y)
    more heavily than over-prediction, pushing the fitted model's output
    toward the upper tail of the conditional distribution rather than its
    mean -- which is exactly what MSE (equivalent to q implicitly centred
    at the mean, not a quantile at all) does not do.
    """
    import tensorflow as tf

    def loss(y_true, y_pred):
        err = y_true - y_pred
        return tf.reduce_mean(tf.maximum(quantile * err, (quantile - 1) * err))

    return loss


def build_model(quantile: float):
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout, Reshape
    from tensorflow.keras.optimizers import Adam

    model = Sequential([
        LSTM(lstm_train.LSTM_UNITS_1, return_sequences=True,
             input_shape=(lstm_train.WINDOW_SIZE, lstm_train.N_FEATURES)),
        Dropout(lstm_train.DROPOUT),
        LSTM(lstm_train.LSTM_UNITS_2, return_sequences=False),
        Dropout(lstm_train.DROPOUT),
        Dense(lstm_train.HORIZON * lstm_train.N_FEATURES),
        Reshape((lstm_train.HORIZON, lstm_train.N_FEATURES)),
    ], name="docker_genius_lstm_quantile")

    model.compile(optimizer=Adam(learning_rate=lstm_train.LEARNING_RATE),
                  loss=pinball_loss(quantile), metrics=["mae"])
    model.summary()
    return model


def train(csv_path: str, quantile: float):
    from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint

    df = lstm_train.load_data(csv_path)

    # Identical split + train-only scaler fit as train.py's corrected
    # pipeline, so this is an apples-to-apples comparison against the MSE
    # model -- only the loss function differs.
    (X_train, y_train), (X_val, y_val), (X_test, y_test), scaler = \
        lstm_train.make_embargoed_splits_and_scaler(df[lstm_train.FEATURES].values)
    print(f"[train_quantile] Windows (post-embargo) — train: {X_train.shape}  "
          f"val: {X_val.shape}  test: {X_test.shape}  (quantile={quantile})")
    if len(X_test) == 0:
        raise SystemExit("[train_quantile] ERROR: empty test split.")

    model = build_model(quantile)

    callbacks = [
        EarlyStopping(monitor="val_loss", patience=lstm_train.PATIENCE,
                      restore_best_weights=True, verbose=1),
        ModelCheckpoint(str(MODEL_PATH), monitor="val_loss",
                        save_best_only=True, verbose=0),
    ]

    train_start = time.perf_counter()
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

    val_loss, val_mae_scaled = model.evaluate(X_val, y_val, verbose=0)

    test_pred_scaled = model.predict(X_test, verbose=0)

    def inverse_all(arr_scaled):
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
    cpu_bias = float(np.mean(cpu_err))  # mean(pred - true): >0 means the
                                         # model now over-predicts on
                                         # average, the intended effect of
                                         # an upper-quantile loss

    print(f"\n[train_quantile] Test CPU — MAE: {cpu_mae:.3f}%  RMSE: {cpu_rmse:.3f}%  "
          f"bias(pred-true): {cpu_bias:+.3f}pp")
    print(f"[train_quantile] Test MEM — MAE: {mem_mae:.3f} MB  RMSE: {mem_rmse:.3f} MB")

    try:
        import tensorflow as tf
        tf_version = tf.__version__
    except Exception:
        tf_version = "unknown"

    report = {
        "dataset": {
            "csv_path": str(csv_path),
            "raw_rows": int(len(df)),
            "test_samples": int(len(X_test)),
        },
        "training_config": {
            "optimizer": "Adam",
            "learning_rate": lstm_train.LEARNING_RATE,
            "loss": f"pinball(quantile={quantile})",
            "quantile": quantile,
            "batch_size": lstm_train.BATCH_SIZE,
            "max_epochs": lstm_train.EPOCHS,
            "epochs_run": epochs_run,
            "early_stopping_patience": lstm_train.PATIENCE,
            "train_wall_time_s": round(train_wall_s, 1),
        },
        "hardware": {
            "platform": platform.platform(),
            "tensorflow_version": tf_version,
        },
        "results": {
            "val_loss_scaled": round(float(val_loss), 6),
            "val_mae_scaled": round(float(val_mae_scaled), 6),
            "test_cpu_mae_pct": round(cpu_mae, 3),
            "test_cpu_rmse_pct": round(cpu_rmse, 3),
            "test_cpu_bias_pp": round(cpu_bias, 3),
            "test_mem_mae_mb": round(mem_mae, 3),
            "test_mem_rmse_mb": round(mem_rmse, 3),
        },
        "checksums_sha256": {
            "model_quantile.keras": hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(),
            "scaler_quantile.pkl": hashlib.sha256(SCALER_PATH.read_bytes()).hexdigest(),
        },
    }
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[train_quantile] Training report → {REPORT_PATH}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DOCKER-GENIUS LSTM trainer (pinball/quantile loss)")
    ap.add_argument("--data", default="lstm/training_data.csv")
    ap.add_argument("--quantile", type=float, default=0.9)
    args = ap.parse_args()
    train(args.data, args.quantile)
