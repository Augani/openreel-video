import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_FFMPEG } from "./env";
import { clickClip, clipsOf, readState, seek, settle } from "./helpers";
import { openEditorWith } from "./motion-track-lib";
import { exportTo } from "./motion-track-flow";

/**
 * Object masks on a stabilized clip, and preview == export for a tracked mask (gpu project).
 *
 * A hand-held (deterministically shaky) shot of a textured grey scene holds an orange textured disc that moves
 * through the world. Warp Stabilizer (No Motion, Stabilize Crop Auto-scale) moves and magnifies the picture, the
 * disc is clicked on the stabilized Program monitor and tracked, and then
 *   - an Invert effect limited to the mask ("effects only") must invert the disc, nothing else: the inverted
 *     fraction of the disc stays >= 0.97 at six frames across the clip, in the Program monitor and in the export;
 *   - Remove Object on the same mask must remove the disc;
 *   - without the stabilizer, preview and export agree at every second frame of the clip.
 * Truth comes from the pixels themselves: orange where the disc is untouched, cyan where it was inverted.
 */
const W = 640;
const H = 360;
const FPS = 30;
const FRAMES = 60;
const ANCHOR = 24;
const SAMPLES = [6, 14, 24, 34, 46, 54];

function generate(): string {
  const dir = mkdtempSync(join(tmpdir(), "openreel-stabilized-masks-"));
  const noise = join(dir, "noise.png");
  const out = join(dir, "shaky-disc.mp4");
  // A static, blobby, non-repeating texture in a 800x450 world; the disc is drawn into the world, then the camera shakes over it.
  execFileSync(E2E_FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "nullsrc=size=800x450,format=gray,geq=lum='random(1)*255'", "-vf", "gblur=sigma=3,eq=contrast=3:brightness=0.1", "-frames:v", "1", noise]);
  const sprite = "nullsrc=s=104x104:r=30:d=2,format=rgba,geq=r='205+22*sin(X/6)':g='95+26*sin(Y/5)':b='48+10*sin((X+Y)/7)':a='if(lt(hypot(X-52,Y-52),50),255,0)'";
  const camX = "80+11*sin(n*0.5)+5*sin(n*1.3+1)";
  const camY = "45+7*sin(n*0.6+2)+4*sin(n*1.7)";
  const graph = `[0:v]format=rgba[bg];[bg][1:v]overlay=x='(200+7*n)-52':y='(225+40*sin(n/14))-52':eval=frame:format=auto,crop=${W}:${H}:x='${camX}':y='${camY}',format=yuv420p[v]`;
  execFileSync(E2E_FFMPEG, ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-t", "2", "-i", noise, "-f", "lavfi", "-i", sprite, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "12", "-g", "15", "-pix_fmt", "yuv420p", "-frames:v", String(FRAMES), out]);
  return out;
}

