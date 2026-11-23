import { describe, expect, it } from "vitest";
import { DFN3_DF_BINS, DFN3_DF_ORDER, DFN3_ERB_BANDS, DFN3_LOOKAHEAD, EnhanceCancelledError, type Dfn3Inference } from "./dfn3-dsp";
import { ENHANCE_TARGET_RMS, enhanceChannels, enhanceLevelScale } from "./enhance-engine";
import { createEnhanceHandler, transferListOf, type EnhanceResponse } from "./enhance-worker-core";

/** Identity network that counts the frames it is given and optionally scales everything (to test the peak guard). */
const counting = (gain = 1) => {
  const state = { frames: 0, calls: 0 };
  const infer: Dfn3Inference = async (_erb, _spec, frames) => {
    state.frames += frames;
    state.calls += 1;
    const mask = new Float32Array(frames * DFN3_ERB_BANDS).fill(gain);
    const coefs = new Float32Array(frames * DFN3_DF_BINS * DFN3_DF_ORDER * 2);
    for (let r = 0; r < frames; r += 1) for (let f = 0; f < DFN3_DF_BINS; f += 1) coefs[((r * DFN3_DF_BINS + f) * DFN3_DF_ORDER + DFN3_LOOKAHEAD) * 2] = gain;
    return { mask, coefs };
  };
  return { infer, state };
};

const voiceLike = (rate: number, seconds: number, amp = 0.3) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * (Math.sin((2 * Math.PI * 220 * i) / rate) + 0.5 * Math.sin((2 * Math.PI * 660 * i) / rate)) * Math.sin((Math.PI * i) / (rate * seconds)) ** 0.5);

