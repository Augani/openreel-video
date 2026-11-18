import { expect, test, type Page } from "@playwright/test";
import { AUDIO_FIXTURE_PATH } from "./global-setup";
import {
  canvasInk,
  clipsOf,
  openEditor,
  press,
  readSource,
  readState,
  seek,
  setZoom,
  settle,
  shape,
  track,
  undo,
  redo,
  importInput,
} from "./helpers";

const MEDIA = "Select media three-scenes.mp4";

async function openSource(page: Page) {
  await page.getByLabel(MEDIA).dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await expect.poll(async () => (await readSource(page)).tab).toBe("source");
  await settle(page, 500);
}

/** Park the Source playhead without moving the Program playhead. */
async function sourceSeek(page: Page, seconds: number) {
  await page.evaluate((t) => {
    const e = (window as unknown as { __openreelE2E: { source: { getState(): { setPosition(n: number): void; stop(): void } } } }).__openreelE2E;
    e.source.getState().stop();
    e.source.getState().setPosition(t);
  }, seconds);
  await settle(page, 300);
}

/** The Source <video> element's playback state: ready means decoded data for the current position and no seek pending. */
async function mediaElementState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('[data-testid="source-video"]') as HTMLVideoElement | null;
    if (!v) return { ready: false, readyState: -1, seeking: false, paused: true, currentTime: 0, error: null as string | null };
    return {
      ready: v.readyState >= 3 && !v.seeking,
      readyState: v.readyState,
      seeking: v.seeking,
      paused: v.paused,
      currentTime: v.currentTime,
      error: v.error ? v.error.message || String(v.error.code) : null,
    };
  });
}

/** Real keyboard focus on the Source monitor (as a user clicking into it). */
async function focusSource(page: Page) {
  await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
  await expect(page.getByTestId("source-monitor")).toBeFocused();
}

async function markSource(page: Page, inAt: number, outAt: number) {
  await focusSource(page);
  await sourceSeek(page, inAt);
  await page.keyboard.press("i");
  await sourceSeek(page, outAt);
  await page.keyboard.press("o");
  await settle(page, 200);
}

async function targetTrack(page: Page, name: string) {
  await page.getByRole("button", { name: `Target ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Untarget ${name}`, exact: true })).toHaveAttribute("aria-pressed", "true");
}

async function setSequenceRange(page: Page, start: number, end: number) {
  await page.evaluate(
    ([a, b]) => {
      const e = (window as unknown as { __openreelE2E: { timeline: { getState(): { setLoopRange(a: number, b: number): void } } } }).__openreelE2E;
      e.timeline.getState().setLoopRange(a, b);
    },
    [start, end],
  );
}

