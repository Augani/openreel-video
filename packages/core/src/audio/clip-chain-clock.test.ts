import { describe, expect, it } from "vitest";
import { createCreativeProcessor } from "./creative/creative-fx-dsp";
import {
  hasModulatedCreativeFx,
  offlineClipChainClockOffset,
  previewClipChainClockOffset,
  resampleToTimelineRate,
} from "./clip-chain-clock";

const SR = 48000;
const BLOCK = 128;
type Kind = "chorus" | "flanger" | "phaser";

/** Deterministic noise, so any phase difference shows up in the output. */
function noise(length: number, seed = 7): Float32Array {
  const out = new Float32Array(length);
  let s = seed;
  for (let i = 0; i < length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff) * 2 - 1;
  }
  return out;
}

/** Runs a processor in 128-sample blocks the way the worklet does: context time `ctxStart` at the first block. */
function render(kind: Kind, input: Float32Array, ctxStart: number, offset: number): Float32Array {
  const proc = createCreativeProcessor(kind, SR, { rate: 1.3 });
  const out = new Float32Array(input.length);
  for (let at = 0; at < input.length; at += BLOCK) {
    const n = Math.min(BLOCK, input.length - at);
    proc.setClock(ctxStart + at / SR, offset);
    proc.process([input.subarray(at, at + n)], [out.subarray(at, at + n)], n);
  }
  return out;
}

const maxDiff = (a: Float32Array, b: Float32Array): number => {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

/** Largest difference after shifting `b` by up to `samples` samples: 0 means phases agree within that many samples. */
const withinSamples = (a: Float32Array, b: Float32Array, samples: number): boolean => {
  for (let shift = -samples; shift <= samples; shift += 1) {
    const from = Math.max(0, shift), to = Math.min(a.length, a.length + shift);
    let worst = 0;
    for (let i = from + 2000; i < to - 2000; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i - shift]));
    if (worst < 1e-4) return true;
  }
  return false;
};

interface Scenario {
  name: string;
  speed: number;
  reversed: boolean;
}

const scenarios: Scenario[] = [
  { name: "speed 1", speed: 1, reversed: false },
  { name: "speed 2", speed: 2, reversed: false },
  { name: "speed 1 reversed", speed: 1, reversed: true },
  { name: "speed 2 reversed", speed: 2, reversed: true },
];

describe("clip-level modulated effects are timeline-anchored", () => {
  for (const kind of ["chorus", "flanger", "phaser"] as const) {
    for (const scenario of scenarios) {
      it(`${kind}: preview and offline render agree at a clip start offset (${scenario.name})`, () => {
        const clipStart = 12.37; // timeline second the clip starts at
        const offsetInClip = 0.85; // the render / playback begins this far into the clip
        const sourceExcerpt = noise(SR * scenario.speed * 1.2);
        // Both chains see the signal after speed and reverse: timeline rate, timeline order.
        const ordered = scenario.reversed ? Float32Array.from(sourceExcerpt).reverse() : sourceExcerpt;
        const heard = resampleToTimelineRate([ordered], scenario.speed)[0];
        expect(heard.length).toBeCloseTo(SR * 1.2, -1);

        const timelineStart = clipStart + offsetInClip;
        // Offline: the clip buffer is rendered from context time 0.
        const offline = render(kind, heard, 0, offlineClipChainClockOffset(timelineStart));
        // Preview: the source starts at an unrelated context time (here a block boundary, as the worklet sees it).
        const sourceStartTime = 40 + 31 * BLOCK / SR;
        const offset = previewClipChainClockOffset(clipStart, offsetInClip, sourceStartTime);
        const preview = render(kind, heard, sourceStartTime, offset);
        expect(maxDiff(offline, preview)).toBeLessThan(1e-6);
        expect(withinSamples(offline, preview, 1)).toBe(true);

        // Without timeline anchoring (the old behaviour: offset 0) the two disagree.
        const legacyOffline = render(kind, heard, 0, 0);
        const legacyPreview = render(kind, heard, sourceStartTime, 0);
        expect(maxDiff(legacyOffline, legacyPreview)).toBeGreaterThan(1e-3);
      });
    }
  }

  it("a mid-playback start (clipOffset > 0) lands on the same phase as the clip played from its start", () => {
    const clipStart = 3;
    const heard = noise(SR * 2);
    const full = render("chorus", heard, 10, previewClipChainClockOffset(clipStart, 0, 10));
    const skip = Math.round(0.5 * SR);
    const partial = render("chorus", heard.subarray(skip), 20, previewClipChainClockOffset(clipStart, 0.5, 20));
    // Past the delay line's warm-up the tails coincide.
    const tail = full.subarray(skip + 4000);
    const tailPartial = partial.subarray(4000);
    expect(maxDiff(tail, tailPartial.subarray(0, tail.length))).toBeLessThan(1e-4);
  });

  it("resamples to timeline rate by the speed", () => {
    const ramp = Float32Array.from({ length: 1000 }, (_, i) => i);
    const [out] = resampleToTimelineRate([ramp], 2);
    expect(out.length).toBe(500);
    expect(out[10]).toBeCloseTo(20, 5);
    expect(resampleToTimelineRate([ramp], 1)[0]).toEqual(ramp);
  });

  it("detects enabled modulated effects only", () => {
    expect(hasModulatedCreativeFx([{ type: "chorus", enabled: true }])).toBe(true);
    expect(hasModulatedCreativeFx([{ type: "chorus", enabled: false }])).toBe(false);
    expect(hasModulatedCreativeFx([{ type: "distortion", enabled: true }])).toBe(false);
  });
});
