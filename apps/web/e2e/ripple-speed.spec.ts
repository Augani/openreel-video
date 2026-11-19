import { expect, test, type Page } from "@playwright/test";
import {
  boxOf,
  clickClip,
  clipsOf,
  drag,
  openEditor,
  press,
  readState,
  redo,
  setZoom,
  splitIntoThree,
  undo,
  type ClipState,
} from "./helpers";

const PPS = 100;

/** Separate the audio of every Main clip onto Dialogue (linked to its picture). */
async function separateAll(page: Page): Promise<void> {
  for (const clip of clipsOf(await readState(page), "Main")) {
    const result = await page.evaluate(
      (id) => (window as unknown as { __openreelE2E: { project: { getState(): { separateAudio(id: string): Promise<{ success: boolean }> } } } })
        .__openreelE2E.project.getState().separateAudio(id),
      clip.id,
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  }
  await page.waitForTimeout(500);
}

async function threeClips(page: Page): Promise<ClipState[]> {
  await openEditor(page);
  await splitIntoThree(page);
  await setZoom(page, PPS);
  return clipsOf(await readState(page), "Main");
}

/** Click a clip, then Shift-click another so both are selected. */
async function selectTwo(page: Page, a: string, b: string) {
  await clickClip(page, a);
  const box = await boxOf(page, b);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.left + 20, box.centerY);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(250);
}

test.describe("Premiere-parity: multi-clip speed with ripple", () => {
  test("Speed/Duration dialog speeds up two clips, ripples the rest, one undo step", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await selectTwo(page, a.id, b.id);
    const before = await readState(page);
    await press(page, "Meta+Alt+r");
    const dialog = page.getByRole("dialog", { name: /speed \/ duration/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Speed percent").fill("200");
    await dialog.getByRole("button", { name: "OK" }).click();
    await page.waitForTimeout(600);

    const after = await readState(page);
    const [x, y, z] = clipsOf(after, "Main");
    expect(after.historyLength - before.historyLength, "one history entry").toBe(1);
    expect(x.speed).toBeCloseTo(2, 2);
    expect(y.speed).toBeCloseTo(2, 2);
    expect(x.duration).toBeCloseTo(a.duration / 2, 2);
    expect(y.start).toBeCloseTo(x.start + x.duration, 2);
    expect(z.start).toBeCloseTo(y.start + y.duration, 2);
    expect(z.duration).toBeCloseTo(c.duration, 3);
    expect(z.speed).toBeCloseTo(1, 3);

    await undo(page);
    const undone = clipsOf(await readState(page), "Main");
    expect(undone.map((k) => [k.start, k.duration])).toEqual([a, b, c].map((k) => [k.start, k.duration]));
    await redo(page);
    expect(clipsOf(await readState(page), "Main")[2].start).toBeCloseTo(z.start, 3);
  });

  test("Rate Stretch on a multi-selection scales every selected clip and ripples", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await selectTwo(page, a.id, b.id);
    await press(page, "Shift+R");
    const start = await readState(page);
    const box = await boxOf(page, b.id);
    await drag(page, { x: box.right - 3, y: box.centerY }, -1 * PPS);
    const after = await readState(page);
    const [x, y, z] = clipsOf(after, "Main");
    expect(after.historyLength - start.historyLength).toBe(1);
    // b went 2s -> 1s, so both selected clips run at 2x.
    expect(y.duration).toBeCloseTo(b.duration / 2, 1);
    expect(x.duration).toBeCloseTo(a.duration / 2, 1);
    expect(x.speed).toBeCloseTo(2, 1);
    expect(y.speed).toBeCloseTo(2, 1);
    expect(z.start).toBeCloseTo(y.start + y.duration, 2);
    expect(z.duration).toBeCloseTo(c.duration, 3);
  });

  test("linked audio is retimed with its picture, with Linked Selection on or off, and the rest ripples", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await separateAll(page);
    for (const linkedSelection of [true, false]) {
      await page.evaluate(
        (value) => (window as unknown as { __openreelE2E: { workspace: { setState(s: object): void } } }).__openreelE2E.workspace.setState({ linkedSelection: value }),
        linkedSelection,
      );
      await selectTwo(page, a.id, b.id);
      const before = await readState(page);
      await press(page, "Meta+Alt+r");
      const dialog = page.getByRole("dialog", { name: /speed \/ duration/i });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Speed percent").fill("200");
      await dialog.getByRole("button", { name: "OK" }).click();
      await page.waitForTimeout(600);
      const after = await readState(page);
      expect(after.historyLength - before.historyLength, "one history entry").toBe(1);
      const dialogue = clipsOf(after, "Dialogue");
      const main = clipsOf(after, "Main");
      expect(dialogue.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(dialogue[i].start, `audio ${i} start (linked=${linkedSelection})`).toBeCloseTo(main[i].start, 2);
        expect(dialogue[i].duration, `audio ${i} duration`).toBeCloseTo(main[i].duration, 2);
      }
      expect(dialogue[0].speed).toBeCloseTo(2, 2);
      expect(main[2].duration).toBeCloseTo(c.duration, 3);
      await undo(page);
      const undone = await readState(page);
      expect(clipsOf(undone, "Dialogue").map((k) => k.duration)).toEqual(clipsOf(before, "Dialogue").map((k) => k.duration));
    }
  });

  test("Alt-dragging the Rate Stretch edge stretches the selection without rippling", async ({ page }) => {
    const [a, b, c] = await threeClips(page);
    await selectTwo(page, a.id, b.id);
    await press(page, "Shift+R");
    const box = await boxOf(page, b.id);
    await page.keyboard.down("Alt");
    await drag(page, { x: box.right - 3, y: box.centerY }, -1 * PPS);
    await page.keyboard.up("Alt");
    const [x, y, z] = clipsOf(await readState(page), "Main");
    expect(y.duration).toBeCloseTo(b.duration / 2, 1);
    expect(x.duration).toBeCloseTo(a.duration / 2, 1);
    expect(z.start, "trailing clip stays put").toBeCloseTo(c.start, 3);
  });
});
