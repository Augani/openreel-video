import { expect, test, type Page } from "@playwright/test";
import { openEditor, openHookPage } from "./helpers";

/**
 * WebGPU grade chain (gpu project): the WGSL passes against the Canvas2D / WebGL / CPU reference, in a real browser.
 *
 *   1. Per stage: a synthetic test card goes through VideoEngine.processClipBitmap with the chain off (the existing
 *      path, the reference) and on (WGSL); the two results must agree within a tolerance. The chain must actually have
 *      run (its frame counter moves), so a silent fallback cannot pass for parity.
 *   2. The chain performs no readback: it hands the frame back as a GPU-backed bitmap and reports zero readbacks.
 *   3. Preview == export: rendering a graded clip through renderFrame in preview mode and in export mode is byte
 *      identical with the chain on.
 *   4. CPU time per frame at 1080p, chain on vs off.
 */
/** The production grade and readback paths run on hardware adapters. Other editor suites exercise the reference path. */
async function requireHardwareGrade(page: Page) {
  const software = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return false;
    return adapter.info?.isFallbackAdapter || adapter.info?.architecture === "swiftshader"
      || ("isFallbackAdapter" in adapter && adapter.isFallbackAdapter === true);
  });
  test.skip(Boolean(software), "Software WebGPU adapters use the reference grade and readback paths");
}

interface ChainHook {
  video: { getVideoEngine(): Engine };
  core: { proEffects: { PRO_EFFECT_DEFAULTS: Record<string, Record<string, unknown>> }; colorGradingEngine: Record<string, any> };
  project: { getState(): { project: any } };
}
interface Engine {
  exportMode: boolean;
  clearCache(): void;
  setGpuGradeEnabled(on: boolean): void;
  isGpuGradeEnabled(): boolean;
  getGpuGradeStats(): { frames: number; fallbacks: number; readbacks: number } | null;
  processClipBitmap(image: ImageBitmap, effects: unknown[], grading?: unknown): Promise<ImageBitmap>;
  renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }>;
}

interface Row {
  name: string;
  gpuRan: boolean;
  mad: number;
  p99: number;
  max: number;
  /** Share of channel samples that differ by more than 8 levels. */
  big: number;
}

