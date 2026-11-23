import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio-engine";
import type { AudioClipRenderInfo } from "./types";
import type { MediaItem } from "../types";
import { applySpectralRegions } from "./spectral/spectral-dsp";
import { createSpectralRepairEffect, sanitizeSpectralRegions, type SpectralRegion } from "./spectral/spectral-regions";
import { computeMagicWand } from "./spectral/spectral-wand";
import { trackHarmonics } from "./spectral/spectral-harmonic";
import { createEnhanceSpeechEffect } from "./enhance/enhance-effect";
import { setEnhanceBackend } from "./enhance/enhance-worker-client";
import { createReduceReverbEffect } from "./reverb/reverb-effect";
import { createInlineReverbBackend, setReverbBackend } from "./reverb/reverb-worker-client";
import { reduceReverbChannels } from "./reverb/reverb-engine";
import { fftConvolve } from "./reverb/reverb-metrics";
import { resample } from "./enhance/resample";
import { readPcm16Wav, roomImpulseResponse } from "./enhance/enhance-test-signals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createNativePluginEffect } from "./native-plugin/native-plugin-effect";
import { setNativePluginBackend } from "./native-plugin/native-plugin-cache";

const SR = 8000;

interface ParamEvent { kind: "set" | "ramp"; value: number; time: number }
class Param {
  value = 0;
  events: ParamEvent[] = [];
  cancelScheduledValues = vi.fn();
  setValueAtTime(value: number, time: number) { this.events.push({ kind: "set", value, time }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ kind: "ramp", value, time }); }
  at(t: number): number {
    let prev = { value: this.value, time: 0 };
    for (const e of this.events) {
      if (e.kind === "set") {
        if (e.time > t) return prev.value;
        prev = { value: e.value, time: e.time };
      } else {
        if (e.time >= t) {
          const span = e.time - prev.time;
          return span <= 0 ? e.value : prev.value + ((e.value - prev.value) * (t - prev.time)) / span;
        }
        prev = { value: e.value, time: e.time };
      }
    }
    return prev.value;
  }
}
abstract class Node {
  outputs: Node[] = [];
  connect(next: Node) { this.outputs.push(next); return next; }
}
class GainN extends Node { gain = new Param(); constructor() { super(); this.gain.value = 1; } }
class PanN extends Node { pan = new Param(); }
class DestN extends Node {}
class SourceN extends Node {
  buffer: AudioBuffer | null = null;
  playbackRate = new Param();
  startArgs: number[] = [];
  stopAt: number | undefined;
  constructor() { super(); this.playbackRate.value = 1; }
  start(when = 0, offset = 0, duration?: number) { this.startArgs = [when, offset, duration ?? -1]; }
  stop(when: number) { this.stopAt = when; }
}

const makeBuffer = (channels: number, length: number, fill: (i: number) => number): AudioBuffer => {
  const data = Array.from({ length: channels }, () => Float32Array.from({ length }, (_, i) => fill(i)));
  return {
    duration: length / SR, length, sampleRate: SR, numberOfChannels: channels,
    getChannelData: (c: number) => data[c],
  } as unknown as AudioBuffer;
};

/** Minimal offline renderer: source -> gains -> stereo panner -> destination, equal-power pan law. */
class RealisticOffline {
  destination = new DestN();
  sources: SourceN[] = [];
  constructor(public channels: number, public length: number, public sampleRate: number) {}
  createGain() { return new GainN(); }
  createStereoPanner() { return new PanN(); }
  createBufferSource() { const s = new SourceN(); this.sources.push(s); return s; }
  render(): Float32Array[] {
    const out = [new Float32Array(this.length), new Float32Array(this.length)];
    for (const src of this.sources) {
      const chain: Node[] = [];
      let node: Node | undefined = src.outputs[0];
      while (node && !(node instanceof DestN)) { chain.push(node); node = node.outputs[0]; }
      const [when, offset, duration] = src.startArgs;
      const rate = src.playbackRate.value;
      const buf = src.buffer!;
      const data = buf.getChannelData(0);
      const frames = duration >= 0 ? Math.round((duration / rate) * this.sampleRate) : Math.round(((buf.duration - offset) / rate) * this.sampleRate);
      for (let i = 0; i < frames; i++) {
        const t = when + i / this.sampleRate;
        const idx = Math.floor((offset + (i / this.sampleRate) * rate) * buf.sampleRate);
        const o = Math.round(t * this.sampleRate);
        if (o >= this.length || idx >= data.length) break;
        let v = data[idx];
        let pan = 0;
        for (const n of chain) {
          if (n instanceof GainN) v *= n.gain.at(t);
          if (n instanceof PanN) pan = n.pan.at(t);
        }
        const angle = ((pan + 1) * Math.PI) / 4;
        out[0][o] += v * Math.cos(angle);
        out[1][o] += v * Math.sin(angle);
      }
    }
    return out;
  }
}

