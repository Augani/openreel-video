import { expect, test, type Page } from "@playwright/test";
import {
  FRAME,
  boxOf,
  clickClip,
  clipLocator,
  drag,
  openEditor,
  press,
  readState,
  redo,
  seek,
  setZoom,
  settle,
  splitIntoThree,
  undo,
  type ClipState,
  type EditorState,
} from "./helpers";
import { SOFTWARE_GPU } from "./env";

const PPS = 100; // 12 frames = 0.4s = exactly 40px
const TWELVE = 12 * FRAME;

const videoOf = (s: EditorState): ClipState[] =>
  [...s.tracks.find((t) => t.name === "Main")!.clips].sort((a, b) => a.start - b.start);
const audioOf = (s: EditorState): ClipState[] =>
  [...s.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips)].sort((a, b) => a.start - b.start);

interface Pair {
  v: ClipState[];
  a: ClipState[];
}
const pair = async (page: Page): Promise<Pair> => {
  const s = await readState(page);
  return { v: videoOf(s), a: audioOf(s) };
};
const snapshot = (p: Pair) =>
  JSON.stringify([p.v, p.a].map((list) => list.map((c) => [c.start, c.duration, c.inPoint, c.outPoint])));

/**
 * Import the fixture, separate its audio onto a linked audio clip, then split
 * both into three 2s pairs. Cut 1 is at 2s, cut 2 at 4s.
 */
async function linkedPairs(page: Page): Promise<Pair> {
  await openEditor(page);
  const clip = videoOf(await readState(page))[0];
  // Separating audio runs ffmpeg.wasm, whose core is fetched from a CDN. On a slow or flaky network that fetch can
  // fail (CI saw a truncated wasm body: "FFmpeg load error", separateAudio resolved {success:false}). The result used
  // to be ignored, so the test just waited out 30 s for audio that was never coming. Retry until the call succeeds
  // (each attempt re-loads ffmpeg from scratch) and report the last failure if it never does.
  let last: unknown;
  await expect
    .poll(
      async () => {
        last = await page.evaluate(
          (id) =>
            (window as unknown as { __openreelE2E: { project: { getState(): { separateAudio(id: string): Promise<{ success: boolean }> } } } })
              .__openreelE2E.project.getState().separateAudio(id).catch((e: unknown) => ({ success: false, error: String(e) })),
          clip.id,
        );
        return (last as { success: boolean }).success || (await pair(page)).a.length === 1;
      },
      { timeout: SOFTWARE_GPU ? 120_000 : 60_000, intervals: [0, 2_000, 5_000], message: () => `separateAudio never succeeded: ${JSON.stringify(last)}` },
    )
    .toBe(true);
  await expect.poll(async () => (await pair(page)).a.length, { timeout: 30_000 }).toBe(1);
  await splitIntoThree(page);
  await expect.poll(async () => (await pair(page)).a.length, { timeout: 10_000 }).toBe(3);
  await setZoom(page, PPS);
  return pair(page);
}

/** The clip's trim handle, near the top so video's "+" transition button at the cut is not hit. */
async function handle(page: Page, id: string, where: "left" | "right") {
  const box = await clipLocator(page, id).boundingBox();
  if (!box) throw new Error(`clip ${id} not visible`);
  return { x: where === "left" ? box.x + 3 : box.x + box.width - 3, y: box.y + 10 };
}

async function altDrag(page: Page, id: string, where: "left" | "right", pixels: number) {
  const from = await handle(page, id, where);
  await page.keyboard.down("Alt");
  try {
    await drag(page, from, pixels);
  } finally {
    await page.keyboard.up("Alt");
  }
  await settle(page, 300);
}

/** The video cut is untouched and the audio cut moved by `frames` frames. */
function expectAudioCutMoved(before: Pair, after: Pair, frames: number) {
  const d = frames * FRAME;
  expect(JSON.stringify(after.v), "video clips untouched").toBe(JSON.stringify(before.v));
  expect(after.v[0].start + after.v[0].duration, "video cut").toBeCloseTo(2, 6);
  expect(after.v[1].start, "video cut (next clip)").toBeCloseTo(2, 6);
  expect(after.a[0].start + after.a[0].duration, "audio cut").toBeCloseTo(2 + d, 6);
  expect(after.a[1].start, "audio cut (next clip)").toBeCloseTo(2 + d, 6);
  // Source stays in sync: the next audio clip's head advances by exactly the cut move.
  expect(after.a[1].inPoint).toBeCloseTo(before.a[1].inPoint + d, 6);
  expect(after.a[0].outPoint).toBeCloseTo(before.a[0].outPoint + d, 6);
  // Cut 2 and the far ends are not disturbed.
  expect(after.a[1].start + after.a[1].duration).toBeCloseTo(4, 6);
  expect(after.a[2].start).toBeCloseTo(4, 6);
  expect(after.a[2].duration).toBeCloseTo(2, 6);
}

