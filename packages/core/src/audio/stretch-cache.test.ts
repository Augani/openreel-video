import { describe, expect, it, vi } from "vitest";
import { INLINE_STRETCH_MAX_SECONDS, STRETCH_FAILURE_TTL_MS, StretchCache, inlineStretchRunner, type StretchRunner } from "./stretch-cache";
import { stretchedLength } from "./time-stretch";

const RATE = 8000;

const source = (seconds: number): AudioBuffer =>
  ({
    numberOfChannels: 1,
    sampleRate: RATE,
    length: RATE * seconds,
    duration: seconds,
    getChannelData: () => new Float32Array(RATE * seconds),
  }) as unknown as AudioBuffer;

const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (c: number) => channels[c],
  }) as unknown as AudioBuffer;

const halving: StretchRunner = async (channels, _rate, speed) =>
  channels.map((c) => new Float32Array(stretchedLength(c.length, speed)));

describe("StretchCache", () => {
  it("peek never computes; request fills the cache and notifies listeners once", async () => {
    const runner = vi.fn(halving);
    const cache = new StretchCache({ runner, makeBuffer });
    const buffer = source(4);
    const request = { buffer, speed: 2, start: 1, end: 3 };
    const ready = vi.fn();
    cache.onReady(ready);
    expect(cache.peek(request)).toBeNull();
    expect(runner).not.toHaveBeenCalled();

    const result = await cache.request(request);
    expect(result?.duration).toBeCloseTo(1, 6);
    expect(cache.peek(request)).toBe(result);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(await cache.request(request)).toBe(result);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("shares one job between concurrent requests and keys by speed and range", async () => {
    const runner = vi.fn(halving);
    const cache = new StretchCache({ runner, makeBuffer });
    const buffer = source(4);
    const [a, b] = await Promise.all([
      cache.request({ buffer, speed: 2, start: 0, end: 2 }),
      cache.request({ buffer, speed: 2, start: 0, end: 2 }),
    ]);
    expect(a).toBe(b);
    expect(runner).toHaveBeenCalledTimes(1);
    await cache.request({ buffer, speed: 4, start: 0, end: 2 });
    await cache.request({ buffer, speed: 2, start: 0, end: 3 });
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("evicts the oldest entry per source buffer", async () => {
    const cache = new StretchCache({ runner: halving, makeBuffer, maxEntriesPerBuffer: 2 });
    const buffer = source(10);
    for (const start of [0, 1, 2]) await cache.request({ buffer, speed: 2, start, end: start + 1 });
    expect(cache.peek({ buffer, speed: 2, start: 0, end: 1 })).toBeNull();
    expect(cache.peek({ buffer, speed: 2, start: 2, end: 3 })).not.toBeNull();
  });

  it("resolves null (and is retryable after the failure memory expires) when the runner fails, and for empty or oversized ranges", async () => {
    let fail = true;
    const runner: StretchRunner = (channels, rate, speed) => (fail ? Promise.reject(new Error("x")) : halving(channels, rate, speed));
    let clock = 0;
    const cache = new StretchCache({ runner, makeBuffer, maxSeconds: 5, now: () => clock });
    const buffer = source(10);
    const request = { buffer, speed: 2, start: 0, end: 2 };
    expect(await cache.request(request)).toBeNull();
    fail = false;
    clock += STRETCH_FAILURE_TTL_MS + 1;
    expect(await cache.request(request)).not.toBeNull();
    expect(await cache.request({ buffer, speed: 2, start: 3, end: 3 })).toBeNull();
    expect(await cache.request({ buffer, speed: 2, start: 0, end: 9 })).toBeNull();
  });

  it("the inline fallback stretches off the current call stack", async () => {
    let ran = false;
    const promise = inlineStretchRunner([new Float32Array(RATE)], RATE, 2).then((out) => {
      ran = true;
      return out;
    });
    expect(ran).toBe(false);
    const out = await promise;
    expect(out[0].length).toBe(RATE / 2);
  });

  it("remembers failed keys for a while instead of re-running the stretch", async () => {
    let clock = 0;
    const runner = vi.fn<Parameters<StretchRunner>, ReturnType<StretchRunner>>(async () => {
      throw new Error("boom");
    });
    const cache = new StretchCache({ runner, makeBuffer, now: () => clock });
    const request = { buffer: source(4), speed: 2, start: 0, end: 2 };
    expect(await cache.request(request)).toBeNull();
    expect(await cache.request(request)).toBeNull();
    expect(runner).toHaveBeenCalledTimes(1);
    clock += STRETCH_FAILURE_TTL_MS + 1;
    await cache.request(request);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("rejects over-long ranges in the inline fallback", async () => {
    const long = [new Float32Array(RATE * (INLINE_STRETCH_MAX_SECONDS + 1))];
    await expect(inlineStretchRunner(long, RATE, 2)).rejects.toThrow(/limited/);
  });
});
