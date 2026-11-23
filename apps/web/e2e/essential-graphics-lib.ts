import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boxOf, clipsOf, drag, openEditor, press, readState, seek, settle, waitForPresentedPlayhead } from "./helpers";

/**
 * Essential Graphics flow shared by the GPU spec and the fallback specs: insert a
 * lower third from the Browse tab, change two exposed controls in the Inspector,
 * stretch the bar and check the intro/outro frames are unchanged, save it as a
 * template, import that file into a brand new project and check the render is
 * identical, and walk every edit back with undo.
 */

interface E2E {
  project: { getState(): any };
  timeline: { getState(): any };
  ui: { getState(): any };
  graphics: any;
}
const hook = (page: Page) => page.evaluate(() => Object.keys((window as any).__openreelE2E));
void hook;

const PROGRAM = 'canvas[aria-label^="Program frame"]';

/** Mean abs difference (0-255) of the downsampled frames allowed for an outro sampled one frame apart. */
const OUTRO_FRAME_STEP_TOLERANCE = 1;

export interface FrameSig {
  /** sha-256 of the full-resolution RGBA program frame. */
  hash: string;
  /** Downsampled RGB for readable diffs. */
  small: number[];
}

/** Hash the program canvas right now. */
export async function frameSig(page: Page): Promise<FrameSig> {
  return page.evaluate(async (sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const data = g.getImageData(0, 0, t.width, t.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const s = document.createElement("canvas");
    s.width = 160;
    s.height = 90;
    const sg = s.getContext("2d", { willReadFrequently: true })!;
    sg.drawImage(t, 0, 0, 160, 90);
    const d = sg.getImageData(0, 0, 160, 90).data;
    const small: number[] = [];
    for (let i = 0; i < d.length; i += 4) small.push(d[i], d[i + 1], d[i + 2]);
    return { hash, small };
  }, PROGRAM);
}

export const meanDiff = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/** Fraction of (downsampled) pixels that differ from the empty-canvas frame: how much graphic is on screen. */
export const coverage = (frame: FrameSig, empty: FrameSig): number => {
  let n = 0;
  for (let i = 0; i < frame.small.length; i += 3) {
    if (Math.abs(frame.small[i] - empty.small[i]) + Math.abs(frame.small[i + 1] - empty.small[i + 1]) + Math.abs(frame.small[i + 2] - empty.small[i + 2]) > 12) n++;
  }
  return n / (frame.small.length / 3);
};

/**
 * Frame at an exact time, once the preview has actually painted it: the monitor reports the playhead
 * frame as presented, and two consecutive captures are identical. When `differFrom` is given (the empty
 * canvas, for a frame that must show a graphic) a capture that still equals it is a frame painted
 * before the graphic rasterised, so it keeps waiting. Bounded: after `timeoutMs` the last capture is
 * returned and the caller's assertion reports the real difference.
 */
export async function frameAt(page: Page, time: number, opts: { differFrom?: FrameSig; timeoutMs?: number } = {}): Promise<FrameSig> {
  await seek(page, time);
  await waitForPresentedPlayhead(page);
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let prev = await frameSig(page);
  let stable = 0;
  for (;;) {
    await settle(page, 150);
    const next = await frameSig(page);
    const empty = opts.differFrom !== undefined && next.hash === opts.differFrom.hash;
    stable = next.hash === prev.hash && !empty ? stable + 1 : 0;
    prev = next;
    if (stable >= 2 || Date.now() > deadline) return next;
  }
}

interface GraphicState {
  instances: Array<{ id: string; startTime: number; duration: number; values: Record<string, unknown>; trackId: string }>;
  texts: Array<{ id: string; text: string; start: number; duration: number }>;
  shapes: Array<{ id: string; fill?: string; start: number; duration: number }>;
  history: number;
  trackNames: string[];
  trackIds: string[];
}

export async function graphicState(page: Page): Promise<GraphicState> {
  return page.evaluate(() => {
    const e = (window as any).__openreelE2E as E2E;
    const state = e.project.getState();
    const p = state.getFullProject();
    return {
      instances: (p.graphicInstances ?? []).map((i: any) => ({ id: i.id, startTime: i.startTime, duration: i.duration, values: { ...i.values }, trackId: i.trackId })),
      texts: (p.textClips ?? []).map((c: any) => ({ id: c.id, text: c.text, start: c.startTime, duration: c.duration })),
      shapes: (p.shapeClips ?? []).map((c: any) => ({ id: c.id, fill: c.style?.fill?.color, start: c.startTime, duration: c.duration })),
      history: state.actionExecutor.getHistory().getUndoStackSize(),
      trackNames: p.timeline.tracks.map((t: any) => t.name),
      trackIds: p.timeline.tracks.map((t: any) => t.id),
    };
  });
}

/** Normalised serialisation of everything a graphic owns, for exact undo comparisons. */
export async function graphicSerial(page: Page): Promise<string> {
  return page.evaluate(() => {
    const p = ((window as any).__openreelE2E as E2E).project.getState().getFullProject();
    const strip = (v: unknown) => JSON.stringify(v);
    return strip({
      i: p.graphicInstances ?? null,
      t: (p.textClips ?? []).filter((c: any) => c.metadata?.graphicInstanceId),
      s: (p.shapeClips ?? []).filter((c: any) => c.metadata?.graphicInstanceId),
      v: (p.svgClips ?? []).filter((c: any) => c.metadata?.graphicInstanceId),
      tracks: p.timeline.tracks.map((t: any) => t.name),
    });
  });
}

/** Hide the video track so frames contain only graphics (deterministic, background-independent). */
export async function hideMain(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = ((window as any).__openreelE2E as E2E).project.getState();
    const main = state.project.timeline.tracks.find((t: any) => t.name === "Main");
    await state.hideTrack(main.id, true);
  });
  await settle(page, 400);
}