async function expectOneUndoStep(page: Page, before: Pair, historyBefore: number) {
  const s = await readState(page);
  expect(s.historyLength - historyBefore, "exactly one history entry").toBe(1);
  const after = await pair(page);
  await undo(page);
  expect(snapshot(await pair(page)), "undo restores exactly").toBe(snapshot(before));
  await redo(page);
  expect(snapshot(await pair(page)), "redo reapplies exactly").toBe(snapshot(after));
  await undo(page);
  expect(snapshot(await pair(page))).toBe(snapshot(before));
}

test.describe("Premiere-parity: split edits (J/L cuts)", () => {
  test("Alt-drag an audio edge makes a 12-frame L-cut; only the audio cut moves", async ({ page }) => {
    const before = await linkedPairs(page);
    expect(before.v.map((c) => c.duration)).toEqual(before.a.map((c) => c.duration));
    const historyBefore = (await readState(page)).historyLength;

    await altDrag(page, before.a[0].id, "right", 0.4 * PPS);

    const after = await pair(page);
    expectAudioCutMoved(before, after, 12);

    // The pair stays linked and the offset is shown on the audio clip.
    const badge = clipLocator(page, after.a[0].id).locator('[data-split-edit-offset="end"]');
    await expect(badge).toHaveText("L +12f");
    await expect(clipLocator(page, after.a[1].id).locator('[data-split-edit-offset="start"]')).toHaveText("L +12f");
    await expect(clipLocator(page, after.v[0].id).locator("[data-split-edit-offset]")).toHaveCount(0);

    await expectOneUndoStep(page, before, historyBefore);
  });

  test("Alt-drag the next clip's audio head makes a J-cut (audio leads); video can be offset the same way", async ({ page }) => {
    const before = await linkedPairs(page);
    const historyBefore = (await readState(page)).historyLength;

    await altDrag(page, before.a[1].id, "left", -0.4 * PPS);
    const after = await pair(page);
    expect(JSON.stringify(after.v)).toBe(JSON.stringify(before.v));
    expect(after.a[0].start + after.a[0].duration).toBeCloseTo(2 - TWELVE, 6);
    expect(after.a[1].start).toBeCloseTo(2 - TWELVE, 6);
    expect(after.a[1].inPoint).toBeCloseTo(before.a[1].inPoint - TWELVE, 6);
    await expect(clipLocator(page, after.a[1].id).locator('[data-split-edit-offset="start"]')).toHaveText("J −12f");
    await expectOneUndoStep(page, before, historyBefore);
  });

  test("Alt-drag the picture's edge rolls only the video cut", async ({ page }) => {
    const before = await linkedPairs(page);
    const historyBefore = (await readState(page)).historyLength;
    await altDrag(page, before.v[0].id, "right", 0.2 * PPS);
    const after = await pair(page);
    expect(JSON.stringify(after.a)).toBe(JSON.stringify(before.a));
    expect(after.v[0].duration).toBeCloseTo(2 + 6 * FRAME, 6);
    expect(after.v[1].start).toBeCloseTo(2 + 6 * FRAME, 6);
    expect(after.v[1].inPoint).toBeCloseTo(before.v[1].inPoint + 6 * FRAME, 6);
    // The audio now leads the picture's cut by 6 frames: shown on the audio clip.
    await expect(clipLocator(page, after.a[0].id).locator('[data-split-edit-offset="end"]')).toHaveText("J \u22126f");
    await expectOneUndoStep(page, before, historyBefore);
  });

  test("a plain edge drag still trims the linked pair together", async ({ page }) => {
    const before = await linkedPairs(page);
    const from = await handle(page, before.v[2].id, "right");
    await drag(page, from, -0.5 * PPS);
    const after = await pair(page);
    expect(after.v[2].duration).toBeCloseTo(1.5, 1);
    expect(after.a[2].duration).toBeCloseTo(after.v[2].duration, 3);
  });

  test("context menu on the cut: L-cut by the default 12 frames", async ({ page }) => {
    const before = await linkedPairs(page);
    const historyBefore = (await readState(page)).historyLength;

    const box = await boxOf(page, before.a[0].id);
    await page.mouse.click(box.left + 40, box.centerY, { button: "right" });
    const item = page.getByRole("menuitem", { name: /L-cut/ });
    await expect(item).toContainText("12f");
    await item.click();
    await settle(page);

    expectAudioCutMoved(before, await pair(page), 12);
    await expectOneUndoStep(page, before, historyBefore);
  });

  test("context menu J-cut and a custom length", async ({ page }) => {
    const before = await linkedPairs(page);
    const box = await boxOf(page, before.v[1].id);
    await page.mouse.click(box.left + 40, box.centerY, { button: "right" });
    await page.getByRole("menuitem", { name: /Split edit length/ }).hover();
    await page.getByRole("menuitemradio", { name: "24 frames" }).click();
    await page.keyboard.press("Escape");
    await page.mouse.click(box.left + 40, box.centerY, { button: "right" });
    const jCut = page.getByRole("menuitem", { name: /J-cut/ });
    await expect(jCut).toContainText("24f");
    await jCut.click();
    await settle(page);
    const after = await pair(page);
    // v[1] has a cut on both sides; the playhead (left at 4s) picks the tail cut.
    expect(JSON.stringify(after.v)).toBe(JSON.stringify(before.v));
    expect(after.a[1].start + after.a[1].duration).toBeCloseTo(4 - 24 * FRAME, 6);
    expect(after.a[2].start).toBeCloseTo(4 - 24 * FRAME, 6);
    expect(after.a[1].start).toBeCloseTo(2, 6);
  });

  test("Alt+L / Alt+J keyboard commands make the split edit on the selected clip", async ({ page }) => {
    const before = await linkedPairs(page);
    const historyBefore = (await readState(page)).historyLength;
    await clickClip(page, before.a[0].id);
    await seek(page, 1.9);
    await press(page, "Alt+l");
    expectAudioCutMoved(before, await pair(page), 12);
    await expectOneUndoStep(page, before, historyBefore);
  });

  test("E extends the edit to the playhead; Shift+E video only; Alt+E audio only", async ({ page }) => {
    const before = await linkedPairs(page);
    await clickClip(page, before.v[0].id);
    await seek(page, 2.5);
    const historyBefore = (await readState(page)).historyLength;

    await press(page, "e");
    const both = await pair(page);
    expect(both.v[0].duration).toBeCloseTo(2.5, 6);
    expect(both.v[1].start).toBeCloseTo(2.5, 6);
    expect(both.a[0].duration).toBeCloseTo(2.5, 6);
    expect(both.a[1].start).toBeCloseTo(2.5, 6);
    expect((await readState(page)).historyLength - historyBefore).toBe(1);
    await undo(page);
    expect(snapshot(await pair(page))).toBe(snapshot(before));

    await seek(page, 2.5);
    await clickClip(page, before.v[0].id);
    await press(page, "Shift+e");
    const video = await pair(page);
    expect(video.v[0].duration).toBeCloseTo(2.5, 6);
    expect(JSON.stringify(video.a)).toBe(JSON.stringify(before.a));
    await undo(page);

    await seek(page, 1.5);
    await clickClip(page, before.v[0].id);
    await press(page, "Alt+e");
    const audio = await pair(page);
    expect(audio.a[0].duration).toBeCloseTo(1.5, 6);
    expect(audio.a[1].start).toBeCloseTo(1.5, 6);
    expect(JSON.stringify(audio.v)).toBe(JSON.stringify(before.v));
    await undo(page);
    expect(snapshot(await pair(page))).toBe(snapshot(before));
  });

  test("Alt+, / Alt+. nudge only the selected clip's side of the edit", async ({ page }) => {
    const before = await linkedPairs(page);
    await clickClip(page, before.a[0].id);
    await seek(page, 1.9);
    const historyBefore = (await readState(page)).historyLength;
    await press(page, "Alt+.");
    await page.waitForTimeout(800);
    const after = await pair(page);
    expect(JSON.stringify(after.v)).toBe(JSON.stringify(before.v));
    expect(after.a[0].duration).toBeCloseTo(2 + FRAME, 6);
    expect(after.a[1].start).toBeCloseTo(2 + FRAME, 6);
    expect((await readState(page)).historyLength - historyBefore).toBe(1);
    await press(page, "Alt+Shift+,");
    await page.waitForTimeout(800);
    expect((await pair(page)).a[0].duration).toBeCloseTo(2 + FRAME - 5 * FRAME, 6);
    await undo(page);
    await undo(page);
    expect(snapshot(await pair(page))).toBe(snapshot(before));
  });
});
