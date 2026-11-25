/**
 * Smart render + multichannel source patching, in real Electron with the real ffmpeg sidecar.
 *
 * A closed-GOP H.264 MOV that carries FOUR audio channels (440 / 660 / 880 / 1100 Hz) is imported and put on the timeline with
 * Add to timeline: the multichannel path places the picture plus one mono clip per channel on audio tracks, each with its own
 * channel map. The 660 Hz and 1100 Hz clips are deleted and Vignette goes on a middle section of the picture, so the export
 * copies the untouched GOPs and re-encodes the effect. The file is exported twice (smart render on and off) and the
 * audio of both is analysed: it must carry 440 Hz and 880 Hz and neither of the removed channels, on both sides, in every
 * window (before, inside and after the edit), and the smart export must still have copied most of the picture.
 *
 * Smart render copies picture only; the audio is always the mixdown, so a custom channel map cannot be lost by a copy.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { decodeErrors } from "./verify-video.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FREQS = [440, 660, 880, 1100];
const KEPT = [440, 880];
const REMOVED = [660, 1100];

function makeSource(ffmpeg, dir, seconds) {
  const file = path.join(dir, `smart-mc-${seconds}s.mov`);
  const tones = FREQS.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:sample_rate=48000:duration=${seconds}`]);
  execFileSync(
    ffmpeg,
    [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30000/1001:duration=${seconds}`,
      ...tones,
      "-filter_complex", "[1:a][2:a][3:a][4:a]amerge=inputs=4[a]",
      "-map", "0:v", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-bf", "2", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "pcm_s24le", file,
    ],
    { maxBuffer: 1 << 28 },
  );
  return file;
}

/** Amplitude of one frequency (single-bin DFT) over [from, to) seconds of a channel. */
function toneAmp(x, rate, freq, from, to) {
  const a = Math.floor(from * rate);
  const b = Math.min(x.length, Math.floor(to * rate));
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = (2 * Math.PI * freq * (i - a)) / rate;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / Math.max(1, b - a);
}

/** Decodes the file's audio to stereo f32 and measures the four tones per window. */
function analyse(ffmpeg, file, windows) {
  const raw = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-vn", "-ac", "2", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const left = new Float32Array(samples.length / 2);
  const right = new Float32Array(samples.length / 2);
  for (let i = 0; i < left.length; i++) {
    left[i] = samples[2 * i];
    right[i] = samples[2 * i + 1];
  }
  return windows.map(([from, to]) => ({
    window: [from, to],
    tones: Object.fromEntries(FREQS.map((f) => [f, Math.max(toneAmp(left, 48000, f, from, to), toneAmp(right, 48000, f, from, to))])),
  }));
}

