import { describe, expect, it, vi } from "vitest";
import { EnhanceSpeechCache } from "./enhance-cache";
import { mixDryWet, planEnhanceSpeechChange, planEnhanceSpeechAction, speechBackgroundGains } from "./enhance-effect";
import type { EnhanceBackend } from "./enhance-worker-client";

const SR = 8000;
const stereo = (seed: number): AudioBuffer => {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const ch = [0, 1].map(() => Float32Array.from({ length: SR * 2 }, (_, i) => 0.3 * Math.sin(i * 0.05) + 0.1 * rnd()));
  return { numberOfChannels: 2, sampleRate: SR, length: ch[0].length, duration: 2, getChannelData: (c: number) => ch[c] } as unknown as AudioBuffer;
};
const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;
/** Nonlinear "enhancement": soft gate plus gain, so background = dry - wet is non-trivial. */
const gate = () => ({ enhance: vi.fn(async (channels: Float32Array[]) => channels.map((c) => c.map((v) => (Math.abs(v) > 0.12 ? v * 0.8 : v * 0.05)))) }) satisfies EnhanceBackend;
const same = (a: Float32Array, b: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

describe("Speech / Background balance, independent checks", () => {
  it("never re-runs the model when the balance or mix moves, across a sweep and a reload of the same content", async () => {
    const backend = gate();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const src = stereo(3);
    await cache.request({ buffer: src, mix: 100 });
    for (const balance of [100, 90, 73.3, 50, 33, 10, 0, 1, 99, 50, 0]) {
      for (const mix of [100, 80, 35]) {
        expect(cache.peek({ buffer: src, mix, balance })).not.toBeNull();
        await cache.request({ buffer: src, mix, balance });
      }
    }
    // a second decode of the same file (distinct object, same samples) also shares the cached job
    const copy = stereo(3);
    await cache.request({ buffer: copy, mix: 100, balance: 20 });
    expect(backend.enhance).toHaveBeenCalledTimes(1);
  });

  it("matches the closed-form stems exactly at several balances and keeps the legacy path bit-identical", async () => {
    const backend = gate();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const src = stereo(9);
    const wet = [0, 1].map((c) => src.getChannelData(c).map((v) => (Math.abs(v) > 0.12 ? v * 0.8 : v * 0.05)));
    for (const c of [0, 1]) expect(same(((await cache.request({ buffer: src, mix: 100 })) as AudioBuffer).getChannelData(c), wet[c])).toBe(true);
    for (const mix of [100, 65, 12.5]) {
      // legacy: no balance, and explicit 100, must equal mixDryWet exactly
      const legacy = mixDryWet([src.getChannelData(0), src.getChannelData(1)], wet, mix);
      for (const balance of [undefined, 100]) {
        const out = (await cache.request({ buffer: src, mix, balance })) as AudioBuffer;
        for (const c of [0, 1]) expect(same(out.getChannelData(c), legacy[c])).toBe(true);
      }
    }
    for (const balance of [75, 50, 25, 0]) {
      const g = speechBackgroundGains(balance);
      const out = (await cache.request({ buffer: src, mix: 100, balance })) as AudioBuffer;
      for (let c = 0; c < 2; c += 1) {
        const d = src.getChannelData(c);
        let maxErr = 0;
        for (let i = 0; i < d.length; i += 1) maxErr = Math.max(maxErr, Math.abs(out.getChannelData(c)[i] - (g.speech * wet[c][i] + g.background * (d[i] - wet[c][i]))));
        expect(maxErr).toBeLessThan(1e-6);
      }
    }
    // balance 50 is the original mix; speech + background at 100/0 reconstruct the original
    const half = (await cache.request({ buffer: src, mix: 100, balance: 50 })) as AudioBuffer;
    let err = 0; for (let i = 0; i < src.length; i += 1) err = Math.max(err, Math.abs(half.getChannelData(0)[i] - src.getChannelData(0)[i]));
    expect(err).toBeLessThan(1e-6);
    const sp = (await cache.request({ buffer: src, mix: 100, balance: 100 })) as AudioBuffer;
    const bg = (await cache.request({ buffer: src, mix: 100, balance: 0 })) as AudioBuffer;
    let rec = 0; for (let i = 0; i < src.length; i += 1) rec = Math.max(rec, Math.abs(sp.getChannelData(1)[i] + bg.getChannelData(1)[i] - src.getChannelData(1)[i]));
    expect(rec).toBeLessThan(1e-6);
  });

  it("peek before the job is done is null for every balance (no model run from peek)", () => {
    const backend = gate();
    const cache = new EnhanceSpeechCache({ backend, makeBuffer });
    const src = stereo(4);
    for (const balance of [0, 50, 100]) expect(cache.peek({ buffer: src, mix: 100, balance })).toBeNull();
    expect(backend.enhance).not.toHaveBeenCalled();
  });

  it("planned actions: the default balance is not stored, old effects round trip, other params are preserved", () => {
    const clip = { id: "c", audioEffects: [{ id: "e", type: "enhanceSpeech", enabled: true, params: { mix: 70, extra: 1 } }] } as never;
    const a = planEnhanceSpeechAction(clip, 70, { actionId: "a", effectId: "e2" }, 1);
    expect(a).toBeNull();
    const b = planEnhanceSpeechChange(clip, { balance: 30 }, { actionId: "a", effectId: "e2" }, 1) as unknown as { params: { effect: { params: Record<string, number> } } };
    expect(b.params.effect.params).toEqual({ mix: 70, extra: 1, balance: 30 });
    const withBal = { id: "c", audioEffects: [{ id: "e", type: "enhanceSpeech", enabled: true, params: b.params.effect.params }] } as never;
    const back = planEnhanceSpeechChange(withBal, { balance: 100 }, { actionId: "a", effectId: "e2" }, 1) as unknown as { params: { effect: { params: Record<string, number> } } };
    expect(back.params.effect.params).toEqual({ mix: 70, extra: 1 });
    expect(planEnhanceSpeechChange(withBal, { balance: 30 }, { actionId: "a", effectId: "e2" }, 1)).toBeNull();
    // garbage balance falls back to the default instead of NaN
    expect(speechBackgroundGains(NaN)).toEqual({ speech: 1, background: 0 });
    expect(speechBackgroundGains(-5)).toEqual({ speech: 0, background: 1 });
    expect(speechBackgroundGains(250)).toEqual({ speech: 1, background: 0 });
  });
});
