#!/usr/bin/env node
/**
 * Serial vs parallel-segment export on the BUILT desktop app (opt-in, never part of perf:budget, no gates).
 *
 * Generates a heavy 1080p project (four 20 s 1080p30 clips with blur / glow / grade / LUT, a graded picture-in-picture
 * layer, titles, four audio tracks), then exports it through the real export queue three ways:
 *   serial      parallelSegments "off": one renderer, one ffmpeg (the export every earlier version did)
 *   plan-1      the parallel plan run one segment at a time (the same segments, no concurrency)
 *   parallel    the same plan with N hidden worker windows rendering segments at once
 * and reports wall time, CPU time (every Electron process ever seen, hidden workers included, plus the ffmpeg
 * sidecars), the 1-minute load average, peak resident memory and the frame-exact comparison of the outputs
 * (ffprobe frame count, per-frame MD5 of every frame, PSNR when the hashes differ, audio hash).
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   node apps/desktop/scripts/export-parallel-bench.mjs --out result.json [--codec h264|prores] [--seconds 60]
 *        [--workers 3] [--skip serial,plan1] [--keep-media] [--media-dir dir] [--outputs dir] [--root <checkout>]
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const thisRepo = path.resolve(here, "../../..");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const root = path.resolve(opt("root", thisRepo));
const outFile = opt("out", null);
const codec = opt("codec", "h264");
const seconds = Number(opt("seconds", 60));
const workers = Number(opt("workers", 0));
const outHeight = Number(opt("res", 1080)); // 1080 or 2160 (the export size; --src picks the footage size)
const outWidth = Math.round((outHeight * 16) / 9);
const srcHeight = Number(opt("src", 1080));
const srcWidth = Math.round((srcHeight * 16) / 9);
const clean = flag("clean"); // footage without the noise filter (the default noisy pattern makes lossy encoders diverge on any input change)
const gradeAll = flag("grade-all"); // a colour grade on every video clip, no blur / glow (so the whole chain can run on the GPU)
const consoleLog = [];
const skip = new Set(opt("skip", "").split(",").filter(Boolean));
const mediaDir = path.resolve(opt("media-dir", path.join(os.tmpdir(), "orbench-export-media")));
const outputsDir = path.resolve(opt("outputs", fs.mkdtempSync(path.join(os.tmpdir(), "orbench-export-out-"))));
fs.mkdirSync(outputsDir, { recursive: true });
const ffmpeg = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const log = (...a) => console.error("[export-parallel-bench]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;

const require = createRequire(path.join(thisRepo, "package.json"));
const { _electron } = (() => {
  const pnpmDir = path.join(thisRepo, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((d) => d.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
})();

// ------------------------------------------------------------------------------------------------ media

const CLIP_SECONDS = Math.ceil(seconds / 3);
function ensureMedia() {
  fs.mkdirSync(mediaDir, { recursive: true });
  const files = [];
  const hues = [0, 70, 140, 210];
  for (let i = 0; i < 4; i++) {
    const file = path.join(mediaDir, `hd${clean ? "c" : ""}${srcHeight}-${CLIP_SECONDS}s-${i}.mp4`);
    files.push(file);
    if (fs.existsSync(file) && fs.statSync(file).size > 1e5) continue;
    log("generating", file);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=s=${srcWidth}x${srcHeight}:r=30,${clean ? "" : "noise=alls=12:allf=t,"}hue=h=${hues[i]}`, "-f", "lavfi", "-i", `sine=frequency=${300 + i * 90}:sample_rate=48000`, "-t", String(CLIP_SECONDS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "60", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  }
  const bed = path.join(mediaDir, `bed-${seconds}s.wav`);
  if (!fs.existsSync(bed)) execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000", "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000", "-filter_complex", "[0][1]amerge=inputs=2", "-t", String(seconds + 2), "-c:a", "pcm_s16le", bed]);
  files.push(bed);
  return files;
}

// ------------------------------------------------------------------------------------------------ process metrics

const electronSeen = new Map(); // pid -> {type, cpuMs, wsMB}
const sidecarSeen = new Map(); // pid -> {cpuMs, rssMB}
let peakRssMB = 0;
let sampler = null;
const parseTime = (t) => { const [m, s] = t.split(":"); return (Number(m) * 60 + Number(s)) * 1000; };
async function sample(app) {
  const e = await app.evaluate(({ app: a }) => ({ pid: process.pid, metrics: a.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.cumulativeCPUUsage, ws: m.memory.workingSetSize })) })).catch(() => null);
  if (!e) return; // the main-process evaluate can race a window navigation
  let rss = 0;
  for (const m of e.metrics) {
    const prev = electronSeen.get(m.pid);
    electronSeen.set(m.pid, { type: m.type, cpuMs: Math.max(prev?.cpuMs ?? 0, m.cpu * 1000), wsMB: m.ws / 1024 });
    rss += m.ws / 1024;
  }
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,time=,rss=,command="], { encoding: "utf8" }).stdout.split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4);
  const kids = new Map();
  for (const [pid, ppid, time, rssKb] of ps) kids.set(Number(pid), { ppid: Number(ppid), time, rss: Number(rssKb) });
  const known = new Set(e.metrics.map((m) => m.pid));
  const isDesc = (pid) => { for (let cur = kids.get(pid)?.ppid, n = 0; cur && n < 8; cur = kids.get(cur)?.ppid, n++) if (cur === e.pid) return true; return false; };
  for (const [pid, k] of kids) {
    if (known.has(pid) || !isDesc(pid)) continue;
    const prev = sidecarSeen.get(pid);
    sidecarSeen.set(pid, { cpuMs: Math.max(prev?.cpuMs ?? 0, parseTime(k.time)), rssMB: k.rss / 1024 });
    rss += k.rss / 1024;
  }
  for (const pid of sidecarSeen.keys()) if (!kids.has(pid)) sidecarSeen.get(pid).rssMB = 0;
  peakRssMB = Math.max(peakRssMB, rss);
}
const cpuTotals = () => ({
  electronMs: r1([...electronSeen.values()].reduce((a, v) => a + v.cpuMs, 0)),
  sidecarMs: r1([...sidecarSeen.values()].reduce((a, v) => a + v.cpuMs, 0)),
  byType: Object.fromEntries([...electronSeen.values()].reduce((m, v) => m.set(v.type, (m.get(v.type) ?? 0) + v.cpuMs), new Map())),
});

// ------------------------------------------------------------------------------------------------ app

async function launch(userData) {
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${userData}`, "--js-flags=--expose-gc"],
    env: { ...process.env, OPENREEL_PERF: "1", OPENREEL_FFMPEG_PATH: ffmpeg, OPENREEL_SKIP_ONBOARDING: "1" },
    timeout: 120000,
  });
  const hook = (w) => w.on("console", (m) => { const t = m.text(); if (t.startsWith("[export")) consoleLog.push(t); else if (m.type() === "error" || m.type() === "warning") consoleLog.push(`[console-${m.type()}] ${t.slice(0, 300)}`); });
  app.on("window", hook);
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on("data", (d) => { const t = String(d); if (process.env.BENCH_MAIN_ALL || /error|fail|ffmpeg|frame/i.test(t)) consoleLog.push(`[main] ${t.slice(0, 1500)}`); });
  const page = await app.firstWindow();
  hook(page);
  await page.addInitScript(({ gpuReadbackOff, yuvOn }) => {
    try {
      localStorage.setItem("openreel-stage-profile", "1");
      if (gpuReadbackOff) localStorage.setItem("openreel-gpu-readback", "off");
      localStorage.setItem("openreel-yuv-input", yuvOn ? "on" : "off");
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
      localStorage.setItem("openreel-render-cache-prefs", JSON.stringify({ resolution: "full", idleRender: false }));
    } catch { /* storage unavailable */ }
  }, { gpuReadbackOff: flag("gpu-readback-off"), yuvOn: flag("yuv-on") && !flag("yuv-off") });
  await page.reload();
  return { app, page };
}

