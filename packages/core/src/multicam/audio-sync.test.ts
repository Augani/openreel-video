import { describe, expect, it } from "vitest";
import { findAudioOffset } from "./audio-sync";

function noise(length: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff - 0.5) * 0.2;
  }
  return out;
}

/** A click train plus room noise; the click times are in seconds on the media's own clock. */
function clips(rate: number, seconds: number, clicks: number[], seed: number): Float32Array {
  const out = noise(Math.floor(seconds * rate), seed);
  clicks.forEach((at, index) => {
    const start = Math.round(at * rate);
    let x = (index * 2654435761 + 12345) >>> 0;
    for (let i = 0; i < 600 && start + i < out.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out[start + i] += (x / 0xffffffff - 0.5) * 3 * Math.exp(-i / 120);
    }
  });
  return out;
}

describe("findAudioOffset", () => {
  const rate = 48000;
  it("recovers a known offset within one frame at 25 fps, either direction", () => {
    for (const lead of [0.8, -1.37, 2.04, -0.05]) {
      // Shared event clock: the clicks happen at 1.0, 3.3, 7.9 s on the reference.
      const events = [1.0, 3.3, 7.9];
      const reference = clips(rate, 10, events, 1);
      // The target started `lead` seconds after the reference: a sound at reference time a is at a - lead in the target.
      const target = clips(rate, 10, events.map((e) => e - lead), 2);
      const result = findAudioOffset(reference, rate, target, rate);
      expect(Math.abs(result.offsetSeconds - lead)).toBeLessThan(1 / 25);
      expect(result.confidence).toBeGreaterThan(0.3);
    }
  });

  it("works across different sample rates", () => {
    const events = [0.7, 2.2, 5.5];
    const reference = clips(48000, 8, events, 3);
    const target = clips(44100, 8, events.map((e) => e - 0.5), 4);
    const result = findAudioOffset(reference, 48000, target, 44100);
    expect(Math.abs(result.offsetSeconds - 0.5)).toBeLessThan(0.01);
  });

  it("returns zero confidence for unrelated noise", () => {
    const a = noise(48000 * 4, 10);
    const b = noise(48000 * 4, 11);
    expect(findAudioOffset(a, 48000, b, 48000).confidence).toBeLessThan(0.5);
  });
});
