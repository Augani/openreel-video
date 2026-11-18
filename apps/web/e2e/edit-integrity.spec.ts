import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AUDIO_FIXTURE_PATH, FIXTURE_DIR } from "./global-setup";
import {
  clickClip,
  clipLocator,
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
 * Edit integrity: the edit paths that were never browser-driven (Paste Insert,
 * Match Frame, Make Subclip, grid range-select) and the sync-lock holes that
 * silence cut, Remove Gaps and Normalize loudness used to have. Real Chrome,
 * real clicks and keys; assertions read the live stores.
 */

const MEDIA = "Select media three-scenes.mp4";
const TONE = "Select media tone-4s.wav";
const GAP_TONE_PATH = join(FIXTURE_DIR, "tone-gap-6s.wav");
const GAP_TONE = "Select media tone-gap-6s.wav";

test.beforeAll(() => {
  // 2s tone, 2s silence, 2s tone: one silent region for Auto-Cut Silence.
  if (!existsSync(GAP_TONE_PATH))
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", "aevalsrc='if(between(t,2,4),0,0.5*sin(2*PI*330*t))':s=48000:d=6",
        GAP_TONE_PATH,
      ],
      { stdio: "ignore" },
    );
});

const trackBtn = (page: Page, name: string) => page.getByRole("button", { name: `Track target ${name}`, exact: true });
const syncButton = (page: Page, name: string) => page.getByRole("button", { name: `Sync lock ${name}`, exact: true });
const spans = (s: Awaited<ReturnType<typeof readState>>, name: string) =>
  shape(clipsOf(s, name)).map((c) => c.slice(0, 2));

async function importFile(page: Page, path: string, label: string) {
  await importInput(page).setInputFiles(path);
  await page.getByLabel(label).waitFor({ timeout: 30_000 });
}

/** Add a library item to a named lane at a start time. */
async function addToLane(page: Page, mediaName: string, lane: string, start: number) {
  const result = await page.evaluate(
    async ([media, laneName, at]) => {
      const st = (window as any).__openreelE2E.project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === media);
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      return st.addClip(target.id, item.id, at);
    },
    [mediaName, lane, start] as const,
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  await settle(page, 500);
}

const selectedIds = async (page: Page) => (await readState(page)).selected.map((s) => s.id);

test.describe("Paste Insert (Cmd+Shift+V)", () => {
  test("lands on the targeted track, ripples sync-locked tracks, one undo step", async ({ page }) => {
    await openEditor(page);
    await seek(page, 2);
    await press(page, "Meta+Shift+k"); // split every track at 2s
    const split = await readState(page);
    expect(spans(split, "Main")).toEqual([[0, 2], [2, 4]]);

    // Copy the first half of Main, target B-roll (V2), paste-insert at 1s.
    await clickClip(page, clipsOf(split, "Main")[0].id);
    await press(page, "Meta+c");
    await trackBtn(page, "B-roll").click();
    await expect(trackBtn(page, "B-roll")).toHaveAttribute("data-track-targeted", "true");
    await seek(page, 1);
    const before = await readState(page);
    await press(page, "Meta+Shift+v");
    const after = await readState(page);

    // The copy sits on B-roll, not on Main; Main (sync-locked) split at 1s and shifted by 2s.
    expect(spans(after, "B-roll")).toEqual([[1, 2]]);
    expect(spans(after, "Main")).toEqual([[0, 1], [3, 1], [4, 4]]);
    expect(after.historyLength).toBe(before.historyLength + 1);
    // The pasted clip is selected so it can be moved straight away.
    expect(await selectedIds(page)).toEqual([clipsOf(after, "B-roll")[0].id]);

    await undo(page);
    const undone = await readState(page);
    expect(spans(undone, "B-roll")).toEqual([]);
    expect(spans(undone, "Main")).toEqual(spans(before, "Main"));
    expect(undone.historyLength).toBe(before.historyLength);
    await redo(page);
    expect(spans(await readState(page), "B-roll")).toEqual([[1, 2]]);
  });

  test("without a target it pastes onto the copied track and never touches a locked track", async ({ page }) => {
    await openEditor(page);
    await seek(page, 2);
    await press(page, "Meta+Shift+k");
    const split = await readState(page);
    await addToLane(page, "three-scenes.mp4", "B-roll", 0);
    const locked = await readState(page);
    const bRoll = shape(clipsOf(locked, "B-roll"));
    // Lock B-roll: Paste Insert must neither change it nor ripple it.
    await page.evaluate((id) => (window as any).__openreelE2E.project.getState().lockTrack(id, true), track(locked, "B-roll").id);
    await settle(page, 300);

    await clickClip(page, clipsOf(split, "Main")[0].id);
    await press(page, "Meta+c");
    await seek(page, 1);
    const before = await readState(page);
    await press(page, "Meta+Shift+v");
    const after = await readState(page);
    expect(spans(after, "Main")).toEqual([[0, 1], [1, 2], [3, 1], [4, 4]]);
    expect(shape(clipsOf(after, "B-roll"))).toEqual(bRoll);
    expect(after.historyLength).toBe(before.historyLength + 1);
  });
});

