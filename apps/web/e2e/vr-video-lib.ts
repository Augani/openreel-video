import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSphericalMetadataToBlob } from "@openreel/core/export/spherical-metadata";
import { gridSphereImage } from "@openreel/core/vr/vr-test-images";
import { FIXTURE_DIR } from "./global-setup";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";
import { clickClip, clipsOf, importInput, openEditor, press, readState, seek, settle } from "./helpers";

/**
 * Immersive video (VR / 360) end to end in the real editor, with a generated equirectangular clip (a 1024x512 grid of the
 * sphere, ffmpeg-encoded, with Spherical Video V2 metadata injected):
 *  - import detects the spherical metadata, and the project panel's VR Properties dialog shows it;
 *  - the sequence's VR Properties are set from the Program monitor menu, and the monitor VR view toggles, drags, zooms and
 *    resets without touching the Program frame or the export;
 *  - VR Rotate Sphere from the Effects panel with keyframes (shortest path), checked against the analytic shift;
 *  - preview and export-mode renders agree at several frames, and the exported MP4 carries spherical metadata (ffprobe);
 *  - Reframe to flat in a flat sequence: the view lands on the analytic pixels and the flat export has no spherical metadata.
 * Shared by the gpu project (vr-video.spec.ts) and the fallback projects (fallback-vr-video.spec.ts).
 */
export const W = 1024;
export const H = 512;
export const VR_CLIP_PATH = join(FIXTURE_DIR, "equirect-grid-v1.mp4");
export const workDir = mkdtempSync(join(tmpdir(), "openreel-vr-"));

export async function ensureVrFixture(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  if (existsSync(VR_CLIP_PATH)) return;
  const raw = join(workDir, "grid.rgba");
  const plain = join(workDir, "grid-plain.mp4");
  writeFileSync(raw, Buffer.from(gridSphereImage(W, H)));
  execFileSync(
    E2E_FFMPEG,
    [
      "-y", "-stream_loop", "59", "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${W}x${H}`, "-framerate", "30", "-i", raw,
      "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p",
      "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
      "-movflags", "+write_colr",
      plain,
    ],
    { stdio: "ignore" },
  );
  const withMetadata = await addSphericalMetadataToBlob(new Blob([readFileSync(plain)]), { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 });
  writeFileSync(VR_CLIP_PATH, Buffer.from(await withMetadata.arrayBuffer()));
}

export interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
  vrView: { getState(): Record<string, any> };
  video: { getVideoEngine(): { exportMode: boolean; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
}

export function ffprobeStreams(file: string): string {
  return execFileSync(E2E_FFPROBE, ["-v", "error", "-show_streams", "-select_streams", "v:0", file], { encoding: "utf8" });
}

async function waitDone(page: Page, id: string, timeout = 400_000): Promise<string> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const x = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().queue.jobs.find((y: Record<string, any>) => y.id === jobId);
      return x ? { status: x.status as string, outputName: x.outputName as string, error: x.error as string | undefined } : null;
    }, id);
    if (!j) throw new Error(`no job ${id}`);
    if (j.status === "completed") return j.outputName;
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`job ${id} ${j.status}: ${j.error}`);
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
    await page.waitForTimeout(300);
  }
}

export async function exportMp4(page: Page, file: string, settings: Record<string, unknown>, seconds: number): Promise<void> {
  const exportId = await page.evaluate(([s, sec]) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const job = h.exportQueue.getState().enqueue({ settings: { ...(s as object), range: { startTime: 0, endTime: sec as number } }, presetLabel: "VR video" });
    if (!job) throw new Error("enqueue returned null");
    h.exportQueue.getState().start();
    return job.id as string;
  }, [settings, seconds] as const);
  const outputName = await waitDone(page, exportId);
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
  await download.saveAs(file);
}

/** Frames of the exported file as RGBA, at the file's own size. */
export function exportedFrames(file: string, w: number, h: number): Buffer[] {
  const raw = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-an", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1024 * 1024 * 1024 });
  const size = w * h * 4;
  const frames: Buffer[] = [];
  for (let off = 0; off + size <= raw.length; off += size) frames.push(raw.subarray(off, off + size));
  return frames;
}

export function psnr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    se += (a[i] - b[i]) ** 2;
    n++;
  }
  return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
}

