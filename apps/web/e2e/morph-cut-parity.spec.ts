import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";

/**
 * Morph Cut in a real browser, no editor session: the WebGPU compute path and the CPU reference implement one
 * algorithm and must agree (dense analysis on the aligned pair, and the per-frame warp + dissolve), the morph must
 * beat a plain dissolve against the analytic midpoint on the GPU as on the CPU, and the analysis time and the
 * per-frame render time of a 1080p transition are measured (printed, loosely bounded).
 */
interface Core {
  timeInterpolation: Record<string, any>;
  timeInterpolationScenes: Record<string, any>;
  morphCutAnalysis: Record<string, any>;
  morphCutRender: Record<string, any>;
  morphCutFaces: Record<string, any>;
}

test("Morph Cut: GPU matches the CPU reference and both beat a dissolve against the analytic midpoint", async ({ page }) => {
  test.setTimeout(240_000);
  await openHookPage(page);
  const result = await page.evaluate(async () => {
    const { core } = (window as unknown as { __openreelE2E: { core: Core } }).__openreelE2E;
    const faces = core.morphCutFaces;
    const an = core.morphCutAnalysis;
    const rd = core.morphCutRender;
    const sc = core.timeInterpolationScenes;
    const ti = core.timeInterpolation;
    const W = 256;
    const H = 144;
    const A = { x: 0.5, y: 0.5, scale: 1, rotationDeg: 0, blink: 0 };
    const B = { x: 0.54, y: 0.53, scale: 1.08, rotationDeg: 6, blink: 0.6 };
    const cut = faces.jumpCut(W, H, A, B);
    const gpuBackend = await rd.createGpuDenseBackend();
    const cpuAnalysis = await an.analyseMorphCut(cut.a, cut.b, { key: "cpu", quality: "medium", backend: an.cpuDenseBackend });
    const out: Record<string, unknown> = { hasGpu: Boolean(gpuBackend), cpuOk: cpuAnalysis.ok, cpuMs: cpuAnalysis.analysisMs };
    const truth = cut.truth(0.5);
    const dissolve = ti.blendRGBA(cut.a, cut.b, 0.5) as Uint8ClampedArray;
    out.dissolveDb = sc.psnr(dissolve, truth.data);
    const cpuMorph = ti.synthesizeFrame(cut.a, cut.b, rd.fieldToFlowPair(cpuAnalysis.field, W), 0.5) as Uint8ClampedArray;
    out.cpuMorphDb = sc.psnr(cpuMorph, truth.data);
    if (gpuBackend) {
      const gpuAnalysis = await an.analyseMorphCut(cut.a, cut.b, { key: "gpu", quality: "medium", backend: gpuBackend });
      out.gpuOk = gpuAnalysis.ok;
      out.gpuAnalysisMs = gpuAnalysis.analysisMs;
      let sum = 0;
      let big = 0;
      const fa = gpuAnalysis.field.ab as Float32Array;
      const fb = cpuAnalysis.field.ab as Float32Array;
      for (let i = 0; i < fa.length; i++) {
        const d = Math.abs(fa[i] - fb[i]);
        sum += d;
        if (d > 1) big++;
      }
      out.fieldMad = sum / fa.length;
      out.fieldBigFrac = big / fa.length;
      // synthesis parity on the SAME (CPU) field: only the warp + dissolve differs between the implementations
      const gpu = await rd.getMorphGpu();
      const field = cpuAnalysis.field;
      const set = gpu.uploadFields(field.width, field.height, W / field.width, field);
      const rows: Array<Record<string, number>> = [];
      for (const t of [0.25, 0.5, 0.75]) {
        const g = (await gpu.synthesizeWith(set, cut.a, cut.b, W, H, t)) as Uint8ClampedArray;
        const c = ti.synthesizeFrame(cut.a, cut.b, rd.fieldToFlowPair(field, W), t) as Uint8ClampedArray;
        let s = 0;
        let bg = 0;
        for (let i = 0; i < W * H; i++) {
          let m = 0;
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(g[i * 4 + k] - c[i * 4 + k]);
            s += d;
            m = Math.max(m, d);
          }
          if (m > 8) bg++;
        }
        rows.push({ t, mad: s / (W * H * 3), bigFrac: bg / (W * H), gpuDb: sc.psnr(g, cut.truth(t).data), cpuDb: sc.psnr(c, cut.truth(t).data), vsCpuDb: sc.psnr(g, c) });
      }
      set.destroy();
      out.rows = rows;
      // the GPU-analysed field renders a morph that beats the dissolve too
      const gMorph = ti.synthesizeFrame(cut.a, cut.b, rd.fieldToFlowPair(gpuAnalysis.field, W), 0.5) as Uint8ClampedArray;
      out.gpuFieldMorphDb = sc.psnr(gMorph, truth.data);
    }
    return out;
  });
  console.log(`[morph-cut parity] ${JSON.stringify(result)}`);
  expect(result.cpuOk).toBe(true);
  expect(result.cpuMorphDb as number).toBeGreaterThan((result.dissolveDb as number) + 3);
  if (result.hasGpu) {
    expect(result.gpuOk).toBe(true);
    expect(result.fieldMad as number, "GPU vs CPU displacement field, mean abs difference (px)").toBeLessThan(0.5);
    for (const r of result.rows as Array<Record<string, number>>) {
      expect(r.mad, `synthesis t=${r.t} mean abs difference`).toBeLessThan(1.0);
      expect(r.bigFrac, `synthesis t=${r.t} pixels differing by > 8`).toBeLessThan(0.01);
      expect(r.gpuDb).toBeGreaterThan((result.dissolveDb as number) + 3);
    }
    expect(result.gpuFieldMorphDb as number).toBeGreaterThan((result.dissolveDb as number) + 3);
  }
  test.skip(!result.hasGpu, "no WebGPU adapter in this browser: only the CPU half ran");
});

