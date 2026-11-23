import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";

/**
 * Corner Pin in a real browser: the GLSL shader (the GPU path the preview and the exporter use) and the CPU
 * reference (the software / Canvas2D fallback) are rendered with the same pinned quads on a synthetic test card,
 * including quads like the ones a planar track produces, and must agree. The page reaches the core modules
 * through the e2e hook, so no editor session is needed.
 */
const QUADS: Record<string, Record<string, number>> = {
  keystone: { x0: 12, y0: 6, x1: 88, y1: 14, x2: 96, y2: 92, x3: 4, y3: 84 },
  rotated: { x0: 30, y0: 5, x1: 95, y1: 30, x2: 70, y2: 95, x3: 5, y3: 70 },
  "tracked-like": { x0: 18.4, y0: 22.9, x1: 71.2, y1: 27.3, x2: 74.8, y2: 80.1, x3: 15.9, y3: 71.6 },
  "off-canvas": { x0: -20, y0: 10, x1: 80, y1: -10, x2: 120, y2: 90, x3: 10, y3: 130 },
};

test("Corner Pin: GLSL shader matches the CPU reference for tracked-style quads", async ({ page }) => {
  test.setTimeout(120_000);
  await openHookPage(page);
  const rows = await page.evaluate(async (quads) => {
    const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
    const fx = core.proEffects, sh = core.proEffectShaders, mr = core.motionShaderRenderer;
    if (!mr.MotionShaderRenderer.isSupported()) throw new Error("WebGL2 is not available");
    const W = 320, H = 180;
    const src = document.createElement("canvas");
    src.width = W; src.height = H;
    const g = src.getContext("2d", { willReadFrequently: true })!;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#ff3b30"); grad.addColorStop(0.5, "#34c759"); grad.addColorStop(1, "#0a84ff");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = "#101010"; g.fillRect(W * 0.1, H * 0.12, W * 0.28, H * 0.4);
    g.fillStyle = "#f5f5f5"; g.beginPath(); g.arc(W * 0.68, H * 0.5, H * 0.28, 0, Math.PI * 2); g.fill();
    const srcData = g.getImageData(0, 0, W, H);
    const renderer = new mr.MotionShaderRenderer();
    const out: Array<{ name: string; mad: number; bigFrac: number; covered: number }> = [];
    for (const [name, q] of Object.entries(quads as Record<string, Record<string, number>>)) {
      const params = { ...fx.PRO_EFFECT_DEFAULTS["corner-pin"], ...q };
      const cpu = new Uint8ClampedArray(srcData.data);
      fx.applyProEffect("corner-pin", params, cpu, W, H);
      const result = renderer.render(sh.PRO_EFFECT_SHADER_DEFS["corner-pin"], { width: W, height: H, time: 0, params: fx.proEffectGpuUniforms("corner-pin", params, H), inputCanvas: src, strict: true });
      if (!result) throw new Error(`${name}: shader failed to compile or render`);
      const rc = document.createElement("canvas");
      rc.width = W; rc.height = H;
      const rg = rc.getContext("2d", { willReadFrequently: true })!;
      rg.drawImage(result as CanvasImageSource, 0, 0);
      const gpu = rg.getImageData(0, 0, W, H).data;
      let sum = 0, big = 0, covered = 0;
      for (let i = 0; i < W * H; i++) {
        const o = i * 4, ac = cpu[o + 3] / 255, ag = gpu[o + 3] / 255;
        const d = [cpu[o] * ac - gpu[o] * ag, cpu[o + 1] * ac - gpu[o + 1] * ag, cpu[o + 2] * ac - gpu[o + 2] * ag, cpu[o + 3] - gpu[o + 3]].map(Math.abs);
        sum += d[0] + d[1] + d[2] + d[3];
        if (Math.max(...d) > 24) big++;
        if (cpu[o + 3] > 0) covered++;
      }
      out.push({ name, mad: sum / (W * H * 4), bigFrac: big / (W * H), covered: covered / (W * H) });
    }
    return out;
  }, QUADS);
  console.log(rows.map((r) => `[corner-pin parity] ${r.name}: MAD ${r.mad.toFixed(3)} px>24 ${(r.bigFrac * 100).toFixed(2)}% covered ${(r.covered * 100).toFixed(1)}%`).join("\n"));
  for (const r of rows) {
    expect(r.covered, `${r.name} draws something`).toBeGreaterThan(0.15);
    expect(r.mad, `${r.name} GPU vs CPU MAD`).toBeLessThan(0.6);
    expect(r.bigFrac, `${r.name} edge pixels that differ`).toBeLessThan(0.02);
  }
});
