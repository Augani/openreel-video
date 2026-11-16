import { expect, test } from "@playwright/test";
import { ensurePipelineFixtures, runEngineParity, runHueUiFlow } from "./color-pipeline-lib";

// Runs under fallback-nowebgpu and fallback-software (playwright.config.ts): Chrome without WebGPU (and,
// for the second project, without any GPU). The hue-curve flows must behave exactly as in
// color-pipeline.spec.ts: the GPU float pass (where WebGL2 exists) and the CPU fallback agree, and the
// preview matches the reference.

test.beforeAll(() => {
  ensurePipelineFixtures();
});

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name !== "fallback-nowebgpu") return;
  await page.addInitScript(() => {
    try {
      delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
    } catch {
      /* non-configurable on this build; requestAdapter() is still null */
    }
  });
});

test("fallback: float pass and CPU reference agree on hue curves, wheels and Basic Correction", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const r = await runEngineParity(page);
  console.log(`[${testInfo.project.name}] gpu=${r.gpuAvailable} maxDiff=${r.maxDiff} meanDiff=${r.meanDiff.toFixed(3)} over1=${r.over1}/${r.pixels} cpuVsRef=${r.cpuVsReferenceMax}`);
  expect(r.meanChange).toBeGreaterThan(5);
  expect(r.cpuVsReferenceMax).toBe(0);
  if (r.gpuAvailable) {
    expect(r.gpuMeanChange).toBeGreaterThan(5);
    expect(r.maxDiff).toBeLessThanOrEqual(3);
    expect(r.meanDiff).toBeLessThan(0.5);
    expect(r.over1 / r.pixels).toBeLessThan(0.01);
  } else {
    // No WebGL2 at all (pure software run): the CPU reference is the render path, so there is nothing to diff.
    console.log(`[${testInfo.project.name}] WebGL2 unavailable: ${r.gpuError}`);
  }
});

test("fallback: a hue vs sat point added in the inspector changes the Program frame like the reference and undoes", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const r = await runHueUiFlow(page);
  console.log(`[${testInfo.project.name}] ui meanDiffToReference=${r.meanDiffToReference.toFixed(2)} meanChange=${r.meanChange.toFixed(2)}`);
  expect(r.premiereChecked).toBe(true);
  expect(r.meanChange).toBeGreaterThan(1.5);
  expect(r.meanDiffToReference).toBeLessThan(1.5);
  expect(r.undoneGrade?.hueCurves).toBeUndefined();
});
