import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchGpuBrowserIfAvailable } from "./env";
import { W7_LABELS, meanAbsDiff, prepareSweep, sweepOne, type SweepRow } from "./sweep-lib";

// Runs under the fallback-nowebgpu and fallback-software projects (see
// playwright.config.ts): Chrome launched without WebGPU (and, for the second
// project, without any GPU). Every Effects-browser card must still change the
// program canvas and undo must restore it exactly; the same effects are then
// rendered in a WebGPU-enabled Chrome and compared pixel for pixel.


// fallback-nowebgpu additionally removes navigator.gpu itself, so both ways a
// browser can lack WebGPU (API absent / no adapter) are covered across projects.
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

test("browser really has no WebGPU adapter", async ({ page }) => {
  await page.goto("/");
  const probe = await page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return { hasGpu: false, adapter: null as unknown };
    return { hasGpu: true, adapter: await gpu.requestAdapter() };
  });
  expect(probe.adapter, JSON.stringify(probe)).toBeNull();
});

// The ~70 cards are swept in CHUNKS independent tests (card i belongs to chunk i % CHUNKS) instead of one
// 25-minute test: on a CPU-only runner a single sweep needs 12+ minutes per browser, and one test is the
// unit CI shards by, so it could never be spread over machines. "parallel" mode makes each chunk its own
// shardable test; every chunk still opens a fresh editor, so no state leaks between them.
const CHUNKS = 8;
test.describe.configure({ mode: "parallel" });

for (let chunk = 0; chunk < CHUNKS; chunk++) {
test(`fallback: every card visibly changes the program canvas, undo exact, and compare with WebGPU (part ${chunk + 1}/${CHUNKS})`, async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(900_000);
  const fallback = await prepareSweep(page);
  if (!process.env.OPENREEL_E2E_ONLY) expect(fallback.labels.length).toBeGreaterThanOrEqual(65);
  // Interleaved, so the chunks cost about the same whatever order the cards are listed in.
  const mine = fallback.labels.filter((_, i) => i % CHUNKS === chunk);
  if (mine.length === 0) return;

  const fbRows: SweepRow[] = [];
  for (const label of mine) fbRows.push(await sweepOne(page, fallback.clipId, label));

  // Same effects, same frames, in Chrome with WebGPU enabled.
  // The comparison is informational: when this machine has no WebGPU adapter
  // (e.g. a GPU-less CI runner) only it is skipped, annotated; the fallback
  // assertions below always run.
  const gpuRows: SweepRow[] = [];
  const browser = await launchGpuBrowserIfAvailable(baseURL ?? undefined);
  if (browser) {
    try {
      const ctx = await browser.newContext({ baseURL: baseURL ?? undefined, viewport: { width: 1600, height: 900 } });
      const gpuPage = await ctx.newPage();
      await gpuPage.goto("/");
      const gpu = await prepareSweep(gpuPage);
      for (const label of mine) gpuRows.push(await sweepOne(gpuPage, gpu.clipId, label));
    } finally {
      await browser.close();
    }
  } else {
    testInfo.annotations.push({
      type: "skipped-comparison",
      description: "no WebGPU adapter on this machine: GPU-vs-fallback pixel comparison not run",
    });
  }

  const lines: string[] = [];
  const diffs: Record<string, number> = {};
  fbRows.forEach((r, i) => {
    const g = gpuRows[i];
    const d = g && r.frame === g.frame ? meanAbsDiff(r.small, g.small) : NaN;
    // Effect-only difference: the un-effected frame already differs a little
    // between GPU and software decode/scaling, so report that floor too.
    const floor = g && r.frame === g.frame ? meanAbsDiff(r.baseSmall, g.baseSmall) : NaN;
    diffs[r.label] = d;
    lines.push(
      `${r.ok ? "ok  " : "FAIL"} ${r.label.padEnd(26)} gpuVsFallbackMAD=${d.toFixed(3)} (no-effect floor ${floor.toFixed(3)}) gpuOk=${g?.ok} ${r.note}`,
    );
  });
  const outDir = testInfo.outputDir;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `gpu-vs-fallback-${chunk}.json`), JSON.stringify(diffs, null, 2));
  writeFileSync(join(outDir, `report-${chunk}.txt`), lines.join("\n"));
  console.log(`\n[${testInfo.project.name} part ${chunk + 1}/${CHUNKS}]\n${lines.join("\n")}`);

  const failures = fbRows.filter((r) => !r.ok).map((r) => `${r.label}: ${r.note}`);
  // Wave 7 effects: the software (CPU reference) render must agree with the GPU
  // shader render. The un-effected frame already differs by `floor` between the
  // two renderers, so the effect may add at most 1.0 mean abs RGB on top of it.
  fbRows.forEach((r, i) => {
    const g = gpuRows[i];
    if (!W7_LABELS.includes(r.label) || !g || r.frame !== g.frame) return;
    const d = meanAbsDiff(r.small, g.small);
    const floor = meanAbsDiff(r.baseSmall, g.baseSmall);
    if (d > floor + 1.0) failures.push(`${r.label}: GPU vs fallback MAD ${d.toFixed(3)} exceeds floor ${floor.toFixed(3)} + 1.0`);
  });
  // The five effects the fallback used to drop must be clearly visible, not
  // just a handful of changed pixels: mean abs RGB change vs the same frame
  // without the effect.
  for (const r of fbRows) {
    if (!["Glow", "Vignette", "Sharpen", "Film grain", "Drop Shadow"].includes(r.label)) continue;
    const vsBase = meanAbsDiff(r.small, r.baseSmall);
    if (vsBase < 0.3) failures.push(`${r.label}: only ${vsBase.toFixed(3)} mean abs change vs un-effected frame`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
}
