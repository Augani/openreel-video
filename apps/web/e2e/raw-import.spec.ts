import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { writeDng } from "../../../packages/core/src/raw/dng-writer";
import { FIXTURE_DIR } from "./global-setup";
import { importInput, openEditor, readState, seek, settle, snapStable, undo } from "./helpers";

/**
 * Camera RAW end to end in real Chrome: import a synthetic DNG (known Bayer data), see the RAW badge, change RAW
 * Source Settings through the dialog as ONE undo step, and check the Program monitor and the export renderer
 * (VideoEngine.renderFrame, the path the exporter calls) show the same development.
 */

const CM = [0.6722, -0.0635, -0.0963, -0.4287, 1.246, 0.2028, -0.0908, 0.2162, 0.5668];

/** A 256 x 160 14-bit chart: a horizontal ramp with a saturated colour block, seen through a Canon-like colour matrix. */
function chartDng(options: { frameShift?: number } = {}): Uint8Array {
  const w = 256;
  const h = 160;
  const samples = new Uint16Array(w * h);
  const cfa = [0, 1, 1, 2];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ramp = 0.1 + 0.5 * (x / w) + (options.frameShift ?? 0) * 0.02;
      const block = x > 160 && y > 80;
      const rgb = block ? [0.45, 0.1, 0.08] : [ramp, ramp, ramp];
      const xyz = [
        0.4124564 * rgb[0] + 0.3575761 * rgb[1] + 0.1804375 * rgb[2],
        0.2126729 * rgb[0] + 0.7151522 * rgb[1] + 0.072175 * rgb[2],
        0.0193339 * rgb[0] + 0.119192 * rgb[1] + 0.9503041 * rgb[2],
      ];
      const cam = [0, 1, 2].map((r) => CM[r * 3] * xyz[0] + CM[r * 3 + 1] * xyz[1] + CM[r * 3 + 2] * xyz[2]);
      const v = Math.min(1, Math.max(0, cam[cfa[(y & 1) * 2 + (x & 1)]]));
      samples[y * w + x] = Math.round(512 + v * (16383 - 512));
    }
  const white = [0.9505, 1, 1.089];
  const n = [0, 1, 2].map((r) => CM[r * 3] * white[0] + CM[r * 3 + 1] * white[1] + CM[r * 3 + 2] * white[2]);
  const top = Math.max(...n);
  return writeDng({
    width: w,
    height: h,
    samples,
    bitsPerSample: 14,
    compression: "lossless-jpeg",
    blackLevel: 512,
    whiteLevel: 16383,
    colorMatrix1: CM,
    illuminant1: 21,
    asShotNeutral: n.map((v) => v / top),
    make: "OpenReel",
    model: "E2E Chart",
    frameRate: 24,
  });
}

function writeFixture(name: string, bytes: Uint8Array): string {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, bytes);
  return path;
}

interface Hook {
  project: { getState(): any };
  video: { getVideoEngine(): { renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
}

async function meanOfExportFrame(page: Page, time: number): Promise<number> {
  return page.evaluate(async (t) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const frame = await h.video.getVideoEngine().renderFrame(h.project.getState().project, t, 320, 180);
    const c = new OffscreenCanvas(frame.image.width, frame.image.height);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(frame.image, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / ((d.length / 4) * 3);
  }, time);
}

async function meanOfProgramFrame(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const ctx = t.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, t.width, t.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / ((d.length / 4) * 3);
  });
}

const dngItem = (page: Page) =>
  page.evaluate(() => {
    const items = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.mediaLibrary.items;
    const m = items.find((i: any) => i.name === "chart.dng");
    return m ? { id: m.id, type: m.type, raw: m.raw, w: m.metadata.width, h: m.metadata.height } : null;
  });

