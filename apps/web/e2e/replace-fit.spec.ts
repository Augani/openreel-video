import { expect, test, type Page } from "@playwright/test";
import {
  clickClip,
  clipsOf,
  openEditor,
  readSource,
  readState,
  seek,
  settle,
  shape,
  splitIntoThree,
  undo,
  redo,
} from "./helpers";

const MEDIA = "Select media three-scenes.mp4";

type E2E = { __openreelE2E: Record<string, { getState(): any }> };

async function openSource(page: Page) {
  await page.getByLabel(MEDIA).dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await expect.poll(async () => (await readSource(page)).tab).toBe("source");
  await settle(page, 500);
}

async function sourceSeek(page: Page, seconds: number) {
  await page.evaluate((t) => {
    const s = (window as unknown as E2E).__openreelE2E.source.getState();
    s.stop();
    s.setPosition(t);
  }, seconds);
  await settle(page, 300);
}

async function markSource(page: Page, inAt: number, outAt: number) {
  await page.evaluate(
    ([a, b]) => {
      const s = (window as unknown as E2E).__openreelE2E.source.getState();
      s.setMark(s.mediaId, "in", a);
      s.setMark(s.mediaId, "out", b);
    },
    [inAt, outAt],
  );
  await settle(page, 200);
}

async function setSequenceRange(page: Page, start: number, end: number) {
  await page.evaluate(
    ([a, b]) => (window as unknown as E2E).__openreelE2E.timeline.getState().setLoopRange(a, b),
    [start, end],
  );
  await settle(page, 200);
}

async function targetTrack(page: Page, name: string) {
  await page.getByRole("button", { name: `Target ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Untarget ${name}`, exact: true })).toHaveAttribute("aria-pressed", "true");
}

test.describe("Replace edit and Fit to Fill", () => {
  test("Fit to Fill retimes the source range to the timeline range in one undoable step", async ({ page }) => {
    await openEditor(page);
    await openSource(page);
    await markSource(page, 1, 5);
    await targetTrack(page, "B-roll");

    // Without timeline In/Out the command is unavailable and says why.
    await expect(page.getByTestId("fit-to-fill")).toBeDisabled();
    await setSequenceRange(page, 1, 3);
    await expect(page.getByTestId("fit-to-fill")).toBeEnabled();
    const before = await readState(page);

    await page.getByTestId("fit-to-fill").click();
    await settle(page, 500);
    const after = await readState(page);
    // 4s of source into 2s of timeline: twice as fast.
    expect(shape(clipsOf(after, "B-roll"))).toEqual([[1, 2, 1, 5]]);
    expect(clipsOf(after, "B-roll")[0].speed).toBe(2);
    expect(shape(clipsOf(after, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(after.historyLength).toBe(before.historyLength + 1);

    await undo(page);
    const undone = await readState(page);
    expect(clipsOf(undone, "B-roll")).toHaveLength(0);
    expect(undone.historyLength).toBe(before.historyLength);
    await redo(page);
    expect(clipsOf(await readState(page), "B-roll")[0].speed).toBe(2);
  });

  test("Alt+Shift+F fits to fill from the keyboard", async ({ page }) => {
    await openEditor(page);
    await openSource(page);
    await markSource(page, 0, 1);
    await targetTrack(page, "B-roll");
    await setSequenceRange(page, 2, 4);
    await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
    await page.keyboard.press("Alt+Shift+F");
    await settle(page, 500);
    const clips = clipsOf(await readState(page), "B-roll");
    expect(shape(clips)).toEqual([[2, 2, 0, 1]]);
    expect(clips[0].speed).toBeCloseTo(0.5, 5);
  });

  test("Replace swaps the selected clip's footage, keeps its place and length, aligns playheads; one undo", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    const before = await readState(page);
    const middle = clipsOf(before, "Main")[1];
    expect(shape([middle])).toEqual([[2, 2, 2, 4]]);

    await openSource(page);
    await clickClip(page, middle.id);
    // Timeline playhead 0.5s into the clip; the Source frame at 1.5s sits there.
    await seek(page, 2.5);
    await sourceSeek(page, 1.5);
    await page.getByTestId("replace-edit").click();
    await settle(page, 500);

    const after = await readState(page);
    const clips = clipsOf(after, "Main");
    expect(clips.map((c) => c.id)).toEqual(clipsOf(before, "Main").map((c) => c.id));
    expect(shape(clips)).toEqual([[0, 2, 0, 2], [2, 2, 1, 3], [4, 2, 4, 6]]);
    expect(after.historyLength).toBe(before.historyLength + 1);

    await undo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(clipsOf(before, "Main")));
    await redo(page);
    expect(shape(clipsOf(await readState(page), "Main"))[1]).toEqual([2, 2, 1, 3]);
  });

  test("Replace refuses a source that is too short and leaves the timeline alone", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    const middle = clipsOf(await readState(page), "Main")[1];
    await openSource(page);
    await clickClip(page, middle.id);
    await seek(page, 2);
    await sourceSeek(page, 5.5);
    const before = await readState(page);
    await page.getByTestId("replace-edit").click();
    await settle(page, 400);
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(after.historyLength).toBe(before.historyLength);
    await expect(page.getByText(/from that point/)).toBeVisible();
  });
});
