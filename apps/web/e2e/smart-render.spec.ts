import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_PATH } from "./global-setup";
import { clickClip, clipsOf, openEditor, openHookPage, press, programMean, readState, seek, settle, splitIntoThree, undo } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE, SOFTWARE_GPU } from "./env";

/**
 * Smart render + export isolation, checked in real Chrome.
 *
 * The fixture is 3 x 2 s scenes, 640x360 @ 30 fps H.264 (key frame every 15
 * frames, closed GOPs). The clip is split into three and Vignette is applied to
 * the middle one, so 0-2 s and 4-6 s are untouched runs of the source and 2-4 s
 * must be re-encoded. The same timeline is exported twice through the real
 * queue: with smart render and with it off (full re-encode).
 *
 *  - the report says "Smart render: N% copied" with N > 0;
 *  - both files are valid (ffprobe) with the same frame count and duration;
 *  - frames inside the copied runs are bit-identical to the source (PSNR inf);
 *  - frames across both cut points match the full re-encode, so the cut is
 *    frame-exact (no repeated / dropped / shifted frame);
 *  - audio and video start times and the A/V offset equal the full re-encode's;
 *  - the live preview engine is never put in export mode, and after a queued
 *    export (with the editor edited meanwhile) it renders what it rendered before.
 */

const FFPROBE = E2E_FFPROBE;
const FFMPEG = E2E_FFMPEG;
const MP4_SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 };
const CARD_SUFFIX = ". Drag onto a clip to apply, or double-click to apply to selected clip.";
const workDir = mkdtempSync(join(tmpdir(), "openreel-smart-"));

interface Hook {
  project: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
  video: { getVideoEngine(): { exportMode: boolean } };
}

const enqueue = (page: Page, input: Record<string, unknown>): Promise<string> =>
  page.evaluate((payload) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const job = h.exportQueue.getState().enqueue(payload);
    if (!job) throw new Error("enqueue returned null");
    return job.id as string;
  }, input);

const job = (page: Page, id: string) =>
  page.evaluate((jobId) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const j = h.exportQueue.getState().queue.jobs.find((x: Record<string, any>) => x.id === jobId);
    return j
      ? { status: j.status, outputName: j.outputName, elapsedMs: j.elapsedMs as number, smartRender: j.smartRender as { copiedPercent: number; summary: string } | undefined, error: j.error as string | undefined }
      : null;
  }, id);

async function waitDone(page: Page, id: string, onTick?: () => Promise<void>, timeout = 300_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const j = await job(page, id);
    if (!j) throw new Error(`no job ${id}`);
    if (j.status === "completed") return;
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`job ${id} ${j.status}: ${j.error}`);
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish in ${timeout}ms (${j.status})`);
    await onTick?.();
    await page.waitForTimeout(250);
  }
}

async function download(page: Page, outputName: string, as: string): Promise<string> {
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: `Download ${outputName}` }).click(),
  ]);
  const path = join(workDir, as);
  await dl.saveAs(path);
  return path;
}

function probe(file: string, extra: string[] = []): Record<string, any> {
  return JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", ...extra, file], { encoding: "utf8" }));
}

const stream = (p: Record<string, any>, type: string) => p.streams.find((s: Record<string, any>) => s.codec_type === type);

/**
 * Luma planes of every decoded frame, straight from the decoder (yuv420p, no
 * colour conversion: a range tag that differs between runs must not change pixels).
 */
function grayFrames(file: string): Buffer[] {
  const W = 640;
  const H = 360;
  const frameBytes = (W * H * 3) / 2;
  const raw = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-an", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 768 * 1024 * 1024 });
  const frames: Buffer[] = [];
  for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) frames.push(raw.subarray(off, off + W * H));
  return frames;
}

/** Per-frame PSNR (dB) of two files' video, frame i against frame i. */
function psnrPerFrame(a: string, b: string): number[] {
  const fa = grayFrames(a);
  const fb = grayFrames(b);
  const n = Math.min(fa.length, fb.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < fa[i].length; j++) {
      const d = fa[i][j] - fb[i][j];
      sum += d * d;
    }
    const mse = sum / fa[i].length;
    out.push(mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse));
  }
  return out;
}

/** First/last packet pts of a stream, seconds. */
function packetSpan(file: string, selector: string): { first: number; last: number; count: number } {
  const out = JSON.parse(
    execFileSync(FFPROBE, ["-v", "error", "-select_streams", selector, "-show_entries", "packet=pts_time", "-of", "json", file], { encoding: "utf8" }),
  ) as { packets: Array<{ pts_time?: string }> };
  const times = out.packets.map((p) => Number(p.pts_time)).filter(Number.isFinite).sort((x, y) => x - y);
  return { first: times[0], last: times[times.length - 1], count: times.length };
}

async function setUpTimeline(page: Page): Promise<void> {
  await openEditor(page);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const s = h.project.getState().project.settings;
    if (s.width !== 640 || s.height !== 360) await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  await splitIntoThree(page);
  const [, middle] = clipsOf(await readState(page), "Main");
  await clickClip(page, middle.id);
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await settle(page, 800);
  const card = page.locator(`button[aria-label="Vignette${CARD_SUFFIX}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await settle(page, 1200);
  expect(clipsOf(await readState(page), "Main")[1].effects).toBe(1);
}