test.describe("Source monitor", () => {
  test("double-click opens the Source tab with its own playhead, J/K/L, frame steps and In/Out", async ({ page }) => {
    await openEditor(page);
    const program = await readState(page);
    await seek(page, 3);

    await openSource(page);
    let s = await readSource(page);
    expect(s.mediaId).not.toBeNull();
    expect(s.focus).toBe("source");
    await expect(page.getByTestId("source-monitor").getByTestId("monitor-tab-source")).toHaveAttribute("aria-selected", "true");
    // The Source monitor shows the actual frame: the video has decoded pixels.
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector('[data-testid="source-video"]') as HTMLVideoElement | null;
      return v ? v.videoWidth : 0;
    })).toBe(640);

    // Frame stepping on the Source playhead leaves the Program playhead alone.
    await focusSource(page);
    await sourceSeek(page, 1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readSource(page)).position).toBeCloseTo(1 + 3 / 30, 3);
    await expect(page.getByTestId("source-timecode")).toHaveText("00:00:01:03");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("source-timecode")).toHaveText("00:00:01:02");
    expect((await readState(page)).playhead).toBeCloseTo(3, 3);

    // J/K/L shuttle: L plays forward, repeated L doubles, K stops, J reverses.
    const t0 = (await readSource(page)).position;
    // Real readiness signal: the element has finished the frame-step seeks and holds enough data to play.
    // Pressing L while it is still seeking or has no future data lets a loaded machine stall the first play().
    await expect.poll(() => mediaElementState(page), { message: "Source video never became playable after the frame steps", timeout: 30_000 }).toMatchObject({ ready: true });
    await page.keyboard.press("l");
    await expect.poll(async () => (await readSource(page)).rate).toBe(1);
    // The element's first play() can take a while to start decoding on a busy machine, so wait for
    // the Source playhead to actually advance rather than for a fixed 700 ms.
    await expect
      .poll(async () => (await readSource(page)).position, {
        timeout: 15_000,
        message: `Source playhead did not advance after L; element: ${JSON.stringify(await mediaElementState(page))}`,
      })
      .toBeGreaterThan(t0 + 0.3);
    await page.keyboard.press("l");
    expect((await readSource(page)).rate).toBe(2);
    await page.keyboard.press("k");
    s = await readSource(page);
    expect(s.rate).toBe(0);
    expect(s.position).toBeGreaterThan(t0 + 0.3);
    const t1 = s.position;
    await page.keyboard.press("j");
    expect((await readSource(page)).rate).toBe(-1);
    // Reverse playback is stepped by the shuttle loop; on a busy machine it can lag, so wait for the Source
    // playhead to actually move back rather than for a fixed 500 ms.
    await expect.poll(async () => (await readSource(page)).position, { timeout: 15_000 }).toBeLessThan(t1 - 0.2);
    await page.keyboard.press("k");
    expect((await readSource(page)).rate).toBe(0);
    expect((await readState(page)).playhead).toBeCloseTo(3, 3);

    // I/O mark the SOURCE range, independent of the sequence In/Out.
    await sourceSeek(page, 1);
    await page.keyboard.press("i");
    await sourceSeek(page, 3);
    await page.keyboard.press("o");
    s = await readSource(page);
    expect(s.marks).toEqual({ in: 1, out: 3 });
    await expect(page.getByTestId("source-in")).toHaveText("00:00:01:00");
    await expect(page.getByTestId("source-out")).toHaveText("00:00:03:00");
    const marked = await readState(page);
    expect([marked.loopStart, marked.loopEnd]).toEqual([program.loopStart, program.loopEnd]);

    // Marks persist per media item: open the other item, then come back.
    await importInput(page).setInputFiles(AUDIO_FIXTURE_PATH);
    const toneCard = page.getByLabel("Select media tone-4s.wav");
    await toneCard.waitFor({ timeout: 30_000 });
    await toneCard.dblclick();
    await expect.poll(async () => (await readSource(page)).marks).toEqual({});
    // Audio-only media shows a waveform in the source monitor.
    await expect(page.getByTestId("source-waveform")).toBeVisible();
    await settle(page, 500);
    expect(await canvasInk(page, '[data-testid="source-waveform"]')).toBeGreaterThan(0.02);
    await page.getByLabel(MEDIA).dblclick();
    await expect.poll(async () => (await readSource(page)).marks).toEqual({ in: 1, out: 3 });
    // ...and across the Program/Source tabs.
    await page.getByTestId("source-monitor").getByTestId("monitor-tab-program").click();
    await expect(page.getByTestId("source-monitor")).toHaveCount(0);
    await page.getByLabel("Preview canvas").getByTestId("monitor-tab-source").click();
    await expect.poll(async () => (await readSource(page)).marks).toEqual({ in: 1, out: 3 });
  });

  test("Insert (,) at the Program playhead onto Main ripples it; one undo restores the timeline", async ({ page }) => {
    await openEditor(page);
    await openSource(page);
    await markSource(page, 1, 3);
    await targetTrack(page, "Main");
    await seek(page, 2);
    const before = await readState(page);

    // Keyboard focus is on the Source monitor, so "," edits from the source.
    await focusSource(page);
    await page.keyboard.press(",");
    await settle(page, 500);
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 2, 0, 2],
      [2, 2, 1, 3],
      [4, 4, 2, 6],
    ]);
    expect(after.playhead).toBeCloseTo(4, 2);
    expect(after.historyLength).toBe(before.historyLength + 1);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(undone.historyLength).toBe(before.historyLength);
    await redo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(clipsOf(after, "Main")));
  });

  test("Overwrite onto B-roll from the button leaves Main untouched; one undo", async ({ page }) => {
    await openEditor(page);
    await openSource(page);
    await markSource(page, 1, 3);
    await targetTrack(page, "B-roll");
    await seek(page, 1);
    const before = await readState(page);

    await page.getByRole("button", { name: "Overwrite (.)" }).click();
    await settle(page, 500);
    const after = await readState(page);
    expect(shape(clipsOf(after, "B-roll"))).toEqual([[1, 2, 1, 3]]);
    expect(shape(clipsOf(after, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(after.historyLength).toBe(before.historyLength + 1);

    await undo(page);
    const undone = await readState(page);
    expect(clipsOf(undone, "B-roll")).toHaveLength(0);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(clipsOf(before, "Main")));
  });

  test("three-point edit: source In + sequence In/Out fits the source to the sequence range", async ({ page }) => {
    await openEditor(page);
    await openSource(page);
    await focusSource(page);
    await sourceSeek(page, 1);
    await page.keyboard.press("i");
    await setSequenceRange(page, 2, 5);
    await seek(page, 0);
    const before = await readState(page);

    // Source In only + sequence In/Out (3s): Out is derived (1s + 3s = 4s).
    await targetTrack(page, "Main");
    await page.getByRole("button", { name: "Insert (,)" }).click();
    await settle(page, 500);
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 2, 0, 2],
      [2, 3, 1, 4],
      [5, 4, 2, 6],
    ]);
    await undo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(clipsOf(before, "Main")));
  });

  test("drag video-only from the Source monitor onto B-roll places a muted video clip at the drop", async ({ page }) => {
    await openEditor(page);
    await openSource(page);
    await markSource(page, 1, 3);
    await setZoom(page, 100);
    const before = await readState(page);
    const broll = track(before, "B-roll");

    const lane = page.locator(`[data-track-lane="${broll.id}"]`);
    await lane.scrollIntoViewIfNeeded();
    const box = await lane.boundingBox();
    if (!box) throw new Error("B-roll lane not visible");
    await page.getByTestId("drag-video-only").dragTo(lane, {
      targetPosition: { x: 250, y: box.height / 2 },
    });
    await settle(page, 600);

    const after = await readState(page);
    const placed = clipsOf(after, "B-roll");
    expect(placed).toHaveLength(1);
    expect(placed[0].duration).toBeCloseTo(2, 3);
    expect(placed[0].inPoint).toBeCloseTo(1, 3);
    expect(placed[0].outPoint).toBeCloseTo(3, 3);
    expect(placed[0].start).toBeGreaterThan(2);
    expect(placed[0].start).toBeLessThan(3);
    expect(after.historyLength).toBe(before.historyLength + 1);
    const volume = await page.evaluate((id) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
      const clip = e.project.getState().project.timeline.tracks
        .flatMap((t: any) => t.clips)
        .find((c: any) => c.id === id);
      return [clip.volume, clip.metadata?.sourceMonitorComponent];
    }, placed[0].id);
    expect(volume).toEqual([0, "video"]);
    // Main is untouched.
    expect(shape(clipsOf(after, "Main"))).toEqual(shape(clipsOf(before, "Main")));

    await undo(page);
    expect(clipsOf(await readState(page), "B-roll")).toHaveLength(0);
  });

  test("Match Frame (F) opens the Source monitor at the matched source frame", async ({ page }) => {
    await openEditor(page);
    const before = await readState(page);
    // Program at 3.5s shows the source at 3.5s (single clip, no offset).
    await seek(page, 3.5);
    await press(page, "f");
    await expect(page.getByTestId("source-monitor")).toBeVisible();
    const s = await readSource(page);
    expect(s.tab).toBe("source");
    expect(s.position).toBeCloseTo(3.5, 2);
    await expect(page.getByTestId("source-timecode")).toHaveText("00:00:03:15");
    // The source video element really sits on that frame.
    await expect
      .poll(() =>
        page.evaluate(() => (document.querySelector('[data-testid="source-video"]') as HTMLVideoElement).currentTime),
      )
      .toBeCloseTo(3.5, 1);
    // Navigation only: no edit.
    expect((await readState(page)).historyLength).toBe(before.historyLength);

    // Split Main so the clip under the playhead starts mid-source, then match again.
    await page.getByTestId("source-monitor").getByTestId("monitor-tab-program").click();
    await press(page, "s");
    await seek(page, 5);
    await press(page, "f");
    await expect.poll(async () => (await readSource(page)).position).toBeCloseTo(5, 2);
  });

  test("shortcuts act on the focused monitor", async ({ page }) => {
    await openEditor(page);
    await seek(page, 2);
    await openSource(page);
    await focusSource(page);
    await sourceSeek(page, 0.5);
    await page.keyboard.press("ArrowRight");
    // Source focused: the arrow moved the Source playhead, not the Program one.
    expect((await readSource(page)).position).toBeCloseTo(0.5 + 1 / 30, 3);
    expect((await readState(page)).playhead).toBeCloseTo(2, 3);

    // Click back into the timeline area: shortcuts return to the Program.
    await page.getByLabel("Main track").click({ position: { x: 20, y: 10 } });
    await expect.poll(async () => (await readSource(page)).focus).toBe("program");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press("ArrowRight");
    await settle(page, 300);
    expect((await readState(page)).playhead).toBeCloseTo(2 + 1 / 30, 2);
    expect((await readSource(page)).position).toBeCloseTo(0.5 + 1 / 30, 3);
  });
});
