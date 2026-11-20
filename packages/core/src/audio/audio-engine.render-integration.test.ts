import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio-engine";
import type { AudioClipRenderInfo } from "./types";
import type { MediaItem } from "../types";
import { applySpectralRegions } from "./spectral/spectral-dsp";
import { createSpectralRepairEffect, type SpectralRegion } from "./spectral/spectral-regions";

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
});
