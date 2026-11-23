import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, clipLocator, clipsOf, diffSnaps, openEditor, readState, seek, settle, snapStable } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Time Interpolation end to end, in the real editor: a 25% speed clip set to Optical Flow from the clip context
 * menu, scrubbed, then exported through the queue.
 *  - the context menu has the three modes and the choice is stored on the clip;
 *  - the program monitor shows different frames for playheads inside one source frame pair (Frame Sampling would
 *    repeat one frame for all of them);
 *  - the preview engine and the export-mode engine render the SAME pixels at the same playhead (preview and
 *    export share one renderer);
 *  - the exported file's frames match the preview frames at the same playhead (within codec loss), and
 *    consecutive exported frames are not duplicates.
 */
const MP4_SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 4000 };
const workDir = mkdtempSync(join(tmpdir(), "openreel-optical-flow-"));
const FRAMES = 24;

interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
  video: { getVideoEngine(): { exportMode: boolean; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
  speed: { editClipSpeed(projectId: string, clipId: string, change: Record<string, unknown>, affectAudio: boolean): Promise<boolean> };
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

type Matrix = "bt709" | "bt601";
/** Limited-range luma of RGBA, the plane an H.264 decode hands back (the encoder's matrix differs between GPU and software paths). */
function lumaOf(rgba: number[], matrix: Matrix = "bt709", fullRange = false): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  const [kr, kg, kb] = matrix === "bt709" ? [0.2126, 0.7152, 0.0722] : [0.299, 0.587, 0.114];
  for (let i = 0; i < out.length; i++) {
    const y = kr * rgba[i * 4] + kg * rgba[i * 4 + 1] + kb * rgba[i * 4 + 2];
    out[i] = Math.round(fullRange ? y : 16 + (219 * y) / 255);
  }
  return out;
}
function psnr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i] - b[i]) ** 2;
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / a.length));
}

/**
 * Shared by the gpu project (optical-flow-export.spec.ts: WebGPU compute when the machine has an adapter) and the
 * fallback projects (fallback-optical-flow.spec.ts: no WebGPU, so the CPU reference renders every frame).
 */
