import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_FFMPEG } from "./env";
import { clickClip, clipsOf, importInput, readState, redo, seek, settle, undo } from "./helpers";
import { openEditorWith, type Hook } from "./motion-track-lib";
import { applyHomography, homographyBetweenQuads, invertHomography, seededRandom, type Quad } from "../../../packages/core/src/video/planar-homography";
import { exportTo } from "./motion-track-flow";

/**
 * Planar (corner-pin) tracking in a real browser. A textured surface is warped through a changing perspective
 * quad over a different textured background (rendered here by an exact homography warp), so the
 * TRUE corners of every frame are known. The tracker is driven through the Inspector, a red full-frame clip
 * above is pinned to the result, the project is exported and the red pixels are compared with the true quad.
 */
const FPS = 30, FRAMES = 45;
const quadAt = (n: number): Array<{ x: number; y: number }> => [
  { x: 150 + 2 * n, y: 70 + 0.6 * n }, { x: 470 + 2.2 * n, y: 90 + 0.2 * n },
  { x: 490 + 1.8 * n, y: 290 - 0.4 * n }, { x: 130 + 2 * n, y: 270 + 0.2 * n },
];
/** Frame n of the surface: a seeded value-noise texture warped onto the quad of frame n over a different background. */
function renderFrames(): Buffer {
  const W = 640, H = 360;
  const noise = (seed: number, cell: number) => {
    const rand = seededRandom(seed), cols = Math.ceil(W / cell) + 2, rows = Math.ceil(H / cell) + 2, grid = new Float32Array(cols * rows);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return (x: number, y: number) => {
      const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const at = (i: number, j: number) => grid[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
      return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    };
  };
  const surface = noise(42, 3), back = noise(7, 5);
  const out = Buffer.alloc(W * H * FRAMES);
  for (let n = 0; n < FRAMES; n++) {
    const q = quadAt(n) as unknown as Quad;
    const h = homographyBetweenQuads([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], q)!;
    const inv = invertHomography(h)!;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = applyHomography(inv, { x: x + 0.5, y: y + 0.5 });
      const on = t.x >= 0 && t.x < W - 1 && t.y >= 0 && t.y < H - 1;
      out[n * W * H + y * W + x] = Math.round(on ? 40 + 190 * surface(t.x, t.y) : 30 + 70 * back(x, y));
    }
  }
  return out;
}

