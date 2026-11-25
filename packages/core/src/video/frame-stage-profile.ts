/**
 * Opt-in per-stage wall-clock accumulator for the frame pipeline (decode, grade, composite, bitmap hand-off, readback).
 *
 * Off by default: `time()` then just runs the callback. Turn it on with `localStorage["openreel-stage-profile"] = "1"`
 * (or `globalThis.__OPENREEL_STAGE_PROFILE__ = true`) before an export; the export engine prints one `[export-stages]`
 * line when the export ends. Stages overlap when frames are pipelined, so the sum of stages can exceed the wall time:
 * each number is time spent inside that stage on the calling thread, not an exclusive share of the frame.
 */

interface StageTotal {
  ms: number;
  count: number;
}

const totals = new Map<string, StageTotal>();

function readEnabled(): boolean {
  try {
    if ((globalThis as { __OPENREEL_STAGE_PROFILE__?: boolean }).__OPENREEL_STAGE_PROFILE__ === true) return true;
    return typeof localStorage !== "undefined" && localStorage.getItem("openreel-stage-profile") === "1";
  } catch {
    return false;
  }
}

let enabled: boolean | null = null;

export function stageProfileEnabled(): boolean {
  enabled ??= readEnabled();
  return enabled;
}

export function addStageTime(stage: string, ms: number): void {
  const entry = totals.get(stage);
  if (entry) {
    entry.ms += ms;
    entry.count++;
  } else {
    totals.set(stage, { ms, count: 1 });
  }
}

/** Runs `fn` and, when profiling is on, charges its wall time to `stage`. */
export async function timeStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  if (!stageProfileEnabled()) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    addStageTime(stage, performance.now() - start);
  }
}

export function timeStageSync<T>(stage: string, fn: () => T): T {
  if (!stageProfileEnabled()) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    addStageTime(stage, performance.now() - start);
  }
}

export function resetStageProfile(): void {
  totals.clear();
  enabled = null;
}

/** Stage -> total ms and calls, or null when profiling is off or nothing was recorded. */
export function stageProfileSnapshot(): Record<string, { ms: number; count: number }> | null {
  if (!stageProfileEnabled() || totals.size === 0) return null;
  return Object.fromEntries([...totals].map(([name, value]) => [name, { ms: Math.round(value.ms * 10) / 10, count: value.count }]));
}
