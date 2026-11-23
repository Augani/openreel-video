import { describe, expect, it, vi } from "vitest";
import { ENHANCE_FAILURE_TTL_MS, EnhanceSpeechCache, fingerprintAudioBuffer } from "./enhance-cache";
import { mixDryWet } from "./enhance-effect";
import { EnhanceCancelledError } from "./enhance-constants";
import type { EnhanceBackend, EnhanceCallOptions } from "./enhance-worker-client";

const SR = 8000;
const buffer = (seconds: number, freq = 500, amp = 0.4): AudioBuffer => {
  const data = Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};
const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;

/** "Enhancement" = halve the signal, deterministically. */
const halving = () => ({
  enhance: vi.fn(async (channels: Float32Array[], _rate: number, options?: EnhanceCallOptions): Promise<Float32Array[]> => {
    options?.onProgress?.(0.5);
    return channels.map((c) => c.map((v) => v * 0.5));
  }),
}) satisfies EnhanceBackend;

/** A job that finishes (or fails) when the test says so, and honours the abort signal. */
const manual = () => {
  const jobs: Array<{ resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal; channels: Float32Array[] }> = [];
  const backend: EnhanceBackend = {
    enhance: (channels, _rate, options) =>
      new Promise((resolve, reject) => {
        const job = { resolve: () => resolve(channels.map((c) => c.map((v) => v * 0.5))), reject, signal: options?.signal, channels };
        options?.signal?.addEventListener("abort", () => reject(new EnhanceCancelledError()));
        jobs.push(job);
      }),
  };
  return { backend, jobs };
};

describe("EnhanceSpeechCache", () => {
  it("computes once per source, shares running jobs, and peeks without running the model", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    expect(cache.peek({ buffer: source, mix: 100 })).toBeNull();
    expect(backend.enhance).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([cache.request({ buffer: source, mix: 100 }), cache.request({ buffer: source, mix: 100 })]);
    expect(backend.enhance).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(cache.peek({ buffer: source, mix: 100 })).toBe(a);
    expect(await cache.request({ buffer: source, mix: 100 })).toBe(a);
    expect(backend.enhance).toHaveBeenCalledTimes(1);
    expect(cache.status(source)).toMatchObject({ state: "ready", fraction: 1 });
  });

  it("treats Mix 0 as off: the source itself, no job", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    expect(await cache.request({ buffer: source, mix: 0 })).toBe(source);
    expect(cache.peek({ buffer: source, mix: 0 })).toBeNull();
    expect(backend.enhance).not.toHaveBeenCalled();
  });

  it("serves any Mix from the one cached enhancement: a blend per Mix, never a second model run", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    const full = (await cache.request({ buffer: source, mix: 100 }))!;
    const half = (await cache.request({ buffer: source, mix: 50 }))!;
    expect(backend.enhance).toHaveBeenCalledTimes(1);
    const dry = source.getChannelData(0);
    const wet = full.getChannelData(0);
    for (const i of [10, 777, 5000]) expect(half.getChannelData(0)[i]).toBeCloseTo(dry[i] + (wet[i] - dry[i]) * 0.5, 6);
    expect(cache.peek({ buffer: source, mix: 50 })).toBe(half);
    expect(await cache.request({ buffer: source, mix: 50 })).toBe(half);
    expect(await cache.request({ buffer: source, mix: 25 })).not.toBe(half);
  });

  it("invalidates by content, not identity: same samples share a result, a changed source recomputes", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const a = buffer(1);
    const sameContent = buffer(1);
    const different = buffer(1, 700);
    const first = await cache.request({ buffer: a, mix: 100 });
    expect(await cache.request({ buffer: sameContent, mix: 100 })).toBe(first);
    expect(cache.peek({ buffer: sameContent, mix: 100 })).toBe(first);
    expect(backend.enhance).toHaveBeenCalledTimes(1);
    const other = await cache.request({ buffer: different, mix: 100 });
    expect(other).not.toBe(first);
    expect(backend.enhance).toHaveBeenCalledTimes(2);
    expect(fingerprintAudioBuffer(a)).toBe(fingerprintAudioBuffer(sameContent));
    expect(fingerprintAudioBuffer(a)).not.toBe(fingerprintAudioBuffer(different));
    // A one-sample difference changes the fingerprint.
    const nudged = buffer(1);
    nudged.getChannelData(0)[4000] += 1e-3;
    expect(fingerprintAudioBuffer(nudged)).not.toBe(fingerprintAudioBuffer(a));
  });

  it("invalidates everything when the model identity changes", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer, modelId: "m1" });
    const source = buffer(1);
    await cache.request({ buffer: source, mix: 100 });
    cache.setModelId("m2");
    expect(cache.peek({ buffer: source, mix: 100 })).toBeNull();
    await cache.request({ buffer: source, mix: 100 });
    expect(backend.enhance).toHaveBeenCalledTimes(2);
    cache.setModelId("m1");
    expect(cache.peek({ buffer: source, mix: 100 })).not.toBeNull();
  });

  it("produces the same samples every time (deterministic), whichever cache computes them", async () => {
    const source = buffer(1);
    const one = (await new EnhanceSpeechCache({ backend: halving(), makeBuffer }).request({ buffer: source, mix: 70 }))!;
    const two = (await new EnhanceSpeechCache({ backend: halving(), makeBuffer }).request({ buffer: source, mix: 70 }))!;
    expect(Array.from(one.getChannelData(0))).toEqual(Array.from(two.getChannelData(0)));
  });

  it("notifies listeners with progress and when ready", async () => {
    const cache = new EnhanceSpeechCache({ backend: halving(), makeBuffer });
    const source = buffer(1);
    const statuses: string[] = [];
    const ready = vi.fn();
    cache.onStatus((_b, s) => statuses.push(`${s.state}:${s.fraction}`));
    cache.onReady(ready);
    const progress = vi.fn();
    const out = await cache.request({ buffer: source, mix: 100 }, { onProgress: progress });
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(statuses).toEqual(["running:0", "running:0.5", "ready:1"]);
    expect(ready).toHaveBeenCalledWith({ buffer: source, mix: 100 }, out);
  });

  it("remembers a failure for a while, then tries again", async () => {
    let now = 0;
    const failing: EnhanceBackend = { enhance: vi.fn(() => Promise.reject(new Error("model missing"))) };
    const cache = new EnhanceSpeechCache({ backend: failing, makeBuffer, now: () => now });
    const source = buffer(1);
    expect(await cache.request({ buffer: source, mix: 100 })).toBeNull();
    expect(cache.status(source)).toMatchObject({ state: "failed", error: "model missing" });
    expect(await cache.request({ buffer: source, mix: 100 })).toBeNull();
    expect(failing.enhance).toHaveBeenCalledTimes(1);
    now += ENHANCE_FAILURE_TTL_MS + 1;
    expect(cache.status(source).state).toBe("idle");
    await cache.request({ buffer: source, mix: 100 });
    expect(failing.enhance).toHaveBeenCalledTimes(2);
    cache.clearFailure(source);
    await cache.request({ buffer: source, mix: 100 });
    expect(failing.enhance).toHaveBeenCalledTimes(3);
  });

  it("cancels a running job for everyone joined to it, caches nothing and records no failure", async () => {
    const { backend, jobs } = manual();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    const a = cache.request({ buffer: source, mix: 100 });
    const b = cache.request({ buffer: source, mix: 60 });
    expect(cache.status(source).state).toBe("running");
    expect(cache.cancel(source)).toBe(true);
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect(cache.status(source)).toMatchObject({ state: "idle" });
    expect(cache.peek({ buffer: source, mix: 100 })).toBeNull();
    expect(cache.cancel(source)).toBe(false);
    // A new request starts a fresh job and succeeds.
    const retry = cache.request({ buffer: source, mix: 100 });
    jobs[1].resolve();
    expect(await retry).not.toBeNull();
    expect(jobs).toHaveLength(2);
  });

  it("keeps only the most recent finished enhancements", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer, maxReadyEntries: 2 });
    const [a, b, c] = [buffer(1, 300), buffer(1, 400), buffer(1, 500)];
    for (const source of [a, b, c]) await cache.request({ buffer: source, mix: 100 });
    expect(cache.peek({ buffer: a, mix: 100 })).toBeNull();
    expect(cache.peek({ buffer: b, mix: 100 })).not.toBeNull();
    expect(cache.peek({ buffer: c, mix: 100 })).not.toBeNull();
  });
});

