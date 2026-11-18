import { expect, test, type Page } from "@playwright/test";
import {
  FRAME,
  boxOf,
  clickClip,
  clipsOf,
  drag,
  openEditor,
  press,
  readState,
  redo,
  seek,
  setZoom,
  shape,
  splitIntoThree,
  undo,
  type ClipState,
} from "./helpers";

const PPS = 100; // pixels per second while dragging, so 1 frame is ~3.3px

async function threeClips(page: Page): Promise<ClipState[]> {
  await openEditor(page);
  await splitIntoThree(page);
  await setZoom(page, PPS);
  return clipsOf(await readState(page), "Main");
}

/** Mouse position for a clip's left/right trim handle or its body. */
async function handlePoint(page: Page, id: string, where: "left" | "right" | "body") {
  const b = await boxOf(page, id);
  const x = where === "left" ? b.left + 3 : where === "right" ? b.right - 3 : (b.left + b.right) / 2;
  return { x, y: b.centerY };
}

/** Run a gesture, then prove it is exactly one undo step that redo reapplies. */
async function expectSingleUndoStep(
  page: Page,
  before: ClipState[],
  gesture: () => Promise<void>,
): Promise<ClipState[]> {
  const startState = await readState(page);
  await gesture();
  const after = await readState(page);
  const afterClips = clipsOf(after, "Main");
  expect(shape(afterClips), "gesture must change the timeline").not.toEqual(shape(before));
  expect(after.historyLength - startState.historyLength, "one history entry").toBe(1);

  await undo(page);
  expect(shape(clipsOf(await readState(page), "Main")), "undo restores exactly").toEqual(shape(before));
  await redo(page);
  expect(shape(clipsOf(await readState(page), "Main")), "redo reapplies exactly").toEqual(shape(afterClips));
  return afterClips;
}

test.describe("Premiere-parity: trim tools", () => {
  test("tool hotkeys select Ripple, Slip, Roll, Slide and Rate Stretch", async ({ page }) => {
    await openEditor(page);
    const keys: Array<[string, string]> = [
      ["r", "ripple"],
      ["y", "slip"],
      ["Shift+N", "roll"],
      ["u", "slide"],
      ["Shift+R", "stretch"],
      ["v", "select"],
    ];
    for (const [key, tool] of keys) {
      await press(page, key);
      expect((await readState(page)).tool, `${key} -> ${tool}`).toBe(tool);
    }
  });

  test("Ripple: dragging a clip's end shortens it and pulls later clips in", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await clickClip(page, a.id);
    await press(page, "r");
    const after = await expectSingleUndoStep(page, [a, b, c], async () => {
      const from = await handlePoint(page, a.id, "right");
      await drag(page, from, -0.5 * PPS);
    });
    expect(after[0].duration).toBeCloseTo(1.5, 1);
    expect(after[0].outPoint).toBeCloseTo(1.5, 1);
    expect(after[1].start).toBeCloseTo(1.5, 1);
    expect(after[2].start).toBeCloseTo(3.5, 1);
    // Later clips keep their own length and source window.
    expect(after[1].duration).toBeCloseTo(2, 2);
    expect(after[1].inPoint).toBeCloseTo(2, 2);
  });

  test("Slip: dragging a clip's body moves its source window, not its position", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await press(page, "y");
    const after = await expectSingleUndoStep(page, [a, b, c], async () => {
      const from = await handlePoint(page, b.id, "body");
      await drag(page, from, 0.5 * PPS);
    });
    expect(after[1].start).toBeCloseTo(b.start, 3);
    expect(after[1].duration).toBeCloseTo(b.duration, 3);
    // Dragging right pulls earlier source into view.
    expect(after[1].inPoint).toBeCloseTo(b.inPoint - 0.5, 1);
    expect(after[1].outPoint).toBeCloseTo(b.outPoint - 0.5, 1);
    expect(after[0].duration).toBeCloseTo(a.duration, 3);
    expect(after[2].start).toBeCloseTo(c.start, 3);
  });

  test("Rolling edit (Shift+N): moving a cut trades length between its two clips", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await press(page, "Shift+N");
    expect((await readState(page)).tool).toBe("roll");
    const after = await expectSingleUndoStep(page, [a, b, c], async () => {
      const from = await handlePoint(page, a.id, "right");
      await drag(page, from, 0.5 * PPS);
    });
    expect(after[0].duration).toBeCloseTo(2.5, 1);
    expect(after[1].start).toBeCloseTo(2.5, 1);
    expect(after[1].duration).toBeCloseTo(1.5, 1);
    expect(after[1].inPoint).toBeCloseTo(2.5, 1);
    // Total length and the third clip are untouched.
    expect(after[1].start + after[1].duration).toBeCloseTo(4, 2);
    expect(after[2].start).toBeCloseTo(4, 2);
    expect(after[2].duration).toBeCloseTo(2, 2);
  });

  test("Slide (U): moving a clip between neighbours keeps its source and total length", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await press(page, "u");
    const after = await expectSingleUndoStep(page, [a, b, c], async () => {
      const from = await handlePoint(page, b.id, "body");
      await drag(page, from, 0.5 * PPS);
    });
    expect(after[1].start).toBeCloseTo(2.5, 1);
    expect(after[1].duration).toBeCloseTo(2, 2);
    expect(after[1].inPoint).toBeCloseTo(b.inPoint, 3);
    expect(after[0].duration).toBeCloseTo(2.5, 1);
    expect(after[2].start).toBeCloseTo(4.5, 1);
    expect(after[2].duration).toBeCloseTo(1.5, 1);
    expect(after[2].start + after[2].duration).toBeCloseTo(6, 2);
  });

  test("Rate Stretch (Shift+R): dragging an edge changes speed and duration", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await press(page, "Shift+R");
    expect((await readState(page)).tool).toBe("stretch");
    const after = await expectSingleUndoStep(page, [a, b, c], async () => {
      const from = await handlePoint(page, b.id, "right");
      await drag(page, from, -1 * PPS);
    });
    expect(after[1].duration).toBeCloseTo(1, 1);
    expect(after[1].speed).toBeCloseTo(2, 1);
    expect(after[1].start).toBeCloseTo(b.start, 3);
    // Same source range plays in half the time.
    expect(after[1].outPoint - after[1].inPoint).toBeCloseTo(b.outPoint - b.inPoint, 1);
  });

  test("Alt+Arrow nudges the active tool's edit; a burst is one undo step", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await clickClip(page, a.id);
    await press(page, "r");
    await seek(page, 1.9); // nearest edit point is the clip's end
    const start = await readState(page);

    // Three quick nudges (inside the burst window) -> one undo step.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(900);
    const nudged = await readState(page);
    const na = clipsOf(nudged, "Main");
    expect(na[0].duration).toBeCloseTo(2 - 3 * FRAME, 2);
    expect(na[1].start).toBeCloseTo(2 - 3 * FRAME, 2); // ripple pulled the neighbour
    void start; void nudged;

    // Shift = five frames, and a separate burst once the window has elapsed.
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.waitForTimeout(900);
    const large = clipsOf(await readState(page), "Main");
    expect(large[0].duration).toBeCloseTo(2 - 3 * FRAME + 5 * FRAME, 2);

    // Undo steps: the large nudge, then the whole 3-keystroke burst at once.
    await undo(page);
    expect(clipsOf(await readState(page), "Main")[0].duration).toBeCloseTo(2 - 3 * FRAME, 2);
    await undo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape([a, b, c]));
  });
});
