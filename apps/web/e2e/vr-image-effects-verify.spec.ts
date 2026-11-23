import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { openEditor, openHookPage, seek, settle } from "./helpers";
import { H as VH, W as VW, ensureVrFixture, exportMp4, exportedFrames, importVrClip, psnr, removeAllClips, renderRgba, setSequence, workDir, type Hook } from "./vr-video-lib";

/**
 * Independent verification of the VR image effects in a real browser: different sizes (odd, so eye rectangles round),
 * different parameters, an arbitrary 37px longitude shift for the seam, side-by-side / over-under stereo with a dark eye,
 * and a glitch determinism check across repeated renders and across a "preview" vs "export" time path.
 */
const CASES: Array<{ label: string; type: string; params: Record<string, unknown>; w: number; h: number }> = [
  { label: "sharpen odd 333x167", type: "vr-sharpen", params: { amount: 63, radius: 0.9 }, w: 333, h: 167 },
  { label: "sharpen over/under odd", type: "vr-sharpen", params: { layout: "over-under", amount: 90, radius: 2.2 }, w: 333, h: 167 },
  { label: "glow max radius side-by-side odd", type: "vr-glow", params: { layout: "side-by-side", threshold: 25, radius: 12, brightness: 330, tintR: 200, tintG: 255, tintB: 90 }, w: 333, h: 167 },
  { label: "glow small", type: "vr-glow", params: { threshold: 55, radius: 1.2, brightness: 120 }, w: 401, h: 200 },
  { label: "chromatic pan -135 tilt -60", type: "vr-chromatic-aberrations", params: { amount: 90, pan: -135, tilt: -60 }, w: 333, h: 167 },
  { label: "chromatic pan 180 (seam antipode of 0)", type: "vr-chromatic-aberrations", params: { amount: 100, pan: 180, tilt: 0 }, w: 400, h: 200 },
  { label: "chromatic over/under odd", type: "vr-chromatic-aberrations", params: { layout: "over-under", amount: 70, pan: 33, tilt: 12 }, w: 333, h: 167 },
  { label: "glitch odd seed 9001 rate 24", type: "vr-digital-glitch", params: { intensity: 100, seed: 9001, time: 7.77, rate: 24 }, w: 333, h: 167 },
  { label: "glitch over/under odd", type: "vr-digital-glitch", params: { layout: "over-under", intensity: 55, seed: 17, time: 0.04, rate: 5 }, w: 333, h: 167 },
  { label: "glitch side-by-side", type: "vr-digital-glitch", params: { layout: "side-by-side", intensity: 35, seed: 2, time: 3.3, rate: 12 }, w: 333, h: 167 },
  { label: "denoise radius 2.9", type: "vr-de-noise", params: { amount: 100, radius: 2.9 }, w: 333, h: 167 },
  { label: "denoise stereo", type: "vr-de-noise", params: { layout: "side-by-side", amount: 30, radius: 0.7 }, w: 333, h: 167 },
];
const TYPES = ["vr-sharpen", "vr-glow", "vr-chromatic-aberrations", "vr-digital-glitch", "vr-de-noise"];

