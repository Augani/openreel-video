import { expect, test, type Page } from "@playwright/test";
import { boxOf, drag, focusEditor, openEditor, redo, undo } from "./helpers";
import { seedClips } from "./timeline-perf-lib";

/**
 * Independent edge cases for big selections (verifier): full-fidelity undo/redo of batched delete/paste/drag,
 * drag gestures not merging across undo, linked partners of a partial big selection, nudge really acting.
 */
const N = Number(process.env.SELECT_ALL_CLIPS ?? 1000);

const tracksJson = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify((window as any).__openreelE2E.project.getState().project.timeline.tracks.map((t: any) => ({ id: t.id, clips: t.clips }))));
const starts = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const e = (window as any).__openreelE2E;
    return Object.fromEntries(e.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).map((c: any) => [c.id, c.startTime]));
  });
const steps = (page: Page) =>
  page.evaluate(() => {
    const entries = (window as any).__openreelE2E.project.getState().actionExecutor.getHistory().getHistoryEntries() as Array<{ groupId?: string }>;
    let n = 0;
    entries.forEach((e, i) => { if (!e.groupId || entries[i - 1]?.groupId !== e.groupId) n++; });
    return n;
  });
const count = async (page: Page) => Object.keys(await starts(page)).length;

async function selectAll(page: Page) {
  await focusEditor(page);
  await page.keyboard.press("Meta+a");
  await expect.poll(() => page.evaluate(() => (window as any).__openreelE2E.ui.getState().getSelectedClipIds().length), { timeout: 15_000 }).toBe(2 * N);
  await page.waitForTimeout(500);
}

test.describe(`big selection edge cases (${N} clips)`, () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000);
    await openEditor(page);
    await seedClips(page, N);
  });

  test("delete undo is byte-identical (order, every field), redo deletes, undo again restores", async ({ page }) => {
    const original = await tracksJson(page);
    await selectAll(page);
    await focusEditor(page);
    await page.keyboard.press("Delete");
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(0);
    await undo(page);
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(2 * N);
    expect(await tracksJson(page)).toBe(original);
    await redo(page);
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(0);
    await undo(page);
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(2 * N);
    expect(await tracksJson(page)).toBe(original);
  });

  test("drag, undo, drag again: second gesture is its own step and positions are right; two gestures are two steps", async ({ page }) => {
    const original = await tracksJson(page);
    const s0 = await starts(page);
    const base = await steps(page);
    await selectAll(page);
    const box = await boxOf(page, "p-3");
    await drag(page, { x: box.left + 30, y: box.centerY }, 300);
    await page.waitForTimeout(1500);
    expect((await steps(page)) - base).toBe(1);
    await undo(page);
    expect(await tracksJson(page)).toBe(original);
    const box2 = await boxOf(page, "p-3");
    await drag(page, { x: box2.left + 30, y: box2.centerY }, 300);
    await page.waitForTimeout(1500);
    expect((await steps(page)) - base).toBe(1);
    const s1 = await starts(page);
    const d = s1["p-3"] - s0["p-3"];
    expect(d).toBeGreaterThan(2.5);
    expect(Object.keys(s0).filter((id) => Math.abs(s1[id] - s0[id] - d) > 1e-6)).toEqual([]);
    // second gesture right after: distinct step
    const box3 = await boxOf(page, "p-3");
    await drag(page, { x: box3.left + 30, y: box3.centerY }, 200);
    await page.waitForTimeout(1500);
    expect((await steps(page)) - base).toBe(2);
    await undo(page);
    const s2 = await starts(page);
    expect(Object.keys(s1).filter((id) => Math.abs(s2[id] - s1[id]) > 1e-6)).toEqual([]);
    await undo(page);
    expect(await tracksJson(page)).toBe(original);
  });

  test("paste is one step; undo removes every pasted clip, redo restores them", async ({ page }) => {
    const original = await tracksJson(page);
    await selectAll(page);
    await focusEditor(page);
    await page.keyboard.press("Meta+c");
    await page.evaluate((t) => (window as any).__openreelE2E.timeline.getState().seekTo(t), N + 10);
    await page.waitForTimeout(300);
    await focusEditor(page);
    await page.keyboard.press("Meta+v");
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(4 * N);
    const pasted = await tracksJson(page);
    await undo(page);
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(2 * N);
    expect(await tracksJson(page)).toBe(original);
    await redo(page);
    await expect.poll(() => count(page), { timeout: 60_000 }).toBe(4 * N);
    expect(await tracksJson(page)).toBe(pasted);
  });

  test("partial big selection at the end drags its linked partners and nothing else", async ({ page }) => {
    await page.evaluate((n) => {
      const e = (window as any).__openreelE2E;
      const { project } = e.project.getState();
      const tracks = project.timeline.tracks.map((t: any) => ({
        ...t,
        clips: t.clips.map((c: any) => {
          const m = /^([pa])-(\d+)$/.exec(c.id);
          if (!m) return c;
          const i = Number(m[2]);
          return { ...c, linkedClipId: `${m[1] === "p" ? "a" : "p"}-${i}`, linkGroupId: `g-${i}` };
        }),
      }));
      e.project.setState({ project: { ...project, timeline: { ...project.timeline, tracks } } });
    }, N);
    const original = await tracksJson(page);
    const s0 = await starts(page);
    await page.evaluate((n) => {
      const e = (window as any).__openreelE2E;
      const tracks = e.project.getState().project.timeline.tracks;
      const main = tracks.find((t: any) => t.name === "Main");
      const items = Array.from({ length: 40 }, (_, k) => ({ type: "clip", id: `p-${n - 40 + k}`, trackId: main.id }));
      e.ui.getState().selectMultiple(items);
      (document.querySelector('[data-testid="timeline-tracks-scroll"]') as HTMLElement).scrollLeft = (n - 25) * 100;
    }, N);
    await page.waitForTimeout(800);
    const id = `p-${N - 20}`;
    const box = await boxOf(page, id);
    await drag(page, { x: box.left + 30, y: box.centerY }, 300);
    await page.waitForTimeout(1500);
    const s1 = await starts(page);
    const d = s1[id] - s0[id];
    expect(d).toBeGreaterThan(2.5);
    const moved = Object.keys(s0).filter((k) => Math.abs(s1[k] - s0[k]) > 1e-6);
    const expected = new Set<string>();
    for (let k = N - 40; k < N; k++) { expected.add(`p-${k}`); expected.add(`a-${k}`); }
    expect(new Set(moved)).toEqual(expected);
    for (const k of moved) expect(s1[k] - s0[k]).toBeCloseTo(d, 6);
    await undo(page);
    expect(await tracksJson(page)).toBe(original);
  });

  test("ripple nudge after select all really changes the timeline and undoes exactly", async ({ page }) => {
    const original = await tracksJson(page);
    await selectAll(page);
    await page.evaluate(() => (window as any).__openreelE2E.workspace.getState().setTimelineTool("ripple"));
    await focusEditor(page);
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForTimeout(800);
    const after = await tracksJson(page);
    expect(after, "the nudge changed the timeline").not.toBe(original);
    // The whole selection moved, not one clip: far clips of both tracks differ from the original.
    const parse = (json: string): Record<string, { duration: number }> => Object.fromEntries(JSON.parse(json).flatMap((t: any) => t.clips.map((c: any) => [c.id, c])));
    const a = parse(after);
    const o = parse(original);
    for (const id of ["p-0", "p-999", "a-0", "a-999"]) expect(a[id].duration, `${id} was nudged`).not.toBe(o[id].duration);
    await undo(page);
    expect(await tracksJson(page)).toBe(original);
  });
});
