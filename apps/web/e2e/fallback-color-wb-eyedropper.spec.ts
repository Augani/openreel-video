import { expect, test } from "@playwright/test";
import { expectRealFootage, expectWbFlow, runWbEyedropperFlow, runWbRealFootageFlow } from "./color-wb-eyedropper-lib";
import { openRealFootage } from "./looks-luts-lib";

// Runs under fallback-nowebgpu and fallback-software (playwright.config.ts): no WebGPU (and, for the second
// project, no GPU), so the Program monitor is the Canvas2D / software frame. Same flow, same result.
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

test("fallback: white balance eyedropper neutralises the sampled grey as one undo step; Esc cancels", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await page.goto("/");
  const adapter = await page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu ? await gpu.requestAdapter() : null;
  });
  expect(adapter).toBeNull();
  const r = await runWbEyedropperFlow(page);
  console.log(`[${testInfo.project.name}] wb-eyedropper ${JSON.stringify(r)}`);
  expectWbFlow(r);
});

test("fallback: white balance eyedropper on real footage neutralises a patch under a cast + contrast (pipeline v2)", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const r = await runWbRealFootageFlow(page, 2, (p) => openRealFootage(p));
  console.log(`[${testInfo.project.name}] wb-eyedropper real ${JSON.stringify(r)}`);
  expectRealFootage(r);
});