export async function openTemplatesTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Graphics", exact: true }).first().click();
  await settle(page, 400);
  await page.getByRole("tab", { name: "Templates", exact: true }).click();
  await settle(page, 400);
}

export async function insertFromBrowse(page: Page, templateName: string): Promise<void> {
  await openTemplatesTab(page);
  const before = (await graphicState(page)).instances.length;
  await page.getByRole("button", { name: `Insert ${templateName}` }).click();
  await expect.poll(async () => (await graphicState(page)).instances.length, { timeout: 15_000 }).toBe(before + 1);
  await settle(page, 600);
}

/** The Inspector's control for one exposed parameter. */
const control = (page: Page, id: string) => page.locator(`[data-graphic-control="${id}"]`);

export async function setExposedText(page: Page, id: string, value: string): Promise<void> {
  const input = control(page, id).locator("input").first();
  await input.fill(value);
  await input.press("Enter");
  await settle(page, 700);
}

export async function setExposedColor(page: Page, id: string, label: string, value: string): Promise<void> {
  await control(page, id).getByRole("button", { name: label }).first().click();
  const field = page.getByLabel(`${label} value`);
  await field.fill(value);
  await page.keyboard.press("Escape");
  // The control commits once the user pauses.
  await settle(page, 1200);
}

export interface FlowResult {
  /** Frame signatures keyed by label, taken at in+0.25s, out-0.25s and the hold. */
  frames: Record<string, FrameSig>;
  templatePath: string;
  finalDuration: number;
  historySteps: Record<string, number>;
}

/**
 * The full authoring flow. `savePath` is where the exported .openreel-template is written.
 */
