import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, importInput, openEditor, readState, seek, settle, snapStable } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Warp Stabilizer end to end in the real editor: a generated shaky clip is analysed in the background (the
 * status and its cancel button are the inspector's), then Smooth Motion / No Motion and Stabilize Only / Stabilize
 * Crop / Auto-scale / Synthesize Edges are switched on the same analysis (no new analysis). At every switch the
 * preview engine and the export-mode engine render the same pixels, the shake is measurably removed, the framing
 * does what its name says, the program monitor shows the stabilized picture, and an exported file matches the
 * preview.
 */
const workDir = mkdtempSync(join(tmpdir(), "openreel-warp-stabilizer-"));
const W = 640;
const H = 360;

interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
  video: { getVideoEngine(): { exportMode: boolean; renderFrame(project: unknown, t: number, w: number, h: number): Promise<{ image: ImageBitmap }> } };
  core: { warpStabilizer: { startWarpStabilizer(id: string, s?: Record<string, unknown>): Promise<void>; updateWarpSettings(id: string, s: Record<string, unknown>): void; setWarpEnabled(id: string, e: boolean): void }; warpRegistry: { getWarpRegistry(): { getJob(id: string): { status: string; progress?: number } } } };
}

function makeShakyClip(): string {
  const noise = join(workDir, "noise.png");
  const out = join(workDir, "shaky.mp4");
  // a static, blobby, non-repeating texture (no moving subject, nothing periodic for the aligner to lock onto wrongly)
  execFileSync(E2E_FFMPEG, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "nullsrc=size=800x450,format=gray,geq=lum='random(1)*255'",
    "-vf", "gblur=sigma=3,eq=contrast=3:brightness=0.1", "-frames:v", "1", noise,
  ]);
  // 800x450 cropped to 640x360 with a deterministic hand-held shake (about +-16 px across, +-11 px up and down)
  const x = "80+11*sin(n*0.5)+5*sin(n*1.3+1)";
  const y = "45+7*sin(n*0.6+2)+4*sin(n*1.7)";
  execFileSync(E2E_FFMPEG, [
    "-y", "-v", "error", "-loop", "1", "-framerate", "30", "-t", "2", "-i", noise,
    "-vf", `crop=${W}:${H}:x='${x}':y='${y}',format=yuv420p`,
    "-c:v", "libx264", "-g", "15", "-crf", "12", "-pix_fmt", "yuv420p", out,
  ]);
  return out;
}

const allClips = async (page: Page) => (await readState(page)).tracks.flatMap((t) => t.clips.map((c) => ({ ...c, track: t.name })));

async function importShaky(page: Page): Promise<{ id: string; start: number }> {
  // the editor opens with the three-scenes fixture on the timeline: remove it so the shaky clip is the only picture
  const original = (await allClips(page)).map((c) => c.id);
  const removed = await page.evaluate(async (ids) => (await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().rippleDeleteClips(ids)).success as boolean, original);
  expect(removed).toBe(true);
  await expect.poll(async () => (await allClips(page)).length).toBe(0);
  await importInput(page).setInputFiles(makeShakyClip());
  await page.getByLabel("Select media shaky.mp4").waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Media actions for shaky.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 4_000 }).catch(() => undefined);
  await expect.poll(async () => (await allClips(page)).length, { timeout: 20_000 }).toBe(1);
  const [clip] = await allClips(page);
  await settle(page);
  return { id: clip.id, start: clip.start };
}

/** Compare every preview/export byte in the browser, retaining only the previous frame for the shake measurement. */
async function renderBoth(page: Page, times: number[], captureLuma = false) {
  return page.evaluate(async ({ times, width, height, captureLuma }) => {
    const hook = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = hook.video.getVideoEngine();
    const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
    const render = async (exportMode: boolean, time: number) => {
      const previousMode = engine.exportMode;
      engine.exportMode = exportMode;
      try {
        const { image } = await engine.renderFrame(hook.project.getState().project, time, width, height);
        try {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, width, height).data;
        } finally {
          image.close();
        }
      } finally {
        engine.exportMode = previousMode;
      }
    };
    const luma = (pixels: Uint8ClampedArray, i: number) => 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    let previous: Uint8ClampedArray | undefined;
    let lumaDifference = 0, samples = 0, empty = 0;
    const mismatched: number[] = [];
    const lumaFrames: string[] = [];
    for (const time of times) {
      const preview = await render(false, time);
      const exported = await render(true, time);
      if (!preview.every((channel, i) => channel === exported[i])) mismatched.push(time);
      for (let i = 0; i < preview.length; i += 4) {
        if (preview[i] + preview[i + 1] + preview[i + 2] < 3) empty++;
      }
      if (previous) {
        for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y += 2) {
          for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += 2) {
            const i = (y * width + x) * 4;
            lumaDifference += Math.abs(luma(preview, i) - luma(previous, i));
            samples++;
          }
        }
      }
      if (captureLuma) {
        const plane = new Uint8Array(width * height);
        for (let i = 0; i < plane.length; i++) {
          const at = i * 4;
          plane[i] = Math.round(16 + 219 / 255 * (0.2126 * preview[at] + 0.7152 * preview[at + 1] + 0.0722 * preview[at + 2]));
        }
        let bytes = "";
        for (let i = 0; i < plane.length; i += 32768) bytes += String.fromCharCode(...plane.subarray(i, i + 32768));
        lumaFrames.push(btoa(bytes));
      }
      previous = preview;
    }
    return { mismatched, lumaFrames, shake: lumaDifference / samples, emptyFraction: empty / (times.length * width * height) };
  }, { times, width: W, height: H, captureLuma });
}

