import { expect, test, type Page } from "@playwright/test";
import { SOFTWARE_GPU } from "./env";
import { openEditor, seek, settle } from "./helpers";

/**
 * Scene-referred HDR working mode, browser half: the WebGL2 half-float (RGBA16F) compositor must agree with the
 * Float32 CPU reference (color/hdr-working.ts) on a composite of a 16-bit PQ layer (transform, crop, opacity and a
 * full Lumetri grade) plus an 8-bit overlay, and its cost is measured against the 8-bit grading pass.
 *
 * Runs in the "gpu" project only (hardware WebGL2 with EXT_color_buffer_float).
 */

interface HdrCore {
  hdrWorking: Record<string, any>;
  hdrGpu: Record<string, any>;
  colorOutput: Record<string, any>;
  colorGradingEngine: { ColorGradingEngine: new (w: number, h: number) => any };
}

async function openHook(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __openreelE2E?: unknown }).__openreelE2E, undefined, { timeout: 60_000 });
}

test("half-float GPU compositor matches the float CPU reference (composite, grade, PQ encode, SDR view)", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openHook(page);
  const result = await page.evaluate(async () => {
    const core = (window as unknown as { __openreelE2E: { core: HdrCore } }).__openreelE2E.core;
    const hw = core.hdrWorking;
    if (!core.hdrGpu.isGpuHdrAvailable()) return { skipped: "no WebGL2 with EXT_color_buffer_float" };

    const W = 256;
    const H = 144;
    const SW = 200;
    const SH = 120;
    const pq = core.colorOutput.pqEncodeNits as (n: number) => number;
    // 16-bit PQ layer: luma ramps 20..1500 nits left to right, hue varies top to bottom.
    const codes = new Uint16Array(SW * SH * 4);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const nits = 20 + (1480 * x) / (SW - 1);
        const base = nits;
        const r = pq(base * (0.6 + 0.4 * (y / (SH - 1))));
        const g = pq(base * 0.8);
        const b = pq(base * (1 - 0.5 * (y / (SH - 1))));
        const o = (y * SW + x) * 4;
        codes[o] = Math.round(r * 65535);
        codes[o + 1] = Math.round(g * 65535);
        codes[o + 2] = Math.round(b * 65535);
        codes[o + 3] = 65535;
      }
    }
    // 8-bit overlay with a translucent box and a solid white bar (graphics).
    const overlayCanvas = new OffscreenCanvas(W, H);
    const octx = overlayCanvas.getContext("2d")!;
    octx.fillStyle = "rgba(20,120,220,0.5)";
    octx.fillRect(30, 20, 120, 60);
    octx.fillStyle = "#ffffff";
    octx.fillRect(10, 110, 200, 10);

    const decode = hw.hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false });
    const transform = {
      position: { x: 10, y: -5 },
      scale: { x: 0.8, y: 0.8 },
      rotation: 15,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      fitMode: "contain",
      crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    };
    const geometry = hw.computeLayerGeometry(transform, SW, SH, W, H);
    const grade = hw.prepareHdrGrade({
      temperature: 20,
      tint: -8,
      tone: { exposure: 0.25, contrast: 0.2, highlights: -0.3, shadows: 0.2, whites: 0.1, blacks: -0.1 },
      colorWheels: {
        shadows: { r: 0.02, g: 0, b: 0.05 },
        midtones: { r: 0, g: 0.02, b: 0 },
        highlights: { r: 0.03, g: 0, b: -0.02 },
        shadowsLift: 0.01,
        midtonesGamma: 1.1,
        highlightsGain: 1.05,
      },
      curves: {
        rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }],
        red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        blue: [{ x: 0, y: 0 }, { x: 0.4, y: 0.45 }, { x: 1, y: 1 }],
      },
      hueCurves: {
        hueVsSat: [{ x: 0, y: 0.5 }, { x: 0.1, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }],
        hueVsHue: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
        hueVsLuma: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
        lumaVsSat: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
      },
    });
    if (!grade) return { error: "grade was neutral" };

    const spec = core.colorOutput.resolveOutputColorSpec("rec2020", "pq");
    const render = (comp: any) => {
      comp.begin(W, H);
      comp.drawCodes({ depth: 16, width: SW, height: SH, data: codes }, decode, { geometry, opacity: 0.85, grade });
      comp.drawOverlay(overlayCanvas);
      return {
        frame: comp.readFrame(),
        enc: comp.readEncodedRgb(spec),
        view: comp.readSdrView(),
      };
    };

    const cpu = new hw.CpuHdrCompositor();
    const gpu = new core.hdrGpu.GpuHdrCompositor();
    const a = render(cpu);
    const b = render(gpu);

    let frameMaxRel = 0;
    let frameOver = 0;
    for (let i = 0; i < a.frame.data.length; i++) {
      const diff = Math.abs(a.frame.data[i] - b.frame.data[i]);
      const rel = diff / Math.max(0.05, Math.abs(a.frame.data[i]));
      if (rel > frameMaxRel) frameMaxRel = rel;
      if (rel > 0.02) frameOver++;
    }
    let encMax = 0;
    let encOver = 0;
    let encSum = 0;
    for (let i = 0; i < a.enc.length; i++) {
      const diff = Math.abs(a.enc[i] - b.enc[i]);
      encSum += diff;
      if (diff > encMax) encMax = diff;
      if (diff > 4 / 1023) encOver++;
    }
    let viewMax = 0;
    let viewSum = 0;
    for (let i = 0; i < a.view.length; i++) {
      const diff = Math.abs(a.view[i] - b.view[i]);
      viewSum += diff;
      if (diff > viewMax) viewMax = diff;
    }
    // Highlights above SDR white really are in the half-float image (not clipped at 1.0).
    let peak = 0;
    for (let i = 0; i < b.frame.data.length; i += 4) peak = Math.max(peak, b.frame.data[i], b.frame.data[i + 1], b.frame.data[i + 2]);
    gpu.dispose();
    cpu.dispose();
    return {
      kind: gpu.kind,
      frameMaxRel,
      frameOverFraction: frameOver / a.frame.data.length,
      encMax,
      encMean: encSum / a.enc.length,
      encOverFraction: encOver / a.enc.length,
      viewMax,
      viewMean: viewSum / a.view.length,
      peak,
    };
  });
  console.log(`[${testInfo.project.name}] hdr float parity: ${JSON.stringify(result)}`);
  if ("skipped" in result) test.skip(true, String(result.skipped));
  expect((result as { error?: string }).error).toBeUndefined();
  const r = result as Record<string, number>;
  expect(r.peak).toBeGreaterThan(3);
  expect(r.frameOverFraction).toBeLessThan(0.01);
  expect(r.encOverFraction).toBeLessThan(0.01);
  expect(r.encMean).toBeLessThan(0.002);
  expect(r.viewMean).toBeLessThan(1);
});