test("VR image effects: independent GPU vs CPU parity and 360 properties", async ({ page }) => {
  test.setTimeout(600_000);
  await openHookPage(page);
  const result = await page.evaluate(
    async ({ cases, types }) => {
      const { core } = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E;
      const fx = core.proEffects;
      const sh = core.proEffectShaders;
      const mr = core.motionShaderRenderer;
      const renderer = new mr.MotionShaderRenderer();
      const canvasOf = (rgba: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d", { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
        return c;
      };
      // Own picture: colour blobs and stripes with hash noise (not the builder's grid image).
      const picture = (w: number, h: number): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            const lon = (x / w) * 2 * Math.PI;
            const lat = (0.5 - y / h) * Math.PI;
            const n = ((Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 8) & 255) / 255;
            out[o] = 120 + 100 * Math.sin(3 * lon + 2 * lat) + (n - 0.5) * 30;
            out[o + 1] = 110 + 90 * Math.cos(2 * lon) * Math.cos(lat) + (n - 0.5) * 30;
            out[o + 2] = 100 + 120 * Math.sin(5 * lat) * (Math.floor(lon * 4) % 2 ? 1 : 0.4) + (n - 0.5) * 30;
            out[o + 3] = 255;
          }
        return out;
      };
      const gpuRun = (type: string, params: Record<string, unknown>, input: HTMLCanvasElement, w: number, h: number): Uint8ClampedArray => {
        const merged = { ...fx.PRO_EFFECT_DEFAULTS[type], ...params };
        const res = renderer.render(sh.PRO_EFFECT_SHADER_DEFS[type], { width: w, height: h, time: 0, params: fx.proEffectGpuUniforms(type, merged, h), inputCanvas: input, strict: true });
        if (!res) throw new Error(`${type}: shader failed`);
        const rc = document.createElement("canvas");
        rc.width = w;
        rc.height = h;
        const g = rc.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(res as unknown as HTMLCanvasElement, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const cpuRun = (type: string, params: Record<string, unknown>, rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(rgba);
        fx.applyProEffect(type, { ...fx.PRO_EFFECT_DEFAULTS[type], ...params }, out, w, h);
        return out;
      };
      const psnr = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
        let se = 0;
        let n = 0;
        for (let i = 0; i < a.length; i++) {
          if (i % 4 === 3) continue;
          se += (a[i] - b[i]) ** 2;
          n++;
        }
        return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
      };
      const maxd = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
        let m = 0;
        for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i]));
        return m;
      };
      const shiftCols = (src: ArrayLike<number>, w: number, h: number, dx: number): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(src.length);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const from = (((x - dx) % w) + w) % w;
            for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = src[(y * w + from) * 4 + c];
          }
        return out;
      };

      const rows: unknown[] = [];
      for (const c of cases as Array<{ label: string; type: string; params: Record<string, unknown>; w: number; h: number }>) {
        const pic = picture(c.w, c.h);
        const cpu = cpuRun(c.type, c.params, pic, c.w, c.h);
        const gpu = gpuRun(c.type, c.params, canvasOf(pic, c.w, c.h), c.w, c.h);
        rows.push({ label: c.label, psnr: psnr(cpu, gpu), maxd: maxd(cpu, gpu), changed: maxd(cpu, pic) > 0 });
      }

      // Seam, arbitrary 37px shift (GPU): shift the picture, effect, unshift == effect.
      const W = 333;
      const H = 167;
      const pic = picture(W, H);
      const seam: Record<string, number> = {};
      for (const t of types as string[]) {
        const p: Record<string, unknown> = { "vr-sharpen": { amount: 80, radius: 1.4 }, "vr-glow": { threshold: 35, radius: 5, brightness: 200 }, "vr-chromatic-aberrations": { amount: 90, pan: 20, tilt: 10 }, "vr-digital-glitch": { intensity: 70, seed: 5, time: 0.9, rate: 9 }, "vr-de-noise": { amount: 70, radius: 1.6 } }[t] as Record<string, unknown>;
        const dx = 37;
        const a = gpuRun(t, p, canvasOf(pic, W, H), W, H);
        const sp = t === "vr-chromatic-aberrations" ? { ...p, pan: (p.pan as number) + (dx / W) * 360 } : p;
        const b = shiftCols(gpuRun(t, sp, canvasOf(shiftCols(pic, W, H, dx), W, H), W, H), W, H, -dx);
        seam[t] = psnr(a, b);
      }

      // Stereo isolation on GPU: dark eye (bottom for over/under, right for side by side) must stay exactly black.
      const leak: Record<string, number> = {};
      for (const layout of ["over-under", "side-by-side"]) {
        const img = picture(W, H);
        const x0 = layout === "side-by-side" ? Math.floor(W / 2) : 0;
        const y0 = layout === "over-under" ? Math.floor(H / 2) : 0;
        for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) img.set([0, 0, 0, 255], (y * W + x) * 4);
        for (const t of types as string[]) {
          const p: Record<string, unknown> = { layout, ...(t === "vr-glow" ? { threshold: 0, radius: 12, brightness: 400 } : t === "vr-sharpen" ? { amount: 100, radius: 3 } : t === "vr-chromatic-aberrations" ? { amount: 100, pan: 0, tilt: 0 } : t === "vr-digital-glitch" ? { intensity: 100, seed: 3, time: 1, rate: 12 } : { amount: 100, radius: 3 }) };
          const out = gpuRun(t, p, canvasOf(img, W, H), W, H);
          let m = 0;
          for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) for (let c = 0; c < 3; c++) m = Math.max(m, out[(y * W + x) * 4 + c]);
          leak[`${t}/${layout}`] = m;
        }
      }

      // Glitch determinism: repeated renders, and "preview" (withProEffectTime at clip time) vs "export" (same call, other instance).
      const g = (time: number): Uint8ClampedArray => {
        const eff = [{ type: "vr-digital-glitch", params: { ...fx.PRO_EFFECT_DEFAULTS["vr-digital-glitch"], intensity: 80, seed: 12, rate: 12, time: 0 } }];
        const timed = fx.withProEffectTime(eff, time)[0];
        return gpuRun("vr-digital-glitch", timed.params, canvasOf(pic, W, H), W, H);
      };
      const g1 = g(2.5 + 1 / 30);
      const g2 = g(2.5 + 1 / 30);
      const gCpu = (() => {
        const eff = [{ type: "vr-digital-glitch", params: { ...fx.PRO_EFFECT_DEFAULTS["vr-digital-glitch"], intensity: 80, seed: 12, rate: 12, time: 0 } }];
        const timed = fx.withProEffectTime(eff, 2.5 + 1 / 30)[0];
        return cpuRun("vr-digital-glitch", timed.params, pic, W, H);
      })();
      return { rows, seam, leak, glitchSame: maxd(g1, g2), glitchGpuCpu: maxd(g1, gCpu), glitchNext: maxd(g(2.5 + 1 / 30), g(2.5 + 1 / 30 + 1 / 12)) };
    },
    { cases: CASES, types: TYPES },
  );
  console.log(JSON.stringify(result, null, 1));
  for (const r of result.rows as Array<{ label: string; psnr: number; changed: boolean }>) {
    expect(r.changed, r.label).toBe(true);
    expect(r.psnr, r.label).toBeGreaterThan(40);
  }
  for (const [k, v] of Object.entries(result.seam)) expect(v, `seam ${k}`).toBeGreaterThan(40);
  for (const [k, v] of Object.entries(result.leak)) expect(v, `leak ${k}`).toBeLessThanOrEqual(1);
  expect(result.glitchSame).toBe(0);
  expect(result.glitchGpuCpu).toBeLessThanOrEqual(2);
  expect(result.glitchNext).toBeGreaterThan(0);
});


