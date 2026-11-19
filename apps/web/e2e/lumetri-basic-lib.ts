import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FIXTURE_DIR } from "./global-setup";
import { clipsOf, clickClip, importInput, readState, seek, settle, snapStable } from "./helpers";

interface E2EStores {
  project: { getState(): Record<string, any> };
  colorMonitor: { getState(): Record<string, any> };
  secondary: { computeScopeStats(img: { data: Uint8ClampedArray; width: number; height: number }): Record<string, any> | null };
}

const CLIP_SECONDS = 2;

/** name -> ffmpeg geq planes. Luma ramps left to right; chroma planes are flat. */
const SYNTHETIC: Record<string, { lum: string; cb: number; cr: number }> = {
  "lumetri-gradient.mp4": { lum: "16+219*X/W", cb: 128, cr: 128 },
  "lumetri-flat.mp4": { lum: "100+60*X/W", cb: 128, cr: 128 },
  "lumetri-cool.mp4": { lum: "60+120*X/W", cb: 156, cr: 100 },
  "lumetri-warm.mp4": { lum: "60+120*X/W", cb: 100, cr: 160 },
};

/** Generates the synthetic clips (idempotent). Fully tagged BT.709 like the shared fixture. */
export function ensureLumetriFixtures(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, spec] of Object.entries(SYNTHETIC)) {
    const path = join(FIXTURE_DIR, name);
    if (existsSync(path)) continue;
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi", "-i", `nullsrc=size=640x360:rate=30:duration=${CLIP_SECONDS}`,
        "-vf", `format=yuv420p,geq=lum='${spec.lum}':cb='${spec.cb}':cr='${spec.cr}'`,
        "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p",
        "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
        "-movflags", "+write_colr",
        path,
      ],
      { stdio: "ignore" },
    );
  }
}

export const fixturePath = (name: string): string => join(FIXTURE_DIR, name);

/**
 * Opens a fresh horizontal project, imports the named synthetic clips and puts them on the Main track
 * back to back (first at 0s, each next one at the end of the previous).
 */
