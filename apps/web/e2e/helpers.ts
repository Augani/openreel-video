import { expect, type Locator, type Page } from "@playwright/test";
import { FIXTURE_PATH } from "./global-setup";

export const FPS = 30;
export const FRAME = 1 / FPS;

export interface ClipState {
  id: string;
  start: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  effects: number;
}
export interface TrackState {
  id: string;
  name: string;
  type: string;
  clips: ClipState[];
}
export interface EditorState {
  tracks: TrackState[];
  playhead: number;
  loopStart: number;
  loopEnd: number;
  selected: Array<{ type: string; id: string }>;
  tool: string;
  targets: Record<string, string | undefined>;
  canUndo: boolean;
  canRedo: boolean;
  historyLength: number;
}

interface E2EWindow {
  __openreelE2E: {
    project: { getState(): Record<string, any> };
    timeline: { getState(): Record<string, any> };
    workspace: { getState(): Record<string, any> };
    ui: { getState(): Record<string, any> };
    source: { getState(): Record<string, any> };
  };
}

/** Snapshot of everything the specs assert on, read from the live stores. */
export async function readState(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    const e = (window as unknown as E2EWindow).__openreelE2E;
    const project = e.project.getState().project;
    const timeline = e.timeline.getState();
    const history = e.project.getState().actionExecutor.getHistory();
    return {
      tracks: project.timeline.tracks.map((t: any) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        clips: t.clips.map((c: any) => ({
          id: c.id,
          start: c.startTime,
          duration: c.duration,
          inPoint: c.inPoint,
          outPoint: c.outPoint,
          speed: c.speed ?? 1,
          effects: c.effects.length,
        })),
      })),
      playhead: timeline.playheadPosition,
      loopStart: timeline.loopStart,
      loopEnd: timeline.loopEnd,
      selected: e.ui.getState().selectedItems.map((i: any) => ({ type: i.type, id: i.id })),
      tool: e.workspace.getState().timelineTool,
      targets: { ...e.workspace.getState().targetTracks },
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      historyLength: history.getUndoStackSize(),
    };
  });
}

export const track = (s: EditorState, name: string): TrackState => {
  const t = s.tracks.find((x) => x.name === name);
  if (!t) throw new Error(`no track named ${name}`);
  return t;
};
/** Clips of a track ordered by start time. */
export const clipsOf = (s: EditorState, name: string): ClipState[] =>
  [...track(s, name).clips].sort((a, b) => a.start - b.start);

/** [start, duration, inPoint, outPoint] rounded to ms, for readable diffs. */
export const shape = (clips: ClipState[]) =>
  clips.map((c) => [c.start, c.duration, c.inPoint, c.outPoint].map((n) => Math.round(n * 1000) / 1000));

/**
 * The Media panel's import input. `input[type="file"]` .first() matches whichever panel's input
 * happens to be mounted first (Transcript, Graphics, ...), so a panel mounting in a different
 * order under load sent the file to an input that imports nothing and the media card never showed.
 */
export const importInput = (page: Page): Locator => page.locator('[data-tour="assets"] input[type="file"]');

export async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable; the tour just shows */
    }
  });
  // The dev server can reload the page under a test (Vite re-optimising a dependency it only discovers when a lazy
  // chunk is first requested), which drops the editor back to the welcome screen mid-setup. That is not what any
  // test is about: when a full page load happened after the editor was entered, set up once more from the start.
  for (let attempt = 0; ; attempt++) {
    let loadsAfterEntry = 0;
    let entered = false;
    const onLoad = () => {
      if (entered) loadsAfterEntry++;
    };
    page.on("load", onLoad);
    try {
      await page.goto("/");
      await page.getByRole("button", { name: /Horizontal/ }).click();
      entered = true;
      await openEditorBody(page);
      return;
    } catch (error) {
      if (attempt >= 1 || loadsAfterEntry === 0) throw error;
      console.warn(`[openEditor] the page reloaded during setup (${loadsAfterEntry} load(s)); setting up again`);
    } finally {
      page.off("load", onLoad);
    }
  }
}

async function openEditorBody(page: Page): Promise<void> {
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(FIXTURE_PATH);
  const card = page.getByLabel("Select media three-scenes.mp4");
  // Import decodes the file's metadata in the page; on a starved machine (two GPU/software renderers plus an
  // encoder running) that has taken longer than 30 s. The wait is bounded and a miss names what the page said.
  const errors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); };
  const onPageError = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 200)}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  try {
    await card.waitFor({ timeout: 90_000 });
  } catch (error) {
    const notices = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => [] as string[]);
    throw new Error(`the imported media card never appeared within 90 s (notices: ${JSON.stringify(notices)}; page errors: ${JSON.stringify(errors.slice(-5))}): ${(error as Error).message}`);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  // Double-click opens the Source monitor; the actions menu places on the timeline.
  await page.getByRole("button", { name: "Media actions for three-scenes.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  const match = page.getByRole("button", { name: "Match Video" });
  await match.click({ timeout: 8_000 }).catch(() => undefined);
  await expect
    .poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 })
    .toBe(1);
  await settle(page);
}

