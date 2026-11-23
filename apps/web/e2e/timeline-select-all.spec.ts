import { expect, test, type Page } from "@playwright/test";
import { boxOf, clipsOf, drag, focusEditor, openEditor, readState, redo, undo } from "./helpers";
import { seedClips } from "./timeline-perf-lib";

/**
 * Off-screen selected clips are NOT mounted once more than MAX_MOUNTED_OFFSCREEN_SELECTION (32) are selected
 * (timeline virtualisation). Everything that acts on a big selection must therefore work from the stores, never
 * from mounted DOM. Production bundle (OPENREEL_E2E_DIST=<vite build with VITE_OPENREEL_E2E=1>).
 */
const N = Number(process.env.SELECT_ALL_CLIPS ?? 1000);

interface Positions {
  starts: Record<string, number>;
  count: number;
}
const allClipIds = (page: Page) =>
  page.evaluate(() => {
    const e = (window as any).__openreelE2E;
    return e.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips.map((c: any) => c.id)) as string[];
  });
const positions = (page: Page): Promise<Positions> =>
  page.evaluate(() => {
    const e = (window as any).__openreelE2E;
    const clips = e.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips);
    return { starts: Object.fromEntries(clips.map((c: any) => [c.id, c.startTime])), count: clips.length };
  });
const selectedCount = (page: Page) =>
  page.evaluate(() => (window as any).__openreelE2E.ui.getState().getSelectedClipIds().length as number);
const mountedClipCount = (page: Page) => page.evaluate(() => document.querySelectorAll("[data-timeline-item-id]").length);
/** Undo steps as the user sees them: consecutive entries of one history group are one step. */
const historyLength = (page: Page) =>
  page.evaluate(() => {
    const entries = (window as any).__openreelE2E.project.getState().actionExecutor.getHistory().getHistoryEntries() as Array<{ groupId?: string }>;
    let steps = 0;
    entries.forEach((entry, i) => {
      if (!entry.groupId || entries[i - 1]?.groupId !== entry.groupId) steps++;
    });
    return steps;
  });

async function selectAll(page: Page): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press("Meta+a");
  await expect.poll(() => selectedCount(page), { timeout: 15_000 }).toBe(2 * N);
  await page.waitForTimeout(500);
}

