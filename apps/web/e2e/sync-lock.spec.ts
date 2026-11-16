import { expect, test, type Page } from "@playwright/test";
import { AUDIO_FIXTURE_PATH } from "./global-setup";
import {
  clickClip,
  clipsOf,
  openEditor,
  press,
  readSource,
  readState,
  seek,
  settle,
  shape,
  track,
  undo,
  redo,
  importInput,
} from "./helpers";


/**
 * The editor's default lanes are Titles, B-roll (V2), Main (V1), Dialogue (A1)
 * and Music (A2). The imported clip is split at 2s, its audio is separated onto
 * Dialogue (linked to the picture), and a 4s tone is placed on Music.
 */
async function buildLayout(page: Page, musicStart = 3): Promise<void> {
  await openEditor(page);
  await seek(page, 2);
  await press(page, "Meta+Shift+k"); // Add Edit to All Tracks
  const split = await readState(page);
  expect(clipsOf(split, "Main")).toHaveLength(2);
  // Separate the audio of both halves: linked picture + sound on Dialogue.
  for (const clip of clipsOf(split, "Main")) {
    const result = await page.evaluate((id) => (window as any).__openreelE2E.project.getState().separateAudio(id), clip.id);
    expect(result.success, JSON.stringify(result)).toBe(true);
  }
  await importInput(page).setInputFiles(AUDIO_FIXTURE_PATH);
  await page.getByLabel("Select media tone-4s.wav").waitFor({ timeout: 30_000 });
  const music = await page.evaluate(
    async ([start]) => {
      const st = (window as any).__openreelE2E.project.getState();
      const tone = st.project.mediaLibrary.items.find((m: any) => m.name === "tone-4s.wav");
      const lane = st.project.timeline.tracks.find((t: any) => t.name === "Music");
      return st.addClip(lane.id, tone.id, start);
    },
    [musicStart],
  );
  expect(music.success, JSON.stringify(music)).toBe(true);
  await settle(page, 600);
}

const dialogueOf = (s: Awaited<ReturnType<typeof readState>>) => shape(clipsOf(s, "Dialogue")).map((c) => c.slice(0, 2));
const mainOf = (s: Awaited<ReturnType<typeof readState>>) => shape(clipsOf(s, "Main")).map((c) => c.slice(0, 2));
const musicOf = (s: Awaited<ReturnType<typeof readState>>) => shape(clipsOf(s, "Music")).map((c) => c.slice(0, 2));

const syncButton = (page: Page, name: string) => page.getByRole("button", { name: `Sync lock ${name}`, exact: true });

