import { type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_FFMPEG } from "./env";
import { FRAME, clickClip, press, readState, redo, seek, settle, undo } from "./helpers";
import {
  CAMERAS,
  CLAPS,
  E,
  expect,
  frameColor,
  generateCameras,
  historyLength,
  nearestCamera,
  openCreateDialog,
  openMulticamEditor,
  probeDuration,
  readCuts,
  snapshot,
  waitForPlayhead,
  type Hook,
} from "./multicam-lib";

const hook = (page: Page) => E(page);
const MP4_SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 };
const COLOR_OF_ANGLE = CAMERAS.map((c) => c.color);
const workDir = mkdtempSync(join(tmpdir(), "openreel-multicam-out-"));

const cameraOf = (media: string) => CAMERAS.find((c) => c.file === media)!;
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

async function waitDone(page: Page, id: string, timeout = 240_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const job = h.exportQueue.getState().queue.jobs.find((x: Record<string, any>) => x.id === jobId);
      return job ? { status: job.status as string, error: job.error as string | undefined, outputName: job.outputName as string } : null;
    }, id);
    if (!j) throw new Error(`no job ${id}`);
    if (j.status === "completed") return;
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`export ${j.status}: ${j.error}`);
    if (Date.now() > deadline) throw new Error("export did not finish in time");
    await page.waitForTimeout(300);
  }
}

/**
 * The whole multicam flow in a real browser: sync by audio (offsets checked
 * against the ones the cameras were generated with), the monitor grid, four
 * cuts recorded live with the number keys while the timeline plays, an angle
 * switch after the fact, an audio-mode change, flatten, export (a frame of
 * every segment shows the right camera), undo of everything, redo.
 */