async function waitForJob(page, id, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const job = await page.evaluate((jobId) => {
      const j = window.__openreelE2E.exportQueue.getState().queue.jobs.find((x) => x.id === jobId);
      return j && { status: j.status, error: j.error, output: j.output, smartRender: j.smartRender, elapsedMs: j.elapsedMs };
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
  return waitForJob(page, id, timeoutMs);
}

export async function smartMultichannelScenario(pw, opts) {
  const { root, ffmpeg, ffprobe, workDir, seconds = 8, timeoutMs = 600_000 } = opts;
  const source = makeSource(ffmpeg, workDir, seconds);
  const userData = fs.mkdtempSync(path.join(workDir, "ud-"));
  const app = await pw._electron.launch({ args: [path.join(root, "apps/desktop"), `--user-data-dir=${userData}`], env: { ...process.env, OPENREEL_SKIP_ONBOARDING: "1" }, timeout: 90_000 });
  const entry = { scenario: "multichannel", source: path.basename(source), problems: [] };
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
    entry.metadata = await page.evaluate((name) => window.__openreelE2E.project.getState().project.mediaLibrary.items.find((m) => m.name === name)?.metadata, baseName);
    if (entry.metadata?.channels !== 4) entry.problems.push(`expected a 4-channel source, the importer reports ${entry.metadata?.channels}`);

    // Add to timeline: a multichannel file becomes the picture plus one audio clip per channel group.
    await page.getByRole("button", { name: `Media actions for ${baseName}` }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8000 }).catch(() => {});
    await page.evaluate(() => window.__openreelE2E.project.getState().updateSettings({ frameRate: 30000 / 1001 }));
    await sleep(2000);
    const placed = await page.evaluate(() => {
      const st = window.__openreelE2E.project.getState();
      return st.project.timeline.tracks.flatMap((t) => t.clips.map((c) => ({ id: c.id, type: t.type, track: t.name, map: c.channelMap ?? null, group: c.metadata?.sourceChannelGroup ?? null, link: c.metadata?.separatedFromClipId ?? null, volume: c.volume })));
    });
    entry.placed = placed;
    const sounds = placed.filter((c) => c.type === "audio");
    if (sounds.length !== 4) entry.problems.push(`Add to timeline placed ${sounds.length} audio clips for a 4-channel file, expected 4`);
    if (new Set(sounds.map((c) => c.track)).size !== sounds.length) entry.problems.push("the audio clips share tracks");
    if (!placed.some((c) => c.type === "video")) entry.problems.push("no picture clip was placed");
    if (entry.problems.length) return entry;

    // Delete the 660 and 1100 Hz clips (channels 2 and 4), put Vignette on a middle section of the picture.
    await page.evaluate(async () => {
      const st = () => window.__openreelE2E.project.getState();
      const sound = (group) => st().project.timeline.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips).find((c) => c.metadata?.sourceChannelGroup === group);
      for (const group of [1, 3]) await st().removeClip(sound(group).id);
      const video = () => st().project.timeline.tracks.filter((t) => t.type !== "audio").flatMap((t) => t.clips);
      const a = (120 * 1001) / 30000;
      const b = (240 * 1001) / 30000;
      await st().splitClip(video()[0].id, a);
      const right = video().find((c) => c.startTime >= a - 1e-6);
      await st().splitClip(right.id, b);
      const middle = video().find((c) => Math.abs(c.startTime - a) < 1e-4);
      await st().addVideoEffect(middle.id, "vignette");
    });
    await sleep(1000);
    entry.after = await page.evaluate(() => window.__openreelE2E.project.getState().project.timeline.tracks.flatMap((t) => t.clips.map((c) => ({ type: t.type, start: +c.startTime.toFixed(3), duration: +c.duration.toFixed(3), map: c.channelMap?.sources ?? null, effects: c.effects.length }))));
    const kept = entry.after.filter((c) => c.type === "audio");
    if (kept.length < 2 || kept.some((c) => !c.map || ![0, 2].includes(c.map[0]))) entry.problems.push(`unexpected audio clips after the deletes: ${JSON.stringify(kept)}`);

    const settings = { width: 640, height: 360, frameRate: 29.97, format: "mp4", codec: "h264", bitrate: 8000, encodeMode: "smallest", keyframeInterval: 30 };
    const smart = await exportOnce(page, "smart-mc", { ...settings, smartRender: true }, timeoutMs);
    const full = await exportOnce(page, "full-mc", { ...settings, smartRender: false }, timeoutMs);
    entry.smart = { status: smart.status, error: smart.error, ms: smart.elapsedMs, report: smart.smartRender, path: smart.output?.path };
    entry.full = { status: full.status, error: full.error, ms: full.elapsedMs, path: full.output?.path };
    if (smart.status !== "completed") entry.problems.push(`smart export ${smart.status}: ${smart.error}`);
    if (full.status !== "completed") entry.problems.push(`full export ${full.status}: ${full.error}`);
    if (entry.problems.length) return entry;

    if (!smart.smartRender || smart.smartRender.engine !== "native" || !(smart.smartRender.copiedFrames > 0)) {
      entry.problems.push(`the picture was not smart-rendered although only the sound clips carry channel maps: ${JSON.stringify(smart.smartRender)}`);
    }
    const decode = decodeErrors(ffmpeg, smart.output.path);
    if (decode) entry.problems.push(`decode errors: ${decode.split("\n")[0]}`);

    const dur = Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", smart.output.path], { encoding: "utf8" }).trim());
    const windows = [[0.3, 3], [4.2, 7]].filter(([, to]) => to <= dur - 0.2);
    windows.push([Math.max(0.3, dur / 2 - 0.6), dur / 2 + 0.6]);
    const heard = { smart: analyse(ffmpeg, smart.output.path, windows), full: analyse(ffmpeg, full.output.path, windows) };
    entry.heard = heard;
    for (const [label, results] of Object.entries(heard)) {
      for (const { window, tones } of results) {
        for (const f of KEPT) if (!(tones[f] > 0.05)) entry.problems.push(`${label} export: ${f} Hz is missing in ${window[0]}-${window[1]} s (amplitude ${tones[f].toFixed(4)})`);
        for (const f of REMOVED) if (!(tones[f] < 0.005)) entry.problems.push(`${label} export: ${f} Hz is audible in ${window[0]}-${window[1]} s (amplitude ${tones[f].toFixed(4)}) although its channel was removed`);
      }
    }
    // The smart export's mixdown must equal the full export's (same audio path), channel by channel.
    heard.smart.forEach(({ window, tones }, i) => {
      for (const f of KEPT) if (Math.abs(tones[f] - heard.full[i].tones[f]) > 0.02) entry.problems.push(`${f} Hz differs between the smart and the full export in ${window[0]}-${window[1]} s (${tones[f].toFixed(3)} vs ${heard.full[i].tones[f].toFixed(3)})`);
    });
    return entry;
  } catch (error) {
    entry.problems.push(`crashed: ${error?.stack ?? error}`);
    return entry;
  } finally {
    try {
      const proc = app.process();
      await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}), sleep(4000)]);
      try { proc.kill("SIGKILL"); } catch { /* gone */ }
    } catch {
      /* already gone */
    }
  }
}
