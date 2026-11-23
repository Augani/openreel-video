import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";

/**
 * Optical Flow in a real browser: the WebGPU compute path and the CPU reference implement one algorithm and must
 * agree; both must beat frame blending against analytic ground truth; and the per-frame render time of each path
 * at 1080p is measured (printed, and bounded loosely so a regression is caught without pinning one machine).
 * The page reaches the core modules through the e2e hook, so no editor session is needed.
 */
interface Core {
  timeInterpolation: Record<string, any>;
  timeInterpolationScenes: Record<string, any>;
}

test("Optical Flow: GPU matches the CPU reference and both beat frame blending on ground-truth scenes", async ({ page }) => {
  test.setTimeout(180_000);
  await openHookPage(page);
  const result = await page.evaluate(async () => {
    const { core } = (window as unknown as { __openreelE2E: { core: Core } }).__openreelE2E;
    const ti = core.timeInterpolation;
    const sc = core.timeInterpolationScenes;
    const W = 256;
    const H = 144;
    const gpu = await ti.GpuOpticalFlow.create();
    const rows: Array<Record<string, number | string | boolean>> = [];
    const scenes: Array<[string, any, number]> = [
      ["pan(7.3,-3.1)", sc.pan(7.3, -3.1), 0.5],
      ["square(8.6,4.3)", sc.translatingSquare(W, H, 8.6, 4.3), 0.25],
      ["rotate(4deg)", sc.rotatingDisc(W, H, 4), 0.5],
      ["fade", sc.fade(), 0.5],
    ];
    for (const [name, scene, t] of scenes) {
      const a = sc.renderScene(scene, W, H, 0);
      const b = sc.renderScene(scene, W, H, 1);
      const truth = sc.renderScene(scene, W, H, t);
      for (const quality of ["low", "medium", "high"] as const) {
        const params = ti.flowParamsFor(quality);
        const cpu = ti.interpolateOpticalFlowCPU(a, b, t, params) as Uint8ClampedArray;
        const blend = ti.blendRGBA(a, b, t) as Uint8ClampedArray;
        const row: Record<string, number | string | boolean> = {
          scene: name,
          quality,
          t,
          cpuDb: sc.psnr(cpu, truth.data),
          blendDb: sc.psnr(blend, truth.data),
          hasGpu: Boolean(gpu),
        };
        if (gpu) {
          const pair = gpu.prepare(a, b, W, H, params);
          const out = (await gpu.synthesize(pair, t)) as Uint8ClampedArray;
          pair.destroy();
          let sum = 0;
          let big = 0;
          for (let i = 0; i < W * H; i++) {
            let m = 0;
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(out[i * 4 + c] - cpu[i * 4 + c]);
              sum += d;
              m = Math.max(m, d);
            }
            if (m > 8) big++;
          }
          row.gpuDb = sc.psnr(out, truth.data);
          row.gpuVsCpuDb = sc.psnr(out, cpu);
          row.gpuVsCpuMad = sum / (W * H * 3);
          row.gpuVsCpuBigFrac = big / (W * H);
        }
        rows.push(row);
      }
    }
    gpu?.dispose();
    return rows;
  });
  const hasGpu = result[0]?.hasGpu === true;
  for (const r of result) {
    console.log(
      `[optical-flow parity] ${r.scene} ${r.quality}: truth PSNR cpu ${(r.cpuDb as number).toFixed(2)} dB` +
        (hasGpu ? `, gpu ${(r.gpuDb as number).toFixed(2)} dB; gpu vs cpu ${(r.gpuVsCpuDb as number).toFixed(2)} dB MAD ${(r.gpuVsCpuMad as number).toFixed(3)} px>8 ${((r.gpuVsCpuBigFrac as number) * 100).toFixed(3)}%` : ", no WebGPU adapter") +
        `, blend ${(r.blendDb as number).toFixed(2)} dB`,
    );
    if (r.scene !== "fade") expect(r.cpuDb as number, `${r.scene} ${r.quality} CPU beats blend`).toBeGreaterThan((r.blendDb as number) + 3);
    if (hasGpu) {
      expect(r.gpuVsCpuMad as number, `${r.scene} ${r.quality} GPU vs CPU mean abs difference`).toBeLessThan(1.0);
      expect(r.gpuVsCpuBigFrac as number, `${r.scene} ${r.quality} pixels differing by > 8`).toBeLessThan(0.01);
      if (r.scene !== "fade") expect(r.gpuDb as number, `${r.scene} ${r.quality} GPU beats blend`).toBeGreaterThan((r.blendDb as number) + 3);
    }
  }
  test.skip(!hasGpu, "no WebGPU adapter in this browser: only the CPU half ran");
});

test("Optical Flow: render time per interpolated 1080p frame, GPU and CPU", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openHookPage(page);
  const timings = await page.evaluate(async () => {
    const { core } = (window as unknown as { __openreelE2E: { core: Core } }).__openreelE2E;
    const ti = core.timeInterpolation;
    const sc = core.timeInterpolationScenes;
    const W = 1920;
    const H = 1080;
    const scene = sc.translatingSquare(W, H, 22, 9);
    const a = sc.renderScene(scene, W, H, 0, 1);
    const b = sc.renderScene(scene, W, H, 1, 1);
    const out: Record<string, number | boolean | string> = {};
    const gpu = await ti.GpuOpticalFlow.create();
    out.hasGpu = Boolean(gpu);
    for (const quality of ["low", "medium", "high"] as const) {
      const params = ti.flowParamsFor(quality);
      if (gpu) {
        // warm-up: pipelines are compiled on first use
        const warm = gpu.prepare(a, b, W, H, params);
        await gpu.synthesize(warm, 0.5);
        warm.destroy();
        let t0 = performance.now();
        const pair = gpu.prepare(a, b, W, H, params);
        await gpu.synthesize(pair, 0.25);
        out[`gpu.${quality}.firstMs`] = performance.now() - t0;
        t0 = performance.now();
        for (const t of [0.5, 0.75]) await gpu.synthesize(pair, t);
        out[`gpu.${quality}.nextMs`] = (performance.now() - t0) / 2;
        pair.destroy();
      }
      let t0 = performance.now();
      const flow = ti.computeFlowPair(a, b, params);
      out[`cpu.${quality}.flowMs`] = performance.now() - t0;
      t0 = performance.now();
      ti.synthesizeFrame(a, b, flow, 0.5);
      out[`cpu.${quality}.synthMs`] = performance.now() - t0;
    }
    const t0 = performance.now();
    ti.blendRGBA(a, b, 0.5);
    out["blend.ms"] = performance.now() - t0;
    gpu?.dispose();
    return out;
  });
  console.log(`[optical-flow bench] 1080p ${testInfo.project.name}: ${JSON.stringify(timings)}`);
  expect(timings["blend.ms"] as number).toBeLessThan(500);
  for (const q of ["low", "medium", "high"]) {
    // loose bounds: a regression to something unusable is caught, the numbers above are the report
    expect(timings[`cpu.${q}.flowMs`] as number).toBeLessThan(60_000);
    if (timings.hasGpu) expect((timings[`gpu.${q}.firstMs`] as number)).toBeLessThan(30_000);
  }
});
