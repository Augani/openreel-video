import { describe, expect, it } from "vitest";
import { VideoEffectsEngine } from "./video-effects-engine";

interface VignetteAccess {
  applyVignette(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    amount: number,
    midpoint: number,
    feather: number,
    roundness?: number,
  ): void;
}

const W = 64;
const H = 36;

function run(roundness: number | undefined): Uint8ClampedArray {
  const engine = new VideoEffectsEngine({ width: W, height: H, useGPU: false, preferWebGPU: false });
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  (engine as unknown as VignetteAccess).applyVignette(data, W, H, 100, 0.5, 0.2, roundness);
  return data;
}

const luma = (d: Uint8ClampedArray, x: number, y: number): number => d[(y * W + x) * 4];

describe("vignette roundness", () => {
  it("0.5 is the original frame-following oval", () => {
    expect(Array.from(run(0.5))).toEqual(Array.from(run(undefined)));
  });
  it("1 makes the falloff circular and 0 squares it off", () => {
    const circle = run(1);
    const oval = run(0.5);
    const box = run(0);
    // Left-edge midpoint sits at a wider radius on a wide frame than the top edge once circular.
    expect(luma(circle, 0, H / 2)).toBeLessThan(luma(circle, W / 2, 0) + 1);
    expect(luma(circle, W / 2, 1)).toBeGreaterThan(luma(oval, W / 2, 1));
    // A boxy vignette darkens the edge midpoints more than a corner-heavy circle does.
    expect(luma(box, W / 2, 1)).toBeLessThan(luma(oval, W / 2, 1));
    expect(Array.from(box)).not.toEqual(Array.from(oval));
  });
});
