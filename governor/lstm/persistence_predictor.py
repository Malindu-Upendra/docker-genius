"""
persistence_predictor.py — DOCKER-GENIUS Persistence (Naive) Inference Wrapper

The simplest possible forecaster: repeats the last observed [cpu_pct, mem_mb]
reading across the whole forecast horizon. No fitting, no parameters, no
training wall-time. Added alongside arima_predictor.py in direct response to
supervisor/self review that "architecture, not model choice, explains why
prediction doesn't help" was asserted on the strength of a single alternative
forecaster (ARIMA). Persistence is the other useful extreme to test: if even
a zero-effort forecaster behaves the same way under the governor's rule
engine as the trained LSTM and the fitted ARIMA, that is strong evidence the
effect really is architectural (how forecasts are *used*), not a property of
any one model's forecasting skill.

Exposes the exact same interface as LSTMPredictor/ARIMAPredictor
(update/ready/predict/buffer_fill) so governor_loop.py can select it via the
DG_PREDICTOR environment variable without any other code changing.

Usage:
    from lstm.persistence_predictor import PersistencePredictor

    pred = PersistencePredictor()
    pred.update(cpu_pct=45.2, mem_mb=812.5)   # call every sample interval
    ...
    forecast = pred.predict()
"""

from collections import deque

import numpy as np

WINDOW_SIZE = 60      # must match predictor.py / train.py
HORIZON     = 30


class PersistencePredictor:
    """
    Maintains a rolling buffer purely to match the same "ready" warm-up
    behaviour as the other predictors (comparable startup conditions across
    conditions); the forecast itself only ever looks at the single most
    recent reading.
    """

    def __init__(self):
        self._buffer = deque(maxlen=WINDOW_SIZE)
        print(f"[predictor] Persistence predictor ready. Window={WINDOW_SIZE}  "
              f"Horizon={HORIZON}  (naive: repeats last observation)")

    # ── Public API (mirrors LSTMPredictor / ARIMAPredictor) ─────────────────

    def update(self, cpu_pct: float, mem_mb: float) -> None:
        self._buffer.append((float(cpu_pct), float(mem_mb)))

    @property
    def ready(self) -> bool:
        return len(self._buffer) >= WINDOW_SIZE

    def predict(self) -> dict | None:
        if not self.ready:
            return None

        last_cpu, last_mem = self._buffer[-1]
        cpu_steps = [last_cpu] * HORIZON
        mem_steps = [last_mem] * HORIZON

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

    pred = PersistencePredictor()
    print(f"[test] Filling buffer with synthetic data ({WINDOW_SIZE} steps)...")
    for i in range(WINDOW_SIZE):
        pred.update(cpu_pct=35.0 + (i % 10), mem_mb=750.0 + (i % 5))

    result = pred.predict()
    if result:
        print(f"[test] Forecast — CPU mean={result['mean_cpu_pct']:.1f}%  "
              f"peak={result['peak_cpu_pct']:.1f}%")
        last_cpu, _ = pred._buffer[-1]
        assert all(abs(c - last_cpu) < 1e-9 for c, _ in result["steps"]), \
            "persistence forecast must be flat at the last observed value"
        print("[test] OK — Persistence predictor working.")
    else:
        print("[test] ERROR: predict() returned None despite full buffer")
        sys.exit(1)
