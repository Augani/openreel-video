import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_FFMPEG } from "./env";
import { clickClip, clipsOf, readState, redo, seek, settle, undo } from "./helpers";
import { openEditorWith } from "./motion-track-lib";
import { exportTo } from "./motion-track-flow";

/**
 * Remove Object (Content-Aware Fill) in a real browser (gpu project). An orange, textured disc moves over a
 * static textured grey background. The disc is clicked and tracked, Remove Object fills it from the frames where
 * the disc is elsewhere, and the exported file is compared with the Program monitor inside and outside the mask.
 * Truth for the background comes from a second generated video without the disc.
 */
const W = 640;
const H = 360;
const FPS = 30;
const FRAMES = 45;
const ANCHOR = 18;

function generate(withDisc = true): string {
  const out = join(mkdtempSync(join(tmpdir(), "openreel-remove-object-")), withDisc ? "object.mp4" : "background.mp4");
  const x = "170+6*n";
  const y = "180+50*sin(n/14)";
  const background = "nullsrc=s=640x360:r=30:d=3,geq=lum='80+mod(floor(X/3)*floor(X/3)*3+floor(Y/3)*floor(Y/3)*5+floor(X/3)*floor(Y/3)*7,41)':cb=128:cr=128";
  const sprite = "nullsrc=s=104x104:r=30:d=3,format=rgba,geq=r='205+22*sin(X/6)':g='95+26*sin(Y/5)':b='48+10*sin((X+Y)/7)':a='if(lt(hypot(X-52,Y-52),50),255,0)'";
  const graph = `[0:v][1:v]overlay=x='(${x})-52':y='(${y})-52':eval=frame:format=auto[v]`;
  if (!withDisc) {
    execFileSync(E2E_FFMPEG, ["-y", "-f", "lavfi", "-i", background, "-c:v", "libx264", "-crf", "12", "-g", "15", "-pix_fmt", "yuv420p", "-frames:v", String(FRAMES), out], { stdio: "ignore" });
    return out;
  }
  execFileSync(E2E_FFMPEG, ["-y", "-f", "lavfi", "-i", background, "-f", "lavfi", "-i", sprite, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "12", "-g", "15", "-pix_fmt", "yuv420p", "-frames:v", String(FRAMES), out], { stdio: "ignore" });
  return out;
}