test.describe("Match Frame (F)", () => {
  test("loads the Source monitor at the source frame under the playhead, through an offset clip", async ({ page }) => {
    await openEditor(page);
    await seek(page, 2);
    await press(page, "Meta+Shift+k");
    const split = await readState(page);
    const second = clipsOf(split, "Main")[1];
    expect(shape([second])).toEqual([[2, 4, 2, 6]]);
    // Ripple-delete the first half: the second now starts at 0 but its source frame 2s.
    await clickClip(page, clipsOf(split, "Main")[0].id);
    await press(page, "Shift+Backspace");
    const moved = clipsOf(await readState(page), "Main")[0];
    expect(shape([moved])).toEqual([[0, 4, 2, 6]]);

    await seek(page, 1.5);
    await press(page, "f");
    await expect(page.getByTestId("source-monitor")).toBeVisible();
    const s = await readSource(page);
    expect(s.tab).toBe("source");
    // Timeline 1.5s in a clip starting at 0 with in-point 2s is source 3.5s.
    expect(s.position).toBeCloseTo(3.5, 2);
    await expect(page.getByTestId("source-timecode")).toHaveText("00:00:03:15");
    await expect
      .poll(() =>
        page.evaluate(() => (document.querySelector('[data-testid="source-video"]') as HTMLVideoElement).currentTime),
      )
      .toBeCloseTo(3.5, 1);
  });
});