export async function runMulticamFlow(page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(540_000);
  generateCameras();
  await openMulticamEditor(page);
  const initial = await snapshot(page);
  const h0 = await historyLength(page);

  // ---- Sync by audio waveform ------------------------------------------------
  await openCreateDialog(page);
  for (const cam of CAMERAS) await page.getByRole("checkbox", { name: `Use ${cam.file} as an angle` }).click();
  await page.getByTestId("multicam-analyze").click();
  await expect(page.getByTestId("multicam-offsets")).toBeVisible({ timeout: 180_000 });
  const measured = await page.getByTestId("multicam-offset-row").evaluateAll((rows) =>
    rows.map((row) => Number(row.querySelector("td[data-offset]")?.getAttribute("data-offset"))),
  );
  const errors = measured.map((value, i) => value - CAMERAS[i].offset);
  console.log(`[multicam] audio sync offsets ${measured.map((v) => v.toFixed(4)).join(", ")} vs known ${CAMERAS.map((c) => c.offset).join(", ")} (errors ms: ${errors.map((e) => (e * 1000).toFixed(1)).join(", ")})`);
  for (const [i, error] of errors.entries()) expect(Math.abs(error), `angle ${i + 1} offset error`).toBeLessThan(FRAME);
  await page.getByTestId("multicam-create").click();
  await expect(page.getByTestId("multicam-monitor")).toBeVisible({ timeout: 20_000 });
  expect(await historyLength(page)).toBe(h0 + 1);
  let cuts = await readCuts(page);
  expect(cuts).toHaveLength(1);
  expect(cuts[0]).toMatchObject({ angle: 1, media: "cam-red.mp4", start: 0, tagged: true });
  expect(cuts[0].duration).toBeCloseTo(10.8, 1);
  const stored = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    return p.multicamSources[0].angles.map((a: any) => a.offset as number);
  });
  for (const [i, offset] of stored.entries()) expect(Math.abs(offset - CAMERAS[i].offset)).toBeLessThan(FRAME);

  // ---- Monitor: grid, highlight ----------------------------------------------
  const tiles = page.getByTestId("multicam-angle");
  await expect(tiles).toHaveCount(3);
  await expect(page.getByTestId("multicam-grid-view")).toHaveAttribute("data-columns", "2");
  await expect(tiles.nth(0)).toHaveAttribute("data-active", "true");
  await expect(tiles.nth(1)).toHaveAttribute("data-active", "false");
  await page.getByTestId("multicam-grid").click();
  await page.getByRole("option", { name: "Grid: 3 × 3" }).click();
  await expect(page.getByTestId("multicam-grid-view")).toHaveAttribute("data-columns", "3");
  await page.getByTestId("multicam-grid").click();
  await page.getByRole("option", { name: "Grid: 2 × 2" }).click();
  await expect(page.getByTestId("multicam-grid-view")).toHaveAttribute("data-columns", "2");
  // No tile overflows the monitor (checked at the real stage width).
  const overflow = await page.getByTestId("multicam-monitor").evaluate((root) => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll("[data-testid='multicam-angle'], [data-testid='multicam-toolbar'] button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1;
    }).length;
  });
  expect(overflow, "monitor controls/tiles inside the stage").toBe(0);
  await page.screenshot({ path: join(workDir, "monitor.png") });

  // ---- Record a pass of four cuts with the number keys -----------------------
  const beforeRecord = await historyLength(page);
  await seek(page, 0);
  await page.getByTestId("multicam-record").click();
  await expect(page.getByTestId("multicam-rec-status")).toBeVisible();
  const plan: Array<[number, string]> = [[1.6, "2"], [3.4, "3"], [5.0, "1"], [6.8, "2"]];
  const pressed: Array<{ key: string; before: number; after: number }> = [];
  for (const [at, key] of plan) {
    const read = () => page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState().playheadPosition as number);
    await waitForPlayhead(page, at);
    const before = await read();
    await page.keyboard.press(key);
    pressed.push({ key, before, after: await read() });
  }
  await waitForPlayhead(page, 7.2);
  const pending = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.multicam.getState().pending as Array<{ time: number; angleId: string }>);
  expect(pending).toHaveLength(4);
  expect(await historyLength(page), "nothing is committed until the pass stops").toBe(beforeRecord);
  await page.getByTestId("multicam-record").click(); // Stop recording
  await expect.poll(() => historyLength(page), { timeout: 20_000 }).toBe(beforeRecord + 1);
  cuts = await readCuts(page);
  expect(cuts.map((c) => c.angle)).toEqual([1, 2, 3, 1, 2, 1]);
  const snapped = (t: number) => Math.round(t * 30) / 30;
  for (const [i, press] of pending.entries()) {
    const clip = cuts[i + 1];
    expect(near(clip.start, snapped(press.time), 1e-6), `cut ${i + 1} lands on the recorded frame`).toBe(true);
    // The cut lies between the live playhead sampled just before and just after the key press.
    expect(clip.start, `cut ${i + 1} not before the press`).toBeGreaterThanOrEqual(pressed[i].before - FRAME);
    expect(clip.start, `cut ${i + 1} not after the press`).toBeLessThanOrEqual(pressed[i].after + FRAME);
  }
  console.log(`[multicam] recorded cut times ${cuts.slice(1, 5).map((c) => c.start.toFixed(3)).join(", ")} (targets ${plan.map(([t]) => t).join(", ")})`);
  for (const clip of cuts) {
    const cam = cameraOf(clip.media);
    // Every piece shows the same shared moment its timeline position implies, whatever its camera.
    expect(Math.abs(clip.inPoint + cam.offset - (1.2 + clip.start)), `${clip.media}@${clip.start} stays in sync`).toBeLessThan(1e-3);
  }
  expect(cuts.reduce((sum, c) => sum + c.duration, 0)).toBeCloseTo(10.8, 1);
  const afterRecord = await snapshot(page);

  // ---- Switch one cut's angle after the fact ---------------------------------
  const target = cuts[2]; // angle 3 (blue)
  await seek(page, target.start + target.duration / 2);
  const beforeSwitch = await historyLength(page);
  await page.getByRole("button", { name: /^Angle 1: / }).click();
  await expect.poll(() => historyLength(page)).toBe(beforeSwitch + 1);
  cuts = await readCuts(page);
  expect(cuts.map((c) => c.angle)).toEqual([1, 2, 1, 1, 2, 1]);
  expect(cuts[2]).toMatchObject({ media: "cam-red.mp4", start: target.start });
  expect(cuts[2].duration).toBeCloseTo(target.duration, 6);
  expect(Math.abs(cuts[2].inPoint + 0 - (1.2 + cuts[2].start))).toBeLessThan(1e-3);
  await expect(page.getByTestId("multicam-angle").nth(0)).toHaveAttribute("data-active", "true");
  const afterSwitch = await snapshot(page);
  await undo(page);
  await expect.poll(async () => snapshot(page)).toBe(afterRecord);
  await redo(page);
  await expect.poll(async () => snapshot(page)).toBe(afterSwitch);

  // ---- Audio mode: fixed audio angle ------------------------------------------
  const beforeAudio = await historyLength(page);
  await page.getByTestId("multicam-audio").click();
  await page.getByRole("option", { name: /Fixed audio: 2 / }).click();
  await expect.poll(() => historyLength(page)).toBe(beforeAudio + 1);
  const fixed = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const audio = p.timeline.tracks.find((t: any) => t.name === "Multicam Audio");
    const video = p.timeline.tracks.filter((t: any) => t.type === "video").flatMap((t: any) => t.clips);
    return {
      audioClips: audio?.clips.map((c: any) => ({ start: c.startTime, duration: c.duration, inPoint: c.inPoint, media: p.mediaLibrary.items.find((m: any) => m.id === c.mediaId)?.name })) ?? [],
      silenced: video.every((c: any) => c.volume === 0),
    };
  });
  expect(fixed.silenced).toBe(true);
  expect(fixed.audioClips).toHaveLength(1);
  expect(fixed.audioClips[0].media).toBe("cam-green.mp4");
  expect(fixed.audioClips[0].start).toBeCloseTo(0, 6);
  expect(fixed.audioClips[0].duration).toBeCloseTo(10.8, 1);
  expect(Math.abs(fixed.audioClips[0].inPoint + CAMERAS[1].offset - 1.2)).toBeLessThan(1e-6); // shared 1.2 at timeline 0
  await undo(page);
  await expect.poll(async () => snapshot(page)).toBe(afterSwitch);
  await redo(page);
  await expect.poll(() => historyLength(page)).toBe(beforeAudio + 1);
  // Back to "audio follows video" for the export check below (one more step).
  await page.getByTestId("multicam-audio").click();
  await page.getByRole("option", { name: "Audio follows video" }).click();
  await expect.poll(() => historyLength(page)).toBe(beforeAudio + 2);
  expect((await readCuts(page)).every((c) => c.tagged)).toBe(true);

  // ---- Flatten to the active angle (one undo step) ----------------------------
  const preFlatten = await readCuts(page);
  const beforeFlatten = await historyLength(page);
  await page.getByTestId("multicam-flatten").click();
  await expect.poll(() => historyLength(page)).toBe(beforeFlatten + 1);
  const flat = await readCuts(page);
  expect(flat.every((c) => !c.tagged)).toBe(true);
  expect(flat.map((c) => [c.media, c.start, c.duration, c.inPoint])).toEqual(preFlatten.map((c) => [c.media, c.start, c.duration, c.inPoint]));
  const afterFlatten = await snapshot(page);

  // ---- Export; a frame of every segment shows the right camera ----------------
  await page.evaluate((settings) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const job = h.exportQueue.getState().enqueue({ settings, presetLabel: "Multicam" });
    if (!job) throw new Error("enqueue returned null");
    (window as unknown as { __mcJob: string }).__mcJob = job.id;
    h.exportQueue.getState().start();
  }, MP4_SMALL);
  const jobId = await page.evaluate(() => (window as unknown as { __mcJob: string }).__mcJob);
  await waitDone(page, jobId);
  const outputName = await page.evaluate((id) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    return h.exportQueue.getState().queue.jobs.find((x: Record<string, any>) => x.id === id).outputName as string;
  }, jobId);
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
  const file = join(workDir, "multicam-export.mp4");
  await download.saveAs(file);
  expect(Math.abs(probeDuration(file) - 10.8)).toBeLessThan(0.15);
  const wrong: string[] = [];
  for (const clip of flat) {
    const expected = cameraOf(clip.media).color;
    for (const t of [clip.start + 3 * FRAME, clip.start + clip.duration / 2, clip.start + clip.duration - 3 * FRAME]) {
      const got = nearestCamera(frameColor(file, t));
      if (got !== expected) wrong.push(`t=${t.toFixed(2)} expected ${expected} got ${got}`);
    }
  }
  expect(wrong, "exported frames per segment").toEqual([]);
  console.log(`[multicam] export checked ${flat.length} segments x3 frames, colours ${flat.map((c) => cameraOf(c.media).color).join(" ")}`);
  void COLOR_OF_ANGLE;

  // ---- Undo everything, exactly; then redo ------------------------------------
  const steps = (await historyLength(page)) - h0;
  expect(steps).toBe(6); // create+place, record, switch, fixed audio, follow audio, flatten
  for (let i = 0; i < steps; i++) await undo(page);
  await expect.poll(async () => snapshot(page)).toBe(initial);
  for (let i = 0; i < steps; i++) await redo(page);
  await expect.poll(async () => snapshot(page)).toBe(afterFlatten);
  await settle(page, 200);
}

