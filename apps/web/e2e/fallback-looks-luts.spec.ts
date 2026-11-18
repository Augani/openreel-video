import { test } from "@playwright/test";
import { registerLooksLutsTests } from "./looks-luts-lib";

// fallback-nowebgpu and fallback-software: looks, LUTs, saved looks and white balance previews must render
// real graded footage through the Canvas2D / software path too.
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

registerLooksLutsTests();
