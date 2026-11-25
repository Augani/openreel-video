import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";

/**
 * The ten blend modes added for Premiere parity have no Canvas2D operation. Real Chrome, real pixels:
 *  1. the WGSL compositor (motion GPU path) matches the CPU reference used by preview and export, per mode;
 *  2. the export engine (VideoEngine.composite) and the editor preview helper (drawImageWithBlend) produce the
 *     same pixels for a new mode, and Dissolve is deterministic across two renders.
 */
const NEW_MODES = [
  "linear-burn",
  "darker-color",
  "lighter-color",
  "linear-light",
  "vivid-light",
  "pin-light",
  "hard-mix",
  "subtract",
  "divide",
  "dissolve",
] as const;

interface Core {
  blendReference: {
    blendPixelBuffers: (b: Uint8ClampedArray, s: Uint8ClampedArray, w: number, h: number, mode: string, alpha?: number) => void;
    drawImageWithBlend: (ctx: OffscreenCanvasRenderingContext2D, image: CanvasImageSource, mode: string) => void;
  };
  motionGpuCompositor: {
    MotionGpuCompositor: new () => {
      initialize(): Promise<boolean>;
      beginComposite(w: number, h: number, bg?: { r: number; g: number; b: number; a: number }): void;
      addLayer(image: ImageBitmap, mode: string, opacity: number): void;
      finish(w: number, h: number): Promise<ImageBitmap>;
      destroy(): void;
    };
  };
}

test("new blend modes: WGSL compositor matches the CPU reference per mode", async ({ page }) => {
  test.setTimeout(120_000);
  await openHookPage(page);
  const rows = await page.evaluate(async (modes) => {
    const { core } = (window as unknown as { __openreelE2E: { core: Core } }).__openreelE2E;
    const { MotionGpuCompositor } = core.motionGpuCompositor;
    if (!MotionGpuCompositor.isSupported()) return { skipped: true as const, rows: [] };
    const W = 128;
    const H = 72;
    const paint = (fill: (g: OffscreenCanvasRenderingContext2D) => void): OffscreenCanvas => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      fill(g);
      return c;
    };
    const backdrop = paint((g) => {
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#ff3b30");
      grad.addColorStop(0.5, "#34c759");
      grad.addColorStop(1, "#0a84ff");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    });
    const source = paint((g) => {
      const grad = g.createLinearGradient(W, 0, 0, H);
      grad.addColorStop(0, "#ffd60a");
      grad.addColorStop(0.5, "#5e5ce6");
      grad.addColorStop(1, "#202020");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    });
    const px = (c: OffscreenCanvas) => c.getContext("2d")!.getImageData(0, 0, W, H).data;
    const gpu = new MotionGpuCompositor();
    if (!(await gpu.initialize())) return { skipped: true as const, rows: [] };
    const out: Array<{ mode: string; mad: number; bigFrac: number }> = [];
    for (const mode of modes) {
      const expected = new Uint8ClampedArray(px(backdrop));
      core.blendReference.blendPixelBuffers(expected, px(source), W, H, mode, 1);
      gpu.beginComposite(W, H, { r: 0, g: 0, b: 0, a: 0 });
      gpu.addLayer(await createImageBitmap(backdrop), "normal", 1);
      gpu.addLayer(await createImageBitmap(source), mode, 1);
      const bmp = await gpu.finish(W, H);
      const got = new OffscreenCanvas(W, H);
      const gctx = got.getContext("2d", { willReadFrequently: true })!;
      gctx.drawImage(bmp, 0, 0);
      const actual = gctx.getImageData(0, 0, W, H).data;
      let sum = 0;
      let big = 0;
      for (let i = 0; i < actual.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(actual[i + k] - expected[i + k]);
          sum += d;
          if (d > 6) big++;
        }
      }
      out.push({ mode, mad: sum / (W * H * 3), bigFrac: big / (W * H * 3) });
    }
    gpu.destroy();
    return { skipped: false as const, rows: out };
  }, [...NEW_MODES]);
  test.skip(rows.skipped, "no WebGPU adapter");
  for (const r of rows.rows) {
    // Hard Mix and Pin Light switch at hard thresholds, so a few edge pixels may land on either side by 8 bit rounding.
    expect(r.mad, `${r.mode} mean abs diff`).toBeLessThan(1.5);
    expect(r.bigFrac, `${r.mode} large-diff fraction`).toBeLessThan(0.02);
  }
});

test("linear burn and dissolve: export engine composite equals the preview helper, deterministically", async ({ page }) => {
  test.setTimeout(120_000);
  await openHookPage(page);
  const result = await page.evaluate(async () => {
    const e = (window as unknown as { __openreelE2E: { core: Core; video: { getVideoEngine(): { composite(l: unknown[], w: number, h: number): Promise<ImageBitmap> } } } }).__openreelE2E;
    const W = 96;
    const H = 54;
    const solid = (color: string, grad?: string): OffscreenCanvas => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      const lg = g.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, color);
      lg.addColorStop(1, grad ?? color);
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H);
      return c;
    };
    const base = solid("#c85a32", "#2e9bd6");
    const top = solid("#5ab4e6", "#e6d25a");
    const transform = {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    };
    const layer = (image: OffscreenCanvas, blendMode: string, opacity: number) => ({
      image,
      transform: { ...transform, opacity },
      effects: [],
      blendMode,
      visible: true,
    });
    const engine = e.video.getVideoEngine();
    const read = async (bmp: ImageBitmap): Promise<Uint8ClampedArray> => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, W, H).data;
    };
    const preview = (mode: string, opacity: number): Uint8ClampedArray => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(base, 0, 0);
      g.save();
      g.globalAlpha = opacity;
      e.core.blendReference.drawImageWithBlend(g, top, mode);
      g.restore();
      return g.getImageData(0, 0, W, H).data;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };
    const out: Record<string, number> = {};
    for (const [mode, opacity] of [["linear-burn", 0.8], ["dissolve", 0.5]] as const) {
      const a = await read(await engine.composite([layer(base, "normal", 1), layer(top, mode, opacity)], W, H));
      const b = await read(await engine.composite([layer(base, "normal", 1), layer(top, mode, opacity)], W, H));
      out[`${mode}.exportVsPreviewMax`] = diff(a, preview(mode, opacity));
      out[`${mode}.repeatMax`] = diff(a, b);
    }
    return out;
  });
  expect(result["linear-burn.exportVsPreviewMax"]).toBeLessThanOrEqual(2);
  expect(result["linear-burn.repeatMax"]).toBe(0);
  expect(result["dissolve.exportVsPreviewMax"]).toBeLessThanOrEqual(2);
  expect(result["dissolve.repeatMax"]).toBe(0);
});
