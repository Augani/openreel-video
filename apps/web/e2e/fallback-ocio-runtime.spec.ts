import { test } from "@playwright/test";
import { assertOcioProductResult, ensureLumetriFixtures, runOcioProductFlow } from "./ocio-runtime-lib";

// Runs under fallback-nowebgpu and fallback-software (playwright.config.ts): without WebGPU, and without any GPU, the OCIO
// pipeline renders through the same engine (WebGL2 half float where present, the Float32 CPU reference otherwise) and must
// produce the pixels the CPU reference predicts, with the same undo and persistence as ocio-runtime.spec.ts.

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

test("OCIO without WebGPU: the same pixels, undo and persistence", async ({ page }) => {
  test.setTimeout(420_000);
  assertOcioProductResult(await runOcioProductFlow(page), { max: 3, mean: 1.0, monitor: 4 });
});