test("WGSL grade chain matches the existing grade and effect paths stage by stage", async ({ page }) => {
  test.setTimeout(300_000);
  await openHookPage(page);
  await requireHardwareGrade(page);
  const result = await page.evaluate(async () => {
    const hook = (window as unknown as { __openreelE2E: ChainHook }).__openreelE2E;
    const engine = hook.video.getVideoEngine();
    const cg = hook.core.colorGradingEngine;
    const defaults = hook.core.proEffects.PRO_EFFECT_DEFAULTS;
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) return { skipped: "no WebGPU adapter" };

    const W = 320;
    const H = 180;
    const card = (): OffscreenCanvas => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#ff3b30");
      grad.addColorStop(0.35, "#34c759");
      grad.addColorStop(0.7, "#0a84ff");
      grad.addColorStop(1, "#ffd60a");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#101010";
      g.fillRect(W * 0.1, H * 0.12, W * 0.28, H * 0.4);
      g.fillStyle = "#f5f5f5";
      g.beginPath();
      g.arc(W * 0.68, H * 0.5, H * 0.28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#c8a08c";
      g.fillRect(W * 0.45, H * 0.62, W * 0.3, H * 0.25);
      // a smooth ramp so deband / dehaze have something to chew on
      const ramp = g.createLinearGradient(0, 0, W, 0);
      ramp.addColorStop(0, "#202830");
      ramp.addColorStop(1, "#8090a0");
      g.fillStyle = ramp;
      g.fillRect(0, H * 0.9, W, H * 0.1);
      return c;
    };
    const source = await createImageBitmap(card());

    const wheels = (o: Record<string, unknown> = {}) => ({
      ...cg.DEFAULT_COLOR_WHEELS,
      shadows: { r: 0.04, g: -0.02, b: 0.06 },
      midtones: { r: -0.03, g: 0.02, b: 0.01 },
      highlights: { r: 0.05, g: 0.02, b: -0.04 },
      shadowsLift: 0.03,
      midtonesGamma: 1.15,
      highlightsGain: 1.1,
      ...o,
    });
    const tone = { exposure: 0.2, contrast: 0.25, highlights: -0.3, shadows: 0.35, whites: 0.1, blacks: -0.1 };
    const curves = {
      rgb: [{ x: 0, y: 0 }, { x: 0.3, y: 0.22 }, { x: 0.7, y: 0.8 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0.04 }, { x: 1, y: 0.96 }],
      green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0 }, { x: 0.5, y: 0.58 }, { x: 1, y: 1 }],
    };
    const hsl = {
      hue: [10, -20, 5, 0, 30, -10, 15, 0],
      saturation: [0.1, -0.2, 0.05, 0, 0.15, -0.1, 0, 0.1],
      luminance: [0.02, 0, -0.05, 0.03, 0, 0.04, -0.02, 0],
    };
    const hueCurves = {
      hueVsSat: [{ x: 0, y: 0.5 }, { x: 0.33, y: 0.7 }, { x: 0.66, y: 0.4 }, { x: 1, y: 0.5 }],
      hueVsHue: [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.6 }, { x: 1, y: 0.5 }],
      hueVsLuma: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
      lumaVsSat: [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.65 }, { x: 1, y: 0.5 }],
    };
    const vignette = { amount: -0.5, midpoint: 0.4, roundness: 0.2, feather: 0.5 };
    const lut3 = (() => {
      const N = 9;
      const data: number[] = [];
      const floats: number[] = [];
      for (let b = 0; b < N; b++)
        for (let g = 0; g < N; g++)
          for (let r = 0; r < N; r++) {
            const R = r / (N - 1);
            const G = g / (N - 1);
            const B = b / (N - 1);
            const o = [Math.min(1, Math.pow(R, 0.9) * 1.05), Math.pow(G, 0.95), Math.min(1, Math.pow(B, 1.1) + 0.04 * (1 - R))];
            floats.push(...o);
            data.push(...o.map((v) => Math.round(v * 255)));
          }
      return { data, floatData: floats, size: N, intensity: 0.8 };
    })();
    const lut1 = (() => {
      const n = 64;
      const d: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        d.push(Math.pow(x, 0.8), Math.pow(x, 1.0), Math.pow(x, 1.2));
      }
      return { data: [], size: 2, intensity: 0.9, curve1d: { size: n, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: d } };
    })();
    const fx = (type: string, o: Record<string, unknown> = {}) => ({ id: `fx-${type}`, type, enabled: true, params: { ...defaults[type], ...o } });

    // Limits are mean / p99 / max absolute difference in 0..255 levels. Everything not hue-banded matches within 1 level
    // (rounding at exact .5 ties). The 8-band HSL stage (and the stacks that contain it) picks a band with
    // floor(hue * 8); a pixel whose hue is exactly a band edge sits on a 1-ulp rounding difference between the
    // reference's float64 and the shader's float32, lands in the neighbouring band and differs by up to a band's
    // correction. `big` bounds how many samples may do that.
    const scenarios: Array<{ name: string; effects?: unknown[]; grading?: unknown; mad: number; p99: number; max: number; big?: number }> = [
      { name: "tone v1", grading: { tone }, mad: 0.5, p99: 2, max: 4 },
      { name: "vignette v1", grading: { vignette }, mad: 0.5, p99: 2, max: 4 },
      { name: "curves", grading: { curves }, mad: 0.5, p99: 2, max: 4 },
      { name: "hsl bands", grading: { hsl }, mad: 0.8, p99: 4, max: 60, big: 0.002 },
      { name: "wheels v1", grading: { colorWheels: wheels() }, mad: 0.5, p99: 2, max: 4 },
      { name: "white balance", grading: { temperature: 30, tint: -20 }, mad: 0.5, p99: 2, max: 4 },
      { name: "lut 3d", grading: { lut: lut3 }, mad: 0.5, p99: 2, max: 4 },
      { name: "lut 1d curve", grading: { lut: lut1 }, mad: 0.5, p99: 2, max: 4 },
      { name: "input lut", grading: { inputLut: lut3 }, mad: 0.5, p99: 2, max: 4 },
      { name: "premiere order (tone+wheels+hue curves)", grading: { pipelineVersion: 2, tone, colorWheels: wheels(), hueCurves, temperature: 15, vignette }, mad: 0.8, p99: 3, max: 30 },
      { name: "legacy full stack", grading: { tone, colorWheels: wheels(), curves, lut: lut3, hsl, vignette, temperature: -10, tint: 8 }, mad: 1.2, p99: 5, max: 60, big: 0.002 },
      { name: "hsl secondary", effects: [fx("hsl-secondary", { hueMin: 0, hueMax: 80, saturation: -60, temperature: 25, contrast: 20, blur: 3 })], mad: 0.6, p99: 3, max: 12 },
      { name: "lumetri creative", effects: [fx("lumetri-creative", { fadedFilm: 35, sharpen: 50, vibrance: 60, shadowTintHue: 210, shadowTintAmount: 60, highlightTintHue: 35, highlightTintAmount: 50 })], mad: 0.6, p99: 3, max: 12 },
      { name: "lens correction", effects: [fx("lens-correction", { profile: "gopro-wide", strength: 100, caRed: 40, caBlue: -40, vignette: 30 })], mad: 0.8, p99: 4, max: 24 },
      { name: "dehaze", effects: [fx("dehaze", { amount: 60 })], mad: 0.6, p99: 3, max: 12 },
      { name: "dehaze (add haze)", effects: [fx("dehaze", { amount: -50 })], mad: 0.5, p99: 2, max: 6 },
      { name: "deband", effects: [fx("deband", { threshold: 8, radius: 16, iterations: 3, dither: 40 })], mad: 0.6, p99: 3, max: 12 },
      { name: "deflicker gains", effects: [fx("deflicker", { gainR: 1.08, gainG: 0.95, gainB: 1.02 })], mad: 0.5, p99: 2, max: 4 },
      {
        name: "effects + grade chain",
        effects: [fx("dehaze", { amount: 30 }), fx("lumetri-creative", { fadedFilm: 20, vibrance: 40, sharpen: 25 }), fx("deband", { threshold: 6, dither: 20 })],
        grading: { tone, colorWheels: wheels(), curves, lut: lut3, hsl, vignette, temperature: 10 },
        mad: 1.2,
        p99: 5,
        max: 130,
        big: 0.005,
      },
    ];

    const read = (b: ImageBitmap): Uint8ClampedArray => {
      const c = new OffscreenCanvas(b.width, b.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(b, 0, 0);
      return g.getImageData(0, 0, b.width, b.height).data;
    };
    const rows: Row[] = [];
    for (const s of scenarios) {
      engine.setGpuGradeEnabled(false);
      const refBitmap = await engine.processClipBitmap(source, s.effects ?? [], s.grading);
      const ref = read(refBitmap);
      if (refBitmap !== source) refBitmap.close();
      engine.setGpuGradeEnabled(true);
      const before = engine.getGpuGradeStats()?.frames ?? 0;
      const gpuBitmap = await engine.processClipBitmap(source, s.effects ?? [], s.grading);
      const after = engine.getGpuGradeStats()?.frames ?? 0;
      const gpu = read(gpuBitmap);
      if (gpuBitmap !== source) gpuBitmap.close();
      const diffs: number[] = [];
      let sum = 0;
      let max = 0;
      let big = 0;
      for (let i = 0; i < ref.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(ref[i + c] - gpu[i + c]);
          diffs.push(d);
          sum += d;
          if (d > max) max = d;
          if (d > 8) big++;
        }
      }
      diffs.sort((a, b) => a - b);
      rows.push({ name: s.name, gpuRan: after > before, mad: sum / diffs.length, p99: diffs[Math.floor(diffs.length * 0.99)], max, big: big / diffs.length });
    }
    return { rows, limits: scenarios.map((s) => ({ mad: s.mad, p99: s.p99, max: s.max, big: s.big ?? 0 })), readbacks: engine.getGpuGradeStats()?.readbacks ?? -1 };
  });

  if ("skipped" in result) {
    test.skip(true, String(result.skipped));
    return;
  }
  console.log(`[gpu-grade-chain] ${JSON.stringify(result.rows.map((r) => ({ ...r, mad: +r.mad.toFixed(3) })))}`);
  result.rows.forEach((row, i) => {
    const limit = result.limits[i];
    expect(row.gpuRan, `${row.name}: the WebGPU chain rendered it`).toBe(true);
    expect(row.mad, `${row.name}: mean abs difference`).toBeLessThanOrEqual(limit.mad);
    expect(row.p99, `${row.name}: p99 difference`).toBeLessThanOrEqual(limit.p99);
    expect(row.max, `${row.name}: max difference`).toBeLessThanOrEqual(limit.max);
    expect(row.big, `${row.name}: share of samples off by more than 8`).toBeLessThanOrEqual(limit.big);
  });
  expect(result.readbacks, "the chain never reads pixels back").toBe(0);
});

