import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ensureLumetriFixtures, runAutoFlow, runMatchFlow, runShadowsFlow } from "./lumetri-basic-lib";
import { runExportParityFlow } from "./lumetri-basic-export-lib";

// Runs under fallback-nowebgpu and fallback-software (playwright.config.ts): Chrome without WebGPU (and,
// for the second project, without any GPU), so the Canvas2D / software path renders and exports. The
// same Basic Correction flows must behave identically to lumetri-basic.spec.ts.

test.beforeAll(() => {
  ensureLumetriFixtures();
});

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

async function expectNoGpu(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  const probe = await page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu ? { hasGpu: true, adapter: await gpu.requestAdapter() } : { hasGpu: false, adapter: null as unknown };
  });
  expect(probe.adapter, JSON.stringify(probe)).toBeNull();
}

test("fallback: Shadows lifts the darkest third only", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await expectNoGpu(page);
  const shadows = await runShadowsFlow(page);
  console.log(`[${testInfo.project.name}] shadows before=${shadows.before.map((v) => v.toFixed(1))} after=${shadows.after.map((v) => v.toFixed(1))}`);
  for (const band of [0, 1]) expect(shadows.after[band]).toBeGreaterThan(shadows.before[band] + 4);
  for (const band of [4, 5]) expect(Math.abs(shadows.after[band] - shadows.before[band])).toBeLessThanOrEqual(2);
});

test("fallback: Auto widens a flat clip", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await expectNoGpu(page);
  const auto = await runAutoFlow(page);
  const range = (s: { p1: number; p99: number }) => s.p99 - s.p1;
  console.log(`[${testInfo.project.name}] auto range ${range(auto.before)} -> ${range(auto.after)}`);
  expect(range(auto.after)).toBeGreaterThan(range(auto.before) * 1.5);
});

test("fallback: Match Color closes the colour gap", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await expectNoGpu(page);
  const match = await runMatchFlow(page);
  console.log(`[${testInfo.project.name}] match distance ${match.before.toFixed(1)} -> ${match.after.toFixed(1)}`);
  expect(match.after).toBeLessThan(match.before * 0.6);
  expect(match.referenceUnchanged).toBe(true);
});

test("fallback: a 2 s export without WebGPU matches the preview within tolerance", async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  const r = await runExportParityFlow(page, join(tmpdir(), `lumetri-basic-${testInfo.project.name}-${process.pid}.mp4`));
  const worst = Math.max(...r.preview.flatMap((band, i) => band.map((v, c) => Math.abs(v - r.exported[i][c]))));
  console.log(`[${testInfo.project.name}] export parity worst band delta=${worst.toFixed(2)}`);
  expect(worst).toBeLessThan(8);
});