/** Real export vs engine with ONLY the glitch: if the export used a different clip time than the preview, the PSNR to the right frame would be much lower than to the others. */
test("VR digital glitch: exported frames equal the engine at their own export time (not neighbours)", async ({ page }) => {
  test.setTimeout(420_000);
  await ensureVrFixture();
  await openEditor(page);
  await removeAllClips(page);
  await setSequence(page, { width: VW, height: VH, vr: { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 } });
  const clipId = await importVrClip(page);
  await seek(page, 0.2);
  await settle(page, 600);
  await page.evaluate(async (id) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    await h.project.getState().addVideoEffect(id, "vr-digital-glitch", { intensity: 70, seed: 21, rate: 24, layout: "mono" });
  }, clipId);
  await settle(page, 600);
  const effs = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).flatMap((c: any) => (c.effects ?? []).map((e: any) => e.type)));
  expect(effs).toContain("vr-digital-glitch");
  const file = join(workDir, "glitch-verify.mp4");
  await exportMp4(page, file, { width: VW, height: VH, frameRate: 30, format: "mp4", codec: "h264", bitrate: 12000 }, 1);
  const frames = exportedFrames(file, VW, VH);
  const out: string[] = [];
  let worstMargin = Infinity;
  const luma = (a: ArrayLike<number>): number[] => { const o: number[] = []; for (let i = 0; i < a.length; i += 4) { const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; o.push(y, y, y, 255); } return o; };
  for (const k of [4, 22]) {
    const eng = await renderRgba(page, k / 30, true, VW, VH);
    const own = psnr(frames[k], eng);
    const lumaOwn = psnr(luma(frames[k]), luma(eng));
    let bestOther = 0;
    for (const dk of [-2, 2]) {
      if (k + dk < 0) continue;
      bestOther = Math.max(bestOther, psnr(frames[k], await renderRgba(page, (k + dk) / 30, true, VW, VH)));
    }
    const flat = psnr(frames[k], await renderRgba(page, k / 30, true, VW, VH, true));
    out.push(`frame ${k}: vs no-effect engine ${flat.toFixed(1)} dB; own ${own.toFixed(1)} dB (luma-only ${lumaOwn.toFixed(1)} dB), best other-time ${bestOther.toFixed(1)} dB`);
    worstMargin = Math.min(worstMargin, own - bestOther);
  }
  console.log(out.join("\n"));
  expect(worstMargin).toBeGreaterThanOrEqual(-0.01);
});