export async function runAuthoringFlow(page: Page, savePath: string): Promise<FlowResult> {
  await openEditor(page);
  await hideMain(page);
  await seek(page, 0);
  const h0 = (await graphicState(page)).history;
  const empty = await frameAt(page, 0.25);

  // 1. Insert from the Browse tab.
  await insertFromBrowse(page, "Classic Bar");
  const afterInsert = await graphicState(page);
  expect(afterInsert.history - h0, "insert is one undo step").toBe(1);
  expect(afterInsert.instances).toHaveLength(1);
  const instance = afterInsert.instances[0];
  const trackIndex = afterInsert.trackIds.indexOf(instance.trackId);
  expect(trackIndex, "graphic lands on a track above the video").toBeLessThan(afterInsert.trackNames.indexOf("Main"));
  await expect(page.locator(`[data-clip-kind="graphic"][data-graphic-id="${instance.id}"]`)).toBeVisible();
  const serialInserted = await graphicSerial(page);

  // 2. Change two exposed controls through the Inspector.
  await expect(page.getByTestId("graphic-inspector")).toBeVisible();
  // Only the exposed controls are listed: no clip transform / effects sections.
  await expect(page.getByTestId("graphic-controls").locator("[data-graphic-control]")).toHaveCount(8);
  await setExposedText(page, "name", "JORDAN LEE");
  const afterName = await graphicState(page);
  expect(afterName.history - afterInsert.history, "text edit is one undo step").toBe(1);
  expect(afterName.texts.some((t) => t.text === "JORDAN LEE")).toBe(true);
  const serialName = await graphicSerial(page);

  await setExposedColor(page, "accent", "Accent color", "#00cc66");
  const afterColor = await graphicState(page);
  expect(afterColor.history - afterName.history, "color edit is one undo step").toBe(1);
  expect(afterColor.shapes.some((s) => s.fill?.toLowerCase() === "#00cc66")).toBe(true);
  const serialColor = await graphicSerial(page);

  // 3. Frame checks at in+0.25 and out-0.25 BEFORE stretching.
  const start = afterColor.instances[0].startTime;
  const duration0 = afterColor.instances[0].duration;
  const frames: Record<string, FrameSig> = {};
  frames.inBefore = await frameAt(page, start + 0.25, { differFrom: empty });
  frames.outBefore = await frameAt(page, start + duration0 - 0.25, { differFrom: empty });
  frames.holdBefore = await frameAt(page, start + duration0 / 2, { differFrom: empty });
  expect(coverage(frames.inBefore, empty), "intro frame shows graphics").toBeGreaterThan(0.002);
  expect(coverage(frames.outBefore, empty), "outro frame shows graphics").toBeGreaterThan(0.002);
  expect(coverage(frames.holdBefore, empty), "hold frame shows more graphic than the intro").toBeGreaterThan(coverage(frames.inBefore, empty));

  // 4. Stretch with a real drag on the right trim handle.
  await seek(page, 0);
  const bar = page.locator(`[data-clip-kind="graphic"][data-graphic-id="${instance.id}"]`);
  await bar.click();
  const pps = await page.evaluate(() => ((window as any).__openreelE2E as E2E).timeline.getState().zoom ?? 100);
  const handle = bar.locator('[data-timeline-trim="right"]');
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("trim handle not visible");
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, 0.9 * pps, 10);
  await expect.poll(async () => (await graphicState(page)).instances[0].duration, { timeout: 10_000 }).toBeGreaterThan(duration0 + 0.4);
  const afterStretch = await graphicState(page);
  expect(afterStretch.history - afterColor.history, "stretch is one undo step").toBe(1);
  const finalDuration = afterStretch.instances[0].duration;
  const serialStretch = await graphicSerial(page);

  // 5. Intro and outro animation timing is preserved after the stretch.
  frames.inAfter = await frameAt(page, start + 0.25, { differFrom: empty });
  frames.outAfter = await frameAt(page, start + finalDuration - 0.25, { differFrom: empty });
  expect(frames.inAfter.hash, "frame at in+0.25s identical after stretching").toBe(frames.inBefore.hash);
  // The stretched clip's end is not on the frame grid, and the preview (like the export) composites the frame under the
  // playhead at that frame's first instant, so the outro is sampled up to one frame earlier or later relative to the end
  // than before the stretch. The animation timing is preserved when the two frames agree to within that one-frame step.
  const outDiff = frames.outAfter.small.reduce((sum, v, i) => sum + Math.abs(v - frames.outBefore.small[i]), 0) / frames.outAfter.small.length;
  console.log(`[essential-graphics] outro after stretch vs before: mean abs diff ${outDiff.toFixed(3)} (hash equal: ${frames.outAfter.hash === frames.outBefore.hash})`);
  expect(outDiff, "frame at out-0.25s matches within one frame step after stretching").toBeLessThan(OUTRO_FRAME_STEP_TOLERANCE);
  frames.holdAfter = await frameAt(page, start + finalDuration / 2, { differFrom: empty });
  expect(coverage(frames.holdAfter, empty)).toBeGreaterThan(0.002);

  // 6. Save as template and export the file.
  await bar.click();
  await page.getByRole("button", { name: /Save as template/ }).click();
  await page.getByLabel("Template name").fill("E2E Lower Third");
  await page.getByLabel("Template name").press("Enter");
  await settle(page, 500);
  const saved = await page.evaluate(() => ((window as any).__openreelE2E as E2E).graphics.templates.getState().userTemplates.map((t: any) => t.name));
  expect(saved).toContain("E2E Lower Third");
  // The saved template is exported from My templates (hover the card).
  await openTemplatesTab(page);
  await page.getByRole("button", { name: "My templates" }).click();
  await page.locator('[data-graphic-template]').filter({ hasText: "E2E Lower Third" }).hover();
  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Export E2E Lower Third" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.openreel-template$/);
  await download.saveAs(savePath);
  const pack = JSON.parse(readFileSync(savePath, "utf8"));
  expect(pack.format).toBe("openreel-template");
  expect(pack.schemaVersion).toBe(1);

  // 7. Undo is exact, step by step, and redo restores.
  const serials = [serialInserted, serialName, serialColor, serialStretch];
  expect(await graphicSerial(page)).toBe(serials[3]);
  await seek(page, 0);
  await press(page, "Meta+z");
  expect(await graphicSerial(page), "undo stretch").toBe(serials[2]);
  await press(page, "Meta+z");
  expect(await graphicSerial(page), "undo color").toBe(serials[1]);
  await press(page, "Meta+z");
  expect(await graphicSerial(page), "undo name").toBe(serials[0]);
  await press(page, "Meta+Shift+z");
  await press(page, "Meta+Shift+z");
  await press(page, "Meta+Shift+z");
  expect(await graphicSerial(page), "redo all").toBe(serials[3]);
  await press(page, "Meta+z");
  await press(page, "Meta+z");
  await press(page, "Meta+z");
  await press(page, "Meta+z");
  const afterAllUndo = await graphicState(page);
  expect(afterAllUndo.instances, "undo insert removes the graphic").toHaveLength(0);
  expect(afterAllUndo.texts.filter((t) => t.id.includes("__"))).toHaveLength(0);
  expect(afterAllUndo.history).toBe(h0);
  await press(page, "Meta+Shift+z");
  await press(page, "Meta+Shift+z");
  await press(page, "Meta+Shift+z");
  await press(page, "Meta+Shift+z");
  expect(await graphicSerial(page), "redo to the stretched state").toBe(serials[3]);

  return { frames, templatePath: savePath, finalDuration, historySteps: { insert: 1, text: 1, color: 1, stretch: 1 } };
}