test("playback cost of the float path versus the 8-bit grading pass (1080p)", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openHook(page);
  const result = await page.evaluate(async () => {
    const core = (window as unknown as { __openreelE2E: { core: HdrCore } }).__openreelE2E.core;
    const hw = core.hdrWorking;
    if (!core.hdrGpu.isGpuHdrAvailable()) return { skipped: "no WebGL2 with EXT_color_buffer_float" };
    const W = 1920;
    const H = 1080;
    const codes = new Uint16Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = Math.round((((i % W) / W) * 0.75 + 0.1) * 65535);
      codes[i * 4] = v;
      codes[i * 4 + 1] = v;
      codes[i * 4 + 2] = v;
      codes[i * 4 + 3] = 65535;
    }
    const grading = {
      tone: { exposure: 0.1, contrast: 0.1, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
      colorWheels: {
        shadows: { r: 0, g: 0, b: 0.03 },
        midtones: { r: 0, g: 0, b: 0 },
        highlights: { r: 0.02, g: 0, b: 0 },
        shadowsLift: 0,
        midtonesGamma: 1,
        highlightsGain: 1,
      },
      pipelineVersion: 2,
    };
    const grade = hw.prepareHdrGrade(grading);
    const decode = hw.hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false });
    const identity = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" };
    const draw = { geometry: hw.computeLayerGeometry(identity, W, H, W, H), opacity: 1, grade };
    const spec = core.colorOutput.resolveOutputColorSpec("rec2020", "pq");
    const overlay = new OffscreenCanvas(W, H);

    const gpu = new core.hdrGpu.GpuHdrCompositor();
    const time = async (n: number, fn: () => void | Promise<void>): Promise<number> => {
      await fn();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) await fn();
      return (performance.now() - t0) / n;
    };
    // Playback: float composite of one graded 16-bit layer + overlay, and the tone-mapped SDR view for the monitor.
    const previewMs = await time(20, () => {
      gpu.begin(W, H);
      gpu.drawCodes({ depth: 16, width: W, height: H, data: codes }, decode, draw);
      gpu.drawOverlay(overlay);
      gpu.readSdrView();
    });
    // The same with an 8-bit canvas source (browser-decoded footage / still images), no 16-bit upload.
    const eightBitSource = new OffscreenCanvas(W, H);
    const sctx = eightBitSource.getContext("2d")!;
    sctx.fillStyle = "#808080";
    sctx.fillRect(0, 0, W, H);
    const previewCanvasMs = await time(20, () => {
      gpu.begin(W, H);
      gpu.drawCodes({ depth: "canvas", source: eightBitSource }, hw.hdrSourceDecode(null), draw);
      gpu.drawOverlay(overlay);
      gpu.readSdrView();
    });
    // Export: the same, with the PQ encode read-back (float RGB) instead of the monitor view.
    const exportMs = await time(10, () => {
      gpu.begin(W, H);
      gpu.drawCodes({ depth: 16, width: W, height: H, data: codes }, decode, draw);
      gpu.drawOverlay(overlay);
      gpu.readEncodedRgb(spec);
    });
    gpu.dispose();

    // The same grade through the existing 8-bit WebGL2 float pass (what an SDR project pays for a graded clip).
    const engine = new core.colorGradingEngine.ColorGradingEngine(W, H);
    engine.initialize();
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, W, H);
    const bitmap = await createImageBitmap(canvas);
    const stages = { tone: grading.tone, wheels: grading.colorWheels };
    const probe = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true })!;
    const eightBitMs = await time(20, async () => {
      const out = await engine.applyFusedGrading(bitmap, stages);
      // Force the GPU result to land (a one-pixel read-back), as the compositor does before drawing it.
      probe.drawImage(out.image, 0, 0);
      probe.getImageData(0, 0, 1, 1);
      out.image.close();
    });

    // CPU reference (the fallback when WebGL2 half-float is missing): one frame.
    const cpu = new hw.CpuHdrCompositor();
    const t0 = performance.now();
    cpu.begin(W, H);
    cpu.drawCodes({ depth: 16, width: W, height: H, data: codes }, decode, draw);
    cpu.readSdrView();
    const cpuMs = performance.now() - t0;
    return { previewMs, previewCanvasMs, exportMs, eightBitMs, cpuMs };
  });
  console.log(`[${testInfo.project.name}] 1080p float path cost: ${JSON.stringify(result)}`);
  if ("skipped" in result) test.skip(true, String(result.skipped));
  const r = result as Record<string, number>;
  // Sanity bounds only (the numbers are reported in docs/colour-management.md): the float preview must be able to
  // run a 1080p frame in about a second on hardware GL. A GPU-less runner executes the same shaders on SwiftShader
  // (1000.1 ms measured on a GitHub ubuntu runner, so the old flat 1 s bound was a coin flip there), which gets a 4x
  // budget: still far below the 10+ s a path that fell back to per-pixel work would take.
  const previewBudgetMs = SOFTWARE_GPU ? 4000 : 1000;
  expect(r.previewMs, `float preview frame at 1080p (budget ${previewBudgetMs} ms)`).toBeLessThan(previewBudgetMs);
});