/** Persistence, sync lock, and an opened nest, on a cut made through the controller. */
export async function runMulticamPersistenceFlow(page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(300_000);
  generateCameras();
  await openMulticamEditor(page);
  const mediaIds = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    return ["cam-red.mp4", "cam-green.mp4", "cam-blue.mp4"].map((n) => p.mediaLibrary.items.find((m: any) => m.id && m.name === n).id as string);
  });
  // Create through the same command the dialog uses (manual offsets: the audio path is covered by the main flow).
  const result = await page.evaluate(async ({ ids, offsets }) => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const created = await h.multicamController.createMulticamSourceCommand({
      name: "Persisted",
      syncMethod: "manual",
      angles: ids.map((mediaId, i) => ({ mediaId, offset: offsets[i] })),
      audio: { mode: "fixed", mediaId: ids[0] },
      placeAtPlayhead: true,
    });
    return created.ok ? { ok: true } : { ok: false, message: created.message };
  }, { ids: mediaIds, offsets: CAMERAS.map((c) => c.offset) });
  expect(result.ok).toBe(true);
  await page.evaluate(() => (window as unknown as { __openreelE2E: { source: { getState(): any } } }).__openreelE2E.source.getState().setTab("multicam"));
  await settle(page, 400);
  expect((await readCuts(page))).toHaveLength(1);

  // Record cuts through the same store/commands the number keys use.
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const source = h.project.getState().project.multicamSources[0];
    const store = h.multicam.getState() as any;
    store.begin(0);
    store.addCut({ time: 2, angleId: source.angles[1].id });
    store.addCut({ time: 4, angleId: source.angles[2].id });
    h.timeline.getState().seekTo(6);
    await h.multicamController.stopRecording();
  });
  await expect.poll(async () => (await readCuts(page)).map((c) => c.angle)).toEqual([1, 2, 3, 1]);

  // Sync lock with a fixed audio angle: the Multicam Audio track is derived from the picture, so it neither
  // blocks nor needs to follow a ripple; the audio is re-derived and stays locked, in the same single undo step.
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const source = h.project.getState().project.multicamSources[0];
    await h.multicamController.setAudioModeCommand(source.id, { mode: "fixed", angleId: source.angles[0].id });
  });
  const clips = await readCuts(page);
  await clickClip(page, clips[1].id);
  const fixedBefore = await snapshot(page);
  const fixedHistory = await historyLength(page);
  await press(page, "Shift+Delete");
  await expect.poll(() => historyLength(page)).toBe(fixedHistory + 1);
  expect(await audioLockError(page), "fixed audio stays locked after a ripple delete").toBeLessThan(1e-6);
  await undo(page);
  await expect.poll(async () => snapshot(page)).toBe(fixedBefore);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    await h.multicamController.setAudioModeCommand(h.project.getState().project.multicamSources[0].id, { mode: "follow" });
  });
  await clickClip(page, clips[1].id);
  const rippleFrom = await snapshot(page);
  const beforeRipple = await historyLength(page);
  await press(page, "Shift+Delete");
  await expect.poll(() => historyLength(page)).toBe(beforeRipple + 1);
  const after = await readCuts(page);
  expect(after).toHaveLength(3);
  const end = (list: typeof after) => Math.max(...list.map((c) => c.start + c.duration));
  expect(end(clips) - end(after)).toBeCloseTo(clips[1].duration, 2);
  expect(after[1].start).toBeCloseTo(clips[1].start, 6);
  await undo(page);
  await expect.poll(async () => snapshot(page)).toBe(rippleFrom);

  // Nest the cut, open the nest, switch an angle inside it.
  const all = await readCuts(page);
  await page.evaluate((ids) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    h.ui.getState().clearSelection();
    for (const id of ids) h.ui.getState().select({ type: "clip", id }, true);
  }, all.map((c) => c.id));
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { sequence: Record<string, any> } }).__openreelE2E;
    await h.sequence.nestSelectedClips("Cut nest");
  });
  await settle(page, 600);
  const nestId = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.sequences.find((s: any) => s.name === "Cut nest")?.id as string);
  expect(nestId).toBeTruthy();
  await page.evaluate(async (id) => {
    const h = (window as unknown as { __openreelE2E: Hook & { sequence: Record<string, any> } }).__openreelE2E;
    await h.sequence.openSequence(id);
  }, nestId);
  await settle(page, 600);
  const inside = await readCuts(page);
  expect(inside.every((c) => c.tagged)).toBe(true);
  await seek(page, inside[1].start + 0.3);
  const beforeInside = await historyLength(page);
  await page.getByRole("button", { name: /^Angle 3: / }).click();
  await expect.poll(() => historyLength(page)).toBe(beforeInside + 1);
  expect((await readCuts(page))[1].angle).toBe(3);

  // Autosave, reload, recover: sources, tags and the nest persist.
  const before = JSON.stringify(await readCuts(page));
  const projectId = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.id as string);
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().forceSave());
  await page.reload();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
  const recovered = await page.evaluate(async (savedProjectId) => {
    const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(v: unknown): void } } }).__openreelE2E.project;
    store.setState({ project: { ...store.getState().project, id: savedProjectId } });
    const saves = await store.getState().checkForRecovery();
    if (!saves.length) return false;
    return store.getState().recoverFromAutoSave(saves[0].id);
  }, projectId);
  expect(recovered).toBe(true);
  expect(JSON.stringify(await readCuts(page))).toBe(before);
  const sources = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.multicamSources?.length as number);
  expect(sources).toBe(1);
  void readState;
}

