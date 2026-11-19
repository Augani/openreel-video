import { test } from "@playwright/test";
import { registerTimeEffectTests } from "./time-effects-lib";

// fallback-nowebgpu and fallback-software projects: Echo / Posterize Time through the Canvas2D fallback renderer path.
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

registerTimeEffectTests();
