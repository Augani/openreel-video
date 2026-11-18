import { expect, test } from "@playwright/test";
import { ensurePipelineFixtures, runEngineParity, runHueUiFlow } from "./color-pipeline-lib";
import { ensureLumetriFixtures } from "./lumetri-basic-lib";

// Hue curves and the Premiere-order float pipeline on the GPU project. The same flows run on the
// Canvas2D / no-WebGPU / software projects in fallback-color-pipeline.spec.ts.

test.beforeAll(() => {
  ensureLumetriFixtures();
  ensurePipelineFixtures();
});

test("the WebGL2 float pass and the CPU reference agree on all four hue curves, wheels and Basic Correction", async ({ page }) => {
  test.setTimeout(120_000);
  const r = await runEngineParity(page);
  console.log(`[color-pipeline] gpu=${r.gpuAvailable} maxDiff=${r.maxDiff} meanDiff=${r.meanDiff.toFixed(3)} over1=${r.over1}/${r.pixels} cpuVsRef=${r.cpuVsReferenceMax} meanChange=${r.meanChange.toFixed(2)}`);
  expect(r.meanChange).toBeGreaterThan(5);
  expect(r.cpuVsReferenceMax).toBe(0);
  expect(r.gpuAvailable, r.gpuError ?? "").toBe(true);
  expect(r.gpuMeanChange).toBeGreaterThan(5);
  expect(r.maxDiff).toBeLessThanOrEqual(3);
  expect(r.meanDiff).toBeLessThan(0.5);
  expect(r.over1 / r.pixels).toBeLessThan(0.01);
});

test("a hue vs sat point added in the inspector changes the Program frame like the reference and undoes", async ({ page }) => {
  test.setTimeout(240_000);
  const r = await runHueUiFlow(page);
  console.log(`[color-pipeline] ui meanDiffToReference=${r.meanDiffToReference.toFixed(2)} meanChange=${r.meanChange.toFixed(2)} grade=${JSON.stringify(r.grade?.pipelineVersion)}`);
  expect(r.premiereChecked).toBe(true);
  expect(r.grade?.pipelineVersion).toBe(2);
  expect(r.meanChange).toBeGreaterThan(1.5);
  expect(r.meanDiffToReference).toBeLessThan(1.5);
  expect(r.undoneGrade?.hueCurves).toBeUndefined();
});