const decode = (file: string, frame: number): Buffer =>
  execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),scale=${W}:${H}`, "-vsync", "0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });

const isOrange = (r: number, g: number, b: number): boolean => r > 170 && g > 55 && g < 160 && b < 100 && r - b > 100;
const isCyan = (r: number, g: number, b: number): boolean => b > 140 && b - r > 80 && g > 100;

interface Disc { orange: number; cyan: number; x: number; y: number; fraction: number }
function disc(buf: Buffer): Disc {
  let o = 0, c = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const orange = isOrange(buf[i], buf[i + 1], buf[i + 2]);
    const cyan = !orange && isCyan(buf[i], buf[i + 1], buf[i + 2]);
    if (orange) o++;
    if (cyan) c++;
    if (orange || cyan) { sx += x; sy += y; }
  }
  const n = Math.max(1, o + c);
  return { orange: o, cyan: c, x: sx / n, y: sy / n, fraction: c / n };
}

const meanDiff = (a: Buffer, b: Buffer): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

const frameTime = (frame: number): number => (frame + 0.01) / FPS;

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

interface MaskState { id: string; space?: string; appliesTo?: string; keyframes: unknown[] }
const masksOf = (page: Page): Promise<MaskState[]> =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __openreelE2E: { project: { getState(): { project: { masks?: unknown[] } } } } }).__openreelE2E.project.getState().project.masks ?? [])));

interface Hook {
  project: { getState(): Record<string, any> };
  video: { getVideoEngine(): { exportMode: boolean; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
  core: { warpStabilizer: { startWarpStabilizer(id: string, s?: Record<string, unknown>): Promise<void>; updateWarpSettings(id: string, s: Record<string, unknown>): void } };
}

async function stabilize(page: Page, clipId: string): Promise<void> {
  await page.evaluate(
    ([id]) => (window as unknown as Record<string, Hook>)["__openreelE2E"].core.warpStabilizer.startWarpStabilizer(id as string, { result: "noMotion", framing: "stabilizeCropAutoScale", cropLessSmoothMore: 100 }),
    [clipId] as const,
  );
  await expect
    .poll(
      () => page.evaluate((id) => {
        const project = (window as unknown as Record<string, Hook>)["__openreelE2E"].project.getState().project;
        const clip = project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
        return Boolean(clip?.stabilization?.enabled && clip.stabilization.warpAnalysis);
      }, clipId),
      { timeout: 240_000 },
    )
    .toBe(true);
  await settle(page, 600);
}

async function openMasking(page: Page, clipId: string): Promise<void> {
  await clickClip(page, clipId);
  await settle(page, 500);
  const effects = page.getByRole("button", { name: /^Expand Effects/ });
  if (await effects.isVisible().catch(() => false)) await effects.click();
  const masking = page.getByRole("button", { name: "Expand Masking section" });
  if (await masking.isVisible().catch(() => false)) await masking.click();
  await page.getByRole("button", { name: "Expand mask" }).first().click({ timeout: 1500 }).catch(() => undefined);
  await settle(page, 300);
}

/** Click the disc on the Program monitor at ANCHOR, track it both ways (default keyframe simplification). */
async function clickAndTrack(page: Page, clipId: string): Promise<void> {
  await clickClip(page, clipId);
  await seek(page, frameTime(ANCHOR));
  await settle(page, 1000);
  const shown = disc(await previewRgb(page));
  expect(shown.orange, "the disc is visible on the monitor").toBeGreaterThan(4000);
  await page.getByRole("button", { name: "Object mask tool" }).click();
  const overlay = page.getByTestId("object-mask-overlay");
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  await page.mouse.click(box.x + (box.width * shown.x) / W, box.y + (box.height * shown.y) / H);
  await expect.poll(async () => (await masksOf(page)).length, { timeout: 30_000 }).toBe(1);
  await expect(overlay).toHaveAttribute("data-object-mask-busy", "false");
  await page.keyboard.press("Escape");
  await openMasking(page, clipId);
  await page.getByRole("button", { name: "Track mask forward" }).click();
  await expect.poll(async () => (await masksOf(page))[0].keyframes.length, { timeout: 180_000 }).toBeGreaterThan(2);
  await expect(page.getByTestId("object-mask-tracking")).toBeHidden({ timeout: 180_000 });
  await page.getByRole("button", { name: "Track mask backward" }).click();
  await expect(page.getByTestId("object-mask-tracking")).toBeVisible();
  await expect(page.getByTestId("object-mask-tracking")).toBeHidden({ timeout: 180_000 });
}

async function invertInsideMask(page: Page, clipId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await (window as unknown as Record<string, Hook>)["__openreelE2E"].project.getState().addVideoEffect(id, "invert");
  }, clipId);
  await settle(page, 500);
  await openMasking(page, clipId);
  await page.getByRole("radio", { name: "Mask controls effects only" }).click();
  await expect.poll(async () => (await masksOf(page))[0].appliesTo).toBe("effects");
}

async function previews(page: Page, frames: number[]): Promise<Map<number, Buffer>> {
  const out = new Map<number, Buffer>();
  for (const frame of frames) {
    await seek(page, frameTime(frame));
    await settle(page, 900);
    out.set(frame, await previewRgb(page));
  }
  return out;
}

test("stabilized clip: a tracked effects-only Invert mask stays on the disc in the monitor and the export", async ({ page }) => {
  test.setTimeout(900_000);
  page.on("pageerror", (e) => console.log(`[stab-mask] pageerror ${e.message}`));
  const file = generate();
  await openEditorWith(page, file, "shaky-disc.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await stabilize(page, clip.id);
  await clickAndTrack(page, clip.id);
  const [mask] = await masksOf(page);
  expect(mask.space, "the object mask is stored on the footage as shot").toBe("source");
  await invertInsideMask(page, clip.id);

  const shown = await previews(page, SAMPLES);
  const exportFile = join(mkdtempSync(join(tmpdir(), "openreel-stabilized-masks-export-")), "inverted.mp4");
  await exportTo(page, exportFile);
  for (const frame of SAMPLES) {
    const preview = shown.get(frame)!;
    const exported = decode(exportFile, frame);
    const p = disc(preview);
    const e = disc(exported);
    const parity = meanDiff(preview, exported);
    console.log(`[stab-mask] f${frame}: preview inverted fraction ${p.fraction.toFixed(3)} (cyan ${p.cyan}, orange ${p.orange}); export ${e.fraction.toFixed(3)} (cyan ${e.cyan}, orange ${e.orange}); preview-vs-export mean diff ${parity.toFixed(2)}`);
    expect(p.cyan, `preview f${frame}: the disc is visible`).toBeGreaterThan(2500);
    expect(p.fraction, `preview f${frame}: the mask stays on the disc`).toBeGreaterThanOrEqual(0.97);
    expect(e.fraction, `export f${frame}: the mask stays on the disc`).toBeGreaterThanOrEqual(0.97);
    expect(parity, `export equals preview at frame ${frame}`).toBeLessThan(1.5);
  }

  // Changing the stabilizer's settings re-derives the warp from the same analysis: the mask follows without being touched.
  const before = (await masksOf(page))[0];
  await page.evaluate((id) => (window as unknown as Record<string, Hook>)["__openreelE2E"].core.warpStabilizer.updateWarpSettings(id, { result: "smoothMotion", framing: "stabilizeOnly", smoothness: 80 }), clip.id);
  await settle(page, 800);
  const changed = await previews(page, [14, 34, 46]);
  for (const [frame, preview] of changed) {
    const p = disc(preview);
    console.log(`[stab-mask] settings changed, f${frame}: preview inverted fraction ${p.fraction.toFixed(3)} (cyan ${p.cyan}, orange ${p.orange})`);
    expect(p.cyan, `changed settings f${frame}: the disc is visible`).toBeGreaterThan(2500);
    expect(p.fraction, `changed settings f${frame}: the mask stays on the disc`).toBeGreaterThanOrEqual(0.97);
  }
  expect((await masksOf(page))[0], "changing the stabilizer does not edit the mask").toEqual(before);
});

test("stabilized clip: Remove Object on a tracked mask removes the disc in the monitor and the export", async ({ page }) => {
  test.setTimeout(900_000);
  page.on("pageerror", (e) => console.log(`[stab-remove] pageerror ${e.message}`));
  const file = generate();
  await openEditorWith(page, file, "shaky-disc.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await stabilize(page, clip.id);
  await clickAndTrack(page, clip.id);
  await page.getByRole("button", { name: "Remove Object", exact: true }).click();
  await expect(page.getByTestId("remove-object-progress")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () => page.evaluate((id) => {
        const project = (window as unknown as Record<string, Hook>)["__openreelE2E"].project.getState().project;
        return project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id)?.objectRemoval?.enabled === true;
      }, clip.id),
      { timeout: 300_000 },
    )
    .toBe(true);

  const shown = await previews(page, SAMPLES);
  const exportFile = join(mkdtempSync(join(tmpdir(), "openreel-stabilized-masks-export-")), "removed.mp4");
  await exportTo(page, exportFile);
  for (const frame of SAMPLES) {
    const preview = shown.get(frame)!;
    const exported = decode(exportFile, frame);
    const p = disc(preview);
    const e = disc(exported);
    const parity = meanDiff(preview, exported);
    console.log(`[stab-remove] f${frame}: disc pixels left preview ${p.orange}, export ${e.orange}; preview-vs-export mean diff ${parity.toFixed(2)}`);
    // The disc is about 7,800 px (more once the auto-scale magnifies it); a removed disc leaves at most a rim.
    expect(p.orange, `preview f${frame}: the disc is removed`).toBeLessThan(450);
    expect(e.orange, `export f${frame}: the disc is removed`).toBeLessThan(450);
    expect(parity, `export equals preview at frame ${frame}`).toBeLessThan(2.5);
  }

  // A pasted copy keeps Remove Object: exporting it finds the analysis of the clip it came from instead of failing.
  const pastedAt = 2.5;
  const pastedId = await page.evaluate(async ([id, start]) => {
    const store = (window as unknown as Record<string, Hook>)["__openreelE2E"].project.getState();
    const track = store.project.timeline.tracks.find((t: any) => t.clips.some((c: any) => c.id === id));
    store.copyClips([id]);
    await store.pasteClips(track.id, start);
    const latest = (window as unknown as Record<string, Hook>)["__openreelE2E"].project.getState();
    return (latest.lastPastedClipIds as string[])[0] ?? null;
  }, [clip.id, pastedAt] as const);
  expect(pastedId, "the clip was pasted").toBeTruthy();
  const rendered = await page.evaluate(async (t) => {
    const hook = (window as unknown as Record<string, Hook>)["__openreelE2E"];
    const engine = hook.video.getVideoEngine();
    engine.exportMode = true;
    try {
      const { image } = await engine.renderFrame(hook.project.getState().project, t, 640, 360);
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
      const rgb = new Uint8Array(image.width * image.height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
      let binary = "";
      for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
      return btoa(binary);
    } finally {
      engine.exportMode = false;
    }
  }, pastedAt + 14 / FPS + 0.002);
  const pasted = disc(Buffer.from(rendered, "base64"));
  console.log(`[stab-remove] pasted copy, export render: disc pixels left ${pasted.orange}`);
  expect(pasted.orange, "the pasted copy renders with the object removed in export mode").toBeLessThan(450);
});

test("tracked effects-only mask, no stabilizer: the monitor equals the export at every second frame", async ({ page }) => {
  test.setTimeout(900_000);
  page.on("pageerror", (e) => console.log(`[plain-mask] pageerror ${e.message}`));
  const file = generate();
  await openEditorWith(page, file, "shaky-disc.mp4");
  const [clip] = clipsOf(await readState(page), "Main");
  await clickAndTrack(page, clip.id);
  await invertInsideMask(page, clip.id);

  const frames = Array.from({ length: 30 }, (_, k) => k * 2);
  const shown = await previews(page, frames);
  const exportFile = join(mkdtempSync(join(tmpdir(), "openreel-stabilized-masks-export-")), "plain.mp4");
  await exportTo(page, exportFile);
  const worst: string[] = [];
  for (const frame of frames) {
    const preview = shown.get(frame)!;
    const exported = decode(exportFile, frame);
    const parity = meanDiff(preview, exported);
    const p = disc(preview);
    const e = disc(exported);
    if (parity >= 1.5 || p.fraction < 0.97 || e.fraction < 0.97) worst.push(`f${frame}: diff ${parity.toFixed(2)}, preview ${p.fraction.toFixed(3)}, export ${e.fraction.toFixed(3)}`);
    console.log(`[plain-mask] f${frame}: preview-vs-export mean diff ${parity.toFixed(2)}, inverted fraction preview ${p.fraction.toFixed(3)} export ${e.fraction.toFixed(3)}`);
  }
  expect(worst, "every sampled frame: preview equals export and the mask is on the disc").toEqual([]);
});