/**
 * Reviewer addition: the dialog's Timecode sync and its fixed-audio-angle
 * choice, which the audio-sync flow never drove. Timecodes 00:00:00:00,
 * 00:00:01:06 and 00:00:00:15 at 30 fps are 0, 1.2 and 0.5 s; the audio angle
 * picked is angle 3 (blue), and the created source must keep that choice.
 */
export async function runMulticamTimecodeDialogFlow(page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(240_000);
  generateCameras();
  await openMulticamEditor(page);
  await openCreateDialog(page);
  for (const cam of CAMERAS) await page.getByRole("checkbox", { name: `Use ${cam.file} as an angle` }).click();
  await page.getByTestId("multicam-sync-timecode").click();
  const codes = ["00:00:00:00", "00:00:01:06", "00:00:00:15"];
  for (const [i, cam] of CAMERAS.entries()) await page.getByLabel(`Start timecode of ${cam.file}`).fill(codes[i]);
  await page.getByRole("checkbox", { name: "Use a fixed audio angle" }).click();
  await page.getByRole("combobox", { name: "Audio angle" }).click();
  await page.getByRole("option", { name: /3 cam-blue/ }).click();
  await page.getByTestId("multicam-create").click();
  await expect(page.getByTestId("multicam-monitor")).toBeVisible({ timeout: 20_000 });
  const stored = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const source = p.multicamSources[0];
    const audioClips = p.timeline.tracks.filter((t: any) => t.type === "audio").flatMap((t: any) => t.clips.map((c: any) => c.mediaId as string));
    const audioAngle = source.angles.find((a: any) => a.id === source.audio.angleId);
    return { offsets: source.angles.map((a: any) => a.offset as number), mode: source.audio.mode as string, audioMedia: audioAngle?.mediaId as string, audioClips, method: source.syncMethod as string };
  });
  expect(stored.method).toBe("timecode");
  for (const [i, expected] of [0, 1.2, 0.5].entries()) expect(Math.abs(stored.offsets[i] - expected)).toBeLessThan(1e-6);
  expect(stored.mode).toBe("fixed");
  const blue = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    return p.mediaLibrary.items.find((m: any) => m.name === "cam-blue.mp4").id as string;
  });
  expect(stored.audioMedia, "the chosen audio angle, not always angle 1").toBe(blue);
  expect(stored.audioClips).toEqual([blue]);
}


/**
 * Largest |heard - shown| (seconds) over every multicam picture clip when a fixed audio angle is set:
 * at sample points inside each picture clip, the audio clip that covers it plays the angle's media at
 * the time that corresponds to the SAME shared moment as the picture. 0 means sample-locked.
 */
