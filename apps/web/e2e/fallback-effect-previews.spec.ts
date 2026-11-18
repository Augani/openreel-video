import { test } from "@playwright/test";
import { registerEffectPreviewTests } from "./effect-previews-lib";

// fallback-nowebgpu and fallback-software projects: the Effects previews must render real footage through
// the Canvas2D fallback renderer path too (same VideoEffectsEngine canvas passes, no WebGPU involved).
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

registerEffectPreviewTests();
