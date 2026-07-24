import { describe, expect, it } from "vitest";
import {
  applyMotionDirectionalBlur,
  applyMotionChromaticAberration,
  applyMotionDisplace,
  applyMotionLevels,
  applyMotionNoise,
  applyMotionMosaic,
  applyMotionPosterize,
  applyMotionRadialBlur,
  applyMotionSharpen,
  applyMotionThreshold,
  applyMotionVignette,
  buildMotionLevelsLut,
  type MotionPixelBuffer,
} from "./motion-pixel-effects";

function solidBuffer(
  width: number,
  height: number,
  value: number,
): MotionPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

describe("motion pixel effects", () => {
  it("builds a levels LUT that maps the input range to the output range", () => {
    const lut = buildMotionLevelsLut({
      inputBlack: 50,
      inputWhite: 200,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    });
    expect(lut[50]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[125]).toBeGreaterThan(120);
    expect(lut[125]).toBeLessThan(135);
  });

  it("applies levels to pixel data in place", () => {
    const buffer = solidBuffer(2, 2, 125);
    applyMotionLevels(buffer, {
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 128,
    });
    expect(buffer.data[0]).toBeCloseTo(63, -1);
    expect(buffer.data[3]).toBe(255);
  });

  it("quantizes colors with posterize", () => {
    const buffer = solidBuffer(1, 1, 100);
    applyMotionPosterize(buffer, 2);
    expect([0, 255]).toContain(buffer.data[0]);
  });

  it("adds deterministic noise for a seed", () => {
    const a = solidBuffer(4, 4, 128);
    const b = solidBuffer(4, 4, 128);
    applyMotionNoise(a, 0.5, 7);
    applyMotionNoise(b, 0.5, 7);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(a.data[0]).not.toBe(128);
  });

  it("sharpen and directional blur preserve buffer size and run without error", () => {
    const sharp = solidBuffer(4, 4, 128);
    applyMotionSharpen(sharp, 1);
    expect(sharp.data.length).toBe(4 * 4 * 4);

    const blurred = solidBuffer(8, 1, 128);
    blurred.data[0] = 255;
    applyMotionDirectionalBlur(blurred, 0, 3);
    expect(blurred.data.length).toBe(8 * 1 * 4);
    expect(blurred.data[0]).toBeLessThan(255);
  });

  it("radial blur and turbulent displace preserve buffer size", () => {
    const radial = solidBuffer(8, 8, 100);
    radial.data[(4 * 8 + 4) * 4] = 255;
    applyMotionRadialBlur(radial, 0.5, 0.5, 0.8);
    expect(radial.data.length).toBe(8 * 8 * 4);

    const displaced = solidBuffer(8, 8, 100);
    applyMotionDisplace(displaced, 4, 20, 3);
    expect(displaced.data.length).toBe(8 * 8 * 4);
    expect(displaced.data[3]).toBe(255);
  });

  it("applies threshold and mosaic as deterministic graphic treatments", () => {
    const threshold = solidBuffer(2, 1, 80);
    threshold.data[4] = 200;
    threshold.data[5] = 200;
    threshold.data[6] = 200;
    applyMotionThreshold(threshold, 128);
    expect(Array.from(threshold.data.slice(0, 8))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);

    const mosaic = solidBuffer(4, 2, 0);
    const sample = (1 * 4 + 1) * 4;
    mosaic.data[sample] = 220;
    applyMotionMosaic(mosaic, 2);
    expect(mosaic.data[0]).toBe(220);
    expect(mosaic.data[4]).toBe(220);
  });

  it("separates color channels and darkens vignette edges", () => {
    const aberration = solidBuffer(5, 1, 0);
    aberration.data[4 * 4] = 255;
    aberration.data[4 * 4 + 2] = 200;
    applyMotionChromaticAberration(aberration, 1, 0);
    expect(aberration.data[3 * 4]).toBe(255);
    expect(aberration.data[4 * 4 + 2]).toBe(0);

    const vignette = solidBuffer(5, 5, 200);
    applyMotionVignette(vignette, 1, 0.5);
    const center = (2 * 5 + 2) * 4;
    expect(vignette.data[center]).toBe(200);
    expect(vignette.data[0]).toBeLessThan(200);
    expect(vignette.data[3]).toBe(255);
  });
});
