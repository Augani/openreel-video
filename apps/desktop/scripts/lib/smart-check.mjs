/**
 * Native smart render check for export-check.mjs (real Electron, real ffmpeg sidecar).
 *
 * A closed-GOP H.264 source (key frame every second, B-frames, BT.709 tags) is
 * put on the timeline, cut and lightly edited (Vignette on one section), then
 * exported twice through the real export queue on the native encoder
 * (encodeMode "smallest" routes H.264 to the ffmpeg sidecar): once with smart
 * render and once without. The output of the smart export is checked with
 * ffprobe / ffmpeg for frame accuracy, seekability and pixels.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkTimeline, decodeErrors, framePsnr, probeVideoPackets, sampleIndexes, seekDecodes, summarizePsnr } from "./verify-video.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FPS = 30000 / 1001;
const GOP = 30;

/** 29.97 fps closed-GOP H.264 test source with a sine track. */
export function makeSmartSource({ ffmpeg, dir, seconds, width, height, codec = "h264" }) {
  const file = path.join(dir, `smart-src-${codec}-${width}x${height}-${seconds}s.${codec === "prores" ? "mov" : "mp4"}`);
  if (fs.existsSync(file)) return file;
  const video =
    codec === "prores"
      ? ["-c:v", "prores_ks", "-profile:v", "3"]
      : codec === "hevc10"
        ? ["-c:v", "libx265", "-preset", "veryfast", "-x265-params", `keyint=${GOP}:min-keyint=${GOP}:scenecut=0:open-gop=0:log-level=error`, "-tag:v", "hvc1"]
        : codec === "hevc"
      ? ["-c:v", "libx265", "-preset", "veryfast", "-x265-params", `keyint=${GOP}:min-keyint=${GOP}:scenecut=0:open-gop=0:log-level=error`, "-tag:v", "hvc1"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-g", String(GOP), "-keyint_min", String(GOP), "-sc_threshold", "0", "-bf", "2", "-profile:v", "high"];
  execFileSync(
    ffmpeg,
    [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=30000/1001:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      ...video,
      "-pix_fmt", codec === "prores" ? "yuv422p10le" : codec === "hevc10" ? "yuv420p10le" : "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-shortest", file,
    ],
    { maxBuffer: 1 << 28 },
  );
  return file;
}

async function waitForJob(page, id, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const job = await page.evaluate((jobId) => {
      const j = window.__openreelE2E.exportQueue.getState().queue.jobs.find((x) => x.id === jobId);
      return j && { status: j.status, error: j.error, output: j.output, progress: j.progress, smartRender: j.smartRender, elapsedMs: j.elapsedMs };
    }, id);
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() - t0 > timeoutMs) return { ...job, status: "timeout" };
    await sleep(500);
  }
}

async function exportOnce(page, label, settings, timeoutMs) {
  const id = await page.evaluate((payload) => {
    const h = window.__openreelE2E.exportQueue.getState();
    const job = h.enqueue(payload);
    if (!job) throw new Error("enqueue returned null");
    h.start();
    return job.id;
  }, { settings, presetLabel: label });
  const wall0 = Date.now();
  const job = await waitForJob(page, id, timeoutMs);
  return { ...job, wallMs: Date.now() - wall0 };
}

/**
 * @param pw Playwright module, @param opts {root, ffmpeg, ffprobe, workDir, seconds, width, height, cuts: [startFrame,endFrame], name, full}
 * `cuts` is the frame range that gets the effect; everything else stays untouched.
 */
