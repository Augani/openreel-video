import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importInput, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Rotation metadata (an iPhone portrait clip is stored landscape with a 90 degree flag), WebCodecs path.
 * The fixture is stored 640x360 with the left half red and the right half blue, flagged to turn 90
 * degrees clockwise, so it must show upright as 360x640 with RED ON TOP and BLUE BELOW. Checked in:
 *  - the imported item's size (portrait, not the stored landscape),
 *  - its thumbnail,
 *  - the program monitor,
 *  - the exported file (ffprobe size, and the pixels at the top and bottom of a decoded frame).
 */

const workDir = mkdtempSync(join(tmpdir(), "openreel-rotation-"));
const CLIP = join(workDir, "portrait-phone.mp4");

test.beforeAll(() => {
  const stored = join(workDir, "stored.mp4");
  execFileSync(E2E_FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=red:s=320x360:r=30:d=2",
    "-f", "lavfi", "-i", "color=c=blue:s=320x360:r=30:d=2",
    "-filter_complex", "[0:v][1:v]hstack,format=yuv420p[v]", "-map", "[v]",
    "-c:v", "libx264", "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv", stored,
  ]);
  // Display matrix only (no re-encode): -display_rotation is counter-clockwise, so -90 turns the frame 90 degrees clockwise.
  execFileSync(E2E_FFMPEG, ["-y", "-v", "error", "-display_rotation:v:0", "-90", "-i", stored, "-c", "copy", CLIP]);
});

type Rgb = [number, number, number];
const isRed = ([r, g, b]: Rgb) => r > 180 && g < 90 && b < 90;
const isBlue = ([r, g, b]: Rgb) => b > 150 && r < 90 && g < 90;

async function openWithClip(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("openreel-onboarding-complete", "true");
    localStorage.setItem("openreel-mograph-tour-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(CLIP);
  await page.getByLabel("Select media portrait-phone.mp4").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Media actions for portrait-phone.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await settle(page, 1200);
}

/** Colours at 25% and 75% of the height, centred, of an image-like source drawn to a canvas. */
const topBottomOfProgram = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const at = (fy: number): [number, number, number] => {
      const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height * fy), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return { size: [c.width, c.height] as [number, number], top: at(0.25), bottom: at(0.75) };
  });

test("a rotated phone clip is upright in the library, the monitor and the export", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openWithClip(page);

  const item = await page.evaluate(async () => {
    const h = (window as any).__openreelE2E;
    const m = h.project.getState().project.mediaLibrary.items.find((i: any) => i.name === "portrait-phone.mp4");
    // Thumbnail pixels (top / bottom) of whatever the library shows.
    const img = new Image();
    img.src = m.thumbnailUrl;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const at = (fy: number) => Array.from(g.getImageData(Math.floor(c.width / 2), Math.floor(c.height * fy), 1, 1).data.slice(0, 3));
    return { width: m.metadata.width, height: m.metadata.height, thumb: { w: c.width, h: c.height, top: at(0.25), bottom: at(0.75) } };
  });
  expect([item.width, item.height]).toEqual([360, 640]);
  expect(item.thumb.h).toBeGreaterThan(item.thumb.w);
  expect(isRed(item.thumb.top as Rgb), `thumbnail top ${item.thumb.top}`).toBe(true);
  expect(isBlue(item.thumb.bottom as Rgb), `thumbnail bottom ${item.thumb.bottom}`).toBe(true);

  const monitor = await topBottomOfProgram(page);
  expect(monitor.size[1]).toBeGreaterThan(monitor.size[0]);
  expect(isRed(monitor.top), `monitor top ${monitor.top}`).toBe(true);
  expect(isBlue(monitor.bottom), `monitor bottom ${monitor.bottom}`).toBe(true);

  // Export at the project's (portrait) size and look at the file.
  const jobId = await page.evaluate(() => {
    const h = (window as any).__openreelE2E;
    const s = h.project.getState().project.settings;
    const job = h.exportQueue.getState().enqueue({
      settings: { width: s.width, height: s.height, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 },
      presetLabel: "portrait",
    });
    h.exportQueue.getState().start();
    return job.id as string;
  });
  await expect
    .poll(
      () => page.evaluate((id) => (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((j: any) => j.id === id)?.status, jobId),
      { timeout: 120_000, intervals: [250] },
    )
    .toBe("completed");
  const name: string = await page.evaluate((id) => (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((j: any) => j.id === id).outputName, jobId);
  await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-queue-panel").getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  const out = join(workDir, "export.mp4");
  await download.saveAs(out);

  const size = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8" }).trim();
  const [w, h] = size.split(",").map(Number);
  expect(h).toBeGreaterThan(w);
  const frame = execFileSync(
    E2E_FFMPEG,
    ["-v", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 26 },
  );
  const px = (fy: number): Rgb => {
    const o = (Math.floor(h * fy) * w + Math.floor(w / 2)) * 3;
    return [frame[o], frame[o + 1], frame[o + 2]];
  };
  expect(isRed(px(0.25)), `export top ${px(0.25)}`).toBe(true);
  expect(isBlue(px(0.75)), `export bottom ${px(0.75)}`).toBe(true);
});