const maxDiff = (a: Float32Array, b: Float32Array, guard = 0) => {
  let worst = 0;
  for (let i = guard; i < a.length - guard; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

describe("enhanceChannels", () => {
  it("returns channels of the source's length and rate (48 kHz passes straight through an identity network)", async () => {
    const { infer } = counting();
    const l = voiceLike(48000, 0.7);
    const out = await enhanceChannels([l], 48000, { infer });
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(l.length);
    expect(maxDiff(out[0], l)).toBeLessThan(2e-5);
  });

  it("resamples in and back out for other rates and keeps the exact length and alignment", async () => {
    const { infer } = counting();
    for (const rate of [44100, 16000, 22050, 96000]) {
      const x = voiceLike(rate, 0.8);
      const out = await enhanceChannels([x], rate, { infer });
      expect(out[0]).toHaveLength(x.length);
      // Band-limited round trip through the 48 kHz domain: within 0.5 % of full scale away from the edges.
      expect(maxDiff(out[0], x, 1500)).toBeLessThan(0.005);
    }
  });

  it("runs identical channels (dual-mono dialogue) through the network once and shares the result", async () => {
    const mono = counting();
    const x = voiceLike(48000, 0.5);
    const stereo = await enhanceChannels([x, x.slice()], 48000, { infer: mono.infer });
    const single = counting();
    await enhanceChannels([x], 48000, { infer: single.infer });
    expect(mono.state.frames).toBe(single.state.frames);
    expect(stereo[0]).toBe(stereo[1]);

    const distinct = counting();
    const y = voiceLike(48000, 0.5, 0.2);
    const two = await enhanceChannels([x, y], 48000, { infer: distinct.infer });
    expect(distinct.state.frames).toBe(2 * single.state.frames);
    expect(two[0]).not.toBe(two[1]);
  });

  it("never lets the result peak above max(source peak, 0.999)", async () => {
    const { infer } = counting(3);
    const x = voiceLike(48000, 0.5, 0.4);
    const out = await enhanceChannels([x, voiceLike(48000, 0.5, 0.2)], 48000, { infer });
    const peak = Math.max(...out.map((channel) => channel.reduce((p, v) => Math.max(p, Math.abs(v)), 0)));
    expect(peak).toBeLessThanOrEqual(0.9991);
    expect(peak).toBeGreaterThan(0.9);
  });

  it("works at a fixed level: the same clip at another level (mono vs a -3 dB stereo upmix) enhances to the same samples, scaled", async () => {
    const seen: number[] = [];
    const level: Dfn3Inference = async (erb, spec, frames) => {
      seen.push(erb[0]);
      return counting().infer(erb, spec, frames);
    };
    const x = voiceLike(48000, 0.6);
    const quieter = Float32Array.from(x, (v) => v * Math.SQRT1_2);
    const [a] = await enhanceChannels([x], 48000, { infer: level });
    const [b] = await enhanceChannels([quieter], 48000, { infer: level });
    expect(seen[0]).toBeCloseTo(seen[1], 4); // the network is fed the same features either way
    expect(maxDiff(a, Float32Array.from(b, (v) => v / Math.SQRT1_2))).toBeLessThan(1e-6);
    // The scale brings the clip to the network's level and leaves silence alone.
    expect(Math.sqrt(x.reduce((p, v) => p + v * v, 0) / x.length) * enhanceLevelScale([x])).toBeCloseTo(ENHANCE_TARGET_RMS, 6);
    expect(enhanceLevelScale([new Float32Array(100)])).toBe(1);
    expect(enhanceLevelScale([Float32Array.of(1e-9, -1e-9)])).toBe(1);
    expect(enhanceLevelScale([Float32Array.of(1e-6, -1e-6)])).toBe(1000);
  });

  it("handles no channels and cancellation", async () => {
    expect(await enhanceChannels([], 48000, { infer: counting().infer })).toEqual([]);
    const signal = { aborted: true };
    await expect(enhanceChannels([voiceLike(48000, 0.2)], 48000, { infer: counting().infer, signal })).rejects.toBeInstanceOf(EnhanceCancelledError);
  });
});

describe("enhance worker handler", () => {
  const run = async (handler: ReturnType<typeof createEnhanceHandler>, request: Parameters<ReturnType<typeof createEnhanceHandler>["handle"]>[0]) => {
    const responses: EnhanceResponse[] = [];
    await handler.handle(request, (r) => responses.push(r));
    return responses;
  };
  const model = { baseUrl: "http://example.invalid/" };

  it("reports progress then the enhanced channels, and builds the network once per model source", async () => {
    let created = 0;
    const handler = createEnhanceHandler(async () => {
      created += 1;
      return counting().infer;
    });
    const x = voiceLike(48000, 0.4);
    const first = await run(handler, { id: 1, kind: "enhance", channels: [x], sampleRate: 48000, model });
    await run(handler, { id: 2, kind: "enhance", channels: [x], sampleRate: 48000, model });
    expect(created).toBe(1);
    expect(first.filter((r) => r.kind === "progress").length).toBeGreaterThan(0);
    const done = first[first.length - 1];
    expect(done.kind).toBe("done");
    if (done.kind === "done") expect(done.channels[0]).toHaveLength(x.length);
  });

  it("lists each distinct buffer once when transferring a response (dual-mono channels share one array)", async () => {
    const handler = createEnhanceHandler(async () => counting().infer);
    const x = voiceLike(48000, 0.2);
    const responses = await run(handler, { id: 1, kind: "enhance", channels: [x, x.slice()], sampleRate: 48000, model });
    const done = responses[responses.length - 1];
    if (done.kind !== "done") throw new Error("expected a result");
    expect(done.channels[0]).toBe(done.channels[1]);
    expect(transferListOf(done)).toEqual([done.channels[0].buffer]);
    const distinct = await run(handler, { id: 2, kind: "enhance", channels: [x, voiceLike(48000, 0.2, 0.1)], sampleRate: 48000, model });
    const two = distinct[distinct.length - 1];
    if (two.kind !== "done") throw new Error("expected a result");
    expect(transferListOf(two)).toHaveLength(2);
    expect(transferListOf({ id: 3, kind: "progress", fraction: 0.5 })).toEqual([]);
  });

  it("answers a failing model load with an error and lets the next request retry", async () => {
    let attempts = 0;
    const handler = createEnhanceHandler(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("model missing");
      return counting().infer;
    });
    const x = voiceLike(48000, 0.2);
    const failed = await run(handler, { id: 1, kind: "enhance", channels: [x], sampleRate: 48000, model });
    expect(failed[failed.length - 1]).toMatchObject({ kind: "error", message: "model missing" });
    const retried = await run(handler, { id: 2, kind: "enhance", channels: [x], sampleRate: 48000, model });
    expect(retried[retried.length - 1].kind).toBe("done");
  });

  it("cancels a running job between segments", async () => {
    const handler = createEnhanceHandler(async () => counting().infer);
    const x = voiceLike(48000, 20);
    const responses: EnhanceResponse[] = [];
    const job = handler.handle({ id: 9, kind: "enhance", channels: [x], sampleRate: 48000, model }, (r) => responses.push(r));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await handler.handle({ id: 9, kind: "cancel" }, () => undefined);
    await job;
    expect(responses[responses.length - 1]).toMatchObject({ kind: "error", cancelled: true });
  });
});
