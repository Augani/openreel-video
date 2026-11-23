import { describe, expect, it, vi } from "vitest";
import { REVERB_FAILURE_TTL_MS, ReduceReverbCache } from "./reverb-cache";
import { ReverbCancelledError } from "./reverb-params";
import type { ReverbBackend, ReverbCallOptions } from "./reverb-worker-client";

const SR = 8000;
const buffer = (seconds: number, freq = 500, amp = 0.4): AudioBuffer => {
  const data = Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};
const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const P = (amount: number, sensitivity = 50) => ({ amount, sensitivity });

const halving = () => ({
  reduce: vi.fn(async (channels: Float32Array[], _rate: number, _params: unknown, options?: ReverbCallOptions) => {
    options?.onProgress?.(0.5);
    return { channels: channels.map((c) => c.map((v) => v * 0.5)), rt60: 0.7, confidence: 1 };
  }),
}) satisfies ReverbBackend;

const manual = () => {
  const jobs: Array<{ resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal; amount: number }> = [];
  const backend: ReverbBackend = {
    reduce: (channels, _rate, params, options) =>
      new Promise((resolve, reject) => {
        const job = { resolve: () => resolve({ channels: channels.map((c) => c.map((v) => v * 0.5)), rt60: 0.5, confidence: 0 }), reject, signal: options?.signal, amount: params.amount };
        options?.signal?.addEventListener("abort", () => reject(new ReverbCancelledError()));
        jobs.push(job);
      }),
  };
  return { backend, jobs };
};

