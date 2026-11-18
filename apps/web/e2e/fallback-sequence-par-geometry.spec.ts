import { expect, test } from "@playwright/test";
import { expectIsotropicBlur, expectRotatedSquare, PAR_CASES, runBlurredDot, runBlurredVideo, runRotatedSquare } from "./sequence-par-geometry-lib";

/**
 * Fallback projects (`fallback-nowebgpu`: WebGPU off, `fallback-software`: no GPU at all): the Canvas2D monitor and
 * export lay a rotated layer out in display space and run blur-like effects isotropically in display space, the same
 * assertions as the WebGPU spec.
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

for (const { name, par } of PAR_CASES) {
  test(`fallback: a rotated square stays a square in the monitor and in export at PAR ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const measured = await runRotatedSquare(page, par, testInfo);
    expect(measured.gpuSubmits, "no WebGPU work on a fallback renderer").toBe(0);
    expectRotatedSquare(measured, par);
  });

  test(`fallback: a blurred dot is isotropic in display space (adjustment layer) at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    expectIsotropicBlur(await runBlurredDot(page, par, "adjustment"), par, { monitor: true });
  });

  test(`fallback: an overlay's own blur is isotropic in display space in export at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    expectIsotropicBlur(await runBlurredDot(page, par, "overlay"), par, { monitor: false });
  });

  test(`fallback: a blurred video clip is isotropic in display space in the monitor and in export at PAR ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    expectIsotropicBlur(await runBlurredVideo(page, par), par, {
      monitor: true,
      // The monitor blurs with the CSS filter and export with the effects engine; their kernels differ by ~23% even at square pixels, so the
      // cross-check is loose. The PAR-specific claim is the isotropy of each, asserted at 4%.
      spreadTolerance: 0.32,
    });
  });
}
