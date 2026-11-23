import type { CDPSession, Page } from "@playwright/test";
import { clipsOf, readState, setZoom } from "./helpers";

/**
 * Large-sequence timeline perf harness. Sequences are seeded through the real project store (a bulk clone of the
 * imported clip, not a thousand split actions), then every measured operation goes through the real UI path
 * (keyboard shortcut / dialog / store action the UI calls). Times are click-to-paint: from the browser's input
 * timestamp (or the performance.now() of a programmatic trigger) until the frame that shows the result has been
 * presented (double requestAnimationFrame + a task after it).
 */

interface PerfWindow {
  __openreelE2E: {
    project: { getState(): Record<string, any>; setState(s: Record<string, unknown>): void };
    timeline: { getState(): Record<string, any> };
    ui: { getState(): Record<string, any> };
  };
  __perf: {
    long: Array<{ start: number; duration: number }>;
    t0: number;
    armClick(): void;
  };
}

export interface OpResult {
  ms: number;
  longTasks: number[];
}
export interface FrameResult {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  over50: number;
  longTasks: number[];
}

/** Replace the Main track with `n` one-second clips (and a matching audio track) on a 100 px/s timeline. */
export async function seedClips(page: Page, n: number, withAudio = true): Promise<string[]> {
  await page.evaluate(({ count, withAudio }) => {
    const e = (window as unknown as PerfWindow).__openreelE2E;
    const { project } = e.project.getState();
    const main = project.timeline.tracks.find((t: any) => t.name === "Main");
    const proto = main.clips[0];
    const makeClips = (trackId: string, prefix: string) =>
      Array.from({ length: count }, (_, i) => ({
        ...structuredClone(proto),
        id: `${prefix}-${i}`,
        trackId,
        startTime: i,
        duration: 1,
        inPoint: i % 5,
        outPoint: (i % 5) + 1,
        linkedClipId: undefined,
        linkGroupId: undefined,
      }));
    const dialogueId = "perf-dialogue";
    const dialogue = {
      ...structuredClone(main),
      id: dialogueId,
      name: "Dialogue",
      type: "audio",
      role: "dialogue",
      clips: makeClips(dialogueId, "a").map((c: any, i: number) => ({ ...c, metadata: { ...(c.metadata ?? {}), separatedFromClipId: `p-${i}` } })),
    };
    const tracks = [
      ...project.timeline.tracks.filter((t: any) => t.id !== dialogueId).map((t: any) => (t.id === main.id ? { ...t, clips: makeClips(t.id, "p") } : t)),
      ...(withAudio ? [dialogue] : []),
    ];
    e.project.setState({ project: { ...project, timeline: { ...project.timeline, tracks } } });
  }, { count: n, withAudio });
  await page.waitForTimeout(1500);
  const ids = clipsOf(await readState(page), "Main").map((c) => c.id);
  if (ids.length !== n) throw new Error(`seeded ${ids.length} clips, wanted ${n}`);
  await setZoom(page, 100);
  return ids;
}

/** Install the long-task observer and a capture-phase input timestamp recorder. */
export async function installProbes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as PerfWindow;
    w.__perf = { long: [], t0: 0, armClick() {} };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.long.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: false });
    for (const type of ["pointerdown", "keydown", "click"]) {
      document.addEventListener(type, (ev) => { w.__perf.t0 = ev.timeStamp; }, { capture: true });
    }
  });
}

/**
 * Wait (in the page) for `done()` to turn true, then for the frame that shows it to be presented. Returns from t0
 * (the last input event timestamp, or `startAt` when given) to that moment plus the long tasks inside the window.
 */
export async function awaitPaint(page: Page, doneSource: string, startAt?: number): Promise<OpResult> {
  return page.evaluate(
    ({ doneSource, startAt }) =>
      new Promise<{ ms: number; longTasks: number[] }>((resolve, reject) => {
        const w = window as unknown as PerfWindow;
        const done = new Function(`return (${doneSource})`)() as () => boolean;
        const t0 = startAt ?? w.__perf.t0;
        const deadline = performance.now() + 30_000;
        const tick = () => {
          if (done()) {
            requestAnimationFrame(() => {
              const ch = new MessageChannel();
              ch.port1.onmessage = () => {
                const end = performance.now();
                resolve({ ms: end - t0, longTasks: w.__perf.long.filter((l) => l.start >= t0).map((l) => l.duration) });
              };
              ch.port2.postMessage(0);
            });
            return;
          }
          if (performance.now() > deadline) return reject(new Error("awaitPaint timed out"));
          requestAnimationFrame(tick);
        };
        tick();
      }),
    { doneSource, startAt },
  );
}

/** Reset the long task list and return the current time so a programmatic trigger can pass it as startAt. */
export async function resetLong(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as PerfWindow).__perf.long.length = 0; });
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 };
};

/** Drive `step(i)` once per animation frame for `frames` frames and report frame-to-frame deltas. */
export async function frameRun(page: Page, stepSource: string, frames: number): Promise<FrameResult> {
  const r = await page.evaluate(
    ({ stepSource, frames }) =>
      new Promise<{ deltas: number[]; longTasks: number[] }>((resolve) => {
        const w = window as unknown as PerfWindow;
        const step = new Function(`return (${stepSource})`)() as (i: number) => void;
        w.__perf.long.length = 0;
        const deltas: number[] = [];
        let last = 0;
        let i = 0;
        const frame = (now: number) => {
          if (last) deltas.push(now - last);
          last = now;
          if (i >= frames) return resolve({ deltas, longTasks: w.__perf.long.map((l) => l.duration) });
          step(i++);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { stepSource, frames },
  );
  const { p50, p95, max } = stats(r.deltas);
  return { frames: r.deltas.length, p50, p95, max, over50: r.deltas.filter((d) => d > 50).length, longTasks: r.longTasks };
}

/** Optional CDP CPU profile (PERF_PROFILE_DIR) around an operation. Returns the profile path when written. */
export async function withProfile<T>(page: Page, name: string, fn: () => Promise<T>): Promise<T> {
  const dir = process.env.PERF_PROFILE_DIR;
  if (!dir) return fn();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  try {
    return await fn();
  } finally {
    const { profile } = await cdp.send("Profiler.stop");
    writeFileSync(`${dir}/${name}.cpuprofile`, JSON.stringify(profile));
    await cdp.detach();
  }
}

/** Optional CDP trace (PERF_TRACE_DIR) around an operation, for opening in DevTools / Perfetto. */
export async function withTrace<T>(page: Page, name: string, fn: () => Promise<T>): Promise<T> {
  const dir = process.env.PERF_TRACE_DIR;
  if (!dir) return fn();
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const browser = page.context().browser();
  if (!browser) return fn();
  await browser.startTracing(page, { path: `${dir}/${name}.trace.json`, categories: ["devtools.timeline", "v8.execute", "disabled-by-default-devtools.timeline"] });
  try {
    return await fn();
  } finally {
    await browser.stopTracing();
  }
}
