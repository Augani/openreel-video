import { test, expect } from "@playwright/test";
import { ensurePluginOutDir, runWgslPluginFlow } from "./effect-plugins-lib";

// No WebGPU adapter in these projects: WGSL-only plugins are bypassed (never a crash) and the CPU fallback
// of film grain renders in the sandboxed worker. The GPU path is covered by effect-plugins.spec.ts.
test.beforeAll(() => ensurePluginOutDir());

test("effect plugins without WebGPU: shader-only plugins are bypassed, CPU fallbacks render in the sandbox", async ({ page }) => {
  test.setTimeout(180_000);
  const { hasAdapter } = await runWgslPluginFlow(page);
  expect(hasAdapter).toBe(false);
});
