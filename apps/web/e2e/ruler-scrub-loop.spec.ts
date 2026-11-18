import { expect, test } from "@playwright/test";
import { openEditor, settle, setZoom } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

/**
 * Regression: drag-scrubbing the ruler over a multi-clip, effect-laden sequence crashed the Program
 * monitor with "Maximum update depth exceeded" ("Stage failed to load"). A single click did not.
 */
test("drag-scrubbing the ruler over a multi-clip sequence with effects does not crash the monitor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await openEditor(page);
  await page.evaluate(async () => {
    const ps = () => (window as any).__openreelE2E.project.getState();
    const main = () => ps().project.timeline.tracks.find((t: any) => t.name === "Main");
    const first = main().clips[0];
    const mediaId = first.mediaId;
    let t = first.startTime + first.duration;
    for (let i = 0; i < 5; i++) {
      await ps().placeMediaClip(mediaId, main().id, t);
      t += first.duration;
    }
    for (const [i, c] of main().clips.entries()) {
      await ps().addVideoEffect(c.id, "vignette", { amount: 0.28 });
      if (i % 2 === 1) await ps().addVideoEffect(c.id, "grain", { amount: 0.12 });
      await ps().updateColorGrading(c.id, { tone: { exposure: 0.08, contrast: 0.12, highlights: -0.12, shadows: 0.1, whites: 0, blacks: 0 } });
    }
    const titles = ps().project.timeline.tracks.find((t: any) => t.type === "video" && t.name !== "Main" && t.clips.length === 0);
    if (titles) ps().createTextClip(titles.id, 1.0, "Golden Hour", 3.5, { fontSize: 120, fontFamily: "Inter", color: "#FFFFFF", fontWeight: "bold" });
  });
  // Real 4K/UHD sources open decoders that lower the governor's decoder cap below its level's (3 -> 2 or 1); that
  // is what made `useMemoryPolicy()` hand the Program monitor a new snapshot object on every read.
  await page.evaluate(() => {
    (window as any).__openreelE2E.registerMemoryDecoder("e2e-uhd", 950_000_000);
  });
  expect(await page.evaluate(() => (window as any).__openreelE2E.memoryGovernor().policy.maxDecoderElements)).toBeLessThan(3);
  await setZoom(page, 60);
  await settle(page);

  const ruler = page.locator("[data-timeline-ruler]");
  const box = await ruler.boundingBox();
  if (!box) throw new Error("ruler not visible");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(box.x + 40 + i * 12, y, { steps: 2 });
  await page.mouse.up();
  await settle(page, 600);

  expect(errors.filter((e) => /Maximum update depth/.test(e))).toEqual([]);
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
  await expect(page.locator('canvas[aria-label^="Program frame"]')).toBeVisible();
});