async function enterEditor(page) {
  const close = page.getByRole("button", { name: "Close dialog" });
  if (await close.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    await close.click();
    await close.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  }
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60000 });
  await page.locator('canvas[aria-label^="Program"]').first().waitFor({ timeout: 60000 });
  await page.waitForSelector("[data-timeline-ruler]", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__openreelE2E?.project && window.__openreelE2E?.exportQueue), undefined, { timeout: 30000 });
  const skipTour = page.getByText("Skip Tour");
  await skipTour.waitFor({ timeout: 1500 }).then(() => skipTour.click()).catch(() => {});
}

async function buildProject(page, files, total) {
  await page.locator('[data-tour="assets"] input[type="file"]').first().setInputFiles(files);
  await page.waitForFunction((n) => window.__openreelE2E.project.getState().project.mediaLibrary.items.length >= n, files.length, { timeout: 300000, polling: 200 });
  return page.evaluate(async ({ clipSeconds, total, gradeAll }) => {
    const h = window.__openreelE2E;
    const st = () => h.project.getState();
    const media = (needle) => st().project.mediaLibrary.items.filter((m) => m.name.includes(needle));
    const clips = media("hd").sort((a, b) => a.name.localeCompare(b.name));
    const bed = media("bed-")[0];
    const clipsOf = (trackId) => st().project.timeline.tracks.find((t) => t.id === trackId).clips;
    const place = async (trackId, mediaId, start, outPt) => {
      const r = await st().addClip(trackId, mediaId, start);
      if (!r.success) throw new Error(`addClip: ${JSON.stringify(r.error)}`);
      const clip = clipsOf(trackId).filter((c) => Math.abs(c.startTime - start) < 1e-6).pop() ?? clipsOf(trackId).at(-1);
      if (outPt != null) await st().trimClip(clip.id, 0, outPt);
      return st().getClip(clip.id) ?? clip;
    };
    const lut = (size, gain) => {
      const data = [];
      for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) data.push(Math.min(1, (r / (size - 1)) * gain), (g / (size - 1)) * 0.96, Math.min(1, (b / (size - 1)) * (gain + 0.04)));
      return { data, size, intensity: 0.8 };
    };
    const built = { videoClips: 0, effects: 0, transitions: 0, titles: 0, audioTracks: 0 };
    await st().addTrack("video", undefined, { trackId: "eb-v1", name: "V1" });
    const placed = [];
    for (let i = 0; i < 3; i++) placed.push(await place("eb-v1", clips[i].id, i * clipSeconds, clipSeconds));
    built.videoClips += 3;
    if (gradeAll) {
      await st().updateColorGrading(placed[0].id, { tone: { exposure: 0.15, contrast: 0.08, highlights: -0.1, shadows: 0.1, whites: 0, blacks: 0 }, temperature: -6, colorWheels: { shadows: { r: 0.02, g: 0, b: 0.05 }, midtones: { r: 0, g: 0, b: 0 }, highlights: { r: 0.04, g: 0.02, b: 0 }, shadowsLift: 0.02, midtonesGamma: 1, highlightsGain: 1.02 } }); built.effects++;
      await st().updateColorGrading(placed[1].id, { temperature: 14, lut: lut(17, 1.04) }); built.effects += 2;
      await st().updateColorGrading(placed[2].id, { tone: { exposure: -0.1, contrast: 0.05, highlights: 0, shadows: 0.05, whites: 0, blacks: 0 }, tint: 5, vignette: { amount: -0.3, midpoint: 0.5, roundness: 0, feather: 0.5 } }); built.effects++;
    } else {
    await st().addVideoEffect(placed[0].id, "gaussian-blur", { radius: 4 }); built.effects++;
    await st().updateColorGrading(placed[1].id, { temperature: 14, saturation: 108, contrast: 6, lut: lut(17, 1.04) }); built.effects += 2;
    await st().addVideoEffect(placed[2].id, "glow", { radius: 18, intensity: 1.2, color: "#ffd9a0" }); built.effects++;
    }
    for (const [from, to, type] of [[placed[0], placed[1], "crossfade"], [placed[1], placed[2], "wipe"]]) {
      const t = await st().addClipTransition({ id: `eb-tr-${type}`, clipAId: from.id, clipBId: to.id, type, duration: 1, params: {} });
      if (t) built.transitions++;
    }
    await st().addTrack("video", undefined, { trackId: "eb-v2", name: "V2" });
    const v2 = await place("eb-v2", clips[3].id, 0, clipSeconds);
    await st().updateClipTransform(v2.id, { scale: { x: 0.4, y: 0.4 }, position: { x: 0.3, y: -0.25 }, opacity: 0.92 });
    await st().updateColorGrading(v2.id, gradeAll ? { tone: { exposure: 0.2, contrast: 0.1, highlights: 0, shadows: 0, whites: 0, blacks: 0 }, temperature: 8 } : { exposure: 0.2, saturation: 112 }); built.effects++;
    built.videoClips++;
    await st().addTrack("text", undefined, { trackId: "eb-t1", name: "Titles" });
    for (const [i, text] of ["OPENREEL", "Parallel segment export", "Heavy 1080p project"].entries()) {
      if (st().createTextClip("eb-t1", 2 + i * (clipSeconds - 1), text, 4, { fontSize: 96, color: "#ffffff" })) built.titles++;
    }
    for (let i = 0; i < 4; i++) {
      await st().addTrack("audio", undefined, { trackId: `eb-a${i + 1}`, name: `A${i + 1}` });
      await place(`eb-a${i + 1}`, bed.id, 0, total);
      built.audioTracks++;
    }
    const tl = st().project.timeline;
    built.tracks = tl.tracks.length;
    built.duration = Math.max(...tl.tracks.flatMap((t) => t.clips.map((cl) => cl.startTime + cl.duration)));
    built.frameRate = st().project.settings.frameRate;
    built.size = `${st().project.settings.width}x${st().project.settings.height}`;
    return built;
  }, { clipSeconds: CLIP_SECONDS, total: seconds, gradeAll });
}

