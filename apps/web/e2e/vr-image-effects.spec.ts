import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";
import { SOFTWARE_GPU } from "./env";

/**
 * Immersive image effects (VR Sharpen, Glow, Chromatic Aberrations, Digital Glitch, De-Noise) in a real browser: the GLSL
 * shader of each is rendered with the same parameters as the CPU reference on a synthetic equirectangular picture and the
 * two must agree (PSNR); then the 360 properties are checked on the GPU path itself (seam: the picture rotated half a turn
 * gives the same result after unrotating; poles: a latitude-only picture stays constant along each row; stereo eyes never
 * mix; the glitch is deterministic); and both paths are timed at 4K equirect (3840x1920).
 */
interface Row {
  label: string;
  type: string;
  psnr: number;
  changed: boolean;
  gpuMs4k: number;
  cpuMs4k: number;
}

interface Props {
  seamPsnr: Record<string, number>;
  poleSpread: Record<string, number>;
  stereoLeak: Record<string, number>;
  glitchDeterministic: boolean;
  glitchDiffersBySeed: boolean;
}

const CASES: Array<{ label: string; type: string; params: Record<string, unknown> }> = [
  { label: "sharpen 100% / 1.5 deg", type: "vr-sharpen", params: { amount: 100, radius: 1.5 } },
  { label: "sharpen stereo over/under", type: "vr-sharpen", params: { layout: "over-under", amount: 70, radius: 1 } },
  { label: "glow threshold 30% / 6 deg", type: "vr-glow", params: { threshold: 30, radius: 6, brightness: 200 } },
  { label: "glow tinted, side by side", type: "vr-glow", params: { layout: "side-by-side", threshold: 40, radius: 4, brightness: 250, tintR: 255, tintG: 140, tintB: 60 } },
  { label: "chromatic aberrations centre ahead", type: "vr-chromatic-aberrations", params: { amount: 100, pan: 0, tilt: 0 } },
  { label: "chromatic aberrations pan 90 tilt 30", type: "vr-chromatic-aberrations", params: { amount: 60, pan: 90, tilt: 30 } },
  { label: "digital glitch", type: "vr-digital-glitch", params: { intensity: 80, seed: 11, time: 0.4, rate: 12 } },
  { label: "digital glitch stereo", type: "vr-digital-glitch", params: { layout: "over-under", intensity: 60, seed: 3, time: 1.1, rate: 8 } },
  { label: "de-noise 60% / 1 deg", type: "vr-de-noise", params: { amount: 60, radius: 1 } },
];

const PARITY_TYPES = ["vr-sharpen", "vr-glow", "vr-chromatic-aberrations", "vr-digital-glitch", "vr-de-noise"];