test("a graded clip renders the identical frame in preview and export with the WebGPU chain", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await requireHardwareGrade(page);
  const result = await page.evaluate(async () => {
    const hook = (window as unknown as { __openreelE2E: ChainHook }).__openreelE2E;
    const engine = hook.video.getVideoEngine();
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) return { skipped: "no WebGPU adapter" };
    const cg = hook.core.colorGradingEngine;
    const project = hook.project.getState().project;
    const W = 320;
    const H = 180;
    const grading = {
      colorWheels: { ...cg.DEFAULT_COLOR_WHEELS, midtonesGamma: 1.2, highlightsGain: 1.1, shadows: { r: 0.03, g: 0, b: 0.05 } },
      tone: { exposure: 0.1, contrast: 0.3, highlights: -0.2, shadows: 0.2, whites: 0, blacks: 0 },
      hsl: { hue: [8, 0, 0, 0, 0, 0, 0, 0], saturation: [0.1, 0, 0, 0, 0, 0, 0, 0.1], luminance: [0, 0, 0, 0, 0, 0, 0, 0] },
      vignette: { amount: -0.4, midpoint: 0.5, roundness: 0, feather: 0.5 },
      temperature: 12,
    };
    const graded = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track: any) => ({
          ...track,
          clips: track.clips.map((clip: any) => ({
            ...clip,
            keyframes: [],
            colorGrading: grading,
            effects: [{ id: "e2e-creative", type: "lumetri-creative", enabled: true, params: { fadedFilm: 20, vibrance: 40, sharpen: 30 } }],
          })),
        })),
      },
    };
    const pixels = async (exportMode: boolean, t: number): Promise<Uint8ClampedArray> => {
      engine.exportMode = exportMode;
      engine.clearCache();
      const frame = await engine.renderFrame(graded, t, W, H);
      engine.exportMode = false;
      const c = new OffscreenCanvas(frame.image.width, frame.image.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(frame.image, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };
    engine.setGpuGradeEnabled(true);
    const before = engine.getGpuGradeStats()?.frames ?? 0;
    const preview = await pixels(false, 1);
    const exported = await pixels(true, 1);
    const ran = (engine.getGpuGradeStats()?.frames ?? 0) - before;
    engine.setGpuGradeEnabled(false);
    const reference = await pixels(false, 1);
    engine.setGpuGradeEnabled(true);
    return { previewVsExport: diff(preview, exported), chainFrames: ran, vsCanvas2d: diff(preview, reference) };
  });
  if ("skipped" in result) {
    test.skip(true, String(result.skipped));
    return;
  }
  console.log(`[gpu-grade-chain] preview/export ${JSON.stringify(result)}`);
  expect(result.chainFrames, "the WebGPU chain rendered the graded clip").toBeGreaterThan(0);
  expect(result.previewVsExport, "preview == export").toBe(0);
  expect(result.vsCanvas2d, "chain vs Canvas2D grade of the same frame").toBeLessThanOrEqual(45);
});

