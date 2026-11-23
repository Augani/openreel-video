import { describe, expect, it } from "vitest";
import { VideoEffectsEngine } from "./video-effects-engine";

type WhiteBalance = {
  applyTemperature(data: Uint8ClampedArray, temperature: number): void;
  applyTint(data: Uint8ClampedArray, tint: number): void;
};

/** The pre-table per-pixel implementations, kept as the numerical reference. */
function referenceTemperature(data: Uint8ClampedArray, temperature: number): void {
  const t = temperature / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (t > 0) {
      r = Math.min(255, r + t * 51);
      g = Math.min(255, g + t * 25.5);
      b = Math.max(0, b - t * 51);
    } else {
      r = Math.max(0, r + t * 51);
      g = Math.max(0, g + t * 12.75);
      b = Math.min(255, b - t * 51);
    }
    data[i] = Math.round(r);
    data[i + 1] = Math.round(g);
    data[i + 2] = Math.round(b);
  }
}
function referenceTint(data: Uint8ClampedArray, tint: number): void {
  const t = tint / 100;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(Math.max(0, Math.min(255, data[i] + t * 25.5)));
    data[i + 1] = Math.round(Math.max(0, Math.min(255, data[i + 1] - t * 51)));
    data[i + 2] = Math.round(Math.max(0, Math.min(255, data[i + 2] + t * 25.5)));
  }
}

describe("white balance table lookups", () => {
  const engine = new VideoEffectsEngine({ width: 2, height: 1, useGPU: false }) as unknown as WhiteBalance;
  const everyValue = (): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(256 * 3 * 4);
    for (let v = 0; v < 256; v++) {
      for (let c = 0; c < 3; c++) {
        d[(c * 256 + v) * 4 + c] = v;
        d[(c * 256 + v) * 4 + ((c + 1) % 3)] = 255 - v;
        d[(c * 256 + v) * 4 + 3] = 200;
      }
    }
    return d;
  };

  it("temperature is bit-identical to the per-pixel reference for every byte value", () => {
    for (const t of [-100, -37.5, -1, 0, 0.4, 14, 60, 100]) {
      const fast = everyValue();
      const reference = everyValue();
      engine.applyTemperature(fast, t);
      referenceTemperature(reference, t);
      expect(Array.from(fast), `temperature ${t}`).toEqual(Array.from(reference));
    }
  });

  it("tint is bit-identical to the per-pixel reference for every byte value", () => {
    for (const t of [-100, -22, 0, 3.3, 45, 100]) {
      const fast = everyValue();
      const reference = everyValue();
      engine.applyTint(fast, t);
      referenceTint(reference, t);
      expect(Array.from(fast), `tint ${t}`).toEqual(Array.from(reference));
    }
  });
});
