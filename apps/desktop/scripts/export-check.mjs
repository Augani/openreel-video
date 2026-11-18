#!/usr/bin/env node
/**
 * Real Electron export check for the desktop build.
 *
 * Launches the BUILT app (build apps/web with VITE_OPENREEL_E2E=1 and
 * OPENREEL_DESKTOP=1, then `pnpm --filter @openreel/desktop build:main`) through
 * Playwright's _electron API, imports the 6 s three-scene fixture, queues exports
 * through the real export queue and ffprobes what lands on disk:
 *
 *   webcodecs  H.264 / MP4 through WebCodecs + MediaBunny, muxed straight to disk
 *              (smart render applies: the fixture matches the export)
 *   native     ProRes / MOV through the native ffmpeg sidecar (NativeFFmpegBackend)
 *   smallest   H.264 "smallest" mode through the native ffmpeg sidecar
 *   smart      native smart render: stream-copy + boundary re-encode, asserted with ffprobe/ffmpeg (see lib/smart-check.mjs)
 *   smart-hevc    the same with an HEVC source (output must be tagged hvc1)
 *   smart-prores  ProRes HQ source into a ProRes export: copy runs right up to an off-GOP edit
 *   smart-decline a 10-bit source: smart render declines, names the format, export is a full re-encode
 *   smart-timing  the same on a long timeline, with/without smart render (opt-in, not in the default set)
 *
 * The sidecar binary lives at apps/desktop/resources/bin/<platform>-<arch>/ffmpeg
 * (pnpm --filter @openreel/desktop fetch:ffmpeg); on a machine that already has
 * ffmpeg, symlink it there. Usage: node scripts/export-check.mjs [--only webcodecs,native,smallest,smart,smart-timing]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const argv = process.argv.slice(2);
const only = new Set((argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : "webcodecs,native,smallest,smart").split(","));

const require = createRequire(path.join(root, "package.json"));
const pnpmDir = path.join(root, "node_modules/.pnpm");
const pw = require(path.join(pnpmDir, fs.readdirSync(pnpmDir).find((d) => d.startsWith("playwright@")), "node_modules/playwright"));
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Native smart render (stream-copy of untouched GOP-aligned spans) on the ffmpeg sidecar.
//   --only smart          6-12 s fixtures, aligned and off-GOP cuts, smart vs full re-encode, frame/pixel assertions
//   --only smart-timing   long timeline (default 10 min, 1280x720): export time with and without smart render
//                         [--minutes N] [--no-full to skip the full re-encode]
async function runSmartChecks() {
  const { smartScenario } = await import("./lib/smart-check.mjs");
  const smartWork = fs.mkdtempSync(path.join(os.tmpdir(), "oreel-desktop-smart-"));
  const results = [];
  let smartFailed = false;
  const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const scenarios = [];
  if (only.has("smart")) {
    scenarios.push({ name: "aligned-cuts", seconds: 12, width: 640, height: 360, cuts: [120, 240] });
    scenarios.push({ name: "off-gop-cuts", seconds: 12, width: 640, height: 360, cuts: [135, 255] });
  }
  if (only.has("smart-hevc")) {
    scenarios.push({ name: "hevc-aligned-cuts", seconds: 12, width: 640, height: 360, cuts: [120, 240], codec: "hevc" });
  }
  if (only.has("smart-prores")) {
    // ProRes source copy: every frame is a cut point, so the copy runs right up to the (non-GOP-aligned) edit.
    scenarios.push({ name: "prores-cuts", seconds: 12, width: 640, height: 360, cuts: [137, 251], codec: "prores" });
  }
  if (only.has("smart-decline")) {
    // 10-bit source: smart render declines, names the format, and the export is a normal full re-encode.
    scenarios.push({ name: "decline-10bit-hevc", seconds: 6, width: 640, height: 360, cuts: [60, 120], codec: "hevc10", runFull: false, expectDecline: /10-bit/ });
  }
  if (only.has("smart-timing")) {
    const minutes = Number(flag("--minutes", "10"));
    const seconds = minutes * 60;
    // Light edit in the middle: a ~20 s section gets Vignette (everything else is an untouched run of the source).
    const mid = Math.round((seconds * 30000) / 1001 / 2 / 30) * 30;
    scenarios.push({ name: `timing-${minutes}min`, seconds, width: 1280, height: 720, cuts: [mid, mid + 600], runFull: !argv.includes("--no-full") });
  }
  for (const scenario of scenarios) {
    const entry = await smartScenario(pw, { root, ffmpeg: FFMPEG, ffprobe: FFPROBE, workDir: smartWork, ...scenario }).catch((error) => ({ scenario: scenario.name, problems: [`crashed: ${error?.stack ?? error}`] }));
    if (entry.problems.length) smartFailed = true;
    results.push(entry);
    console.error(`[desktop-smart] ${JSON.stringify(entry)}`);
  }
  fs.rmSync(smartWork, { recursive: true, force: true });
  return { failed: smartFailed, results };
}

const smartWanted = ["smart", "smart-timing", "smart-hevc", "smart-prores", "smart-decline"].some((c) => only.has(c));
if (smartWanted && !["webcodecs", "native", "smallest"].some((c) => only.has(c))) {
  const { failed, results } = await runSmartChecks();
  console.log(JSON.stringify({ ok: !failed, results }, null, 2));
  process.exit(failed ? 1 : 0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "oreel-desktop-export-"));
const fixture = path.join(work, "three-scenes.mp4");
execFileSync(FFMPEG, [
  "-y", "-v", "error",
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2",
  "-f", "lavfi", "-i", "color=c=red:size=640x360:rate=30:duration=2",
  "-f", "lavfi", "-i", "smptebars=size=640x360:rate=30:duration=2",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
  "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
  "-map", "[v]", "-map", "3:a",
  "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fixture,
]);

const probe = (file) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const decodeErrors = (file) => {
  try {
    return execFileSync(FFMPEG, ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return String(error.stderr ?? error).trim();
  }
};

const userData = fs.mkdtempSync(path.join(work, "ud-"));
const app = await pw._electron.launch({ args: [path.join(root, "apps/desktop"), `--user-data-dir=${userData}`], env: { ...process.env, OPENREEL_SKIP_ONBOARDING: "1" }, timeout: 90_000 });
const mainLogs = [];
app.process().stdout?.on("data", (d) => mainLogs.push(String(d)));
app.process().stderr?.on("data", (d) => mainLogs.push(String(d)));
const results = [];
let failed = false;
try {
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  await page.waitForLoadState("domcontentloaded");
  await page.getByText("Horizontal", { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText("Horizontal", { exact: true }).click();
  await page.locator('canvas[aria-label^="Program"]').waitFor({ timeout: 60_000 });
  const skip = page.getByText("Skip Tour");
  await skip.waitFor({ timeout: 3000 }).then(() => skip.click()).catch(() => {});
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByLabel("Select media three-scenes.mp4").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Media actions for three-scenes.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8000 }).catch(() => {});
  await sleep(1500);
  const clipCount = await page.evaluate(() => window.__openreelE2E.project.getState().project.timeline.tracks.flatMap((t) => t.clips).length);
  if (clipCount < 1) throw new Error("the fixture was not placed on the timeline");

  const cases = [
    { name: "webcodecs", settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 } },
    { name: "native", settings: { width: 640, height: 360, frameRate: 30, format: "mov", codec: "prores", proresProfile: "standard", bitrate: 2000 } },
    { name: "smallest", settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000, encodeMode: "smallest" } },
  ].filter((c) => only.has(c.name));

  for (const c of cases) {
    const t0 = Date.now();
    const id = await page.evaluate((payload) => {
      const h = window.__openreelE2E.exportQueue.getState();
      const job = h.enqueue(payload);
      if (!job) throw new Error("enqueue returned null");
      h.start();
      return job.id;
    }, { settings: c.settings, presetLabel: `desktop-${c.name}` });
    let job;
    for (;;) {
      job = await page.evaluate((jobId) => {
        const j = window.__openreelE2E.exportQueue.getState().queue.jobs.find((x) => x.id === jobId);
        return j && { status: j.status, error: j.error, output: j.output, progress: j.progress, smartRender: j.smartRender, elapsedMs: j.elapsedMs };
      }, id);
      if (["completed", "failed", "cancelled"].includes(job.status)) break;
      if (Date.now() - t0 > 240_000) { job = { ...job, status: "timeout" }; break; }
      await sleep(300);
    }
    const entry = { case: c.name, status: job.status, error: job.error, ms: job.elapsedMs, smartRender: job.smartRender?.summary, path: job.output?.path };
    if (job.status === "completed" && job.output?.path && fs.existsSync(job.output.path)) {
      const p = probe(job.output.path);
      const v = p.streams.find((s) => s.codec_type === "video");
      const a = p.streams.find((s) => s.codec_type === "audio");
      entry.video = v && { codec: v.codec_name, w: v.width, h: v.height, fps: v.r_frame_rate, frames: v.nb_frames };
      entry.audio = a && { codec: a.codec_name };
      entry.duration = Number(p.format.duration);
      entry.bytes = fs.statSync(job.output.path).size;
      entry.decodeErrors = decodeErrors(job.output.path);
      if (!v || Math.abs(entry.duration - 6) > 0.2 || entry.decodeErrors) failed = true;
    } else failed = true;
    results.push(entry);
    console.error(`[desktop-export] ${JSON.stringify(entry)}`);
  }
  if (pageErrors.length) console.error(`[desktop-export] renderer errors: ${JSON.stringify(pageErrors.slice(0, 5))}`);
} catch (error) {
  failed = true;
  console.error(`[desktop-export] FAILED: ${error?.stack ?? error}`);
  console.error(mainLogs.join("").slice(-3000));
} finally {
  const proc = app.process();
  await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}), sleep(4000)]);
  try { proc.kill("SIGKILL"); } catch { /* gone */ }
}
if (smartWanted) {
  const smart = await runSmartChecks();
  if (smart.failed) failed = true;
  results.push(...smart.results);
}
console.log(JSON.stringify({ ok: !failed, results }, null, 2));
process.exit(failed ? 1 : 0);
