// cpu-burn.worker.ts — runs the research-mode Tier-3 CPU-bound computation
// on a worker thread instead of the main event-loop thread.
//
// Implements mechanism (ii) from Section "Scope of Semantic Awareness:
// Classification, Not Isolation" (review item #7) — separate worker/thread
// pools per tier, so a saturated Tier-3 workload cannot exhaust the
// event-loop capacity Tier-1 handlers need. The computation itself
// (fixed-iteration sqrt/sin accumulation) is unchanged from the original
// main-thread version — calibrated to ~3s at 2.0 CPUs, still bounded by a
// fixed amount of work rather than fixed wall-clock time — only WHERE it
// runs has changed.
import { parentPort, workerData } from 'worker_threads';

function burnCpu(iterations: number): number {
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += Math.sqrt(i + 1) * Math.sin(acc);
  }
  return acc;
}

const { iterations } = workerData as { iterations: number };
const result = burnCpu(iterations);
parentPort?.postMessage({ result });