const clipOf = (page: Page, id: string) =>
  page.evaluate((clipId) => {
    const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    for (const track of project.timeline.tracks) for (const c of track.clips) if (c.id === clipId) return c.stabilization ?? null;
    return null;
  }, id) as Promise<{ enabled: boolean; warp?: Record<string, unknown>; warpAnalysis?: { frameCount: number; motion: number[] } } | null>;

async function setWarp(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(([clipId, p]) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.warpStabilizer.updateWarpSettings(clipId as string, p as Record<string, unknown>), [id, patch] as const);
  await expect
    .poll(async () => {
      const warp = (await clipOf(page, id))?.warp ?? {};
      return Object.entries(patch).every(([key, value]) => warp[key] === value);
    })
    .toBe(true);
  await settle(page, 200);
}

test("Warp Stabilizer: background analysis, Result and Framing switches on one analysis, preview equals export", async ({ page }, testInfo) => {
  testInfo.setTimeout(900_000);
  page.on("pageerror", (e) => console.log(`[warp e2e] pageerror: ${e.message.slice(0, 300)}`));
  await openEditor(page);
  const { id, start } = await importShaky(page);
  await clickClip(page, id);
  const times = Array.from({ length: 8 }, (_, k) => start + (10 + k) / 30);
  // frames across the whole clip, where the shake reaches its extremes (borders are uncovered there)
  const spread = Array.from({ length: 12 }, (_, k) => start + (3 + k * 4.5) / 30);
  const frameTimes = [start + 0.3, start + 0.6, start + 0.9, start + 1.2, start + 1.5];

  // as shot
  const plain = await renderBoth(page, times);
  const plainShake = plain.shake;
  console.log(`[warp e2e] shake as shot ${plainShake.toFixed(2)} luma/frame`);
  expect(plainShake).toBeGreaterThan(1.5);

  // analysis in the background: the job is visible while it runs, nothing is baked until it finishes
  const seen = new Set<string>();
  const started = page.evaluate(
    ([clipId]) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.warpStabilizer.startWarpStabilizer(clipId as string, { result: "noMotion", framing: "stabilizeCropAutoScale", cropLessSmoothMore: 100 }),
    [id] as const,
  );
  const deadline = Date.now() + 240_000;
  for (;;) {
    const job = await page.evaluate((clipId) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.warpRegistry.getWarpRegistry().getJob(clipId), id);
    seen.add(job.status);
    const state = await clipOf(page, id);
    if (state?.warpAnalysis) break;
    if (job.status === "failed") throw new Error(`analysis failed: ${JSON.stringify(job)}`);
    if (Date.now() > deadline) throw new Error("analysis did not finish");
    await page.waitForTimeout(100);
  }
  await started;
  console.log(`[warp e2e] job states seen while analysing: ${[...seen].join(", ")}`);
  expect(seen.has("analysing")).toBe(true);
  const analysisBefore = (await clipOf(page, id))!.warpAnalysis!;
  expect(analysisBefore.frameCount).toBeGreaterThan(55);
  await settle(page, 400);

  const shake: Record<string, number> = {};
  const empty: Record<string, number> = {};
  const modes: Array<[string, Record<string, unknown>]> = [
    ["noMotion+autoScale", { result: "noMotion", framing: "stabilizeCropAutoScale" }],
    ["smoothMotion+autoScale", { result: "smoothMotion", framing: "stabilizeCropAutoScale" }],
    ["noMotion+stabilizeOnly", { result: "noMotion", framing: "stabilizeOnly" }],
    ["noMotion+crop", { result: "noMotion", framing: "stabilizeCrop" }],
    ["noMotion+synthesize", { result: "noMotion", framing: "synthesizeEdges" }],
  ];
  for (const [label, patch] of modes) {
    await setWarp(page, id, patch);
    const frames = await renderBoth(page, times);
    const wide = await renderBoth(page, spread);
    const mismatched = [...frames.mismatched, ...wide.mismatched];
    shake[label] = frames.shake;
    empty[label] = wide.emptyFraction;
    console.log(`[warp e2e] ${label}: shake ${shake[label].toFixed(2)}, empty ${(empty[label] * 100).toFixed(2)}%, preview==export-mode ${times.length + spread.length - mismatched.length}/${times.length + spread.length}`);
    expect(mismatched, `${label}: preview and export-mode renders agree`).toEqual([]);
  }
  // the same analysis served every switch
  const analysisAfter = (await clipOf(page, id))!.warpAnalysis!;
  expect(analysisAfter.motion).toEqual(analysisBefore.motion);

  expect(shake["noMotion+autoScale"], "No Motion removes the shake").toBeLessThan(plainShake * 0.35);
  expect(shake["smoothMotion+autoScale"], "Smooth Motion removes shake too").toBeLessThan(plainShake * 0.6);
  expect(empty["noMotion+stabilizeOnly"], "Stabilize Only leaves the uncovered borders empty").toBeGreaterThan(empty["noMotion+autoScale"] + 0.01);
  expect(empty["noMotion+crop"], "Stabilize Crop empties what it crops").toBeGreaterThan(empty["noMotion+autoScale"] + 0.003);
  expect(empty["noMotion+synthesize"], "Synthesize Edges fills borders from neighbouring frames").toBeLessThan(empty["noMotion+stabilizeOnly"] * 0.7);

  // the program monitor shows the stabilized picture: the same clip frame differs from the unstabilized one
  await setWarp(page, id, { result: "noMotion", framing: "stabilizeCropAutoScale" });
  await seek(page, start + 0.5);
  await snapStable(page, "stabilized");
  await page.evaluate((clipId) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.warpStabilizer.setWarpEnabled(clipId, false), id);
  await expect.poll(async () => (await clipOf(page, id))?.enabled).toBe(false);
  await seek(page, start + 0.7);
  await seek(page, start + 0.5);
  await snapStable(page, "plain");
  const diff = await page.evaluate(() => {
    const s = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
    const a = s.stabilized;
    const b = s.plain;
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) changed++;
    return changed / (a.length / 4);
  });
  console.log(`[warp e2e] program monitor stabilized vs plain: ${(diff * 100).toFixed(1)}% of pixels differ`);
  expect(diff, "the monitor shows the stabilized picture").toBeGreaterThan(0.05);

  // Re-enable (the analysis is reused, no second analysis) and compare an exported file with the preview
  await page.evaluate(
    ([clipId]) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.warpStabilizer.startWarpStabilizer(clipId as string, { result: "noMotion", framing: "synthesizeEdges" }),
    [id] as const,
  );
  await expect.poll(async () => (await clipOf(page, id))?.enabled).toBe(true);
  expect((await clipOf(page, id))!.warpAnalysis!.motion).toEqual(analysisBefore.motion);
  const previews = await renderBoth(page, frameTimes, true);
  const first = start + 0.3;
  const exportId = await page.evaluate(
    ([from, count]) => {
      const q = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState();
      const job = q.enqueue({
        settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 4000, range: { startTime: from, endTime: (from as number) + (count as number) / 30 } },
        presetLabel: "Warp Stabilizer",
      });
      if (!job) throw new Error("enqueue returned null");
      q.start();
      return job.id as string;
    },
    [first, 45] as const,
  );
  const outputName = await waitDone(page, exportId);
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
  const file = join(workDir, "warp-export.mp4");
  await download.saveAs(file);
  const raw = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-an", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 512 * 1024 * 1024 });
  const frameBytes = (W * H * 3) / 2;
  const exported: Buffer[] = [];
  for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) exported.push(raw.subarray(off, off + W * H));
  expect(exported.length).toBeGreaterThan(40);
  // preview frames sit at 0, 0.3, 0.6 ... s into the export (frameTimes are 0.3 s apart from `first`)
  const psnrs = previews.lumaFrames.map((bytes, k) => {
    const index = Math.round((frameTimes[k] - first) * 30);
    const lumaPlane = Buffer.from(bytes, "base64");
    let se = 0;
    const e = exported[Math.min(index, exported.length - 1)];
    for (let i = 0; i < W * H; i++) se += (lumaPlane[i] - e[i]) ** 2;
    return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / (W * H)));
  });
  console.log(`[warp e2e] exported file vs preview PSNR per frame: ${psnrs.map((v) => v.toFixed(1)).join(" ")}`);
  expect(Math.min(...psnrs), "the exported frames match the preview").toBeGreaterThan(28);
});

async function waitDone(page: Page, id: string, timeout = 600_000): Promise<string> {
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