export async function audioLockError(page: Page): Promise<number> {
  return page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const source = (p.multicamSources ?? [])[0];
    if (!source || source.audio.mode !== "fixed") return Infinity;
    const fixed = source.angles.find((a: any) => a.id === source.audio.angleId);
    const clips = p.timeline.tracks.flatMap((t: any) => t.clips);
    const audio = clips.filter((c: any) => c.metadata?.multicamAudio === source.id);
    let worst = 0;
    for (const clip of clips) {
      const tag = clip.metadata?.multicam;
      if (!tag || tag.sourceId !== source.id) continue;
      const angle = source.angles.find((a: any) => a.id === tag.angleId);
      for (const f of [0.02, 0.5, 0.98]) {
        const t = clip.startTime + clip.duration * f;
        const sourceTime = (c: any) => {
          const local = (t - c.startTime) * Math.abs(c.speed ?? 1);
          return c.reversed ? c.outPoint - local : c.inPoint + local;
        };
        const shared = sourceTime(clip) + angle.offset;
        const owner = audio.find((c: any) => t >= c.startTime && t < c.startTime + c.duration);
        if (!owner) continue;
        const heard = sourceTime(owner) + fixed.offset;
        worst = Math.max(worst, Math.abs(heard - shared));
      }
    }
    return worst;
  });
}

/** Decode a media file's audio to mono float samples at 48 kHz with ffmpeg. */
function decodeMono(file: string): Float32Array {
  const raw = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** The clean master recording the cameras were cut from (int16 WAV, 48 kHz mono). */
function masterTemplate(clap: number): Float32Array {
  const wav = readFileSync(join(generateCameras(), "master.wav"));
  const from = Math.round((clap - 0.005) * 48000);
  const length = Math.round(0.1 * 48000);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = wav.readInt16LE(44 + (from + i) * 2) / 32768;
  return out;
}

/** Sample offset (relative to `from`) at which `template` best matches `signal`, found by normalised cross-correlation. */
function bestLag(signal: Float32Array, template: Float32Array, from: number, span: number): number {
  let best = -Infinity;
  let bestAt = 0;
  for (let lag = 0; lag < span; lag++) {
    let sum = 0;
    const base = from + lag;
    if (base < 0 || base + template.length > signal.length) continue;
    for (let i = 0; i < template.length; i += 2) sum += signal[base + i] * template[i];
    if (sum > best) {
      best = sum;
      bestAt = lag;
    }
  }
  return bestAt;
}

/**
 * Multicam audio correctness in real Chrome. A fixed audio angle (the clean red mic) plays under a cut that is
 * then moved, trimmed (head and tail), slipped and razored; the exported file's claps (cross-correlated against
 * the master recording) must sit exactly where the picture says they should, within 1 ms. Undo and redo are
 * checked for the same lock, and an audio-follows-video cut is exported and measured the same way.
 */
/** `snapshot` with numbers rounded to 1 ns: undoing a trim re-derives a duration, which differs from the original by float noise. */
async function tidySnapshot(page: Page): Promise<string> {
  return JSON.stringify(JSON.parse(await snapshot(page)), (_key, value) => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value));
}

