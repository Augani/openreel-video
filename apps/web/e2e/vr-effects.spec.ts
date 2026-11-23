import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";
import { SOFTWARE_GPU } from "./env";

/**
 * Immersive video effects in a real browser: the GLSL shader of every VR effect is rendered with the same parameters as the
 * CPU reference (the Canvas2D / software fallback and the export reference) on a synthetic equirectangular grid, and the two
 * images must agree (PSNR). Both paths are then timed at 4K equirect (3840x1920) and at 1080p.
 */
interface Row {
  label: string;
  type: string;
  psnr: number;
  mad: number;
  changed: boolean;
  gpuMs4k: number;
  cpuMs4k: number;
}

const CASES: Array<{ label: string; type: string; params: Record<string, unknown> }> = [
  { label: "rotate pan 37 / tilt 18 / roll 9", type: "vr-rotate-sphere", params: { pan: 37, tilt: 18, roll: 9 } },
  { label: "rotate pan 180 across the seam", type: "vr-rotate-sphere", params: { pan: 180, tilt: -25, roll: 0 } },
  { label: "rotate stereo over/under", type: "vr-rotate-sphere", params: { layout: "over-under", pan: 60, tilt: 10, roll: 0 } },
  { label: "reframe to flat 16:9", type: "vr-projection", params: { mode: "rectilinear", fov: 90, pan: 25, tilt: -10, roll: 0, aspect: 16 / 9 } },
  { label: "reframe to flat 9:16 roll", type: "vr-projection", params: { mode: "rectilinear", fov: 70, pan: -120, tilt: 20, roll: 15, aspect: 9 / 16 } },
  { label: "little planet", type: "vr-projection", params: { mode: "stereographic", fov: 250, pan: 0, tilt: -90, roll: 0, aspect: 1 } },
  { label: "fisheye", type: "vr-projection", params: { mode: "fisheye", fov: 180, pan: 10, tilt: 5, roll: 0, aspect: 1 } },
  { label: "blur 3 degrees", type: "vr-blur", params: { radius: 3 } },
  { label: "plane to sphere", type: "vr-plane-to-sphere", params: { enabled: true, width: 70, pan: 40, tilt: 15, roll: 10 } },
];

test("VR effects: GLSL matches the CPU reference (PSNR) and 4K equirect timing", async ({ page }) => {
  test.setTimeout(600_000);
  page.on("console", (m) => {
    if (m.text().includes("MotionShaderRenderer")) console.log(m.text().slice(0, 1500));
  });
  await openHookPage(page);
  const rows = await page.evaluate(async (cases) => {
    const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
    const fx = core.proEffects;
    const sh = core.proEffectShaders;
    const mr = core.motionShaderRenderer;
    if (!mr.MotionShaderRenderer.isSupported()) throw new Error("WebGL2 is not available");
    const grid = (w: number, h: number): HTMLCanvasElement => {
      const rgba = core.vrTestImages.gridSphereImage(w, h) as Uint8ClampedArray;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
      return c;
    };
    const W = 512;
    const H = 256;
    const src = grid(W, H);
    const srcData = src.getContext("2d")!.getImageData(0, 0, W, H);
    const renderer = new mr.MotionShaderRenderer();
    const big = grid(3840, 1920);
    const bigData = big.getContext("2d")!.getImageData(0, 0, 3840, 1920);
    const out: unknown[] = [];
    for (const c of cases as Array<{ label: string; type: string; params: Record<string, unknown> }>) {
      const params = { ...fx.PRO_EFFECT_DEFAULTS[c.type], ...c.params };
      const cpu = new Uint8ClampedArray(srcData.data);
      fx.applyProEffect(c.type, params, cpu, W, H);
      const def = sh.PRO_EFFECT_SHADER_DEFS[c.type];
      const result = renderer.render(def, { width: W, height: H, time: 0, params: fx.proEffectGpuUniforms(c.type, params, H), inputCanvas: src, strict: true });
      if (!result) throw new Error(`${c.label}: shader failed to compile or render`);
      const rc = document.createElement("canvas");
      rc.width = W;
      rc.height = H;
      const rg = rc.getContext("2d", { willReadFrequently: true })!;
      rg.drawImage(result as CanvasImageSource, 0, 0);
      const gpu = rg.getImageData(0, 0, W, H).data;
      // Premultiplied comparison: transparent pixels carry no colour.
      let se = 0;
      let sum = 0;
      let changed = 0;
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const ac = cpu[o + 3] / 255;
        const ag = gpu[o + 3] / 255;
        const diffs = [cpu[o] * ac - gpu[o] * ag, cpu[o + 1] * ac - gpu[o + 1] * ag, cpu[o + 2] * ac - gpu[o + 2] * ag, cpu[o + 3] - gpu[o + 3]];
        for (const d of diffs) {
          se += d * d;
          sum += Math.abs(d);
        }
        if (cpu[o] !== srcData.data[o] || cpu[o + 1] !== srcData.data[o + 1] || cpu[o + 2] !== srcData.data[o + 2] || cpu[o + 3] !== srcData.data[o + 3]) changed++;
      }
      const mse = se / (W * H * 4);
      // 4K timing: GPU (upload + draw + readback of one pixel to sync), CPU (reference on the full frame).
      const bigUniforms = fx.proEffectGpuUniforms(c.type, params, 1920);
      const run = (): void => {
        const r = renderer.render(def, { width: 3840, height: 1920, time: 0, params: bigUniforms, inputCanvas: big, strict: true });
        const gl = (r as HTMLCanvasElement).getContext("webgl2") as WebGL2RenderingContext;
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      };
      run();
      run();
      const t0 = performance.now();
      for (let i = 0; i < 6; i++) run();
      const gpuMs4k = (performance.now() - t0) / 6;
      const buf = new Uint8ClampedArray(bigData.data);
      const c0 = performance.now();
      fx.applyProEffect(c.type, params, buf, 3840, 1920);
      const cpuMs4k = performance.now() - c0;
      out.push({ label: c.label, type: c.type, psnr: mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse), mad: sum / (W * H * 4), changed: changed > 0, gpuMs4k, cpuMs4k });
    }
    return out as Row[];
  }, CASES);

  const lines = rows.map((r) => `${r.label.padEnd(36)} PSNR=${r.psnr.toFixed(1)}dB MAD=${r.mad.toFixed(3)} gpu4k=${r.gpuMs4k.toFixed(1)}ms cpu4k=${r.cpuMs4k.toFixed(0)}ms${r.changed ? "" : " (UNCHANGED)"}`);
  console.log(`\n${lines.join("\n")}`);
  test.info().annotations.push({ type: "vr-parity", description: lines.join("\n") });

  for (const r of rows) {
    expect(r.changed, `${r.label}: the effect left the grid unchanged`).toBe(true);
    // Single-tap bilinear on identical coordinates: GPU float precision only.
    expect(r.psnr, `${r.label}: GPU vs CPU PSNR`).toBeGreaterThan(38);
    if (!SOFTWARE_GPU) expect(r.gpuMs4k, `${r.label}: 4K GPU frame time`).toBeLessThan(50);
  }
});
