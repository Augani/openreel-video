import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";
import { SOFTWARE_GPU } from "./env";

/**
 * Real-browser parity of every wave 7 effect: the GLSL shader (the GPU path)
 * is rendered with the same params as the CPU reference (the software /
 * Canvas2D fallback) on a synthetic 320x180 test card, and the two images
 * must agree within a tolerance. The same GPU path is then timed at 1080p.
 *
 * The page reaches the core modules through the e2e hook (`__openreelE2E.core`), so the spec runs
 * against the dev server and a production bundle alike, and no editor session is needed.
 */
interface Row {
  type: string;
  mad: number;
  p99: number;
  bigFrac: number;
  max: number;
  gpuMs1080: number;
  flat: boolean;
}

/** Per-effect tolerance on the mean absolute 0-255 difference (premultiplied RGBA). */
const MAD_LIMIT: Record<string, number> = {
  // Strided taps (radius > 6 px) are the documented approximation.
  "channel-blur": 1,
};
const DEFAULT_MAD_LIMIT = 0.5;

test("every wave 7 effect: GLSL shader matches the CPU reference and renders 1080p within budget", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openHookPage(page);
  const rows = await page.evaluate(
    async () => {
      const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
      const fx = core.proEffects;
      const sh = core.proEffectShaders;
      const ex = core.proEffectsExtra;
      const mr = core.motionShaderRenderer;
      if (!mr.MotionShaderRenderer.isSupported()) throw new Error("WebGL2 is not available");

      const W = 320;
      const H = 180;
      const card = (w: number, h: number): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#ff3b30");
        grad.addColorStop(0.35, "#34c759");
        grad.addColorStop(0.7, "#0a84ff");
        grad.addColorStop(1, "#ffd60a");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#101010";
        g.fillRect(w * 0.1, h * 0.12, w * 0.28, h * 0.4);
        g.fillStyle = "#f5f5f5";
        g.beginPath();
        g.arc(w * 0.68, h * 0.5, h * 0.28, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#00c800";
        g.fillRect(w * 0.45, h * 0.62, w * 0.3, h * 0.25);
        g.strokeStyle = "#202020";
        g.lineWidth = Math.max(2, h / 60);
        for (let i = 0; i < 8; i++) {
          g.beginPath();
          g.moveTo(0, (h / 8) * i);
          g.lineTo(w, (h / 8) * (i + 1) - h / 16);
          g.stroke();
        }
        return c;
      };

      const src = card(W, H);
      const srcData = src.getContext("2d")!.getImageData(0, 0, W, H);
      const renderer = new mr.MotionShaderRenderer();
      const big = card(1920, 1080);
      const out: unknown[] = [];

      for (const type of ex.EXTRA_PRO_EFFECT_TYPES as string[]) {
        const params: Record<string, unknown> = { ...fx.PRO_EFFECT_DEFAULTS[type] };
        // 0.45 s lands inside the strobe flash window (period 0.5, phase 0.05)
        if ("time" in params) params.time = type === "strobe-light" ? 0.45 : 0.7;
        // CPU reference
        const cpu = new Uint8ClampedArray(srcData.data);
        fx.applyProEffect(type, params, cpu, W, H);
        // GPU
        const uniforms = fx.proEffectGpuUniforms(type, params, H);
        const def = sh.PRO_EFFECT_SHADER_DEFS[type];
        const result = renderer.render(def, {
          width: W,
          height: H,
          time: 0,
          params: uniforms,
          inputCanvas: src,
          strict: true,
        });
        if (!result) throw new Error(`${type}: shader failed to compile or render`);
        const rc = document.createElement("canvas");
        rc.width = W;
        rc.height = H;
        const rg = rc.getContext("2d", { willReadFrequently: true })!;
        rg.drawImage(result as CanvasImageSource, 0, 0);
        const gpu = rg.getImageData(0, 0, W, H).data;

        // premultiplied comparison avoids unpremultiply noise at low alpha
        const diffs: number[] = [];
        let sum = 0;
        let max = 0;
        let big8 = 0;
        let changed = 0;
        for (let i = 0; i < W * H; i++) {
          const o = i * 4;
          const ac = cpu[o + 3] / 255;
          const ag = gpu[o + 3] / 255;
          let pixelBig = false;
          const cmp = [
            cpu[o] * ac - gpu[o] * ag,
            cpu[o + 1] * ac - gpu[o + 1] * ag,
            cpu[o + 2] * ac - gpu[o + 2] * ag,
            cpu[o + 3] - gpu[o + 3],
          ];
          for (const d of cmp) {
            const a = Math.abs(d);
            diffs.push(a);
            sum += a;
            if (a > max) max = a;
            if (a > 24) pixelBig = true;
          }
          if (pixelBig) big8++;
          if (
            cpu[o] !== srcData.data[o] ||
            cpu[o + 1] !== srcData.data[o + 1] ||
            cpu[o + 2] !== srcData.data[o + 2] ||
            cpu[o + 3] !== srcData.data[o + 3]
          )
            changed++;
        }
        diffs.sort((a, b) => a - b);

        // 1080p timing: upload + draw + finish, averaged
        const bigUniforms = fx.proEffectGpuUniforms(type, params, 1080);
        const run = (): void => {
          const r = renderer.render(def, {
            width: 1920,
            height: 1080,
            time: 0,
            params: bigUniforms,
            inputCanvas: big,
            strict: true,
          });
          const gl = (r as HTMLCanvasElement).getContext("webgl2") as WebGL2RenderingContext;
          const px = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        run();
        run();
        const t0 = performance.now();
        const N = 8;
        for (let i = 0; i < N; i++) run();
        const gpuMs1080 = (performance.now() - t0) / N;

        out.push({
          type,
          mad: sum / (W * H * 4),
          p99: diffs[Math.floor(diffs.length * 0.99)],
          bigFrac: big8 / (W * H),
          max,
          gpuMs1080,
          flat: changed === 0,
        });
      }
      return out as Row[];
    },
  );

  const lines = rows.map(
    (r) =>
      `${r.type.padEnd(20)} MAD=${r.mad.toFixed(3)} p99=${r.p99.toFixed(1)} px>24=${(r.bigFrac * 100).toFixed(2)}% max=${r.max.toFixed(0)} gpu1080p=${r.gpuMs1080.toFixed(2)}ms${r.flat ? " (UNCHANGED)" : ""}`,
  );
  console.log(`\n${lines.join("\n")}`);
  const slowest = [...rows].sort((a, b) => b.gpuMs1080 - a.gpuMs1080)[0];
  console.log(`slowest 1080p effect: ${slowest.type} ${slowest.gpuMs1080.toFixed(2)}ms`);

  const failures: string[] = [];
  for (const r of rows) {
    if (r.flat) failures.push(`${r.type}: default params left the test card unchanged`);
    const limit = MAD_LIMIT[r.type] ?? DEFAULT_MAD_LIMIT;
    if (r.mad > limit) failures.push(`${r.type}: GPU vs CPU MAD ${r.mad.toFixed(3)} > ${limit}`);
    if (r.bigFrac > 0.03) failures.push(`${r.type}: ${(r.bigFrac * 100).toFixed(2)}% of pixels differ by >24`);
    // Frame budget: a 1080p frame (upload + shader + sync) must fit a 30 fps playback frame.
    // Only meaningful on a hardware GPU; SwiftShader (Linux CI) is 2-100x slower by design.
    if (!SOFTWARE_GPU && r.gpuMs1080 > 33) failures.push(`${r.type}: ${r.gpuMs1080.toFixed(1)}ms per 1080p frame exceeds 33ms`);
  }
  if (SOFTWARE_GPU) {
    test.info().annotations.push({
      type: "skipped-budget",
      description: `1080p frame budget not judged on the SwiftShader software GPU (slowest ${slowest.type} ${slowest.gpuMs1080.toFixed(1)}ms)`,
    });
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("disc blurs weight colour by alpha: GLSL matches the CPU reference at a transparent edge", async ({
  page,
}) => {
  await openHookPage(page);
  const rows = await page.evaluate(
    async () => {
      const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
      const fx = core.proEffects;
      const sh = core.proEffectShaders;
      const mr = core.motionShaderRenderer;
      const W = 160;
      const H = 90;
      const src = document.createElement("canvas");
      src.width = W;
      src.height = H;
      const g = src.getContext("2d", { willReadFrequently: true })!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, W / 2, H); // right half stays fully transparent
      const srcData = g.getImageData(0, 0, W, H);
      const renderer = new mr.MotionShaderRenderer();
      const out: Array<{ type: string; mad: number; edgeCpu: number; edgeGpu: number }> = [];
      for (const type of ["camera-blur", "tilt-shift"]) {
        const params: Record<string, unknown> = { ...fx.PRO_EFFECT_DEFAULTS[type] };
        if (type === "tilt-shift") Object.assign(params, { focus: 0, falloff: 1 });
        const cpu = new Uint8ClampedArray(srcData.data);
        fx.applyProEffect(type, params, cpu, W, H);
        const result = renderer.render(sh.PRO_EFFECT_SHADER_DEFS[type], {
          width: W,
          height: H,
          time: 0,
          params: fx.proEffectGpuUniforms(type, params, H),
          inputCanvas: src,
          strict: true,
        });
        if (!result) throw new Error(`${type}: shader failed`);
        const rc = document.createElement("canvas");
        rc.width = W;
        rc.height = H;
        const rg = rc.getContext("2d", { willReadFrequently: true })!;
        rg.drawImage(result as CanvasImageSource, 0, 0);
        const gpu = rg.getImageData(0, 0, W, H).data;
        let sum = 0;
        for (let i = 0; i < W * H; i++) {
          const o = i * 4;
          const ac = cpu[o + 3] / 255;
          const ag = gpu[o + 3] / 255;
          sum +=
            Math.abs(cpu[o] * ac - gpu[o] * ag) +
            Math.abs(cpu[o + 1] * ac - gpu[o + 1] * ag) +
            Math.abs(cpu[o + 2] * ac - gpu[o + 2] * ag) +
            Math.abs(cpu[o + 3] - gpu[o + 3]);
        }
        const e = ((H >> 1) * W + (W / 2 - 1)) * 4;
        out.push({ type, mad: sum / (W * H * 4), edgeCpu: cpu[e], edgeGpu: gpu[e] });
      }
      return out;
    },
  );
  console.log(`\nalpha-edge parity ${JSON.stringify(rows)}`);
  for (const r of rows) {
    expect(r.mad, `${r.type} GPU vs CPU`).toBeLessThan(0.5);
    // un-premultiplied colour next to the transparent half must stay white, not darken
    expect(r.edgeCpu, `${r.type} CPU edge`).toBeGreaterThanOrEqual(225);
  }
});
