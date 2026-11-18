import { expect, test } from "@playwright/test";
import { expectIsotropicBlur, expectRotatedSquare, PAR_CASES, runBlurredDot, runBlurredVideo, runRotatedSquare } from "./sequence-par-geometry-lib";

/**
 * WebGPU project: the GPU compositor lays a rotated layer out in display space (no shear in a non-square-PAR
 * sequence) and blur-like effects are isotropic where the frame is shown. The Canvas2D twin of this spec is
 * `fallback-sequence-par-geometry.spec.ts`.
 */
for (const { name, par } of PAR_CASES) {
  test(`gpu: a rotated square stays a square in the monitor and in export at PAR ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const measured = await runRotatedSquare(page, par, testInfo);
    // macOS has a real GPU: a missing adapter there would silently turn this into a Canvas2D test, so it is a failure.
    if (process.platform === "darwin") expect(measured.gpuAdapter, "a WebGPU adapter exists on this machine").toBe(true);
    if (measured.gpuAdapter) {
      // The monitor really went through the WebGPU compositor (a software adapter counts).
      expect(measured.gpuSubmits, "WebGPU compositor submitted work for the monitor").toBeGreaterThan(0);
    }
    expectRotatedSquare(measured, par);
  });

  test(`gpu: a blurred dot is isotropic in display space (adjustment layer) at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    expectIsotropicBlur(await runBlurredDot(page, par, "adjustment"), par, { monitor: true });
  });

  test(`gpu: an overlay's own blur is isotropic in display space in export at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    // The Program monitor does not render effects on titles and shapes at all (a separate, older gap), so only export is measured.
    expectIsotropicBlur(await runBlurredDot(page, par, "overlay"), par, { monitor: false });
  });

  test(`gpu: a blurred video clip is isotropic in display space in the monitor and in export at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    expectIsotropicBlur(await runBlurredVideo(page, par), par, {
      monitor: true,
      // The monitor blurs with the CSS filter and export with the effects engine; their kernels differ by ~23% even at square pixels, so the
      // cross-check is loose. The PAR-specific claim is the isotropy of each, asserted at 4%.
      spreadTolerance: 0.32,
    });
  });
}