test.describe("Camera RAW", () => {
  test("imports a DNG, edits RAW Source Settings as one undo step, preview matches the export renderer", async ({ page }) => {
    test.setTimeout(150_000);
    const path = writeFixture("chart.dng", chartDng());
    await openEditor(page);
    await importInput(page).setInputFiles(path);
    await page.getByLabel("Select media chart.dng").waitFor({ timeout: 30_000 });

    // Library: RAW badge, image type, developed size and as-shot metadata.
    await expect(page.getByLabel("Select media chart.dng").getByTestId("raw-badge")).toHaveText("RAW");
    const imported = await dngItem(page);
    expect(imported).toMatchObject({ type: "image", w: 256, h: 160 });
    expect(imported!.raw.developedBy).toBe("openreel");
    expect(imported!.raw.model).toBe("E2E Chart");
    expect(imported!.raw.settings.exposure).toBe(0);
    expect(imported!.raw.settings.temperature).toBeGreaterThan(5500);

    // Place it on Main after the existing 6 s clip (the playhead is where "Add to timeline" puts it) and look at it.
    await seek(page, 7);
    await page.getByRole("button", { name: "Media actions for chart.dng" }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await settle(page, 600);
    const clipStart = await page.evaluate((mediaId) => {
      const tracks = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks;
      const clip = tracks.flatMap((tr: any) => tr.clips).find((c: any) => c.mediaId === mediaId);
      return clip ? (clip.startTime as number) : null;
    }, imported!.id);
    expect(clipStart, "the RAW still is on the timeline").not.toBeNull();
    const t = clipStart! + 0.5;
    await seek(page, t);
    await snapStable(page, "raw-before");
    const previewBefore = await meanOfProgramFrame(page);
    const exportBefore = await meanOfExportFrame(page, t);
    expect(previewBefore).toBeGreaterThan(20);
    expect(Math.abs(previewBefore - exportBefore)).toBeLessThan(6);

    // RAW Source Settings: +1 EV and a cooler white balance, Apply = exactly one history entry.
    const historyBefore = (await readState(page)).historyLength;
    await page.getByRole("button", { name: "Media actions for chart.dng" }).click();
    await page.getByRole("menuitem", { name: /RAW Source Settings/ }).click();
    const dialog = page.getByTestId("raw-settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("raw-settings-preview")).toBeVisible();
    await page.getByTestId("raw-exposure").fill("1");
    await page.getByTestId("raw-temperature").fill("4800");
    await page.getByTestId("raw-demosaic").selectOption("high");
    await page.getByTestId("raw-apply").click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 600);
    const edited = await dngItem(page);
    expect(edited!.raw.settings).toMatchObject({ exposure: 1, temperature: 4800, demosaic: "high" });
    expect((await readState(page)).historyLength).toBe(historyBefore + 1);

    await seek(page, t);
    await snapStable(page, "raw-after");
    const previewAfter = await meanOfProgramFrame(page);
    const exportAfter = await meanOfExportFrame(page, t);
    expect(previewAfter).toBeGreaterThan(previewBefore + 8);
    expect(Math.abs(previewAfter - exportAfter)).toBeLessThan(6);

    // One undo returns every setting.
    await undo(page);
    await settle(page, 600);
    expect((await dngItem(page))!.raw.settings).toEqual(imported!.raw.settings);
    expect((await readState(page)).historyLength).toBe(historyBefore);
    await seek(page, t);
    await snapStable(page, "raw-undone");
    expect(Math.abs((await meanOfProgramFrame(page)) - previewBefore)).toBeLessThan(2);
  });

  test("unsupported cinema formats are refused with the reason, without adding media", async ({ page }) => {
    test.setTimeout(90_000);
    const path = writeFixture("clip.braw", new Uint8Array([1, 2, 3, 4]));
    await openEditor(page);
    const before = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.mediaLibrary.items.length);
    await importInput(page).setInputFiles(path);
    await expect(page.getByText(/Blackmagic RAW \(BRAW\) is not supported/).first()).toBeVisible({ timeout: 20_000 });
    const after = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.mediaLibrary.items.length);
    expect(after).toBe(before);
  });

  test("a numbered CinemaDNG sequence is baked into one video clip", async ({ page }) => {
    test.setTimeout(150_000);
    const frames = [0, 1, 2, 3].map((i) => writeFixture(`take_${String(i + 1).padStart(6, "0")}.dng`, chartDng({ frameShift: i })));
    await openEditor(page);
    await importInput(page).setInputFiles(frames);
    await expect.poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project
            .getState()
            .project.mediaLibrary.items.find((i: any) => i.raw?.format === "cinemadng")?.raw?.sequence?.frames ?? 0,
        ),
      { timeout: 90_000 },
    ).toBe(4);
    const item = await page.evaluate(() =>
      (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.mediaLibrary.items.find((i: any) => i.raw?.format === "cinemadng"),
    );
    expect(item.type).toBe("video");
    expect(item.metadata.duration).toBeGreaterThan(0.1);
    expect(item.raw.sequence.frameRate).toBe(24);
  });
});
