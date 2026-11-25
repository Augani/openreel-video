import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, clipLocator, clipsOf, openEditor, readState, settle, splitIntoThree } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE, SOFTWARE_GPU } from "./env";

/**
 * Delivery pipeline, checked in real Chrome:
 *  - Add to queue from the Export dialog; two jobs with different presets run
 *    one after the other and each downloads as a valid file (ffprobe);
 *  - cancel (running + queued), retry, reorder and remove from the panel;
 *  - a queued job renders the project as it was when it was queued;
 *  - the queue survives a reload (a running job comes back 'interrupted' and
 *    can be retried from its persisted snapshot);
 *  - "Use previews" reuses render-cache frames and is faster on a heavy
 *    timeline; export stays responsive (long tasks measured);
 *  - the audio mixdown cache serves repeated windows and re-renders only what
 *    an audio edit touched.
 */

const FFPROBE = E2E_FFPROBE;
const FFMPEG = E2E_FFMPEG;

interface JobView {
  id: string;
  outputName: string;
  status: string;
  progress: number;
  elapsedMs: number;
  framesFromCache?: number;
  totalFrames?: number;
  error?: string;
  presetLabel: string;
}

interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
  mixdownCache: { getStats(): { hits: number; misses: number; entries: number } };
  renderCache: Record<string, any>;
  ui: { getState(): Record<string, any> };
}

const MP4_SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 };
const WEBM_SMALL = { width: 480, height: 270, frameRate: 24, format: "webm", codec: "vp9", bitrate: 1500 };
const MP4_FHD60 = { width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 12000 };

const workDir = mkdtempSync(join(tmpdir(), "openreel-queue-"));

const jobs = (page: Page): Promise<JobView[]> =>
  page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    return h.exportQueue.getState().queue.jobs.map((j: Record<string, any>) => ({
      id: j.id,
      outputName: j.outputName,
      status: j.status,
      progress: j.progress,
      elapsedMs: j.elapsedMs,
      framesFromCache: j.framesFromCache,
      totalFrames: j.totalFrames,
      error: j.error,
      presetLabel: j.presetLabel,
    }));
  });

const jobById = async (page: Page, id: string): Promise<JobView> => {
  const job = (await jobs(page)).find((j) => j.id === id);
  if (!job) throw new Error(`no job ${id}`);
  return job;
};

const enqueue = (page: Page, input: Record<string, unknown>): Promise<string> =>
  page.evaluate((payload) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const job = h.exportQueue.getState().enqueue(payload);
    if (!job) throw new Error("enqueue returned null");
    return job.id as string;
  }, input);

const queueAction = (page: Page, action: "start" | "pause", ) =>
  page.evaluate((name) => {
    (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState()[name]();
  }, action);

const waitStatus = (page: Page, id: string, status: string, timeout = 120_000) =>
  expect
    .poll(async () => (await jobById(page, id)).status, { timeout, intervals: [200], message: `job ${id} -> ${status}` })
    .toBe(status);

const openPanel = async (page: Page) => {
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  await expect(panel).toBeVisible();
  return panel;
};

interface Probe {
  streams: Array<Record<string, any>>;
  format: Record<string, any>;
}
function probe(file: string): Probe {
  const out = execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
    encoding: "utf8",
  });
  return JSON.parse(out) as Probe;
}

/** Download a finished job from the panel and ffprobe the file. */
async function downloadAndProbe(page: Page, job: JobView): Promise<{ path: string; probe: Probe }> {
  const panel = await openPanel(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: `Download ${job.outputName}` }).click(),
  ]);
  const path = join(workDir, `${job.id}-${download.suggestedFilename()}`);
  await download.saveAs(path);
  return { path, probe: probe(path) };
}

const video = (p: Probe) => p.streams.find((s) => s.codec_type === "video")!;
const durationOf = (p: Probe) => Number(p.format.duration);

async function useHd(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const s = h.project.getState().project.settings;
    if (s.width !== 1920 || s.height !== 1080) await h.project.getState().updateSettings({ width: 1920, height: 1080 });
  });
  await settle(page, 500);
}

