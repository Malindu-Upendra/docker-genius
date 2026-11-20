"""
run_live.py — Continuous governor loop for live/ad-hoc monitoring.

Unlike run_governor.py (a fixed 180s smoke test) or experiment/run_experiment.py
(fixed-duration formal groups), this runs the governor indefinitely so the
dashboard's LSTM-forecast overlay and scaling-decision timeline have live
data to show outside of a formal experiment run. Not used by, and has no
effect on, any reported result — purely a monitoring convenience.

Defaults to proactive mode; GovernorLoop itself falls back to reactive
automatically if lstm/model.keras or lstm/scaler.pkl are missing.

Usage:
    python3 run_live.py [--mode proactive|reactive] [--interval 10]
"""
import argparse
import signal
import time

from experiment.governor_loop import GovernorLoop


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="proactive", choices=["proactive", "reactive"])
    ap.add_argument("--interval", type=int, default=10)
    args = ap.parse_args()

    g = GovernorLoop(mode=args.mode, interval=args.interval)
    g.start()

    stop = {"flag": False}
    def _handle_sigterm(signum, frame):
        stop["flag"] = True
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    try:
        while not stop["flag"]:
            time.sleep(1)
    finally:
        g.stop()


if __name__ == "__main__":
    main()
