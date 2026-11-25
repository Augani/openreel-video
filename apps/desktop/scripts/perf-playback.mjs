#!/usr/bin/env node
/**
 * Heavy-project playback benchmark for the OpenReel desktop (Electron) build ("Mercury playback" gate).
 * Opt-in: NOT part of perf:budget and never gated; it prints a table and writes JSON.
 *
 * Drives the BUILT app (Playwright _electron, throw-away --user-data-dir) with a generated heavy project:
 *   media     4K H.264 30 / 60 fps, 4K HEVC 30 / 60 fps, 1080p ProRes 422 (when the encoder exists), a stereo bed
 *   timeline  4 video tracks (cuts + crossfade/wipe transitions, blur, glow, colour grade, 17^3 LUT, scaled overlays),
 *             a titles track, 10 audio tracks
 * and measures, at full and 1/2 playback resolution:
 *   playback  dropped frames over --play-seconds (30) from the editor's own paint log (no read-back), frame interval
 *             p50/p95/max, watchdog stalls, rAF stats, CPU time per Electron process type + the ffmpeg sidecar
 *   scrub     click-seek latency p50/p95 (pointerdown to the exact frame visible; plus first pixel change)
 *   interact  ctrl+wheel zoom, scroll and clip-drag frame times on the heavy timeline
 *   open      project open time (saved .oreel -> clips on the timeline -> first lit frame)
 *   memory    JS heap and RSS (working set / private) per process type
 * Every run records the 1-minute load average. Wall-clock results are only JUDGED when the load is < 4
 * (`wallClockJudged`); above that the table still prints them but flags them, and the CPU-time rows are the numbers
 * to compare.
 *
 * Needs a renderer built with the e2e hooks (they build the project through the store):
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Usage: node scripts/perf-playback.mjs [--root <checkout>] [--label name] [--out file.json]
 *          [--only playback,scrub,interact,open,memory] [--play-seconds 30] [--scrubs 20] [--runs 1]
 *          [--media-dir dir] [--keep-media] [--profile]   (--profile: renderer CPU profile of the full-res pass)
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePlayback } from "./perf-analysis.mjs";
import { frameStats, installMonitor, median, pct, r1, rulerMap, scrubClicks, sleep } from "./lib/perf-probes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const thisRepo = path.resolve(here, "../../..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const root = path.resolve(opt("root", thisRepo));
const label = opt("label", path.basename(root));
const outFile = opt("out", null);
const only = new Set(opt("only", "playback,scrub,interact,open,memory").split(","));
const playSeconds = Number(opt("play-seconds", 30));
const scrubCount = Number(opt("scrubs", 20));
const runs = Number(opt("runs", 1));
const LOAD_JUDGE_MAX = 4;
/** Transition shape of the generated project: --transition-seconds 1, --transition-alignment center|start|end (center = default). */
const TRANSITION = { seconds: Number(opt("transition-seconds", 1)), alignment: opt("transition-alignment", "") };
const firstTransitionStartS = 12 - (TRANSITION.alignment === "end" ? TRANSITION.seconds : TRANSITION.alignment === "start" ? 0 : TRANSITION.seconds / 2);
/** --transition-renderer canvas2d pins transitions to the Canvas2D engine (the A side of a GPU-vs-Canvas2D comparison). */
const TRANSITION_RENDERER = opt("transition-renderer", "");
/** --grade-renderer canvas2d pins the clip effect / grade chain to the Canvas2D / WebGL path (the A side of a WebGPU-grade comparison). */
const GRADE_RENDERER = opt("grade-renderer", "");
/** --grade-every-clip puts a full colour grade (Basic Correction, wheels, curves, HSL, LUT, vignette, white balance) on every video clip. */
const GRADE_EVERY_CLIP = flag("grade-every-clip");
const ffmpeg = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";

const require = createRequire(path.join(thisRepo, "package.json"));
const { _electron } = (() => {
  const pnpmDir = path.join(thisRepo, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((d) => d.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
})();

const mediaDir = path.resolve(opt("media-dir", path.join(os.tmpdir(), "orperf-playback-media")));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "orperf-playback-run-"));
const log = (...a) => console.error(`[perf-playback ${label}]`, ...a);
const loadSamples = [];
const sampleLoad = () => { const v = Math.round(os.loadavg()[0] * 100) / 100; loadSamples.push(v); return v; };

// ---------------------------------------------------------------------------------------------- media

