import { expect, test, type Page } from "@playwright/test";
import { SOFTWARE_GPU } from "./env";
import { assertAcesProductResult, ensureLumetriFixtures, runAcesProductFlow } from "./aces-color-lib";
import { openHookPage } from "./helpers";

/**
 * ACES colour management.
 *  1. gpu project: the WebGL2 half-float ACES pipeline (ACEScct grade, sRGB / BT.1886 view, PQ and HLG encode) against the
 *     Float32 CPU reference that backs the no-GPU fallback, on one composite.
 *  2. the product flow (lib): Preview options > Color management > ACES changes the rendered pixels by exactly what the
 *     analytic transforms predict, in the engine (preview and export) and on the Program monitor; the setting is one
 *     undo step and survives a save / load round trip; a per-clip input override works.
 */

test.beforeAll(() => ensureLumetriFixtures());

interface CoreHook {
  hdrWorking: Record<string, any>;
  hdrGpu: Record<string, any>;
  acesOutput: Record<string, any>;
}

async function parity(page: Page) {
  return page.evaluate(() => {
    const core = (window as unknown as { __openreelE2E: { core: CoreHook } }).__openreelE2E.core;
    if (!core.hdrGpu.isGpuHdrAvailable()) return { skipped: "no WebGL2 with EXT_color_buffer_float" } as const;
    const hw = core.hdrWorking;
    // The CPU reference compositor runs the Output Transform through this registration (the engine does it per frame).
    hw.registerAcesOutputTransform(core.acesOutput.acesOutputTransform);
    const W = 192;
    const H = 108;
    // Layer 1: 8-bit sRGB ramp with hue drift. Layer 2: 16-bit ARRI LogC3 ramp. Overlay: translucent box + white bar.
    const srgb = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = Math.round((255 * x) / (W - 1));
        srgb.set([v, Math.round(v * (0.5 + 0.5 * (y / H))), Math.round(v * (1 - 0.6 * (y / H))), 255], (y * W + x) * 4);
      }
    const SW = 96;
    const SH = 54;
    const log = new Uint16Array(SW * SH * 4);
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++) {
        const s = 0.15 + 0.7 * (x / (SW - 1));
        const o = (y * SW + x) * 4;
        log[o] = Math.round(s * 65535);
        log[o + 1] = Math.round(s * (0.9 + 0.1 * (y / SH)) * 65535);
        log[o + 2] = Math.round(s * (1 - 0.2 * (y / SH)) * 65535);
        log[o + 3] = 65535;
      }
    const overlay = new OffscreenCanvas(W, H);
    const octx = overlay.getContext("2d")!;
    octx.fillStyle = "rgba(20,120,220,0.5)";
    octx.fillRect(20, 14, 80, 40);
    octx.fillStyle = "#ffffff";
    octx.fillRect(8, 90, 120, 8);

    const identity = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" };
    const results: Record<string, { viewDiffMax: number; viewOver: number; encMax: number }> = {};
    for (const sdrOutput of ["srgb", "rec709"] as const) {
      const pipeline = hw.acesPipeline(sdrOutput);
      const grade = hw.prepareHdrGrade(
        {
          temperature: 25,
          tint: -10,
          tone: { exposure: 0.2, contrast: 0.2, highlights: -0.1, shadows: 0.1, whites: 0, blacks: 0 },
          colorWheels: { shadows: { r: 0.02, g: 0, b: 0.03 }, midtones: { r: 0, g: 0.02, b: 0 }, highlights: { r: 0.01, g: 0, b: -0.02 }, shadowsLift: 0.01, midtonesGamma: 1.1, highlightsGain: 1.05 },
          vignette: { amount: -0.4, midpoint: 0.4, roundness: 0, feather: 0.4 },
        },
        pipeline,
      );
      const run = (comp: any) => {
        comp.setColorPipeline(pipeline);
        comp.setGraphicsWhite(203);
        comp.begin(W, H);
        comp.drawCodes({ depth: 8, width: W, height: H, data: srgb }, hw.hdrSourceDecode(null, pipeline), { geometry: hw.computeLayerGeometry(identity, W, H, W, H), opacity: 1, grade });
        const logGeometry = hw.computeLayerGeometry({ ...identity, scale: { x: 0.5, y: 0.5 }, position: { x: 30, y: 20 }, opacity: 0.8 }, SW, SH, W, H);
        comp.drawCodes(
          { depth: 16, width: SW, height: SH, data: log },
          hw.hdrSourceDecode({ primaries: "awg3", transfer: "logc3", matrix: "rgb", fullRange: true }, pipeline),
          { geometry: logGeometry, opacity: 0.8 },
        );
        comp.drawOverlay(overlay);
        return comp;
      };
      const cpu = run(new hw.CpuHdrCompositor());
      const gpu = run(new core.hdrGpu.GpuHdrCompositor());
      const a = cpu.readSdrView() as Uint8ClampedArray;
      const b = gpu.readSdrView() as Uint8ClampedArray;
      let viewDiffMax = 0;
      let over = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > viewDiffMax) viewDiffMax = d;
        if (d > 2) over++;
      }
      let encMax = 0;
      for (const transfer of ["pq", "hlg"] as const) {
        const spec = { primaries: "bt2020", transfer, matrix: "bt2020-ncl", fullRange: false, bitDepth: 10 };
        const ea = cpu.readEncodedRgb(spec) as Float32Array;
        const eb = gpu.readEncodedRgb(spec) as Float32Array;
        for (let i = 0; i < ea.length; i++) encMax = Math.max(encMax, Math.abs(ea[i] - eb[i]));
      }
      results[sdrOutput] = { viewDiffMax, viewOver: over / a.length, encMax };
      cpu.dispose();
      gpu.dispose();
    }
    return { results } as const;
  });
}

test("the WebGL2 ACES pipeline matches the float CPU reference (ACEScct grade, sRGB / BT.1886 view, PQ and HLG encode)", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await openHookPage(page);
  const result = await parity(page);
  console.log(`[${testInfo.project.name}] ACES shader parity: ${JSON.stringify(result)}`);
  if ("skipped" in result) test.skip(true, String(result.skipped));
  const { results } = result as { results: Record<string, { viewDiffMax: number; viewOver: number; encMax: number }> };
  for (const id of ["srgb", "rec709"]) {
    const r = results[id];
    // 8-bit view: float32 shader vs float32/double CPU reference. A GPU's pow / log2 are a few ulp off, which can flip a code by one.
    expect(r.viewDiffMax, `${id} view, largest 8-bit difference`).toBeLessThanOrEqual(SOFTWARE_GPU ? 4 : 3);
    expect(r.viewOver, `${id} view, fraction of channels off by more than 2 codes`).toBeLessThan(0.002);
    // Encoded PQ / HLG signal, float: well under one 10-bit code (1/1023) in the highlights.
    expect(r.encMax, `${id} PQ / HLG encode, largest signal difference`).toBeLessThan(0.004);
  }
});

test("ACES through the product: menu, pixels vs the analytic prediction, ACEScct grade, undo, save / load, per-clip override", async ({ page }) => {
  test.setTimeout(240_000);
  assertAcesProductResult(await runAcesProductFlow(page));
});