const info = (over: Partial<AudioClipRenderInfo> = {}): AudioClipRenderInfo => ({
  clipId: "c", mediaId: "m", sourceTime: 0, clipOffset: 0, timelineStartTime: 0, duration: 4,
  clipDuration: 4, volume: 1, volumeAutomation: [], pan: 0, effects: [], speed: 1, ...over,
});

const energy = (data: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) sum += data[i] * data[i];
  return sum;
};

const engineFor = (decoded: AudioBuffer | null, segmentBuffers: AudioBuffer[] = []) => {
  const instance = new AudioEngine();
  Object.assign(instance, {
    initialized: true,
    audioContext: { createBuffer: (c: number, l: number) => makeBuffer(c, l, () => 0) },
    getAudioBuffer: vi.fn(async () => decoded),
    getSegmentedAudioDecoder: vi.fn(async () => ({
      async *buffers() {
        let t = 0;
        for (const b of segmentBuffers) { yield { buffer: b, timestamp: t, duration: b.duration }; t += b.duration; }
      },
    })),
  });
  return instance as unknown as {
    renderBufferToContext(c: unknown, b: AudioBuffer, i: AudioClipRenderInfo, r: number): Promise<void>;
    renderClipToContext(c: unknown, m: MediaItem, i: AudioClipRenderInfo, r: number, prefer: boolean): Promise<void>;
  };
};

const sweep = [{ time: 0, value: -1 }, { time: 4, value: 1 }];