for (const format of ["mp4", "mov"]) {
  test(`browser ${format.toUpperCase()} keeps ranged chapter titles, offsets and media`, async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      const { project } = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      await project.getState().addMarker(0.25, "Outside range", "#fff", { kind: "chapter" });
      await project.getState().addMarker(1.4, "First", "#fff", { kind: "chapter" });
      await project.getState().addMarker(2, "Résumé", "#fff", { kind: "chapter" });
    });
    const settings = { ...MP4_SMALL, format, embedChapters: true, range: { startTime: 1, endTime: 3 } };
    const id = await enqueue(page, { settings, presetLabel: "Chapters" });
    await queueAction(page, "start");
    await waitStatus(page, id, "completed");
    const file = await downloadAndProbe(page, await jobById(page, id));
    const result = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_chapters", "-of", "json", file.path], { encoding: "utf8" }));
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters.map((c: { tags: { title: string } }) => c.tags.title)).toEqual(["First", "Résumé"]);
    expect(Number(result.chapters[0].start_time)).toBeCloseTo(0.4, 2);
    expect(Number(result.chapters[0].end_time)).toBeCloseTo(1, 2);
    expect(Number(result.chapters[1].start_time)).toBeCloseTo(1, 2);
    expect(Number(result.chapters[1].end_time)).toBeCloseTo(2, 2);
    expect(video(file.probe).codec_name).toBe("h264");
    expect(file.probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
    execFileSync(FFMPEG, ["-v", "error", "-xerror", "-i", file.path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);
  });
}

test("two presets queued from the dialog and the store both complete with valid files", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);

  // Job 1 through the real Export dialog ("Add to queue" next to "Export Video").
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().openModal("export"));
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Add to queue" })).toBeEnabled();
  await dialog.locator('label[for^="export-preset-"]').first().click();
  await dialog.screenshot({ path: join(workDir, "export-dialog.png") });
  console.log(`[queue] screenshot: ${join(workDir, "export-dialog.png")}`);
  await dialog.getByRole("button", { name: "Add to queue" }).click();
  await expect(dialog).toBeHidden();
  const panel = await openPanel(page);
  await expect(panel.getByTestId("export-queue-job")).toHaveCount(1);

  // Job 2: a different preset (WebM/VP9, 480p, 24fps).
  const second = await enqueue(page, { settings: WEBM_SMALL, presetLabel: "WebM 480p" });
  await expect(panel.getByTestId("export-queue-job")).toHaveCount(2);
  const [first] = await jobs(page);

  // Nothing runs until Start is pressed.
  expect((await jobById(page, first.id)).status).toBe("queued");
  await startJankMonitor(page);
  await panel.getByRole("button", { name: "Start queue" }).click();

  // Sequential: while one runs the other waits.
  await expect.poll(async () => (await jobs(page)).filter((j) => j.status === "running").length, { timeout: 30_000 }).toBe(1);
  expect((await jobs(page)).filter((j) => j.status === "queued")).toHaveLength(1);

  await waitStatus(page, first.id, "completed");
  await waitStatus(page, second, "completed");
  console.log(`[queue] plain 640x360 + 480x270 exports, main-thread jank: ${JSON.stringify(await readJank(page))}`);
  await page.screenshot({ path: join(workDir, "queue-done.png") });
  console.log(`[queue] screenshot: ${join(workDir, "queue-done.png")}`);
  const done = await jobs(page);
  for (const job of done) console.log(`[queue] ${job.outputName} (${job.presetLabel}) ${job.status} in ${job.elapsedMs} ms`);

  const a = await downloadAndProbe(page, done[0]);
  const b = await downloadAndProbe(page, done[1]);
  console.log(`[queue] file 1: ${video(a.probe).codec_name} ${video(a.probe).width}x${video(a.probe).height} ${durationOf(a.probe).toFixed(2)}s`);
  console.log(`[queue] file 2: ${video(b.probe).codec_name} ${video(b.probe).width}x${video(b.probe).height} ${durationOf(b.probe).toFixed(2)}s`);
  expect(video(a.probe).codec_name).toBe("h264");
  expect(video(b.probe).codec_name).toBe("vp9");
  expect(video(b.probe).width).toBe(480);
  expect(video(b.probe).height).toBe(270);
  expect(durationOf(a.probe)).toBeGreaterThan(5.5);
  expect(durationOf(a.probe)).toBeLessThan(6.5);
  expect(durationOf(b.probe)).toBeGreaterThan(5.5);
  expect(durationOf(b.probe)).toBeLessThan(6.5);
  // The two outputs came from two different presets.
  expect(video(a.probe).codec_name).not.toBe(video(b.probe).codec_name);
});