test("the grade chain costs less CPU per frame than the Canvas2D grade at 1080p", async ({ page }) => {
  test.setTimeout(300_000);
  await openHookPage(page);
  await requireHardwareGrade(page);
  const result = await page.evaluate(async () => {
    const hook = (window as unknown as { __openreelE2E: ChainHook }).__openreelE2E;
    const engine = hook.video.getVideoEngine();
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) return { skipped: "no WebGPU adapter" };
    const cg = hook.core.colorGradingEngine;
    const c = new OffscreenCanvas(1920, 1080);
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 1920, 1080);
    grad.addColorStop(0, "#ff3b30");
    grad.addColorStop(0.5, "#0a84ff");
    grad.addColorStop(1, "#ffd60a");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1920, 1080);
    const source = await createImageBitmap(c);
    const grading = {
      colorWheels: { ...cg.DEFAULT_COLOR_WHEELS, midtonesGamma: 1.2, highlightsGain: 1.1 },
      tone: { exposure: 0.1, contrast: 0.3, highlights: -0.2, shadows: 0.2, whites: 0, blacks: 0 },
      curves: { rgb: [{ x: 0, y: 0 }, { x: 0.3, y: 0.22 }, { x: 1, y: 1 }], red: [{ x: 0, y: 0 }, { x: 1, y: 1 }], green: [{ x: 0, y: 0 }, { x: 1, y: 1 }], blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      hsl: { hue: [8, 0, 0, 0, 0, 0, 0, 0], saturation: [0.1, 0, 0, 0, 0, 0, 0, 0.1], luminance: [0, 0, 0, 0, 0, 0, 0, 0] },
      vignette: { amount: -0.4, midpoint: 0.5, roundness: 0, feather: 0.5 },
    };
    const time = async (on: boolean, frames: number): Promise<{ meanMs: number; p95Ms: number }> => {
      engine.setGpuGradeEnabled(on);
      const samples: number[] = [];
      for (let i = 0; i < frames + 3; i++) {
        const t0 = performance.now();
        const out = await engine.processClipBitmap(source, [], grading);
        const dt = performance.now() - t0;
        if (out !== source) out.close();
        if (i >= 3) samples.push(dt);
      }
      samples.sort((a, b) => a - b);
      return { meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: samples[Math.floor(samples.length * 0.95)] };
    };
    const canvas2d = await time(false, 20);
    const chain = await time(true, 20);
    return { canvas2d, chain, stats: engine.getGpuGradeStats() };
  });
  if ("skipped" in result) {
    test.skip(true, String(result.skipped));
    return;
  }
  console.log(`[gpu-grade-chain] 1080p grade ${JSON.stringify(result)}`);
  expect(result.stats?.frames ?? 0).toBeGreaterThan(0);
  expect(result.stats?.readbacks ?? -1).toBe(0);
  expect(result.chain.meanMs).toBeLessThan(result.canvas2d.meanMs);
});