export async function smartScenario(pw, opts) {
  const { root, ffmpeg, ffprobe, workDir, seconds, width, height, cuts, name, runFull = true, timeoutMs = 3_600_000, codec = "h264", expectDecline } = opts;
  const prores = codec === "prores";
  const source = makeSmartSource({ ffmpeg, dir: workDir, seconds, width, height, codec });
  const userData = fs.mkdtempSync(path.join(workDir, "ud-"));
  const app = await pw._electron.launch({ args: [path.join(root, "apps/desktop"), `--user-data-dir=${userData}`], env: { ...process.env, OPENREEL_SKIP_ONBOARDING: "1" }, timeout: 90_000 });
  const entry = { scenario: name, source: path.basename(source), problems: [] };
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByText("Horizontal", { exact: true }).waitFor({ timeout: 60_000 });
    await page.getByText("Horizontal", { exact: true }).click();
    await page.locator('canvas[aria-label^="Program"]').waitFor({ timeout: 60_000 });
    const skip = page.getByText("Skip Tour");
    await skip.waitFor({ timeout: 3000 }).then(() => skip.click()).catch(() => {});
    await page.locator('input[type="file"]').first().setInputFiles(source);
    const baseName = path.basename(source);
    await page.getByLabel(`Select media ${baseName}`).waitFor({ timeout: 120_000 });
    await page.getByRole("button", { name: `Media actions for ${baseName}` }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8000 }).catch(() => {});
    await sleep(1500);

    // Where does the file behind the media item live? (decides whether smart render copies the blob)
    entry.diskPathKnown = await page.evaluate(() => {
      const items = window.__openreelE2E.project.getState().project.mediaLibrary.items;
      const blob = items.find((m) => m.type === "video")?.blob;
      return Boolean(blob && window.openreel.export.pathForFile && window.openreel.export.pathForFile(blob));
    });

    // Light edit: split at the two cut frames and put Vignette on the section between them.
    const [a, b] = cuts;
    await page.evaluate(async ({ a, b, fps }) => {
      const st = () => window.__openreelE2E.project.getState();
      const videoClips = () => st().project.timeline.tracks.flatMap((t) => t.clips).filter((c) => st().project.mediaLibrary.items.find((m) => m.id === c.mediaId)?.type === "video");
      const clip0 = videoClips()[0];
      await st().splitClip(clip0.id, (a * 1001) / 30000);
      const right = videoClips().find((c) => c.startTime >= ((a * 1001) / 30000) - 1e-6);
      await st().splitClip(right.id, (b * 1001) / 30000);
      const middle = videoClips().find((c) => Math.abs(c.startTime - (a * 1001) / 30000) < 1e-4);
      await st().addVideoEffect(middle.id, "vignette");
    }, { a, b });
    await sleep(1000);
    entry.clips = await page.evaluate(() => window.__openreelE2E.project.getState().project.timeline.tracks.flatMap((t) => t.clips).map((c) => ({ start: c.startTime, duration: c.duration, effects: c.effects.length })));
    // The export is as long as the timeline (the last clip's end), rounded up to whole frames.
    // (the engine counts frames at the 29.97 the export settings say)
    const frames = Math.ceil(Math.max(...entry.clips.map((c) => c.start + c.duration)) * 29.97 - 1e-7);
    entry.frames = frames;

    const settings = prores
      ? { width, height, frameRate: 29.97, format: "mov", codec: "prores", proresProfile: "hq", bitrate: 8000 }
      : { width, height, frameRate: 29.97, format: "mp4", codec: codec === "hevc" || codec === "hevc10" ? "h265" : "h264", bitrate: 8000, encodeMode: "smallest", keyframeInterval: GOP };
    const smart = await exportOnce(page, `smart-${name}`, { ...settings, smartRender: true }, timeoutMs);
    entry.smart = { status: smart.status, error: smart.error, ms: smart.elapsedMs, wallMs: smart.wallMs, report: smart.smartRender, path: smart.output?.path };
    let full = null;
    if (runFull) {
      full = await exportOnce(page, `full-${name}`, { ...settings, smartRender: false }, timeoutMs);
      entry.full = { status: full.status, error: full.error, ms: full.elapsedMs, wallMs: full.wallMs, report: full.smartRender, path: full.output?.path };
    }
    if (smart.status !== "completed") {
      entry.problems.push(`smart export ${smart.status}: ${smart.error}`);
      return entry;
    }

    const outPath = smart.output.path;
    const report = smart.smartRender;
    if (expectDecline) {
      // 10-bit / 4:2:2 / HDR sources: the export still completes (full re-encode) and says why nothing was copied.
      const reasons = (report?.reasons ?? []).join(" | ");
      entry.declined = { copiedPercent: report?.copiedPercent, summary: report?.summary, reasons };
      if (!report || report.copiedFrames !== 0) entry.problems.push(`expected a declined smart render, report says ${JSON.stringify(report)}`);
      if (!expectDecline.test(reasons)) entry.problems.push(`decline reason ${JSON.stringify(reasons)} does not match ${expectDecline}`);
      const decodeFailure = decodeErrors(ffmpeg, outPath);
      if (decodeFailure) entry.problems.push(`decode errors: ${decodeFailure.split("\n")[0]}`);
      return entry;
    }
    // ProRes is all-intra: any frame is a cut point, so the copy runs right up to the edit.
    const headEnd = prores ? a : prevKey(a);
    const tailStart = prores ? b : nextKey(b);
    const copiedExpected = headEnd + (frames - tailStart);
    if (!report || report.engine !== "native") entry.problems.push(`smart report missing or not native: ${JSON.stringify(report)}`);
    else if (report.copiedFrames > copiedExpected || report.copiedFrames < copiedExpected - 1) entry.problems.push(`expected ${copiedExpected} (or one fewer: the last frame is only partly inside the clip) copied frames, report says ${report.copiedFrames}`);
    entry.copiedPercent = report?.copiedPercent;
    entry.summary = report?.summary;

    const packets = probeVideoPackets(ffprobe, outPath);
    const keyAt = [0, headEnd, tailStart].filter((k) => k < frames);
    const tl = checkTimeline(packets, { frames, fps: FPS, expectedKeyframes: keyAt });
    entry.timeline = { ok: tl.ok, frames: tl.frames, keyframesAt: tl.keyIndexes.slice(0, 12), worstIntervalError: tl.worstIntervalError };
    entry.problems.push(...tl.problems);
    const decode = decodeErrors(ffmpeg, outPath);
    if (decode) entry.problems.push(`decode errors: ${decode.split("\n")[0]}`);
    const seeks = [0.5, a / FPS - 0.05, a / FPS + 0.05, b / FPS + 0.05, frames / FPS - 1].map((t) => Math.max(0, t));
    entry.problems.push(...seekDecodes(ffmpeg, outPath, seeks));

    const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", outPath], { encoding: "utf8" }));
    const video = info.streams.find((s) => s.codec_type === "video");
    const audio = info.streams.find((s) => s.codec_type === "audio");
    entry.video = video && { codec: video.codec_name, profile: video.profile, level: video.level, fps: video.r_frame_rate, frames: video.nb_frames, start: video.start_time };
    entry.audio = audio && { codec: audio.codec_name, start: audio.start_time };
    if (video && video.codec_name !== (prores ? "prores" : codec === "hevc" ? "hevc" : "h264")) entry.problems.push(`output codec ${video.codec_name}`);
    // QuickTime only plays HEVC tagged hvc1 (not hev1): stream-copied and re-encoded runs alike.
    if (codec === "hevc") {
      entry.codecTag = video?.codec_tag_string;
      if (video?.codec_tag_string !== "hvc1") entry.problems.push(`HEVC output is tagged ${video?.codec_tag_string}, QuickTime needs hvc1`);
    }
    if (prores) {
      entry.codecTag = video?.codec_tag_string;
      if (video?.profile !== "HQ") entry.problems.push(`ProRes output profile ${video?.profile}, expected HQ`);
    }
    if (!video || video.r_frame_rate !== "30000/1001") entry.problems.push(`output frame rate ${video?.r_frame_rate}`);
    if (!audio) entry.problems.push("no audio stream");
    else if (Math.abs(Number(audio.start_time ?? 0) - Number(video.start_time ?? 0)) > 0.05) entry.problems.push("audio and video start differ");
    entry.durations = { format: Number(info.format.duration), expected: frames / FPS };
    entry.bytes = fs.statSync(outPath).size;

    // Pixels. Copied frames must equal the source bit for bit; re-encoded frames are compared with the full re-encode.
    // The source can be a frame shorter than the timeline (duration rounds up); compare only frames both files have.
    const sourceFrames = Number(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", source], { encoding: "utf8" }).trim().replace(/,$/, ""));
    const probeIdx = sampleIndexes(sourceFrames, 120, [0, headEnd - 1, headEnd, headEnd + 1, tailStart - 1, tailStart, tailStart + 1, sourceFrames - 1]);
    const vsSource = framePsnr(ffmpeg, outPath, source, { width, height, indexes: probeIdx });
    const copiedA = summarizePsnr(vsSource, 0, headEnd);
    const tailEnd = tailStart + ((report?.copiedFrames ?? 0) - headEnd);
    const copiedB = summarizePsnr(vsSource, tailStart, tailEnd);
    entry.copiedVsSource = { head: copiedA, tail: copiedB };
    if (copiedA.min < 99 || copiedB.min < 99) entry.problems.push(`copied frames differ from the source (min PSNR ${Math.min(copiedA.min, copiedB.min).toFixed(1)} dB)`);
    if (full?.status === "completed") {
      const fullPackets = probeVideoPackets(ffprobe, full.output.path);
      const fullTl = checkTimeline(fullPackets, { frames, fps: FPS });
      entry.fullTimeline = { ok: fullTl.ok, frames: fullTl.frames, problems: fullTl.problems };
      // Chromium cannot decode ProRes, so the editor renders a ProRes source black and a full re-encode of it
      // is black frames: comparing pixels with it says nothing. The copied frames are compared with the source above.
      if (prores) {
        entry.fullRenderOfProResSource = "black (the renderer cannot decode ProRes); pixel comparison with the full re-encode skipped";
        return entry;
      }
      const vsFull = framePsnr(ffmpeg, outPath, full.output.path, { width, height, indexes: probeIdx });
      const encoded = summarizePsnr(vsFull, headEnd, tailStart);
      const copiedVsFull = summarizePsnr(vsFull, 0, headEnd);
      entry.encodedVsFull = encoded;
      entry.copiedVsFull = copiedVsFull;
      entry.sampled = [0, headEnd - 1, headEnd, headEnd + 1, tailStart - 1, tailStart, frames - 1].filter((i) => i >= 0 && i < sourceFrames).map((i) => ({ frame: i, psnrVsFull: Number(Math.min(99, vsFull.find((f) => f.index === i)?.psnr ?? NaN).toFixed(1)) }));
      if (encoded.mean < 32) entry.problems.push(`re-encoded frames differ from the full re-encode (mean PSNR ${encoded.mean.toFixed(1)} dB)`);
      if (copiedVsFull.mean < 32) entry.problems.push(`copied frames differ from the full re-encode (mean PSNR ${copiedVsFull.mean.toFixed(1)} dB)`);
    }
    return entry;
  } finally {
    const proc = app.process();
    await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}), sleep(4000)]);
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
  }
}

/** First key frame at or after output frame `frame` (the source has a key frame every GOP frames). */
function nextKey(frame) {
  return Math.ceil(frame / GOP) * GOP;
}

/** Last key frame at or before output frame `frame`. */
function prevKey(frame) {
  return Math.floor(frame / GOP) * GOP;
}
