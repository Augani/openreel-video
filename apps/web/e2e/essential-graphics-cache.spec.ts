import { expect, test, type Page } from "@playwright/test";
import { openEditor, seek, settle } from "./helpers";

/**
 * Render cache + Essential Graphics, in real Chrome: render In to Out, then change one
 * exposed control of a graphic. Exactly the frames the graphic covers are invalidated;
 * the frames before and after it stay cached.
 */

interface Snapshot {
  phase: string;
  frameCount: number;
  cachedRuns: Array<{ start: number; end: number }>;
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as any).__openreelE2E.renderCache.instance.getSnapshot());

const hasFrame = (page: Page, time: number): Promise<boolean> =>
  page.evaluate((t) => (window as any).__openreelE2E.renderCache.instance.hasFrameAt(t), time);

async function waitIdle(page: Page, frames: number): Promise<void> {
  await expect.poll(async () => (await snapshot(page)).frameCount, { timeout: 120_000, intervals: [250] }).toBeGreaterThanOrEqual(frames);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 120_000 }).toBe("idle");
}

test("a graphic control change invalidates exactly the graphic's span in the render cache", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const graphicId = await page.evaluate(async () => {
    const e = (window as any).__openreelE2E;
    const template = e.graphics.getBuiltInGraphicTemplate("builtin-lt-classic-bar");
    const result = await e.graphics.insertGraphic(template, { startTime: 1.5, duration: 2 });
    if (!result.ok) throw new Error(result.message);
    return result.instanceId as string;
  });
  await settle(page, 600);
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().setLoopRange(0, 6));
  await page.evaluate(() => (window as any).__openreelE2E.renderCache.renderInToOut());
  await waitIdle(page, 150);
  const before = await snapshot(page);
  expect(before.cachedRuns.length, "the whole range is cached").toBeGreaterThanOrEqual(1);
  expect(await hasFrame(page, 0.5)).toBe(true);
  expect(await hasFrame(page, 2.5)).toBe(true);
  expect(await hasFrame(page, 5)).toBe(true);

  await page.evaluate(async (id) => {
    const result = await (window as any).__openreelE2E.graphics.setGraphicValue(id, "name", "Changed name");
    if (!result.ok) throw new Error(result.message);
  }, graphicId);
  await seek(page, 0);
  await settle(page, 1500);

  // Frames under the graphic (1.5s - 3.5s) are gone; everything else is still cached.
  expect(await hasFrame(page, 0.5), "before the graphic").toBe(true);
  expect(await hasFrame(page, 1.0), "just before the graphic").toBe(true);
  expect(await hasFrame(page, 2.5), "inside the graphic").toBe(false);
  expect(await hasFrame(page, 3.0), "inside the graphic").toBe(false);
  expect(await hasFrame(page, 4.0), "after the graphic").toBe(true);
  expect(await hasFrame(page, 5.0), "after the graphic").toBe(true);
  // And exactly at the graphic's edges (frame level: 1.5s .. 3.5s).
  expect(await hasFrame(page, 1.4), "last frame before the graphic").toBe(true);
  expect(await hasFrame(page, 1.6), "first frames of the graphic").toBe(false);
  expect(await hasFrame(page, 3.4), "last frames of the graphic").toBe(false);
  expect(await hasFrame(page, 3.6), "first frame after the graphic").toBe(true);
});