test("Morph Cut: analysis time and per-frame render time of a 1080p transition, GPU and CPU", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await openHookPage(page);
  const timings = await page.evaluate(async () => {
    const { core } = (window as unknown as { __openreelE2E: { core: Core } }).__openreelE2E;
    const faces = core.morphCutFaces;
    const an = core.morphCutAnalysis;
    const rd = core.morphCutRender;
    const ti = core.timeInterpolation;
    const W = 1920;
    const H = 1080;
    const A = { x: 0.5, y: 0.5, scale: 1, rotationDeg: 0, blink: 0 };
    const B = { x: 0.54, y: 0.53, scale: 1.08, rotationDeg: 6, blink: 0.6 };
    // the same picture as the 256 px test scenes, at 1080p (texture detail scales with the frame)
    const scene = faces.talkingHead(W, H, A, B, { tx: 0, ty: 0, scale: 1, rotationDeg: 0 }, { tx: 0, ty: 0, scale: 1, rotationDeg: 0 }, 256 / W);
    const sc = core.timeInterpolationScenes;
    const a = sc.renderScene(scene, W, H, 0, 1);
    const b = sc.renderScene(scene, W, H, 1, 1);
    const out: Record<string, number | boolean | string> = {};
    const gpuBackend = await rd.createGpuDenseBackend();
    out.hasGpu = Boolean(gpuBackend);
    const gpu = gpuBackend ? await rd.getMorphGpu() : null;
    for (const quality of ["low", "medium", "high"] as const) {
      if (gpuBackend) {
        await an.analyseMorphCut(a, b, { key: `warm-${quality}`, quality, backend: gpuBackend });
        const r = await an.analyseMorphCut(a, b, { key: `gpu-${quality}`, quality, backend: gpuBackend });
        out[`gpu.${quality}.analysisMs`] = r.analysisMs;
        out[`gpu.${quality}.ok`] = r.ok;
        if (quality === "medium" && r.field) {
          const set = gpu.uploadFields(r.field.width, r.field.height, W / r.field.width, r.field);
          await gpu.synthesizeWith(set, a, b, W, H, 0.5);
          const t0 = performance.now();
          for (const t of [0.2, 0.4, 0.6, 0.8]) await gpu.synthesizeWith(set, a, b, W, H, t);
          out["gpu.renderFrameMs"] = (performance.now() - t0) / 4;
          set.destroy();
        }
      }
      const cpu = await an.analyseMorphCut(a, b, { key: `cpu-${quality}`, quality, backend: an.cpuDenseBackend });
      out[`cpu.${quality}.analysisMs`] = cpu.analysisMs;
      out[`cpu.${quality}.ok`] = cpu.ok;
      if (quality === "medium" && cpu.field) {
        const t0 = performance.now();
        ti.synthesizeFrame(a, b, rd.fieldToFlowPair(cpu.field, W), 0.5);
        out["cpu.renderFrameMs"] = performance.now() - t0;
      }
    }
    gpu?.dispose();
    return out;
  });
  console.log(`[morph-cut bench] 1080p ${testInfo.project.name}: ${JSON.stringify(timings)}`);
  const frames = 30;
  console.log(
    `[morph-cut bench] 1 s transition (30 frames) at 1080p, medium: ` +
      `CPU ${(((timings["cpu.medium.analysisMs"] as number) + frames * (timings["cpu.renderFrameMs"] as number)) / 1000).toFixed(1)} s total` +
      (timings.hasGpu ? `; GPU ${(((timings["gpu.medium.analysisMs"] as number) + frames * (timings["gpu.renderFrameMs"] as number)) / 1000).toFixed(1)} s total` : "; no WebGPU adapter"),
  );
  for (const q of ["low", "medium", "high"]) {
    expect(timings[`cpu.${q}.ok`]).toBe(true);
    expect(timings[`cpu.${q}.analysisMs`] as number).toBeLessThan(120_000);
    if (timings.hasGpu) expect(timings[`gpu.${q}.analysisMs`] as number).toBeLessThan(60_000);
  }
});
