import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickClip, openEditor, focusEditor } from "./helpers";
import { awaitPaint, frameRun, installProbes, resetLong, seedClips, withProfile, withTrace, type FrameResult, type OpResult } from "./timeline-perf-lib";

/**
 * Click-to-paint and frame-pacing budget for big sequences, measured in the PRODUCTION bundle
 * (`OPENREEL_E2E_DIST=<vite build with VITE_OPENREEL_E2E=1>`; the dev server is 3-5x slower and not representative).
 *
 *   PERF_SIZES=1000,3000   sequence sizes (default 1000)
 *   PERF_RUNS=3            repetitions per operation (the median is asserted)
 *   PERF_REPORT=<file>     write every measurement as JSON
 *   PERF_PROFILE_DIR / PERF_TRACE_DIR   CDP CPU profiles / traces per operation
 *   PERF_ASSERT=0          measure only
 *
 * Bounds are for the 1000 clip sequence and sit ~2x above what a cold 8-core laptop measured after the optimisation
 * (see apps/web/docs/timeline-perf.md), so they catch a regression to the old re-render-everything behaviour
 * (several seconds) without flaking on a loaded runner. SwiftShader/CI runners get a 2x allowance.
 */
const SIZES = (process.env.PERF_SIZES ?? "1000").split(",").map(Number);
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const ASSERT = process.env.PERF_ASSERT !== "0";
const CI_FACTOR = process.env.CI ? 2 : 1;
const BOUNDS = { rippleSpeed: 600, rippleDelete: 400, selectAll: 600, zoom: 600, longTask: 120 };
const REPORT: Record<string, unknown> = {};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const longest = (rs: OpResult[]) => Math.max(0, ...rs.flatMap((r) => r.longTasks));

async function firstLeft(page: Page, id: string): Promise<number> {
  return page.evaluate((i) => document.querySelector(`[data-timeline-item-id="${i}"]`)?.getBoundingClientRect().left ?? -1, id);
}
const leftChanged = (id: string, before: number) =>
  `() => { const e = document.querySelector('[data-timeline-item-id="${id}"]'); return !!e && Math.abs(e.getBoundingClientRect().left - ${before}) > 1; }`;

