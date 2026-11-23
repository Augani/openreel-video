import { expect, test, type Page } from "@playwright/test";
import { clipsOf, openEditor, press, readState, redo, undo } from "./helpers";

/**
 * Premiere "1000+ clip" measurement in the real editor: a 1000-clip sequence,
 * Select All, then the real Speed/Duration dialog with Ripple Edit, and a
 * ripple delete. Two times are reported: the store commit alone (validate +
 * apply + history, measured by wrapping commitTimelineToolEdit) and click to
 * committed state. The second includes the Vite dev server's React, whose dev
 * build logs every re-rendered component to the performance timeline (a CPU
 * profile showed ~3 s of the ~5 s of the speed edit in logComponentRender and
 * its helpers), so it is bounded loosely and only the commit time is tight.
 * Each is one undo step.
 */
const COUNT = 1000;
const LEN = 0.5;
const COMMIT_BOUND_MS = 1000;
/** Dev-server React overhead dominates the wall time; this only catches hangs and quadratic blowups. */
const WALL_BOUND_MS = 20_000;

/** Wrap the store's commit so the spec can read how long it took (planning is a few ms of core work before it). */
async function timeCommits(page: Page): Promise<void> {
  await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(s: unknown): void } } }).__openreelE2E;
    const original = e.project.getState().commitTimelineToolEdit;
    (window as unknown as { __commitMs: number[] }).__commitMs = [];
    e.project.setState({
      commitTimelineToolEdit: (...args: unknown[]) => {
        const t = performance.now();
        try {
          return original(...args);
        } finally {
          (window as unknown as { __commitMs: number[] }).__commitMs.push(performance.now() - t);
        }
      },
    });
  });
}
const commitMs = (page: Page) => page.evaluate(() => (window as unknown as { __commitMs: number[] }).__commitMs.at(-1) ?? -1);

async function buildThousand(page: Page): Promise<void> {
  await openEditor(page);
  const ok = await page.evaluate(
    ({ count, len }) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(s: unknown): void } } }).__openreelE2E;
      const project = e.project.getState().project;
      const main = project.timeline.tracks.find((t: any) => t.type === "video" && t.clips.length);
      if (!main) return false;
      const template = main.clips[0];
      const clips = Array.from({ length: count }, (_, i) => ({
        ...structuredClone(template),
        id: `scale-${i}`,
        trackId: main.id,
        startTime: i * len,
        duration: len,
        inPoint: 0,
        outPoint: len,
        speed: 1,
      }));
      e.project.setState({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            duration: count * len,
            tracks: project.timeline.tracks.map((t: any) => (t.id === main.id ? { ...t, clips } : t)),
          },
        },
      });
      return true;
    },
    { count: COUNT, len: LEN },
  );
  expect(ok).toBe(true);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(COUNT);
  await timeCommits(page);
}

test.describe("Premiere-parity: 1000-clip sequence", () => {
  // The dev server re-renders 1000 clips with React's dev build after each edit; give a loaded machine room.
  test.setTimeout(240_000);
  test("Speed/Duration with ripple on 1000 selected clips is one fast undo step", async ({ page }) => {
    await buildThousand(page);
    await page.evaluate((count) => {
      const e = (window as unknown as { __openreelE2E: { ui: { getState(): any } } }).__openreelE2E;
      e.ui.getState().selectMultiple(Array.from({ length: count }, (_, i) => ({ type: "clip", id: `scale-${i}` })));
    }, COUNT);
    const before = await readState(page);
    await press(page, "Meta+Alt+r");
    const dialog = page.getByRole("dialog", { name: /speed \/ duration/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Speed percent").fill("200");
    const started = Date.now();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect
      .poll(async () => clipsOf(await readState(page), "Main")[COUNT - 1].start, { timeout: 120_000 })
      .toBeCloseTo((COUNT - 1) * (LEN / 2), 2);
    const took = Date.now() - started;
    const commit = await commitMs(page);
    console.log(`E2E ripple-speed ${COUNT} clips: store commit ${commit.toFixed(0)} ms, click to committed state ${took} ms`);
    const after = await readState(page);
    expect(after.historyLength - before.historyLength, "one history entry").toBe(1);
    const clips = clipsOf(after, "Main");
    expect(clips.every((c) => Math.abs(c.speed - 2) < 1e-6 && Math.abs(c.duration - LEN / 2) < 1e-6)).toBe(true);
    expect(commit, "the store commit was timed").toBeGreaterThan(0);
    expect(commit).toBeLessThan(COMMIT_BOUND_MS);
    expect(took).toBeLessThan(WALL_BOUND_MS);

    await undo(page);
    expect(clipsOf(await readState(page), "Main")[COUNT - 1].start).toBeCloseTo((COUNT - 1) * LEN, 3);
    await redo(page);
    expect(clipsOf(await readState(page), "Main")[COUNT - 1].start).toBeCloseTo((COUNT - 1) * (LEN / 2), 3);
  });

  test("ripple delete of 500 of 1000 clips closes every gap in one fast undo step", async ({ page }) => {
    await buildThousand(page);
    await page.evaluate((count) => {
      const e = (window as unknown as { __openreelE2E: { ui: { getState(): any } } }).__openreelE2E;
      e.ui.getState().selectMultiple(
        Array.from({ length: count / 2 }, (_, i) => ({ type: "clip", id: `scale-${i * 2}` })),
      );
    }, COUNT);
    const before = await readState(page);
    const started = Date.now();
    await press(page, "Shift+Delete");
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 120_000 }).toBe(COUNT / 2);
    const took = Date.now() - started;
    const commit = await commitMs(page);
    console.log(`E2E ripple-delete ${COUNT / 2} of ${COUNT} clips: store commit ${commit.toFixed(0)} ms, key press to committed state ${took} ms`);
    const after = await readState(page);
    expect(after.historyLength - before.historyLength, "one history entry").toBe(1);
    const clips = clipsOf(after, "Main");
    expect(clips[clips.length - 1].start).toBeCloseTo((COUNT / 2 - 1) * LEN, 3);
    expect(commit, "the store commit was timed").toBeGreaterThan(0);
    expect(commit).toBeLessThan(COMMIT_BOUND_MS);
    expect(took).toBeLessThan(WALL_BOUND_MS);
    await undo(page);
    expect(clipsOf(await readState(page), "Main")).toHaveLength(COUNT);
  });
});
