import { expect, test } from "@playwright/test";
import { launchGpuBrowserIfAvailable } from "./env";
import { meanAbsDiff } from "./sweep-lib";
import { runPickFlow } from "./color-secondary-lib";

// Runs under fallback-nowebgpu and fallback-software (playwright.config.ts):
// Chrome without WebGPU (and, for the second project, without any GPU), so the
// secondary runs on the Canvas2D / software path. The same flow must key the
// same pixels, correct only inside the matte, undo exactly, and match the
// WebGPU-enabled Chrome's final frame.

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

test("fallback: HSL secondary keys, corrects only inside the matte, undoes exactly, and matches WebGPU Chrome", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const probe = await (async () => {
    await page.goto("/");
    return page.evaluate(async () => {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (!gpu) return { hasGpu: false, adapter: null as unknown };
      return { hasGpu: true, adapter: await gpu.requestAdapter() };
    });
  })();
  expect(probe.adapter, JSON.stringify(probe)).toBeNull();

  const fallback = await runPickFlow(page);
  console.log(
    `[${testInfo.project.name}] picked ${JSON.stringify(fallback.qualifier)} coverage=${fallback.coverage.toFixed(4)} expected=${fallback.expected.toFixed(4)} ` +
      `inside=${fallback.io.insideCount} insideChromatic=${fallback.io.insideChromatic} outside=${fallback.io.outsideCount} outsideChanged=${fallback.io.outsideChanged} undoResidual=${fallback.undoResidual}`,
  );
  expect(fallback.expected).toBeGreaterThan(0.07);
  expect(fallback.expected).toBeLessThan(0.12);
  expect(Math.abs(fallback.coverage - fallback.expected)).toBeLessThan(0.015);
  expect(fallback.io.insideCount).toBeGreaterThan(5000);
  expect(fallback.io.insideChromatic).toBe(0);
  expect(fallback.io.outsideCount).toBeGreaterThan(50_000);
  // Software rendering may shade a handful of soft-matte fringe pixels (matte < 0.5 reads black in B/W).
  expect(fallback.io.outsideChanged).toBeLessThanOrEqual(Math.ceil(fallback.io.outsideCount * 1e-4));
  expect(fallback.historyDeltaForMatteToggles).toBe(0);
  expect(fallback.historyDeltaForGrade).toBe(1);
  expect(fallback.undoResidual).toBe(0);

  // Same flow in a WebGPU-enabled Chrome; the graded frame must agree.
  const browser = await launchGpuBrowserIfAvailable(baseURL ?? undefined);
  if (!browser) {
    testInfo.annotations.push({
      type: "skipped-comparison",
      description: "no WebGPU adapter on this machine: GPU-vs-fallback pixel comparison not run",
    });
    return;
  }
  try {
    const ctx = await browser.newContext({ baseURL: baseURL ?? undefined, viewport: { width: 1600, height: 900 } });
    const gpuPage = await ctx.newPage();
    const gpu = await runPickFlow(gpuPage);
    const mad = meanAbsDiff(fallback.small, gpu.small);
    console.log(
      `[${testInfo.project.name}] GPU vs fallback: coverage ${gpu.coverage.toFixed(4)} vs ${fallback.coverage.toFixed(4)}, graded-frame MAD=${mad.toFixed(3)}`,
    );
    expect(Math.abs(gpu.coverage - fallback.coverage)).toBeLessThan(0.01);
    expect(mad).toBeLessThan(2);
  } finally {
    await browser.close();
  }
});