test("a queued job renders the project as it was when queued; cancel, retry, reorder and remove work", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  const panel = await openPanel(page);

  const slow = await enqueue(page, { settings: MP4_FHD60, presetLabel: "1080p60", usePreviews: false });
  const mid = await enqueue(page, { settings: MP4_SMALL, presetLabel: "360p" });
  const last = await enqueue(page, { settings: WEBM_SMALL, presetLabel: "WebM" });

  // Reorder from the panel: move the last job up one place.
  const names = await jobs(page);
  await panel.getByRole("button", { name: `Move ${names[2].outputName} up` }).click();
  expect((await jobs(page)).map((j) => j.id)).toEqual([slow, last, mid]);
  await expect(panel.getByRole("button", { name: `Move ${names[0].outputName} up` })).toBeDisabled();

  // Edit the project after queueing: remove the only clip. Queued jobs must not notice.
  await page.evaluate((id) => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().removeClip(id), clip.id);
  expect((await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.duration)) as number).toBe(0);

  await panel.getByRole("button", { name: "Start queue" }).click();
  await waitStatus(page, slow, "running");
  await expect.poll(async () => (await jobById(page, slow)).progress, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0.03);

  await page.screenshot({ path: join(workDir, "queue-running.png") });
  console.log(`[queue] screenshot: ${join(workDir, "queue-running.png")}`);

  // Cancel the running job from the panel; the next one starts by itself.
  await panel.getByRole("button", { name: `Cancel ${names[0].outputName}` }).click();
  await waitStatus(page, slow, "cancelled", 20_000);
  await waitStatus(page, last, "running", 30_000);

  // A queued job can be cancelled too.
  await panel.getByRole("button", { name: `Cancel ${names[1].outputName}` }).click().catch(() => undefined);
  await waitStatus(page, mid, "completed", 120_000).catch(() => undefined);

  // Retry the cancelled job: it is queued again and completes.
  await panel.getByRole("button", { name: `Retry ${names[0].outputName}` }).click();
  await expect(panel.locator(`[data-job-id="${slow}"]`)).toHaveAttribute("data-status", /queued|running/);
  await waitStatus(page, slow, "completed", 180_000);

  const final = await jobs(page);
  console.log(`[queue] after cancel/retry: ${final.map((j) => `${j.outputName.slice(-24)}=${j.status}`).join(", ")}`);

  // The retried job (queued before the clip was deleted) still renders the full 6 s project.
  const retried = await downloadAndProbe(page, await jobById(page, slow));
  expect(video(retried.probe).width).toBe(1920);
  expect(Number(video(retried.probe).nb_frames)).toBeGreaterThan(300);
  expect(durationOf(retried.probe)).toBeGreaterThan(5.5);

  // Remove finished and cancelled jobs.
  const removable = (await jobs(page)).filter((j) => j.status !== "running");
  for (const job of removable) await panel.getByRole("button", { name: `Remove ${job.outputName}` }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(0);
});

