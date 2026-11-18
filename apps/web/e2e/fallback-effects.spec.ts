import { expect, test, type Page } from "@playwright/test";
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

/**
 * One card is a handful of seconds of work. Playwright's own action/navigation timeouts are off by default and a
 * page.evaluate has none at all, so a starved GPU/renderer process used to hold a test until its 15 minute
 * limit with no hint of where. Each card gets a deadline; on expiry the page is closed (which releases whatever
 * evaluate was pending) and the failure names the card, the browser and the time.
 */
const CARD_DEADLINE_MS = 240_000;
async function sweepBounded(page: Page, which: string, clipId: string, label: string): Promise<SweepRow> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void page.context().close().catch(() => undefined);
      reject(new Error(`${which} browser stalled: effect card "${label}" made no progress for ${CARD_DEADLINE_MS / 1000}s (a page call never returned)`));
    }, CARD_DEADLINE_MS);
  });
  const work = sweepOne(page, clipId, label);
  work.catch(() => undefined); // the race below reports it; closing the context makes the loser reject
  try {
    return await Promise.race([work, stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bound one phase of a chunk (launching the comparison browser, opening its editor, closing it). Playwright has no
 * default timeout on page.evaluate, a launch handshake or browser.close(), so a wedged GPU process held a chunk for
 * its whole 15 minute test limit with no hint of the phase. On expiry `onExpire` releases the stuck resource and the
 * failure names the phase and the time spent.
 */
async function phase<T>(name: string, ms: number, work: () => Promise<T>, onExpire?: () => Promise<unknown>): Promise<T> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void Promise.resolve(onExpire?.()).catch(() => undefined);
      reject(new Error(`phase "${name}" made no progress for ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  const run = work();
  run.catch(() => undefined);
  try {
    return await Promise.race([run, stalled]);
  } finally {
    clearTimeout(timer);
    console.log(`[phase] ${name} ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

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
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  const fallback = await phase("fallback editor setup", 240_000, () => prepareSweep(page), () => page.context().close());
  if (!process.env.OPENREEL_E2E_ONLY) expect(fallback.labels.length).toBeGreaterThanOrEqual(65);
  // Interleaved, so the chunks cost about the same whatever order the cards are listed in.
  const mine = fallback.labels.filter((_, i) => i % CHUNKS === chunk);
  if (mine.length === 0) return;

  const fbRows: SweepRow[] = [];
  for (const label of mine) fbRows.push(await sweepBounded(page, "fallback", fallback.clipId, label));

  // Same effects, same frames, in Chrome with WebGPU enabled.
  // The comparison is informational: when this machine has no WebGPU adapter
  // (e.g. a GPU-less CI runner) only it is skipped, annotated; the fallback
  // assertions below always run.
  const gpuRows: SweepRow[] = [];
  const browser = await phase("launch WebGPU comparison browser", 240_000, () => launchGpuBrowserIfAvailable(baseURL ?? undefined));
  if (browser) {
    try {
      await phase("WebGPU comparison sweep", 600_000, async () => {
        const ctx = await browser.newContext({ baseURL: baseURL ?? undefined, viewport: { width: 1600, height: 900 } });
        const gpuPage = await ctx.newPage();
        gpuPage.setDefaultTimeout(60_000);
        gpuPage.setDefaultNavigationTimeout(60_000);
        await gpuPage.goto("/");
        const gpu = await prepareSweep(gpuPage);
        for (const label of mine) gpuRows.push(await sweepBounded(gpuPage, "WebGPU", gpu.clipId, label));
      }, () => browser.close());
    } finally {
      // The comparison is complete here. Close the page's context first so its GPU resources are released while
      // the browser is still healthy, then the browser; a teardown that still does not return inside the bound is
      // killed (named in the log) rather than held for the test's 15 minute limit.
      await phase("close WebGPU comparison contexts", 30_000, async () => { for (const c of browser.contexts()) await c.close(); }, async () => undefined)
        .catch((e: unknown) => console.warn(`[teardown] ${(e as Error).message}`));
      await phase("close WebGPU comparison browser", 30_000, () => browser.close(), async () => { browser.process()?.kill("SIGKILL"); })
        .catch((e: unknown) => console.warn(`[teardown] ${(e as Error).message}; the browser process was killed`));
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