export async function runMulticamAudioLockFlow(page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(540_000);
  generateCameras();
  await openMulticamEditor(page);
  const mediaIds = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    return ["cam-red.mp4", "cam-green.mp4", "cam-blue.mp4"].map((n) => p.mediaLibrary.items.find((m: any) => m.name === n).id as string);
  });
  const created = await page.evaluate(async ({ ids, offsets }) => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const result = await h.multicamController.createMulticamSourceCommand({
      name: "Audio lock",
      syncMethod: "manual",
      angles: ids.map((mediaId, i) => ({ mediaId, offset: offsets[i] })),
      audio: { mode: "fixed", mediaId: ids[0] },
      placeAtPlayhead: true,
    });
    return result.ok;
  }, { ids: mediaIds, offsets: CAMERAS.map((c) => c.offset) });
  expect(created).toBe(true);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const source = h.project.getState().project.multicamSources[0];
    const store = h.multicam.getState() as any;
    store.begin(0);
    store.addCut({ time: 2, angleId: source.angles[1].id });
    store.addCut({ time: 4, angleId: source.angles[2].id });
    h.timeline.getState().seekTo(6);
    await h.multicamController.stopRecording();
  });
  await expect.poll(async () => (await readCuts(page)).map((c) => c.angle)).toEqual([1, 2, 3, 1]);
  expect(await audioLockError(page)).toBeLessThan(1e-9);
  const h0 = await historyLength(page);
  const originalSnapshot = await tidySnapshot(page);

  const store = (fn: string, args: unknown[]) =>
    page.evaluate(async ({ fn, args }) => {
      const result = await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState()[fn](...args);
      return { success: result?.success as boolean, error: result?.error?.message as string | undefined };
    }, { fn, args });
  const mustSucceed = async (label: string, run: Promise<{ success: boolean; error?: string }>) => {
    const r = await run;
    expect(r.success, `${label}: ${r.error}`).toBe(true);
    expect(await audioLockError(page), `${label}: audio still locked to the picture`).toBeLessThan(1e-9);
  };

  // ---- Edit the cut: move, trim head, trim tail, slip, razor, move ---------------------------------
  let cuts = await readCuts(page);
  const [c0, c1, c2, c3] = cuts;
  await mustSucceed("move", store("moveClip", [c3.id, 12]));
  cuts = await readCuts(page);
  const moved = cuts.find((c) => c.id === c3.id)!;
  await mustSucceed("trim head", store("trimClip", [c3.id, moved.inPoint + 1.0, undefined]));
  const afterHead = (await readCuts(page)).find((c) => c.id === c3.id)!;
  await mustSucceed("trim tail", store("trimClip", [c3.id, undefined, afterHead.inPoint + afterHead.duration - 0.5]));
  await mustSucceed("slip", store("slipClip", [c0.id, 0.3]));
  await mustSucceed("razor", store("splitClip", [c1.id, c1.start + 1.0]));
  await mustSucceed("move 2", store("moveClip", [c2.id, 7]));
  const steps = (await historyLength(page)) - h0;
  expect(steps).toBeGreaterThanOrEqual(6);
  const edited = await tidySnapshot(page);

  // ---- Undo everything, then redo: locked at every step, and exact --------------------------------
  // Consecutive trims share one undo step, so undo until the original comes back (bounded by the edit count).
  let undone = 0;
  while ((await tidySnapshot(page)) !== originalSnapshot && undone < steps) {
    await undo(page);
    undone++;
    await settle(page, 60);
    expect(await audioLockError(page), `undo ${undone}`).toBeLessThan(1e-9);
  }
  const afterUndo = await tidySnapshot(page);
  if (afterUndo !== originalSnapshot) {
    let at = 0;
    while (at < afterUndo.length && afterUndo[at] === originalSnapshot[at]) at++;
    console.log(`[multicam-audio] undo differs at ${at}: expected ...${originalSnapshot.slice(Math.max(0, at - 80), at + 160)} got ...${afterUndo.slice(Math.max(0, at - 80), at + 160)}`);
  }
  expect(afterUndo, "undo restores the cut exactly").toBe(originalSnapshot);
  let redone = 0;
  while ((await tidySnapshot(page)) !== edited && redone < steps) {
    await redo(page);
    redone++;
    await settle(page, 60);
    expect(await audioLockError(page), `redo ${redone}`).toBeLessThan(1e-9);
  }
  expect(await tidySnapshot(page), "redo reapplies the edits exactly").toBe(edited);

  // ---- Export and measure the claps in the file ----------------------------------------------------
  const exportAndDecode = async (name: string): Promise<Float32Array> => {
    await page.evaluate((settings) => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const job = h.exportQueue.getState().enqueue({ settings, presetLabel: "Audio lock" });
      if (!job) throw new Error("enqueue returned null");
      (window as unknown as { __mcJob: string }).__mcJob = job.id;
      h.exportQueue.getState().start();
    }, MP4_SMALL);
    const jobId = await page.evaluate(() => (window as unknown as { __mcJob: string }).__mcJob);
    await waitDone(page, jobId);
    const outputName = await page.evaluate((id) => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      return h.exportQueue.getState().queue.jobs.find((x: Record<string, any>) => x.id === id).outputName as string;
    }, jobId);
    const panel = page.getByTestId("export-queue-panel");
    if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
    const file = join(workDir, name);
    await download.saveAs(file);
    return decodeMono(file);
  };

  /** Where each clap should be on the timeline, from the picture clips as they are now. */
  const expectedClaps = async (): Promise<Array<{ clap: number; at: number; clip: string }>> => {
    const info = await page.evaluate(() => {
      const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
      const source = p.multicamSources[0];
      return {
        angles: source.angles.map((a: any) => ({ id: a.id, offset: a.offset as number, media: p.mediaLibrary.items.find((m: any) => m.id === a.mediaId)?.name as string })),
        clips: p.timeline.tracks.filter((t: any) => t.type === "video").flatMap((t: any) => t.clips.filter((c: any) => c.metadata?.multicam).map((c: any) => ({ id: c.id as string, start: c.startTime as number, duration: c.duration as number, inPoint: c.inPoint as number, angleId: c.metadata.multicam.angleId as string }))),
      };
    });
    const found: Array<{ clap: number; at: number; clip: string }> = [];
    for (const clip of info.clips) {
      const angle = info.angles.find((a: { id: string }) => a.id === clip.angleId)!;
      for (const clap of CLAPS) {
        const at = clip.start + clap - angle.offset - clip.inPoint;
        // The shared moment lies inside this clip, with room for the 100 ms template on both sides.
        if (at > clip.start + 0.1 && at < clip.start + clip.duration - 0.2) found.push({ clap, at: at, clip: angle.media });
      }
    }
    return found;
  };

  const measure = (audio: Float32Array, claps: Array<{ clap: number; at: number; clip: string }>, only?: string) => {
    const errors: number[] = [];
    for (const c of claps) {
      if (only && c.clip !== only) continue;
      const from = Math.round((c.at - 0.005 - 0.08) * 48000);
      const lag = bestLag(audio, masterTemplate(c.clap), from, Math.round(0.16 * 48000));
      errors.push((from + lag) / 48000 + 0.005 - c.at);
    }
    return errors;
  };

  const fixedClaps = await expectedClaps();
  expect(fixedClaps.length, "claps inside the edited picture clips").toBeGreaterThanOrEqual(3);
  const fixedErrors = measure(await exportAndDecode("audio-lock-fixed.wav.mp4"), fixedClaps);
  console.log(`[multicam-audio] fixed angle: ${fixedClaps.length} claps, errors (ms) ${fixedErrors.map((e) => (e * 1000).toFixed(3)).join(", ")}`);
  // The same constant offset (container / encoder delay) applies to every clap; sync is the spread plus that offset.
  for (const error of fixedErrors) expect(Math.abs(error), "clap vs picture, fixed audio angle").toBeLessThan(0.001);

  // ---- Audio follows video: same cut, each clip plays its own camera's sound --------------------------
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    await h.multicamController.setAudioModeCommand(h.project.getState().project.multicamSources[0].id, { mode: "follow" });
  });
  const followClaps = await expectedClaps();
  const followErrors = measure(await exportAndDecode("audio-lock-follow.wav.mp4"), followClaps, "cam-red.mp4");
  console.log(`[multicam-audio] follow: ${followErrors.length} red-camera claps, errors (ms) ${followErrors.map((e) => (e * 1000).toFixed(3)).join(", ")}`);
  expect(followErrors.length).toBeGreaterThanOrEqual(1);
  for (const error of followErrors) expect(Math.abs(error), "clap vs picture, audio follows video").toBeLessThan(0.001);
}

