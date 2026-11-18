import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipLocator, openEditor, press, seek, setZoom, settle, undo } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";
import { importInput } from "./helpers";

/**
 * On-timeline clip gain rubber band, checked in real Chrome:
 *  - Cmd-click on the line adds points; a point drags to a dB value (one undo step per gesture);
 *  - the exported audio follows the line (first quarter at the original level, last quarter 12 dB lower);
 *  - undo removes the points and the export returns to the original level;
 *  - a locked track refuses the edit with the engine's own message;
 *  - the line is opt-in per track and the playhead shortcut adds a keyframe.
 */

interface Hook {
  project: { getState(): Record<string, any> };
  timeline: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  audio: Record<string, any>;
}
declare function E(): Hook;

const TONE = "Select media tone-4s.wav";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

/** Main (picture + its own audio) is muted; the 4 s 330 Hz tone sits on Dialogue at 0. */
async function buildToneClip(page: Page) {
  await openEditor(page);
  await importInput(page).setInputFiles(AUDIO_FIXTURE_PATH);
  await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
  const ids = await page.evaluate(async () => {
    const st = E().project.getState();
    const tracks = st.project.timeline.tracks;
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "tone-4s.wav");
    const dialogue = tracks.find((t: any) => t.name === "Dialogue");
    const main = tracks.find((t: any) => t.name === "Main");
    const added = await st.addClip(dialogue.id, item.id, 0);
    await st.muteTrack(main.id, true);
    const clip = E().project.getState().project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0];
    return { ok: added.success as boolean, trackId: dialogue.id as string, clipId: clip?.id as string };
  });
  expect(ids.ok).toBe(true);
  await settle(page, 500);
  return ids;
}

const clipState = (page: Page, clipId: string) =>
  page.evaluate(
    (id) => {
      const clip = E().project.getState().getClip(id);
      return { volume: clip.volume as number, points: (clip.automation?.volume ?? null) as Array<{ time: number; value: number }> | null };
    },
    clipId,
  );

const historyDepth = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

const showGainLine = (page: Page, trackId: string, visible = true) =>
  page.evaluate(([id, on]) => E().timeline.getState().setGainLineVisible(id, on), [trackId, visible] as const);

/** Same piecewise scale as clip-gain-geometry: 0 dB at 60 percent height, log below. */
const yFraction = (db: number) => {
  if (db >= 0) return 0.4 * (1 - db / 12);
  return 0.4 + 0.6 * (Math.log(1 + -db / 6) / Math.log(1 + 60 / 6));
};

async function gainBox(page: Page, clipId: string) {
  const svg = clipLocator(page, clipId).locator("[data-clip-gain-line] svg");
  await svg.waitFor({ timeout: 10_000 });
  const box = await svg.boundingBox();
  if (!box) throw new Error("gain line has no box");
  return box;
}

/** Cmd-click the (flat 0 dB) line at a fraction of the clip's width. */
async function cmdClickLine(page: Page, clipId: string, fraction: number) {
  const box = await gainBox(page, clipId);
  await page.keyboard.down("Meta");
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height * yFraction(0));
  await page.keyboard.up("Meta");
  await settle(page, 250);
}

async function dragPointToDb(page: Page, clipId: string, index: number, db: number) {
  const box = await gainBox(page, clipId);
  const dot = await clipLocator(page, clipId).locator(`[data-gain-hit="${index}"]`).boundingBox();
  if (!dot) throw new Error(`point ${index} not found`);
  const x = dot.x + dot.width / 2;
  await page.mouse.move(x, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * yFraction(db), { steps: 12 });
  await page.mouse.up();
  await settle(page, 250);
}

