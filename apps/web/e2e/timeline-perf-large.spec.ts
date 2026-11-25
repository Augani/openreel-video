import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, type Page } from "@playwright/test";
import { openEditor } from "./helpers";
import { awaitPaint, frameRun, installProbes, resetLong, withProfile, type FrameResult } from "./timeline-perf-lib";

/**
 * Big-project responsiveness: 12 tracks x 125 clips (1500 clips) with effects and keyframes, measured in a
 * production bundle (OPENREEL_E2E_DIST=<vite build with VITE_OPENREEL_E2E=1>). Measure-only (no assertions): run it
 * before and after a change and compare. PERF_REPORT=<file> writes the numbers as JSON, PERF_RUNS the repetitions.
 */
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const TRACKS = 12;
const PER_TRACK = 125;

type Hook = { project: { getState(): Record<string, any>; setState(s: Record<string, unknown>): void }; timeline: { getState(): Record<string, any> }; ui: { getState(): Record<string, any> } };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function seedLarge(page: Page): Promise<void> {
  await page.evaluate(({ tracks, perTrack }) => {
    const e = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const { project } = e.project.getState();
    const w = window as unknown as { __lgMain?: any };
    // The first call captures the imported Main track; later calls (the project has been replaced) reuse it.
    w.__lgMain ??= structuredClone(project.timeline.tracks.find((t: any) => t.name === "Main"));
    const main = w.__lgMain;
    const proto = main.clips[0];
    const built = Array.from({ length: tracks }, (_, t) => {
      const type = t % 4 === 3 ? "audio" : "video";
      const id = `lg-track-${t}`;
      return {
        ...structuredClone(main),
        id,
        name: `Large ${t}`,
        type,
        role: undefined,
        clips: Array.from({ length: perTrack }, (_, c) => ({
          ...structuredClone(proto),
          id: `lg-${t}-${c}`,
          trackId: id,
          startTime: c * 3,
          duration: 3,
          inPoint: 0,
          outPoint: 3,
          linkedClipId: undefined,
          linkGroupId: undefined,
          effects: c % 3 === 0 ? [{ id: `fx-${t}-${c}`, type: "brightness", enabled: true, params: { value: 0.1 } }] : [],
          keyframes: c % 5 === 0
            ? [
                { id: `kf-${t}-${c}-a`, time: 0, property: "opacity", value: 0, easing: "linear" },
                { id: `kf-${t}-${c}-b`, time: 3, property: "opacity", value: 1, easing: "linear" },
              ]
            : [],
        })),
      };
    });
    e.project.setState({ project: { ...project, timeline: { ...project.timeline, tracks: built } } });
    e.timeline.getState().setZoom(40);
  }, { tracks: TRACKS, perTrack: PER_TRACK });
  // Sync Lock would refuse a ripple across tracks; the measured edit is the ripple itself.
  await page.evaluate(async (count) => {
    const s = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState();
    for (let t = 0; t < count; t++) await s.setTrackSyncLock(`lg-track-${t}`, false);
  }, TRACKS);
  await page.waitForTimeout(2000);
}

const REPORT: Record<string, unknown> = {};
const deleted: number[] = [];