test.describe("Project panel", () => {
  test("Make Subclip from the item menu and from Source monitor marks", async ({ page }) => {
    await openEditor(page);
    const media = () =>
      page.evaluate(() =>
        (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.map((m: any) => ({
          id: m.id,
          name: m.name,
          subclip: m.subclip ?? null,
        })),
      );
    const history = async () => (await readState(page)).historyLength;

    // Source marks 1s..3s.
    await page.getByLabel(MEDIA).dblclick();
    await expect(page.getByTestId("source-monitor")).toBeVisible();
    await page.evaluate(() => {
      const s = (window as any).__openreelE2E.source.getState();
      s.stop();
      s.setPosition(1);
    });
    await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
    await page.keyboard.press("i");
    await page.evaluate(() => (window as any).__openreelE2E.source.getState().setPosition(3));
    await page.keyboard.press("o");
    expect((await readSource(page)).marks).toEqual({ in: 1, out: 3 });

    // (1) the project panel item menu.
    const before = await history();
    await page.getByRole("button", { name: "Media actions for three-scenes.mp4" }).click();
    await page.getByTestId("menu-make-subclip").click();
    await expect.poll(async () => (await media()).filter((m: any) => m.subclip).length).toBe(1);
    const first = (await media()).find((m: any) => m.subclip)!;
    expect(first.subclip).toMatchObject({ inPoint: 1, outPoint: 3 });
    expect(await history()).toBe(before + 1);
    await undo(page);
    expect((await media()).filter((m: any) => m.subclip)).toHaveLength(0);

    // (2) the Source monitor's own Make Subclip button.
    await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
    await page.getByTestId("make-subclip").click();
    await expect.poll(async () => (await media()).filter((m: any) => m.subclip).length).toBe(1);
    expect((await media()).find((m: any) => m.subclip)!.subclip).toMatchObject({ inPoint: 1, outPoint: 3 });
    expect(await history()).toBe(before + 1);
  });

  test("shift and cmd range-select in the GRID view", async ({ page }) => {
    await openEditor(page);
    await importFile(page, AUDIO_FIXTURE_PATH, TONE);
    await importFile(page, GAP_TONE_PATH, GAP_TONE);
    await page.getByRole("button", { name: "Grid view" }).click();
    const tiles = page.getByLabel(/^Select media /);
    await expect(tiles).toHaveCount(3);
    const names = (await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!)));
    const idsByOrder = await page.evaluate((labels) => {
      const items = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items;
      return labels.map((l: string) => items.find((m: any) => `Select media ${m.name}` === l)?.id);
    }, names);
    expect(idsByOrder.every(Boolean)).toBe(true);

    // Click the first tile, shift-click the third: the whole range is selected.
    await tiles.nth(0).click();
    expect(await selectedIds(page)).toEqual([idsByOrder[0]]);
    await tiles.nth(2).click({ modifiers: ["Shift"] });
    expect((await selectedIds(page)).sort()).toEqual([...idsByOrder].sort());
    for (let i = 0; i < 3; i++) await expect(tiles.nth(i)).toHaveAttribute("aria-pressed", "true");

    // Click the middle one, shift-click the first: the range reverses (first..middle).
    await tiles.nth(1).click();
    await tiles.nth(0).click({ modifiers: ["Shift"] });
    expect((await selectedIds(page)).sort()).toEqual([idsByOrder[0], idsByOrder[1]].sort());
    await expect(tiles.nth(2)).toHaveAttribute("aria-pressed", "false");

    // Cmd-click toggles one item in and out without touching the rest.
    await tiles.nth(2).click({ modifiers: ["Meta"] });
    expect((await selectedIds(page)).sort()).toEqual([...idsByOrder].sort());
    await tiles.nth(0).click({ modifiers: ["Meta"] });
    expect((await selectedIds(page)).sort()).toEqual([idsByOrder[1], idsByOrder[2]].sort());
    await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("Sync Lock holes: silence cut, Remove Gaps, Normalize loudness", () => {
  /** Main (V1, three-scenes 0-6s) plus the gap tone on Music at 0 and a clear follower on Dialogue at 10s. */
  async function silenceLayout(page: Page) {
    await openEditor(page);
    await importFile(page, GAP_TONE_PATH, GAP_TONE);
    await addToLane(page, "tone-gap-6s.wav", "Music", 0);
    await importFile(page, AUDIO_FIXTURE_PATH, TONE);
    await addToLane(page, "tone-4s.wav", "Dialogue", 10);
    return readState(page);
  }

  async function analyzeAndCut(page: Page, musicClipId: string) {
    await clickClip(page, musicClipId);
    await page.getByRole("tab", { name: "Audio" }).first().click();
    const analyze = page.getByRole("button", { name: "Analyze", exact: true });
    // The sections stay open between clips; open whichever is still collapsed.
    for (const name of ["Expand Advanced audio tools section", "Expand Auto Cut Silence section"]) {
      const header = page.getByRole("button", { name });
      if (await header.isVisible().catch(() => false)) await header.click();
    }
    const cut = page.getByRole("button", { name: /^Cut \d+$/ });
    // A blocked cut keeps its analysis; a fresh clip needs one.
    if (!(await cut.isVisible().catch(() => false))) {
      await expect(analyze).toBeVisible();
      await analyze.click();
    }
    await expect(cut).toBeVisible({ timeout: 30_000 });
    await cut.click();
  }

  test("Auto-Cut Silence is blocked by a sync-locked track with content, then ripples a clear one as one undo step", async ({ page }) => {
    const before = await silenceLayout(page);
    expect(spans(before, "Music")).toEqual([[0, 6]]);
    expect(spans(before, "Dialogue")).toEqual([[10, 4]]);
    const music = clipsOf(before, "Music")[0];

    // Main holds picture over the silence (2s-4s): the cut is blocked and names it.
    await analyzeAndCut(page, music.id);
    await expect(page.getByText(/Sync Lock blocked this edit: "Main"/).first()).toBeVisible();
    const blocked = await readState(page);
    expect(spans(blocked, "Music")).toEqual([[0, 6]]);
    expect(spans(blocked, "Main")).toEqual(spans(before, "Main"));
    expect(spans(blocked, "Dialogue")).toEqual([[10, 4]]);
    expect(blocked.historyLength).toBe(before.historyLength);

    // Sync Lock off on Main: the cut goes through, Main stays, Dialogue (clear) follows.
    await syncButton(page, "Main").click();
    await expect(syncButton(page, "Main")).toHaveAttribute("data-sync-lock", "off");
    const toggled = await readState(page);
    await analyzeAndCut(page, music.id);
    await expect.poll(async () => clipsOf(await readState(page), "Music").length).toBe(2);
    const cutState = await readState(page);
    const pieces = clipsOf(cutState, "Music");
    const removed = 6 - pieces.reduce((sum, c) => sum + c.duration, 0);
    expect(removed).toBeGreaterThan(1.5); // the ~1.8s silence (2.1s-3.9s with padding)
    expect(pieces[1].start).toBeCloseTo(pieces[0].duration, 3);
    expect(spans(cutState, "Main")).toEqual(spans(before, "Main"));
    expect(clipsOf(cutState, "Dialogue")[0].start).toBeCloseTo(10 - removed, 3);
    expect(cutState.historyLength).toBe(toggled.historyLength + 1);

    await undo(page);
    const undone = await readState(page);
    expect(spans(undone, "Music")).toEqual([[0, 6]]);
    expect(spans(undone, "Dialogue")).toEqual([[10, 4]]);
    expect(undone.historyLength).toBe(toggled.historyLength);
  });

  test("Remove Gaps closes the track and a sync-locked follower, is blocked by content, and never moves a locked track", async ({ page }) => {
    await openEditor(page);
    await seek(page, 2);
    await press(page, "Meta+Shift+k");
    const split = await readState(page);
    // Gap on Main: move the second half to 4s ([2,6) -> [4,8)), leaving [2,4) empty.
    await page.evaluate(
      (id) => (window as any).__openreelE2E.project.getState().moveClip(id, 4),
      clipsOf(split, "Main")[1].id,
    );
    await importFile(page, AUDIO_FIXTURE_PATH, TONE);
    await addToLane(page, "tone-4s.wav", "Dialogue", 10); // clear follower
    await addToLane(page, "tone-4s.wav", "Music", 20); // will be locked
    await page.evaluate(
      (id) => (window as any).__openreelE2E.project.getState().lockTrack(id, true),
      track(await readState(page), "Music").id,
    );
    const before = await readState(page);
    expect(spans(before, "Main")).toEqual([[0, 2], [4, 4]]);

    const openMenu = async () => {
      await page.getByLabel("Main track", { exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Remove Gaps" }).click();
      await settle(page, 400);
    };
    await openMenu();
    const after = await readState(page);
    expect(spans(after, "Main")).toEqual([[0, 2], [2, 4]]);
    expect(spans(after, "Dialogue")).toEqual([[8, 4]]); // followed the 2s gap
    expect(spans(after, "Music")).toEqual([[20, 4]]); // locked: untouched
    expect(after.historyLength).toBe(before.historyLength + 1);
    await undo(page);
    const undone = await readState(page);
    expect(spans(undone, "Main")).toEqual([[0, 2], [4, 4]]);
    expect(spans(undone, "Dialogue")).toEqual([[10, 4]]);
    expect(undone.historyLength).toBe(before.historyLength);

    // Content on a sync-locked track inside the gap blocks it.
    await addToLane(page, "tone-4s.wav", "Dialogue", 2.5);
    const blockedBefore = await readState(page);
    await openMenu();
    await expect(page.getByText(/Sync Lock blocked this edit: "Dialogue"/).first()).toBeVisible();
    const blocked = await readState(page);
    expect(spans(blocked, "Main")).toEqual(spans(blockedBefore, "Main"));
    expect(blocked.historyLength).toBe(blockedBefore.historyLength);
  });

  test("Normalize loudness on a clip of a locked track says the track is locked", async ({ page }) => {
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await clickClip(page, clip.id);
    await page.evaluate(
      (id) => (window as any).__openreelE2E.project.getState().lockTrack(id, true),
      track(await readState(page), "Main").id,
    );
    await settle(page, 300);
    await page.getByRole("tab", { name: "Audio" }).first().click();
    const before = await readState(page);
    await page.getByRole("button", { name: "Normalize loudness" }).click();
    await expect(page.getByText("Track is locked").first()).toBeVisible();
    await expect(page.getByText(/track "Main" is locked/).first()).toBeVisible();
    await expect(page.getByText("Loudness could not be measured")).toHaveCount(0);
    expect((await readState(page)).historyLength).toBe(before.historyLength);
  });
});

test.describe("Track Select, Hand and Zoom tools", () => {
  /** Main [0,2) [2,4) [4,6) plus the 4s tone on Dialogue at 3s and on Music at 5s. */
  async function toolLayout(page: Page) {
    await openEditor(page);
    for (const t of [2, 4]) {
      await seek(page, t);
      await press(page, "Meta+Shift+k");
    }
    await importFile(page, AUDIO_FIXTURE_PATH, TONE);
    await addToLane(page, "tone-4s.wav", "Dialogue", 3);
    await addToLane(page, "tone-4s.wav", "Music", 5);
    // Linked selection would pull partners along; these clips have none.
    return readState(page);
  }
  const toolbar = (page: Page, title: RegExp) => page.getByRole("button", { name: title });

  test("toolbar buttons and A / Shift+A / H / Z shortcuts switch the tool", async ({ page }) => {
    await openEditor(page);
    const expectTool = async (tool: string, button: RegExp) => {
      expect((await readState(page)).tool).toBe(tool);
      await expect(toolbar(page, button)).toHaveAttribute("aria-pressed", "true");
    };
    await press(page, "a");
    await expectTool("trackSelectForward", /Track select forward/);
    await press(page, "Shift+A");
    await expectTool("trackSelectBackward", /Track select backward/);
    await press(page, "h");
    await expectTool("hand", /Hand tool/);
    await press(page, "z");
    await expectTool("zoom", /Zoom tool/);
    await press(page, "v");
    expect((await readState(page)).tool).toBe("select");
    await toolbar(page, /Hand tool/).click();
    await expectTool("hand", /Hand tool/);
    // Cmd+A / Cmd+Z keep their meaning.
    await press(page, "Meta+a");
    expect((await readState(page)).tool).toBe("hand");
  });

  test("Track Select Forward: click selects the clip and everything after it on all tracks; Shift limits to its track; move and delete are one undo step each", async ({ page }) => {
    const base = await toolLayout(page);
    const main = clipsOf(base, "Main");
    const dialogue = clipsOf(base, "Dialogue");
    const music = clipsOf(base, "Music");
    await press(page, "a");

    // Click Main [2,4): it, Main [4,6), Dialogue [3,7) and Music [5,9) are selected.
    await clipLocator(page, main[1].id).click();
    expect((await selectedIds(page)).sort()).toEqual([main[1].id, main[2].id, dialogue[0].id, music[0].id].sort());
    // Main [0,2) stays unselected.
    expect(await selectedIds(page)).not.toContain(main[0].id);

    // Shift-click: only the clicked track.
    await clipLocator(page, main[1].id).click({ modifiers: ["Shift"] });
    expect((await selectedIds(page)).sort()).toEqual([main[1].id, main[2].id].sort());

    // Back to all tracks, then move the whole selection with one real drag.
    await clipLocator(page, main[1].id).click();
    const before = await readState(page);
    const box = (await clipLocator(page, main[1].id).boundingBox())!;
    const pps = (await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pixelsPerSecond)) as number;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + pps * 0.5, box.y + box.height / 2, { steps: 10 });
    await page.mouse.move(box.x + box.width / 2 + pps * 1, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    // The group move commits asynchronously (applied step by step, undone as one group): wait until
    // every track holds all its clips, Main[1] has moved, and the history has stopped growing,
    // instead of a fixed sleep that read a half-applied move under load.
    await expect
      .poll(async () => {
        const a = await readState(page);
        await page.waitForTimeout(150);
        const b = await readState(page);
        const complete = ["Main", "Dialogue", "Music"].every((name) => clipsOf(b, name).length === clipsOf(before, name).length);
        return complete && a.historyLength === b.historyLength && b.historyLength > before.historyLength
          && clipsOf(b, "Main")[1].start - clipsOf(before, "Main")[1].start > 0.5;
      }, { timeout: 15_000, intervals: [100], message: "group move applied and settled" })
      .toBe(true);
    const moved = await readState(page);
    const shifted = (name: string, i: number) => clipsOf(moved, name)[i].start - clipsOf(before, name)[i].start;
    // Every selected clip moved by the same amount; the unselected one did not.
    const delta = shifted("Main", 1);
    const shifted2 = (s: Awaited<ReturnType<typeof readState>>, name: string) => clipsOf(s, name)[0].start - clipsOf(before, name)[0].start;
    expect(delta).toBeGreaterThan(0.5);
    expect(shifted("Main", 2)).toBeCloseTo(delta, 3);
    expect(shifted("Dialogue", 0)).toBeCloseTo(delta, 3);
    expect(shifted("Music", 0)).toBeCloseTo(delta, 3);
    expect(clipsOf(moved, "Main")[0].start).toBe(0);
    // One undo reverses the whole group move (a drag records its steps as one group).
    await undo(page);
    const undone = await readState(page);
    expect(spans(undone, "Main")).toEqual(spans(before, "Main"));
    expect(spans(undone, "Dialogue")).toEqual(spans(before, "Dialogue"));
    expect(spans(undone, "Music")).toEqual(spans(before, "Music"));
    expect(undone.historyLength).toBe(before.historyLength);
    await redo(page);
    expect(shifted2(await readState(page), "Dialogue")).toBeCloseTo(delta, 3);
    await undo(page);

    // Delete the selection: one undo step brings everything back.
    await clipLocator(page, main[1].id).click();
    const preDelete = await readState(page);
    await press(page, "Delete");
    const deleted = await readState(page);
    expect(spans(deleted, "Main")).toEqual([[0, 2]]);
    expect(spans(deleted, "Dialogue")).toEqual([]);
    expect(spans(deleted, "Music")).toEqual([]);
    await undo(page); // one undo brings back every deleted clip
    const restored = await readState(page);
    expect(spans(restored, "Main")).toEqual(spans(preDelete, "Main"));
    expect(spans(restored, "Dialogue")).toEqual(spans(preDelete, "Dialogue"));
    expect(spans(restored, "Music")).toEqual(spans(preDelete, "Music"));
  });

  test("Track Select Backward selects the clip and everything before it; locked tracks are skipped", async ({ page }) => {
    const base = await toolLayout(page);
    const main = clipsOf(base, "Main");
    const dialogue = clipsOf(base, "Dialogue");
    const music = clipsOf(base, "Music");
    await page.evaluate(
      (id) => (window as any).__openreelE2E.project.getState().lockTrack(id, true),
      track(base, "Dialogue").id,
    );
    await settle(page, 300);
    await press(page, "Shift+A");
    // Main [2,4): ends at 4. Backward = Main [0,2) and itself; Dialogue is locked and
    // [3,7) does not end by 4 anyway; Music [5,9) is after.
    await clipLocator(page, main[1].id).click();
    expect((await selectedIds(page)).sort()).toEqual([main[0].id, main[1].id].sort());
    // From the last clip on Main everything earlier on unlocked tracks is selected,
    // but the locked Dialogue clip never is.
    await clipLocator(page, main[2].id).click();
    const ids = await selectedIds(page);
    expect(ids).toContain(main[0].id);
    expect(ids).toContain(main[2].id);
    expect(ids).not.toContain(dialogue[0].id);
    expect(ids).not.toContain(music[0].id);
  });

  test("Hand tool drags the timeline; clips are not selected or moved", async ({ page }) => {
    await toolLayout(page);
    await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().setZoom(160));
    await settle(page, 400);
    const scroller = page.getByTestId("timeline-tracks-scroll");
    const scrollWidth = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(scrollWidth).toBeGreaterThan(200);
    await press(page, "h");
    const before = await readState(page);
    const box = (await scroller.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 500, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, y, { steps: 8 });
    await page.mouse.move(box.x + 300, y, { steps: 8 });
    await page.mouse.up();
    await settle(page, 300);
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(150);
    // Dragging back left pans back.
    await page.mouse.move(box.x + 300, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 700, y, { steps: 10 });
    await page.mouse.up();
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeLessThan(100);
    const after = await readState(page);
    expect(after.historyLength).toBe(before.historyLength);
    expect(after.selected).toEqual(before.selected);
    expect(spans(after, "Main")).toEqual(spans(before, "Main"));
    await expect(scroller).toHaveCSS("cursor", "grab");
  });

  test("Zoom tool: click zooms in at the point, Alt-click zooms out, a dragged range fits the viewport", async ({ page }) => {
    await toolLayout(page);
    const pps = () => page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pixelsPerSecond as number);
    await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().setZoom(80));
    await settle(page, 400);
    await press(page, "z");
    const scroller = page.getByTestId("timeline-tracks-scroll");
    const box = (await scroller.boundingBox())!;
    const y = box.y + box.height / 2;

    // Click at x = 2s on screen: the time under the pointer stays under it.
    const start = await pps();
    const clickX = box.x + 2 * start;
    await page.mouse.click(clickX, y);
    await settle(page, 400);
    const zoomed = await pps();
    expect(zoomed).toBeCloseTo(start * 1.5, 1);
    const timeAtPointer = await scroller.evaluate(
      (el, [pointerX, pxPerSec]) => (el.scrollLeft + pointerX) / pxPerSec,
      [clickX - box.x, zoomed] as const,
    );
    expect(timeAtPointer).toBeCloseTo(2, 1);

    // Alt-click zooms back out.
    await page.keyboard.down("Alt");
    await page.mouse.click(clickX, y);
    await page.keyboard.up("Alt");
    await settle(page, 400);
    expect(await pps()).toBeCloseTo(start, 1);

    // Drag a 2s..6s range: the viewport now shows ~those 4s.
    const view = await pps();
    await page.mouse.move(box.x + 2 * view, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 4 * view, y, { steps: 8 });
    await expect(page.getByTestId("timeline-zoom-band")).toBeVisible();
    await page.mouse.move(box.x + 6 * view, y, { steps: 8 });
    await page.mouse.up();
    await settle(page, 500);
    await expect(page.getByTestId("timeline-zoom-band")).toHaveCount(0);
    const fitted = await pps();
    const viewportWidth = await scroller.evaluate((el) => el.clientWidth);
    expect(fitted).toBeCloseTo(viewportWidth / 4, 0);
    const left = await scroller.evaluate((el, p) => el.scrollLeft / p, fitted);
    expect(left).toBeCloseTo(2, 1);
    // View only: no edit, no selection.
    const state = await readState(page);
    expect(state.selected).toEqual([]);
  });
});
