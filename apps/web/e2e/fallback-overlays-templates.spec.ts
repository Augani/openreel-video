import { test } from "@playwright/test";
import { registerOverlayTemplateTests } from "./overlays-templates-lib";

// fallback-nowebgpu and fallback-software projects: the same cards through the Canvas2D fallback path.
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

registerOverlayTemplateTests();