/** Renders the program frame through the preview (exportMode false) or export (true) engine path; RGBA bytes. */
export async function renderRgba(page: Page, t: number, exportMode: boolean, w: number, h: number, stripEffects = false): Promise<number[]> {
  return page.evaluate(
    async ([time, exp, ww, hh, strip]) => {
      const e = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const engine = e.video.getVideoEngine();
      let project = e.project.getState().project;
      if (strip) {
        project = { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((tr: any) => ({ ...tr, clips: tr.clips.map((c: any) => ({ ...c, effects: [], keyframes: [] })) })) } };
      }
      engine.exportMode = exp as boolean;
      try {
        const frame = await engine.renderFrame(project, time as number, ww as number, hh as number);
        const c = new OffscreenCanvas(frame.image.width, frame.image.height);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(frame.image, 0, 0);
        return Array.from(g.getImageData(0, 0, c.width, c.height).data);
      } finally {
        engine.exportMode = false;
      }
    },
    [t, exportMode, w, h, stripEffects] as const,
  );
}

export async function programPixels(page: Page): Promise<{ w: number; h: number; data: number[] }> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  });
}

export const px = (data: ArrayLike<number>, w: number, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * w + Math.round(x)) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
export const box = (data: ArrayLike<number>, w: number, x: number, y: number, r = 2): [number, number, number] => {
  const sum = [0, 0, 0];
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const p = px(data, w, x + dx, y + dy);
    sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2];
    n++;
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
};
export const dist = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export async function removeAllClips(page: Page): Promise<void> {
  const ids = (await readState(page)).tracks.flatMap((t) => t.clips.map((c) => c.id));
  await page.evaluate(async (list) => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().removeClips(list); }, ids);
  await settle(page, 400);
}

export async function importVrClip(page: Page): Promise<string> {
  await importInput(page).setInputFiles(VR_CLIP_PATH);
  await page.getByLabel("Select media equirect-grid-v1.mp4").waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Media actions for equirect-grid-v1.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await expect.poll(async () => (await readState(page)).tracks.flatMap((t) => t.clips).length, { timeout: 30_000 }).toBe(1);
  const [clip] = (await readState(page)).tracks.flatMap((t) => t.clips);
  return clip.id;
}

export async function setSequence(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (p) => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().updateSettings(p); }, patch);
  await settle(page, 500);
}

async function openPreviewMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Preview options" }).click();
}

