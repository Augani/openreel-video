import { expect, test, type Page } from "@playwright/test";
import {
  clipLocator,
  clipsOf,
  openEditor,
  press,
  programMean,
  readState,
  redo,
  seek,
  setZoom,
  shape,
  snapStable,
  diffSnaps,
  splitIntoThree,
  undo,
  waitForPresentedPlayhead,
  type ClipState,
} from "./helpers";

/**
 * Dynamic (JKL) trimming previews the trimmed result on the Program monitor. The fixture's
 * scenes are testsrc2 (0-2 s), solid red (2-4 s) and SMPTE bars (4-6 s) as three adjacent clips
 * cut from one source, so source frames continue across the cuts.
 *
 * Contiguous splits of one source cannot tell "the trimmed clip's extended frame" from "the next clip's
 * frame at the same time" (they are the same pixels), so the right-edge test opens a gap first: the stored
 * timeline is empty (black) where the extended clip's last frame must appear.
 */
const isRed = ([r, g, b]: [number, number, number]) => r > 150 && g < 80 && b < 80;
const isBlack = ([r, g, b]: [number, number, number]) => r < 12 && g < 12 && b < 12;

async function threeClips(page: Page): Promise<ClipState[]> {
  await openEditor(page);
  await splitIntoThree(page);
  await setZoom(page, 100);
  return clipsOf(await readState(page), "Main");
}

async function selectEdge(page: Page, clipId: string, edge: "left" | "right"): Promise<void> {
  const handle = clipLocator(page, clipId).locator(`[data-timeline-trim="${edge}"]`);
  await handle.click();
  await expect(handle).toHaveAttribute("data-edit-point-selected", /ripple|roll/);
}

/** Mean RGB of the middle of one two-up half (the overlay canvases hold captures of the Program frame). */
async function halfMean(page: Page, testId: "dynamic-trim-outgoing" | "dynamic-trim-incoming"): Promise<[number, number, number]> {
  return page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement | null;
    if (!c || c.width === 0) return [-1, -1, -1] as [number, number, number];
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const d = g.getImageData(c.width * 0.25, c.height * 0.25, c.width * 0.5, c.height * 0.5).data;
    let r = 0, gg = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [r / n, gg / n, b / n] as [number, number, number];
  }, testId);
}