// Frame-exact: `select` counts decoded frames, so no seek / timestamp rounding can pick the neighbour.
const decode = (file: string, frame: number): Buffer =>
  execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),scale=${W}:${H}`, "-vsync", "0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });

const isOrange = (r: number, g: number, b: number): boolean => r > 170 && g > 55 && g < 160 && b < 100 && r - b > 100;
function orange(buf: Buffer): { x: number; y: number; count: number } {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    if (isOrange(buf[o], buf[o + 1], buf[o + 2])) { sx += x; sy += y; n++; }
  }
  return { x: sx / Math.max(1, n), y: sy / Math.max(1, n), count: n };
}


interface MaskState { id: string; appliesTo?: string; path: { points: Array<{ x: number; y: number }> }; keyframes: Array<{ time: number; path: { points: Array<{ x: number; y: number }> } }> }
const masksOf = (page: Page): Promise<MaskState[]> =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __openreelE2E: { project: { getState(): { project: { masks?: unknown[] } } } } }).__openreelE2E.project.getState().project.masks ?? [])));
const centroidOf = (points: Array<{ x: number; y: number }>) => ({ x: (points.reduce((a, p) => a + p.x, 0) / points.length) * W, y: (points.reduce((a, p) => a + p.y, 0) / points.length) * H });
const frameTime = (frame: number): number => (frame + 0.01) / FPS;
const history = async (page: Page): Promise<number> => (await readState(page)).historyLength;

/** The Program canvas' own pixels (not a scaled screenshot) as rgb24 at the composition size. */
async function previewRgb(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(([w, h]) => {
    const canvas = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    const ctx = copy.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
    let binary = "";
    for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return btoa(binary);
  }, [W, H] as const);
  return Buffer.from(base64, "base64");
}

async function openMasking(page: Page, clipId: string): Promise<void> {
  await clickClip(page, clipId);
  await settle(page, 500);
  const effects = page.getByRole("button", { name: /^Expand Effects/ });
  if (await effects.isVisible().catch(() => false)) await effects.click();
  const masking = page.getByRole("button", { name: "Expand Masking section" });
  if (await masking.isVisible().catch(() => false)) await masking.click();
  // Only collapsed masks have an Expand button; an expanded one keeps its controls open.
  await page.getByRole("button", { name: "Expand mask" }).first().click({ timeout: 1500 }).catch(() => undefined);
  await settle(page, 300);
}

/** Mean absolute channel difference (0..255) between two frames over the pixels `inside` selects. */
function meanDiff(a: Buffer, b: Buffer, inside: (x: number, y: number) => boolean, invert = false): number {
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    const o = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) sum += Math.abs(a[o + c] - (invert ? 255 - b[o + c] : b[o + c]));
    n += 3;
  }
  return sum / Math.max(1, n);
}


interface RemovalState { enabled: boolean; maskId: string; analysisKey?: string }
const removalOf = (page: Page): Promise<RemovalState | null> =>
  page.evaluate(() => {
    const project = (window as unknown as { __openreelE2E: { project: { getState(): { project: { timeline: { tracks: Array<{ clips: Array<{ objectRemoval?: unknown }> }> } } } } } }).__openreelE2E.project.getState().project;
    return JSON.parse(JSON.stringify(project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.objectRemoval)?.objectRemoval ?? null));
  });

const T0 = Date.now();
const stamp = (label: string) => console.log(`[remove-object] +${((Date.now() - T0) / 1000).toFixed(1)}s ${label}`);

test("remove object: track a disc, remove it, undo, redo, and the export equals the preview inside and outside the mask", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  page.on("pageerror", (e) => console.log(`[remove-object] pageerror ${e.message}`));
  const file = generate(true);
  const backgroundFile = generate(false);
  await openEditorWith(page, file, "object.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);
  await seek(page, frameTime(ANCHOR));
  await settle(page, 800);

  // ---- click the disc, track it through the whole clip (keyframes simplified within 3 px) -------
  const truth = (frame: number) => orange(decode(file, frame));
  const anchorTruth = truth(ANCHOR);
  expect(anchorTruth.count, "the generated disc is visible").toBeGreaterThan(5000);
  await page.evaluate(() => (window as unknown as { __openreelE2E: { objectMask: { getState(): { setSimplifyTolerance(v: number): void } } } }).__openreelE2E.objectMask.getState().setSimplifyTolerance(3));
  await page.getByRole("button", { name: "Object mask tool" }).click();
  const overlay = page.getByTestId("object-mask-overlay");
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  await page.mouse.click(box.x + (box.width * anchorTruth.x) / W, box.y + (box.height * anchorTruth.y) / H);
  await expect.poll(async () => (await masksOf(page)).length, { timeout: 30_000 }).toBe(1);
  await expect(overlay).toHaveAttribute("data-object-mask-busy", "false");
  await page.keyboard.press("Escape");
  await openMasking(page, clip.id);
  stamp("tracking");
  await page.getByRole("button", { name: "Track mask forward" }).click();
  await expect.poll(async () => (await masksOf(page))[0].keyframes.length, { timeout: 180_000 }).toBeGreaterThan(2);
  await expect(page.getByTestId("object-mask-tracking")).toBeHidden({ timeout: 180_000 });
  await page.getByRole("button", { name: "Track mask backward" }).click();
  await expect(page.getByTestId("object-mask-tracking")).toBeVisible();
  await expect(page.getByTestId("object-mask-tracking")).toBeHidden({ timeout: 180_000 });
  const tracked = (await masksOf(page))[0];
  console.log(`[remove-object] tracked mask keyframes ${tracked.keyframes.length} (of ${FRAMES} frames)`);
  expect(tracked.keyframes.length, "the track is simplified, not one keyframe per frame").toBeLessThan(FRAMES);
  expect(tracked.keyframes.at(-1)!.time).toBeGreaterThan((FRAMES - 3) / FPS);
  expect(tracked.keyframes[0].time).toBeLessThan(2 / FPS);

  // ---- Remove Object ---------------------------------------------------------------------------------
  stamp("remove object");
  const historyBefore = (await readState(page)).historyLength;
  await page.getByRole("button", { name: "Remove Object", exact: true }).click();
  await expect(page.getByTestId("remove-object-progress")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await removalOf(page))?.enabled, { timeout: 300_000 }).toBe(true);
  expect((await removalOf(page))?.analysisKey, "the analysis is keyed").toBeTruthy();
  expect((await readState(page)).historyLength - historyBefore, "Remove Object is one undo step").toBe(1);
  stamp("analysed");

  const samples = [12, 24, 36];
  const previews = new Map<number, Buffer>();
  for (const frame of samples) {
    await seek(page, frameTime(frame));
    await settle(page, 1200);
    previews.set(frame, await previewRgb(page));
  }
  const exportFile = join(mkdtempSync(join(tmpdir(), "openreel-remove-object-export-")), "removed.mp4");
  await exportTo(page, exportFile);
  stamp("exported");

  for (const frame of samples) {
    const source = decode(file, frame);
    const background = decode(backgroundFile, frame);
    const t = truth(frame);
    const inObject = (x: number, y: number) => Math.hypot(x - t.x, y - t.y) < 38;
    const farAway = (x: number, y: number) => Math.hypot(x - t.x, y - t.y) > 130;
    const preview = previews.get(frame)!;
    const exported = decode(exportFile, frame);
    const previewInside = meanDiff(preview, background, inObject);
    const previewWas = meanDiff(preview, source, inObject);
    const previewOutside = meanDiff(preview, source, farAway);
    const exportInside = meanDiff(exported, background, inObject);
    const exportOutside = meanDiff(exported, source, farAway);
    const parityInside = meanDiff(preview, exported, inObject);
    const parityOutside = meanDiff(preview, exported, farAway);
    const parity = meanDiff(preview, exported, () => true);
    console.log(`[remove-object] frame ${frame}: preview inside vs background ${previewInside.toFixed(1)} (was ${previewWas.toFixed(1)} vs source), outside vs source ${previewOutside.toFixed(1)}; export inside ${exportInside.toFixed(1)}, outside ${exportOutside.toFixed(1)}; preview-vs-export inside ${parityInside.toFixed(2)}, outside ${parityOutside.toFixed(2)}, whole ${parity.toFixed(2)}`);
    expect(previewWas, `f${frame}: the object really was there`).toBeGreaterThan(40);
    expect(previewInside, `preview f${frame}: the object is replaced by the background`).toBeLessThan(14);
    expect(previewOutside, `preview f${frame}: picture untouched outside the mask`).toBeLessThan(3);
    expect(exportInside, `export f${frame}: the object is replaced by the background`).toBeLessThan(14);
    // The source-to-preview limit is checked above. AVC adds a second conversion,
    // bounded independently by the measured preview-to-export error in the same region.
    expect(exportOutside, `export f${frame}: picture untouched outside the mask`).toBeLessThan(3 + parityOutside);
    expect(parityInside, `export equals preview inside the mask at frame ${frame}`).toBeLessThan(4);
    expect(parityOutside, `export equals preview outside the mask at frame ${frame}`).toBeLessThan(1.5);
    expect(parity, `export equals preview at frame ${frame}`).toBeLessThan(2);
  }

  // ---- undo brings the object back, redo removes it again ----------------------------------------------
  await seek(page, frameTime(24));
  await undo(page);
  await settle(page, 1200);
  expect(await removalOf(page), "undo removes the setting").toBeNull();
  expect(orange(await previewRgb(page)).count, "the object is back after undo").toBeGreaterThan(3000);
  await redo(page);
  await settle(page, 1500);
  expect((await removalOf(page))?.enabled).toBe(true);
  expect(orange(await previewRgb(page)).count, "the object is gone again after redo").toBeLessThan(300);
  await page.screenshot({ path: testInfo.outputPath("remove-object.png") });
});