describe("EnhanceSpeechCache Speech / Background balance", () => {
  it("remixes from the one cached enhancement: speech, original and background without another model run", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    const dry = source.getChannelData(0);
    const full = (await cache.request({ buffer: source, mix: 100 }))!;
    const speech = full.getChannelData(0);
    const original = (await cache.request({ buffer: source, mix: 100, balance: 50 }))!.getChannelData(0);
    const background = (await cache.request({ buffer: source, mix: 100, balance: 0 }))!.getChannelData(0);
    const quarter = (await cache.request({ buffer: source, mix: 100, balance: 75 }))!.getChannelData(0);
    expect(backend.enhance).toHaveBeenCalledTimes(1);
    for (const i of [3, 777, 5000]) {
      expect(original[i]).toBeCloseTo(dry[i], 6);
      expect(background[i]).toBeCloseTo(dry[i] - speech[i], 6);
      expect(quarter[i]).toBeCloseTo(speech[i] + 0.5 * (dry[i] - speech[i]), 6);
    }
  });

  it("keeps the default balance bit-identical to an enhancement without the control (same arrays, same blends)", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    const plain = (await cache.request({ buffer: source, mix: 100 }))!;
    expect(await cache.request({ buffer: source, mix: 100, balance: 100 })).toBe(plain);
    expect(cache.peek({ buffer: source, mix: 100, balance: undefined })).toBe(plain);
    const half = (await cache.request({ buffer: source, mix: 50 }))!;
    expect(await cache.request({ buffer: source, mix: 50, balance: 100 })).toBe(half);
    const reference = mixDryWet([source.getChannelData(0)], [plain.getChannelData(0)], 50)[0];
    expect(Buffer.from(half.getChannelData(0).buffer, half.getChannelData(0).byteOffset, half.getChannelData(0).byteLength).equals(Buffer.from(reference.buffer, reference.byteOffset, reference.byteLength))).toBe(true);
  });

  it("applies the balance first and the Mix on top, caches each combination, and peeks without running the model", async () => {
    const backend = halving();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const source = buffer(1);
    expect(cache.peek({ buffer: source, mix: 100, balance: 0 })).toBeNull();
    const a = (await cache.request({ buffer: source, mix: 60, balance: 0 }))!;
    expect(cache.peek({ buffer: source, mix: 60, balance: 0 })).toBe(a);
    // A new balance is a cheap remix of the cached enhancement, so it is available at once (the model is never involved).
    expect(cache.peek({ buffer: source, mix: 60, balance: 10 })).not.toBeNull();
    const dry = source.getChannelData(0);
    const wet = dry.map((v) => v * 0.5);
    const i = 1234;
    const processed = dry[i] - wet[i];
    expect(a.getChannelData(0)[i]).toBeCloseTo(dry[i] + (processed - dry[i]) * 0.6, 6);
    expect(backend.enhance).toHaveBeenCalledTimes(1);
  });
});
