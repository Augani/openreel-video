import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import { VideoEffectsEngine } from "./video-effects-engine";

const createMockContext = (
  width: number,
  height: number,
  pixels: number[],
) => {
  let imageData = new Uint8ClampedArray(pixels);

  return {
    ctx: {
      getImageData: () => ({
        data: new Uint8ClampedArray(imageData),
        width,
        height,
      }),
      putImageData: (next: { data: Uint8ClampedArray }) => {
        imageData = new Uint8ClampedArray(next.data);
      },
    },
    getPixels: () => Array.from(imageData),
  };
};

describe("VideoEffectsEngine", () => {
  it("supports the advanced editor filters in the shared engine", () => {
    const engine = new VideoEffectsEngine({ width: 8, height: 8, useGPU: false }) as any;

    expect(engine.isFilterSupported("shadow")).toBe(true);
    expect(engine.isFilterSupported("glow")).toBe(true);
    expect(engine.isFilterSupported("motion-blur")).toBe(true);
    expect(engine.isFilterSupported("radial-blur")).toBe(true);
    expect(engine.isFilterSupported("chromatic-aberration")).toBe(true);
    expect(
      engine.buildCSSFilter({
        id: "shadow-1",
        type: "shadow",
        enabled: true,
        params: {
          offsetX: 4,
          offsetY: 6,
          blur: 10,
          opacity: 0.5,
          color: "#112233",
        },
      } satisfies Effect),
    ).toContain("drop-shadow(4px 6px 10px rgba(17, 34, 51, 0.5))");
    expect(
      engine.buildCSSFilter({
        id: "glow-1",
        type: "glow",
        enabled: true,
        params: {
          radius: 12,
          intensity: 1.4,
          color: "#ffffff",
        },
      } satisfies Effect),
    ).toContain("drop-shadow");
  });

  it("applies motion blur at pixel level", async () => {
    const engine = new VideoEffectsEngine({ width: 5, height: 1, useGPU: false }) as any;
    const { ctx, getPixels } = createMockContext(5, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    await engine.applyEffectPixelLevel(
      ctx,
      {
        id: "motion-blur-1",
        type: "motion-blur",
        enabled: true,
        params: { distance: 4, angle: 0 },
      } satisfies Effect,
      5,
      1,
    );

    const pixels = getPixels();
    expect(pixels[0]).toBeGreaterThan(0);
    expect(pixels[8]).toBeLessThan(255);
  });

  it("applies radial blur at pixel level", async () => {
    const engine = new VideoEffectsEngine({ width: 5, height: 1, useGPU: false }) as any;
    const { ctx, getPixels } = createMockContext(5, 1, [
      255, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    await engine.applyEffectPixelLevel(
      ctx,
      {
        id: "radial-blur-1",
        type: "radial-blur",
        enabled: true,
        params: { amount: 80, centerX: 50, centerY: 50 },
      } satisfies Effect,
      5,
      1,
    );

    const pixels = getPixels();
    expect(pixels[0]).toBeLessThan(255);
    expect(pixels[4]).toBeGreaterThan(0);
  });

  it("applies chromatic aberration at pixel level", async () => {
    const engine = new VideoEffectsEngine({ width: 3, height: 1, useGPU: false }) as any;
    const { ctx, getPixels } = createMockContext(3, 1, [
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
    ]);

    await engine.applyEffectPixelLevel(
      ctx,
      {
        id: "chromatic-1",
        type: "chromatic-aberration",
        enabled: true,
        params: { amount: 2 },
      } satisfies Effect,
      3,
      1,
    );

    const pixels = getPixels();
    expect(pixels[4]).toBe(70);
    expect(pixels[6]).toBe(30);
  });
});