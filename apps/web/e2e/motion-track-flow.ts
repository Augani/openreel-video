import { expect, type Page, type TestInfo } from "@playwright/test";
import { SOFTWARE_GPU } from "./env";
import { clickClip, clipsOf, readState, redo, seek, settle, undo } from "./helpers";
import {
  FPS, FRAMES, FULL_OCCLUSION, PARTIAL_OCCLUSION, SPRITE, exportedCentroids, generateTrackClip, generateTrackClip1080, openEditorWith, readTrack, targetAt, type TrackData,
} from "./motion-track-lib";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Worst and mean distance between a saved path and the true target over `frames`. */
export function pathError(data: TrackData, frames: number[]): { max: number; mean: number; worstFrame: number } {
  let max = 0, sum = 0, worstFrame = frames[0] ?? 0;
  for (const frame of frames) {
    const key = data.keyframes.find((k) => k.frame === frame);
    if (!key) throw new Error(`no tracked point for frame ${frame}`);
    const error = dist(key.position, targetAt(frame));
    sum += error;
    if (error > max) { max = error; worstFrame = frame; }
  }
  return { max, mean: sum / Math.max(1, frames.length), worstFrame };
}
export const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Snapshot of everything a tracking edit may touch, for exact-undo comparisons. */
export const snapshot = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().project;
    // An overlay's static `transform` mirrors the keyframed value at the playhead (it moves with seeks/renders), so the
    // exactness check covers everything the edit owns: keyframes, metadata, timing and style.
    const bare = (clips: any[]) => clips.map(({ transform, ...rest }) => (void transform, rest));
    return JSON.stringify([p.timeline, bare(p.shapeClips ?? []), bare(p.textClips ?? [])]);
  });

