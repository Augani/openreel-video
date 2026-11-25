import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IdleRenderScheduler,
  hasIdleCacheRoom,
  pickIdleChunk,
  type IdleChunkResult,
  type IdleRenderDeps,
} from "./idle-render-scheduler";
import type { TimeRange } from "./time-ranges";

interface Harness {
  scheduler: IdleRenderScheduler;
  rendered: TimeRange[];
  pending: TimeRange[];
  flags: { enabled: boolean; busy: boolean; memory: boolean; power: boolean };
  playhead: { value: number };
  gate: { hold: boolean; release: (() => void) | null };
}

function make(overrides: Partial<IdleRenderDeps> = {}): Harness {
  const rendered: TimeRange[] = [];
  const pending: TimeRange[] = [{ start: 0, end: 2.5 }, { start: 10, end: 12 }];
  const flags = { enabled: true, busy: false, memory: true, power: true };
  const playhead = { value: 0 };
  const gate: Harness["gate"] = { hold: false, release: null };
  const deps: IdleRenderDeps = {
    isEnabled: () => flags.enabled,
    isBusy: () => flags.busy,
    isMemoryOk: () => flags.memory,
    isPowerOk: () => flags.power,
    getPlayhead: () => playhead.value,
    getPendingRanges: () => pending,
    renderChunk: async (range, signal): Promise<IdleChunkResult> => {
      if (gate.hold) {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (signal.aborted) return { status: "canceled", framesRendered: 0, framesSkipped: 0 };
      rendered.push(range);
      // Rendering a chunk removes it from what is pending.
      const index = pending.findIndex((p) => range.start >= p.start && range.end <= p.end);
      const [hit] = pending.splice(index, 1);
      if (range.start > hit.start) pending.push({ start: hit.start, end: range.start });
      if (range.end < hit.end) pending.push({ start: range.end, end: hit.end });
      return { status: "completed", framesRendered: 30, framesSkipped: 0 };
    },
    yieldToUi: () => Promise.resolve(),
    idleMs: 3000,
    chunkSeconds: 1,
    ...overrides,
  };
  return { scheduler: new IdleRenderScheduler(deps), rendered, pending, flags, playhead, gate };
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("pickIdleChunk", () => {
  it("takes the range nearest the playhead and the chunk closest to it", () => {
    const ranges = [{ start: 0, end: 5 }, { start: 20, end: 30 }];
    expect(pickIdleChunk(ranges, 22, 1)).toEqual({ start: 22, end: 23 });
    expect(pickIdleChunk(ranges, 8, 1)).toEqual({ start: 0, end: 1 });
    expect(pickIdleChunk(ranges, 15, 1)).toEqual({ start: 20, end: 21 });
    expect(pickIdleChunk([], 0, 1)).toBeNull();
  });

  it("clamps the chunk to the end of the range", () => {
    expect(pickIdleChunk([{ start: 4, end: 4.4 }], 0, 1)).toEqual({ start: 4, end: 4.4 });
  });
});

describe("IdleRenderScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing before the idle period, then renders pending ranges in chunks nearest the playhead first", async () => {
    const h = make();
    h.playhead.value = 11;
    h.scheduler.notifyActivity();
    await advance(2900);
    expect(h.rendered).toHaveLength(0);
    await advance(200);
    expect(h.rendered[0]).toEqual({ start: 11, end: 12 });
    // The range the playhead is in is finished before the farther one starts.
    expect(h.rendered[1]).toEqual({ start: 10, end: 11 });
    expect(h.rendered[2]).toEqual({ start: 0, end: 1 });
    expect(h.pending).toHaveLength(0);
    expect(h.scheduler.state.kind).toBe("done");
  });

  it("cancels the running chunk at once on activity (edit, playback, scrub)", async () => {
    const h = make();
    h.gate.hold = true;
    h.scheduler.notifyActivity();
    await advance(3000);
    expect(h.scheduler.state.kind).toBe("rendering");
    h.scheduler.notifyActivity();
    expect(h.scheduler.state.kind).toBe("waiting");
    await advance(10);
    expect(h.rendered).toHaveLength(0);
    // The activity restarted the quiet period: nothing renders for another 3 s minus what has passed.
    h.gate.hold = false;
    await advance(2900);
    expect(h.rendered).toHaveLength(0);
  });

  it("resumes after the next quiet period", async () => {
    const h = make();
    h.gate.hold = true;
    h.scheduler.notifyActivity();
    await advance(3000);
    h.scheduler.notifyActivity();
    h.gate.hold = false;
    await advance(3100);
    expect(h.rendered.length).toBeGreaterThan(0);
    expect(h.pending).toHaveLength(0);
  });

  it("never starts when the setting is off, and starts after it is turned on", async () => {
    const h = make();
    h.flags.enabled = false;
    h.scheduler.notifyActivity();
    await advance(10_000);
    expect(h.rendered).toHaveLength(0);
    expect(h.scheduler.state.kind).toBe("off");
    h.flags.enabled = true;
    h.scheduler.notifyConditionsChanged();
    await advance(3100);
    expect(h.rendered.length).toBeGreaterThan(0);
  });

  it("stops mid-run when the setting is switched off", async () => {
    const h = make();
    h.gate.hold = true;
    h.scheduler.notifyActivity();
    await advance(3000);
    h.flags.enabled = false;
    h.scheduler.notifyConditionsChanged();
    h.gate.release?.();
    await advance(10_000);
    expect(h.rendered).toHaveLength(0);
    expect(h.scheduler.state.kind).toBe("off");
  });

  it("pauses under memory pressure and low power, and resumes when they clear", async () => {
    const h = make();
    h.flags.memory = false;
    h.scheduler.notifyActivity();
    await advance(10_000);
    expect(h.rendered).toHaveLength(0);
    expect(h.scheduler.state).toEqual({ kind: "paused", reason: "memory" });
    h.flags.memory = true;
    h.flags.power = false;
    h.scheduler.notifyConditionsChanged();
    await advance(10_000);
    expect(h.rendered).toHaveLength(0);
    expect(h.scheduler.state).toEqual({ kind: "paused", reason: "power" });
    h.flags.power = true;
    h.scheduler.notifyConditionsChanged();
    await advance(3100);
    expect(h.rendered.length).toBeGreaterThan(0);
  });

  it("aborts a running chunk when memory pressure arrives", async () => {
    const h = make();
    h.gate.hold = true;
    h.scheduler.notifyActivity();
    await advance(3000);
    h.flags.memory = false;
    h.scheduler.notifyConditionsChanged();
    await advance(10);
    expect(h.rendered).toHaveLength(0);
    expect(h.scheduler.state).toEqual({ kind: "paused", reason: "memory" });
  });

  it("waits while an export or manual render owns the engine", async () => {
    const h = make();
    h.flags.busy = true;
    h.scheduler.notifyActivity();
    await advance(7000);
    expect(h.rendered).toHaveLength(0);
    h.flags.busy = false;
    await advance(3100);
    expect(h.rendered.length).toBeGreaterThan(0);
  });

  it("stays quiet after the user cancels until the next activity", async () => {
    const h = make();
    h.gate.hold = true;
    h.scheduler.notifyActivity();
    await advance(3000);
    h.scheduler.suspendUntilActivity();
    h.gate.hold = false;
    await advance(20_000);
    expect(h.rendered).toHaveLength(0);
    h.scheduler.notifyActivity();
    await advance(3100);
    expect(h.rendered.length).toBeGreaterThan(0);
  });

  it("gives up on a range that renders nothing instead of spinning", async () => {
    const calls: TimeRange[] = [];
    const h = make({
      getPendingRanges: () => [{ start: 0, end: 5 }],
      renderChunk: async (range) => {
        calls.push(range);
        return { status: "completed", framesRendered: 0, framesSkipped: 30 };
      },
    });
    h.scheduler.notifyActivity();
    await advance(5000);
    expect(calls).toHaveLength(2);
  });

  it("does not retry after a failed chunk until the next activity", async () => {
    let attempts = 0;
    const h = make({
      renderChunk: async () => {
        attempts++;
        return { status: "failed", framesRendered: 0, framesSkipped: 0 };
      },
    });
    h.scheduler.notifyActivity();
    await advance(20_000);
    expect(attempts).toBe(1);
  });
});

describe("hasIdleCacheRoom", () => {
  it("allows the first chunk into an empty cache", () => {
    expect(hasIdleCacheRoom({ bytes: 0, budget: 1000, frameCount: 0 }, 30)).toBe(true);
  });
  it("stops once another chunk would evict cached frames", () => {
    // 100 bytes per frame, a 30-frame chunk is 3000 bytes.
    expect(hasIdleCacheRoom({ bytes: 7000, budget: 10000, frameCount: 70 }, 30)).toBe(true);
    expect(hasIdleCacheRoom({ bytes: 7100, budget: 10000, frameCount: 71 }, 30)).toBe(false);
  });
});
