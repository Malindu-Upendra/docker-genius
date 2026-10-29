"""
gru_predictor.py — DOCKER-GENIUS GRU Inference Wrapper

A drop-in replacement for LSTMPredictor (same interface:
update/ready/predict/buffer_fill), backed by the GRU model trained by
train_gru.py. Added as a second alternative forecaster — alongside ARIMA
and the naive persistence baseline — in direct response to the concern that
"architecture, not model choice, explains why prediction doesn't help" was
being asserted on the strength of a single alternative model. GRU is the
closest possible comparison to the LSTM: same window/horizon, same two-layer
recurrent + dropout + dense architecture, same training procedure and data
split, only the recurrent cell type differs (see baseline_models.py's
run_gru() and train_gru.py).

Usage:
    from lstm.gru_predictor import GRUPredictor

    pred = GRUPredictor()                     # loads gru_model.keras + gru_scaler.pkl
    pred.update(cpu_pct=45.2, mem_mb=812.5)    # call every sample interval
    ...
    forecast = pred.predict()
"""

import pickle
from collections import deque
from pathlib import Path

import numpy as np

WINDOW_SIZE = 60      # must match predictor.py / train.py / train_gru.py
HORIZON     = 30
FEATURES    = ["cpu_pct", "mem_mb"]
N_FEATURES  = len(FEATURES)

_HERE = Path(__file__).parent
MODEL_PATH  = _HERE / "gru_model.keras"
SCALER_PATH = _HERE / "gru_scaler.pkl"


class GRUPredictor:
    """
    Maintains a rolling buffer of telemetry readings and produces
    multi-step CPU/RAM forecasts using the trained GRU model — structurally
    identical wrapper to LSTMPredictor so it's a transparent swap in
    governor_loop.py.
    """

    def __init__(self):
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"GRU model not found at {MODEL_PATH}. "
                "Run lstm/train_gru.py first."
            )
        if not SCALER_PATH.exists():
            raise FileNotFoundError(
                f"GRU scaler not found at {SCALER_PATH}. "
                "Run lstm/train_gru.py first."
            )

        import tensorflow as tf
        self._model = tf.keras.models.load_model(str(MODEL_PATH))
        with open(SCALER_PATH, "rb") as f:
            self._scaler = pickle.load(f)

        self._buffer = deque(maxlen=WINDOW_SIZE)
        print(f"[predictor] GRU model loaded from {MODEL_PATH}")
        print(f"[predictor] Window={WINDOW_SIZE}  Horizon={HORIZON}  "
              f"(buffer {len(self._buffer)}/{WINDOW_SIZE} filled)")

    # ── Public API (mirrors LSTMPredictor / ARIMAPredictor) ─────────────────

    def update(self, cpu_pct: float, mem_mb: float) -> None:
        self._buffer.append([float(cpu_pct), float(mem_mb)])

    @property
    def ready(self) -> bool:
        return len(self._buffer) >= WINDOW_SIZE

    def predict(self) -> dict | None:
        if not self.ready:
            return None

        window = np.array(list(self._buffer), dtype=np.float32)
        scaled = self._scaler.transform(window)
        X = scaled[np.newaxis, ...]

        pred_scaled = self._model.predict(X, verbose=0)[0]
        pred = self._scaler.inverse_transform(pred_scaled)

        cpu_steps = pred[:, 0].tolist()
        mem_steps = pred[:, 1].tolist()

        return {
            "steps"        : [(round(c, 2), round(m, 2))
                               for c, m in zip(cpu_steps, mem_steps)],
            "mean_cpu_pct" : round(float(np.mean(cpu_steps)), 2),
            "peak_cpu_pct" : round(float(np.max(cpu_steps)),  2),
            "mean_mem_mb"  : round(float(np.mean(mem_steps)), 2),
            "peak_mem_mb"  : round(float(np.max(mem_steps)),  2),
            "horizon_steps": HORIZON,
        }

    def buffer_fill(self) -> str:
        return f"{len(self._buffer)}/{WINDOW_SIZE}"


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    pred = GRUPredictor()
    print(f"[test] Filling buffer with synthetic data ({WINDOW_SIZE} steps)…")
    for _ in range(WINDOW_SIZE):
        pred.update(cpu_pct=35.0, mem_mb=750.0)

    result = pred.predict()
    if result:
        print(f"[test] Forecast — CPU mean={result['mean_cpu_pct']:.1f}%  "
              f"peak={result['peak_cpu_pct']:.1f}%")
        print("[test] OK — GRU predictor working.")
    else:
        print("[test] ERROR: predict() returned None despite full buffer")
        sys.exit(1)
