import { test } from "@playwright/test";
import { assertAcesProductResult, ensureLumetriFixtures, runAcesProductFlow } from "./aces-color-lib";

// Runs under fallback-nowebgpu and fallback-software (playwright.config.ts): without WebGPU, and without any GPU, the ACES
// pipeline renders through the same engine (WebGL2 half float where present, the Float32 CPU reference otherwise) and
// must produce the same pixels as the analytic prediction, the same undo and the same persistence as aces-color.spec.ts.

test.beforeAll(() => ensureLumetriFixtures());

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

test("ACES colour management without WebGPU: the same pixels, undo and persistence", async ({ page }) => {
  test.setTimeout(300_000);
  assertAcesProductResult(await runAcesProductFlow(page));
});
