import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_FFMPEG } from "./env";
import { clickClip, clipsOf, readState, seek, settle, undo } from "./helpers";
import { openEditorWith } from "./motion-track-lib";
import { exportTo } from "./motion-track-flow";

/**
 * Object mask in a real browser (gpu project). An orange, textured disc moves over a grey textured background.
 * The tool clicks the disc on the Program monitor, Track Forward / Backward follow it, an Invert effect is
 * limited to the mask ("Effects only"), and the exported file is compared with the Program monitor.
 * Truth comes from the generated video itself: the orange pixels of each decoded frame.
 */
const W = 640;
const H = 360;
const FPS = 30;
const FRAMES = 45;
const ANCHOR = 18;

function generate(): string {
  const out = join(mkdtempSync(join(tmpdir(), "openreel-object-mask-")), "object.mp4");
  const x = "170+6*n";
  const y = "180+50*sin(n/14)";
  const background = "nullsrc=s=640x360:r=30:d=3,geq=lum='80+mod(floor(X/3)*floor(X/3)*3+floor(Y/3)*floor(Y/3)*5+floor(X/3)*floor(Y/3)*7,41)':cb=128:cr=128";
  const sprite = "nullsrc=s=104x104:r=30:d=3,format=rgba,geq=r='205+22*sin(X/6)':g='95+26*sin(Y/5)':b='48+10*sin((X+Y)/7)':a='if(lt(hypot(X-52,Y-52),50),255,0)'";
  const graph = `[0:v][1:v]overlay=x='(${x})-52':y='(${y})-52':eval=frame:format=auto[v]`;
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

const T0 = Date.now();
const stamp = (label: string) => console.log(`[object-mask] +${((Date.now() - T0) / 1000).toFixed(1)}s ${label}`);

test("object mask: click, track forward and backward, effects inside the mask, export equals preview", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  page.on("pageerror", (e) => console.log(`[object-mask] pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[object-mask] console.${m.type()} ${m.text().slice(0, 200)}`); });
  const file = generate();
  await openEditorWith(page, file, "object.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);
  await seek(page, frameTime(ANCHOR));
  await settle(page, 800);

  // ---- click the object -------------------------------------------------------
  const truth = (frame: number) => orange(decode(file, frame));
  const anchorTruth = truth(ANCHOR);
  expect(anchorTruth.count, "the generated disc is visible").toBeGreaterThan(5000);
  const shown = orange(await previewRgb(page));
  console.log(`[object-mask] preview shows disc at ${shown.x.toFixed(1)},${shown.y.toFixed(1)} (${shown.count}px), decoded truth ${anchorTruth.x.toFixed(1)},${anchorTruth.y.toFixed(1)} (${anchorTruth.count}px)`);
  await page.getByRole("button", { name: "Object mask tool" }).click();
  const overlay = page.getByTestId("object-mask-overlay");
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  const historyBeforeClick = await history(page);
  await page.mouse.click(box.x + (box.width * anchorTruth.x) / W, box.y + (box.height * anchorTruth.y) / H);
  await expect.poll(async () => (await masksOf(page)).length, { timeout: 30_000 }).toBe(1);
  await expect(overlay).toHaveAttribute("data-object-mask-busy", "false");
  expect((await history(page)) - historyBeforeClick, "the click is one undo step").toBe(1);
  const created = (await masksOf(page))[0];
  const c0 = centroidOf(created.path.points);
  console.log(`[object-mask] click: centroid ${c0.x.toFixed(1)},${c0.y.toFixed(1)} vs truth ${anchorTruth.x.toFixed(1)},${anchorTruth.y.toFixed(1)}`);
  expect(Math.hypot(c0.x - anchorTruth.x, c0.y - anchorTruth.y), "mask is centred on the object").toBeLessThan(8);
  const area = await page.evaluate((path) => (window as unknown as { __openreelE2E: { core: { maskPath: { pathArea(p: unknown): number } } } }).__openreelE2E.core.maskPath.pathArea(path), created.path);
  expect(Math.abs(area * W * H - anchorTruth.count) / anchorTruth.count, "mask area matches the object").toBeLessThan(0.15);
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // One keyframe per tracked frame, so the per-frame checks below read exact keyframes.
  await page.evaluate(() => (window as unknown as { __openreelE2E: { objectMask: { getState(): { setSimplifyTolerance(v: number): void } } } }).__openreelE2E.objectMask.getState().setSimplifyTolerance(0));
  stamp("track fwd");
  // ---- track forward then backward ---------------------------------------------
  await openMasking(page, clip.id);
  const h1 = await history(page);
  await page.getByRole("button", { name: "Track mask forward" }).click();
  await expect.poll(async () => (await masksOf(page))[0].keyframes.length, { timeout: 180_000 }).toBe(FRAMES - ANCHOR);
  expect((await history(page)) - h1, "Track Forward is one undo step").toBe(1);
  const h2 = await history(page);
  await page.getByRole("button", { name: "Track mask backward" }).click();
  await expect.poll(async () => (await masksOf(page))[0].keyframes.length, { timeout: 180_000 }).toBe(FRAMES);
  expect((await history(page)) - h2, "Track Backward is one undo step").toBe(1);
  const tracked = (await masksOf(page))[0];
  const errors: string[] = [];
  let worst = 0;
  for (const frame of [0, 6, 12, 18, 24, 30, 36, 44]) {
    const key = tracked.keyframes.find((k) => Math.abs(k.time - frame / FPS) < 0.5 / FPS)!;
    expect(key, `keyframe at frame ${frame}`).toBeTruthy();
    const c = centroidOf(key.path.points);
    const t = truth(frame);
    const error = Math.hypot(c.x - t.x, c.y - t.y);
    worst = Math.max(worst, error);
    errors.push(`${frame}:${error.toFixed(1)}`);
  }
  console.log(`[object-mask] tracked centroid error px by frame ${errors.join(" ")}`);
  expect(worst, "tracked mask follows the object").toBeLessThan(10);
  // Every keyframe is an editable path with the same vertex count.
  expect(new Set(tracked.keyframes.map((k) => k.path.points.length)).size).toBe(1);

  stamp("undo/redo");
  // Undo / redo of a track is exact.
  await undo(page);
  await settle(page, 500);
  expect((await masksOf(page))[0].keyframes.length).toBe(FRAMES - ANCHOR);

  await page.keyboard.press("Meta+Shift+z");
  await settle(page, 500);
  expect((await masksOf(page))[0].keyframes.length).toBe(FRAMES);

  stamp("effect added");
  // ---- an effect inside the mask -----------------------------------------------
  await page.evaluate(async (id) => {
    await (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E.project.getState().addVideoEffect(id, "invert");
  }, clip.id);
  await settle(page, 500);
  await openMasking(page, clip.id);
  stamp("masking open");
  await page.getByRole("radio", { name: "Mask controls effects only" }).click();
  stamp("effects only set");
  await expect.poll(async () => (await masksOf(page))[0].appliesTo).toBe("effects");

  const samples = [12, 24, 36];
  const exportFile = join(mkdtempSync(join(tmpdir(), "openreel-object-mask-export-")), "masked.mp4");
  const previews = new Map<number, Buffer>();
  for (const frame of samples) {
    await seek(page, frameTime(frame));
    await settle(page, 900);
    previews.set(frame, await previewRgb(page));
  }
  stamp("previews captured");
  await exportTo(page, exportFile);
  stamp("exported");

  for (const frame of samples) {
    const source = decode(file, frame);
    const t = truth(frame);
    const inObject = (x: number, y: number) => Math.hypot(x - t.x, y - t.y) < 30;
    const farAway = (x: number, y: number) => Math.hypot(x - t.x, y - t.y) > 130;
    const preview = previews.get(frame)!;
    const exported = decode(exportFile, frame);
    const insideInverted = meanDiff(preview, source, inObject, true);
    const outsideKept = meanDiff(preview, source, farAway);
    const exportInside = meanDiff(exported, source, inObject, true);
    const exportOutside = meanDiff(exported, source, farAway);
    const parityOutside = meanDiff(preview, exported, farAway);
    const parity = meanDiff(preview, exported, () => true);
    console.log(`[object-mask] frame ${frame}: preview inside-inverted diff ${insideInverted.toFixed(1)}, outside-kept diff ${outsideKept.toFixed(1)}; export ${exportInside.toFixed(1)} / ${exportOutside.toFixed(1)}; preview-vs-export mean diff ${parity.toFixed(2)}`);
    expect(insideInverted, `preview f${frame}: effect shows inside the mask`).toBeLessThan(10);
    expect(outsideKept, `preview f${frame}: picture untouched outside the mask`).toBeLessThan(3);
    expect(exportInside, `export f${frame}: effect shows inside the mask`).toBeLessThan(10);
    // The source-to-preview limit is checked above. AVC adds a second conversion,
    // bounded independently by the measured preview-to-export error in the same region.
    expect(exportOutside, `export f${frame}: picture untouched outside the mask`).toBeLessThan(3 + parityOutside);
    expect(parityOutside, `export preserves the unmasked preview at frame ${frame}`).toBeLessThan(1.5);
    expect(parity, `export equals preview at frame ${frame}`).toBeLessThan(1.5);
  }
  await page.screenshot({ path: testInfo.outputPath("object-mask.png") });
});
