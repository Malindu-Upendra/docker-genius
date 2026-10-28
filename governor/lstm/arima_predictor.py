"""
arima_predictor.py — DOCKER-GENIUS ARIMA Inference Wrapper

A drop-in replacement for LSTMPredictor, built in direct response to review
feedback that the LSTM was both less accurate and heavier than it needed to
be (see baseline_models.py's own comparison: ARIMA's 15.2% CPU MAE beats the
LSTM's 21.1%, and an offline recall check against the same held-out test
windows found ARIMA catches 8/126 real CPU>75% events, 6.3% recall, vs the
LSTM's 0/126). Exposes the exact same interface as LSTMPredictor
(update/ready/predict/buffer_fill) so governor_loop.py can select either
predictor via the DG_PREDICTOR environment variable without any other
code changing.

Uses the same walk-forward ARIMA pattern already validated in
baseline_models.py's run_arima(): fit once when the buffer first fills
(order chosen by AIC over the same candidate set), then extend the fitted
model with new observations via .append(refit=False) each cycle rather
than refitting from scratch — fast enough for a 10s decision cycle.

Usage:
    from lstm.arima_predictor import ARIMAPredictor

    pred = ARIMAPredictor()
    pred.update(cpu_pct=45.2, mem_mb=812.5)   # call every sample interval
    ...
    forecast = pred.predict()
"""

import warnings
from collections import deque

import numpy as np

WINDOW_SIZE = 60      # must match predictor.py / train.py
HORIZON     = 30
ARIMA_ORDER_CANDIDATES = [(1, 1, 1), (2, 1, 2), (5, 1, 0)]  # same as baseline_models.py


def _fit_best_arima(series: np.ndarray):
    from statsmodels.tsa.arima.model import ARIMA
    best = None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for order in ARIMA_ORDER_CANDIDATES:
            try:
                res = ARIMA(series, order=order).fit()
                if best is None or res.aic < best[0]:
                    best = (res.aic, order, res)
            except Exception:
                continue
    return best[1], best[2]


class ARIMAPredictor:
    """
    Maintains a rolling buffer of raw telemetry and produces multi-step
    CPU/RAM forecasts via two independent univariate ARIMA models (one per
    series), refit once then extended incrementally — same interface as
    LSTMPredictor so it's a transparent swap in governor_loop.py.
    """

    def __init__(self):
        self._cpu_buffer = deque(maxlen=None)   # full growing history, ARIMA needs it
        self._mem_buffer = deque(maxlen=None)
        self._cpu_model = None
        self._mem_model = None
        self._cpu_order = None
        self._mem_order = None
        self._n_included = 0   # how many buffer points the fitted models have seen
        print(f"[predictor] ARIMA predictor ready. Window={WINDOW_SIZE}  Horizon={HORIZON}")

    # ── Public API (mirrors LSTMPredictor) ──────────────────────────────────

    def update(self, cpu_pct: float, mem_mb: float) -> None:
        self._cpu_buffer.append(float(cpu_pct))
        self._mem_buffer.append(float(mem_mb))

    @property
    def ready(self) -> bool:
        return len(self._cpu_buffer) >= WINDOW_SIZE

    def predict(self) -> dict | None:
        if not self.ready:
            return None

        cpu_series = np.array(self._cpu_buffer, dtype=float)
        mem_series = np.array(self._mem_buffer, dtype=float)

        if self._cpu_model is None:
            # First call: fit both models on everything seen so far.
            self._cpu_order, self._cpu_model = _fit_best_arima(cpu_series)
            self._mem_order, self._mem_model = _fit_best_arima(mem_series)
            self._n_included = len(cpu_series)
            print(f"[predictor] ARIMA fitted — cpu_order={self._cpu_order}  "
                  f"mem_order={self._mem_order}")
        elif len(cpu_series) > self._n_included:
            # Extend with new observations since the last predict() call,
            # no refit — same efficient walk-forward pattern as
            # baseline_models.py's run_arima().
            new_cpu = cpu_series[self._n_included:]
            new_mem = mem_series[self._n_included:]
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self._cpu_model = self._cpu_model.append(new_cpu, refit=False)
                self._mem_model = self._mem_model.append(new_mem, refit=False)
            self._n_included = len(cpu_series)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            cpu_fc = self._cpu_model.get_forecast(steps=HORIZON).predicted_mean
            mem_fc = self._mem_model.get_forecast(steps=HORIZON).predicted_mean

        cpu_steps = np.asarray(cpu_fc).tolist()
        mem_steps = np.asarray(mem_fc).tolist()

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
        return f"{len(self._cpu_buffer)}/{WINDOW_SIZE}"


# ── Quick self-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    import time

    pred = ARIMAPredictor()
    print(f"[test] Filling buffer with synthetic data ({WINDOW_SIZE} steps)...")
    for i in range(WINDOW_SIZE):
        pred.update(cpu_pct=35.0 + (i % 10), mem_mb=750.0 + (i % 5))

    t0 = time.perf_counter()
    result = pred.predict()
    t1 = time.perf_counter()
    if result:
        print(f"[test] First predict() took {t1-t0:.3f}s")
        print(f"[test] Forecast — CPU mean={result['mean_cpu_pct']:.1f}%  "
              f"peak={result['peak_cpu_pct']:.1f}%")

        # Simulate a few more decision cycles (10 new samples each)
        for cycle in range(3):
            for i in range(10):
                pred.update(cpu_pct=40.0 + i, mem_mb=760.0 + i)
            t0 = time.perf_counter()
            result = pred.predict()
            t1 = time.perf_counter()
            print(f"[test] Cycle {cycle+1} predict() took {t1-t0:.3f}s — "
                  f"peak_cpu={result['peak_cpu_pct']:.1f}%")
        print("[test] OK — ARIMA predictor working.")
    else:
        print("[test] ERROR: predict() returned None despite full buffer")
        sys.exit(1)
