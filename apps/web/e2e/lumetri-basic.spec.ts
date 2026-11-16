import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ensureLumetriFixtures, runAutoFlow, runMatchFlow, runShadowsFlow } from "./lumetri-basic-lib";
import { runExportParityFlow } from "./lumetri-basic-export-lib";

// Real-browser coverage of the Lumetri-style Basic Correction, Auto Tone and Match Color (GPU project;
// the Canvas2D / software path runs the same flows in fallback-lumetri-basic.spec.ts).

test.beforeAll(() => {
  ensureLumetriFixtures();
});

test("Shadows +0.5 lifts the darkest third of a gradient and leaves the brightest third alone", async ({ page }) => {
  test.setTimeout(240_000);
  const r = await runShadowsFlow(page);
  console.log(`[lumetri] shadows band luma before=${r.before.map((v) => v.toFixed(1))} after=${r.after.map((v) => v.toFixed(1))}`);
  expect(r.grade?.tone?.shadows).toBe(0.5);
  // Six bands: 0-1 are the darkest third, 4-5 the brightest third.
  for (const band of [0, 1]) expect(r.after[band]).toBeGreaterThan(r.before[band] + 4);
  for (const band of [4, 5]) expect(Math.abs(r.after[band] - r.before[band])).toBeLessThanOrEqual(2);
});

test("Auto widens the luma range of a flat clip and applies a stable tone", async ({ page }) => {
  test.setTimeout(240_000);
  const r = await runAutoFlow(page);
  const range = (s: { p1: number; p99: number }) => s.p99 - s.p1;
  console.log(`[lumetri] auto scope p1/p99 before=${r.before.p1}/${r.before.p99} after=${r.after.p1}/${r.after.p99} tone=${JSON.stringify(r.grade?.tone)}`);
  expect(range(r.before)).toBeLessThan(40);
  expect(range(r.after)).toBeGreaterThan(range(r.before) * 1.5);
  expect(r.after.p1).toBeLessThan(r.before.p1);
  expect(r.after.p99).toBeGreaterThan(r.before.p99);
});

test("Match Color from a warm clip brings a cool clip closer in mean colour", async ({ page }) => {
  test.setTimeout(300_000);
  const r = await runMatchFlow(page);
  console.log(`[lumetri] match distance before=${r.before.toFixed(1)} after=${r.after.toFixed(1)} wheels=${JSON.stringify(r.grade?.colorWheels?.midtones)}`);
  expect(r.before).toBeGreaterThan(30);
  expect(r.after).toBeLessThan(r.before * 0.6);
  expect(r.referenceUnchanged).toBe(true);
  expect(r.grade?.colorWheels?.midtones.r).toBeGreaterThan(0);
});

test("a 2 s export matches the preview within tolerance", async ({ page }) => {
  test.setTimeout(600_000);
  const r = await runExportParityFlow(page, join(tmpdir(), `lumetri-basic-gpu-${process.pid}.mp4`));
  const worst = Math.max(...r.preview.flatMap((band, i) => band.map((v, c) => Math.abs(v - r.exported[i][c]))));
  console.log(`[lumetri] export parity worst band delta=${worst.toFixed(2)} grade=${JSON.stringify(r.grade)}`);
  expect(r.grade?.tone?.shadows).toBe(0.5);
  expect(worst).toBeLessThan(8);
});