export async function openWithClips(page: Page, names: string[]): Promise<string[]> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable; the tour just shows */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  // Match the 640x360 sources so one source pixel is one preview pixel.
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E;
    await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  const ids: string[] = [];
  for (const [index, name] of names.entries()) {
    await importInput(page).setInputFiles(fixturePath(name));
    await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
    await seek(page, index * CLIP_SECONDS);
    await page.getByRole("button", { name: `Media actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 4_000 }).catch(() => undefined);
    await expect
      .poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 })
      .toBe(index + 1);
    const clips = clipsOf(await readState(page), "Main");
    const clip = clips[index];
    expect(clip.start).toBeCloseTo(index * CLIP_SECONDS, 1);
    ids.push(clip.id);
  }
  await settle(page);
  return ids;
}

/** Select a clip, open the Color tab and the Color Grading section. */
export async function openColorGrading(page: Page, clipId: string): Promise<void> {
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: "Color", exact: true }).click();
  await settle(page, 400);
  const basic = page.getByRole("slider", { name: "Shadows", exact: true });
  if (!(await basic.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Expand Color Grading section" }).first().click();
    await settle(page, 300);
  }
  await basic.waitFor({ timeout: 10_000 });
}

/** Types a value into a PropertySlider the way a user does: click the value, type, Enter. */
export async function setSliderValue(page: Page, label: string, value: number): Promise<void> {
  await page.getByRole("button", { name: `Edit ${label} value`, exact: true }).click();
  const input = page.getByRole("textbox", { name: `${label} value`, exact: true });
  await input.fill(String(value));
  await input.press("Enter");
  await settle(page, 700);
}

export interface Bands {
  /** Mean RGB of `count` equal vertical bands across the frame (middle 60% of the height). */
  bands: Array<[number, number, number]>;
  width: number;
  height: number;
}

/** Mean colour of vertical bands of a stored Program snapshot. */
export async function bandMeans(page: Page, key: string, count: number): Promise<Bands> {
  return page.evaluate(
    ([k, n]) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k as string];
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const w = c.width;
      const h = c.height;
      const bands: Array<[number, number, number]> = [];
      for (let b = 0; b < (n as number); b++) {
        let r = 0;
        let g = 0;
        let bl = 0;
        let cnt = 0;
        const x0 = Math.floor((w * b) / (n as number));
        const x1 = Math.floor((w * (b + 1)) / (n as number));
        for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++)
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4;
            r += d[i];
            g += d[i + 1];
            bl += d[i + 2];
            cnt++;
          }
        bands.push([r / cnt, g / cnt, bl / cnt]);
      }
      return { bands, width: w, height: h };
    },
    [key, count] as const,
  );
}

const lumaOf = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export const bandLuma = (bands: Bands): number[] => bands.bands.map(lumaOf);

/** Scope statistics (the Scopes panel's math) of a stored Program snapshot. */
export async function scopeLumaRange(page: Page, key: string): Promise<{ p1: number; p99: number; min: number; max: number; median: number }> {
  return page.evaluate((k) => {
    const e = (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E;
    const data = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k];
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const stats = e.secondary.computeScopeStats({ data, width: c.width, height: c.height });
    if (!stats) throw new Error("no scope stats");
    return { p1: stats.luma.p1, p99: stats.luma.p99, min: stats.luma.min, max: stats.luma.max, median: stats.luma.median };
  }, key);
}

export async function clipGrade(page: Page, clipId: string): Promise<Record<string, any> | undefined> {
  return page.evaluate((id) => {
    const e = (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E;
    return e.project.getState().getClip(id)?.colorGrading;
  }, clipId);
}

export async function closeComparison(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.colorMonitor.getState().setComparison({ mode: "off" });
  });
  await settle(page, 500);
}

// ── flows (shared by the GPU spec and the Canvas2D fallback spec) ────────────────────────────

export interface ShadowsResult {
  before: number[];
  after: number[];
  grade: Record<string, any> | undefined;
}

/** Gradient clip; drag Shadows to +0.5 through the UI. */
export async function runShadowsFlow(page: Page): Promise<ShadowsResult> {
  const [clipId] = await openWithClips(page, ["lumetri-gradient.mp4"]);
  await seek(page, 1);
  await openColorGrading(page, clipId);
  await snapStable(page, "shadows-before");
  const before = bandLuma(await bandMeans(page, "shadows-before", 6));
  await setSliderValue(page, "Shadows", 0.5);
  await seek(page, 1);
  await snapStable(page, "shadows-after");
  const after = bandLuma(await bandMeans(page, "shadows-after", 6));
  return { before, after, grade: await clipGrade(page, clipId) };
}

export interface AutoResult {
  before: { p1: number; p99: number; median: number };
  after: { p1: number; p99: number; median: number };
  grade: Record<string, any> | undefined;
}

/** Deliberately flat clip; click Auto. */
export async function runAutoFlow(page: Page): Promise<AutoResult> {
  const [clipId] = await openWithClips(page, ["lumetri-flat.mp4"]);
  await seek(page, 1);
  await openColorGrading(page, clipId);
  await snapStable(page, "auto-before");
  const before = await scopeLumaRange(page, "auto-before");
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await expect.poll(async () => (await clipGrade(page, clipId))?.tone?.contrast ?? 0, { timeout: 20_000 }).toBeGreaterThan(0.05);
  await seek(page, 1);
  await snapStable(page, "auto-after");
  const after = await scopeLumaRange(page, "auto-after");
  return { before, after, grade: await clipGrade(page, clipId) };
}

const meanColour = (bands: Bands): [number, number, number] => {
  const sum: [number, number, number] = [0, 0, 0];
  for (const band of bands.bands) for (let c = 0; c < 3; c++) sum[c] += band[c] / bands.bands.length;
  return sum;
};
const distance = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface MatchResult {
  before: number;
  after: number;
  referenceUnchanged: boolean;
  grade: Record<string, any> | undefined;
}

/**
 * Opens the Match Color popover, picks the reference clip and presses "Apply match".
 *
 * The popover is portalled and anchored to the "Match Color…" button, which sits below the fold of a long, scrolling
 * Inspector. Anything that re-lays-out the Inspector after the popover opens (late thumbnails and scopes on a slow
 * runner) moves that button, and the popover with it, out of the viewport, where Playwright can neither scroll to it
 * (it is fixed-position) nor click it (a CI run waited out the whole 300 s on exactly this). So keep the anchor in
 * view until the Apply button is inside the viewport, then click with a bounded timeout.
 */
async function clickApplyMatch(page: Page, referenceId: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "Match Color…", exact: true });
  await trigger.click();
  await page.getByRole("combobox", { name: "Reference clip" }).selectOption(referenceId);
  const apply = page.getByRole("button", { name: "Apply match" });
  const inViewport = async (): Promise<boolean> => {
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await apply.boundingBox();
    const view = page.viewportSize();
    return !!box && !!view && box.y >= 0 && box.y + box.height <= view.height && box.x >= 0 && box.x + box.width <= view.width;
  };
  await expect.poll(inViewport, { message: "the Apply match button is inside the viewport", timeout: 20_000 }).toBe(true);
  await apply.click({ timeout: 30_000 });
}

/** Cool clip A matched to warm clip B through the Match Color popover. */
export async function runMatchFlow(page: Page): Promise<MatchResult> {
  const [a, b] = await openWithClips(page, ["lumetri-cool.mp4", "lumetri-warm.mp4"]);
  const mean = async (clipTime: number, key: string): Promise<[number, number, number]> => {
    await seek(page, clipTime);
    await snapStable(page, key);
    return meanColour(await bandMeans(page, key, 8));
  };
  const aBefore = await mean(1, "match-a-before");
  const bBefore = await mean(3, "match-b-before");
  await seek(page, 1);
  await openColorGrading(page, a);
  await clickApplyMatch(page, b);
  await expect.poll(async () => (await clipGrade(page, a))?.colorWheels, { timeout: 30_000 }).toBeTruthy();
  await expect(page.getByText(/^Applied\./)).toBeVisible();
  await page.keyboard.press("Escape");
  await closeComparison(page);
  const aAfter = await mean(1, "match-a-after");
  const bAfter = await mean(3, "match-b-after");
  return {
    before: distance(aBefore, bBefore),
    after: distance(aAfter, bBefore),
    referenceUnchanged: distance(bBefore, bAfter) < 1.5,
    grade: await clipGrade(page, a),
  };
}