/** In a fresh project: import the exported file, insert it and compare frames with the authoring run. */
export async function runImportFlow(page: Page, templatePath: string, expected: FlowResult): Promise<void> {
  await openEditor(page);
  await hideMain(page);
  await seek(page, 0);
  const empty = await frameAt(page, 0.25);
  await openTemplatesTab(page);
  await page.getByTestId("graphic-template-import").setInputFiles(templatePath);
  await expect(page.getByRole("button", { name: "Insert E2E Lower Third" })).toBeVisible({ timeout: 10_000 });
  const h0 = (await graphicState(page)).history;
  await page.getByRole("button", { name: "Insert E2E Lower Third" }).click();
  await expect.poll(async () => (await graphicState(page)).instances.length, { timeout: 15_000 }).toBe(1);
  await settle(page, 600);
  const state = await graphicState(page);
  expect(state.history - h0).toBe(1);
  expect(state.instances[0].duration).toBeCloseTo(expected.finalDuration, 6);
  expect(state.texts.some((t) => t.text === "JORDAN LEE")).toBe(true);
  const start = state.instances[0].startTime;
  const d = state.instances[0].duration;
  const inFrame = await frameAt(page, start + 0.25, { differFrom: empty });
  const outFrame = await frameAt(page, start + d - 0.25, { differFrom: empty });
  const hold = await frameAt(page, start + d / 2, { differFrom: empty });
  expect(inFrame.hash, "imported template renders the identical in+0.25s frame").toBe(expected.frames.inAfter.hash);
  expect(outFrame.hash, "imported template renders the identical out-0.25s frame").toBe(expected.frames.outAfter.hash);
  expect(hold.hash, "imported template renders the identical hold frame").toBe(expected.frames.holdAfter.hash);
}

export { boxOf, clipsOf };