test("VR image effects: GLSL matches the CPU reference, 360 properties hold on the GPU path, 4K timing", async ({ page }) => {
  test.setTimeout(900_000);
  page.on("console", (m) => {
    if (m.text().includes("MotionShaderRenderer")) console.log(m.text().slice(0, 1500));
  });
  await openHookPage(page);
  const result = await page.evaluate(
    async ({ cases, types }) => {
      const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
      const fx = core.proEffects;
      const sh = core.proEffectShaders;
      const mr = core.motionShaderRenderer;
      if (!mr.MotionShaderRenderer.isSupported()) throw new Error("WebGL2 is not available");
      const canvasOf = (rgba: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d", { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
        return c;
      };
      // Detailed sphere picture: the 30 degree grid plus a smooth gradient and a little texture, so every effect has work to do.
      const picture = (w: number, h: number): Uint8ClampedArray => {
        const grid = core.vrTestImages.gridSphereImage(w, h) as Uint8ClampedArray;
        const smooth = core.vrTestImages.smoothSphereImage(w, h) as Uint8ClampedArray;
        const out = new Uint8ClampedArray(grid.length);
        for (let i = 0; i < out.length; i += 4) {
          const t = ((i / 4) * 2654435761) % 1000 / 1000;
          for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, 0.5 * grid[i + c] + 0.5 * smooth[i + c] + (t - 0.5) * 24));
          out[i + 3] = 255;
        }
        return out;
      };
      const renderer = new mr.MotionShaderRenderer();
      const gpuRun = (type: string, params: Record<string, unknown>, input: HTMLCanvasElement, w: number, h: number): Uint8ClampedArray => {
        const merged = { ...fx.PRO_EFFECT_DEFAULTS[type], ...params };
        const res = renderer.render(sh.PRO_EFFECT_SHADER_DEFS[type], { width: w, height: h, time: 0, params: fx.proEffectGpuUniforms(type, merged, h), inputCanvas: input, strict: true });
        if (!res) throw new Error(`${type}: shader failed to compile or render`);
        const rc = document.createElement("canvas");
        rc.width = w;
        rc.height = h;
        const g = rc.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(res as CanvasImageSource, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const cpuRun = (type: string, params: Record<string, unknown>, rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(rgba);
        fx.applyProEffect(type, { ...fx.PRO_EFFECT_DEFAULTS[type], ...params }, out, w, h);
        return out;
      };
      const psnrOf = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
        let se = 0;
        let n = 0;
        for (let i = 0; i < a.length; i++) {
          if (i % 4 === 3) continue;
          se += (a[i] - b[i]) ** 2;
          n++;
        }
        return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
      };
      const shiftCols = (src: ArrayLike<number>, w: number, h: number, dx: number): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(src.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const from = (((x - dx) % w) + w) % w;
          for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = src[(y * w + from) * 4 + c];
        }
        return out;
      };

      const W = 512;
      const H = 256;
      const pic = picture(W, H);
      const src = canvasOf(pic, W, H);
      const bigRgba = picture(3840, 1920);
      const big = canvasOf(bigRgba, 3840, 1920);
      const rows: unknown[] = [];
      for (const c of cases as Array<{ label: string; type: string; params: Record<string, unknown> }>) {
        const cpu = cpuRun(c.type, c.params, pic, W, H);
        const gpu = gpuRun(c.type, c.params, src, W, H);
        let changed = false;
        for (let i = 0; i < pic.length && !changed; i++) if (cpu[i] !== pic[i]) changed = true;
        const merged = { ...fx.PRO_EFFECT_DEFAULTS[c.type], ...c.params };
        const uniforms = fx.proEffectGpuUniforms(c.type, merged, 1920);
        const run = (): void => {
          const r = renderer.render(sh.PRO_EFFECT_SHADER_DEFS[c.type], { width: 3840, height: 1920, time: 0, params: uniforms, inputCanvas: big, strict: true });
          const gl = (r as HTMLCanvasElement).getContext("webgl2") as WebGL2RenderingContext;
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        };
        run();
        run();
        const t0 = performance.now();
        for (let i = 0; i < 4; i++) run();
        const gpuMs4k = (performance.now() - t0) / 4;
        const buf = new Uint8ClampedArray(bigRgba);
        const c0 = performance.now();
        fx.applyProEffect(c.type, merged, buf, 3840, 1920);
        const cpuMs4k = performance.now() - c0;
        rows.push({ label: c.label, type: c.type, psnr: psnrOf(cpu, gpu), changed, gpuMs4k, cpuMs4k });
      }

      // ---- 360 properties on the GPU path ------------------------------------------------------------------------------------
      const strong: Record<string, Record<string, unknown>> = {
        "vr-sharpen": { amount: 100, radius: 2 },
        "vr-glow": { threshold: 40, radius: 6, brightness: 250 },
        "vr-chromatic-aberrations": { amount: 100, pan: 0, tilt: 0 },
        "vr-digital-glitch": { intensity: 90, seed: 7, time: 0.3, rate: 12 },
        "vr-de-noise": { amount: 80, radius: 1.5 },
      };
      const shifted = shiftCols(pic, W, H, W / 2);
      const shiftedCanvas = canvasOf(shifted, W, H);
      const lat = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) {
        const s = Math.sin((0.5 - (y + 0.5) / H) * Math.PI);
        for (let x = 0; x < W; x++) {
          const o = (y * W + x) * 4;
          lat[o] = 128 + 100 * s;
          lat[o + 1] = 128 - 60 * s;
          lat[o + 2] = 100 + 40 * s * s;
          lat[o + 3] = 255;
        }
      }
      const latCanvas = canvasOf(lat, W, H);
      // Stereo: the top eye is black and the bottom eye white with a bright block at the shared edge; nothing may reach the top eye.
      const stereo = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const v = y < H / 2 ? 0 : 255;
        stereo[o] = stereo[o + 1] = stereo[o + 2] = v;
        stereo[o + 3] = 255;
      }
      const stereoCanvas = canvasOf(stereo, W, H);

      const props = { seamPsnr: {}, poleSpread: {}, stereoLeak: {}, glitchDeterministic: false, glitchDiffersBySeed: false } as Record<string, any>;
      for (const type of types as string[]) {
        const p = strong[type];
        const a = gpuRun(type, p, src, W, H);
        if (type === "vr-chromatic-aberrations") {
          // The aberration centre is a place on the sphere: a half turn of the picture equals moving the centre half a turn.
          const b = shiftCols(gpuRun(type, { ...p, pan: 0 }, shiftedCanvas, W, H), W, H, -W / 2);
          props.seamPsnr[type] = psnrOf(gpuRun(type, { ...p, pan: 180 }, src, W, H), b);
        } else {
          props.seamPsnr[type] = psnrOf(a, shiftCols(gpuRun(type, p, shiftedCanvas, W, H), W, H, -W / 2));
        }
        const polar = gpuRun(type, type === "vr-chromatic-aberrations" ? { ...p, tilt: 90 } : p, latCanvas, W, H);
        let spread = 0;
        for (const y of [0, 1, H - 2, H - 1]) {
          for (let c = 0; c < 3; c++) {
            let lo = 255;
            let hi = 0;
            for (let x = 0; x < W; x++) {
              const v = polar[(y * W + x) * 4 + c];
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
            spread = Math.max(spread, hi - lo);
          }
        }
        props.poleSpread[type] = spread;
        const st = gpuRun(type, { ...p, layout: "over-under", ...(type === "vr-glow" ? { threshold: 10 } : {}) }, stereoCanvas, W, H);
        let leak = 0;
        for (let i = 0; i < stereo.length; i += 4) for (let c = 0; c < 3; c++) leak = Math.max(leak, Math.abs(st[i + c] - stereo[i + c]));
        props.stereoLeak[type] = leak;
      }
      const g1 = gpuRun("vr-digital-glitch", strong["vr-digital-glitch"], src, W, H);
      const g2 = gpuRun("vr-digital-glitch", strong["vr-digital-glitch"], src, W, H);
      const g3 = gpuRun("vr-digital-glitch", { ...strong["vr-digital-glitch"], seed: 8 }, src, W, H);
      props.glitchDeterministic = g1.every((v, i) => v === g2[i]);
      props.glitchDiffersBySeed = psnrOf(g1, g3) < 30;
      return { rows: rows as Row[], props: props as Props };
    },
    { cases: CASES, types: PARITY_TYPES },
  );

  const lines = result.rows.map((r) => `${r.label.padEnd(38)} PSNR=${r.psnr.toFixed(1)}dB gpu4k=${r.gpuMs4k.toFixed(1)}ms cpu4k=${r.cpuMs4k.toFixed(0)}ms${r.changed ? "" : " (UNCHANGED)"}`);
  const p = result.props;
  const props = PARITY_TYPES.map((t) => `${t.padEnd(26)} seam PSNR=${p.seamPsnr[t].toFixed(1)}dB pole row spread=${p.poleSpread[t]} stereo leak=${p.stereoLeak[t]}`);
  console.log(`\n${lines.join("\n")}\n${props.join("\n")}\nglitch deterministic=${p.glitchDeterministic} differs by seed=${p.glitchDiffersBySeed}`);
  test.info().annotations.push({ type: "vr-image-parity", description: `${lines.join("\n")}\n${props.join("\n")}` });

  for (const r of result.rows) {
    expect(r.changed, `${r.label}: the effect left the picture unchanged`).toBe(true);
    expect(r.psnr, `${r.label}: GPU vs CPU PSNR`).toBeGreaterThan(36);
    if (!SOFTWARE_GPU) expect(r.gpuMs4k, `${r.label}: 4K GPU frame time`).toBeLessThan(80);
  }
  for (const type of PARITY_TYPES) {
    expect(p.seamPsnr[type], `${type}: the picture rotated half a turn gives the same result (GPU)`).toBeGreaterThan(40);
    expect(p.poleSpread[type], `${type}: a latitude-only picture stays constant along the pole rows (GPU)`).toBeLessThanOrEqual(3);
    expect(p.stereoLeak[type], `${type}: the eyes of a stereo frame do not mix (GPU)`).toBeLessThanOrEqual(2);
  }
  expect(p.glitchDeterministic, "the glitch is deterministic for a seed and time").toBe(true);
  expect(p.glitchDiffersBySeed, "another seed gives another glitch").toBe(true);
});
