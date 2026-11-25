import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_FFMPEG } from "./env";
import { clipsOf, readState, redo, seek, settle, undo, waitForPresentedPlayhead, clickClip } from "./helpers";
import { openEditorWith } from "./motion-track-lib";

/**
 * Auto Reframe 16:9 -> 9:16 on a clip whose only skin-toned subject moves left to right. Person segmentation
 * finds no person in a synthetic square, so this drives the heuristic fallback path in a real browser; the
 * person path is covered by unit tests with a mocked detector. The program canvas is read at several times and
 * the subject must stay inside the cropped 9:16 frame.
 */
const PROGRAM = 'canvas[aria-label^="Program frame"]';
const SUBJECT = 110;

function generateMovingSubject(): string {
  const dir = mkdtempSync(join(tmpdir(), "openreel-reframe-subject-"));
  const out = join(dir, "moving-subject.mp4");
  const graph =
    "color=c=0x606870:s=640x360:r=30:d=4[bg];color=c=0xDC966E:s=" + SUBJECT + "x" + SUBJECT + ":r=30:d=4[fg];" +
    "[bg][fg]overlay=x='60+t*120':y=125:eval=frame[v]";
  execFileSync(E2E_FFMPEG, ["-y", "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "14", "-g", "15", "-pix_fmt", "yuv420p", "-frames:v", "120", out], { stdio: "ignore" });
  return out;
}

/** Subject-coloured pixel count and centroid in the program canvas. */
async function subjectInFrame(page: import("@playwright/test").Page): Promise<{ count: number; x: number; width: number }> {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let count = 0, sx = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const o = (y * c.width + x) * 4;
      if (d[o] > 170 && d[o + 1] > 110 && d[o + 1] < 190 && d[o + 2] > 70 && d[o + 2] < 150 && d[o] - d[o + 2] > 60) { count++; sx += x; }
    }
    return { count, x: count ? sx / count : -1, width: c.width };
  }, PROGRAM);
}

test.describe("auto reframe subject tracking", () => {
  test.setTimeout(300_000);

  test("16:9 to 9:16 keeps a moving subject inside the crop, as undoable keyframes", async ({ page }) => {
    const file = generateMovingSubject();
    await openEditorWith(page, file, "moving-subject.mp4");
    const clipId = clipsOf(await readState(page), "Main")[0].id;

    for (let attempt = 0; attempt < 4; attempt++) {
      await clickClip(page, clipId);
      await settle(page, 500);
      if ((await readState(page)).selected.some((item) => item.id === clipId)) break;
    }

    // The section lives on the AI tab.
    const aiTab = page.getByRole("tab", { name: /^AI$/ });
    if (await aiTab.count()) await aiTab.first().click();
    const header = page.getByRole("button", { name: /Auto Reframe/ }).first();
    await header.scrollIntoViewIfNeeded({ timeout: 10_000 });
    const analyze = page.getByRole("button", { name: /Analyze & Reframe/ });
    if (!(await analyze.isVisible().catch(() => false))) await header.click();

    await page.getByRole("button", { name: "TikTok platform preset" }).click();
    await page.getByRole("radio", { name: "Faster motion" }).click();
    await page.getByRole("radio", { name: "Subject Auto" }).click();
    await analyze.click();
    await expect(page.getByRole("button", { name: /Applied/ })).toBeVisible({ timeout: 120_000 });

    const kfCount = () => page.evaluate((id) => {
      const p = (window as any).__openreelE2E.project.getState().project;
      const clip = p.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      return clip.keyframes.filter((k: any) => k.property === "position.x").length as number;
    }, clipId);
    // A steadily moving subject gives a near-linear camera path, which reduces to few keys; it must still move.
    expect(await kfCount()).toBeGreaterThanOrEqual(2);
    const positions = await page.evaluate((id) => {
      const p = (window as any).__openreelE2E.project.getState().project;
      const clip = p.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      return clip.keyframes.filter((k: any) => k.property === "position.x").map((k: any) => k.value as number);
    }, clipId);
    expect(Math.abs(positions[0] - positions[positions.length - 1])).toBeGreaterThan(100);

    const dims = await page.evaluate(() => {
      const s = (window as any).__openreelE2E.project.getState().project.settings;
      return { w: s.width as number, h: s.height as number };
    });
    expect(dims).toEqual({ w: 1080, h: 1920 });

    const xs: number[] = [];
    for (const t of [0.2, 1.2, 2.2, 3.4]) {
      await seek(page, t);
      await waitForPresentedPlayhead(page);
      const hit = await subjectInFrame(page);
      // Full-size subject (~110px of 360 source height, scaled to the 9:16 canvas) is present, not cropped away.
      expect(hit.count, `subject visible at ${t}s`).toBeGreaterThan(2000);
      expect(hit.x, `subject inside crop at ${t}s`).toBeGreaterThan(hit.width * 0.1);
      expect(hit.x).toBeLessThan(hit.width * 0.9);
      xs.push(hit.x);
    }
    expect(xs.length).toBe(4);

    // Undo removes the keyframes in one step, redo restores them.
    await undo(page);
    await settle(page, 500);
    expect(await kfCount()).toBe(0);
    await redo(page);
    await settle(page, 500);
    expect(await kfCount()).toBeGreaterThanOrEqual(2);
  });
});