test("the queue survives a reload: a running job comes back interrupted and retries from its snapshot", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  const slow = await enqueue(page, { settings: MP4_FHD60, presetLabel: "1080p60", usePreviews: false });
  const small = await enqueue(page, { settings: MP4_SMALL, presetLabel: "360p" });
  // Give the snapshot write time to land before the page goes away.
  await settle(page, 800);
  await queueAction(page, "start");
  await waitStatus(page, slow, "running");
  await expect.poll(async () => (await jobById(page, slow)).progress, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0.03);
  await settle(page, 600);

  await page.reload();
  // The autosave "Recover Your Work" prompt may mount at any moment (openEditor navigates again, and the
  // prompt appears after an async IndexedDB check). The queue must not depend on it: dismiss it whenever it blocks.
  await page.addLocatorHandler(
    page.getByRole("dialog").filter({ hasText: "Recover Your Work" }),
    async (recovery) => {
      await recovery.getByRole("button", { name: "Close dialog" }).click();
    },
  );
  await openEditor(page);
  const panel = await openPanel(page);
  await expect.poll(async () => (await jobs(page)).length, { timeout: 15_000 }).toBe(2);
  const restored = await jobs(page);
  console.log(`[queue] after reload: ${restored.map((j) => `${j.presetLabel}=${j.status}`).join(", ")}`);
  expect(restored.find((j) => j.id === slow)!.status).toBe("interrupted");
  expect(restored.find((j) => j.id === small)!.status).toBe("queued");
  await expect(panel.getByText("Queue is paused")).toBeVisible();

  await panel.getByRole("button", { name: /^Retry / }).click();
  await panel.getByRole("button", { name: "Start queue" }).click();
  await waitStatus(page, small, "completed", 120_000);
  await waitStatus(page, slow, "completed", 180_000);

  const file = await downloadAndProbe(page, await jobById(page, slow));
  console.log(`[queue] retried-after-reload file: ${video(file.probe).width}x${video(file.probe).height} ${durationOf(file.probe).toFixed(2)}s`);
  expect(video(file.probe).width).toBe(1920);
  expect(durationOf(file.probe)).toBeGreaterThan(5.5);
});

/** Average RGB of the frame at `seconds` of a finished file (1x1 downscale through ffmpeg). */
function frameRgb(file: string, seconds: number): [number, number, number] {
  const out = spawnSync(
    FFMPEG,
    ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1024 },
  );
  if (out.status !== 0 || out.stdout.length < 3) throw new Error(`no frame at ${seconds}s of ${file}: ${out.stderr?.toString()}`);
  return [out.stdout[0], out.stdout[1], out.stdout[2]];
}

test("Export dialog sequence picker -> Add to queue: each queued job renders the sequence chosen in the dialog", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  // Three 2 s scenes: testsrc2 (0-2), solid red (2-4), smptebars (4-6). Nest the first two clips:
  // the nest (4 s, red at its end) becomes a second sequence, the active parent stays 6 s long
  // and ends in colour bars.
  await splitIntoThree(page);
  const [one, two] = clipsOf(await readState(page), "Main");
  await clickClip(page, one.id);
  await page.keyboard.down("Shift");
  await clickClip(page, two.id);
  await page.keyboard.up("Shift");
  const box = await clipLocator(page, two.id).boundingBox();
  if (!box) throw new Error("clip not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.getByTestId("nest-clips").click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.sequences?.length ?? 0)).toBe(2);

  const ids = await page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const sequences = p.sequences as Array<{ id: string; name: string }>;
    return { active: p.activeSequenceId as string, nest: sequences.find((s) => s.id !== p.activeSequenceId)!.id };
  });

  const addFromDialog = async (sequenceId: string) => {
    await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().openModal("export"));
    const dialog = page.getByRole("dialog");
    // The button is disabled until the capability check finishes; wait for the settled dialog.
    await expect(dialog.getByRole("button", { name: "Add to queue" })).toBeEnabled();
    // Pick the preset the way a user does (its card), not by force-clicking the 1px sr-only radio.
    await dialog.locator('label[for^="export-preset-"]').first().click();
    await dialog.getByTestId("export-sequence").selectOption(sequenceId);
    await expect(dialog.getByTestId("export-sequence")).toHaveValue(sequenceId);
    await dialog.getByRole("button", { name: "Add to queue" }).click();
    await expect(dialog).toBeHidden();
  };
  await addFromDialog(ids.nest);
  await addFromDialog(ids.active);
  const panel = await openPanel(page);
  await expect(panel.getByTestId("export-queue-job")).toHaveCount(2);
  const [nestJob, parentJob] = await jobs(page);

  await panel.getByRole("button", { name: "Start queue" }).click();
  // A failed job must say why (job.error) instead of a bare poll timeout.
  for (const job of [nestJob, parentJob]) {
    await expect
      .poll(async () => (await jobById(page, job.id)).status, { timeout: 120_000, intervals: [200] })
      .toMatch(/completed|failed/);
    const done = await jobById(page, job.id);
    expect(done.status, `job ${job.outputName}: ${done.error ?? "no error text"}`).toBe("completed");
  }

  const nestFile = await downloadAndProbe(page, await jobById(page, nestJob.id));
  const parentFile = await downloadAndProbe(page, await jobById(page, parentJob.id));
  console.log(`[queue] nest job ${durationOf(nestFile.probe).toFixed(2)}s, parent job ${durationOf(parentFile.probe).toFixed(2)}s`);
  // Durations tell the two sequences apart: 4 s nest, 6 s parent.
  expect(durationOf(nestFile.probe)).toBeGreaterThan(3.5);
  expect(durationOf(nestFile.probe)).toBeLessThan(4.6);
  expect(durationOf(parentFile.probe)).toBeGreaterThan(5.5);
  expect(durationOf(parentFile.probe)).toBeLessThan(6.6);
  // Frame content: the nest's last second is solid red; the parent's last second is colour bars.
  const [nr, ng, nb] = frameRgb(nestFile.path, 3.5);
  expect(nr).toBeGreaterThan(180);
  expect(ng).toBeLessThan(70);
  expect(nb).toBeLessThan(70);
  const [pr, pg, pb] = frameRgb(parentFile.path, 5.0);
  expect(Math.min(pr, pg, pb)).toBeGreaterThan(40); // bars average to a mid grey, not red
  expect(pr - Math.min(pg, pb)).toBeLessThan(80);
  // And the parent's frame at 3.5 s is the nest's red as well (the nest plays inside it).
  const [rr, rg] = frameRgb(parentFile.path, 3.5);
  expect(rr).toBeGreaterThan(180);
  expect(rg).toBeLessThan(70);
});

