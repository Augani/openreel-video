import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";

// Drives Canvas2DFallbackRenderer itself (the renderer the factory returns when
// WebGPU is unavailable) in a real browser: each of the formerly missing
// effects must change an opaque frame, and must do so visibly.


test("Canvas2DFallbackRenderer renders Glow, Vignette, Sharpen, Film grain and opaque Drop Shadow", async ({
  page,
}) => {
  await openHookPage(page);
  const result = await page.evaluate(async () => {
    const mod = (window as unknown as { __openreelE2E: { core: { canvas2dFallbackRenderer: any } } }).__openreelE2E.core.canvas2dFallbackRenderer;
    const W = 320;
    const H = 180;
    const make = () => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#203060");
      grad.addColorStop(1, "#e0d090");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#ffffff";
      g.fillRect(40, 40, 60, 40);
      g.fillStyle = "#101010";
      for (let i = 0; i < 20; i++) g.fillRect(150 + i * 6, 60, 3, 60);
      return createImageBitmap(c);
    };
    const renderWith = async (effects: unknown[]) => {
      const r = new mod.Canvas2DFallbackRenderer({ canvas: new OffscreenCanvas(W, H), width: W, height: H });
      await r.initialize();
      r.beginFrame();
      const bmp = await make();
      r.renderLayer({
        texture: r.applyEffects(bmp, effects),
        transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
        effects: [],
        opacity: 1,
        borderRadius: 0,
      });
      const out: ImageBitmap = await r.endFrame();
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(out, 0, 0);
      r.destroy();
      return g.getImageData(0, 0, W, H).data;
    };
    const mad = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let s = 0;
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        n += 3;
      }
      return s / n;
    };
    const fx = (type: string, params: Record<string, unknown>) => ({ id: type, type, enabled: true, params });
    const base = await renderWith([]);
    const cases: Record<string, unknown[]> = {
      glow: [fx("glow", { radius: 20, intensity: 1.5, color: "#ffffff" })],
      vignette: [fx("vignette", { amount: 60, midpoint: 0.5, feather: 0.3 })],
      sharpen: [fx("sharpen", { amount: 100 })],
      grain: [fx("grain", { amount: 50 })],
      shadow: [fx("shadow", { offsetX: 8, offsetY: 8, blur: 12, color: "#000000", opacity: 0.8 })],
    };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cases)) out[k] = mad(base, await renderWith(v));
    return out;
  });
  console.log("canvas2d fallback renderer MAD vs no effect:", JSON.stringify(result));
  for (const [name, d] of Object.entries(result)) {
    expect(d, `${name} must visibly change an opaque frame`).toBeGreaterThan(0.5);
  }
});