test("smart render copies untouched runs frame-exactly and re-encodes the effect segment", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  await setUpTimeline(page);

  const smartId = await enqueue(page, { settings: { ...MP4_SMALL }, presetLabel: "Smart" });
  const fullId = await enqueue(page, { settings: { ...MP4_SMALL, smartRender: false }, presetLabel: "Full re-encode" });
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().start());
  await waitDone(page, smartId);
  await waitDone(page, fullId);
  const smart = (await job(page, smartId))!;
  const full = (await job(page, fullId))!;

  // The report.
  console.log(`[smart-render] smart job ${smart.elapsedMs} ms, full job ${full.elapsedMs} ms, report: ${smart.smartRender?.summary}`);
  expect(smart.smartRender, "smart-render report on the job").toBeTruthy();
  expect(smart.smartRender!.copiedPercent).toBeGreaterThan(0);
  expect(smart.smartRender!.summary).toMatch(/^Smart render: \d+% copied$/);
  expect(full.smartRender?.copiedPercent ?? 0).toBe(0);
  await page.getByRole("button", { name: "Export queue", exact: true }).click();
  await expect(page.getByTestId("export-queue-panel")).toContainText("Smart render:");

  const smartFile = await download(page, smart.outputName, "smart.mp4");
  const fullFile = await download(page, full.outputName, "full.mp4");

  // Valid files with the same shape.
  const sp = probe(smartFile);
  const fp = probe(fullFile);
  expect(stream(sp, "video").codec_name).toBe("h264");
  expect(stream(sp, "audio")).toBeTruthy();
  const countFrames = (file: string) =>
    Number(stream(probe(file, ["-count_frames", "-select_streams", "v:0"]), "video").nb_read_frames);
  const nSmart = countFrames(smartFile);
  const nFull = countFrames(fullFile);
  expect(nSmart).toBe(nFull);
  expect(nSmart).toBe(180);
  expect(Math.abs(Number(sp.format.duration) - Number(fp.format.duration))).toBeLessThan(0.05);
  // The whole file must decode without errors.
  const decodeErrors = execFileSync(FFMPEG, ["-v", "error", "-i", smartFile, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  expect(decodeErrors.trim()).toBe("");
  // Seeking into the middle of any run must decode too: a copied run's later key frames carry the
  // source's SPS/PPS in-band (the file-level avcC describes the first run only).
  for (const at of [1, 2.5, 4, 5, 5.5]) {
    const seekErrors = execFileSync(FFMPEG, ["-v", "error", "-ss", String(at), "-i", smartFile, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(seekErrors.trim(), `seek decode at ${at}s`).toBe("");
  }

  // Copied runs are bit-identical to the source (frames 0..59 and 120..179 minus the GOP edges).
  const vsSource = psnrPerFrame(smartFile, FIXTURE_PATH);
  const copiedA = vsSource.slice(0, 60);
  const copiedB = vsSource.slice(120, 180);
  console.log(`[smart-render] copied-run PSNR vs source: min A=${Math.min(...copiedA).toFixed(1)} min B=${Math.min(...copiedB).toFixed(1)}`);
  expect(Math.min(...copiedA)).toBeGreaterThan(90);
  expect(Math.min(...copiedB)).toBeGreaterThan(90);

  // Frame-exact at both cut points. Copied frames are bit-identical to the source on the
  // copy side (frames 59 and 120), and the re-rendered side (frames 60 and 119) is the same
  // picture as the full re-encode's frame at that index, so nothing is shifted, dropped or repeated.
  const vsFull = psnrPerFrame(smartFile, fullFile);
  const effect = vsFull.slice(60, 120);
  console.log(`[smart-render] PSNR vs full re-encode, effect run 60..119: min ${Math.min(...effect).toFixed(1)} dB`);
  console.log(`[smart-render] cut 2.0s: frame 59 vs source ${vsSource[59]} dB, frame 60 vs full ${vsFull[60].toFixed(1)} dB; cut 4.0s: frame 119 vs full ${vsFull[119].toFixed(1)} dB, frame 120 vs source ${vsSource[120]} dB`);
  expect(vsSource[59]).toBe(Infinity);
  expect(vsSource[120]).toBe(Infinity);
  expect(Math.min(...effect)).toBeGreaterThan(40);
  // The effect run really differs from the source (it was rendered, not copied).
  expect(Math.max(...vsSource.slice(60, 120))).toBeLessThan(40);

  // Audio stays in sync: same start times and the same A/V offset as the full re-encode.
  const sv = packetSpan(smartFile, "v:0");
  const fv = packetSpan(fullFile, "v:0");
  const sa = packetSpan(smartFile, "a:0");
  const fa = packetSpan(fullFile, "a:0");
  const offsetSmart = sa.first - sv.first;
  const offsetFull = fa.first - fv.first;
  console.log(`[smart-render] A/V first-packet offset smart=${(offsetSmart * 1000).toFixed(2)} ms full=${(offsetFull * 1000).toFixed(2)} ms; end smart v=${sv.last.toFixed(3)} a=${sa.last.toFixed(3)} full v=${fv.last.toFixed(3)} a=${fa.last.toFixed(3)}`);
  expect(Math.abs(offsetSmart - offsetFull)).toBeLessThan(0.002);
  expect(Math.abs(sv.last - fv.last)).toBeLessThan(0.002);
  expect(Math.abs(sa.last - fa.last)).toBeLessThan(0.03);
  writeFileSync(testInfo.outputPath("smart-render-report.json"), JSON.stringify({ smartMs: smart.elapsedMs, fullMs: full.elapsedMs, report: smart.smartRender, offsetSmartMs: offsetSmart * 1000, offsetFullMs: offsetFull * 1000 }, null, 2));
});

test("a queued export never touches the live preview engine, even with the editor edited meanwhile", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  await setUpTimeline(page);
  const exportMode = () => page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.video.getVideoEngine().exportMode);

  // Queue the project WITH the effect, then undo the effect in the live editor:
  // the snapshot and the live project now differ, which is the path that used to swap the live engines.
  const id = await enqueue(page, { settings: { ...MP4_SMALL }, presetLabel: "Isolation" });
  await undo(page);
  expect(clipsOf(await readState(page), "Main")[1].effects).toBe(0);
  await seek(page, 3.0);
  const before = await programMean(page);
  expect(await exportMode()).toBe(false);

  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().start());
  let sawExportMode = false;
  await waitDone(page, id, async () => {
    if (await exportMode()) sawExportMode = true;
  });
  expect(sawExportMode, "the live video engine was in export mode during a queued job").toBe(false);

  // After: playhead and pixels are what they were; the queued file has the effect the live editor no longer has.
  await seek(page, 3.0);
  const after = await programMean(page);
  console.log(`[isolation] live program mean before=${before.map((v) => v.toFixed(2))} after=${after.map((v) => v.toFixed(2))}`);
  for (let i = 0; i < 3; i++) expect(Math.abs(after[i] - before[i])).toBeLessThan(0.75);
  expect(await exportMode()).toBe(false);
  expect(clipsOf(await readState(page), "Main")[1].effects).toBe(0);
  const locked = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook & { timeline: { getState(): Record<string, any> } } }).__openreelE2E.timeline.getState().playbackLockedReason);
  expect(locked, "editor left locked after the job").toBeNull();
  await settle(page, 300);
});