test("the pipelined GPU readback returns the exact bytes of the CPU readback, and costs the render thread less", async ({ page }) => {
  test.setTimeout(300_000);
  await openHookPage(page);
  await requireHardwareGrade(page);
  const result = await page.evaluate(async () => {
    const hook = (window as unknown as { __openreelE2E: { video: { getVideoEngine(): Engine }; core: { colorGradingEngine: Record<string, any>; gpuFrameReadback: { GpuFrameReader: { create(w: number, h: number, depth?: number): Promise<Reader | null> } } } } }).__openreelE2E;
    interface Reader {
      begin(image: ImageBitmap): Promise<{ bytes: Promise<ArrayBuffer>; recycle(b: ArrayBuffer): void }>;
      dispose(): void;
      stats: { frames: number; maxInFlight: number };
    }
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) return { skipped: "no WebGPU adapter" };
    const engine = hook.video.getVideoEngine();
    const cg = hook.core.colorGradingEngine;
    const cpu = (bitmap: ImageBitmap): Uint8ClampedArray => {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const frameOf = async (w: number, h: number, seed: number): Promise<ImageBitmap> => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d")!;
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${seed * 40}, 90%, 50%)`);
      grad.addColorStop(1, `hsl(${seed * 40 + 140}, 80%, 40%)`);
      g.fillStyle = grad;
      g.fillRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      g.fillStyle = "rgba(255,255,255,0.37)";
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, h * 0.3, 0, Math.PI * 2);
      g.fill();
      return createImageBitmap(c);
    };
    const mismatches: Record<string, number> = {};
    // 1280 wide rows are 256-aligned, 1366 and 30 wide are not (the reader must drop the row padding).
    for (const [w, h] of [[1280, 720], [1366, 768], [30, 17]] as const) {
      const reader = await hook.core.gpuFrameReadback.GpuFrameReader.create(w, h, 3);
      if (!reader) return { skipped: `no reader at ${w}x${h}` };
      let bad = 0;
      for (let i = 0; i < 5; i++) {
        const frame = await frameOf(w, h, i);
        const expected = cpu(frame);
        const ticket = await reader.begin(frame);
        const got = new Uint8ClampedArray(await ticket.bytes);
        if (got.length !== expected.length) bad += expected.length;
        else for (let k = 0; k < got.length; k++) if (got[k] !== expected[k]) bad++;
        ticket.recycle(got.buffer);
      }
      mismatches[`${w}x${h}`] = bad;
      reader.dispose();
    }
    // A frame the engine rendered (grade chain on): the bitmap the export hands to the encoder.
    engine.setGpuGradeEnabled(true);
    const W = 1920;
    const H = 1080;
    const source = await frameOf(W, H, 3);
    const graded = await engine.processClipBitmap(source, [], {
      colorWheels: { ...cg.DEFAULT_COLOR_WHEELS, midtonesGamma: 1.2, highlightsGain: 1.1 },
      tone: { exposure: 0.1, contrast: 0.3, highlights: -0.2, shadows: 0.2, whites: 0, blacks: 0 },
    });
    const reader = (await hook.core.gpuFrameReadback.GpuFrameReader.create(W, H, 4))!;
    const expected = cpu(graded);
    const gradedTicket = await reader.begin(graded);
    const got = new Uint8ClampedArray(await gradedTicket.bytes);
    let gradedBad = 0;
    for (let k = 0; k < got.length; k++) if (got[k] !== expected[k]) gradedBad++;
    gradedTicket.recycle(got.buffer);
    // Render-thread time per frame at 1080p: synchronous getImageData against begin + awaiting the pipelined ticket.
    const frames = await Promise.all([0, 1, 2, 3].map((i) => frameOf(W, H, i + 5)));
    const run = async (useGpu: boolean, n: number): Promise<number> => {
      const t0 = performance.now();
      const queue: Array<Promise<ArrayBuffer>> = [];
      for (let i = 0; i < n; i++) {
        const frame = frames[i % frames.length];
        if (useGpu) {
          const ticket = await reader.begin(frame);
          queue.push(ticket.bytes);
          if (queue.length >= 3) await queue.shift();
        } else {
          cpu(frame);
        }
      }
      await Promise.all(queue);
      return (performance.now() - t0) / n;
    };
    await run(false, 4);
    await run(true, 4);
    const cpuMs = await run(false, 30);
    const gpuMs = await run(true, 30);
    reader.dispose();
    return { mismatches, gradedBad, cpuMs, gpuMs };
  });
  if ("skipped" in result) {
    test.skip(true, String(result.skipped));
    return;
  }
  console.log(`[gpu-readback] ${JSON.stringify(result)}`);
  for (const [size, bad] of Object.entries(result.mismatches)) expect(bad, `GPU readback == getImageData at ${size}`).toBe(0);
  expect(result.gradedBad, "GPU readback == getImageData of a chain-graded frame").toBe(0);
  expect(result.gpuMs, "pipelined GPU readback per frame").toBeLessThan(result.cpuMs);
});

test("the GPU I420 conversion matches the CPU reference within one code value", async ({ page }) => {
  test.setTimeout(300_000);
  await openHookPage(page);
  await requireHardwareGrade(page);
  const result = await page.evaluate(async () => {
    interface Reader {
      begin(image: ImageBitmap): Promise<{ bytes: Promise<ArrayBuffer>; recycle(b: ArrayBuffer): void }>;
      dispose(): void;
    }
    const hook = (window as unknown as {
      __openreelE2E: {
        core: {
          gpuFrameReadback: { GpuFrameReader: { create(w: number, h: number, depth: number, format: "rgba" | "i420"): Promise<Reader | null> } };
          yuv420Sdr: { rgbaToI420Bt709(rgba: Uint8ClampedArray, w: number, h: number): ArrayBuffer };
        };
      };
    }).__openreelE2E;
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) return { skipped: "no WebGPU adapter" };
    const rows: Record<string, { maxDiff: number; share: number; bytes: number }> = {};
    for (const [w, h] of [[1280, 720], [1366, 768], [30, 18], [1920, 1080]] as const) {
      const reader = await hook.core.gpuFrameReadback.GpuFrameReader.create(w, h, 3, "i420");
      if (!reader) return { skipped: `no i420 reader at ${w}x${h}` };
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      // Hard colour edges, a ramp, noise and saturated primaries: every chroma / luma path.
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#ff2010");
      grad.addColorStop(0.5, "#10ff40");
      grad.addColorStop(1, "#2030ff");
      g.fillStyle = grad;
      g.fillRect(0, 0, w * 0.8, h * 0.8);
      g.fillStyle = "#c8a08c";
      g.fillRect(w * 0.6, h * 0.2, w * 0.3, h * 0.7);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgb(${(i * 37) % 256},${(i * 91) % 256},${(i * 53) % 256})`;
        g.fillRect((i * 17) % w, (i * 29) % h, 1 + (i % 3), 1 + (i % 2));
      }
      const bitmap = await createImageBitmap(c);
      const expected = new Uint8Array(hook.core.yuv420Sdr.rgbaToI420Bt709(g.getImageData(0, 0, w, h).data, w, h));
      const ticket = await reader.begin(bitmap);
      const got = new Uint8Array(await ticket.bytes);
      let maxDiff = got.length === expected.length ? 0 : 255;
      let diff = 0;
      for (let i = 0; i < Math.min(got.length, expected.length); i++) {
        const d = Math.abs(got[i] - expected[i]);
        if (d > 0) diff++;
        if (d > maxDiff) maxDiff = d;
      }
      rows[`${w}x${h}`] = { maxDiff, share: diff / expected.length, bytes: got.length };
      reader.dispose();
    }
    return { rows };
  });
  if ("skipped" in result) {
    test.skip(true, String(result.skipped));
    return;
  }
  console.log(`[gpu-i420] ${JSON.stringify(result.rows)}`);
  for (const [size, row] of Object.entries(result.rows)) {
    const [w, h] = size.split("x").map(Number);
    expect(row.bytes, `I420 frame size at ${size}`).toBe(w * h * 1.5);
    expect(row.maxDiff, `GPU vs CPU I420 at ${size}`).toBeLessThanOrEqual(1);
    expect(row.share, `share of samples that differ at ${size}`).toBeLessThan(0.02);
  }
});
