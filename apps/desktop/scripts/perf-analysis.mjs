/**
 * Pure analysis helpers shared by perf-harness.mjs and perf-budget.mjs (unit-tested in
 * test/perf-analysis.test.ts). No Electron, no I/O: everything here takes numbers and returns numbers
 * so the scenario code in the harness stays thin and the arithmetic is checked without a launch.
 */

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

/** Median with the harness' convention (upper middle element for an even count). */
export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

/** Percentile with the harness' convention: sorted[min(n - 1, floor(n * p))]. */
export function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
}

/**
 * Latency summary for click-seek style measurements. `samples` are the successful latencies in ms;
 * `timeouts` are seeks that never showed the target frame (reported, not folded into the percentiles,
 * so a stuck seek cannot hide as a missing sample: the budget on `timeouts` catches it).
 */
export function latencyStats(samples, timeouts = 0) {
  return {
    n: samples.length,
    timeouts,
    p50Ms: round1(median(samples)),
    p95Ms: round1(percentile(samples, 0.95)),
    maxMs: round1(samples.length ? Math.max(...samples) : null),
  };
}

/**
 * Dropped frames and effective frame rate of one playback run.
 *   presentedFrames  distinct program frames seen (the harness hashes the canvas every rAF)
 *   seconds          wall duration of the run
 *   sourceFps        frame rate of the source, i.e. how many distinct frames a perfect run presents
 * Dropped = frames a perfect run would have presented that never reached the canvas (never negative:
 * a canvas that repaints more often than the source, e.g. on overlays, is not "negative drops").
 */
export function analyzePlayback({ presentedFrames, seconds, sourceFps, rafDeltas = [] }) {
  const expectedFrames = Math.round(seconds * sourceFps);
  const dropped = Math.max(0, expectedFrames - presentedFrames);
  const over = (t) => rafDeltas.filter((d) => d > t).length;
  return {
    seconds: round1(seconds),
    sourceFps,
    expectedFrames,
    presentedFrames,
    droppedFrames: dropped,
    droppedFramesPct: expectedFrames > 0 ? round1((dropped / expectedFrames) * 100) : null,
    effectiveFps: seconds > 0 ? round1(Math.min(presentedFrames, expectedFrames) / seconds) : null,
    rafOver25ms: over(25),
    rafOver50ms: over(50),
  };
}

/** Sum of every Electron process' cumulative CPU time, in ms (`app.getAppMetrics()` reports seconds). */
export function sumCpuMs(metrics) {
  return metrics.reduce((a, m) => a + (m.cpu?.cumulativeCPUUsage ?? 0) * 1000, 0);
}

/** CPU time spent between two cumulative readings as a percentage of one core over `wallMs`. */
export function cpuPctOfCore(cpuMsBefore, cpuMsAfter, wallMs) {
  if (!(wallMs > 0)) return null;
  return round1((Math.max(0, cpuMsAfter - cpuMsBefore) / wallMs) * 100);
}

/**
 * Import summary. `readyAtMs[i]` is the time from the start of the import until clip i's thumbnail was
 * showing; `cpuMs` the total CPU time (all processes) spent over the same window.
 */
export function summarizeImport({ readyAtMs, cpuMs }) {
  const n = readyAtMs.length;
  const all = n ? Math.max(...readyAtMs) : null;
  return {
    clips: n,
    firstThumbnailMs: n ? Math.min(...readyAtMs) : null,
    allThumbnailsMs: all,
    perClipThumbnailMs: n ? round1(all / n) : null,
    cpuMs: round1(cpuMs),
    cpuMsPerClip: n ? round1(cpuMs / n) : null,
  };
}

/**
 * Final verdict of perf-budget. The LAST line is never ambiguous: when any wall-clock budget was not
 * judged it says "WALL-CLOCK NOT VERIFIED", even if every judged budget passed. Exit code: 1 when a
 * budget failed, 3 when wall-clock budgets were not judged and `requireWall` is set, else 0.
 */
export function budgetVerdict({ failed, notJudged, judged, loadText, maxLoad, requireWall }) {
  const lines = [];
  if (failed) lines.push(`${failed} budget(s) exceeded`);
  else lines.push(`all judged budgets met (${judged} judged)`);
  if (notJudged) {
    lines.push(`wall-clock budgets need an idle machine: see apps/desktop/PERF.md, "Idle-machine reference procedure"`);
    lines.push(
      `WALL-CLOCK NOT VERIFIED: ${notJudged} wall-clock budget(s) were not judged (${loadText}, judged only at load <= ${maxLoad}); only CPU and memory budgets were checked. This is not a pass for the wall-clock gate${requireWall ? " (--require-wall: exit 3)" : ""}.`,
    );
  } else if (failed) {
    lines.push(`BUDGET CHECK FAILED: ${failed} budget(s) exceeded or missing (${loadText})`);
  } else {
    lines.push(`ALL BUDGETS VERIFIED, including wall-clock (${loadText})`);
  }
  const exitCode = failed ? 1 : requireWall && notJudged ? 3 : 0;
  return { lines, exitCode };
}