test("on a long timeline with one 2 s effect, smart render is much faster than a full re-encode", async ({ page }, testInfo) => {
  testInfo.setTimeout(SOFTWARE_GPU ? 480_000 : 900_000);
  // The full re-encode being compared against is a throughput measurement: 90 s (2,700 frames) took 8.6
  // minutes on a CPU-only runner. 30 s keeps the same shape (one 2 s effect, copied runs on both sides, a
  // smart render that is a small fraction of the full re-encode) at a third of the cost.
  const SECONDS = SOFTWARE_GPU ? 30 : 90;
  const longFile = join(workDir, `long-${SECONDS}s.mp4`);
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    "-c:v", "libx264", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", longFile,
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* the tour just shows */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.locator('input[type="file"]').first().setInputFiles(longFile);
  await page.getByLabel(`Select media long-${SECONDS}s.mp4`).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: `Media actions for long-${SECONDS}s.mp4` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const st = h.project.getState().project.settings;
    if (st.width !== 640 || st.height !== 360) await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  await splitIntoThree(page); // cuts at 2 s and 4 s
  const [, middle] = clipsOf(await readState(page), "Main");
  await clickClip(page, middle.id);
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await settle(page, 800);
  const card = page.locator(`button[aria-label="Vignette${CARD_SUFFIX}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await settle(page, 1200);

  const smartId = await enqueue(page, { settings: { ...MP4_SMALL }, presetLabel: `Smart ${SECONDS}s` });
  const fullId = await enqueue(page, { settings: { ...MP4_SMALL, smartRender: false }, presetLabel: `Full ${SECONDS}s` });
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().start());
  await waitDone(page, smartId, undefined, 600_000);
  await waitDone(page, fullId, undefined, 600_000);
  const smart = (await job(page, smartId))!;
  const full = (await job(page, fullId))!;
  console.log(`[smart-render-${SECONDS}s] smart ${smart.elapsedMs} ms (${smart.smartRender?.summary}) vs full re-encode ${full.elapsedMs} ms`);
  expect(smart.smartRender!.copiedPercent).toBeGreaterThan(90);
  expect(smart.elapsedMs).toBeLessThan(full.elapsedMs * 0.6);

  const smartFile = await download(page, smart.outputName, `smart${SECONDS}.mp4`);
  const decodeErrors = execFileSync(FFMPEG, ["-v", "error", "-i", smartFile, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  expect(decodeErrors.trim()).toBe("");
  const frames = Number(stream(probe(smartFile, ["-count_frames", "-select_streams", "v:0"]), "video").nb_read_frames);
  expect(frames).toBe(SECONDS * 30);
  writeFileSync(testInfo.outputPath(`smart-render-${SECONDS}s.json`), JSON.stringify({ smartMs: smart.elapsedMs, fullMs: full.elapsedMs, report: smart.smartRender }, null, 2));
});

/** The content hash the renderer sends and the desktop process recomputes (see packages/core/src/export/source-fingerprint.ts). */
function referenceContentHash(data: Buffer): string {
  const CHUNK = 8 * 1024 * 1024;
  const digests: Buffer[] = [];
  for (let from = 0; from < data.length; from += CHUNK) digests.push(createHash("sha256").update(data.subarray(from, from + CHUNK)).digest());
  return createHash("sha256").update(`openreel-source-content-v2\0${data.length}\0`).update(Buffer.concat(digests)).digest("hex");
}

test("the changed-source guard hashes every byte: a one-byte edit in the middle of a large file is detected", async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  const SIZE = 24 * 1024 * 1024 + 123;
  const original = randomBytes(SIZE);
  const edited = Buffer.from(original);
  edited[Math.floor(SIZE / 2)] ^= 0x01;
  const files = { a: join(workDir, "fp-original.bin"), b: join(workDir, "fp-edited.bin"), c: join(workDir, "fp-copy.bin") };
  writeFileSync(files.a, original);
  writeFileSync(files.b, edited);
  writeFileSync(files.c, original);
  // Same size and same modification time, the way an in-place edit that preserves mtime looks.
  const when = new Date("2024-05-06T07:08:09Z");
  for (const file of Object.values(files)) utimesSync(file, when, when);

  // What the retired guard hashed: the first and last 64 KiB. It could not tell these two files apart.
  const sampled = (data: Buffer) => createHash("sha256").update(data.subarray(0, 65536)).update(data.subarray(data.length - 65536)).digest("hex");
  expect(sampled(edited)).toBe(sampled(original));

  await openHookPage(page);
  await page.evaluate(() => {
    for (const id of ["fp-a", "fp-b", "fp-c"]) {
      const input = document.createElement("input");
      input.type = "file";
      input.id = id;
      document.body.appendChild(input);
    }
  });
  await page.setInputFiles("#fp-a", files.a);
  await page.setInputFiles("#fp-b", files.b);
  await page.setInputFiles("#fp-c", files.c);
  const t0 = Date.now();
  const result = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: { sourceFingerprint: { computeFingerprint(b: Blob): Promise<{ size: number; mtimeMs?: number; contentHash: string }>; fingerprintMismatch(a: unknown, b: unknown): string | null } } }).__openreelE2E;
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement).files![0];
    const [a, b, c] = await Promise.all([get("fp-a"), get("fp-b"), get("fp-c")].map((f) => h.sourceFingerprint.computeFingerprint(f)));
    return {
      a, b, c,
      sameFile: h.sourceFingerprint.fingerprintMismatch(a, c),
      editedFile: h.sourceFingerprint.fingerprintMismatch(a, b),
    };
  });
  console.log(`[smart-render] hashed 3 x ${(SIZE / 1048576).toFixed(0)} MiB in ${Date.now() - t0} ms in Chrome`);
  expect(result.a.size).toBe(result.b.size);
  expect(result.a.mtimeMs).toBe(result.b.mtimeMs);
  expect(result.a.contentHash).toBe(referenceContentHash(original));
  expect(result.b.contentHash).toBe(referenceContentHash(edited));
  expect(result.sameFile).toBeNull();
  expect(result.editedFile).toMatch(/content changed/);
});

/**
 * Per-frame luma PSNR between two files' video, frame i against frame i, from ffmpeg's psnr filter (no frames held in
 * memory). `pre*` are filter chains applied to each input first: they renumber the frames at 30 fps so the filter
 * pairs them by position, and may drop leading frames.
 */
function psnrSeries(a: string, b: string, preA: string, preB: string): number[] {
  const stats = join(workDir, `psnr-${Math.random().toString(36).slice(2)}.log`);
  execFileSync(FFMPEG, ["-v", "error", "-i", a, "-i", b, "-lavfi", `[0:v]${preA}[x];[1:v]${preB}[y];[x][y]psnr=stats_file=${stats}`, "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  return readFileSync(stats, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const value = /psnr_y:(\S+)/.exec(line)?.[1] ?? "nan";
      return value === "inf" ? Infinity : Number(value);
    });
}

test("smart render copies a source whose start_time is nonzero and off the frame grid, frame-accurately", async ({ page }, testInfo) => {
  testInfo.setTimeout(SOFTWARE_GPU ? 900_000 : 1_200_000);
  const SECONDS = 45;
  // 43 frames in, as an mp4 edit list stores it: in 1 ms ticks, so 1.4333 s becomes 1.433 s, a third of a millisecond
  // (0.01 frame) off the 30 fps grid. The container start_time and the first frame's PTS.
  const START = 43 / 30;
  const LEAD = Math.round(START * 30); // output frames before the footage
  const startFile = join(workDir, `start-offset-${SECONDS}s.mp4`);
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    // a 1 s closed GOP, shorter than the start offset
    "-c:v", "libx264", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-bf", "2", "-pix_fmt", "yuv420p",
    // tagged BT.709 limited range, so the copied stream and the re-rendered frames agree on colour
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-c:a", "aac",
    "-output_ts_offset", String(START), "-shortest", startFile,
  ]);
  const fixtureProbe = probe(startFile);
  expect(Number(stream(fixtureProbe, "video").start_time)).toBeCloseTo(START, 2);
  expect(Math.abs(Number(stream(fixtureProbe, "video").start_time) - START)).toBeGreaterThan(1e-4); // quantised by the container
  const fixtureFrames = Number(stream(probe(startFile, ["-count_frames", "-select_streams", "v:0"]), "video").nb_read_frames);

  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* the tour just shows */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.locator('input[type="file"]').first().setInputFiles(startFile);
  const name = `start-offset-${SECONDS}s.mp4`;
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: `Media actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const st = h.project.getState().project.settings;
    if (st.width !== 640 || st.height !== 360) await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  // Cut at 20 s and 21 s of media time (the file's own timeline, which starts at 1.433 s) and put an effect on the middle piece.
  for (const t of [20, 21]) {
    await seek(page, t);
    const s = await readState(page);
    const under = clipsOf(s, "Main").find((c) => c.start <= s.playhead + 1e-6 && s.playhead < c.start + c.duration - 1e-6);
    if (!under) throw new Error("no clip under playhead");
    await clickClip(page, under.id);
    await press(page, "s");
  }
  await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(3);
  const [, middle] = clipsOf(await readState(page), "Main");
  await clickClip(page, middle.id);
  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await settle(page, 800);
  const card = page.locator(`button[aria-label="Vignette${CARD_SUFFIX}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await settle(page, 1200);
  expect(clipsOf(await readState(page), "Main")[1].effects).toBe(1);

  const smartId = await enqueue(page, { settings: { ...MP4_SMALL }, presetLabel: "Smart start offset" });
  const fullId = await enqueue(page, { settings: { ...MP4_SMALL, smartRender: false }, presetLabel: "Full start offset" });
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().start());
  await waitDone(page, smartId, undefined, 900_000);
  await waitDone(page, fullId, undefined, 900_000);
  const smart = (await job(page, smartId))!;
  const full = (await job(page, fullId))!;
  console.log(`[smart-render-offset] smart ${smart.elapsedMs} ms (${smart.smartRender?.summary}) vs full re-encode ${full.elapsedMs} ms`);
  // The copy path was taken, and for nearly all of the footage.
  expect(smart.smartRender, "smart-render report on the job").toBeTruthy();
  expect(smart.smartRender!.copiedPercent).toBeGreaterThan(90);
  expect(full.smartRender?.copiedPercent ?? 0).toBe(0);

  const smartFile = await download(page, smart.outputName, "smart-offset.mp4");
  const fullFile = await download(page, full.outputName, "full-offset.mp4");
  const frames = (file: string) => Number(stream(probe(file, ["-count_frames", "-select_streams", "v:0"]), "video").nb_read_frames);
  const nSmart = frames(smartFile);
  expect(nSmart).toBe(frames(fullFile));
  expect(nSmart).toBe(LEAD + fixtureFrames);
  expect(execFileSync(FFMPEG, ["-v", "error", "-i", smartFile, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()).toBe("");
  for (const at of [0.5, 5, 19.6, 20.5, 21.6, 30, 45]) {
    const seekErrors = execFileSync(FFMPEG, ["-v", "error", "-ss", String(at), "-i", smartFile, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(seekErrors.trim(), `seek decode at ${at}s`).toBe("");
  }

  // Frame-exact against the full re-encode over the WHOLE file, so every seam (lead-in, both cuts) is checked: a copied
  // frame placed one frame early or late, repeated or dropped, is a different picture from the re-encode's frame i.
  const aligned = "setpts=N/(30*TB)";
  const vsFull = psnrSeries(smartFile, fullFile, aligned, aligned);
  expect(vsFull.length).toBe(nSmart);
  const worst = Math.min(...vsFull);
  const shifted = psnrSeries(smartFile, fullFile, aligned, "setpts=(N+1)/(30*TB)");
  const meanOf = (series: number[]) => series.filter(Number.isFinite).reduce((x, y) => x + y, 0) / series.filter(Number.isFinite).length;
  const shiftedMean = meanOf(shifted);
  const alignedMean = meanOf(vsFull);
  console.log(`[smart-render-offset] PSNR vs full re-encode: worst frame ${worst.toFixed(1)} dB (frame ${vsFull.indexOf(worst)}), aligned mean ${alignedMean.toFixed(1)} dB; same pairing shifted by one frame: mean ${shiftedMean.toFixed(1)} dB`);
  expect(worst).toBeGreaterThan(30);
  // The check can see a one-frame slip. An absolute ceiling is encoder dependent (the full re-encode goes through the
  // platform's H.264 encoder, which differs between a hardware Mac and a software CI runner: the shifted mean was 24.0 dB
  // on one and 25.4 dB on the other), so the shifted pairing must sit well below the aligned pairing measured in the same run.
  expect(shiftedMean).toBeLessThan(alignedMean - 12);
  expect(shiftedMean).toBeLessThan(30);

  // Copied frames are the source's own bytes, on the output frame that shows that source frame (output i = source i - LEAD).
  const vsSource = psnrSeries(smartFile, startFile, `trim=start_frame=${LEAD},setpts=N/(30*TB)`, aligned);
  const identical = vsSource.filter((value) => value === Infinity).length;
  const expectedCopied = Math.round((smart.smartRender!.copiedPercent / 100) * nSmart);
  console.log(`[smart-render-offset] ${identical} frames identical to the source; plan copied ${expectedCopied}`);
  expect(Math.abs(identical - expectedCopied)).toBeLessThanOrEqual(2);

  // Audio stays in sync: same A/V offset and end as the full re-encode.
  const sv = packetSpan(smartFile, "v:0");
  const fv = packetSpan(fullFile, "v:0");
  const sa = packetSpan(smartFile, "a:0");
  const fa = packetSpan(fullFile, "a:0");
  expect(Math.abs(sa.first - sv.first - (fa.first - fv.first))).toBeLessThan(0.002);
  expect(Math.abs(sv.last - fv.last)).toBeLessThan(0.002);
  expect(Math.abs(sa.last - fa.last)).toBeLessThan(0.03);
  writeFileSync(testInfo.outputPath("smart-render-start-offset.json"), JSON.stringify({ smartMs: smart.elapsedMs, fullMs: full.elapsedMs, report: smart.smartRender, worstPsnrVsFull: worst, identicalFrames: identical }, null, 2));
});