/** Let async decodes / renders land before reading the canvas. */
export const settle = (page: Page, ms = 700) => page.waitForTimeout(ms);

export async function readSource(page: Page): Promise<{
  tab: string;
  focus: string;
  mediaId: string | null;
  position: number;
  rate: number;
  marks: { in?: number; out?: number };
}> {
  return page.evaluate(() => {
    const s = (window as unknown as E2EWindow).__openreelE2E.source.getState();
    return {
      tab: s.tab,
      focus: s.focus,
      mediaId: s.mediaId,
      position: s.position,
      rate: s.rate,
      marks: s.mediaId ? { ...(s.marks[s.mediaId] ?? {}) } : {},
    };
  });
}

export async function seek(page: Page, seconds: number): Promise<void> {
  await page.evaluate((t) => {
    (window as unknown as E2EWindow).__openreelE2E.timeline.getState().seekTo(t);
  }, seconds);
  await settle(page, 400);
}

export async function setZoom(page: Page, pixelsPerSecond: number): Promise<void> {
  await page.evaluate((z) => {
    (window as unknown as E2EWindow).__openreelE2E.timeline.getState().setZoom(z);
  }, pixelsPerSecond);
  await settle(page, 300);
}

/** Blur whatever the last click focused so global shortcuts reach the editor. */
export async function focusEditor(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

export async function press(page: Page, combo: string): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press(combo);
  await settle(page, 350);
}

export const undo = (page: Page) => press(page, "Meta+z");
export const redo = (page: Page) => press(page, "Meta+Shift+z");

/** Select a timeline clip by clicking its centre. */
export async function clickClip(page: Page, clipId: string): Promise<void> {
  const box = await clipLocator(page, clipId).boundingBox();
  if (!box) throw new Error(`clip ${clipId} not visible`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, 250);
}

export const clipLocator = (page: Page, clipId: string): Locator =>
  page.locator(`[data-timeline-item-id="${clipId}"]`).first();

/** Split the single imported clip into the three scenes at 2s and 4s. */
export async function splitIntoThree(page: Page): Promise<void> {
  for (const t of [2, 4]) {
    await seek(page, t);
    await clickClipAtPlayhead(page);
    await press(page, "s");
  }
  await expect
    .poll(async () => clipsOf(await readState(page), "Main").length)
    .toBe(3);
}

async function clickClipAtPlayhead(page: Page): Promise<void> {
  const s = await readState(page);
  const clip = clipsOf(s, "Main").find(
    (c) => c.start <= s.playhead + 1e-6 && s.playhead < c.start + c.duration - 1e-6,
  );
  if (!clip) throw new Error("no clip under playhead");
  await clickClip(page, clip.id);
}

/** Real mouse drag with intermediate steps (pointer + mouse events fire). */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  deltaX: number,
  steps = 14,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + deltaX / 2, from.y, { steps });
  await page.mouse.move(from.x + deltaX, from.y, { steps });
  await page.mouse.up();
  await settle(page, 500);
}

export interface ClipBox {
  left: number;
  right: number;
  centerY: number;
}
export async function boxOf(page: Page, clipId: string): Promise<ClipBox> {
  const box = await clipLocator(page, clipId).boundingBox();
  if (!box) throw new Error(`clip ${clipId} not visible`);
  return { left: box.x, right: box.x + box.width, centerY: box.y + box.height / 2 };
}

// ── program canvas pixels ────────────────────────────────────────────────
const PROGRAM = 'canvas[aria-label^="Program frame"]';

export async function snap(page: Page, key: string): Promise<void> {
  await page.evaluate(
    ([k, sel]) => {
      const c = document.querySelector(sel as string) as HTMLCanvasElement;
      const t = document.createElement("canvas");
      t.width = c.width;
      t.height = c.height;
      const g = t.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(c, 0, 0);
      const w = window as unknown as { __snaps?: Record<string, Uint8ClampedArray> };
      (w.__snaps ??= {})[k as string] = g.getImageData(0, 0, t.width, t.height).data;
    },
    [key, PROGRAM],
  );
}

/**
 * Snapshots the program canvas once it has stopped changing: two consecutive
 * captures match. A paused-frame decode can still be landing (slow software
 * decoders on CI), and a mid-decode capture is not the frame under test.
 */