test("VideoEngine: Rec.709 projects never touch the float path; Rec.2020 / HDR export render SDR footage consistently", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await seek(page, 1.2);
  await settle(page);
  const result = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: any }).__openreelE2E;
    const core = h.core as HdrCore;
    const engine = h.video.getVideoEngine();
    const project = h.project.getState().project;
    const W = 640;
    const H = 360;
    const readRgba = async (bitmap: ImageBitmap) => {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };

    engine.setHdrExportTarget(null);
    // Warm the Rec.709 path first: the first render of a project can resolve its footage frame late on a loaded
    // machine, and a cold-vs-warm comparison measures that, not the colour handling.
    for (let i = 0; i < 2; i++) await engine.renderFrame(project, 1.2, W, H);
    const sdr = await engine.renderFrame(project, 1.2, W, H);
    const sdrPixels = await readRgba(sdr.image);
    const floatTouchedBy709 = engine.hdrCompositor != null;

    const wideProject = { ...project, settings: { ...project.settings, workingColorSpace: "rec2020" } };
    for (let i = 0; i < 2; i++) await engine.renderFrame(wideProject, 1.2, W, H);
    const view = await engine.renderFrame(wideProject, 1.2, W, H);
    const viewPixels = await readRgba(view.image);
    const kind = engine.hdrCompositor?.kind ?? null;
    let viewDiff = 0;
    for (let i = 0; i < sdrPixels.length; i++) viewDiff += Math.abs(sdrPixels[i] - viewPixels[i]);
    viewDiff /= sdrPixels.length;

    // HDR10 export target on the Rec.709 project: the float image encoded straight to PQ planes.
    const spec = core.colorOutput.resolveOutputColorSpec("rec709", "pq");
    engine.setHdrExportTarget({ spec, chroma: "420" });
    const exp = await engine.renderFrame(project, 1.2, W, H);
    const payload = core.hdrWorking.takeHdrPayload(exp.image);
    engine.setHdrExportTarget(null);
    let yDiff = 0;
    let yMax = 0;
    let classicPeak = 0;
    if (payload) {
      // The classic export of the same pixels: 8-bit sRGB code values to PQ, as before this change.
      const classic = core.colorOutput.rgbaToYuv420(new Uint8ClampedArray(sdrPixels), W, H, spec);
      const a = new Uint16Array(payload.yuv.data.buffer, payload.yuv.data.byteOffset, W * H);
      const b = new Uint16Array(classic.data.buffer, classic.data.byteOffset, W * H);
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        yDiff += d;
        if (d > yMax) yMax = d;
        if (b[i] > classicPeak) classicPeak = b[i];
      }
      yDiff /= a.length;
    }
    return {
      floatTouchedBy709,
      kind,
      viewDiff,
      hasPayload: !!payload,
      format: payload?.yuv.format ?? null,
      yDiff,
      yMax,
      classicPeak,
    };
  });
  console.log(`[${testInfo.project.name}] engine HDR wiring: ${JSON.stringify(result)}`);
  expect(result.floatTouchedBy709).toBe(false);
  expect(result.kind).not.toBeNull();
  // SDR footage under the Rec.2020 working space: the tone-mapped monitor view stays close to the Rec.709 render
  // (only the highlight shoulder, SDR white at ~97 %, differs).
  expect(result.viewDiff).toBeLessThan(4);
  expect(result.hasPayload).toBe(true);
  expect(result.format).toBe("I420P10");
  // PQ planes of SDR footage equal the classic 8-bit conversion of the same pixels (within rounding / bilinear).
  expect(result.yDiff).toBeLessThan(3);
  expect(result.yMax).toBeLessThan(40);
});