for (const n of SIZES) {
  test.describe(`timeline perf, ${n} clips`, () => {
    test.beforeEach(async ({ page }) => {
      await openEditor(page);
      await installProbes(page);
    });
    test.afterAll(() => {
      if (process.env.PERF_REPORT) {
        mkdirSync(dirname(process.env.PERF_REPORT), { recursive: true });
        writeFileSync(process.env.PERF_REPORT, JSON.stringify(REPORT, null, 2));
      }
    });

    test(`ripple speed, ripple delete, select all, zoom (${n})`, async ({ page }) => {
      test.setTimeout(600_000);
      const ops: Record<"rippleSpeed" | "rippleDelete" | "selectAll" | "zoom", OpResult[]> = { rippleSpeed: [], rippleDelete: [], selectAll: [], zoom: [] };
      for (let run = 0; run < RUNS; run++) {
        await seedClips(page, n);

        // Ripple speed: select the first clip, Speed/Duration dialog, 200 %, OK. Clip p-2 shifts 0.5 s left.
        await clickClip(page, "p-0");
        await focusEditor(page);
        await page.keyboard.press("Meta+Alt+r");
        const dialog = page.getByRole("dialog", { name: /speed \/ duration/i });
        await dialog.getByLabel("Speed percent").fill("200");
        await page.waitForTimeout(300);
        let before = await firstLeft(page, "p-2");
        await resetLong(page);
        await withTrace(page, `ripple-speed-${n}-${run}`, () => withProfile(page, `ripple-speed-${n}-${run}`, async () => {
          await dialog.getByRole("button", { name: "OK" }).click();
          ops.rippleSpeed.push(await awaitPaint(page, leftChanged("p-2", before)));
        }));
        await page.waitForTimeout(500);

        // Ripple delete: select p-0 (now 0.5 s long), Shift+Backspace/Delete. p-2 moves left by the removed duration.
        await clickClip(page, "p-0");
        await focusEditor(page);
        before = await firstLeft(page, "p-2");
        await resetLong(page);
        await withTrace(page, `ripple-delete-${n}-${run}`, () => withProfile(page, `ripple-delete-${n}-${run}`, async () => {
          await page.keyboard.press("Shift+Backspace");
          ops.rippleDelete.push(await awaitPaint(page, leftChanged("p-2", before)));
        }));
        await page.waitForTimeout(500);

        // Select all.
        await focusEditor(page);
        await resetLong(page);
        await withProfile(page, `select-all-${n}-${run}`, async () => {
          await page.keyboard.press("Meta+a");
          ops.selectAll.push(await awaitPaint(page, `() => document.querySelector('[data-timeline-item-id="p-3"]')?.getAttribute("aria-pressed") === "true"`));
        });
        await page.waitForTimeout(300);

        // Zoom 100 -> 40 px/s through the same store action the zoom control and Cmd+wheel call.
        before = await firstLeft(page, "p-3");
        await resetLong(page);
        await withProfile(page, `zoom-${n}-${run}`, async () => {
          const t0 = await page.evaluate(() => {
            const t = performance.now();
            (window as unknown as { __openreelE2E: { timeline: { getState(): { setZoom(z: number): void } } } }).__openreelE2E.timeline.getState().setZoom(40);
            return t;
          });
          ops.zoom.push(await awaitPaint(page, leftChanged("p-3", before), t0));
        });
      }

      const frames: Record<string, FrameResult> = {};
      await seedClips(page, n);
      await page.evaluate(() => (window as unknown as { __openreelE2E: { ui: { getState(): { clearSelection(): void } } } }).__openreelE2E.ui.getState().clearSelection());
      await page.waitForTimeout(500);
      // Scroll: 240 frames sweeping the sequence (40 px per frame on a 100 px/s timeline).
      const scrollStep = `(i) => { const el = document.querySelector('[data-testid="timeline-tracks-scroll"]'); el.scrollLeft = i * 40; }`;
      // Scrub: move the playhead per animation frame, the way a drag on the ruler does.
      const scrubStep = `(i) => window.__openreelE2E.timeline.getState().seekTo(i * 0.5)`;
      frames.scroll = await withProfile(page, `scroll-${n}`, () => frameRun(page, scrollStep, 240));
      // The sweep must really have rendered the clips at its end (clip 95 sits at 9500 px) and still be virtualised.
      await page.waitForTimeout(300);
      const mounted = await page.evaluate(() => ({
        last: !!document.querySelector('[data-timeline-item-id="p-95"]'),
        count: document.querySelectorAll('[data-timeline-item-id^="p-"]').length,
      }));
      expect(mounted.last, "the clip at the end of the scroll sweep is rendered").toBe(true);
      expect(mounted.count, "off-screen clips are not mounted").toBeLessThan(80);
      frames.scrub = await withProfile(page, `scrub-${n}`, () => frameRun(page, scrubStep, 240));
      // The same with everything selected (select all, then scroll or scrub).
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await page.keyboard.press("Meta+a");
      await page.waitForTimeout(1500);
      frames.scrollSelected = await withProfile(page, `scroll-selected-${n}`, () => frameRun(page, scrollStep, 240));
      frames.scrubSelected = await withProfile(page, `scrub-selected-${n}`, () => frameRun(page, scrubStep, 240));

      const summary = {
        rippleSpeedMs: ops.rippleSpeed.map((r) => Math.round(r.ms)),
        rippleDeleteMs: ops.rippleDelete.map((r) => Math.round(r.ms)),
        selectAllMs: ops.selectAll.map((r) => Math.round(r.ms)),
        zoomMs: ops.zoom.map((r) => Math.round(r.ms)),
        longestLongTaskMs: Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, Math.round(longest(v))])),
        ...frames,
      };
      REPORT[String(n)] = summary;
      console.log(`[timeline-perf ${n}] ${JSON.stringify(summary)}`);

      if (!ASSERT || n !== 1000) return;
      const f = CI_FACTOR;
      expect(median(ops.rippleSpeed.map((r) => r.ms)), "ripple speed click-to-paint").toBeLessThan(BOUNDS.rippleSpeed * f);
      expect(median(ops.rippleDelete.map((r) => r.ms)), "ripple delete click-to-paint").toBeLessThan(BOUNDS.rippleDelete * f);
      expect(median(ops.selectAll.map((r) => r.ms)), "select all click-to-paint").toBeLessThan(BOUNDS.selectAll * f);
      expect(median(ops.zoom.map((r) => r.ms)), "zoom click-to-paint").toBeLessThan(BOUNDS.zoom * f);
      for (const [name, r] of Object.entries(frames)) {
        expect(Math.max(0, ...r.longTasks), `${name}: longest task`).toBeLessThan(BOUNDS.longTask * f);
        expect(r.p95, `${name}: p95 frame interval`).toBeLessThan(34 * f);
      }
    });
  });
}