export async function snapStable(page: Page, key: string, attempts = 12, gapMs = 150): Promise<void> {
  await waitForPresentedPlayhead(page);
  await snap(page, key);
  // Two consecutive identical captures: one equal pair can be a frame that has not been replaced yet
  // (a worker-backed effect, a decode that lands late on a loaded machine).
  let stableRuns = 0;
  for (let i = 0; i < attempts; i++) {
    await page.waitForTimeout(gapMs);
    await snap(page, `${key}__next`);
    const { changed } = await diffSnaps(page, key, `${key}__next`);
    await snap(page, key);
    stableRuns = changed === 0 ? stableRuns + 1 : 0;
    if (stableRuns >= 2) return;
  }
}

/**
 * Waits until the program monitor reports it has presented the frame at the
 * current playhead and is no longer busy (aria-busy false, label timecode ==
 * playhead). On a CPU-only runner a seek can take seconds to decode, and until
 * it lands the canvas still shows the previous seek: a capture then is stale,
 * not "different". Soft: gives up after `timeoutMs` so a failure still reports
 * the pixel diff rather than a timeout.
 */
export async function waitForPresentedPlayhead(page: Page, timeoutMs = 20_000): Promise<void> {
  try {
    await page.waitForFunction(
      (sel) => {
        const w = window as unknown as { __openreelE2E?: { timeline: { getState(): { playheadPosition: number } }; project: { getState(): { project?: { settings?: { frameRate?: number } } | null } } } };
        const hook = w.__openreelE2E;
        const c = document.querySelector(sel) as HTMLCanvasElement | null;
        if (!hook || !c) return false;
        if (c.getAttribute("aria-busy") === "true") return false;
        const m = /^Program frame (\d+):(\d+):(\d+):(\d+)$/.exec(c.getAttribute("aria-label") ?? "");
        if (!m) return false;
        const rate = hook.project.getState().project?.settings?.frameRate ?? 30;
        const shown = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / Math.max(1, Math.round(rate));
        return Math.abs(shown - hook.timeline.getState().playheadPosition) < 1.5 / rate;
      },
      PROGRAM,
      { timeout: timeoutMs, polling: 100 },
    );
  } catch {
    /* fall through to the stability check */
  }
}

export async function diffSnaps(page: Page, a: string, b: string) {
  return page.evaluate(
    ([x, y]) => {
      const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
      const p = s[x as string];
      const q = s[y as string];
      let changed = 0;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) changed++;
      return { changed, total: p.length / 4 };
    },
    [a, b],
  );
}

/** Mean RGB of the program canvas centre region, for "is this the red scene". */
export async function programMean(page: Page): Promise<[number, number, number]> {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(c.width * 0.25, c.height * 0.25, c.width * 0.5, c.height * 0.5).data;
    let r = 0, gg = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [r / n, gg / n, b / n] as [number, number, number];
  }, PROGRAM);
}

/** Fraction of pixels in a canvas that are not (near) black/transparent. */
export async function canvasInk(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!c || !c.width || !c.height) return 0;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return 0;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 30) ink++;
    return ink / (d.length / 4);
  }, selector);
}

/**
 * Loads the app shell (welcome screen) and waits for the e2e hook, for specs that drive core
 * modules through `__openreelE2E.core` / `.sequences` rather than a dev-server module URL. This
 * works against the dev server and against a production bundle (OPENREEL_E2E_DIST) alike.
 */
export async function openHookPage(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { __openreelE2E?: unknown }).__openreelE2E), undefined, { timeout: 30_000 });
}

/**
 * Choose a File-menu entry, e.g. ["Export timeline", "OpenTimelineIO"], the way a user does: click the
 * File trigger, click each submenu trigger, then move the pointer onto the leaf and click it.
 *
 * The pointer must end up on the leaf. Radix menu items focus themselves on pointermove, and Chrome
 * replays a pointermove at the stationary mouse after every layout change (a submenu mounting under
 * load). With the mouse parked on the submenu trigger, that replay refocuses the trigger and takes
 * focus away from a leaf that was focused programmatically or by keyboard; on CI the submenu then
 * collapsed and the choice never fired. Hovering the leaf makes every replayed move land on the leaf.
 * Each attempt re-opens whatever level a slow runner closed, so the whole path is retried, not one step.
 */
export async function chooseFileMenu(page: Page, path: string[]): Promise<void> {
  const trigger = page.getByRole("menubar", { name: "Application menu" }).getByText("File", { exact: true });
  const items = path.map((name) => page.getByRole("menuitem", { name }).first());
  await expect(async () => {
    if (!(await items[0].isVisible())) {
      await trigger.click();
      await expect(items[0]).toBeVisible({ timeout: 1_500 });
    }
    for (let i = 0; i < items.length - 1; i++) {
      if (!(await items[i + 1].isVisible())) {
        await items[i].hover();
        await items[i].click();
      }
      await expect(items[i + 1]).toBeVisible({ timeout: 1_500 });
    }
    const leaf = items[items.length - 1];
    await leaf.hover({ timeout: 2_000 });
    await leaf.click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