const CLIP_SECONDS = 36;
function encoders() {
  return execFileSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
}
/** Generated once per --media-dir. Content is noisy test pattern so the decoders do real work. */
function ensureMedia() {
  fs.mkdirSync(mediaDir, { recursive: true });
  const enc = encoders();
  const have = (name) => new RegExp(`\\s${name}\\s`).test(enc);
  const src = (size, fps, t, extra = "") => ["-f", "lavfi", "-i", `testsrc2=s=${size}:r=${fps},noise=alls=10:allf=t${extra}`, "-t", String(t)];
  const specs = [
    { name: "uhd-h264-30.mp4", args: [...src("3840x2160", 30, CLIP_SECONDS), "-c:v", "libx264", "-preset", "ultrafast", "-g", "60", "-b:v", "40M", "-pix_fmt", "yuv420p"] },
    { name: "uhd-h264-60.mp4", args: [...src("3840x2160", 60, CLIP_SECONDS, ",hue=h=60"), "-c:v", "libx264", "-preset", "ultrafast", "-g", "120", "-b:v", "60M", "-pix_fmt", "yuv420p"] },
    {
      name: "uhd-hevc-30.mp4",
      args: [...src("3840x2160", 30, CLIP_SECONDS, ",hue=h=120"), ...(have("hevc_videotoolbox") ? ["-c:v", "hevc_videotoolbox", "-b:v", "30M"] : ["-c:v", "libx265", "-preset", "ultrafast", "-b:v", "30M"]), "-tag:v", "hvc1", "-pix_fmt", "yuv420p"],
    },
    {
      name: "uhd-hevc-60.mp4",
      args: [...src("3840x2160", 60, CLIP_SECONDS, ",hue=h=200"), ...(have("hevc_videotoolbox") ? ["-c:v", "hevc_videotoolbox", "-b:v", "45M"] : ["-c:v", "libx265", "-preset", "ultrafast", "-b:v", "45M"]), "-tag:v", "hvc1", "-pix_fmt", "yuv420p"],
    },
  ];
  if (have("prores_ks") || have("prores")) {
    specs.push({ name: "hd-prores422-25.mov", args: [...src("1920x1080", 25, 24, ",hue=h=280"), "-c:v", have("prores_ks") ? "prores_ks" : "prores", "-profile:v", "2", "-pix_fmt", "yuv422p10le"] });
  }
  specs.push({ name: "bed-48k.wav", args: ["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000", "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000", "-filter_complex", "[0][1]amerge=inputs=2", "-t", "40", "-c:a", "pcm_s16le"] });
  for (const spec of specs) {
    const file = path.join(mediaDir, spec.name);
    if (fs.existsSync(file) && fs.statSync(file).size > 1e5) continue;
    log("generating", spec.name);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...spec.args, file], { stdio: ["ignore", "inherit", "inherit"] });
  }
  return specs.map((s) => path.join(mediaDir, s.name));
}

// ---------------------------------------------------------------------------------------------- launch