export function registerOpticalFlowTests(expectCpu: boolean): void {
test("25% speed + Optical Flow: scrub, preview/export parity and distinct exported intermediates", async ({ page }, testInfo) => {
  testInfo.setTimeout(900_000);
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  await clickClip(page, clip.id);

  const projectId = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.id as string);
  expect(
    await page.evaluate(([id, pid]) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.speed.editClipSpeed(pid, id, { speed: 0.25 }, true), [clip.id, projectId] as const),
  ).toBe(true);
  await settle(page, 500);

  // Time Interpolation from the clip context menu, like Premiere.
  await clipLocator(page, clip.id).click({ button: "right" });
  await page.getByTestId("clip-time-interpolation-menu").click();
  await expect(page.getByRole("menuitemradio", { name: "Frame Sampling" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Frame Blending" })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Optical Flow" }).click();
  await expect
    .poll(() => page.evaluate((id) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id)?.timeInterpolation, clip.id))
    .toBe("opticalFlow");
  await settle(page, 600);

  // Scrub: three playheads inside one source frame pair (a source frame lasts 4 program frames at 25%: program frames 41..43 lie between source frames 10 and 11).
  for (const [i, t] of [41, 42, 43].entries()) {
    await seek(page, t / 30);
    await snapStable(page, `of-${i}`);
  }
  const d12 = await diffSnaps(page, "of-0", "of-1");
  const d23 = await diffSnaps(page, "of-1", "of-2");
  console.log(`[optical-flow e2e] scrub: changed px ${d12.changed} / ${d23.changed} between consecutive intermediate frames`);
  expect(d12.changed, "scrubbing inside one source frame pair shows different frames").toBeGreaterThan(50);
  expect(d23.changed).toBeGreaterThan(50);

  // Preview engine vs export-mode engine at the same playheads, and an unrendered control with Frame Sampling.
  const engineFrames = await page.evaluate(async (count) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = h.video.getVideoEngine();
    const toLuma = async (bitmap: ImageBitmap) => {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      return Array.from(g.getImageData(0, 0, bitmap.width, bitmap.height).data);
    };
    const render = async (exportMode: boolean, k: number) => {
      const project = h.project.getState().project;
      engine.exportMode = exportMode;
      try {
        const frame = await engine.renderFrame(project, k / 30, 640, 360);
        return await toLuma(frame.image);
      } finally {
        engine.exportMode = false;
      }
    };
    const out: Array<{ k: number; preview: number[]; identical: boolean }> = [];
    for (let k = 0; k < count; k++) {
      const preview = await render(false, k);
      const exported = await render(true, k);
      let identical = preview.length === exported.length;
      for (let i = 0; identical && i < preview.length; i++) if (preview[i] !== exported[i]) identical = false;
      out.push({ k, preview, identical });
    }
    return out;
  }, FRAMES);
  const mismatched = engineFrames.filter((f) => !f.identical).map((f) => f.k);
  console.log(`[optical-flow e2e] preview vs export-mode engine: ${engineFrames.length - mismatched.length}/${engineFrames.length} frames bit-identical`);
  expect(mismatched, "preview and export-mode renders agree at every playhead").toEqual([]);
  let previewLuma = engineFrames.map((f) => lumaOf(f.preview));
  for (let k = 1; k < FRAMES; k++) {
    expect(psnr(previewLuma[k], previewLuma[k - 1]), `preview frame ${k} differs from ${k - 1}`).toBeLessThan(80);
  }

  // Export through the real queue (1 s = 30 frames).
  const exportId = await page.evaluate(([settings, frames]) => {
    const job = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().enqueue({ settings: { ...settings, range: { startTime: 0, endTime: (frames as number) / 30 } }, presetLabel: "Optical flow" });
    if (!job) throw new Error("enqueue returned null");
    (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().start();
    return job.id as string;
  }, [MP4_SMALL, FRAMES] as const);
  const outputName = await waitDone(page, exportId);
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
  const file = join(workDir, "optical-flow.mp4");
  await download.saveAs(file);

  const W = 640;
  const H = 360;
  const raw = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-an", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 256 * 1024 * 1024 });
  const frameBytes = (W * H * 3) / 2;
  const exported: Buffer[] = [];
  for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) exported.push(raw.subarray(off, off + W * H));
  console.log(`[optical-flow e2e] exported ${exported.length} frames`);
  expect(exported.length).toBeGreaterThanOrEqual(FRAMES - 1);

  // The luma matrix the encoder used is a property of the export path, not of interpolation: take the better of the two.
  const compare = (luma: Uint8Array[]) => {
    const own: number[] = [];
    const neighbour: number[] = [];
    for (let k = 0; k < Math.min(FRAMES, exported.length); k++) {
      own.push(psnr(exported[k], luma[k]));
      if (k + 1 < FRAMES) neighbour.push(psnr(exported[k], luma[k + 1]));
    }
    return { own, neighbour, mean: own.reduce((a, b) => a + b, 0) / own.length };
  };
  const variants = [["bt709", false], ["bt601", false], ["bt709", true], ["bt601", true]] as const;
  const lumas = variants.map(([m, full]) => engineFrames.map((f) => lumaOf(f.preview, m, full)));
  const candidates = lumas.map(compare);
  const best = candidates.reduce((bi, c, i) => (c.mean > candidates[bi].mean ? i : bi), 0);
  previewLuma = lumas[best];
  const { own, neighbour } = candidates[best];
  console.log(`[optical-flow e2e] luma matrix of this export path: ${variants[best][0]} ${variants[best][1] ? "full" : "limited"} range`);
  const consecutive: number[] = [];
  for (let k = 1; k < Math.min(FRAMES, exported.length); k++) consecutive.push(psnr(exported[k], exported[k - 1]));
  const min = (v: number[]) => Math.min(...v);
  console.log(`[optical-flow e2e] per-frame PSNR export vs preview: ${own.map((v) => v.toFixed(1)).join(" ")}`);
  console.log(
    `[optical-flow e2e] export vs preview at the same frame: min PSNR ${min(own).toFixed(2)} dB; vs next preview frame: max ${Math.max(...neighbour).toFixed(2)} dB; consecutive exported frames: max PSNR ${Math.max(...consecutive).toFixed(2)} dB`,
  );
  // Same playhead: close (H.264 loss and colour conversion only). The wrong neighbour is further away.
  expect(min(own), "exported frame matches the preview frame at the same playhead").toBeGreaterThan(30);
  expect(own.reduce((a, b) => a + b, 0) / own.length).toBeGreaterThan(neighbour.reduce((a, b) => a + b, 0) / neighbour.length);
  // No duplicates: with Frame Sampling frames 1..3 of each group of 4 would equal their first.
  for (const [i, p] of consecutive.entries()) expect(p, `exported frame ${i + 1} is not a duplicate of ${i}`).toBeLessThan(60);

  // Which implementation rendered the frames.
  const stats = await page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: { core: { timeInterpolation: { getTimeInterpolator(): { stats: Record<string, number> } } } } }).__openreelE2E;
    return { ...h.core.timeInterpolation.getTimeInterpolator().stats };
  });
  console.log(`[optical-flow e2e] ${testInfo.project.name}: interpolator ${JSON.stringify(stats)}`);
  expect(stats.gpuFrames + stats.cpuFrames, "frames were produced by optical flow").toBeGreaterThan(0);
  if (expectCpu) expect(stats.gpuFrames, "no WebGPU: the CPU reference rendered").toBe(0);
});
}
