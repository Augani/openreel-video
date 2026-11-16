import { expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuthoringFlow, runImportFlow } from "./essential-graphics-lib";
import { runParity } from "./essential-graphics-parity";

/**
 * The Essential Graphics flow on the fallback renderers: the `fallback-nowebgpu` project
 * (Chrome with WebGPU switched off, so the Canvas2D fallback renderer is chosen) and the
 * `fallback-software` project (no GPU at all). Same assertions as the WebGPU spec: protected
 * intro/outro frames after a stretch, a template exported and imported into a new project
 * renders identical frames, undo is exact, and preview matches the export renderer.
 */

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name !== "fallback-nowebgpu") return;
  await page.addInitScript(() => {
    try {
      delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
    } catch {
      /* requestAdapter() is still null */
    }
  });
});

test("fallback: lower third controls, protected intro/outro, template round trip, exact undo", async ({ page, browser }, testInfo) => {
  test.setTimeout(480_000);
  const dir = mkdtempSync(join(tmpdir(), "openreel-egf-"));
  const file = join(dir, "e2e.openreel-template");
  const result = await runAuthoringFlow(page, file);
  const second = await (await browser.newContext({ baseURL: testInfo.project.use.baseURL })).newPage();
  if (testInfo.project.name === "fallback-nowebgpu") {
    await second.addInitScript(() => {
      try {
        delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
      } catch {
        /* requestAdapter() is still null */
      }
    });
  }
  try {
    await runImportFlow(second, result.templatePath, result);
  } finally {
    await second.context().close();
  }
});

test("fallback: preview and export renderers agree on graphic frames", async ({ page }) => {
  test.setTimeout(360_000);
  const rows = await runParity(page, ["Classic Bar", "Hero Title", "Highlight Box"]);
  for (const row of rows) {
    // Both renderers place graphics at the same sub-pixel position, so only 1px AA remains.
    const min = 0.985;
    expect(row.within, `${row.label}: graphic pixels within 40/255 (1px AA shift allowed)`).toBeGreaterThan(min);
    // (mean abs diff is printed, not asserted: it mixes in the preview stage colour behind soft edges)
  }
});