test.describe(`select all on ${N} clips: actions do not depend on mounted clips`, () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    await seedClips(page, N);
  });

  test("select all keeps the timeline virtualised", async ({ page }) => {
    await selectAll(page);
    expect(await mountedClipCount(page), "off-screen selected clips are not mounted").toBeLessThan(120);
  });

  test("dragging a visible selected clip moves every selected clip, off-screen ones too, in one undo step", async ({ page }) => {
    await selectAll(page);
    const before = await positions(page);
    const historyBefore = await historyLength(page);
    const box = await boxOf(page, "p-3");
    // 300 px at 100 px/s = 3 s later (a whole number of seconds so it lands on clip edges whatever the snap setting).
    await drag(page, { x: box.left + 30, y: box.centerY }, 300);
    await page.waitForTimeout(1500);

    const after = await positions(page);
    expect(after.count).toBe(before.count);
    const delta = after.starts["p-3"] - before.starts["p-3"];
    expect(delta, "the dragged clip moved").toBeGreaterThan(2.5);
    const wrong = Object.keys(before.starts).filter((id) => Math.abs(after.starts[id] - (before.starts[id] + delta)) > 1e-6);
    expect(wrong.slice(0, 5), `${wrong.length} clips did not move by ${delta}s`).toEqual([]);
    // Far off-screen clips moved by the same delta (explicit, not only via the generic check above).
    for (const id of ["p-500", "p-999", "a-0", "a-999"]) expect(after.starts[id] - before.starts[id]).toBeCloseTo(delta, 6);

    expect((await historyLength(page)) - historyBefore, "one undo step").toBe(1);
    await undo(page);
    const undone = await positions(page);
    expect(Object.keys(before.starts).filter((id) => Math.abs(undone.starts[id] - before.starts[id]) > 1e-6)).toEqual([]);
    expect(await historyLength(page)).toBe(historyBefore);
    await redo(page);
    const redone = await positions(page);
    expect(Math.abs(redone.starts["p-999"] - (before.starts["p-999"] + delta))).toBeLessThan(1e-6);
  });

  test("delete removes every selected clip, one undo step restores them", async ({ page }) => {
    await selectAll(page);
    const historyBefore = await historyLength(page);
    await focusEditor(page);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await positions(page)).count, { timeout: 30_000 }).toBe(0);
    expect((await historyLength(page)) - historyBefore, "one undo step").toBe(1);
    await undo(page);
    await expect.poll(async () => (await positions(page)).count, { timeout: 30_000 }).toBe(2 * N);
  });

  test("copy then paste duplicates every selected clip, including off-screen ones", async ({ page }) => {
    await selectAll(page);
    const before = await positions(page);
    await focusEditor(page);
    await page.keyboard.press("Meta+c");
    await page.waitForTimeout(300);
    // Paste after the sequence so the copies cannot collide with the originals.
    await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), N + 10);
    await page.waitForTimeout(300);
    const historyBefore = await historyLength(page);
    await focusEditor(page);
    const pasteStart = Date.now();
    await page.keyboard.press("Meta+v");
    await expect.poll(async () => (await positions(page)).count, { timeout: 30_000, intervals: [25] }).toBe(2 * before.count);
    const pasteMs = Date.now() - pasteStart;
    console.log(`[select-all paste] ${before.count} clips pasted in ${pasteMs} ms (one clip/addBatch)`);
    // One batch action instead of one action per clip (13 s for 2000 clips before). Bound is loose: the e2e machine is shared.
    expect(pasteMs, "paste of the whole selection").toBeLessThan(4000);
    const after = await positions(page);
    const originals = new Set(Object.keys(before.starts));
    const pasted = Object.entries(after.starts).filter(([id]) => !originals.has(id)).map(([, s]) => s);
    expect(pasted.length).toBe(before.count);
    expect(Math.min(...pasted)).toBeGreaterThanOrEqual(N + 10 - 1e-6);
    expect(Math.max(...pasted) - Math.min(...pasted)).toBeCloseTo(N - 1, 3);
    expect((await historyLength(page)) - historyBefore, "one undo step").toBe(1);
    // The originals did not move.
    expect(Object.keys(before.starts).filter((id) => after.starts[id] !== before.starts[id])).toEqual([]);
  });

  test("keyboard edit nudge after select all acts on EVERY selected clip, as one undo step", async ({ page }) => {
    await selectAll(page);
    await page.evaluate(() => (window as any).__openreelE2E.workspace.getState().setTimelineTool("ripple"));
    const clips = (): Promise<Record<string, { start: number; duration: number }>> =>
      page.evaluate(() => {
        const e = (window as any).__openreelE2E;
        return Object.fromEntries(e.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).map((c: any) => [c.id, { start: c.startTime, duration: c.duration }]));
      });
    const before = await clips();
    const historyBefore = await historyLength(page);
    await focusEditor(page);
    const t0 = Date.now();
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await historyLength(page)) - historyBefore, { timeout: 30_000, intervals: [25] }).toBe(1);
    console.log(`[select-all nudge] ripple nudge of ${2 * N} selected clips committed in ${Date.now() - t0} ms`);
    const after = await clips();
    expect(Object.keys(after).length).toBe(2 * N);
    // Not only the last selected clip: the first, a middle and the last clip of both tracks all changed.
    for (const id of ["p-0", "p-500", "p-999", "a-0", "a-500", "a-999"]) {
      expect(Math.abs(after[id].duration - before[id].duration) > 1e-9, `${id} was nudged`).toBe(true);
    }
    const changed = Object.keys(before).filter((id) => Math.abs(after[id].duration - before[id].duration) > 1e-9 || Math.abs(after[id].start - before[id].start) > 1e-9);
    expect(changed.length, "every selected clip's edit moved").toBe(2 * N);
    expect((await historyLength(page)) - historyBefore, "one undo step").toBe(1);
    await undo(page);
    const undone = await clips();
    expect(Object.keys(before).filter((id) => Math.abs(undone[id].start - before[id].start) > 1e-9 || Math.abs(undone[id].duration - before[id].duration) > 1e-9)).toEqual([]);
  });

  test("scrolling to an off-screen selected clip mounts it as selected", async ({ page }) => {
    await selectAll(page);
    expect(await page.locator('[data-timeline-item-id="p-700"]').count(), "p-700 is not mounted before scrolling").toBe(0);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeline-tracks-scroll"]') as HTMLElement;
      el.scrollLeft = 700 * 100 - 200;
    });
    const clip = page.locator('[data-timeline-item-id="p-700"]').first();
    await expect(clip).toBeVisible({ timeout: 10_000 });
    await expect(clip).toHaveAttribute("aria-pressed", "true");
    expect(await mountedClipCount(page)).toBeLessThan(120);
    // Seeking the playhead to a far clip (go-to / follow) keeps the selection intact.
    expect(await selectedCount(page)).toBe(2 * N);
    expect((await allClipIds(page)).length).toBe(2 * N);
  });
});
