import { test } from "@playwright/test";
import { registerInspectorPreviewTests } from "./inspector-previews-lib";

// fallback-nowebgpu and fallback-software projects: the inspector previews render through the same engines
// on the Canvas2D / software GL path.
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

registerInspectorPreviewTests();