test.describe("Premiere-parity: dynamic trim live monitor", () => {
  test("L previews the trimmed first frame while nothing is saved, Esc restores exactly", async ({ page }) => {
    const [a] = await threeClips(page);
    await seek(page, 0);
    await waitForPresentedPlayhead(page);
    const before = await readState(page);
    await snapStable(page, "before");

    // A free left edge ripples: the clip keeps its start, so the playhead stays on 0 and only the
    // live trimmed preview (a later source frame of the counter scene) can change the picture.
    await selectEdge(page, a.id, "left");
    await press(page, "l");
    await page.waitForTimeout(600);
    await waitForPresentedPlayhead(page);
    await snapStable(page, "during");

    const during = await readState(page);
    expect(during.playhead, "playhead sits on the clip's first frame").toBeCloseTo(0, 4);
    expect(shape(clipsOf(during, "Main")), "nothing written while trimming").toEqual(shape(clipsOf(before, "Main")));
    expect(during.historyLength).toBe(before.historyLength);
    expect((await diffSnaps(page, "before", "during")).changed, "monitor frame changed").toBeGreaterThan(1000);

    await press(page, "Escape");
    await waitForPresentedPlayhead(page);
    await snapStable(page, "after");
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(after.historyLength).toBe(before.historyLength);
    expect(after.playhead).toBeCloseTo(before.playhead, 4);
    expect((await diffSnaps(page, "before", "after")).changed, "frame restored exactly").toBe(0);
  });

  test("a right edge extended into a gap shows the clip's new last frame, which the stored timeline lacks", async ({ page }) => {
    const [a, b] = await threeClips(page);
    // Lift the red clip: Main is now testsrc2 (0-2), a 2 s gap, bars (4-6).
    await clipLocator(page, b.id).click();
    await press(page, "Delete");
    await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(2);
    await seek(page, 1);
    await waitForPresentedPlayhead(page);
    const before = await readState(page);

    await selectEdge(page, a.id, "right");
    await press(page, "l");
    await expect
      .poll(async () => (await readState(page)).playhead, "playhead on the extended clip's last frame")
      .toBeGreaterThan(a.start + a.duration + 0.1);
    const during = await readState(page);
    expect(during.playhead).toBeLessThan(4);
    expect(shape(clipsOf(during, "Main")), "nothing written while trimming").toEqual(shape(clipsOf(before, "Main")));
    // The extended clip pulls the source's red scene past 2 s. The stored timeline is empty at this time.
    await expect.poll(async () => isRed(await programMean(page)), "monitor shows the trimmed (red) frame").toBe(true);

    await press(page, "Escape");
    await waitForPresentedPlayhead(page);
    expect(isRed(await programMean(page)), "testsrc2 is back, not the trimmed frame").toBe(false);
    expect(isBlack(await programMean(page))).toBe(false);
    expect((await readState(page)).playhead).toBeCloseTo(1, 4);
  });

  test("a trim at a cut shows outgoing | incoming two-up, and it goes away on Esc", async ({ page }) => {
    const [a] = await threeClips(page);
    await seek(page, 1);
    await waitForPresentedPlayhead(page);
    await selectEdge(page, a.id, "right");
    await expect(page.getByTestId("dynamic-trim-two-up")).toHaveCount(0);

    await press(page, "l");
    await expect(page.getByTestId("dynamic-trim-two-up")).toBeVisible();
    // Extending testsrc2 past 2 s pulls the red scene in: both halves of the trimmed cut are red.
    await expect.poll(async () => isRed(await halfMean(page, "dynamic-trim-outgoing")), "outgoing half is the extended clip's last frame").toBe(true);
    await expect.poll(async () => isRed(await halfMean(page, "dynamic-trim-incoming")), "incoming half is the next clip's first frame").toBe(true);

    await press(page, "Escape");
    await expect(page.getByTestId("dynamic-trim-two-up")).toHaveCount(0);
    expect((await readState(page)).playhead).toBeCloseTo(1, 4);
  });

  test("a free edge has no neighbour, so it keeps the single Program frame", async ({ page }) => {
    const [a] = await threeClips(page);
    await seek(page, 0);
    await selectEdge(page, a.id, "left");
    await press(page, "l");
    await page.waitForTimeout(400);
    await expect(page.getByTestId("dynamic-trim-two-up")).toHaveCount(0);
    await press(page, "Escape");
  });

  test("K commits the previewed trim as one undo step and the monitor shows the committed frame", async ({ page }) => {
    const clips = await threeClips(page);
    const [, b] = clips;
    await seek(page, 3);
    await selectEdge(page, b.id, "right");
    const before = await readState(page);

    await press(page, "l");
    await expect
      .poll(async () => (await readState(page)).playhead)
      .toBeGreaterThan(b.start + b.duration + 0.1);
    await expect(page.getByTestId("dynamic-trim-two-up")).toBeVisible();
    await press(page, "k");
    await expect(page.getByTestId("dynamic-trim-two-up"), "preview is gone after K").toHaveCount(0);
    await waitForPresentedPlayhead(page);
    await snapStable(page, "committed");

    const committed = await readState(page);
    expect(committed.historyLength - before.historyLength, "one history entry").toBe(1);
    const afterClips = clipsOf(committed, "Main");
    expect(shape(afterClips)).not.toEqual(shape(clips));
    expect(afterClips[1].start + afterClips[1].duration).toBeGreaterThan(b.start + b.duration);

    // The monitor after K is the stored timeline's frame at the playhead: the same pixels as a fresh seek there.
    await seek(page, 0);
    await waitForPresentedPlayhead(page);
    await seek(page, committed.playhead);
    await waitForPresentedPlayhead(page);
    await snapStable(page, "reseek");
    expect((await diffSnaps(page, "committed", "reseek")).changed, "monitor == committed timeline").toBe(0);
    expect(isRed(await programMean(page)), "past the red scene's old end, the bars show").toBe(false);

    await undo(page);
    expect(shape(clipsOf(await readState(page), "Main")), "undo restores exactly").toEqual(shape(clips));
    await redo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(afterClips));
  });
});