/**
 * Speed and reverse on a multicam clip, end to end in Chrome. The one clip is retimed through the same
 * store path as the Speed tab (one undo step, derived fixed audio retimed with it), then cut live
 * at OUTPUT times. The monitor shows the right angle at each time, the exported colours per segment
 * follow the cut order at the right times, the export length matches the retimed length, and the claps in
 * the exported audio (fixed red mic, direction and rate following the picture) sit where the picture says.
 */
export async function runMulticamRetimeFlow(page: Page, testInfo: TestInfo, mode: "speed" | "reverse"): Promise<void> {
  testInfo.setTimeout(540_000);
  generateCameras();
  await openMulticamEditor(page);
  const mediaIds = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    return ["cam-red.mp4", "cam-green.mp4", "cam-blue.mp4"].map((n) => p.mediaLibrary.items.find((m: any) => m.name === n).id as string);
  });
  const created = await page.evaluate(async ({ ids, offsets }) => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const result = await h.multicamController.createMulticamSourceCommand({
      name: "Retime",
      syncMethod: "manual",
      angles: ids.map((mediaId, i) => ({ mediaId, offset: offsets[i] })),
      audio: { mode: "fixed", mediaId: ids[0] },
      placeAtPlayhead: true,
    });
    return result.ok;
  }, { ids: mediaIds, offsets: CAMERAS.map((c) => c.offset) });
  expect(created).toBe(true);
  await page.evaluate(() => (window as unknown as { __openreelE2E: { source: { getState(): any } } }).__openreelE2E.source.getState().setTab("multicam"));
  const [whole] = await readCuts(page);
  const original = await tidySnapshot(page);
  const h0 = await historyLength(page);

  // ---- Retime the clip: one undo step; the derived audio takes the same rate/direction -------------------
  const changes = mode === "speed" ? { speed: 2 } : { reversed: true };
  const applied = await page.evaluate(async ({ id, changes }) => {
    const h = (window as unknown as { __openreelE2E: Hook & { speed: { editClipSpeed: (p: string, c: string, ch: unknown, a: boolean) => Promise<boolean> } } }).__openreelE2E;
    return h.speed.editClipSpeed(h.project.getState().project.id, id, changes, true);
  }, { id: whole.id, changes });
  expect(applied, "the retime is applied (no longer refused)").toBe(true);
  expect(await historyLength(page)).toBe(h0 + 1);
  const total = mode === "speed" ? whole.duration / 2 : whole.duration;
  expect((await readCuts(page))[0].duration).toBeCloseTo(total, 6);
  expect(await audioLockError(page)).toBeLessThan(1e-9);
  const audioRetime = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const audio = p.timeline.tracks.find((t: any) => t.name === "Multicam Audio")?.clips ?? [];
    return audio.map((c: any) => ({ speed: c.speed ?? 1, reversed: !!c.reversed, duration: c.duration as number }));
  });
  expect(audioRetime).toHaveLength(1);
  expect(audioRetime[0].speed).toBe(mode === "speed" ? 2 : 1);
  expect(audioRetime[0].reversed).toBe(mode === "reverse");
  expect(audioRetime[0].duration).toBeCloseTo(total, 6);
  const retimedSnapshot = await tidySnapshot(page);
  await undo(page);
  await expect.poll(async () => (await readCuts(page))[0].duration).toBeCloseTo(whole.duration, 6);
  await redo(page);
  await expect.poll(async () => tidySnapshot(page)).toBe(retimedSnapshot);

  // ---- Cut at OUTPUT times ---------------------------------------------------------------------------------
  const plan = mode === "speed" ? { first: 1.5, second: 3, end: 4.2 } : { first: 2, second: 4, end: 6 };
  await page.evaluate(async (p) => {
    const h = (window as unknown as { __openreelE2E: Hook & { multicamController: Record<string, any> } }).__openreelE2E;
    const source = h.project.getState().project.multicamSources[0];
    const store = h.multicam.getState() as any;
    store.begin(0);
    store.addCut({ time: p.first, angleId: source.angles[1].id });
    store.addCut({ time: p.second, angleId: source.angles[2].id });
    h.timeline.getState().seekTo(p.end);
    await h.multicamController.stopRecording();
  }, plan);
  await expect.poll(async () => (await readCuts(page)).map((c) => c.angle)).toEqual([1, 2, 3, 1]);
  const cuts = await readCuts(page);
  [0, plan.first, plan.second, plan.end].forEach((t, i) => expect(Math.abs(cuts[i].start - t), `cut ${i} start`).toBeLessThan(1e-3));
  expect(cuts.every((c) => (mode === "speed" ? c.speed === 2 : c.reversed))).toBe(true);
  expect(cuts.reduce((sum, c) => sum + c.duration, 0)).toBeCloseTo(total, 3);
  // Every piece shows the shared moment the ORIGINAL retimed clip showed at the same output time.
  const sharedAt = (c: { start: number; inPoint: number; outPoint: number; speed: number; reversed: boolean; angle: number }, t: number) => {
    const local = (t - c.start) * Math.abs(c.speed);
    return (c.reversed ? c.outPoint - local : c.inPoint + local) + CAMERAS[c.angle - 1].offset;
  };
  const wholeRetimed = { start: 0, inPoint: whole.inPoint, outPoint: whole.outPoint, speed: mode === "speed" ? 2 : 1, reversed: mode === "reverse", angle: 1 };
  for (const c of cuts) {
    for (const f of [0.1, 0.5, 0.9]) {
      const t = c.start + c.duration * f;
      expect(Math.abs(sharedAt(c, t) - sharedAt(wholeRetimed, t)), `${c.media}@${t.toFixed(2)} stays on the same moment`).toBeLessThan(1e-3);
    }
  }
  expect(await audioLockError(page)).toBeLessThan(1e-9);

  // ---- Preview: the monitor highlights the right angle at output times --------------------------------------
  for (const c of cuts) {
    await seek(page, c.start + c.duration / 2);
    await expect(page.getByTestId("multicam-angle").nth(c.angle - 1)).toHaveAttribute("data-active", "true");
  }

  // ---- Export: colour per segment, length, and clap timing in the audio -----------------------------------------
  await page.evaluate((settings) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const job = h.exportQueue.getState().enqueue({ settings, presetLabel: "Retime" });
    if (!job) throw new Error("enqueue returned null");
    (window as unknown as { __mcJob: string }).__mcJob = job.id;
    h.exportQueue.getState().start();
  }, MP4_SMALL);
  const jobId = await page.evaluate(() => (window as unknown as { __mcJob: string }).__mcJob);
  await waitDone(page, jobId);
  const outputName = await page.evaluate((id) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    return h.exportQueue.getState().queue.jobs.find((x: Record<string, any>) => x.id === id).outputName as string;
  }, jobId);
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
  const file = join(workDir, `multicam-retime-${mode}.mp4`);
  await download.saveAs(file);
  expect(Math.abs(probeDuration(file) - total)).toBeLessThan(0.15);
  const wrong: string[] = [];
  const seen: string[] = [];
  for (const c of cuts) {
    const expected = CAMERAS[c.angle - 1].color;
    seen.push(expected);
    for (const t of [c.start + 3 * FRAME, c.start + c.duration / 2, c.start + c.duration - 3 * FRAME]) {
      const got = nearestCamera(frameColor(file, t));
      if (got !== expected) wrong.push(`t=${t.toFixed(2)} expected ${expected} got ${got}`);
    }
  }
  expect(wrong, "exported frames per segment").toEqual([]);
  // Segment boundaries land on the output times: a frame just before / after each cut has the neighbouring colours.
  for (const [i, boundary] of [plan.first, plan.second, plan.end].entries()) {
    expect(nearestCamera(frameColor(file, boundary - 2 * FRAME)), `just before ${boundary}`).toBe(seen[i]);
    expect(nearestCamera(frameColor(file, boundary + 2 * FRAME)), `just after ${boundary}`).toBe(seen[i + 1]);
  }
  console.log(`[multicam-retime] ${mode}: segments ${cuts.map((c) => `${c.start.toFixed(2)}+${c.duration.toFixed(2)}`).join(" ")} colours ${seen.join(" ")}`);

  // Claps: the audio's loudest sample around each expected clap sits where the picture's source time maps it.
  const audio = decodeMono(file);
  const wav = readFileSync(join(generateCameras(), "master.wav"));
  const peakOf = (clap: number): number => {
    let best = 0;
    let at = clap;
    for (let i = Math.round((clap - 0.005) * 48000); i < Math.round((clap + 0.1) * 48000); i++) {
      const v = Math.abs(wav.readInt16LE(44 + i * 2));
      if (v > best) {
        best = v;
        at = i / 48000;
      }
    }
    return at;
  };
  const errors: number[] = [];
  for (const clap of CLAPS) {
    const shared = peakOf(clap);
    const placed = (c: (typeof cuts)[number]) => {
      const media = shared - CAMERAS[c.angle - 1].offset;
      const local = (c.reversed ? c.outPoint - media : media - c.inPoint) / Math.abs(c.speed);
      return { media, local };
    };
    const piece = cuts.find((c) => {
      const { media, local } = placed(c);
      return media >= c.inPoint && media <= c.outPoint && local > 0.1 && local < c.duration - 0.1;
    });
    if (!piece) continue;
    const at = piece.start + placed(piece).local;
    let best = 0;
    let bestAt = at;
    for (let i = Math.max(0, Math.round((at - 0.06) * 48000)); i < Math.min(audio.length, Math.round((at + 0.06) * 48000)); i++) {
      if (Math.abs(audio[i]) > best) {
        best = Math.abs(audio[i]);
        bestAt = i / 48000;
      }
    }
    errors.push(bestAt - at);
  }
  console.log(`[multicam-retime] ${mode}: ${errors.length} claps, peak errors (ms) ${errors.map((e) => (e * 1000).toFixed(1)).join(", ")}`);
  expect(errors.length, "claps inside the retimed picture").toBeGreaterThanOrEqual(2);
  for (const error of errors) expect(Math.abs(error), "clap vs picture").toBeLessThan(0.03);

  // ---- Undo everything exactly --------------------------------------------------------------------------------------
  let guard = 0;
  while ((await tidySnapshot(page)) !== original && guard++ < 6) {
    await undo(page);
    await settle(page, 80);
  }
  expect((await readCuts(page)).map((c) => c.angle)).toEqual([1]);
  expect((await readCuts(page))[0].duration).toBeCloseTo(whole.duration, 6);
}