async function waitIdle(app, page) {
  let quiet = 0;
  let last = cpuTotals().sidecarMs;
  for (let i = 0; i < 1800 && quiet < 6; i++) {
    await sample(app);
    const now = cpuTotals().sidecarMs;
    quiet = now - last > 60 ? 0 : quiet + 1;
    last = now;
    await sleep(500);
  }
}

// ------------------------------------------------------------------------------------------------ runs

const settingsFor = (mode) => ({
  format: codec === "prores" ? "mov" : "mp4",
  codec,
  width: outWidth,
  height: outHeight,
  frameRate: 30,
  bitrate: 8000,
  quality: 80,
  encodeMode: "balanced",
  encoderChoice: opt("encoder", "software"),
  smartRender: false,
  keyframeInterval: 60,
  ...(codec === "prores" ? { proresProfile: "standard" } : {}),
  ...(mode.startsWith("serial") ? { parallelSegments: "off" } : {}),
});

async function runMode(app, page, mode) {
  await page.evaluate((w) => { window.__openreelSegmentWorkers = w; }, mode.startsWith("plan1") ? 1 : workers > 0 && mode === "parallel" ? workers : undefined);
  if (sampler) clearInterval(sampler);
  sampler = setInterval(() => { sample(app).catch(() => {}); }, 250);
  const id = await page.evaluate((payload) => {
    const h = window.__openreelE2E;
    const job = h.exportQueue.getState().enqueue(payload);
    if (!job) throw new Error("nothing was queued");
    h.exportQueue.getState().start();
    return job.id;
  }, { settings: settingsFor(mode), presetLabel: `bench-${mode}`, usePreviews: false });
  let job;
  // Time and CPU are counted from the moment the job is running (the queue may wait for other work first).
  let t0 = Date.now();
  let cpu0 = cpuTotals();
  let load0 = os.loadavg()[0];
  for (let i = 0; i < 6000; i++) {
    if (!job || job.status === "queued") { t0 = Date.now(); cpu0 = cpuTotals(); load0 = os.loadavg()[0]; peakRssMB = 0; }
    job = await page.evaluate((jobId) => {
      const x = window.__openreelE2E.exportQueue.getState().queue.jobs.find((y) => y.id === jobId);
      return x && { status: x.status, phase: x.phase, progress: x.progress, error: x.error, output: x.output, elapsedMs: x.elapsedMs };
    }, id);
    if (["completed", "failed", "cancelled"].includes(job.status)) break;
    await sleep(500);
  }
  const wallMs = Date.now() - t0;
  clearInterval(sampler);
  sampler = null;
  await sample(app);
  const cpu1 = cpuTotals();
  const load1 = os.loadavg()[0];
  if (job.status !== "completed") { log("console during the failed run:\n" + consoleLog.join("\n")); throw new Error(`${mode}: ${job.status} ${job.error ?? ""}`); }
  const dest = path.join(outputsDir, `${mode}.${codec === "prores" ? "mov" : "mp4"}`);
  fs.copyFileSync(job.output.path, dest);
  return {
    mode,
    wallMs,
    jobElapsedMs: Math.round(job.elapsedMs),
    cpuMs: r1(cpu1.electronMs + cpu1.sidecarMs - cpu0.electronMs - cpu0.sidecarMs),
    electronCpuMs: r1(cpu1.electronMs - cpu0.electronMs),
    sidecarCpuMs: r1(cpu1.sidecarMs - cpu0.sidecarMs),
    cpuByType: Object.fromEntries(Object.entries(cpu1.byType).map(([k, v]) => [k, r1(v - (cpu0.byType[k] ?? 0))])),
    cpuPctOfOneCore: r1(((cpu1.electronMs + cpu1.sidecarMs - cpu0.electronMs - cpu0.sidecarMs) / wallMs) * 100),
    loadAvg1m: { before: Math.round(load0 * 100) / 100, after: Math.round(load1 * 100) / 100 },
    peakRssMB: r1(peakRssMB),
    file: dest,
    bytes: fs.statSync(dest).size,
  };
}