/** Per-quarter RMS of the exported WAV's left channel for the first 4 s (the tone clip). */
async function exportedQuarterLevels(page: Page): Promise<{ first: number; last: number }> {
  const base64 = await page.evaluate(async () => {
    const engine = E().audio.getExportEngine();
    await engine.initialize?.();
    const project = E().project.getState().getFullProject();
    const gen = engine.exportAudio(project, { format: "wav", sampleRate: 48000, bitDepth: 16, channels: 2 });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    const result = step.value;
    if (!result.success) throw new Error(result.error?.message ?? "export failed");
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const wav = Buffer.from(base64, "base64");
  const dataAt = wav.indexOf("data", 12, "latin1");
  const channels = wav.readUInt16LE(22);
  const rate = wav.readUInt32LE(24);
  expect(wav.readUInt16LE(34), "16-bit PCM export").toBe(16);
  const first = dataAt + 8;
  const rms = (from: number, to: number) => {
    let sum = 0;
    let n = 0;
    for (let s = Math.floor(from * rate); s < Math.floor(to * rate); s++) {
      const v = wav.readInt16LE(first + s * channels * 2) / 32768;
      sum += v * v;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  // Quarters of the 4 s clip, trimmed 50 ms off each edge.
  return { first: rms(0.05, 0.95), last: rms(3.05, 3.95) };
}

const db = (ratio: number) => 20 * Math.log10(ratio);

test.describe("clip gain rubber band", () => {
  test.describe.configure({ timeout: 240_000 });

  test("is opt-in per track (Show Clip Keyframes) and hidden on short tracks", async ({ page }) => {
    const { trackId, clipId } = await buildToneClip(page);
    await expect(clipLocator(page, clipId).locator("[data-clip-gain-line]")).toHaveCount(0);

    await page.getByRole("group", { name: /Dialogue track/ }).first().click({ button: "right" });
    await page.getByRole("menuitemcheckbox", { name: "Show Clip Keyframes" }).click();
    await expect(clipLocator(page, clipId).locator("[data-clip-gain-line]")).toHaveCount(1);
    await expect(clipLocator(page, clipId).locator('[data-gain-grid="0"]')).toHaveCount(1);

    await page.evaluate((id) => E().timeline.getState().setTrackHeightById(id, 40), trackId);
    await expect(clipLocator(page, clipId).locator("[data-clip-gain-line]")).toHaveCount(0);
    await page.evaluate((id) => E().timeline.getState().setTrackHeightById(id, 64), trackId);
    await expect(clipLocator(page, clipId).locator("[data-clip-gain-line]")).toHaveCount(1);
  });

  test("Cmd-click twice, drag the second point to -12 dB: the export is level in the first quarter and 12 dB lower in the last; undo restores it", async ({ page }) => {
    const { trackId, clipId } = await buildToneClip(page);
    await setZoom(page, 120);
    await showGainLine(page, trackId);

    const original = await exportedQuarterLevels(page);
    expect(original.first).toBeGreaterThan(0.01);
    expect(Math.abs(db(original.last / original.first))).toBeLessThan(0.3);

    const depth0 = await historyDepth(page);
    await cmdClickLine(page, clipId, 0.25);
    expect(await historyDepth(page)).toBe(depth0 + 1);
    await cmdClickLine(page, clipId, 0.5);
    expect(await historyDepth(page)).toBe(depth0 + 2);
    let state = await clipState(page, clipId);
    expect(state.points).toHaveLength(2);
    expect(state.points![0].time).toBeCloseTo(1, 1);
    expect(state.points![1].time).toBeCloseTo(2, 1);
    expect(state.points!.every((p) => Math.abs(p.value - 1) < 1e-6)).toBe(true);

    await dragPointToDb(page, clipId, 1, -12);
    expect(await historyDepth(page), "a drag is one undo step").toBe(depth0 + 3);
    state = await clipState(page, clipId);
    expect(state.points).toHaveLength(2);
    expect(db(state.points![1].value)).toBeGreaterThan(-13.5);
    expect(db(state.points![1].value)).toBeLessThan(-10.5);

    // Play it live for a moment, then export.
    await page.evaluate(() => {
      const t = E().timeline.getState();
      t.seekTo(0.5);
      t.play();
    });
    await settle(page, 1200);
    await page.evaluate(() => E().timeline.getState().pause());

    const edited = await exportedQuarterLevels(page);
    const firstDelta = db(edited.first / original.first);
    const lastDelta = db(edited.last / original.last);
    console.log(`[clip-gain] export first quarter ${firstDelta.toFixed(2)} dB, last quarter ${lastDelta.toFixed(2)} dB vs original`);
    expect(Math.abs(firstDelta)).toBeLessThan(1.5);
    expect(Math.abs(lastDelta - -12)).toBeLessThan(1.5);

    // The inspector's keyframe list sees the same points (it reads the store).
    await clickClip(page, clipId);
    await seek(page, 2);
    await page.getByRole("tab", { name: "Audio" }).first().click();
    await expect(page.getByRole("button", { name: "Remove volume keyframe" })).toBeVisible();

    // Three gestures, three undo steps, back to the original level.
    await undo(page);
    await undo(page);
    await undo(page);
    state = await clipState(page, clipId);
    expect(state.points).toBeNull();
    expect(await historyDepth(page)).toBe(depth0);
    const restored = await exportedQuarterLevels(page);
    expect(Math.abs(db(restored.last / original.last))).toBeLessThan(0.3);
    expect(Math.abs(db(restored.first / original.first))).toBeLessThan(0.3);
  });

  test("a locked track refuses the edit and shows the locked-track message", async ({ page }) => {
    const { trackId, clipId } = await buildToneClip(page);
    await setZoom(page, 120);
    await showGainLine(page, trackId);
    await page.evaluate(async (id) => E().project.getState().lockTrack(id, true), trackId);
    await settle(page, 300);

    const depth = await historyDepth(page);
    await cmdClickLine(page, clipId, 0.5);
    await expect(page.getByText(/is locked/).first()).toBeVisible({ timeout: 5_000 });
    expect((await clipState(page, clipId)).points).toBeNull();
    expect(await historyDepth(page)).toBe(depth);
  });

  test("Alt+G adds a keyframe at the playhead on the selected clip, Alt-click removes a point", async ({ page }) => {
    const { trackId, clipId } = await buildToneClip(page);
    await setZoom(page, 120);
    await showGainLine(page, trackId);
    // Click the top edge of the clip: a click on the line itself adds a point instead of selecting.
    const clipBox = await clipLocator(page, clipId).boundingBox();
    if (!clipBox) throw new Error("clip not visible");
    await page.mouse.click(clipBox.x + clipBox.width / 2, clipBox.y + 3);
    await settle(page, 250);
    expect((await clipState(page, clipId)).points).toBeNull();
    await seek(page, 1.5);
    const playhead = await page.evaluate(() => E().timeline.getState().playheadPosition as number);
    expect(playhead).toBeCloseTo(1.5, 1);
    await press(page, "Alt+g");
    const state = await clipState(page, clipId);
    expect(state.points).toHaveLength(1);
    expect(state.points![0].time).toBeCloseTo(1.5, 1);

    const dot = await clipLocator(page, clipId).locator('[data-gain-hit="0"]').boundingBox();
    if (!dot) throw new Error("point not drawn");
    await page.keyboard.down("Alt");
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.keyboard.up("Alt");
    await settle(page, 250);
    expect((await clipState(page, clipId)).points).toBeNull();
  });
});