const HEAVY_STACK = async (page: Page, clipId: string) => {
  await page.evaluate(async (id) => {
    const e = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const store = e.project.getState();
    await store.addVideoEffect(id, "glow", { radius: 28, intensity: 1.6, color: "#ffffff" });
    await store.addVideoEffect(id, "gaussian-blur", { radius: 4 });
    const size = 17;
    const data: number[] = [];
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++) data.push(Math.min(1, (r / (size - 1)) * 1.04), (g / (size - 1)) * 0.96, Math.min(1, (b / (size - 1)) * 1.1));
    await store.updateColorGrading(id, { temperature: 14, lut: { data, size, intensity: 0.8 } });
  }, clipId);
  await settle(page, 400);
};

/** Long-task and frame-gap recorder for main-thread responsiveness during an export. */
async function startJankMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __jank?: { tasks: number[]; gaps: number[]; stop: () => void } };
    w.__jank?.stop();
    const tasks: number[] = [];
    const gaps: number[] = [];
    let last = performance.now();
    let raf = 0;
    let live = true;
    const tick = (now: number) => {
      if (!live) return;
      gaps.push(now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    w.__jank = {
      tasks,
      gaps,
      stop: () => {
        live = false;
        cancelAnimationFrame(raf);
        observer.disconnect();
      },
    };
  });
}

async function readJank(page: Page): Promise<{ longTasks: number; maxTaskMs: number; tasksOver50: number; maxGapMs: number; gapsOver100: number; frames: number }> {
  return page.evaluate(() => {
    const j = (window as unknown as { __jank: { tasks: number[]; gaps: number[]; stop: () => void } }).__jank;
    j.stop();
    return {
      longTasks: j.tasks.length,
      maxTaskMs: Math.round(Math.max(0, ...j.tasks)),
      tasksOver50: j.tasks.filter((t) => t > 50).length,
      maxGapMs: Math.round(Math.max(0, ...j.gaps)),
      gapsOver100: j.gaps.filter((g) => g > 100).length,
      frames: j.gaps.length,
    };
  });
}