test("large timeline: scroll, zoom, select, drag, trim, ripple delete 200 + undo", async ({ page }) => {
  test.setTimeout(900_000);
  await openEditor(page);
  await installProbes(page);
  const frames: Record<string, FrameResult[]> = { scroll: [], zoom: [], selectAllScroll: [], drag: [], trim: [], scrub: [] };
  const ops: Record<string, number[]> = { selectOne: [], selectAll: [], rippleDelete200: [], undoRippleDelete200: [], redoRippleDelete200: [] };
  for (let run = 0; run < RUNS; run++) {
    await seedLarge(page);
    await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().clearSelection());
    await page.waitForTimeout(300);

    frames.scroll.push(await frameRun(page, `(i) => { const el = document.querySelector('[data-testid="timeline-tracks-scroll"]'); el.scrollLeft = i * 25; }`, 240));
    await page.evaluate(() => { const el = document.querySelector('[data-testid="timeline-tracks-scroll"]') as HTMLElement; el.scrollLeft = 0; });
    await page.waitForTimeout(300);
    frames.zoom.push(await withProfile(page, `zoom-${run}`, () => frameRun(page, `(i) => window.__openreelE2E.timeline.getState().setZoom([40, 50, 60, 80, 60, 50, 40, 30][i % 8])`, 120)));
    await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState().setZoom(40));
    await page.waitForTimeout(300);
    frames.scrub.push(await frameRun(page, `(i) => window.__openreelE2E.timeline.getState().seekTo(i * 0.5)`, 240));

    // Selection of one clip: click-to-paint through the store call the UI makes.
    await resetLong(page);
    const t1 = await page.evaluate(() => { const t = performance.now(); (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().select({ id: "lg-1-3", type: "clip" }); return t; });
    ops.selectOne.push((await awaitPaint(page, `() => document.querySelector('[data-timeline-item-id="lg-1-3"]')?.getAttribute("aria-pressed") === "true"`, t1)).ms);
    await page.waitForTimeout(300);
    const t2 = await page.evaluate(() => {
      const w = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const items = w.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips.map((c: any) => ({ id: c.id, type: "clip" })));
      const t = performance.now();
      w.ui.getState().selectMultiple(items);
      return t;
    });
    ops.selectAll.push((await awaitPaint(page, `() => document.querySelector('[data-timeline-item-id="lg-0-3"]')?.getAttribute("aria-pressed") === "true"`, t2)).ms);
    frames.selectAllScroll.push(await frameRun(page, `(i) => { const el = document.querySelector('[data-testid="timeline-tracks-scroll"]'); el.scrollLeft = i * 25; }`, 240));
    await page.evaluate(() => { (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().clearSelection(); (document.querySelector('[data-testid="timeline-tracks-scroll"]') as HTMLElement).scrollLeft = 0; });
    await page.waitForTimeout(300);

    // Drag: one history-grouped move per frame, as a pointer drag commits.
    frames.drag.push(await frameRun(page, `(i) => { const s = window.__openreelE2E.project.getState(); if (i === 0) s.beginHistoryGroup("Move clips"); void s.moveClips([{ clipId: "lg-0-4", startTime: 12 + i * 0.05 }], { coalesceKey: "drag" }); if (i === 119) s.endHistoryGroup(); }`, 120));
    await page.waitForTimeout(500);
    // Trim: right edge, one action per frame.
    frames.trim.push(await frameRun(page, `(i) => { void window.__openreelE2E.project.getState().trimClip("lg-2-6", 0, 3 - i * 0.01); }`, 120));
    await page.waitForTimeout(500);

    // Ripple delete 200 clips (50 on each of the first four tracks), then undo and redo.
    await resetLong(page);
    const ids = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.slice(0, 4).flatMap((t: any) => t.clips.slice(10, 60).map((c: any) => c.id)) as string[]);
    const stamp = (call: string, done: string) => page.evaluate(async ({ call, done }) => {
      const w = window as unknown as { __openreelE2E: Hook; __stamp?: number };
      const t = performance.now();
      const s = w.__openreelE2E.project.getState();
      const result = await (new Function("s", "ids", `return (${call})`) as (s: unknown, ids: string[]) => Promise<{ success?: boolean } | undefined>)(s, (window as unknown as { __ids: string[] }).__ids);
      return { t, done, success: result?.success ?? true, error: (result as { error?: { message?: string } } | undefined)?.error?.message };
    }, { call, done });
    await page.evaluate((i) => { (window as unknown as { __ids: string[] }).__ids = i; }, ids);
    const a = await stamp("s.rippleDeleteClips(ids)", "");
    if (!a.success) console.log(`[timeline-perf-large] ripple delete refused: ${a.error}`);
    ops.rippleDelete200.push((await awaitPaint(page, `() => !document.querySelector('[data-timeline-item-id="lg-0-12"]') || true`, a.t)).ms);
    await page.waitForTimeout(500);
    const afterDelete = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.reduce((n: number, t: any) => n + t.clips.length, 0) as number);
    deleted.push(TRACKS * PER_TRACK - afterDelete);
    const b = await stamp("s.undo()", "");
    ops.undoRippleDelete200.push((await awaitPaint(page, `() => window.__openreelE2E.project.getState().project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) === ${TRACKS * PER_TRACK}`, b.t)).ms);
    await page.waitForTimeout(500);
    const c = await stamp("s.redo()", "");
    ops.redoRippleDelete200.push((await awaitPaint(page, `() => window.__openreelE2E.project.getState().project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) === ${afterDelete}`, c.t)).ms);
    await page.waitForTimeout(500);
  }
  const frameSummary = Object.fromEntries(Object.entries(frames).map(([k, rs]) => [k, {
    p50: +median(rs.map((r) => r.p50)).toFixed(1), p95: +median(rs.map((r) => r.p95)).toFixed(1),
    max: +median(rs.map((r) => r.max)).toFixed(1), over50: median(rs.map((r) => r.over50)),
    longestTask: Math.round(median(rs.map((r) => Math.max(0, ...r.longTasks)))),
  }]));
  const opSummary = Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, +median(v).toFixed(1)]));
  Object.assign(REPORT, { runs: RUNS, clipsRemovedByRippleDelete: deleted, frames: frameSummary, opsMs: opSummary });
  console.log(`[timeline-perf-large] ${JSON.stringify(REPORT)}`);
  if (process.env.PERF_REPORT) {
    mkdirSync(dirname(process.env.PERF_REPORT), { recursive: true });
    writeFileSync(process.env.PERF_REPORT, JSON.stringify(REPORT, null, 2));
  }
});
