import { test } from "@playwright/test";
import { registerBurnInTests } from "./burn-in-lib";

// fallback-nowebgpu and fallback-software projects: the burn-ins must draw the same way through the Canvas2D
// fallback renderer (no WebGPU), in the monitor, in export frames and in an exported file.
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

registerBurnInTests();