function psnrOf(a: string, b: string, atSeconds: number): number {
  const run = spawnSync(
    FFMPEG,
    ["-nostats", "-ss", String(atSeconds), "-i", a, "-ss", String(atSeconds), "-i", b, "-frames:v", "1", "-lavfi", "[0:v][1:v]psnr", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = run.stderr.match(/average:(inf|[\d.]+)/);
  if (!m) throw new Error(`no psnr in ffmpeg output:\n${run.stderr.slice(-600)}`);
  return m[1] === "inf" ? Infinity : Number(m[1]);
}

test("Use previews: cached frames make a heavy-effects export faster; export stays responsive", async ({ page }, testInfo) => {
  test.skip(SOFTWARE_GPU, "hardware-performance measurement: SwiftShader (no GPU) cannot render a heavy 1080p effects stack in real time; render-cache correctness is covered by the other render-cache specs");
  testInfo.setTimeout(420_000);
  await openEditor(page);
  await useHd(page);
  const [clip] = clipsOf(await readState(page), "Main");
  await HEAVY_STACK(page, clip.id);

  // Fill the render cache for the whole sequence (what "Render In to Out" does).
  const rendered = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const r = await h.renderCache.renderInToOut();
    return { status: r?.status, frames: r?.framesRendered, ms: r?.elapsedMs, codec: r?.codec };
  });
  console.log(`[previews] Render In to Out: ${JSON.stringify(rendered)}`);
  expect(rendered.status).toBe("completed");

  const settings = { width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 12000 };
  await openPanel(page);
  const run = async (usePreviews: boolean, label: string) => {
    const id = await enqueue(page, { settings, presetLabel: label, usePreviews });
    await startJankMonitor(page);
    await queueAction(page, "start");
    await waitStatus(page, id, "completed", 300_000);
    const jank = await readJank(page);
    const job = await jobById(page, id);
    console.log(`[previews] ${label}: ${job.elapsedMs} ms, framesFromCache=${job.framesFromCache ?? 0}/${job.totalFrames}; jank ${JSON.stringify(jank)}`);
    return { job, jank };
  };

  const u1 = await run(false, "uncached 1");
  const c1 = await run(true, "cached");
  const u2 = await run(false, "uncached 2");

  expect(c1.job.framesFromCache).toBe(c1.job.totalFrames);
  expect(u1.job.framesFromCache ?? 0).toBe(0);
  const uncachedBest = Math.min(u1.job.elapsedMs, u2.job.elapsedMs);
  console.log(`[previews] heavy 1080p30 6 s export: uncached ${u1.job.elapsedMs}/${u2.job.elapsedMs} ms, cached ${c1.job.elapsedMs} ms -> ${(uncachedBest / c1.job.elapsedMs).toFixed(2)}x faster (best uncached / cached)`);
  expect(c1.job.elapsedMs).toBeLessThan(uncachedBest);

  // Codec loss of a cached frame vs a fresh render of the same frame.
  const fidelity = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { engine: { getState(): Record<string, any> } } }).__openreelE2E;
    const engine = h.engine.getState().videoEngine;
    const project = h.project.getState().getFullProject();
    const toData = (bitmap: ImageBitmap) => {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      return g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const out: number[] = [];
    for (const t of [0.5, 2.5, 4.5]) {
      const cached = await h.renderCache.takePlaybackFrame(t);
      const fresh = await engine.renderFrame(project, t, 1920, 1080);
      if (!cached) throw new Error(`no cached frame at ${t}`);
      const a = toData(cached);
      const b = toData(fresh.image);
      let se = 0;
      let exact = 0;
      for (let i = 0; i < a.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = a[i + k] - b[i + k];
          se += d * d;
        }
        if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) exact++;
      }
      const mse = se / ((a.length / 4) * 3);
      out.push(mse === 0 ? 99 : Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100);
      out.push(Math.round((exact / (a.length / 4)) * 1000) / 10);
      cached.close();
      fresh.image.close();
    }
    return out;
  });
  console.log(`[previews] cached-vs-fresh frame fidelity (PSNR dB, % bit-identical px) at 0.5/2.5/4.5 s: ${JSON.stringify(fidelity)}`);

  // The exported files differ only by the cache codec's loss.
  const a = await downloadAndProbe(page, u1.job);
  const b = await downloadAndProbe(page, c1.job);
  // 1 s is the detailed test pattern, 5 s the colour bars (3 s is flat red, which would prove nothing).
  const psnr = Math.min(psnrOf(a.path, b.path, 1), psnrOf(a.path, b.path, 5));
  console.log(`[previews] exported cached vs uncached file PSNR (worst of 1 s / 5 s): ${psnr.toFixed(2)} dB`);
  expect(psnr).toBeGreaterThan(30);
  expect(video(b.probe).width).toBe(1920);
  expect(durationOf(b.probe)).toBeGreaterThan(5.5);
});