/** Exact equality with a readable first difference (path + both values) when it fails. */
export function expectSame(actual: string, expected: string, message: string): void {
  const diffs: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (diffs.length >= 5) return;
    if (a === b) return;
    if (typeof a === "object" && typeof b === "object" && a && b) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      return;
    }
    diffs.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} !== ${JSON.stringify(b)?.slice(0, 120)}`);
  };
  walk(JSON.parse(actual), JSON.parse(expected), "$");
  expect(diffs, message).toEqual([]);
}

export async function createRedShape(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState();
    const track = store.project.timeline.tracks.find((t: any) => t.name === "Titles");
    const shape = store.createShapeClip(track.id, 0, "rectangle", 4, { fill: { type: "solid", color: "#ff0000", opacity: 1 } });
    store.updateShapeTransform(shape.id, { scale: { x: 0.2, y: 0.2 } });
    return shape.id as string;
  });
}

export async function openTrackingSection(page: Page, clipId: string): Promise<void> {
  // The first click after a reload can land before the timeline wires its handlers; retry until selected.
  for (let attempt = 0; attempt < 4; attempt++) {
    await clickClip(page, clipId);
    await settle(page, 500);
    if ((await readState(page)).selected.some((item) => item.id === clipId)) break;
  }
  const marker = page.getByText(/Source pixels ·/);
  if (!(await marker.isVisible().catch(() => false))) {
    const effects = page.getByRole("button", { name: /Expand Effects · \d+ section/ });
    if (await effects.count()) await effects.click();
    const header = page.getByRole("button", { name: /Motion Tracking/ }).first();
    await header.scrollIntoViewIfNeeded({ timeout: 10_000 });
    if (!(await marker.isVisible().catch(() => false))) await header.click();
  }
  await marker.waitFor({ timeout: 10_000 });
}

export async function setRegion(page: Page, region: { x: number; y: number; width: number; height: number }): Promise<void> {
  for (const [label, value] of [["X Position", region.x], ["Y Position", region.y], ["Width", region.width], ["Height", region.height]] as const) {
    const input = page.getByRole("spinbutton", { name: label, exact: true });
    await input.scrollIntoViewIfNeeded();
    await input.fill(String(Math.round(value)));
    await input.press("Enter");
    await input.blur();
  }
}

/** Region (source px) tightly inside the sprite whose centre is `c`. */
export const regionAround = (c: { x: number; y: number }, scale = 1) => {
  const size = Math.round((SPRITE - 16) * scale);
  return { x: Math.round(c.x - size / 2), y: Math.round(c.y - size / 2), width: size, height: size };
};

export async function startTracking(page: Page): Promise<{ ms: number }> {
  const began = Date.now();
  const button = page.getByRole("button", { name: /Start Tracking|Re-track with Different Settings/ });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByText(/Tracking Complete/)).toBeVisible({ timeout: 120_000 });
  return { ms: Date.now() - began };
}

async function historyLength(page: Page): Promise<number> {
  return (await readState(page)).historyLength;
}

async function pickTarget(page: Page, namePattern: RegExp): Promise<void> {
  const box = page.getByRole("combobox", { name: "Tracking target" });
  await box.scrollIntoViewIfNeeded();
  await box.click();
  await page.getByRole("option", { name: namePattern }).first().click();
  await settle(page, 200);
}

export async function attachToShape(page: Page, mode: "Follow motion" | "Pin to object"): Promise<void> {
  await pickTarget(page, /Shape/);
  await page.getByRole("radio", { name: mode }).click();
  const apply = page.getByRole("button", { name: /Apply Tracking to Clip|Update Tracking/ });
  await apply.scrollIntoViewIfNeeded();
  await apply.click();
  await expect(page.getByRole("button", { name: "Update Tracking" })).toBeVisible({ timeout: 15_000 });
}

/** Seek the playhead to a clip-local frame. */
export const seekFrame = (page: Page, frame: number) => seek(page, (frame + 0.01) / FPS);

export async function exportTo(page: Page, outPath: string): Promise<void> {
  await seek(page, 0);
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 300_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  await (await download).saveAs(outPath);
}

export interface FlowLog { lines: string[] }
const log = (flow: FlowLog, line: string) => { flow.lines.push(line); console.log(`[motion-track] ${line}`); };

export async function runTrackingFlow(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const flow: FlowLog = { lines: [] };
  const trueFrames = (a: number, b: number) => range(a, b);

  // ── Clean clip: forward track, quality strip, attach, export, undo, reload ──────────────────
  await openEditorWith(page, generateTrackClip("clean"), "track-clean.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  const shapeId = await createRedShape(page);
  await openTrackingSection(page, clip.id);
  await setRegion(page, regionAround(targetAt(0)));

  const beforeTrack = await snapshot(page);
  const historyBefore = await historyLength(page);
  const timing = await startTracking(page);
  expect(await historyLength(page), "tracking is exactly one undo step").toBe(historyBefore + 1);
  const forward = (await readTrack(page, clip.id))!.data;
  expect(forward.keyframes.length).toBe(FRAMES);
  const clean = pathError(forward, trueFrames(0, FRAMES - 1));
  log(flow, `${label} clean forward: ${forward.keyframes.length} frames, max error ${clean.max.toFixed(2)} px (frame ${clean.worstFrame}), mean ${clean.mean.toFixed(2)} px, ${timing.ms} ms wall, tracker ${forward.stats?.framesPerSecond.toFixed(1)} fps (decode wait ${forward.stats?.decodeMs} ms, track ${forward.stats?.trackMs} ms)`);
  expect(clean.max, "tracked path follows the true target (incl. the 24 px/frame burst)").toBeLessThanOrEqual(2);
  expect(forward.lostFrames, "no frame reported lost on clean footage").toEqual([]);
  await expect(page.getByTestId("motion-track-stats")).toContainText("frames/s");
  await expect(page.getByTestId("motion-track-low-count")).toHaveText("All frames confident");

  // Undo is exact; redo restores the identical path.
  await undo(page);
  expectSame(await snapshot(page), beforeTrack, "undo of tracking restores the project exactly");
  await redo(page);
  expect((await readTrack(page, clip.id))!.data.keyframes).toEqual(forward.keyframes);

  // Backward tracking from the playhead: re-track frames 0..90 from the true position at frame 90.
  await seekFrame(page, 90);
  await page.getByRole("radio", { name: "◂ Backward" }).click();
  await setRegion(page, regionAround(targetAt(90)));
  const afterForward = await snapshot(page);
  await startTracking(page);
  const backward = (await readTrack(page, clip.id))!.data;
  const backErr = pathError(backward, trueFrames(0, 90));
  log(flow, `${label} backward from frame 90: max error ${backErr.max.toFixed(2)} px (frame ${backErr.worstFrame}), frames ${backward.keyframes.length}`);
  expect(backward.keyframes.length).toBe(FRAMES);
  expect(backErr.max).toBeLessThanOrEqual(5);
  expect(backward.keyframes.filter((k) => k.frame > 90)).toEqual(forward.keyframes.filter((k) => k.frame > 90));
  await undo(page);
  expectSame(await snapshot(page), afterForward, "undo of the backward re-track restores the forward path exactly");
  await redo(page);
  await page.getByRole("radio", { name: "Whole clip" }).click();

  // Attach to the red shape (pin to object), one undo step, exact undo.
  const beforeAttach = await snapshot(page);
  const historyAttach = await historyLength(page);
  await attachToShape(page, "Pin to object");
  expect(await historyLength(page), "attach is one undo step").toBe(historyAttach + 1);
  const attached = await page.evaluate((id) => {
    const project = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().project;
    return project.shapeClips.find((s: any) => s.id === id).keyframes.length as number;
  }, shapeId);
  expect(attached).toBeGreaterThan(10);
  await undo(page);
  expectSame(await snapshot(page), beforeAttach, "undo of attach restores the shape exactly");
  await redo(page);
  await settle(page, 500);

  // Export and pixel-check the attached element against the TRUE target position.
  const file = testInfo.outputPath(`track-${label}.mp4`);
  await exportTo(page, file);
  const worst: string[] = [];
  let pixelMax = 0;
  for (const frame of [4, 15, 30, 38, 44, 47, 55, 72, 90, 110]) {
    const { red, sprite } = exportedCentroids(file, (frame + 0.5) / FPS);
    expect(red, `red shape visible in exported frame ${frame}`).not.toBeNull();
    expect(sprite, `sprite visible in exported frame ${frame}`).not.toBeNull();
    // The decisive comparison: the shape against the target as rendered in the very same exported frame.
    const error = dist(red!, sprite!);
    pixelMax = Math.max(pixelMax, error);
    worst.push(`${frame}:${error.toFixed(1)}`);
  }
  log(flow, `${label} export pixel check (red shape centroid vs the target sprite in the same exported frame), px error by frame ${worst.join(" ")}; max ${pixelMax.toFixed(2)}`);
  expect(pixelMax, "attached element follows the target in the exported file").toBeLessThanOrEqual(5);

  // Reload: autosave -> recovery keeps the analysis and the attachment.
  const projectId = await page.evaluate(() => (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().project.id as string);
  const savedKeys = (await readTrack(page, clip.id))!.data.keyframes;
  await page.evaluate(() => (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().forceSave());
  await page.reload();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
  const recovered = await page.evaluate(async (savedId) => {
    const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(v: unknown): void } } }).__openreelE2E.project;
    store.setState({ project: { ...store.getState().project, id: savedId } });
    const saves = await store.getState().checkForRecovery();
    if (!saves.length) return false;
    return store.getState().recoverFromAutoSave(saves[0].id);
  }, projectId);
  expect(recovered, "project recovered after reload").toBe(true);
  expect((await readTrack(page, clip.id))?.data.keyframes, "saved track survives a reload").toEqual(savedKeys);
  await openTrackingSection(page, clip.id);
  await expect(page.getByText(/Tracking Complete/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update Tracking" })).toBeVisible();
  log(flow, `${label} reload: analysis + attachment recovered (${savedKeys.length} frames)`);
  testInfo.annotations.push({ type: "motion-track", description: flow.lines.join(" | ") });
}

export async function runOcclusionFlow(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const flow: FlowLog = { lines: [] };
  await openEditorWith(page, generateTrackClip("occluded"), "track-occluded.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  const shapeId = await createRedShape(page);
  await openTrackingSection(page, clip.id);
  await setRegion(page, regionAround(targetAt(0)));
  await startTracking(page);
  const data = (await readTrack(page, clip.id))!.data;

  const hidden = range(FULL_OCCLUSION.from, FULL_OCCLUSION.to);
  const lostHidden = hidden.filter((f) => data.lostFrames.includes(f));
  const visibleBefore = pathError(data, range(0, FULL_OCCLUSION.from - 1));
  const visibleAfter = pathError(data, range(FULL_OCCLUSION.to + 3, PARTIAL_OCCLUSION.from - 1));
  const partial = pathError(data, range(PARTIAL_OCCLUSION.from, PARTIAL_OCCLUSION.to));
  const tail = pathError(data, range(PARTIAL_OCCLUSION.to + 2, FRAMES - 1));
  const predicted = pathError(data, hidden);
  const conf = (f: number) => data.confidence[data.keyframes.findIndex((k) => k.frame === f)];
  log(flow, `${label} occluded: lost in hidden ${lostHidden.length}/${hidden.length}; error before ${visibleBefore.max.toFixed(1)} px, predicted-through-occlusion ${predicted.max.toFixed(1)} px, after return ${visibleAfter.max.toFixed(1)} px, partial occlusion ${partial.max.toFixed(1)} px, tail ${tail.max.toFixed(1)} px; confidence hidden ${hidden.map((f) => conf(f).toFixed(2)).join(",")}; states ${data.states?.slice(58, 74).join(",")}`);
  expect(lostHidden.length, "hidden frames are marked low confidence").toBeGreaterThanOrEqual(hidden.length - 1);
  expect(Math.max(...hidden.map(conf)), "low confidence while hidden").toBeLessThan(0.7);
  expect(visibleBefore.max).toBeLessThanOrEqual(4);
  expect(predicted.max, "velocity prediction keeps the hidden position near the true path").toBeLessThanOrEqual(30);
  expect(visibleAfter.max, "resumes on the target after it returns").toBeLessThanOrEqual(4);
  expect(partial.max, "partial occlusion").toBeLessThanOrEqual(6);
  expect(tail.max, "no drift afterwards").toBeLessThanOrEqual(4);

  // Quality strip marks them.
  const low = await page.getByTestId("motion-track-low-count").innerText();
  expect(low).toMatch(/low-confidence frame/);
  await expect(page.locator('[data-testid="motion-track-quality"] [data-run="lost"]').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`quality-strip-${label}.png`) });

  // Manual correction of a hidden frame: one undo step, exact undo, flagged hand-set.
  await seekFrame(page, 65);
  await expect(page.getByTestId("motion-track-frame-info")).toContainText("Frame 65");
  await expect(page.getByTestId("motion-track-frame-info")).toContainText("hidden");
  const truth = targetAt(65);
  const beforeFix = await snapshot(page);
  const historyBefore = (await readState(page)).historyLength;
  await attachToShape(page, "Pin to object");
  const afterAttach = await snapshot(page);
  await page.getByRole("spinbutton", { name: "Point X", exact: true }).fill(String(truth.x.toFixed(1)));
  await page.getByRole("spinbutton", { name: "Point X", exact: true }).press("Enter");
  await page.getByRole("spinbutton", { name: "Point Y", exact: true }).fill(String(truth.y.toFixed(1)));
  await page.getByRole("spinbutton", { name: "Point Y", exact: true }).press("Enter");
  const historyAttach = (await readState(page)).historyLength;
  expect(historyAttach).toBe(historyBefore + 1);
  const shapeKeysBefore = await shapeKeyframes(page, shapeId);
  await page.getByRole("button", { name: "Set point" }).click();
  await expect.poll(async () => (await readTrack(page, clip.id))!.data.manualFrames ?? [], { timeout: 10_000 }).toEqual([65]);
  expect((await readState(page)).historyLength, "correction (and the attached shape following it) is one undo step").toBe(historyAttach + 1);
  const fixed = (await readTrack(page, clip.id))!.data;
  expect(dist(fixed.keyframes.find((k) => k.frame === 65)!.position, truth)).toBeLessThan(0.2);
  expect(fixed.lostFrames).not.toContain(65);
  expect(await shapeKeyframes(page, shapeId), "the attached shape follows the corrected point").not.toEqual(shapeKeysBefore);
  await undo(page);
  expectSame(await snapshot(page), afterAttach, "undo of the correction is exact");
  await redo(page);
  void beforeFix;

  // Re-track from here (frame 75, target visible): merges, keeps earlier frames, stays accurate.
  await seekFrame(page, 75);
  const beforeRetrack = (await readTrack(page, clip.id))!.data;
  const historyRetrack = (await readState(page)).historyLength;
  await page.getByRole("button", { name: "Re-track from here" }).click();
  await expect.poll(async () => (await readState(page)).historyLength, { timeout: 60_000 }).toBe(historyRetrack + 1);
  const after = (await readTrack(page, clip.id))!.data;
  expect(after.keyframes.length).toBe(FRAMES);
  expect(after.keyframes.filter((k) => k.frame < 75)).toEqual(beforeRetrack.keyframes.filter((k) => k.frame < 75));
  const retrackErr = pathError(after, [...range(75, PARTIAL_OCCLUSION.from - 1), ...range(PARTIAL_OCCLUSION.to + 2, FRAMES - 1)]);
  // The frame after the bar leaves (reveal) still has a half-changed appearance, so it counts with the covered window.
  const retrackPartial = pathError(after, range(PARTIAL_OCCLUSION.from, PARTIAL_OCCLUSION.to + 1));
  log(flow, `${label} re-track from frame 75: max error ${retrackErr.max.toFixed(2)} px at frame ${retrackErr.worstFrame} (${retrackPartial.max.toFixed(2)} px inside the partial occlusion); frames before 75 untouched; manual frames kept ${JSON.stringify(after.manualFrames)}`);
  // Sub-pixel matching, template-pinned position and scale: a re-track no longer inherits drift (was 7.5 px).
  expect(retrackErr.max).toBeLessThanOrEqual(2.5);
  expect(retrackPartial.max, "partly covered target").toBeLessThanOrEqual(2.5);
  expect(after.manualFrames).toEqual([65]);

  // Export with the shape attached to the corrected path; the shape follows the target away from the occlusion.
  const file = testInfo.outputPath(`occluded-${label}.mp4`);
  await exportTo(page, file);
  const rows: string[] = [];
  let worst = 0;
  for (const frame of [10, 46, 58, 65, 74, 85, 100, 115]) {
    const { red, sprite } = exportedCentroids(file, (frame + 0.5) / FPS);
    if (!red) { rows.push(`${frame}:no-shape`); continue; }
    // Where the sprite is hidden or partly covered (its visible centroid is then biased) compare to its true path instead (the corrected point is hand-set at 65).
    const covered = (frame >= FULL_OCCLUSION.from && frame <= FULL_OCCLUSION.to) || (frame >= PARTIAL_OCCLUSION.from && frame <= PARTIAL_OCCLUSION.to);
    const reference = sprite && !covered ? sprite : targetAt(frame);
    const error = dist(red, reference);
    if (frame !== 65) worst = Math.max(worst, error);
    rows.push(`${frame}:${error.toFixed(1)}${covered || !sprite ? "(covered: vs true path)" : ""}`);
  }
  log(flow, `${label} occluded export, shape-vs-target px error by frame ${rows.join(" ")}`);
  // The exported shape follows the re-tracked path (rendered sprite + shape centroid rounding included).
  expect(worst).toBeLessThanOrEqual(4);
  testInfo.annotations.push({ type: "motion-track-occlusion", description: flow.lines.join(" | ") });
}

export const shapeKeyframes = (page: Page, id: string) =>
  page.evaluate((shapeId) => {
    const project = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E.project.getState().project;
    return JSON.stringify(project.shapeClips.find((s: any) => s.id === shapeId).keyframes);
  }, id);

/** 1080p: tracking speed, worker isolation (main thread keeps painting), progress and cancel. */
export async function run1080pFlow(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await openEditorWith(page, generateTrackClip1080(), "track-1080p.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await openTrackingSection(page, clip.id);
  await expect(page.getByText(/Source pixels · 1920 × 1080/)).toBeVisible();
  const c = targetAt(0);
  await setRegion(page, { x: Math.round(c.x * 3 - 120), y: Math.round(c.y * 3 - 120), width: 240, height: 240 });

  // Cancel mid-run: progress moves, cancel stops it, nothing is saved and no undo step is added.
  const history = (await readState(page)).historyLength;
  await page.getByRole("button", { name: /Start Tracking/ }).click();
  const progress = page.getByRole("progressbar", { name: "Tracking progress" });
  await expect(progress).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => Number((await progress.getAttribute("aria-valuenow")) ?? 0), { timeout: 60_000 }).toBeGreaterThan(5);
  const seenProgress = Number((await progress.getAttribute("aria-valuenow")) ?? 0);
  await page.getByRole("button", { name: "Cancel Tracking" }).click();
  await expect(page.getByRole("button", { name: /Start Tracking/ })).toBeEnabled({ timeout: 15_000 });
  await settle(page, 800);
  expect(await readTrack(page, clip.id), "cancelled run saves nothing").toBeNull();
  expect((await readState(page)).historyLength, "cancelled run adds no undo step").toBe(history);
  log({ lines: [] }, `${label} 1080p cancel at ~${Math.round(seenProgress)}% progress: nothing saved, no undo step`);

  // Full run with a frame-gap probe on the main thread.
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __probe: boolean };
    w.__gaps = []; w.__probe = true;
    let last = performance.now();
    const tick = () => { const now = performance.now(); w.__gaps.push(now - last); last = now; if (w.__probe) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const began = Date.now();
  await page.getByRole("button", { name: /Start Tracking/ }).click();
  await expect(page.getByText(/Tracking Complete/)).toBeVisible({ timeout: 180_000 });
  const wall = Date.now() - began;
  const gaps = await page.evaluate(() => { const w = window as unknown as { __gaps: number[]; __probe: boolean }; w.__probe = false; return w.__gaps; });
  const data = (await readTrack(page, clip.id))!.data;
  // Frames the tracker itself flagged low confidence (the 72 px/frame burst at 1080p can outrun it for a frame) are reported, not hidden.
  const lost = new Set(data.lostFrames);
  let err = 0, lostErr = 0;
  for (const k of data.keyframes) {
    const e = dist(k.position, { x: targetAt(k.frame).x * 3, y: targetAt(k.frame).y * 3 });
    if (lost.has(k.frame)) lostErr = Math.max(lostErr, e); else err = Math.max(err, e);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  log({ lines: [] }, `${label} 1080p track: ${data.keyframes.length} frames in ${data.stats?.elapsedMs} ms = ${data.stats?.framesPerSecond.toFixed(1)} frames/s (decode wait ${data.stats?.decodeMs} ms, tracker busy ${data.stats?.trackMs} ms); wall ${wall} ms incl. save; max error ${err.toFixed(1)} source px (1080p) on confident frames, ${data.lostFrames.length} frames flagged low confidence (worst ${lostErr.toFixed(0)} px); main-thread frame gap during run: max ${Math.max(...gaps).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms over ${gaps.length} frames`);
  testInfo.annotations.push({ type: "motion-track-1080p", description: `${data.stats?.framesPerSecond.toFixed(1)} frames/s; max main-thread gap ${Math.max(...gaps).toFixed(0)} ms` });
  expect(data.keyframes.length).toBe(FRAMES);
  expect(err, "1080p path accuracy in source pixels on confident frames").toBeLessThanOrEqual(14);
  expect(data.lostFrames.length, "only a few frames are flagged").toBeLessThanOrEqual(6);
  // Tracking is CPU work (1080p decode plus the tracker in a worker), so its speed follows the machine: > 10 frames/s on
  // a laptop, 9.7 on a shared 4-vCPU GitHub runner (the GPU-less project). Half the rate there still fails a tracker that
  // lost its worker or fell back to full-frame work, which is what this bound is for.
  const minFps = SOFTWARE_GPU ? 5 : 10;
  expect(data.stats!.framesPerSecond, `tracking speed on a 1080p clip (at least ${minFps} frames/s)`).toBeGreaterThan(minFps);
  expect(Math.max(...gaps), "the main thread keeps painting while the worker tracks").toBeLessThan(500);
}

const regionFields = async (page: Page) => {
  const read = async (name: string) => Number(await page.getByRole("spinbutton", { name, exact: true }).inputValue());
  return { x: await read("X Position"), y: await read("Y Position"), width: await read("Width"), height: await read("Height") };
};

/**
 * The on-canvas tracking target: drag it, resize it, nudge it with the keys, then track from the region the
 * overlay produced. The numeric fields must follow every gesture and the track must start where the box was put.
 */
export async function runOverlayFlow(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const flow: FlowLog = { lines: [] };
  await openEditorWith(page, generateTrackClip("clean"), "track-clean.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await openTrackingSection(page, clip.id);
  const target = page.getByTestId("motion-tracking-target");
  await expect(target).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("motion-tracking-search")).toBeVisible();
  const start = await regionFields(page);
  const box0 = (await target.boundingBox())!;
  const perPixel = box0.width / start.width; // screen px per source px
  log(flow, `${label} overlay: region ${JSON.stringify(start)} drawn ${box0.width.toFixed(0)}x${box0.height.toFixed(0)} screen px (${perPixel.toFixed(3)} per source px)`);
  expect(box0.height / start.height, "box keeps the media aspect").toBeCloseTo(perPixel, 1);

  const dragFrom = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
    await settle(page, 150);
  };

  // Move: drag the body.
  await dragFrom(box0.x + box0.width / 2, box0.y + box0.height / 2, 40, 24);
  const moved = await regionFields(page);
  log(flow, `${label} overlay move by (40, 24) screen px -> region ${JSON.stringify(moved)}`);
  expect(Math.abs(moved.x - (start.x + 40 / perPixel))).toBeLessThanOrEqual(2);
  expect(Math.abs(moved.y - (start.y + 24 / perPixel))).toBeLessThanOrEqual(2);
  expect(moved.width).toBe(start.width);

  // Resize: drag the bottom-right handle.
  const box1 = (await target.boundingBox())!;
  await dragFrom(box1.x + box1.width, box1.y + box1.height, 20, 12);
  const resized = await regionFields(page);
  log(flow, `${label} overlay resize bottom-right by (20, 12) -> region ${JSON.stringify(resized)}`);
  expect(Math.abs(resized.width - (moved.width + 20 / perPixel))).toBeLessThanOrEqual(2);
  expect(Math.abs(resized.height - (moved.height + 12 / perPixel))).toBeLessThanOrEqual(2);
  expect(resized.x).toBe(moved.x);

  // Keyboard: focus the box, nudge 1 px and 10 px.
  await target.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await regionFields(page)).x).toBe(resized.x + 1);
  await target.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await regionFields(page)).y).toBe(resized.y + 10);

  // Typing in the fields moves the box back (one value, two views).
  await setRegion(page, regionAround(targetAt(0)));
  const typed = await regionFields(page);
  const box2 = (await target.boundingBox())!;
  expect(Math.abs(box2.width - typed.width * perPixel)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath(`overlay-${label}.png`) });

  // Drag from there and track: the first tracked point is where the box was left.
  const box3 = (await target.boundingBox())!;
  await dragFrom(box3.x + box3.width / 2, box3.y + box3.height / 2, 12, -8);
  const placed = await regionFields(page);
  const center = { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 };
  await startTracking(page);
  const first = (await readTrack(page, clip.id))!.data.keyframes[0].position;
  log(flow, `${label} overlay: tracked from box centre ${center.x.toFixed(1)},${center.y.toFixed(1)}; first tracked point ${first.x.toFixed(1)},${first.y.toFixed(1)}`);
  expect(dist(first, center), "tracking starts at the region the overlay set").toBeLessThanOrEqual(2);
  await expect(page.getByTestId("motion-tracking-point")).toBeVisible();
  testInfo.annotations.push({ type: "motion-track-overlay", description: flow.lines.join(" | ") });
}
