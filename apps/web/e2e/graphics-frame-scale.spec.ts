import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH } from "./global-setup";
import { clipsOf, importInput, readState, seek, settle } from "./helpers";
import { graphicState, hideMain, insertFromBrowse } from "./essential-graphics-lib";

/**
 * Resolution independence in real Chrome. A Hero Title is inserted while the sequence is
 * 1920x1080, then a 640x360 clip is added and "Match Video" is chosen (the sequence becomes
 * 640x360). "Scale graphics to new frame size" (default on) rescales the title with the
 * frame in the same single undo step: the lit pixels of the program frame keep their
 * proportions and stay inside the frame. With the box unchecked the old behaviour (a 1080p
 * layout in a 360p frame) is still available.
 */

const PROGRAM = 'canvas[aria-label^="Program frame"]';

interface Bounds {
  /** Fractions of the program frame, 0..1. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Share of the frame that is not the stage colour. */
  lit: number;
  width: number;
  height: number;
}

/** Bounding box of everything that differs from the corner (stage) colour in the program frame. */
async function litBounds(page: Page): Promise<Bounds> {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const { data } = g.getImageData(0, 0, t.width, t.height);
    const bg = [data[0], data[1], data[2]];
    let l = t.width, r = -1, tp = t.height, b = -1, n = 0;
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const i = (y * t.width + x) * 4;
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 48) {
          n++;
          if (x < l) l = x;
          if (x > r) r = x;
          if (y < tp) tp = y;
          if (y > b) b = y;
        }
      }
    }
    return {
      left: l / t.width, top: tp / t.height, right: (r + 1) / t.width, bottom: (b + 1) / t.height,
      lit: n / (t.width * t.height), width: t.width, height: t.height,
    };
  }, PROGRAM);
}

const settings = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().getFullProject();
    return { width: p.settings.width as number, height: p.settings.height as number };
  });

const maxFont = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().getFullProject();
    return Math.max(...(p.textClips ?? []).map((c: any) => c.style.fontSize as number));
  });

async function startAt1080(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator(PROGRAM).waitFor({ timeout: 60_000 });
  expect(await settings(page)).toEqual({ width: 1920, height: 1080 });
}

async function addFixtureAndMatch(page: Page, scaleGraphics: boolean): Promise<void> {
  await page.getByRole("button", { name: "Media", exact: true }).first().click().catch(() => undefined);
  await importInput(page).setInputFiles(FIXTURE_PATH);
  const card = page.getByLabel("Select media three-scenes.mp4");
  await card.waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Media actions for three-scenes.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  const box = page.getByRole("checkbox", { name: "Scale graphics to new frame size" });
  await expect(box, "the Match Video dialog offers to scale graphics").toBeVisible({ timeout: 8_000 });
  await expect(box, "scaling is the default").toBeChecked();
  if (!scaleGraphics) await box.click();
  await page.getByRole("button", { name: "Match Video" }).click();
  await expect
    .poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 })
    .toBe(1);
  await settle(page);
}

test("Match Video scales a 1080p Hero Title with the frame: proportional, inside the frame, one undo step", async ({ page }) => {
  test.setTimeout(240_000);
  await startAt1080(page);
  await seek(page, 0);
  await insertFromBrowse(page, "Hero Title");
  const instance = (await graphicState(page)).instances[0];
  await seek(page, instance.startTime + instance.duration / 2);
  await settle(page, 800);
  const before = await litBounds(page);
  const fontBefore = await maxFont(page);
  expect(before.width).toBeGreaterThan(0);
  expect(before.lit, "the title is visible at 1080p").toBeGreaterThan(0.005);

  await addFixtureAndMatch(page, true);
  expect(await settings(page)).toEqual({ width: 640, height: 360 });
  await hideMain(page);
  await seek(page, instance.startTime + instance.duration / 2);
  await settle(page, 900);
  const after = await litBounds(page);
  const fontAfter = await maxFont(page);

  expect(fontAfter, "font size follows the frame width (1920 -> 640)").toBeCloseTo(fontBefore / 3, 2);
  // The title keeps its place and proportion: same fractional bounds as at 1080p (text raster tolerance 1.5% of the frame).
  const tol = 0.015;
  expect(Math.abs(after.left - before.left), `left ${before.left} -> ${after.left}`).toBeLessThan(tol);
  expect(Math.abs(after.right - before.right), `right ${before.right} -> ${after.right}`).toBeLessThan(tol);
  expect(Math.abs(after.top - before.top), `top ${before.top} -> ${after.top}`).toBeLessThan(tol * 1.8);
  expect(Math.abs(after.bottom - before.bottom), `bottom ${before.bottom} -> ${after.bottom}`).toBeLessThan(tol * 1.8);
  // Inside the frame with margin: nothing is clipped by an edge.
  expect(after.left).toBeGreaterThan(0.02);
  expect(after.right).toBeLessThan(0.98);
  expect(after.top).toBeGreaterThan(0.02);
  expect(after.bottom).toBeLessThan(0.98);
  console.log(`[frame-scale] 1080p bounds ${JSON.stringify(before)} -> 640x360 bounds ${JSON.stringify(after)}, font ${fontBefore} -> ${fontAfter}`);

  // One undo step: a settings change with graphics restores both the frame and the title exactly.
  const history = (await graphicState(page)).history;
  await page.evaluate(async () => {
    const r = await (window as any).__openreelE2E.project.getState().updateSettings({ width: 1280, height: 720 });
    if (!r.success) throw new Error(r.error?.message ?? "settings failed");
  });
  expect(await settings(page)).toEqual({ width: 1280, height: 720 });
  expect((await graphicState(page)).history - history, "frame change with graphics is ONE undo step").toBe(1);
  expect(await maxFont(page)).toBeCloseTo(fontBefore * (1280 / 1920), 2);
  await page.evaluate(async () => {
    await (window as any).__openreelE2E.project.getState().undo();
  });
  await settle(page, 400);
  expect(await settings(page)).toEqual({ width: 640, height: 360 });
  expect(await maxFont(page)).toBeCloseTo(fontAfter, 4);
});

test("unchecking Scale graphics keeps the old layout (opt-out)", async ({ page }) => {
  test.setTimeout(180_000);
  await startAt1080(page);
  await seek(page, 0);
  await insertFromBrowse(page, "Hero Title");
  const fontBefore = await maxFont(page);
  await addFixtureAndMatch(page, false);
  expect(await settings(page)).toEqual({ width: 640, height: 360 });
  expect(await maxFont(page), "unchanged when scaling is off").toBe(fontBefore);
  // The bug the default fixes: the 1080p layout fills (and is clipped by) the 360p frame.
  const instance = (await graphicState(page)).instances[0];
  await hideMain(page);
  await seek(page, instance.startTime + instance.duration / 2);
  await settle(page, 900);
  const clipped = await litBounds(page);
  expect(clipped.right - clipped.left, "unscaled title spans the whole frame width").toBeGreaterThan(0.95);
});
