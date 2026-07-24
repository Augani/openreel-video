import { describe, expect, it, vi } from "vitest";
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
    expect(
      engine.buildCSSFilter({
        id: "contrast-zero",
        type: "contrast",
        enabled: true,
        params: { value: 0 },
      } satisfies Effect),
    ).toBe("contrast(0)");
  });

  it("preserves explicit zero values for neutral pixel effects", async () => {
    const engine = new VideoEffectsEngine({ width: 3, height: 3, useGPU: false }) as any;
    const original = Array.from({ length: 9 }, () => [255, 255, 255, 255]).flat();
    const { ctx, getPixels } = createMockContext(3, 3, original);

    await engine.applyEffectPixelLevel(
      ctx,
      {
        id: "vignette-zero",
        type: "vignette",
        enabled: true,
        params: { amount: 0, midpoint: 0.5, feather: 0.3 },
      } satisfies Effect,
      3,
      3,
    );

    expect(getPixels()).toEqual(original);
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

  describe("hasPixelLevelEffects (skip-readback decision)", () => {
    const cssOnlyEffects: Effect[] = [
      { id: "b", type: "brightness", enabled: true, params: { value: 20 } },
      { id: "c", type: "contrast", enabled: true, params: { value: 1.2 } },
      { id: "h", type: "hue", enabled: true, params: { rotation: 45 } },
      { id: "bl", type: "blur", enabled: true, params: { radius: 3 } },
      { id: "gray", type: "grayscale", enabled: true, params: { amount: 0.8 } },
      { id: "sepia", type: "sepia", enabled: true, params: { amount: 0.6 } },
      { id: "invert", type: "invert", enabled: true, params: { amount: 1 } },
    ] as unknown as Effect[];

    it("returns false for CSS-filter-only effects so readback is skipped", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      expect(engine.hasPixelLevelEffects(cssOnlyEffects)).toBe(false);
    });

    it("returns false for an empty effect list", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      expect(engine.hasPixelLevelEffects([])).toBe(false);
    });

    it("returns true when at least one pixel-level effect is present", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      const mixed: Effect[] = [
        ...cssOnlyEffects,
        { id: "g", type: "grain", enabled: true, params: { amount: 10 } },
      ] as unknown as Effect[];

      expect(engine.hasPixelLevelEffects(mixed)).toBe(true);
    });

    it("returns true for pixel-only effects", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      const pixelOnly: Effect[] = [
        { id: "v", type: "vignette", enabled: true, params: { amount: 50 } },
        { id: "s", type: "sharpen", enabled: true, params: { amount: 50 } },
      ] as unknown as Effect[];

      expect(engine.hasPixelLevelEffects(pixelOnly)).toBe(true);
    });
  });

  describe("getCssFilterString (native-path filter string)", () => {
    it("joins enabled CSS-filter effects into a single filter string", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      const autoColor: Effect[] = [
        { id: "s", type: "saturation", enabled: true, params: { value: 1.2 } },
        { id: "c", type: "contrast", enabled: true, params: { value: 1.1 } },
        {
          id: "b",
          type: "brightness",
          enabled: true,
          params: { value: 10 },
        },
      ] as unknown as Effect[];

      expect(engine.getCssFilterString(autoColor)).toBe(
        "saturate(1.2) contrast(1.1) brightness(1.1)",
      );
    });

    it("returns null when a pixel-level effect is present", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      const mixed: Effect[] = [
        { id: "b", type: "brightness", enabled: true, params: { value: 20 } },
        { id: "g", type: "grain", enabled: true, params: { amount: 10 } },
      ] as unknown as Effect[];

      expect(engine.getCssFilterString(mixed)).toBeNull();
    });

    it("returns null when no enabled effects are present", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });

      const disabled: Effect[] = [
        { id: "b", type: "brightness", enabled: false, params: { value: 20 } },
      ] as unknown as Effect[];

      expect(engine.getCssFilterString(disabled)).toBeNull();
      expect(engine.getCssFilterString([])).toBeNull();
    });
  });

  describe("applyEffectsToCanvas (by-reference playback path)", () => {
    it("returns null for an empty effect list without touching the canvas", async () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });
      const result = await engine.applyEffectsToCanvas(
        {} as unknown as ImageBitmap,
        [],
      );
      expect(result).toBeNull();
    });

    it("returns null when every effect is disabled", async () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      });
      const disabled: Effect[] = [
        { id: "b", type: "brightness", enabled: false, params: { value: 20 } },
      ];
      const result = await engine.applyEffectsToCanvas(
        {} as unknown as ImageBitmap,
        disabled,
      );
      expect(result).toBeNull();
    });

    it("shares the inner apply helper between the bitmap and canvas variants", () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      }) as unknown as {
        renderEffectsOntoFxCanvas: unknown;
        applyEffectsCPU: unknown;
        applyEffectsToCanvas: unknown;
      };
      expect(typeof engine.renderEffectsOntoFxCanvas).toBe("function");
      expect(typeof engine.applyEffectsCPU).toBe("function");
      expect(typeof engine.applyEffectsToCanvas).toBe("function");
    });

    it("processes CSS, pixel, and shader effects in authored stack order", async () => {
      const engine = new VideoEffectsEngine({
        width: 8,
        height: 8,
        useGPU: false,
      }) as any;
      const calls: string[] = [];
      const canvas = { width: 8, height: 8 };
      const ctx = {
        canvas,
        filter: "none",
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      };
      engine.getFxContext = () => ctx;
      engine.applyCssFilterBatch = (
        _ctx: unknown,
        filters: readonly string[],
      ) => calls.push(`css:${filters.join(" ")}`);
      engine.applyEffectPixelLevel = async (
        _ctx: unknown,
        effect: Effect,
      ) => {
        calls.push(`pixel:${effect.id}`);
      };
      engine.resolveShaderEffect = () => ({});
      engine.applyShaderEffect = () => calls.push("shader:shader-1");

      await engine.renderEffectsOntoFxCanvas(
        { width: 8, height: 8 } as ImageBitmap,
        [
          { id: "brightness-1", type: "brightness", enabled: true, params: { value: 20 } },
          { id: "grain-1", type: "grain", enabled: true, params: { amount: 10 } },
          { id: "contrast-1", type: "contrast", enabled: true, params: { value: 1.2 } },
          {
            id: "shader-1",
            type: "shader",
            enabled: true,
            params: { shaderId: "dither" },
          },
          { id: "blur-1", type: "blur", enabled: true, params: { radius: 4 } },
        ] satisfies Effect[],
      );

      expect(calls).toEqual([
        "css:brightness(1.2)",
        "pixel:grain-1",
        "css:contrast(1.2)",
        "shader:shader-1",
        "css:blur(4px)",
      ]);
    });
  });

  describe("needsResize (canvas-reuse decision)", () => {
    it("reports no resize when dimensions are unchanged", () => {
      const canvas = { width: 1920, height: 1080 } as OffscreenCanvas;
      expect(VideoEffectsEngine.needsResize(canvas, 1920, 1080)).toBe(false);
    });

    it("reports resize when width differs", () => {
      const canvas = { width: 1920, height: 1080 } as OffscreenCanvas;
      expect(VideoEffectsEngine.needsResize(canvas, 1280, 1080)).toBe(true);
    });

    it("reports resize when height differs", () => {
      const canvas = { width: 1920, height: 1080 } as OffscreenCanvas;
      expect(VideoEffectsEngine.needsResize(canvas, 1920, 720)).toBe(true);
    });
  });
});