test.describe("Sync Lock and track targeting", () => {
  test("ripple delete on V1 keeps A1 and A2 in sync; Sync Lock off on A2 leaves it in place", async ({ page }) => {
    await buildLayout(page);
    const before = await readState(page);
    expect(mainOf(before)).toEqual([[0, 2], [2, 4]]);
    expect(dialogueOf(before)).toEqual([[0, 2], [2, 4]]);
    expect(musicOf(before)).toEqual([[3, 4]]);

    // Every track starts with Sync Lock on, shown in each header.
    for (const name of ["Main", "Dialogue", "Music", "B-roll", "Titles"])
      await expect(syncButton(page, name)).toHaveAttribute("data-sync-lock", "on");

    // Selecting the picture selects its linked sound; Shift+Delete = ripple delete.
    await clickClip(page, clipsOf(before, "Main")[0].id);
    await press(page, "Shift+Backspace");
    const after = await readState(page);
    expect(mainOf(after)).toEqual([[0, 4]]);
    expect(dialogueOf(after)).toEqual([[0, 4]]);
    // The music track moved with the edit: 3s -> 1s, same 4s length.
    expect(musicOf(after)).toEqual([[1, 4]]);
    expect(after.historyLength).toBe(before.historyLength + 1);

    await undo(page);
    const undone = await readState(page);
    expect(mainOf(undone)).toEqual(mainOf(before));
    expect(dialogueOf(undone)).toEqual(dialogueOf(before));
    expect(musicOf(undone)).toEqual([[3, 4]]);
    expect(undone.historyLength).toBe(before.historyLength);

    // Sync Lock off on Music: the same ripple delete leaves it where it was.
    await syncButton(page, "Music").click();
    await expect(syncButton(page, "Music")).toHaveAttribute("data-sync-lock", "off");
    const toggled = await readState(page);
    expect(toggled.historyLength).toBe(before.historyLength + 1);
    await clickClip(page, clipsOf(toggled, "Main")[0].id);
    await press(page, "Shift+Backspace");
    const unsynced = await readState(page);
    expect(mainOf(unsynced)).toEqual([[0, 4]]);
    expect(dialogueOf(unsynced)).toEqual([[0, 4]]);
    expect(musicOf(unsynced)).toEqual([[3, 4]]);

    await undo(page);
    expect(mainOf(await readState(page))).toEqual(mainOf(before));
    await undo(page); // the Sync Lock toggle itself is one undo step
    await expect(syncButton(page, "Music")).toHaveAttribute("data-sync-lock", "on");
    const restored = await readState(page);
    expect(restored.historyLength).toBe(before.historyLength);
    expect(musicOf(restored)).toEqual([[3, 4]]);
    await redo(page);
    await expect(syncButton(page, "Music")).toHaveAttribute("data-sync-lock", "off");
  });

  test("a ripple delete over content on a sync-locked track is blocked with a toast naming the track", async ({ page }) => {
    await buildLayout(page, 1); // Music [1,5) sits under the first 2s
    const before = await readState(page);
    await clickClip(page, clipsOf(before, "Main")[0].id);
    await press(page, "Shift+Backspace");

    await expect(page.getByText(/Sync Lock blocked this edit: "Music"/).first()).toBeVisible();
    const blocked = await readState(page);
    expect(mainOf(blocked)).toEqual(mainOf(before));
    expect(dialogueOf(blocked)).toEqual(dialogueOf(before));
    expect(musicOf(blocked)).toEqual([[1, 4]]);
    expect(blocked.historyLength).toBe(before.historyLength);

    // Turning Sync Lock off on the named track unblocks it.
    await syncButton(page, "Music").click();
    await clickClip(page, clipsOf(blocked, "Main")[0].id);
    await press(page, "Shift+Backspace");
    const done = await readState(page);
    expect(mainOf(done)).toEqual([[0, 4]]);
    expect(musicOf(done)).toEqual([[1, 4]]);
  });

  test("Insert from the Source monitor with the source patched to B-roll (V2) and Music (A2)", async ({ page }) => {
    await buildLayout(page);
    const before = await readState(page);

    await page.getByLabel("Select media three-scenes.mp4").dblclick();
    await expect(page.getByTestId("source-monitor")).toBeVisible();
    await expect.poll(async () => (await readSource(page)).tab).toBe("source");
    await page.evaluate(() => {
      const source = (window as any).__openreelE2E.source.getState();
      source.stop();
      source.setPosition(1);
    });
    await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
    await page.keyboard.press("i");
    await page.evaluate(() => (window as any).__openreelE2E.source.getState().setPosition(3));
    await page.keyboard.press("o");
    expect((await readSource(page)).marks).toEqual({ in: 1, out: 3 });

    // Patch indicators in the Source monitor: video -> B-roll, audio -> Music.
    const patchVideo = page.getByTestId("source-patch-video");
    const patchAudio = page.getByTestId("source-patch-audio");
    await patchVideo.click();
    await page.getByRole("option", { name: "B-roll" }).click();
    await patchAudio.click();
    await page.getByRole("option", { name: "Music" }).click();
    await expect(patchVideo).toContainText("B-roll");
    await expect(patchAudio).toContainText("Music");
    const patch = (await readState(page)).targets;
    expect(patch.video).toBe(track(before, "B-roll").id);
    expect(patch.audio).toBe(track(before, "Music").id);

    await seek(page, 1);
    await page.getByRole("button", { name: "Insert (,)" }).click();
    await settle(page, 600);
    const after = await readState(page);

    // Picture on B-roll [1,3) (muted, source 1-3); sound on Music [1,3).
    expect(shape(clipsOf(after, "B-roll"))).toEqual([[1, 2, 1, 3]]);
    const music = clipsOf(after, "Music");
    expect(music.map((c) => [c.start, c.duration])).toEqual([[1, 2], [5, 4]]);
    // Sync-locked Main and Dialogue split at 1s and shifted by 2s; the old music clip too.
    expect(mainOf(after)).toEqual([[0, 1], [3, 1], [4, 4]]);
    expect(dialogueOf(after)).toEqual([[0, 1], [3, 1], [4, 4]]);
    expect(after.historyLength).toBe(before.historyLength + 1);
    const linked = await page.evaluate((id) => {
      const lane = (window as any).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.name === "Music");
      const sound = lane.clips.find((c: any) => c.startTime === 1);
      const picture = (window as any).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.name === "B-roll").clips[0];
      return [sound.metadata?.separatedFromClipId === picture.id, picture.volume, sound.transform.opacity];
    }, track(after, "B-roll").id);
    expect(linked).toEqual([true, 0, 0]);

    await undo(page);
    const undone = await readState(page);
    expect(clipsOf(undone, "B-roll")).toHaveLength(0);
    expect(mainOf(undone)).toEqual(mainOf(before));
    expect(musicOf(undone)).toEqual([[3, 4]]);
    expect(undone.historyLength).toBe(before.historyLength);
  });

  test("track target toggles and shortcuts drive Extract, and Shift+Y toggles Sync Lock", async ({ page }) => {
    await buildLayout(page);
    const before = await readState(page);

    // Click the V1 badge in the Main header: that track is targeted.
    await page.getByRole("button", { name: "Track target Main", exact: true }).click();
    await expect(page.getByRole("button", { name: "Track target Main", exact: true })).toHaveAttribute("data-track-targeted", "true");
    await page.getByRole("button", { name: "Track target Dialogue", exact: true }).click();
    // Extract the marked 1s-1.5s range from the targeted tracks only; Music is empty there and follows.
    await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().setLoopRange(0.5, 1.5));
    await press(page, "'");
    const after = await readState(page);
    expect(mainOf(after)).toEqual([[0, 0.5], [0.5, 0.5], [1, 4]]);
    expect(dialogueOf(after)).toEqual([[0, 0.5], [0.5, 0.5], [1, 4]]);
    expect(musicOf(after)).toEqual([[2, 4]]);
    expect(after.historyLength).toBe(before.historyLength + 1);
    await undo(page);
    expect(musicOf(await readState(page))).toEqual([[3, 4]]);

    // Shift+T toggles the target of the selected track, Shift+Y its Sync Lock.
    await clickClip(page, clipsOf(before, "Main")[0].id);
    await press(page, "Shift+T");
    await expect(page.getByRole("button", { name: "Track target Main", exact: true })).toHaveAttribute("aria-pressed", "false");
    await press(page, "Shift+Y");
    await expect(syncButton(page, "Main")).toHaveAttribute("data-sync-lock", "off");
    await press(page, "Shift+Y");
    await expect(syncButton(page, "Main")).toHaveAttribute("data-sync-lock", "on");
  });
});