export function registerVrVideoTests(): void {
  test.beforeAll(async () => { await ensureVrFixture(); });

  test("VR video: detect, sequence properties, monitor VR view, Rotate Sphere, spherical export, Reframe to flat", async ({ page }, testInfo) => {
    testInfo.setTimeout(900_000);
    const notes: string[] = [];
    // The fixture itself carries V2 spherical metadata.
    expect(ffprobeStreams(VR_CLIP_PATH)).toContain("side_data_type=Spherical Mapping");

    await openEditor(page);
    await removeAllClips(page);
    await setSequence(page, { width: W, height: H });
    const clipId = await importVrClip(page);

    // ---- Import detection -------------------------------------------------------------------------------------------------
    const detected = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === "equirect-grid-v1.mp4")?.metadata.vr ?? null);
    expect(detected, "spherical metadata detected on import").toMatchObject({ projection: "equirectangular", layout: "mono", source: "metadata" });
    await page.getByRole("button", { name: "Media actions for equirect-grid-v1.mp4" }).click();
    await page.getByTestId("menu-vr-properties").click();
    await expect(page.getByTestId("vr-properties-dialog")).toBeVisible();
    await expect(page.getByTestId("vr-detected")).toContainText("spherical metadata");
    await expect(page.getByTestId("vr-projection")).toHaveValue("equirectangular");
    await page.getByTestId("vr-layout").selectOption("mono");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("vr-properties-dialog")).toBeHidden();

    // ---- Sequence VR Properties from the Program monitor menu -----------------------------------------------------------
    await openPreviewMenu(page);
    await expect(page.getByTestId("vr-view-toggle")).toHaveAttribute("aria-disabled", "true");
    await page.getByTestId("sequence-vr-properties").click();
    await page.getByTestId("vr-projection").selectOption("equirectangular");
    await page.getByTestId("vr-apply").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.settings.vr ?? null)).toMatchObject({ projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 });
    await seek(page, 0.2);
    await settle(page, 800);

    // ---- Monitor VR view: view only -----------------------------------------------------------------------------------------
    const before = await programPixels(page);
    await openPreviewMenu(page);
    await page.getByTestId("vr-view-toggle").click();
    const overlay = page.getByTestId("vr-monitor-overlay");
    await expect(overlay).toBeVisible();
    const canvas = overlay.locator("canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("data-drawn")), { timeout: 20_000 }).toBeGreaterThan(2);
    // The centre of the view (pan 0, tilt 0, straight ahead) is the centre of the equirect frame.
    const viewPixel = await canvas.evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext("2d", { willReadFrequently: true })!;
      const d = g.getImageData(Math.floor(c.width / 2) - 2, Math.floor(c.height / 2) - 2, 5, 5).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return [r / 25, gg / 25, b / 25];
    });
    const centre = box(before.data, before.w, before.w / 2, before.h / 2);
    notes.push(`VR view centre ${viewPixel.map((v) => v.toFixed(0))} vs program centre ${centre.map((v) => v.toFixed(0))}`);
    expect(dist(viewPixel, centre), "the VR view is aimed straight ahead").toBeLessThan(24);
    const box0 = (await overlay.boundingBox())!;
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();
    await page.mouse.move(box0.x + box0.width / 2 + 160, box0.y + box0.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    const dragged = { pan: Number(await overlay.getAttribute("data-pan")), tilt: Number(await overlay.getAttribute("data-tilt")) };
    notes.push(`drag +160px/+40px -> pan ${dragged.pan} tilt ${dragged.tilt}`);
    expect(dragged.pan, "dragging right turns the view left").toBeLessThan(-5);
    expect(dragged.tilt, "dragging down looks up").toBeGreaterThan(0.5);
    const fovBefore = Number(await overlay.getAttribute("data-fov"));
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => Number(await overlay.getAttribute("data-fov"))).toBeLessThan(fovBefore);
    await page.getByTestId("vr-view-reset").click();
    await expect.poll(async () => [Number(await overlay.getAttribute("data-pan")), Number(await overlay.getAttribute("data-tilt")), Number(await overlay.getAttribute("data-fov"))]).toEqual([0, 0, 90]);
    // The Program frame itself is untouched by the view.
    const after = await programPixels(page);
    expect(psnr(before.data, after.data), "the VR view leaves the Program frame alone").toBeGreaterThan(60);
    // Leave the view ON for the rest of the test: nothing below may be affected by it.

    // ---- VR Rotate Sphere from the Effects panel, keyframed pan 350 -> 10 (shortest path) ------------------------------------
    await clickClip(page, clipId);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("button", { name: "Immersive", exact: true }).first().click();
    const card = page.locator('button[aria-label^="VR Rotate Sphere. Drag"]').first();
    await card.scrollIntoViewIfNeeded();
    await card.dblclick();
    const effectOf = (type: string) => page.evaluate((ty) => {
      const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
      for (const t of project.timeline.tracks) for (const c of t.clips) for (const fx of c.effects ?? []) if (fx.type === ty) return { id: fx.id as string, params: { ...fx.params } as Record<string, any> };
      return null;
    }, type);
    await expect.poll(async () => (await effectOf("vr-rotate-sphere"))?.id, { timeout: 15_000 }).toBeTruthy();
    const rotate = (await effectOf("vr-rotate-sphere"))!;
    expect(rotate.params, "authored defaults are written").toMatchObject({ layout: "mono", pan: 0, tilt: 0, roll: 0 });
    const keyframe = (time: number, value: number) => page.evaluate(async ([id, fx, t, v]) => {
      const r = await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().executeAction({ type: "keyframe/add", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id, property: `fx:${fx}:pan`, time: t, value: v, easing: "linear" } });
      if (!r.success) throw new Error(r.error?.message);
    }, [clipId, rotate.id, time, value] as const);
    await keyframe(0, 350);
    await keyframe(1, 10);
    await settle(page, 600);

    // Interpolated pan at t = 0.5 is 360 (equivalent to 0): the picture is unrotated, not turned by 180 degrees.
    const reference = await renderRgba(page, 0.5, false, W, H, true);
    const mid = await renderRgba(page, 0.5, false, W, H);
    const midPsnr = psnr(reference, mid);
    notes.push(`pan 350 -> 10 at t=0.5 vs unrotated: PSNR ${midPsnr.toFixed(1)} dB`);
    expect(midPsnr, "halfway between 350 and 10 degrees the sphere is back at 0 (shortest path)").toBeGreaterThan(35);
    // At t = 0 the pan is 350 = -10 degrees: content moves left by 10/360 of the width. Compare with the analytic shift.
    const rot0 = await renderRgba(page, 0, false, W, H);
    const ref0 = await renderRgba(page, 0, false, W, H, true);
    const shift = Math.round((-10 / 360) * W);
    let err = 0;
    let n = 0;
    for (let y = 40; y < H - 40; y += 7) for (let x = 40; x < W - 40; x += 5) {
      const a = px(rot0, W, x, y);
      const b = px(ref0, W, (x - shift + W) % W, y);
      err += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      n += 3;
    }
    notes.push(`pan 350 at t=0: mean abs error vs analytic shift ${(err / n).toFixed(2)}`);
    expect(err / n, "Rotate Sphere matches the analytic column shift").toBeLessThan(6);

    // Preview vs export-mode render agree at several frames.
    const frames = [0, 0.25, 0.5, 0.75, 0.97];
    for (const t of frames) {
      const preview = await renderRgba(page, t, false, W, H);
      const exported = await renderRgba(page, t, true, W, H);
      const p = psnr(preview, exported);
      notes.push(`engine preview vs export-mode at ${t}s: PSNR ${p.toFixed(1)} dB`);
      expect(p, `preview and export-mode renders agree at ${t}s`).toBeGreaterThan(60);
    }

    // ---- Export (VR view still on): spherical metadata + frames match the engine ----------------------------------------------
    const MP4 = { width: W, height: H, frameRate: 30, format: "mp4", codec: "h264", bitrate: 6000 };
    const vrFile = join(workDir, "vr-export.mp4");
    await exportMp4(page, vrFile, MP4, 1);
    const probe = ffprobeStreams(vrFile);
    notes.push(`ffprobe of the VR export:\n${probe.split("\n").filter((l) => /side_data_type|projection|^type=|yaw|pitch|roll|^width|^height/.test(l)).join("\n")}`);
    expect(probe, "the VR export carries Spherical Mapping side data").toContain("side_data_type=Spherical Mapping");
    expect(probe).toContain("projection=equirectangular");
    expect(probe).toMatch(/side_data_type=Stereo 3D\s+type=2D/);
    const out = exportedFrames(vrFile, W, H);
    expect(out.length).toBeGreaterThanOrEqual(25);
    for (const k of [0, 8, 16, 24]) {
      const engine = await renderRgba(page, k / 30, true, W, H);
      const p = psnr(out[k], engine);
      notes.push(`exported frame ${k} vs export-mode engine: PSNR ${p.toFixed(1)} dB`);
      expect(p, `exported frame ${k} matches the engine render within codec loss`).toBeGreaterThan(28);
    }

    // ---- Reframe to flat in a flat sequence -------------------------------------------------------------------------------------
    await page.evaluate(async () => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.vrView.getState().setEnabled(false); });
    await setSequence(page, { width: 1280, height: 720, vr: undefined });
    await page.evaluate(async ([id, fx]) => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().removeVideoEffect?.(id, fx); }, [clipId, rotate.id] as const);
    await page.evaluate(async ([id, fx]) => {
      const clip = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      for (const k of (clip.keyframes ?? []).filter((kf: any) => kf.property.startsWith(`fx:${fx}`))) {
        await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().executeAction({ type: "keyframe/remove", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id, property: k.property, time: k.time } });
      }
    }, [clipId, rotate.id] as const);
    await clickClip(page, clipId);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await page.getByRole("button", { name: "Immersive", exact: true }).first().click();
    const flatCard = page.locator('button[aria-label^="VR Projection. Drag"]').first();
    await flatCard.scrollIntoViewIfNeeded();
    await flatCard.dblclick();
    await expect.poll(async () => (await effectOf("vr-projection"))?.id, { timeout: 15_000 }).toBeTruthy();
    const proj = (await effectOf("vr-projection"))!;
    await page.evaluate(async ([id, fx]) => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().updateVideoEffect(id, fx, { mode: "rectilinear", pan: 40, tilt: 10, fov: 90 }); }, [clipId, proj.id] as const);
    // "Fill sequence with this view" sets the view aspect to the sequence's and the clip to Cover.
    await page.getByRole("button", { name: "Edit VR Projection" }).click().catch(() => undefined);
    const fill = page.getByTestId("vr-fill-sequence");
    await fill.scrollIntoViewIfNeeded();
    await fill.click();
    await expect.poll(async () => (await effectOf("vr-projection"))?.params.aspect).toBeCloseTo(1280 / 720, 2);
    await expect.poll(() => page.evaluate((id) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id)?.transform?.fitMode, clipId)).toBe("cover");
    await settle(page, 600);
    const flat = await renderRgba(page, 0.4, true, 1280, 720);
    const source = await renderRgba(page, 0.4, false, W, H, true);
    // Sequence 1280x720 is now flat, but the stripped render uses the same flat sequence + Cover: use the analytic grid instead.
    void source;
    const grid = gridSphereImage(W, H);
    // Direction yaw 40 / pitch 10 is the centre of the view. Grid colour there (bilinear of the generated grid).
    const sx = (0.5 + 40 / 360) * W - 0.5;
    const sy = (0.5 - 10 / 180) * H - 0.5;
    const expectedCentre = box(Array.from(grid), W, sx, sy, 1);
    const gotCentre = box(flat, 1280, 640, 360, 1);
    notes.push(`Reframe centre ${gotCentre.map((v) => v.toFixed(0))} vs analytic grid colour ${expectedCentre.map((v) => v.toFixed(0))}`);
    expect(dist(gotCentre, expectedCentre), "the reframed view is centred on yaw 40 / pitch 10").toBeLessThan(40);
    // Cover fills the frame: no black bars at the left / right edges.
    const edge = box(flat, 1280, 8, 360, 3);
    expect(edge[0] + edge[1] + edge[2], "the flat view fills the sequence").toBeGreaterThan(60);

    // Keyframed reframe: pan 40 -> -40 over the clip, the centre colour changes.
    await page.evaluate(async ([id, fx]) => {
      for (const [time, value] of [[0, 40], [1, -40]] as const) {
        await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().executeAction({ type: "keyframe/add", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id, property: `fx:${fx}:pan`, time, value, easing: "linear" } });
      }
    }, [clipId, proj.id] as const);
    const a = await renderRgba(page, 0, false, 1280, 720);
    const b = await renderRgba(page, 0.9, false, 1280, 720);
    expect(psnr(a, b), "the keyframed reframe moves").toBeLessThan(25);
    for (const t of [0, 0.5, 0.9]) {
      const p = psnr(await renderRgba(page, t, false, 1280, 720), await renderRgba(page, t, true, 1280, 720));
      expect(p, `reframe preview and export-mode agree at ${t}s`).toBeGreaterThan(60);
    }

    // A flat sequence exports WITHOUT spherical metadata, and the frames match the engine.
    const flatFile = join(workDir, "flat-export.mp4");
    await exportMp4(page, flatFile, { width: 1280, height: 720, frameRate: 30, format: "mp4", codec: "h264", bitrate: 6000 }, 1);
    const flatProbe = ffprobeStreams(flatFile);
    expect(flatProbe, "a flat sequence is not tagged spherical").not.toContain("Spherical Mapping");
    const flatFrames = exportedFrames(flatFile, 1280, 720);
    const engineFlat = await renderRgba(page, 12 / 30, true, 1280, 720);
    const pFlat = psnr(flatFrames[12], engineFlat);
    notes.push(`flat export frame 12 vs export-mode engine: PSNR ${pFlat.toFixed(1)} dB`);
    expect(pFlat).toBeGreaterThan(28);

    console.log(`\n[vr-video e2e]\n${notes.join("\n")}`);
    testInfo.annotations.push({ type: "vr-video", description: notes.join("\n") });
    await press(page, "Escape");
    void clipsOf;
  });
}