describe("export render with a realistic offline graph", () => {
  it("L/R energy follows a pan sweep through renderBufferToContext", async () => {
    const ctx = new RealisticOffline(2, 4 * SR, SR);
    const engine = engineFor(null);
    await engine.renderBufferToContext(ctx, makeBuffer(1, 4 * SR, () => 0.5), info({ panAutomation: sweep }), 0);
    const [l, r] = ctx.render();
    expect(energy(l, 0, 1)).toBeGreaterThan(energy(r, 0, 1) * 4);
    expect(energy(r, 3, 4)).toBeGreaterThan(energy(l, 3, 4) * 4);
    const mid = [energy(l, 1.9, 2.1), energy(r, 1.9, 2.1)];
    expect(Math.abs(mid[0] - mid[1]) / (mid[0] + mid[1])).toBeLessThan(0.1);
  });

  it("stretches a 440 Hz sine at 2x to half length with pitch preserved", async () => {
    const ctx = new RealisticOffline(2, 4 * SR, SR);
    const sine = makeBuffer(1, 4 * SR, (i) => Math.sin((2 * Math.PI * 440 * i) / SR));
    const engine = engineFor(null);
    await engine.renderBufferToContext(ctx, sine, info({ speed: 2, duration: 2 }), 0);
    const src = ctx.sources[0];
    expect(src.playbackRate.value).toBe(1);
    expect(src.buffer!.duration).toBeCloseTo(2, 2);
    const data = src.buffer!.getChannelData(0);
    let crossings = 0;
    for (let i = SR / 2 + 1; i < 1.5 * SR; i++) if (data[i - 1] < 0 && data[i] >= 0) crossings++;
    expect(crossings).toBeGreaterThan(436);
    expect(crossings).toBeLessThan(444);
  });

  it("applies the pan lane on the long-media segmented 1x fast path, once per clip", async () => {
    const ctx = new RealisticOffline(2, 4 * SR, SR);
    const half = makeBuffer(1, 2 * SR, () => 0.5);
    const engine = engineFor(null, [half, half]);
    const media = { id: "m", metadata: { duration: 4 } } as unknown as MediaItem;
    await engine.renderClipToContext(ctx, media, info({ panAutomation: sweep }), 0, true);
    expect(ctx.sources).toHaveLength(2);
    const [l, r] = ctx.render();
    expect(energy(l, 0, 1)).toBeGreaterThan(energy(r, 0, 1) * 4);
    expect(energy(r, 3, 4)).toBeGreaterThan(energy(l, 3, 4) * 4);
  });

  describe("spectral repair", () => {
    const region: SpectralRegion = { id: "r", mode: "remove", startTime: 0, endTime: 4, lowHz: 400, highHz: 600, gainDb: -120, enabled: true };
    const two = () => makeBuffer(1, 4 * SR, (i) => 0.3 * Math.sin((2 * Math.PI * 500 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 1500 * i) / SR));
    const amp = (x: Float32Array, f: number) => {
      let re = 0, im = 0;
      for (let i = SR; i < 3 * SR; i++) { re += x[i] * Math.cos((2 * Math.PI * f * i) / SR); im -= x[i] * Math.sin((2 * Math.PI * f * i) / SR); }
      return (2 * Math.hypot(re, im)) / (2 * SR);
    };

    it("renders the repaired source: the same samples the DSP produces, tone gone, the other tone kept", async () => {
      const ctx = new RealisticOffline(2, 4 * SR, SR);
      const engine = engineFor(null);
      const source = two();
      await engine.renderBufferToContext(ctx, source, info({ effects: [createSpectralRepairEffect("sr", [region])] }), 0);
      expect(ctx.sources).toHaveLength(1);
      const played = ctx.sources[0].buffer!.getChannelData(0);
      expect(Array.from(played)).toEqual(Array.from(applySpectralRegions([source.getChannelData(0)], SR, [region])[0]));
      expect(amp(played, 500)).toBeLessThan(amp(source.getChannelData(0), 500) * 0.04);
      expect(Math.abs(amp(played, 1500) / amp(source.getChannelData(0), 1500) - 1)).toBeLessThan(0.005);
    });

    it("renders lasso / brush / heal regions with exactly the samples the DSP (and so the preview) produces", async () => {
      const regions: SpectralRegion[] = sanitizeSpectralRegions([
        { id: "l", mode: "heal", shape: "lasso", points: [{ t: 1, hz: 300 }, { t: 3, hz: 300 }, { t: 3, hz: 700 }, { t: 1, hz: 700 }] },
        { id: "b", mode: "remove", shape: "brush", brushSeconds: 0.2, brushOctaves: 0.2, points: [{ t: 0.5, hz: 1500 }, { t: 3.5, hz: 1500 }] },
        { id: "r", mode: "heal", startTime: 2, endTime: 3, lowHz: 100, highHz: 200, gainDb: -120, enabled: true },
      ]);
      const ctx = new RealisticOffline(2, 4 * SR, SR);
      const engine = engineFor(null);
      const source = two();
      await engine.renderBufferToContext(ctx, source, info({ effects: [createSpectralRepairEffect("sr", regions)] }), 0);
      const played = ctx.sources[0].buffer!.getChannelData(0);
      const direct = applySpectralRegions([source.getChannelData(0)], SR, regions)[0];
      expect(Array.from(played)).toEqual(Array.from(direct));
      expect(amp(played, 500)).toBeLessThan(amp(source.getChannelData(0), 500) * 0.2);
      expect(amp(played, 1500)).toBeLessThan(amp(source.getChannelData(0), 1500) * 0.1);
    });

    it("renders wand, harmonic and per-channel regions with exactly the samples the DSP (and so the preview) produces", async () => {
      const source = makeBuffer(2, 4 * SR, (i) => 0.3 * Math.sin((2 * Math.PI * 500 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 1500 * i) / SR));
      const left = source.getChannelData(0);
      const wand = computeMagicWand(left, SR, { t: 2, hz: 500 }, { toleranceDb: 6 });
      const track = trackHarmonics(left, SR, { t: 2, hz: 500 }, { harmonics: 3 });
      if (!wand.ok || !track.ok) throw new Error("analysis failed");
      const regions: SpectralRegion[] = sanitizeSpectralRegions([
        { id: "w", mode: "remove", shape: "wand", wand: wand.wand, channel: "left" },
        { id: "h", mode: "attenuate", gainDb: -30, shape: "harmonic", points: track.points, harmonic: { harmonics: 3, maxHz: 20000, bandCents: 50 }, channel: "right" },
      ]);
      const ctx = new RealisticOffline(2, 4 * SR, SR);
      await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [createSpectralRepairEffect("sr", regions)] }), 0);
      const played = ctx.sources[0].buffer!;
      const direct = applySpectralRegions([left, source.getChannelData(1)], SR, regions);
      expect(Array.from(played.getChannelData(0))).toEqual(Array.from(direct[0]));
      expect(Array.from(played.getChannelData(1))).toEqual(Array.from(direct[1]));
      expect(amp(played.getChannelData(0), 500)).toBeLessThan(amp(left, 500) * 0.2);
      expect(amp(played.getChannelData(1), 500)).toBeLessThan(amp(left, 500) * 0.1);
      // The left edit did not touch the right channel's 500 Hz beyond the harmonic attenuation, and the harmonic edit did not touch the left's 1500 Hz.
      expect(Math.abs(amp(played.getChannelData(0), 1500) / amp(left, 1500) - 1)).toBeLessThan(0.02);
    });

    it("leaves a clip with a disabled or empty spectral effect on the original source", async () => {
      const ctx = new RealisticOffline(2, 4 * SR, SR);
      const engine = engineFor(null);
      const source = two();
      await engine.renderBufferToContext(ctx, source, info({ effects: [createSpectralRepairEffect("a", []), { ...createSpectralRepairEffect("b", [region]), enabled: false }] }), 0);
      expect(ctx.sources[0].buffer).toBe(source);
    });

    it("decodes the whole source instead of streaming segments, so the repair sees the same audio as the preview", async () => {
      const ctx = new RealisticOffline(2, 4 * SR, SR);
      const decoded = two();
      const engine = engineFor(decoded, [makeBuffer(1, 2 * SR, () => 0.5), makeBuffer(1, 2 * SR, () => 0.5)]);
      const media = { id: "m", metadata: { duration: 4 } } as unknown as MediaItem;
      await engine.renderClipToContext(ctx, media, info({ effects: [createSpectralRepairEffect("sr", [region])] }), 0, true);
      expect(ctx.sources).toHaveLength(1);
      expect(amp(ctx.sources[0].buffer!.getChannelData(0), 500)).toBeLessThan(amp(decoded.getChannelData(0), 500) * 0.04);
    });
  });

  describe("enhance speech", () => {
    const voice = (seed: number) => makeBuffer(1, 4 * SR, (i) => 0.3 * Math.sin((2 * Math.PI * (200 + seed) * i) / SR));

    it("renders the enhanced source (the cached job the preview shares), blended by Mix", async () => {
      const calls: number[] = [];
      setEnhanceBackend({ enhance: async (channels) => { calls.push(channels.length); return channels.map((c) => c.map((v) => v * 0.2)); } });
      try {
        const source = voice(1);
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [createEnhanceSpeechEffect("es", 100)] }), 0);
        const played = ctx.sources[0].buffer!.getChannelData(0);
        expect(played[1000]).toBeCloseTo(source.getChannelData(0)[1000] * 0.2, 6);
        const ctx2 = new RealisticOffline(2, 4 * SR, SR);
        await engineFor(null).renderBufferToContext(ctx2, source, info({ effects: [createEnhanceSpeechEffect("es", 50)] }), 0);
        expect(ctx2.sources[0].buffer!.getChannelData(0)[1000]).toBeCloseTo(source.getChannelData(0)[1000] * 0.6, 6);
        expect(calls).toHaveLength(1);
      } finally {
        setEnhanceBackend(null);
      }
    });

    it("leaves Mix 0 and disabled effects on the original source", async () => {
      const enhance = vi.fn(async (channels: Float32Array[]) => channels);
      setEnhanceBackend({ enhance });
      try {
        const source = voice(2);
        for (const effect of [createEnhanceSpeechEffect("a", 0), { ...createEnhanceSpeechEffect("b", 100), enabled: false }]) {
          const ctx = new RealisticOffline(2, 4 * SR, SR);
          await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [effect] }), 0);
          expect(ctx.sources[0].buffer).toBe(source);
        }
        expect(enhance).not.toHaveBeenCalled();
      } finally {
        setEnhanceBackend(null);
      }
    });

    it("fails the render with the reason rather than silently exporting un-enhanced audio", async () => {
      setEnhanceBackend({ enhance: async () => { throw new Error("model files missing"); } });
      try {
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        await expect(engineFor(null).renderBufferToContext(ctx, voice(3), info({ effects: [createEnhanceSpeechEffect("es", 100)] }), 0)).rejects.toThrow(/Enhance Speech could not run: model files missing/);
      } finally {
        setEnhanceBackend(null);
      }
    });

    it("decodes the whole source instead of streaming segments", async () => {
      setEnhanceBackend({ enhance: async (channels) => channels.map((c) => c.map((v) => v * 0.1)) });
      try {
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        const decoded = voice(4);
        const engine = engineFor(decoded, [makeBuffer(1, 2 * SR, () => 0.5), makeBuffer(1, 2 * SR, () => 0.5)]);
        const media = { id: "m", metadata: { duration: 4 } } as unknown as MediaItem;
        await engine.renderClipToContext(ctx, media, info({ effects: [createEnhanceSpeechEffect("es", 100)] }), 0, true);
        expect(ctx.sources).toHaveLength(1);
        expect(ctx.sources[0].buffer!.getChannelData(0)[500]).toBeCloseTo(decoded.getChannelData(0)[500] * 0.1, 6);
      } finally {
        setEnhanceBackend(null);
      }
    });
  });

  describe("enhance speech balance", () => {
    const voice = (seed: number) => makeBuffer(1, 4 * SR, (i) => 0.3 * Math.sin((2 * Math.PI * (200 + seed) * i) / SR));

    it("renders the remixed stems from the one cached enhancement, and the default balance exactly as before", async () => {
      const calls: number[] = [];
      setEnhanceBackend({ enhance: async (channels) => { calls.push(channels.length); return channels.map((c) => c.map((v) => v * 0.2)); } });
      try {
        const source = voice(11);
        const render = async (effect: ReturnType<typeof createEnhanceSpeechEffect>) => {
          const ctx = new RealisticOffline(2, 4 * SR, SR);
          await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [effect] }), 0);
          return ctx.sources[0].buffer!.getChannelData(0);
        };
        const dry = source.getChannelData(0)[1000];
        expect((await render(createEnhanceSpeechEffect("a", 100)))[1000]).toBeCloseTo(dry * 0.2, 6);
        expect((await render(createEnhanceSpeechEffect("b", 100, 100)))[1000]).toBeCloseTo(dry * 0.2, 6);
        expect((await render(createEnhanceSpeechEffect("c", 100, 0)))[1000]).toBeCloseTo(dry * 0.8, 6);
        expect((await render(createEnhanceSpeechEffect("d", 100, 50)))[1000]).toBeCloseTo(dry, 6);
        expect(calls).toHaveLength(1);
      } finally {
        setEnhanceBackend(null);
      }
    });
  });

  describe("reduce reverb", () => {
    const wav = readPcm16Wav(readFileSync(fileURLToPath(new URL("./enhance/fixtures/speech-16k.wav", import.meta.url))));
    const roomy = (): AudioBuffer => {
      const dry = resample(wav.samples.subarray(0, wav.sampleRate * 4), wav.sampleRate, SR);
      const wet = fftConvolve(dry, roomImpulseResponse(SR, 0.6, 0));
      return makeBuffer(1, wet.length, (i) => wet[i]);
    };

    it("renders the cached job's samples (the very ones the preview plays), bit for bit", async () => {
      setReverbBackend(createInlineReverbBackend());
      try {
        const source = roomy();
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [createReduceReverbEffect("rr", 70, 40)] }), 0);
        const played = ctx.sources[0].buffer!.getChannelData(0);
        const reference = (await reduceReverbChannels([source.getChannelData(0)], SR, { amount: 70, sensitivity: 40 })).channels[0];
        expect(played).toHaveLength(reference.length);
        expect(Buffer.from(played.buffer, played.byteOffset, played.byteLength).equals(Buffer.from(reference.buffer, reference.byteOffset, reference.byteLength))).toBe(true);
        expect(played).not.toEqual(source.getChannelData(0));
      } finally {
        setReverbBackend(null);
      }
    }, 60_000);

    it("leaves Amount 0 and disabled effects on the original source", async () => {
      const reduce = vi.fn(async () => ({ channels: [] as Float32Array[], rt60: 0, confidence: 0 }));
      setReverbBackend({ reduce });
      try {
        const source = roomy();
        for (const effect of [createReduceReverbEffect("a", 0), { ...createReduceReverbEffect("b", 60), enabled: false }]) {
          const ctx = new RealisticOffline(2, 4 * SR, SR);
          await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [effect] }), 0);
          expect(ctx.sources[0].buffer).toBe(source);
        }
        expect(reduce).not.toHaveBeenCalled();
      } finally {
        setReverbBackend(null);
      }
    });

    it("fails the render with the reason rather than silently exporting the reverberant audio", async () => {
      setReverbBackend({ reduce: async () => { throw new Error("worker missing"); } });
      try {
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        await expect(engineFor(null).renderBufferToContext(ctx, roomy(), info({ effects: [createReduceReverbEffect("rr", 60)] }), 0)).rejects.toThrow(/Reduce Reverb could not run: worker missing/);
      } finally {
        setReverbBackend(null);
      }
    });

    it("runs before Enhance Speech (which then enhances its output) on the whole source, and decodes the whole source instead of streaming segments", async () => {
      const seen: number[] = [];
      setEnhanceBackend({ enhance: async (channels) => { seen.push(channels[0][2000]); return channels.map((c) => c.map((v) => v * 0.5)); } });
      setReverbBackend({ reduce: async (channels) => ({ channels: channels.map((c) => c.map((v) => v * 0.1)), rt60: 0.5, confidence: 1 }) });
      try {
        const decoded = makeBuffer(1, 4 * SR, (i) => 0.3 * Math.sin((2 * Math.PI * 233 * i) / SR));
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        const engine = engineFor(decoded, [makeBuffer(1, 2 * SR, () => 0.5), makeBuffer(1, 2 * SR, () => 0.5)]);
        const media = { id: "m", metadata: { duration: 4 } } as unknown as MediaItem;
        await engine.renderClipToContext(ctx, media, info({ effects: [createEnhanceSpeechEffect("es", 100), createReduceReverbEffect("rr", 60)] }), 0, true);
        expect(ctx.sources).toHaveLength(1);
        expect(seen[0]).toBeCloseTo(decoded.getChannelData(0)[2000] * 0.1, 6);
        expect(ctx.sources[0].buffer!.getChannelData(0)[2000]).toBeCloseTo(decoded.getChannelData(0)[2000] * 0.05, 6);
      } finally {
        setEnhanceBackend(null);
        setReverbBackend(null);
      }
    });
  });

  describe("hosted native plugins", () => {
    const voice = (seed: number) => makeBuffer(1, 4 * SR, (i) => 0.3 * Math.sin((2 * Math.PI * (300 + seed) * i) / SR));
    const plugin = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple" };

    it("renders the plugin's offline result with its automation (the cached job the preview shares) and differs from bypass", async () => {
      const seen: Array<{ automation: unknown; state: unknown }> = [];
      setNativePluginBackend({ render: async (request) => { seen.push({ automation: request.automation, state: request.state }); return { channels: request.channels.map((c) => c.map((v) => v * 0.2)), latencySamples: 0 }; } });
      try {
        const source = voice(11);
        const effect = { ...createNativePluginEffect("p", plugin, { state: "QUJD" }), params: { ...createNativePluginEffect("p", plugin, { state: "QUJD" }).params, automation: { "0": [[0, 1], [1, 2]] } } };
        const ctx = new RealisticOffline(2, 4 * SR, SR);
        await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [effect] }), 0);
        expect(ctx.sources[0].buffer!.getChannelData(0)[1000]).toBeCloseTo(source.getChannelData(0)[1000] * 0.2, 6);
        expect(seen).toEqual([{ automation: { "0": [[0, 1], [1, 2]] }, state: "QUJD" }]);
        const bypassed = new RealisticOffline(2, 4 * SR, SR);
        await engineFor(null).renderBufferToContext(bypassed, source, info({ effects: [{ ...effect, enabled: false }] }), 0);
        expect(bypassed.sources[0].buffer).toBe(source);
      } finally {
        setNativePluginBackend(undefined);
      }
    });

    it("bypasses a plugin the host cannot run, but fails the export when a plugin breaks while rendering", async () => {
      const source = voice(12);
      setNativePluginBackend(undefined);
      const ctx = new RealisticOffline(2, 4 * SR, SR);
      await engineFor(null).renderBufferToContext(ctx, source, info({ effects: [createNativePluginEffect("p", plugin)] }), 0);
      expect(ctx.sources[0].buffer).toBe(source);
      setNativePluginBackend({ render: async () => { throw new Error("helper crashed"); } });
      try {
        await expect(engineFor(null).renderBufferToContext(new RealisticOffline(2, 4 * SR, SR), voice(13), info({ effects: [createNativePluginEffect("p", plugin)] }), 0)).rejects.toThrow(/hosted audio plugin could not run: helper crashed/);
      } finally {
        setNativePluginBackend(undefined);
      }
    });
  });
});
