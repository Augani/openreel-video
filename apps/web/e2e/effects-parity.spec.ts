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

test("repair effects (Dehaze, Deband, Deflicker): GLSL matches the CPU reference and 1080p stays within budget", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openHookPage(page);
  const rows = await page.evaluate(
    async () => {
      const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
      const fx = core.proEffects;
      const sh = core.proEffectShaders;
      const mr = core.motionShaderRenderer;
      if (!mr.MotionShaderRenderer.isSupported()) throw new Error("WebGL2 is not available");

      /** A hazy gradient top, a quantised 8-bit ramp in the middle, hard-edged shapes at the bottom. */
      const scene = (w: number, h: number): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        const haze = g.createLinearGradient(0, 0, w, 0);
        haze.addColorStop(0, "#8a9298");
        haze.addColorStop(1, "#d9dde0");
        g.fillStyle = haze;
        g.fillRect(0, 0, w, h * 0.4);
        const ramp = g.createLinearGradient(0, 0, w, 0);
        ramp.addColorStop(0, "#686868");
        ramp.addColorStop(1, "#767676");
        g.fillStyle = ramp;
        g.fillRect(0, h * 0.4, w, h * 0.3);
        g.fillStyle = "#1c2a1c";
        g.fillRect(w * 0.1, h * 0.72, w * 0.3, h * 0.22);
        g.fillStyle = "#f0f0f0";
        g.beginPath();
        g.arc(w * 0.7, h * 0.83, h * 0.12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#b03020";
        g.fillRect(w * 0.48, h * 0.76, w * 0.12, h * 0.14);
        return c;
      };
      const W = 320;
      const H = 180;
      const src = scene(W, H);
      const srcData = src.getContext("2d")!.getImageData(0, 0, W, H);
      const big = scene(1920, 1080);
      const renderer = new mr.MotionShaderRenderer();
      const out: unknown[] = [];

      for (const type of ["dehaze", "deband", "deflicker"] as string[]) {
        const params: Record<string, unknown> = { ...fx.PRO_EFFECT_DEFAULTS[type] };
        // Deflicker's gain is what the render path derives from the neighbour frames.
        if (type === "deflicker") Object.assign(params, { gainR: 1.18, gainG: 0.92, gainB: 1.04 });
        if (type === "deband") Object.assign(params, { threshold: 8, dither: 100 });
        const cpu = new Uint8ClampedArray(srcData.data);
        fx.applyProEffect(type, params, cpu, W, H);
        const def = sh.PRO_EFFECT_SHADER_DEFS[type];
        const result = renderer.render(def, {
          width: W,
          height: H,
          time: 0,
          params: fx.proEffectGpuUniforms(type, params, H),
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
        let sum = 0;
        let max = 0;
        let big8 = 0;
        let changed = 0;
        for (let i = 0; i < W * H; i++) {
          const o = i * 4;
          let pixelBig = false;
          for (let k = 0; k < 4; k++) {
            const a = Math.abs(cpu[o + k] - gpu[o + k]);
            sum += a;
            if (a > max) max = a;
            if (a > 8) pixelBig = true;
          }
          if (pixelBig) big8++;
          if (cpu[o] !== srcData.data[o] || cpu[o + 1] !== srcData.data[o + 1] || cpu[o + 2] !== srcData.data[o + 2]) changed++;
        }
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
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        };
        run();
        run();
        const t0 = performance.now();
        for (let i = 0; i < 8; i++) run();
        out.push({
          type,
          mad: sum / (W * H * 4),
          max,
          bigFrac: big8 / (W * H),
          changedFrac: changed / (W * H),
          gpuMs1080: (performance.now() - t0) / 8,
        });
      }
      return out as Array<{ type: string; mad: number; max: number; bigFrac: number; changedFrac: number; gpuMs1080: number }>;
    },
  );
  console.log(
    `\n${rows
      .map((r) => `${r.type.padEnd(10)} MAD=${r.mad.toFixed(3)} max=${r.max} px>8=${(r.bigFrac * 100).toFixed(2)}% changed=${(r.changedFrac * 100).toFixed(1)}% gpu1080p=${r.gpuMs1080.toFixed(2)}ms`)
      .join("\n")}`,
  );
  const failures: string[] = [];
  for (const r of rows) {
    if (r.changedFrac < 0.05) failures.push(`${r.type}: left the test scene unchanged (${(r.changedFrac * 100).toFixed(1)}%)`);
    if (r.mad > 0.5) failures.push(`${r.type}: GPU vs CPU MAD ${r.mad.toFixed(3)} > 0.5`);
    if (r.bigFrac > 0.01) failures.push(`${r.type}: ${(r.bigFrac * 100).toFixed(2)}% of pixels differ by >8`);
    if (!SOFTWARE_GPU && r.gpuMs1080 > 33) failures.push(`${r.type}: ${r.gpuMs1080.toFixed(1)}ms per 1080p frame exceeds 33ms`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("Lumetri Creative and Lens Correction: GLSL matches the CPU reference and 1080p stays within budget", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openHookPage(page);
  const rows = await page.evaluate(
    async () => {
      const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
      const fx = core.proEffects;
      const sh = core.proEffectShaders;
      const mr = core.motionShaderRenderer;
      if (!mr.MotionShaderRenderer.isSupported()) throw new Error("WebGL2 is not available");

      /** Colour patches (skin, sky, foliage, grays), a grid of thin lines for the lens, a hard edge for Sharpen. */
      const scene = (w: number, h: number): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#202830");
        grad.addColorStop(0.5, "#808890");
        grad.addColorStop(1, "#f0e8e0");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        const patches = ["#c68863", "#4a7bd0", "#3c8a3a", "#a03030", "#e8d8c0", "#101018"];
        patches.forEach((color, i) => {
          g.fillStyle = color;
          g.fillRect(w * (0.05 + i * 0.15), h * 0.55, w * 0.12, h * 0.3);
        });
        g.strokeStyle = "#ffffff";
        g.lineWidth = Math.max(1, h / 90);
        for (let i = 1; i < 8; i++) {
          g.beginPath();
          g.moveTo((w * i) / 8, 0);
          g.lineTo((w * i) / 8, h);
          g.stroke();
          g.beginPath();
          g.moveTo(0, (h * i) / 8);
          g.lineTo(w, (h * i) / 8);
          g.stroke();
        }
        return c;
      };
      const W = 320;
      const H = 180;
      const src = scene(W, H);
      const srcData = src.getContext("2d")!.getImageData(0, 0, W, H);
      const big = scene(1920, 1080);
      const renderer = new mr.MotionShaderRenderer();
      const out: unknown[] = [];
      const cases: Array<[string, string, Record<string, unknown>]> = [
        ["lumetri-creative", "creative defaults", { ...fx.PRO_EFFECT_DEFAULTS["lumetri-creative"] }],
        [
          "lumetri-creative",
          "creative full",
          { fadedFilm: 40, sharpen: 60, vibrance: 70, shadowTintHue: 200, shadowTintAmount: 70, highlightTintHue: 35, highlightTintAmount: 60, tintBalance: 25 },
        ],
        ["lens-correction", "lens manual", { profile: "manual", distortion: 35, curvature: -10, tangentialX: 12, tangentialY: -8, scale: 104 }],
        ["lens-correction", "lens gopro", { profile: "gopro-wide", strength: 100, caRed: 60, caBlue: -50, vignette: 40 }],
      ];
      for (const [type, name, params] of cases) {
        const cpu = new Uint8ClampedArray(srcData.data);
        fx.applyProEffect(type, params, cpu, W, H);
        const def = sh.PRO_EFFECT_SHADER_DEFS[type];
        const result = renderer.render(def, {
          width: W,
          height: H,
          time: 0,
          params: fx.proEffectGpuUniforms(type, params, H),
          inputCanvas: src,
          strict: true,
        });
        if (!result) throw new Error(`${name}: shader failed to compile or render`);
        const rc = document.createElement("canvas");
        rc.width = W;
        rc.height = H;
        const rg = rc.getContext("2d", { willReadFrequently: true })!;
        rg.drawImage(result as CanvasImageSource, 0, 0);
        const gpu = rg.getImageData(0, 0, W, H).data;
        let sum = 0;
        let max = 0;
        let big8 = 0;
        let changed = 0;
        for (let i = 0; i < W * H; i++) {
          const o = i * 4;
          let pixelBig = false;
          for (let k = 0; k < 4; k++) {
            const a = Math.abs(cpu[o + k] - gpu[o + k]);
            sum += a;
            if (a > max) max = a;
            if (a > 8) pixelBig = true;
          }
          if (pixelBig) big8++;
          if (cpu[o] !== srcData.data[o] || cpu[o + 1] !== srcData.data[o + 1] || cpu[o + 2] !== srcData.data[o + 2]) changed++;
        }
        const bigUniforms = fx.proEffectGpuUniforms(type, params, 1080);
        const run = (): void => {
          const r = renderer.render(def, { width: 1920, height: 1080, time: 0, params: bigUniforms, inputCanvas: big, strict: true });
          const gl = (r as HTMLCanvasElement).getContext("webgl2") as WebGL2RenderingContext;
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        };
        run();
        run();
        const t0 = performance.now();
        for (let i = 0; i < 8; i++) run();
        out.push({ type: name, mad: sum / (W * H * 4), max, bigFrac: big8 / (W * H), changedFrac: changed / (W * H), gpuMs1080: (performance.now() - t0) / 8 });
      }
      return out as Array<{ type: string; mad: number; max: number; bigFrac: number; changedFrac: number; gpuMs1080: number }>;
    },
  );
  console.log(
    `\n${rows
      .map((r) => `${r.type.padEnd(18)} MAD=${r.mad.toFixed(3)} max=${r.max} px>8=${(r.bigFrac * 100).toFixed(2)}% changed=${(r.changedFrac * 100).toFixed(1)}% gpu1080p=${r.gpuMs1080.toFixed(2)}ms`)
      .join("\n")}`,
  );
  const failures: string[] = [];
  for (const r of rows) {
    if (r.changedFrac < 0.05) failures.push(`${r.type}: left the test scene unchanged (${(r.changedFrac * 100).toFixed(1)}%)`);
    if (r.mad > 0.5) failures.push(`${r.type}: GPU vs CPU MAD ${r.mad.toFixed(3)} > 0.5`);
    if (r.bigFrac > 0.01) failures.push(`${r.type}: ${(r.bigFrac * 100).toFixed(2)}% of pixels differ by >8`);
    if (!SOFTWARE_GPU && r.gpuMs1080 > 33) failures.push(`${r.type}: ${r.gpuMs1080.toFixed(1)}ms per 1080p frame exceeds 33ms`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
