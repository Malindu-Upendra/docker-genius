// cpu-burn-pool.ts — bounded-concurrency dispatch of the research-mode
// Tier-3 CPU-bound work onto worker threads.
//
// Implements two of the four request-class isolation mechanisms scoped in
// Section "Scope of Semantic Awareness: Classification, Not Isolation"
// (review item #7):
//   (ii) separate worker/thread pools per tier — the burn runs on a
//        worker_threads.Worker, off the main event-loop thread, so a
//        Tier-3 burst cannot block Tier-1 handlers from running;
//   (iv) per-endpoint concurrency limits — MAX_CONCURRENT_BURNS caps how
//        many burns run simultaneously regardless of container CPU
//        allocation; requests beyond that queue here rather than spawning
//        unbounded worker threads.
import { Worker } from 'worker_threads';
import { join } from 'path';

const WORKER_PATH = join(__dirname, 'cpu-burn.worker.js');
const MAX_CONCURRENT_BURNS = 2;

let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_BURNS) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release(): void {
  const next = queue.shift();
  if (next) {
    next();
  } else {
    active--;
  }
}

export async function runCpuBurnInWorker(iterations: number): Promise<number> {
  await acquire();
  try {
    return await new Promise<number>((resolve, reject) => {
      const worker = new Worker(WORKER_PATH, { workerData: { iterations } });
      worker.once('message', (msg: { result: number }) => {
        resolve(msg.result);
        worker.terminate();
      });
      worker.once('error', (err) => {
        reject(err);
        worker.terminate();
      });
    });
  } finally {
    release();
  }
}