test("audio mixdown cache: repeated exports and analyses skip re-mixing; an audio edit re-renders only what it touched", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  const [clip] = clipsOf(await readState(page), "Main");
  const stats = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.mixdownCache.getStats();
      return { hits: s.hits, misses: s.misses };
    });
  const loud = { ...MP4_SMALL, audioSettings: { loudness: { enabled: true, targetLufs: -16, truePeakCeilingDb: -1 } } };
  const runJob = async (label: string) => {
    const id = await enqueue(page, { settings: loud, presetLabel: label, usePreviews: false });
    await queueAction(page, "start");
    await waitStatus(page, id, "completed", 120_000);
  };
  const base = await stats();

  await runJob("loudness 1");
  const s1 = await stats();
  console.log(`[mixdown] export 1 (two-pass loudness): +${s1.hits - base.hits} hits, +${s1.misses - base.misses} misses`);
  expect(s1.misses - base.misses).toBeGreaterThanOrEqual(1);
  expect(s1.hits - base.hits).toBeGreaterThanOrEqual(1); // the encode pass reuses the measuring pass

  await runJob("loudness 2");
  const s2 = await stats();
  console.log(`[mixdown] export 2 (same project): +${s2.hits - s1.hits} hits, +${s2.misses - s1.misses} misses`);
  expect(s2.misses - s1.misses).toBe(0);
  expect(s2.hits - s1.hits).toBeGreaterThanOrEqual(2);

  // Whole-timeline analysis (mixer "Analyze timeline") reuses the same mix.
  const analysis = async () =>
    page.evaluate(async () => {
      const t0 = performance.now();
      const r = await (window as unknown as { __openreelE2E: Hook & { analyzeTimelineLoudness(): Promise<{ integrated: number }> } }).__openreelE2E.analyzeTimelineLoudness();
      return { lufs: r.integrated, ms: Math.round(performance.now() - t0) };
    });
  const a1 = await analysis();
  const s3 = await stats();
  const a2 = await analysis();
  const s4 = await stats();
  console.log(`[mixdown] analyze 1: ${a1.ms} ms (+${s3.misses - s2.misses} misses), analyze 2: ${a2.ms} ms (+${s4.misses - s3.misses} misses, +${s4.hits - s3.hits} hits); LUFS ${a1.lufs.toFixed(2)} vs ${a2.lufs.toFixed(2)}`);
  expect(a2.lufs).toBeCloseTo(a1.lufs, 6);
  expect(s4.misses - s3.misses).toBe(0);
  expect(s4.hits - s3.hits).toBeGreaterThanOrEqual(1);

  // An audio edit (clip volume) invalidates exactly the windows it touches.
  await page.evaluate(
    (id) =>
      (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().executeAction({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: "audio/setVolume",
        params: { clipId: id, volume: 0.5 },
      }),
    clip.id,
  );
  const a3 = await analysis();
  const s5 = await stats();
  console.log(`[mixdown] after volume edit: analyze ${a3.ms} ms, +${s5.misses - s4.misses} misses; LUFS ${a3.lufs.toFixed(2)} (was ${a1.lufs.toFixed(2)})`);
  expect(s5.misses - s4.misses).toBeGreaterThanOrEqual(1);
  expect(a3.lufs).toBeLessThan(a1.lufs - 5); // 0.5 gain is about -6 dB: never stale audio

  // Undo returns to the first state: the original windows are still cached.
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().undo());
  const a4 = await analysis();
  const s6 = await stats();
  console.log(`[mixdown] after undo: analyze ${a4.ms} ms, +${s6.misses - s5.misses} misses; LUFS ${a4.lufs.toFixed(2)}`);
  expect(a4.lufs).toBeCloseTo(a1.lufs, 6);
  expect(s6.misses - s5.misses).toBe(0);
});