function fixtures(): { surface: string; red: string } {
  const dir = mkdtempSync(join(tmpdir(), "openreel-planar-"));
  const surface = join(dir, "planar.mp4"), red = join(dir, "red.mp4");
  execFileSync(E2E_FFMPEG, ["-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "640x360", "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "12", "-g", "15", "-pix_fmt", "yuv420p", "-frames:v", String(FRAMES), surface], { input: renderFrames(), stdio: ["pipe", "ignore", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  execFileSync(E2E_FFMPEG, ["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=1.5", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-frames:v", String(FRAMES), red], { stdio: "ignore" });
  return { surface, red };
}

/** Fraction of the quad interior that is red, and red pixels outside it as a fraction of the quad area, in one exported frame. */
function redCoverage(file: string, frame: number): { inside: number; outside: number } {
  const w = 640, h = 360, q = quadAt(frame);
  const buf = execFileSync(E2E_FFMPEG, ["-v", "error", "-ss", String((frame + 0.5) / FPS), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const inQuad = (x: number, y: number, margin: number): boolean => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const cross = ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.abs(cross) < margin) return false;
      const s = Math.sign(cross);
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  };
  let insideRed = 0, insideTotal = 0, outsideRed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3, red = buf[o] > 190 && buf[o + 1] < 90 && buf[o + 2] < 90;
    if (inQuad(x, y, 4)) { insideTotal++; if (red) insideRed++; }
    else if (red && !inQuad(x, y, -4)) outsideRed++;
  }
  return { inside: insideRed / Math.max(1, insideTotal), outside: outsideRed / Math.max(1, insideTotal) };
}

async function setCorners(page: Page, corners: Array<{ x: number; y: number }>): Promise<void> {
  const names = ["Top left", "Top right", "Bottom right", "Bottom left"];
  for (const [i, name] of names.entries()) for (const [axis, value] of [["X", corners[i].x], ["Y", corners[i].y]] as const) {
    const input = page.getByRole("spinbutton", { name: `${name} ${axis}`, exact: true });
    await input.scrollIntoViewIfNeeded();
    await input.fill(String(Math.round(value)));
    await input.press("Enter");
    await input.blur();
  }
}

async function openPlanarSection(page: Page, clipId: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await clickClip(page, clipId);
    await settle(page, 500);
    if ((await readState(page)).selected.some((item) => item.id === clipId)) break;
  }
  const marker = page.getByText(/Drag the corners on the Program monitor/);
  if (!(await marker.isVisible().catch(() => false))) {
    const effects = page.getByRole("button", { name: /Expand Effects · \d+ section/ });
    if (await effects.count()) await effects.click();
    const header = page.getByRole("button", { name: /Planar Tracking/ }).first();
    await header.scrollIntoViewIfNeeded({ timeout: 10_000 });
    if (!(await marker.isVisible().catch(() => false))) await header.click();
  }
  await marker.waitFor({ timeout: 10_000 });
}

const analysis = (page: Page, clipId: string) => page.evaluate((id) => {
  const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
  const clip = project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
  const saved = clip?.metadata?.workspacePlanarTrackAnalysis;
  return saved ? JSON.parse(JSON.stringify(saved.data)) as { keyframes: Array<{ frame: number; corners: number[] }>; confidence: number[]; lostFrames: number[]; manualFrames: number[] } : null;
}, clipId);

const cornerError = (corners: number[], frame: number): number => Math.max(...quadAt(frame).map((p, i) => Math.hypot(p.x - corners[i * 2], p.y - corners[i * 2 + 1])));
const seekFrame = (page: Page, frame: number) => seek(page, (frame + 0.01) / FPS);

test.describe("planar tracking", () => {
  test.setTimeout(600_000);

  test("track a perspective surface, edit a frame, pin a clip, export and undo", async ({ page }, testInfo) => {
    const { surface, red } = fixtures();
    await openEditorWith(page, surface, "planar.mp4");
    const [clip] = clipsOf(await readState(page), "Main");

    // A graphic above the footage, the same length.
    await importInput(page).setInputFiles(red);
    await page.getByLabel("Select media red.mp4").waitFor({ timeout: 30_000 });
    const redClipId = await page.evaluate(async () => {
      const store = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState();
      const media = store.project.mediaLibrary.items.find((m: any) => m.name === "red.mp4");
      await store.addClipToNewTrack(media.id, 0);
      const added = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.at(-1);
      await store.reorderTrack(added.id, 0);
      return added.clips[0].id as string;
    });
    await settle(page);

    await openPlanarSection(page, clip.id);
    await setCorners(page, quadAt(0));
    await expect(page.getByTestId("planar-track-overlay")).toBeVisible();

    const historyBefore = (await readState(page)).historyLength;
    const began = Date.now();
    await page.getByRole("button", { name: /Start Tracking/ }).last().click();
    await expect(page.getByTestId("planar-track-complete")).toBeVisible({ timeout: 180_000 });
    const trackMs = Date.now() - began;
    expect((await readState(page)).historyLength, "tracking is one undo step").toBe(historyBefore + 1);
    const data = (await analysis(page, clip.id))!;
    expect(data.keyframes.length).toBe(FRAMES);
    const errors = data.keyframes.map((k) => cornerError(k.corners, k.frame));
    const worst = Math.max(...errors), mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    console.log(`[planar-track] ${FRAMES} frames in ${trackMs} ms, corner error max ${worst.toFixed(2)} px mean ${mean.toFixed(2)} px, lost ${data.lostFrames.length}`);
    expect(worst, "tracked corners follow the true surface").toBeLessThanOrEqual(4);
    expect(data.lostFrames).toEqual([]);

    // Undo is exact and redo restores the identical path.
    await undo(page);
    expect(await analysis(page, clip.id)).toBeNull();
    await redo(page);
    expect((await analysis(page, clip.id))!.keyframes).toEqual(data.keyframes);

    // Hand-edit the corners of one frame: a manual, full-confidence sample.
    await seekFrame(page, 20);
    await settle(page, 500);
    await setCorners(page, quadAt(20).map((p) => ({ x: p.x + 3, y: p.y - 2 })));
    await page.getByRole("button", { name: "Set corners at this frame" }).click();
    await expect.poll(async () => (await analysis(page, clip.id))?.manualFrames, { timeout: 10_000 }).toEqual([20]);
    const edited = (await analysis(page, clip.id))!;
    expect(edited.keyframes.find((k) => k.frame === 20)!.corners[0]).toBeCloseTo(quadAt(20)[0].x + 3, 0);
    await undo(page);
    expect((await analysis(page, clip.id))!.manualFrames).toEqual([]);
    await seekFrame(page, 0);

    // Pin the red graphic: a Corner Pin effect keyframed to the surface, one undo step.
    const historyPin = (await readState(page)).historyLength;
    const target = page.getByRole("combobox", { name: "Corner pin target" });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.getByRole("option", { name: /red\.mp4/ }).first().click();
    await page.getByRole("button", { name: "Pin Clip to Surface" }).click();
    await expect(page.getByRole("button", { name: "Update Pin" })).toBeVisible({ timeout: 15_000 });
    expect((await readState(page)).historyLength, "pin is one undo step").toBe(historyPin + 1);
    const pinned = await page.evaluate((id) => {
      const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
      const c = project.timeline.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === id);
      return { effects: c.effects.map((e: any) => e.type), keys: c.keyframes.filter((k: any) => k.property.startsWith("fx:")).length };
    }, redClipId);
    expect(pinned.effects).toContain("corner-pin");
    expect(pinned.keys).toBeGreaterThanOrEqual(8);

    // Export and compare the red pixels with the true quad.
    const file = testInfo.outputPath("planar-pinned.mp4");
    await exportTo(page, file);
    const lines: string[] = [];
    for (const frame of [2, 12, 22, 32, 42]) {
      const { inside, outside } = redCoverage(file, frame);
      lines.push(`${frame}: in ${(inside * 100).toFixed(1)}% out ${(outside * 100).toFixed(1)}%`);
      expect(inside, `red covers the true surface in exported frame ${frame}`).toBeGreaterThanOrEqual(0.93);
      expect(outside, `no red outside the true surface in exported frame ${frame}`).toBeLessThanOrEqual(0.04);
    }
    console.log(`[planar-track] export red coverage ${lines.join(" | ")}`);

    // Remove the pin: the effect this feature added goes away with its keyframes.
    await page.getByRole("button", { name: "Remove Pin" }).click();
    await expect(page.getByRole("button", { name: "Pin Clip to Surface" })).toBeVisible({ timeout: 15_000 });
    const gone = await page.evaluate((id) => {
      const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
      const c = project.timeline.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === id);
      return { effects: c.effects.length, keys: c.keyframes.length };
    }, redClipId);
    expect(gone).toEqual({ effects: 0, keys: 0 });
  });

  test("cancel stops tracking and saves nothing", async ({ page }) => {
    const { surface } = fixtures();
    await openEditorWith(page, surface, "planar.mp4");
    const [clip] = clipsOf(await readState(page), "Main");
    await openPlanarSection(page, clip.id);
    await setCorners(page, quadAt(0));
    const historyBefore = (await readState(page)).historyLength;
    await page.getByRole("button", { name: /Start Tracking/ }).last().click();
    await page.getByRole("button", { name: "Cancel Planar Tracking" }).click();
    await expect(page.getByTestId("planar-track-progress")).toBeHidden({ timeout: 15_000 });
    await settle(page, 800);
    expect(await analysis(page, clip.id)).toBeNull();
    expect((await readState(page)).historyLength).toBe(historyBefore);
    await expect(page.getByRole("button", { name: /Start Tracking/ }).last()).toBeEnabled();
  });
});
