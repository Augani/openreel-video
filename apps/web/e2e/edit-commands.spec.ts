import { expect, test, type Page } from "@playwright/test";
import {
  clipsOf,
  clickClip,
  openEditor,
  press,
  readState,
  redo,
  seek,
  settle,
  shape,
  track,
  undo,
} from "./helpers";

const MEDIA = "Select media three-scenes.mp4";

const selectMedia = async (page: Page) => {
  await page.getByLabel(MEDIA).click();
  await settle(page, 200);
};
const targetButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(Target|Untarget) ${name}$`) });

async function targetTrack(page: Page, name: string) {
  const button = page.getByRole("button", { name: `Target ${name}`, exact: true });
  await button.click();
  await expect(page.getByRole("button", { name: `Untarget ${name}`, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

test.describe("Premiere-parity: three-point edit commands", () => {
  test("track target toggles: exclusive per kind, clearable, reflected in state", async ({ page }) => {
    await openEditor(page);
    const s0 = await readState(page);
    const main = track(s0, "Main");
    const broll = track(s0, "B-roll");

    await targetTrack(page, "Main");
    expect((await readState(page)).targets.video).toBe(main.id);
    await expect(page.locator('[data-track-target="true"]')).toHaveCount(1);

    // Targeting another video track moves the patch; only one video target at a time.
    await targetTrack(page, "B-roll");
    expect((await readState(page)).targets.video).toBe(broll.id);
    await expect(page.locator('[data-track-target="true"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Target Main", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Clicking the active target clears it.
    await page.getByRole("button", { name: "Untarget B-roll", exact: true }).click();
    expect((await readState(page)).targets.video).toBeUndefined();
    await expect(page.locator('[data-track-target="true"]')).toHaveCount(0);

    // Audio targets are independent of the video target.
    await targetTrack(page, "Main");
    await targetTrack(page, "Dialogue");
    const s = await readState(page);
    expect(s.targets.video).toBe(main.id);
    expect(s.targets.audio).toBe(track(s, "Dialogue").id);
    void targetButton;
  });

  test("Insert (,) places the selected media on the targeted Main track and ripples; one undo", async ({ page }) => {
    await openEditor(page);
    await selectMedia(page);
    await targetTrack(page, "Main");
    await seek(page, 2);
    const before = await readState(page);

    await press(page, ",");
    const after = await readState(page);
    const main = clipsOf(after, "Main");
    // Original split at 2s; 6s of new media inserted; the tail rippled right.
    expect(shape(main)).toEqual([
      [0, 2, 0, 2],
      [2, 6, 0, 6],
      [8, 4, 2, 6],
    ]);
    expect(clipsOf(after, "B-roll")).toHaveLength(0);
    expect(after.playhead).toBeCloseTo(8, 1);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    await redo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(main));
  });

  test("Insert goes to whichever video track is targeted", async ({ page }) => {
    await openEditor(page);
    await selectMedia(page);
    await targetTrack(page, "B-roll");
    await seek(page, 1);
    await press(page, ",");
    const s = await readState(page);
    expect(shape(clipsOf(s, "B-roll"))).toEqual([[1, 6, 0, 6]]);
    // Like Premiere, Insert ripples the other unlocked tracks: Main is cut at 1s and its tail shifts by 6s.
    expect(shape(clipsOf(s, "Main"))).toEqual([
      [0, 1, 0, 1],
      [7, 5, 1, 6],
    ]);
    await undo(page);
    const undone = await readState(page);
    expect(clipsOf(undone, "B-roll")).toHaveLength(0);
    expect(shape(clipsOf(undone, "Main"))).toEqual([[0, 6, 0, 6]]);
  });

  test("Overwrite (.) replaces the span on the targeted Main track without rippling; one undo", async ({ page }) => {
    await openEditor(page);
    await selectMedia(page);
    await targetTrack(page, "Main");
    await seek(page, 2);
    const before = await readState(page);

    await press(page, ".");
    const after = await readState(page);
    // 2s of the original survives; the 6s overwrite covers the rest, nothing rippled.
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 2, 0, 2],
      [2, 6, 0, 6],
    ]);

    await undo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(clipsOf(before, "Main")));
    await redo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(clipsOf(after, "Main")));
  });

  test("Lift (;) removes the In/Out range leaving a gap; undo restores clips and range", async ({ page }) => {
    await openEditor(page);
    await seek(page, 1);
    await press(page, "i");
    await seek(page, 3);
    await press(page, "o");
    const marked = await readState(page);
    expect([marked.loopStart, marked.loopEnd]).toEqual([1, 3]);
    const before = clipsOf(marked, "Main");

    await press(page, ";");
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 1, 0, 1],
      [3, 3, 3, 6],
    ]);
    expect([after.loopStart, after.loopEnd], "Lift keeps the marks").toEqual([1, 3]);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(before));
    expect([undone.loopStart, undone.loopEnd]).toEqual([1, 3]);
  });

  test("Extract (') removes the range and closes the gap; undo restores clips and In/Out", async ({ page }) => {
    await openEditor(page);
    await seek(page, 1);
    await press(page, "i");
    await seek(page, 3);
    await press(page, "o");
    const before = clipsOf(await readState(page), "Main");

    await press(page, "'");
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 1, 0, 1],
      [1, 3, 3, 6],
    ]);
    expect([after.loopStart, after.loopEnd], "marks collapse after extract").toEqual([0, 0]);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(before));
    expect([undone.loopStart, undone.loopEnd], "undo restores In/Out").toEqual([1, 3]);

    await redo(page);
    const redone = await readState(page);
    expect(shape(clipsOf(redone, "Main"))).toEqual(shape(clipsOf(after, "Main")));
    expect([redone.loopStart, redone.loopEnd]).toEqual([0, 0]);
  });

  test("Add Edit to All Tracks (Cmd+Shift+K) splits every unlocked track at the playhead", async ({ page }) => {
    await openEditor(page);
    // Give B-roll a clip to cut alongside Main.
    await selectMedia(page);
    await targetTrack(page, "B-roll");
    await seek(page, 0);
    await press(page, ".");
    expect(clipsOf(await readState(page), "B-roll")).toHaveLength(1);

    await seek(page, 3);
    const before = await readState(page);
    await press(page, "Meta+Shift+k");
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 3, 0, 3],
      [3, 3, 3, 6],
    ]);
    expect(shape(clipsOf(after, "B-roll"))).toEqual([
      [0, 3, 0, 3],
      [3, 3, 3, 6],
    ]);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(shape(clipsOf(undone, "B-roll"))).toEqual(shape(clipsOf(before, "B-roll")));
    await redo(page);
    expect(clipsOf(await readState(page), "B-roll")).toHaveLength(2);

    // A locked track is left alone.
    await undo(page);
    await page.getByLabel("Main track").getByRole("button", { name: "Lock", exact: true }).click();
    await seek(page, 3);
    await press(page, "Meta+Shift+k");
    const locked = await readState(page);
    expect(clipsOf(locked, "Main")).toHaveLength(1);
    expect(clipsOf(locked, "B-roll")).toHaveLength(2);
  });

  test("Match Frame (F) selects the source media of the clip under the playhead", async ({ page }) => {
    await openEditor(page);
    const s0 = await readState(page);
    const clip = clipsOf(s0, "Main")[0];
    const mediaId = await page.evaluate(() => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
      return e.project.getState().project.mediaLibrary.items[0].id as string;
    });
    // Move selection and the asset panel away from the media bin first.
    await clickClip(page, clip.id);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await seek(page, 3);

    await press(page, "f");
    const s = await readState(page);
    expect(s.selected).toEqual([{ type: "clip", id: mediaId }]);
    await expect(page.getByLabel(MEDIA)).toHaveAttribute("aria-pressed", "true");
    // Match frame is a navigation command: it never edits the timeline.
    expect(shape(clipsOf(s, "Main"))).toEqual(shape(clipsOf(s0, "Main")));
    expect(s.historyLength).toBe(s0.historyLength);
  });
});
