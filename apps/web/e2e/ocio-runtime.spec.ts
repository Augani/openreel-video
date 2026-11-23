import { expect, test } from "@playwright/test";
import { SOFTWARE_GPU } from "./env";
import { assertOcioProductResult, ensureLumetriFixtures, runGpuParity, runOcioProductFlow } from "./ocio-runtime-lib";
import { openHookPage } from "./helpers";

/**
 * OpenColorIO runtime.
 *  1. The WebGL2 shader (the exact GLSL the compositor embeds, RGBA32F in and out) against the CPU reference and against the
 *     values real OpenColorIO 2.x produced (scripts/ocio/make-reference.py) for the ACES studio config, the cg config and a
 *     hand-made config with 1D / 3D LUTs, a CDL, a view transform and looks.
 *  2. The product flow: load a config and its LUTs in the dialog, pick the spaces, display, view and a look backed by a 3D
 *     LUT; the engine and the Program monitor render what the CPU reference predicts; undo / redo; save / load.
 */

test.beforeAll(() => ensureLumetriFixtures());

test("OCIO GPU shader matches the CPU reference and OpenColorIO", async ({ page }) => {
  test.setTimeout(420_000);
  await openHookPage(page);
  const available = await page.evaluate(() => {
    try {
      const c = new OffscreenCanvas(1, 1).getContext("webgl2");
      return !!c && !!c.getExtension("EXT_color_buffer_float");
    } catch {
      return false;
    }
  });
  test.skip(!available, "no WebGL2 with EXT_color_buffer_float");
  const r = await runGpuParity(page);
  console.log(`OCIO GPU parity: ${r.compared} cases (${r.unsupported} reported unsupported, ${r.gpuUnsupported.length} without a shader form); worst relative error gpu vs cpu ${r.worstGpuVsCpu.rel.toExponential(2)}, gpu vs OpenColorIO ${r.worstGpuVsRef.rel.toExponential(2)}, cpu vs OpenColorIO ${r.worstCpuVsRef.rel.toExponential(2)}`);
  expect(Array.from(new Set(r.gpuUnsupported.map((m) => m.replace(/^[^:]*: /, "").split("\n")[0]))), "every supported conversion has a shader form").toEqual([]);
  expect(r.compared).toBeGreaterThan(230);
  // Relative to max(|reference|, 1). The CPU reference holds to OCIO's float32 / SSE math; the shader adds GPU pow / exp / log.
  expect(r.worstCpuVsRef.rel, r.worstCpuVsRef.at).toBeLessThan(5e-4);
  expect(r.worstGpuVsCpu.rel, r.worstGpuVsCpu.at).toBeLessThan(SOFTWARE_GPU ? 2e-4 : 1e-4);
  expect(r.worstGpuVsRef.rel, r.worstGpuVsRef.at).toBeLessThan(5e-4);
});

test("OCIO config with a 3D LUT look changes the Program monitor as predicted and round-trips save / load", async ({ page }) => {
  test.setTimeout(300_000);
  const r = await runOcioProductFlow(page);
  assertOcioProductResult(r, { max: SOFTWARE_GPU ? 4 : 3, mean: 1.0, monitor: 4 });
});