describe("ReduceReverbCache", () => {
  it("computes once per source and setting, shares running jobs, peeks without computing, and reports the estimate", async () => {
    const backend = halving();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const source = buffer(1);
    expect(cache.peek({ buffer: source, params: P(60) })).toBeNull();
    expect(backend.reduce).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([cache.request({ buffer: source, params: P(60) }), cache.request({ buffer: source, params: P(60) })]);
    expect(backend.reduce).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(cache.peek({ buffer: source, params: P(60) })).toBe(a);
    expect(await cache.request({ buffer: source, params: P(60) })).toBe(a);
    expect(backend.reduce).toHaveBeenCalledTimes(1);
    expect(cache.status(source, P(60))).toMatchObject({ state: "ready", fraction: 1, rt60: 0.7, confidence: 1 });
  });

  it("treats Amount 0 as off: the source itself, no job", async () => {
    const backend = halving();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const source = buffer(1);
    expect(await cache.request({ buffer: source, params: P(0) })).toBe(source);
    expect(cache.peek({ buffer: source, params: P(0) })).toBeNull();
    expect(backend.reduce).not.toHaveBeenCalled();
  });

  it("keys on Amount and Sensitivity: another setting recomputes, the same one never does", async () => {
    const backend = halving();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const source = buffer(1);
    const a = await cache.request({ buffer: source, params: P(60, 50) });
    const b = await cache.request({ buffer: source, params: P(80, 50) });
    const c = await cache.request({ buffer: source, params: P(60, 20) });
    expect(backend.reduce).toHaveBeenCalledTimes(3);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(await cache.request({ buffer: source, params: P(80, 50) })).toBe(b);
    expect(backend.reduce).toHaveBeenCalledTimes(3);
  });

  it("invalidates by content, not identity, and by model id", async () => {
    const backend = halving();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const a = buffer(1);
    expect(await cache.request({ buffer: buffer(1), params: P(60) })).toBe(await cache.request({ buffer: a, params: P(60) }));
    expect(backend.reduce).toHaveBeenCalledTimes(1);
    await cache.request({ buffer: buffer(1, 501), params: P(60) });
    expect(backend.reduce).toHaveBeenCalledTimes(2);
    cache.setModelId("reduce-reverb-next");
    await cache.request({ buffer: a, params: P(60) });
    expect(backend.reduce).toHaveBeenCalledTimes(3);
  });

  it("cancels: every request resolves null, nothing is cached or remembered as a failure", async () => {
    const { backend, jobs } = manual();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const source = buffer(1);
    const pending = cache.request({ buffer: source, params: P(60) });
    expect(cache.status(source, P(60)).state).toBe("running");
    expect(cache.cancel(source)).toBe(true);
    expect(await pending).toBeNull();
    expect(cache.status(source, P(60))).toMatchObject({ state: "idle" });
    expect(cache.peek({ buffer: source, params: P(60) })).toBeNull();
    expect(cache.cancel(source)).toBe(false);
    const again = cache.request({ buffer: source, params: P(60) });
    await tick();
    jobs[jobs.length - 1].resolve();
    expect(await again).not.toBeNull();
  });

  it("keeps a job per source and setting: two clips of one file with different Amounts both complete", async () => {
    const { backend, jobs } = manual();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const source = buffer(1);
    const first = cache.request({ buffer: source, params: P(40) });
    const second = cache.request({ buffer: source, params: P(70) });
    await tick();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].signal?.aborted).toBe(false);
    expect(jobs[1].signal?.aborted).toBe(false);
    jobs[0].resolve();
    jobs[1].resolve();
    expect(await first).not.toBeNull();
    expect(await second).not.toBeNull();
    expect(cache.peek({ buffer: source, params: P(70) })).not.toBeNull();
    expect(cache.peek({ buffer: source, params: P(40) })).not.toBeNull();
  });

  it("cancels only the job of the setting it is given, and lets the other finish", async () => {
    const { backend, jobs } = manual();
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const source = buffer(1);
    const old = cache.request({ buffer: source, params: P(40) });
    const kept = cache.request({ buffer: source, params: P(70) });
    await tick();
    expect(cache.cancel(source, P(40))).toBe(true);
    expect(await old).toBeNull();
    jobs[1].resolve();
    expect(await kept).not.toBeNull();
  });

  it("runs at most maxConcurrent jobs at once, queues the rest, and a queued job can be cancelled before it starts", async () => {
    const { backend, jobs } = manual();
    const cache = new ReduceReverbCache({ backend, makeBuffer, maxConcurrent: 2 });
    const source = buffer(1);
    const p1 = cache.request({ buffer: source, params: P(10) });
    const p2 = cache.request({ buffer: source, params: P(20) });
    const p3 = cache.request({ buffer: source, params: P(30) });
    const p4 = cache.request({ buffer: source, params: P(40) });
    await tick();
    expect(jobs).toHaveLength(2);
    expect(cache.status(source, P(30)).state).toBe("running");
    expect(cache.cancel(source, P(40))).toBe(true);
    expect(await p4).toBeNull();
    jobs[0].resolve();
    expect(await p1).not.toBeNull();
    await tick();
    expect(jobs).toHaveLength(3);
    jobs[1].resolve();
    jobs[2].resolve();
    expect(await p2).not.toBeNull();
    expect(await p3).not.toBeNull();
    expect(jobs).toHaveLength(3);
  });

  it("remembers a failure for a while, then tries again", async () => {
    let now = 1000;
    const reduce = vi.fn().mockRejectedValueOnce(new Error("worker crashed")).mockResolvedValue({ channels: [new Float32Array(SR)], rt60: 0.4, confidence: 0 });
    const cache = new ReduceReverbCache({ backend: { reduce }, makeBuffer, now: () => now });
    const source = buffer(1);
    expect(await cache.request({ buffer: source, params: P(60) })).toBeNull();
    expect(cache.status(source, P(60))).toMatchObject({ state: "failed", error: "worker crashed" });
    expect(await cache.request({ buffer: source, params: P(60) })).toBeNull();
    expect(reduce).toHaveBeenCalledTimes(1);
    now += REVERB_FAILURE_TTL_MS + 1;
    expect(await cache.request({ buffer: source, params: P(60) })).not.toBeNull();
    expect(reduce).toHaveBeenCalledTimes(2);
  });

  it("notifies ready and status listeners, and keeps only the most recent results", async () => {
    const backend = halving();
    const cache = new ReduceReverbCache({ backend, makeBuffer, maxReadyEntries: 2 });
    const ready = vi.fn();
    const states: string[] = [];
    cache.onReady(ready);
    cache.onStatus((_buffer, status) => states.push(status.state));
    const sources = [buffer(1, 300), buffer(1, 400), buffer(1, 500)];
    for (const source of sources) await cache.request({ buffer: source, params: P(60) });
    expect(ready).toHaveBeenCalledTimes(3);
    expect(states).toContain("running");
    expect(states[states.length - 1]).toBe("ready");
    expect(cache.peek({ buffer: sources[0], params: P(60) })).toBeNull();
    expect(cache.peek({ buffer: sources[2], params: P(60) })).not.toBeNull();
  });
});
