"""
predictor.py — DOCKER-GENIUS LSTM Inference Wrapper

Used by the governor loop to get real-time CPU/RAM forecasts.

Usage:
    from lstm.predictor import LSTMPredictor

    pred = LSTMPredictor()               # loads model.keras + scaler.pkl
    pred.update(cpu_pct=45.2, mem_mb=812.5)   # call every sample interval
    ...
    forecast = pred.predict()
    if forecast:
        peak_cpu = forecast["peak_cpu_pct"]
        peak_mem = forecast["peak_mem_mb"]
        horizon  = forecast["horizon_steps"]   # number of steps ahead
"""

import pickle
from collections import deque
from pathlib import Path

import numpy as np

# ── Must match train.py constants ─────────────────────────────────────────────
WINDOW_SIZE = 60      # history steps required before first prediction
HORIZON     = 30      # steps forecast ahead
FEATURES    = ["cpu_pct", "mem_mb"]
N_FEATURES  = len(FEATURES)

_HERE = Path(__file__).parent
MODEL_PATH  = _HERE / "model.keras"
SCALER_PATH = _HERE / "scaler.pkl"


class LSTMPredictor:
    """
    Maintains a rolling buffer of telemetry readings and produces
    multi-step CPU/RAM forecasts using the trained LSTM model.

    Thread-safe: update() and predict() use no shared mutable state beyond
    the deque, which is GIL-protected for single appends/reads in CPython.
    """

    def __init__(self):
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Model not found at {MODEL_PATH}. "
                "Run lstm/train.py first."
            )
        if not SCALER_PATH.exists():
            raise FileNotFoundError(
                f"Scaler not found at {SCALER_PATH}. "
                "Run lstm/train.py first."
            )

        import tensorflow as tf
        self._model  = tf.keras.models.load_model(str(MODEL_PATH))
        with open(SCALER_PATH, "rb") as f:
            self._scaler = pickle.load(f)

        self._buffer = deque(maxlen=WINDOW_SIZE)
        print(f"[predictor] Model loaded from {MODEL_PATH}")
        print(f"[predictor] Window={WINDOW_SIZE}  Horizon={HORIZON}  "
              f"(buffer {len(self._buffer)}/{WINDOW_SIZE} filled)")

    # ── Public API ────────────────────────────────────────────────────────────

    def update(self, cpu_pct: float, mem_mb: float) -> None:
        """Add one telemetry reading to the rolling buffer."""
        self._buffer.append([float(cpu_pct), float(mem_mb)])

    @property
    def ready(self) -> bool:
        """True once the buffer has accumulated WINDOW_SIZE readings."""
        return len(self._buffer) >= WINDOW_SIZE

    def predict(self) -> dict | None:
        """
        Run inference and return forecast statistics, or None if the
        buffer is not yet full.

        Returns dict with keys:
            steps          : list of (cpu_pct, mem_mb) for each horizon step
            mean_cpu_pct   : mean predicted CPU over the horizon
            peak_cpu_pct   : max  predicted CPU over the horizon
            mean_mem_mb    : mean predicted memory over the horizon
            peak_mem_mb    : max  predicted memory over the horizon
            horizon_steps  : HORIZON (for reference)
        """
        if not self.ready:
            return None

        # Build (1, WINDOW_SIZE, N_FEATURES) input tensor
        window = np.array(list(self._buffer), dtype=np.float32)   # (WINDOW_SIZE, 2)
        scaled = self._scaler.transform(window)                     # normalise
        X      = scaled[np.newaxis, ...]                            # add batch dim

        # Model output: (1, HORIZON, N_FEATURES)
        pred_scaled = self._model.predict(X, verbose=0)[0]         # (HORIZON, 2)

        # Inverse-transform back to real units
        pred = self._scaler.inverse_transform(pred_scaled)          # (HORIZON, 2)

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
        """Human-readable buffer fill status."""
        return f"{len(self._buffer)}/{WINDOW_SIZE}"


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    pred = LSTMPredictor()

    # Feed synthetic constant signal to fill the buffer
    print(f"[test] Filling buffer with synthetic data ({WINDOW_SIZE} steps)…")
    for _ in range(WINDOW_SIZE):
        pred.update(cpu_pct=35.0, mem_mb=750.0)

    result = pred.predict()
    if result:
        print(f"[test] Forecast over next {result['horizon_steps']} steps:")
        print(f"       CPU — mean={result['mean_cpu_pct']:.1f}%  "
              f"peak={result['peak_cpu_pct']:.1f}%")
        print(f"       MEM — mean={result['mean_mem_mb']:.1f}MB  "
              f"peak={result['peak_mem_mb']:.1f}MB")
        print("[test] ✅  Predictor working.")
    else:
        print("[test] ERROR: predict() returned None despite full buffer")
        sys.exit(1)