// ------------------------------------------------------------------------------------------------ comparison

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
function frameMd5(file) {
  const out = run(ffmpeg, ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"]).stdout;
  return out.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim());
}
function probe(file) {
  const j = JSON.parse(run(ffprobe, ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,nb_read_frames,duration,start_time,r_frame_rate,width,height", "-of", "json", file]).stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  return { codec: v.codec_name, size: `${v.width}x${v.height}`, rate: v.r_frame_rate, frames: Number(v.nb_read_frames), videoStart: Number(v.start_time), videoDuration: Number(v.duration), audioStart: a ? Number(a.start_time) : null, audioDuration: a ? Number(a.duration) : null };
}
function audioMd5(file) {
  return run(ffmpeg, ["-v", "error", "-i", file, "-map", "0:a:0", "-c", "copy", "-f", "md5", "-"]).stdout.trim();
}
function psnr(a, b) {
  const m = /average:([\d.]+|inf)/.exec(run(ffmpeg, ["-v", "info", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"]).stderr);
  return m ? m[1] : null;
}
function compare(label, aFile, bFile) {
  const a = frameMd5(aFile);
  const b = frameMd5(bFile);
  const same = a.filter((h, i) => h === b[i]).length;
  const firstDiff = a.findIndex((h, i) => h !== b[i]);
  return {
    label,
    frames: [a.length, b.length],
    framesIdentical: same,
    allFramesIdentical: a.length === b.length && same === a.length,
    firstDifferingFrame: a.length === b.length ? firstDiff : null,
    sampleEvery50: a.length === b.length ? Array.from({ length: Math.ceil(a.length / 50) }, (_, i) => i * 50).every((i) => a[i] === b[i]) : false,
    psnrDb: same === a.length && a.length === b.length ? "inf" : psnr(aFile, bFile),
    audioIdentical: audioMd5(aFile) === audioMd5(bFile),
  };
}

// ------------------------------------------------------------------------------------------------ main

const work = fs.mkdtempSync(path.join(os.tmpdir(), "orbench-export-run-"));
const result = { codec, seconds, res: `${outWidth}x${outHeight}`, src: `${srcWidth}x${srcHeight}`, gradeAll, machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30), platform: `${process.platform}-${process.arch}` }, runs: [], comparisons: [] };
let app;
try {
  const files = ensureMedia();
  const launched = await launch(path.join(work, "user-data"));
  app = launched.app;
  const { page } = launched;
  await enterEditor(page);
  result.project = await buildProject(page, files, seconds);
  log("project", JSON.stringify(result.project));
  await waitIdle(app, page);
  for (const mode of opt("modes", "serial,plan1,parallel").split(",")) {
    if (skip.has(mode)) continue;
    log("running", mode);
    const r = await runMode(app, page, mode);
    log(mode, `wall ${r.wallMs} ms, cpu ${r.cpuMs} ms, peak ${r.peakRssMB} MB`);
    r.consoleLog = consoleLog.splice(0);
    result.runs.push(r);
    await waitIdle(app, page);
  }
  const by = Object.fromEntries(result.runs.map((r) => [r.mode, r]));
  for (const r of result.runs) result.probe = { ...(result.probe ?? {}), [r.mode]: probe(r.file) };
  if (by.serial && by.parallel) result.comparisons.push(compare("serial (single stream) vs parallel", by.serial.file, by.parallel.file));
  if (by.plan1 && by.parallel) result.comparisons.push(compare("same plan, one segment at a time vs parallel", by.plan1.file, by.parallel.file));
  if (by.plan1 && by.plan1b) result.comparisons.push(compare("same plan one at a time, twice (is the segmented export repeatable?)", by.plan1.file, by.plan1b.file));
  if (by.serial && by.serial2) result.comparisons.push(compare("serial vs serial again (is the single-stream export itself repeatable?)", by.serial.file, by.serial2.file));
  if (by.serial && by.plan1) result.comparisons.push(compare("serial (single stream) vs same plan one at a time", by.serial.file, by.plan1.file));
  if (by.serial && by.parallel) result.speedup = { wall: r1(by.serial.wallMs / by.parallel.wallMs * 100) / 100, cpuRatio: r1(by.parallel.cpuMs / by.serial.cpuMs * 100) / 100 };
} finally {
  if (sampler) clearInterval(sampler);
  if (app) {
    const proc = app.process();
    await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}), sleep(4000)]);
    await sleep(300);
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
  }
  fs.rmSync(work, { recursive: true, force: true });
  if (!flag("keep-media")) fs.rmSync(mediaDir, { recursive: true, force: true });
}
const text = JSON.stringify(result, null, 2);
if (outFile) fs.writeFileSync(outFile, text);
console.log(text);