async function launch(userData) {
  const load = sampleLoad();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${userData}`, "--js-flags=--expose-gc"],
    env: { ...process.env, OPENREEL_PERF: "1", OPENREEL_FFMPEG_PATH: ffmpeg, OPENREEL_SKIP_ONBOARDING: "1" },
    timeout: 120000,
  });
  startSidecarSampler(app);
  const page = await app.firstWindow();
  await page.addInitScript(([renderer, gradeRenderer]) => {
    try {
      if (renderer) localStorage.setItem("openreel-transition-renderer", renderer);
      if (gradeRenderer) localStorage.setItem("openreel-grade-renderer", gradeRenderer);
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch { /* storage unavailable */ }
  }, [TRANSITION_RENDERER, GRADE_RENDERER]);
  await page.reload();
  return { app, page, load };
}

async function closeApp(app) {
  clearInterval(sidecarTimer);
  const proc = app.process();
  await Promise.race([app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}), sleep(4000)]);
  await sleep(300);
  try { proc.kill("SIGKILL"); } catch { /* gone */ }
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
  await page.waitForFunction(() => Boolean(window.__openreelE2E?.projectFile && window.__openreelE2E?.renderCache), undefined, { timeout: 30000 });
  const skip = page.getByText("Skip Tour");
  await skip.waitFor({ timeout: 1500 }).then(() => skip.click()).catch(() => {});
}

// ---------------------------------------------------------------------------------------------- process metrics

/**
 * ffmpeg decode / probe sidecars are children of the main process but not Electron processes, and they come and go:
 * `ps` TIME of an exited one disappears. Every pid ever seen keeps its LAST observed CPU time, so deltas of the sum stay
 * monotonic as long as the sampler (a 250 ms timer plus every snapshot) sees a sidecar before it exits.
 */
const sidecarSeen = new Map();
function sampleSidecars(mainPid, known) {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,time=,rss=,command="], { encoding: "utf8" }).stdout.split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4);
  const kids = new Map();
  for (const [pid, ppid, time, rss, ...cmd] of ps) kids.set(Number(pid), { ppid: Number(ppid), time, rss: Number(rss), cmd: cmd.join(" ") });
  const parseTime = (t) => { const [m, s] = t.split(":"); return (Number(m) * 60 + Number(s)) * 1000; };
  const descendant = (pid) => { for (let cur = kids.get(pid)?.ppid, n = 0; cur && n < 8; cur = kids.get(cur)?.ppid, n++) if (cur === mainPid) return true; return false; };
  for (const [pid, k] of kids) if (!known.has(pid) && descendant(pid)) sidecarSeen.set(pid, { cpuMs: parseTime(k.time), rssMB: k.rss / 1024, kind: sidecarKind(k.cmd) });
  for (const pid of sidecarSeen.keys()) if (!kids.has(pid)) sidecarSeen.get(pid).rssMB = 0;
}
/** What a sidecar is doing, from its command line: `ffmpeg:<input basename>:<role>` (decode stream, proxy, thumbnails, probe...). */
function sidecarKind(cmd) {
  const exe = path.basename(cmd.split(" ")[0]);
  const input = /-i\s+(\S+)/.exec(cmd)?.[1];
  const role = /rawvideo|pipe:1/.test(cmd) ? (/scale=\d+:\d+/.test(cmd) ? "decode-stream" : "pipe") : /\.(mp4|mov|m4a|wav)\b.*\.(mp4|mov)\b/.test(cmd) ? "transcode" : "other";
  return `${exe}:${input ? path.basename(input) : "?"}:${role}`;
}
/** Sidecar CPU per kind between two snapshots' worth of `sidecarSeen` (diagnostic for the report). */
function sidecarByKind(before) {
  const out = {};
  for (const [pid, v] of sidecarSeen) out[v.kind] = (out[v.kind] ?? 0) + Math.max(0, v.cpuMs - (before.get(pid) ?? 0));
  return Object.fromEntries(Object.entries(out).filter(([, ms]) => ms > 0).map(([k, ms]) => [k, r1(ms)]).sort((a, b) => b[1] - a[1]).slice(0, 8));
}
let sidecarTimer = null;
function startSidecarSampler(app) {
  clearInterval(sidecarTimer);
  sidecarTimer = setInterval(() => { procSnapshot(app).catch(() => {}); }, 250);
}

/** Electron processes by type: CPU ms (cumulative) and working set / private MB, plus ffmpeg & friends under the main pid. */
async function procSnapshot(app) {
  const electron = await app.evaluate(({ app: a }) => ({
    pid: process.pid,
    metrics: a.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.cumulativeCPUUsage, ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? 0 })),
  }));
  const byType = {};
  for (const m of electron.metrics) {
    const t = (byType[m.type] ??= { cpuMs: 0, wsMB: 0, privMB: 0 });
    t.cpuMs += m.cpu * 1000;
    t.wsMB += m.ws / 1024;
    t.privMB += m.priv / 1024;
  }
  sampleSidecars(electron.pid, new Set(electron.metrics.map((m) => m.pid)));
  let sidecarCpuMs = 0, sidecarRssMB = 0;
  for (const v of sidecarSeen.values()) { sidecarCpuMs += v.cpuMs; sidecarRssMB += v.rssMB; }
  byType.Sidecar = { cpuMs: sidecarCpuMs, wsMB: sidecarRssMB, privMB: 0 };
  return byType;
}
function cpuDelta(a, b) {
  const out = {};
  let total = 0;
  for (const type of Object.keys(b)) {
    out[type] = r1(Math.max(0, b[type].cpuMs - (a[type]?.cpuMs ?? 0)));
    total += out[type];
  }
  out.total = r1(total);
  return out;
}
const rssTotal = (snap) => r1(Object.values(snap).reduce((a, t) => a + t.wsMB, 0));

// ---------------------------------------------------------------------------------------------- project build

async function importMedia(page, files) {
  await page.locator('[data-tour="assets"] input[type="file"]').first().setInputFiles(files);
  const t0 = Date.now();
  await page.waitForFunction((n) => window.__openreelE2E.project.getState().project.mediaLibrary.items.length >= n, files.length, { timeout: 300000, polling: 200 });
  return Date.now() - t0;
}

/** Builds the heavy timeline through the store: returns what was built (for the report) or throws. */
async function buildTimeline(page) {
  return page.evaluate(async ([tr, gradeEvery]) => {
    const h = window.__openreelE2E;
    const st = () => h.project.getState();
    const media = (name) => st().project.mediaLibrary.items.find((m) => m.name === name);
    const mid = (name) => { const m = media(name); if (!m) throw new Error(`media ${name} missing`); return m.id; };
    const clipsOf = (trackId) => st().project.timeline.tracks.find((t) => t.id === trackId).clips;
    const place = async (trackId, name, start, inPt, outPt) => {
      const r = await st().addClip(trackId, mid(name), start);
      if (!r.success) throw new Error(`addClip ${name}: ${JSON.stringify(r.error)}`);
      const clip = clipsOf(trackId).filter((c) => Math.abs(c.startTime - start) < 1e-6).pop() ?? clipsOf(trackId).at(-1);
      if (outPt != null) await st().trimClip(clip.id, inPt ?? 0, outPt);
      return st().getClip(clip.id) ?? clip;
    };
    const lut = (size, gain) => {
      const data = [];
      for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) data.push(Math.min(1, (r / (size - 1)) * gain), (g / (size - 1)) * 0.96, Math.min(1, (b / (size - 1)) * (gain + 0.04)));
      return { data, size, intensity: 0.8 };
    };
    const names = { h264_30: "uhd-h264-30.mp4", h264_60: "uhd-h264-60.mp4", hevc_30: "uhd-hevc-30.mp4", hevc_60: "uhd-hevc-60.mp4", prores: "hd-prores422-25.mov", bed: "bed-48k.wav" };
    const built = { videoClips: 0, effects: 0, transitions: 0, titles: 0, audioTracks: 0 };

    // V1: three back-to-back 12 s cuts (4K H.264 30, 4K HEVC 30, 4K H.264 60) with two transitions.
    await st().addTrack("video", undefined, { trackId: "pb-v1", name: "V1" });
    const a = await place("pb-v1", names.h264_30, 0, 0, 12);
    const b = await place("pb-v1", names.hevc_30, 12, 0, 12);
    const c = await place("pb-v1", names.h264_60, 24, 0, 12);
    built.videoClips += 3;
    await st().addVideoEffect(a.id, "gaussian-blur", { radius: 4 }); built.effects++;
    await st().updateColorGrading(b.id, { temperature: 14, saturation: 108, contrast: 6, lut: lut(17, 1.04) }); built.effects += 2;
    await st().addVideoEffect(c.id, "glow", { radius: 18, intensity: 1.2, color: "#ffd9a0" }); built.effects++;
    for (const [from, to, type] of [[a, b, "crossfade"], [b, c, "wipe"]]) {
      const t = await st().addClipTransition({ id: `pb-tr-${type}`, clipAId: from.id, clipBId: to.id, type, duration: tr.seconds, params: tr.alignment ? { alignment: tr.alignment } : {} });
      if (t) built.transitions++;
    }

    // V2: 4K HEVC 60 picture-in-picture for the whole 36 s, graded. V3: 4K H.264 60 from 6 s with a LUT. V4: ProRes 422.
    await st().addTrack("video", undefined, { trackId: "pb-v2", name: "V2" });
    const v2 = await place("pb-v2", names.hevc_60, 0, 0, 36);
    await st().updateClipTransform(v2.id, { scale: { x: 0.45, y: 0.45 }, position: { x: 0.28, y: -0.25 }, opacity: 0.92 });
    await st().updateColorGrading(v2.id, { exposure: 0.2, saturation: 112 }); built.effects++;
    await st().addTrack("video", undefined, { trackId: "pb-v3", name: "V3" });
    const v3 = await place("pb-v3", names.h264_60, 6, 0, 30);
    await st().updateClipTransform(v3.id, { scale: { x: 0.35, y: 0.35 }, position: { x: -0.3, y: 0.25 } });
    await st().updateColorGrading(v3.id, { temperature: -10, lut: lut(17, 0.98) }); built.effects += 2;
    built.videoClips += 2;
    if (media(names.prores)) {
      await st().addTrack("video", undefined, { trackId: "pb-v4", name: "V4" });
      const v4 = await place("pb-v4", names.prores, 10, 0, 20);
      await st().updateClipTransform(v4.id, { scale: { x: 0.3, y: 0.3 }, position: { x: 0.3, y: 0.3 } });
      built.videoClips++;
    }

    // Optional: a full grade on every video clip (the benchmark of the WebGPU grade chain).
    if (gradeEvery) {
      const grade = (i) => ({
        temperature: 6 + i, tint: -3,
        tone: { exposure: 0.1, contrast: 0.2, highlights: -0.15, shadows: 0.2, whites: 0.05, blacks: -0.05 },
        colorWheels: { shadows: { r: 0.02, g: 0, b: 0.04 }, midtones: { r: 0, g: 0.01, b: 0 }, highlights: { r: 0.03, g: 0.01, b: -0.02 }, shadowsLift: 0.02, midtonesGamma: 1.1, highlightsGain: 1.05 },
        curves: { rgb: [{ x: 0, y: 0 }, { x: 0.3, y: 0.24 }, { x: 0.75, y: 0.8 }, { x: 1, y: 1 }], red: [{ x: 0, y: 0 }, { x: 1, y: 1 }], green: [{ x: 0, y: 0 }, { x: 1, y: 1 }], blue: [{ x: 0, y: 0.02 }, { x: 1, y: 0.98 }] },
        hsl: { hue: [4, 0, 0, 0, 0, 0, 0, 0], saturation: [0.08, 0, 0, 0, 0.06, 0, 0, 0.05], luminance: [0, 0, 0, 0.02, 0, 0, 0, 0] },
        vignette: { amount: -0.25, midpoint: 0.5, roundness: 0, feather: 0.5 },
        lut: lut(17, 1 - i * 0.01),
      });
      let i = 0;
      for (const track of st().project.timeline.tracks) {
        if (track.type !== "video") continue;
        for (const clip of [...track.clips]) { await st().updateColorGrading(clip.id, grade(i++)); built.effects++; }
      }
      built.gradedEveryClip = i;
    }

    // Titles
    await st().addTrack("text", undefined, { trackId: "pb-t1", name: "Titles" });
    for (const [i, text] of ["OPENREEL", "Heavy project benchmark", "Mercury playback"].entries()) {
      const t = st().createTextClip("pb-t1", 2 + i * 11, text, 4, { fontSize: 96, color: "#ffffff" });
      if (t) built.titles++;
    }

    // 10 audio tracks of the stereo bed
    for (let i = 0; i < 10; i++) {
      await st().addTrack("audio", undefined, { trackId: `pb-a${i + 1}`, name: `A${i + 1}` });
      await place(`pb-a${i + 1}`, names.bed, 0, 0, 36);
      built.audioTracks++;
    }
    const tl = st().project.timeline;
    built.tracks = tl.tracks.length;
    built.duration = Math.max(...tl.tracks.flatMap((t) => t.clips.map((cl) => cl.startTime + cl.duration)));
    built.frameRate = st().project.settings.frameRate;
    built.size = `${st().project.settings.width}x${st().project.settings.height}`;
    return built;
  }, [TRANSITION, GRADE_EVERY_CLIP]);
}

/**
 * Waits until background work that would pollute a measurement is over: preview proxy / ingest transcodes (ffmpeg
 * children of the main process), background tasks and proxy entries still pending. Returns how long it took and the
 * sidecar CPU that work cost (reported: it is the import-time price of the heavy project).
 */
async function waitSettled(app, page, maxMs = 900000) {
  const t0 = Date.now();
  const cpu0 = [...sidecarSeen.values()].reduce((a, v) => a + v.cpuMs, 0);
  let quiet = 0;
  let lastCpu = cpu0;
  // A paused native-decode stream stays alive (back-pressure) without using CPU: "quiet" means no sidecar gained CPU.
  while (Date.now() - t0 < maxMs && quiet < 6) {
    await procSnapshot(app);
    const nowCpu = [...sidecarSeen.values()].reduce((a, v) => a + v.cpuMs, 0);
    const sidecarsBusy = nowCpu - lastCpu > 60;
    lastCpu = nowCpu;
    const pending = await page.evaluate(() => {
      const h = window.__openreelE2E;
      let n = 0;
      try { for (const e of Object.values(h.proxy.cache.store.getState().entries)) if (e.status === "pending" || e.status === "running" || e.status === "generating") n++; } catch { /* no proxy store */ }
      try { n += (h.backgroundTasks.list?.() ?? []).filter((t) => t.status === "running" || t.status === "queued").length; } catch { /* no registry */ }
      return n;
    });
    quiet = !sidecarsBusy && pending === 0 ? quiet + 1 : 0;
    await sleep(500);
  }
  return { settleMs: Date.now() - t0, settleSidecarCpuMs: r1([...sidecarSeen.values()].reduce((a, v) => a + v.cpuMs, 0) - cpu0), settleTimedOut: quiet < 6 };
}

// ---------------------------------------------------------------------------------------------- scenarios

const SAVE_KEY = process.platform === "darwin" ? "Meta+s" : "Control+s";
async function stubDialogs(app, answers) {
  await app.evaluate(({ dialog }, a) => {
    dialog.showOpenDialog = async () => (a.open ? { canceled: false, filePaths: [a.open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => (a.save ? { canceled: false, filePath: a.save } : { canceled: true });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, answers);
}

/**
 * Top self-time functions of a CDP CPU profile. Native builtins (createImageBitmap, getImageData, texImage2D, GC...) are
 * listed with their nearest JS caller (`native <- caller`), which is what says WHICH stage owns the time.
 */
const topFunctions = (profile, n = 25) => {
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    if (f.functionName === "(idle)" || f.functionName === "(program)") return;
    let k = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}`;
    if (!f.url) {
      let cur = parent.get(id);
      while (cur !== undefined && !byId.get(cur).callFrame.url) cur = parent.get(cur);
      // two JS frames up gives the stage (e.g. applyCpuGrading <- processColorGrading)
      const c1 = cur !== undefined ? byId.get(cur).callFrame : null;
      const c2 = cur !== undefined && parent.get(cur) !== undefined ? byId.get(parent.get(cur)).callFrame : null;
      const name = (c) => (c ? `${c.functionName || "(anon)"}:${c.lineNumber}` : "?");
      k += ` <- ${name(c1)} <- ${name(c2)}`;
    }
    self.set(k, (self.get(k) ?? 0) + profile.timeDeltas[i] / 1000);
  });
  return [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${r1(v)} ms  ${k}`);
};

async function seekToStart(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
  const map = await rulerMap(page);
  await page.mouse.click(map.x0 + 0.5 * map.pxPerSec, map.y);
  await sleep(1200);
}

/** Waits (no input) until no yellow/red stretch is left uncached, i.e. background rendering has finished. */
async function waitForIdleRender(page, timeoutMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await page.evaluate(() => {
      const st = window.__openreelE2E.renderCache.getStatus();
      const pending = st.segments.filter((s) => s.level !== "cached");
      return { rendering: st.rendering, frames: st.frameCount, pendingS: Math.round(pending.reduce((a, s) => a + s.end - s.start, 0) * 10) / 10, bytesMB: Math.round(st.bytes / 1048576) };
    });
    if (!last.rendering && last.pendingS === 0) break;
    await sleep(2000);
  }
  return { waitedMs: Date.now() - t0, ...last, timedOut: Date.now() - t0 >= timeoutMs };
}

async function playbackPass(app, page, quality, fps) {
  await page.evaluate((legacy) => { window.__orLegacyLookahead = legacy; }, flag("legacy-lookahead"));
  await page.evaluate((q) => window.__openreelE2E.ui.getState().setPlaybackQuality(q), quality);
  await sleep(800);
  await seekToStart(page);
  const cdp = flag("profile") && quality === "full" ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 }); await cdp.send("Profiler.start"); }
  const gradeBefore = await page.evaluate(() => window.__openreelE2E.gradeChainStats?.() ?? null);
  await page.evaluate(() => { window.__openreelE2E.renderCache.resetTelemetry(); window.__perfMon.start(false); });
  const before = await procSnapshot(app);
  const sidecarBefore = new Map([...sidecarSeen].map(([pid, v]) => [pid, v.cpuMs]));
  const load0 = sampleLoad();
  const startedAt = await page.evaluate(() => performance.now());
  const t0 = Date.now();
  await page.keyboard.press("Space");
  await sleep(playSeconds * 1000);
  const endedAt = await page.evaluate(() => performance.now());
  const wallMs = Date.now() - t0;
  const after = await procSnapshot(app);
  const mon = await page.evaluate(() => window.__perfMon.stop());
  await page.keyboard.press("Space");
  await sleep(500);
  const tele = await page.evaluate(() => window.__openreelE2E.renderCache.getTelemetry());
  const stalls = await page.evaluate(() => window.__openreelE2E.playbackStalls?.() ?? []);
  const stageTraces = await page.evaluate(() => window.__openreelE2E.playbackStageTraces?.() ?? []);
  const heap = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null));
  let profile = null;
  if (cdp) { const { profile: p } = await cdp.send("Profiler.stop"); profile = topFunctions(p); await cdp.detach().catch(() => {}); }
  const entries = tele.entries.filter((e) => e.at >= startedAt && e.at <= endedAt);
  const distinct = new Set(entries.map((e) => Math.round(e.time * fps)));
  const gaps = [];
  let worstGap = { ms: 0, atTimelineS: null };
  for (let i = 1; i < entries.length; i++) {
    const g = entries[i].at - entries[i - 1].at;
    gaps.push(g);
    if (g > worstGap.ms) worstGap = { ms: g, atTimelineS: r1(entries[i - 1].time) };
  }
  const analysis = analyzePlayback({ presentedFrames: distinct.size, seconds: (endedAt - startedAt) / 1000, sourceFps: fps });
  const cpu = cpuDelta(before, after);
  const gradeAfter = await page.evaluate(() => window.__openreelE2E.gradeChainStats?.() ?? null);
  return {
    quality,
    // WebGPU grade chain activity during the pass (null: chain never created, i.e. the Canvas2D path rendered every frame).
    gradeChain: gradeAfter ? Object.fromEntries(["engine", "preview"].map((k) => [k, gradeAfter[k] ? { frames: gradeAfter[k].frames - (gradeBefore?.[k]?.frames ?? 0), fallbacks: gradeAfter[k].fallbacks - (gradeBefore?.[k]?.fallbacks ?? 0), readbacks: gradeAfter[k].readbacks, meanCpuMs: Math.round(gradeAfter[k].meanCpuMs * 1000) / 1000 } : null])) : null,
    ...analysis,
    frameGapP50Ms: r1(median(gaps)),
    frameGapP95Ms: r1(pct(gaps, 0.95)),
    frameGapMaxMs: r1(Math.max(0, ...gaps)),
    gapsOver50ms: gaps.filter((g) => g > 50).length,
    worstGapAtTimelineS: worstGap.atTimelineS,
    // First transition (crossfade into the 12 s cut): the largest frame gap that ends in its first 0.6 s, and the
    // gap of the very first transition frame.
    firstTransitionGapMaxMs: r1(Math.max(0, ...entries.slice(1).map((e, i) => (e.time >= firstTransitionStartS - 0.1 && e.time <= firstTransitionStartS + 0.6 ? e.at - entries[i].at : 0)))),
    firstTransitionStartS,
    watchdogStalls: stalls.length,
    // Slow (> 16 ms) frame-loop stages around the transitions (decoder open, decode, effects, transition render).
    stageTraces: stageTraces.filter((t) => t.at >= startedAt && t.at <= endedAt && (t.ms >= 100 || t.stage.startsWith("loop-gap"))),
    playheadAdvancedS: entries.length ? r1(entries.at(-1).time - entries[0].time) : 0,
    main: frameStats(mon),
    cpuMs: cpu,
    sidecarCpuByKind: sidecarByKind(sidecarBefore),
    cpuPctOfCore: r1((cpu.total / wallMs) * 100),
    jsHeapMB: r1(heap),
    rssMB: rssTotal(after),
    rssByTypeMB: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, r1(v.wsMB)])),
    loadBefore: load0,
    loadAfter: sampleLoad(),
    ...(profile ? { rendererTopSelf: profile } : {}),
  };
}

async function interactionPass(app, page) {
  const out = {};
  await page.evaluate(() => document.activeElement?.blur?.());
  const clipAt = await page.evaluate(() => { const r = document.querySelector("[data-timeline-clip]").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const wheelAt = (init) => page.evaluate(({ x, y, init }) => {
    document.elementFromPoint(x, y)?.dispatchEvent(new WheelEvent("wheel", { ...init, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { x: clipAt.x, y: clipAt.y, init });
  const run = async (name, body) => {
    const c0 = await procSnapshot(app);
    const cdp = flag("profile") ? await page.context().newCDPSession(page) : null;
    if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 }); await cdp.send("Profiler.start"); }
    await page.evaluate(() => window.__perfMon.start(false));
    await body();
    const s = frameStats(await page.evaluate(() => window.__perfMon.stop()));
    let top = null;
    if (cdp) { const { profile: p } = await cdp.send("Profiler.stop"); top = topFunctions(p, 14); await cdp.detach().catch(() => {}); }
    out[name] = { ...s, cpuMs: cpuDelta(c0, await procSnapshot(app)), ...(top ? { rendererTopSelf: top } : {}) };
    await sleep(400);
  };
  await run("zoom80", async () => { for (let i = 0; i < 80; i++) { await wheelAt({ deltaY: i < 40 ? -50 : 50, ctrlKey: true }); await sleep(16); } });
  await run("scroll80", async () => { for (let i = 0; i < 80; i++) { await wheelAt({ deltaY: i < 40 ? 70 : -70, shiftKey: true }); await sleep(16); } });
  const box = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-timeline-clip]")].filter((e) => e.getBoundingClientRect().left > 300);
    for (const el of els) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (document.elementFromPoint(x, y)?.closest("[data-timeline-clip]") === el) return { x, y, id: el.getAttribute("data-timeline-item-id"), left: r.left };
    }
    return null;
  });
  if (box) {
    await sleep(300);
    await page.mouse.move(box.x, box.y);
    await run("dragClip120px", async () => {
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) { await page.mouse.move(box.x + i * 4, box.y); await sleep(16); }
      await page.mouse.up();
      await sleep(300);
    });
    out.dragClip120px.movedPx = await page.evaluate((id) => { const el = document.querySelector(`[data-timeline-item-id="${id}"]`); return el ? Math.round(el.getBoundingClientRect().left) : null; }, box.id).then((l) => (l == null ? null : l - Math.round(box.left)));
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  }
  return out;
}

async function openPass(app, projectFile, expectedClips) {
  // Fresh profile + fresh app: the project is opened through the real Open flow.
  const ud = fs.mkdtempSync(path.join(work, "ud-open-"));
  const l = await launch(ud);
  try {
    await enterEditor(l.page);
    await stubDialogs(l.app, { open: projectFile, save: projectFile });
    const c0 = await procSnapshot(l.app);
    const t0 = Date.now();
    const opened = await l.page.evaluate(() => window.__openreelE2E.projectFile.openEditorProject());
    const tOpened = Date.now() - t0;
    await l.page.waitForFunction((n) => window.__openreelE2E.project.getState().project.timeline.tracks.reduce((a, t) => a + t.clips.length, 0) >= n, expectedClips, { timeout: 120000, polling: 25 }).catch(async (error) => {
      const have = await l.page.evaluate(() => window.__openreelE2E.project.getState().project.timeline.tracks.reduce((a, t) => a + t.clips.length, 0));
      throw new Error(`open: ${have}/${expectedClips} clips after 120 s (openEditorProject returned ${opened}): ${error.message}`);
    });
    const tClips = Date.now() - t0;
    await l.page.waitForFunction(() => {
      const cv = document.querySelector('canvas[aria-label^="Program"]');
      if (!cv) return false;
      const c = document.createElement("canvas"); c.width = 64; c.height = 36;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(cv, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
      return lit > 20;
    }, undefined, { timeout: 120000, polling: 25 }).catch(() => {});
    const tFrame = Date.now() - t0;
    const cpu = cpuDelta(c0, await procSnapshot(l.app));
    const missing = await l.page.evaluate(() => window.__openreelE2E.project.getState().project.mediaLibrary.items.filter((m) => m.offline || m.missing).length);
    return { opened, openCallMs: tOpened, toAllClipsMs: tClips, toFirstFrameMs: tFrame, cpuMs: cpu, offlineMedia: missing, load: l.load };
  } finally {
    await closeApp(l.app);
  }
}

// ---------------------------------------------------------------------------------------------- run

async function runOnce(files) {
  const result = { startedLoad: sampleLoad() };
  const ud = fs.mkdtempSync(path.join(work, "ud-"));
  const l = await launch(ud);
  const { app, page } = l;
  try {
    await enterEditor(page);
    await installMonitor(page);
    result.importMs = await importMedia(page, files);
    result.timeline = await buildTimeline(page);
    Object.assign(result, await waitSettled(app, page));
    const fps = result.timeline.frameRate || 30;
    log("timeline", JSON.stringify(result.timeline));

    const projectFile = path.join(work, "heavy.oreel");
    await stubDialogs(app, { save: projectFile });
    await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
    await page.keyboard.press(SAVE_KEY);
    for (let i = 0; i < 50 && !fs.existsSync(projectFile); i++) await sleep(200);
    result.projectFileKB = fs.existsSync(projectFile) ? Math.round(fs.statSync(projectFile).size / 1024) : null;

    result.memoryAfterBuild = { rssMB: rssTotal(await procSnapshot(app)), jsHeapMB: await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null)).catch(() => null) };
    if (flag("idle-prefill")) {
      // Leave the editor alone so background (idle) rendering fills the render cache, then measure playback from it.
      result.idlePrefill = await waitForIdleRender(page, Number(opt("idle-timeout", 900)) * 1000);
      log("idlePrefill", JSON.stringify(result.idlePrefill));
    }
    if (only.has("playback")) {
      result.playbackFull = await playbackPass(app, page, "full", fps);
      log("playbackFull", JSON.stringify({ ...result.playbackFull, rendererTopSelf: undefined }));
      result.playbackHalf = await playbackPass(app, page, "half", fps);
      log("playbackHalf", JSON.stringify(result.playbackHalf));
      await page.evaluate(() => window.__openreelE2E.ui.getState().setPlaybackQuality("auto"));
    }
    if (only.has("scrub")) {
      await seekToStart(page);
      const c0 = await procSnapshot(app);
      const cdp = flag("profile") ? await page.context().newCDPSession(page) : null;
      if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 }); await cdp.send("Profiler.start"); }
      const s = await scrubClicks(page, scrubCount);
      let scrubProfile = null;
      if (cdp) { const { profile: p } = await cdp.send("Profiler.stop"); scrubProfile = topFunctions(p); await cdp.detach().catch(() => {}); }
      const cpu = cpuDelta(c0, await procSnapshot(app));
      result.scrub = { ...s, cpuMsPerSeek: s.latency.n ? r1(cpu.total / s.latency.n) : null, cpuMs: cpu, ...(scrubProfile ? { rendererTopSelf: scrubProfile } : {}) };
      log("scrub", JSON.stringify(result.scrub.latency), "firstPixel", JSON.stringify(result.scrub.firstPixelChange));
    }
    if (only.has("interact")) {
      result.interact = await interactionPass(app, page);
      log("interact", JSON.stringify(Object.fromEntries(Object.entries(result.interact).map(([k, v]) => [k, { p95: v.rafP95Ms, max: v.rafMaxMs, over50: v.framesOver50ms, cpu: v.cpuMs.total }]))));
    }
    if (only.has("memory")) {
      await page.evaluate(() => { try { window.gc?.(); } catch { /* ignore */ } });
      await sleep(300);
      const snap = await procSnapshot(app);
      result.memory = { rssMB: rssTotal(snap), byTypeMB: Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, r1(v.wsMB)])), jsHeapMB: await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null)) };
    }
  } finally {
    await closeApp(app);
  }
  if (only.has("open") && result.projectFileKB) {
    const expected = result.timeline.videoClips + result.timeline.audioTracks; // titles live in the text track, not track.clips
    try {
      result.open = await openPass(app, path.join(work, "heavy.oreel"), expected);
      log("open", JSON.stringify(result.open));
    } catch (error) {
      result.open = { error: String(error?.message ?? error) };
      log("open FAILED", result.open.error);
    }
  }
  result.endedLoad = sampleLoad();
  return result;
}

const fmt = (v, d = 1) => (v == null ? "-" : typeof v === "number" ? String(Math.round(v * 10 ** d) / 10 ** d) : String(v));
function table(res) {
  const rows = [];
  const add = (name, ...cols) => rows.push([name, ...cols.map((c) => fmt(c))]);
  const F = res.playbackFull, H = res.playbackHalf;
  if (F) {
    add("dropped frames (% of expected)", F.droppedFramesPct, H?.droppedFramesPct);
    add("effective fps", F.effectiveFps, H?.effectiveFps);
    add("first-transition gap max (ms)", fmt(F.firstTransitionGapMaxMs), H && fmt(H.firstTransitionGapMaxMs));
    add("frame gap p50 / p95 / max (ms)", `${fmt(F.frameGapP50Ms)} / ${fmt(F.frameGapP95Ms)} / ${fmt(F.frameGapMaxMs)}`, H && `${fmt(H.frameGapP50Ms)} / ${fmt(H.frameGapP95Ms)} / ${fmt(H.frameGapMaxMs)}`);
    add("rAF frames > 50 ms", F.main.framesOver50ms, H?.main.framesOver50ms);
    add("watchdog stalls", F.watchdogStalls, H?.watchdogStalls);
    add("CPU ms total (all processes)", F.cpuMs.total, H?.cpuMs.total);
    add("CPU ms per presented frame", F.presentedFrames ? F.cpuMs.total / F.presentedFrames : null, H?.presentedFrames ? H.cpuMs.total / H.presentedFrames : null);
    add("  main (Browser) ms", F.cpuMs.Browser, H?.cpuMs.Browser);
    add("  renderer (Tab) ms", F.cpuMs.Tab, H?.cpuMs.Tab);
    add("  GPU ms", F.cpuMs.GPU, H?.cpuMs.GPU);
    add("  ffmpeg sidecar ms", F.cpuMs.Sidecar, H?.cpuMs.Sidecar);
    add("JS heap MB", F.jsHeapMB, H?.jsHeapMB);
    add("RSS MB (all procs)", F.rssMB, H?.rssMB);
  }
  if (res.scrub) {
    add("scrub p50 / p95 (ms) [exact frame]", `${fmt(res.scrub.latency.p50Ms)} / ${fmt(res.scrub.latency.p95Ms)}`);
    add("scrub first-pixel p50 / p95 (ms)", `${fmt(res.scrub.firstPixelChange.medianMs)} / ${fmt(res.scrub.firstPixelChange.p95Ms)}`);
    add("scrub timeouts / CPU ms per seek", `${res.scrub.latency.timeouts} / ${fmt(res.scrub.cpuMsPerSeek)}`);
  }
  for (const [k, v] of Object.entries(res.interact ?? {})) add(`${k} rAF p95 / max (ms) | cpu ms`, `${fmt(v.rafP95Ms)} / ${fmt(v.rafMaxMs)} | ${fmt(v.cpuMs.total)}`);
  if (res.open) add("open: all clips / first frame (ms)", res.open.error ? `error: ${res.open.error}` : `${fmt(res.open.toAllClipsMs)} / ${fmt(res.open.toFirstFrameMs)}`);
  if (res.memory) add("idle RSS / heap MB", `${fmt(res.memory.rssMB)} / ${fmt(res.memory.jsHeapMB)}`);
  const header = ["metric", "full", "half"];
  const widths = header.map((_, i) => Math.max(header[i].length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (r) => r.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

async function main() {
  if (!fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) || !fs.existsSync(path.join(root, "apps/web/dist/index.html"))) {
    throw new Error("build first: VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build");
  }
  const files = ensureMedia();
  const all = [];
  for (let i = 0; i < runs; i++) {
    log(`run ${i + 1}/${runs}`);
    all.push(await runOnce(files));
  }
  const load = loadSamples.length ? Math.max(...loadSamples) : null;
  const final = all[all.length - 1];
  const out = {
    label,
    commit: opt("commit", null) ?? (() => { try { return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"]).toString().trim(); } catch { return "?"; } })(),
    env: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30) },
    load: { samples: loadSamples, max: load, judgeBelow: LOAD_JUDGE_MAX },
    wallClockJudged: load != null && load < LOAD_JUDGE_MAX,
    runs: all,
  };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\nopenreel perf:playback  ${label} @ ${out.commit}  (${final.timeline?.size} ${final.timeline?.frameRate} fps, ${final.timeline?.videoClips} video clips, ${final.timeline?.audioTracks} audio tracks, ${playSeconds}s playback)`);
  console.log(`machine load (1 min avg) max ${load}; wall-clock rows ${out.wallClockJudged ? "JUDGED (load < 4)" : "NOT JUDGED (load >= 4): compare the CPU rows, wall-clock is informational"}\n`);
  console.log(table(final));
  if (runs > 1) console.log(`\n(${runs} runs; table is the last run, all runs are in --out)`);
}

try {
  await main();
} finally {
  if (!flag("keep-media") && process.env.OPENREEL_PERF_KEEP_MEDIA !== "1" && !argv.includes("--media-dir")) fs.rmSync(mediaDir, { recursive: true, force: true });
  if (!flag("keep-work")) fs.rmSync(work, { recursive: true, force: true });
  else log("work dir kept:", work);
}
