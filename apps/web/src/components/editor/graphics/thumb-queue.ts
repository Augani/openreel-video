/**
 * Template cards render one at a time with a macrotask between them: a Templates tab with dozens of cards would
 * otherwise do all of its canvas work inside the click that opened it (a long task on slow machines).
 */
let tail: Promise<void> = Promise.resolve();

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs `job` after every job queued before it; skipped when `isCancelled()` by then. Never rejects. */
export function enqueueThumbJob(job: () => Promise<void>, isCancelled: () => boolean = () => false): Promise<void> {
  const run = tail.then(async () => {
    await nextMacrotask();
    if (isCancelled()) return;
    try {
      await job();
    } catch {
      /* a failed card keeps its previous pixels; the queue goes on */
    }
  });
  tail = run;
  return run;
}
