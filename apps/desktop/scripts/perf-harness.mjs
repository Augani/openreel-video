#!/usr/bin/env node
/**
 * Real-app performance harness for the OpenReel desktop (Electron) build.
 *
 * Launches the BUILT app (apps/desktop/dist + apps/web/dist, run `pnpm --filter
 * @openreel/desktop build` first) through Playwright's _electron API with a
 * throw-away --user-data-dir, and reports:
 *   cold      cold start to window shown / editor interactive (median of N)
 *   import    import + place a 1080p 60 s clip
 *   scrub     click-seek latency to a new presented frame, plus drag scrubbing
 *   playback  10 s of playback: rAF deltas, long tasks, distinct frame rate
 *   memory    process memory before/after a long scrubbing soak
 *   bench     400-clip project (buildBenchProject): open, select, scroll, zoom, drag
 *   memory4k  back-to-back 4K clips played through clip changes: peak process memory + rAF stats
 *   scrub4k   click-seek latency (p50/p95) on one 4K long-GOP clip + CPU per seek
 *   playback4k  10 s of 4K playback: dropped frames / effective fps + CPU % of a core
 *   importN   import N small 1080p clips at once: time until every thumbnail shows + CPU per clip
 *   (bench also records `seekClick` p50/p95 on the 400-clip project, playback records `analysis`
 *    = dropped frames / effective fps / CPU for 10 s of 1080p; see PERF.md "Scrub, playback and import")
 *
 * Usage: node scripts/perf-harness.mjs [--root <repo>] [--label name]
 *          [--out file.json] [--only cold,import,...] [--mem-seconds 300]
 *          [--cold-runs 3] [--scrubs 30]
 * --root points at another checkout (e.g. a scratch worktree of an older
 * commit) whose apps/desktop + apps/web/dist are already built; the harness
 * itself and the bench fixture always come from this checkout.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTrace } from "./perf-trace.mjs";
import { analyzePlayback, cpuPctOfCore, latencyStats, sumCpuMs, summarizeImport } from "./perf-analysis.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const thisRepo = path.resolve(here, "../../..");

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const root = path.resolve(opt("root", thisRepo));
const label = opt("label", path.basename(root));
const outFile = opt("out", null);
const only = new Set((opt("only", "cold,import,scrub,playback,memory,bench")).split(","));
const traceRuns = Number(opt("trace-runs", 3));
const sessionMinutes = Number(opt("session-minutes", 20));
const memSeconds = Number(opt("mem-seconds", 300));
const coldRuns = Number(opt("cold-runs", 3));
const scrubCount = Number(opt("scrubs", 30));
const benchScrubCount = Number(opt("bench-scrubs", 20));
const scrub4kCount = Number(opt("scrubs-4k", 20));
const importClipCount = Number(opt("import-clips", 8));
const playSeconds = Number(opt("play-seconds", 10));

const require = createRequire(path.join(thisRepo, "package.json"));
const pw = (() => {
  const pnpmDir = path.join(thisRepo, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((d) => d.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
})();
const { _electron } = pw;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "orperf-run-"));
const clipPath = process.env.OPENREEL_PERF_CLIP ?? path.join(work, "clip-1080p-60s.mp4");
const ffmpeg = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};
/**
 * 1-minute load average sampled around every launch. Wall-clock budgets are only meaningful on a
 * quiet machine, so perf-budget.mjs reads `results.load` and refuses to judge them above a threshold.
 */
const loadSamples = [];
const sampleLoad = () => { const v = os.loadavg()[0]; loadSamples.push(Math.round(v * 100) / 100); return v; };
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[${label}]`, ...a);

const gop = String(opt("gop", "250"));
function ensureClip() {
  if (fs.existsSync(clipPath)) return;
  execFileSync(ffmpeg, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "60", "-c:v", "libx264", "-preset", "medium", "-g", gop, "-bf", gop === "30" ? "0" : "3",
    "-pix_fmt", "yuv420p", "-b:v", "8M", "-c:a", "aac", "-shortest", clipPath,
  ]);
}

function buildBenchFixture() {
  const esbuildDir = fs
    .readdirSync(path.join(thisRepo, "node_modules/.pnpm"))
    .find((d) => d.startsWith("esbuild@"));
  const esbuild = require(path.join(thisRepo, "node_modules/.pnpm", esbuildDir, "node_modules/esbuild"));
  const src = fs.readFileSync(path.join(thisRepo, "packages/core/src/perf/bench-project.ts"), "utf8");
  const js = esbuild.transformSync(src, { loader: "ts", format: "esm" }).code;
  const tmp = path.join(work, "bench-project.mjs");
  fs.writeFileSync(tmp, js);
  return import(tmp).then(({ buildBenchProject }) => {
    const project = buildBenchProject({ clips: 400, tracks: 8, textItems: 50, waveformSamples: 64 });
    for (const item of project.mediaLibrary.items) delete item.waveformData;
    const file = path.join(work, "bench-400.oreel");
    fs.writeFileSync(file, JSON.stringify(project));
    return file;
  });
}

/** app.close() can block on the unsaved-changes guard; exit the main process directly. */
async function closeApp(app) {
  sampleLoad();
  const proc = app.process();
  await Promise.race([
    app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}),
    sleep(4000),
  ]);
  await sleep(300);
  try { proc.kill("SIGKILL"); } catch { /* already gone */ }
}

async function launch(extraArgs = [], launchRoot = root, existingUserData = null) {
  const userData = existingUserData ?? fs.mkdtempSync(path.join(work, "ud-"));
  const load = sampleLoad();
  const t0 = Date.now();
  const app = await _electron.launch({
    args: [...extraArgs, path.join(launchRoot, "apps/desktop"), `--user-data-dir=${userData}`, "--js-flags=--expose-gc"],
    // Keeps first-run onboarding out of every measurement (set OPENREEL_FORCE_ONBOARDING=1 to measure it).
    env: { ...process.env, OPENREEL_PERF: "1" },
    timeout: 90000,
  });
  const startupLogs = [];
  app.process().stdout?.on("data", (d) => startupLogs.push(String(d)));
  return { app, t0, startupLogs, userData, load };
}

/** Wait (polling main) until a window is visible; returns wall ms since t0. */
async function waitWindowShown(app, t0) {
  for (;;) {
    // The main-process evaluate can reject with "Execution context was destroyed"
    // while the window navigates (welcome -> app); that is a retry, not a failure.
    const shown = await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible()))
      .catch((error) => {
        if (/context was destroyed|Target closed|navigat/i.test(String(error))) return false;
        throw error;
      });
    if (shown) return Date.now() - t0;
    await sleep(5);
  }
}

async function enterEditor(page, dwellMs = 0, reactProfile = false) {
  await page.getByText("Horizontal", { exact: true }).waitFor({ timeout: 30000 });
  if (dwellMs) await sleep(dwellMs);
  // In-page clock: pointerdown timestamp -> first frame where the Program canvas
  // AND the ruler exist. Playwright's own selector polling adds ~100-300 ms of
  // harness overhead to the wall-clock numbers, so both are reported.
  await page.evaluate(() => {
    window.__enterEditor = { down: 0, ready: 0 };
    document.addEventListener("pointerdown", (e) => { window.__enterEditor.down ||= e.timeStamp; }, true);
    const chk = () => {
      if (!window.__enterEditor.ready && document.querySelector('canvas[aria-label^="Program"]') && document.querySelector("[data-timeline-ruler]")) { window.__enterEditor.ready = performance.now(); performance.mark("perf:editor-ready"); }
      else if (!window.__enterEditor.ready) requestAnimationFrame(chk);
    };
    requestAnimationFrame(chk);
  });
  // OPENREEL_PERF_PROFILE_ENTER=1: CPU-profile the click -> editor-interactive window (CDP) and
  // print the heaviest inclusive functions + long tasks to stderr.
  const profile = process.env.OPENREEL_PERF_PROFILE_ENTER === "1" ? await page.context().newCDPSession(page) : null;
  if (profile) {
    await profile.send("Profiler.enable");
    await profile.send("Profiler.setSamplingInterval", { interval: 200 });
    await profile.send("Profiler.start");
  }
  if (reactProfile) await page.evaluate(() => { window.__reactProf.on = true; });
  // OPENREEL_PERF_TRACE_ENTER=1: Chrome trace of click -> interactive; prints main-thread tasks > 4 ms.
  const traceEnter = process.env.OPENREEL_PERF_TRACE_ENTER === "1" ? await page.context().newCDPSession(page) : null;
  if (traceEnter) await traceEnter.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8"] }, transferMode: "ReturnAsStream" });
  const tClick = Date.now();
  await page.getByText("Horizontal", { exact: true }).click();
  await page.waitForSelector('canvas[aria-label^="Program"]', { timeout: 30000 });
  await page.waitForSelector("[data-timeline-ruler]", { timeout: 30000 });
  const tEditor = Date.now();
  await page.waitForFunction(() => window.__enterEditor.ready > 0);
  const inPage = await page.evaluate(() => Math.round(window.__enterEditor.ready - window.__enterEditor.down));
  if (traceEnter) {
    const done = new Promise((r) => traceEnter.once("Tracing.tracingComplete", r));
    await traceEnter.send("Tracing.end");
    const { stream } = await done;
    let text = "";
    for (;;) { const c = await traceEnter.send("IO.read", { handle: stream }); text += c.data; if (c.eof) break; }
    const all = JSON.parse(text).traceEvents ?? [];
    const click = all.find((e) => e.name === "EventDispatch" && e.args?.data?.type === "click");
    const main = click?.tid;
    const evs = all.filter((e) => e.ph === "X" && e.tid === main && e.dur > 4000 && /RunTask|FunctionCall|EvaluateScript|UpdateLayoutTree|Layout$|Paint|MajorGC|MinorGC|EventDispatch|HitTest|TimerFire|FireAnimationFrame/.test(e.name));
    const t0 = click?.ts ?? 0;
    log("enter-editor trace (ms from click)", JSON.stringify(evs.sort((a, b) => a.ts - b.ts).map((e) => `${r1((e.ts - t0) / 1000)} +${r1(e.dur / 1000)} ${e.name} ${e.args?.data?.functionName ?? e.args?.data?.type ?? ""} ${String(e.args?.data?.url ?? "").split("/").pop()}:${e.args?.data?.lineNumber ?? ""}`), null, 1));
  }
  if (profile) {
    const { profile: prof } = await profile.send("Profiler.stop");
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map();
    const self = new Map();
    prof.samples.forEach((id, i) => {
      const dt = prof.timeDeltas[i] / 1000;
      const seen = new Set();
      for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
        const f = byId.get(cur).callFrame;
        const k = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}`;
        if (seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + dt);
      }
      const f0 = byId.get(id).callFrame;
      const k0 = `${f0.functionName || "(anon)"} ${f0.url.split("/").pop()}:${f0.lineNumber}`;
      self.set(k0, (self.get(k0) || 0) + dt);
    });
    const top = (m, n) => [...m.entries()].filter(([k]) => !k.startsWith("(idle)")).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${r1(v)} ${k}`);
    log("enter-editor profile INCLUSIVE", JSON.stringify(top(incl, 60), null, 1));
    log("enter-editor profile SELF", JSON.stringify(top(self, 25), null, 1));
  }
  const skip = page.getByText("Skip Tour");
  await skip.waitFor({ timeout: 3000 }).then(() => skip.click()).catch(() => {});
  return { tClick, tEditor, inPage };
}

/** Install the in-page monitor: rAF deltas, long tasks, optional frame hashing. */
async function installMonitor(page) {
  await page.evaluate(() => {
    const hashCanvas = document.createElement("canvas");
    hashCanvas.width = 32;
    hashCanvas.height = 18;
    const hctx = hashCanvas.getContext("2d", { willReadFrequently: true });
    const program = () => document.querySelector('canvas[aria-label^="Program"]');
    const hash = () => {
      const cv = program();
      if (!cv) return "";
      hctx.drawImage(cv, 0, 0, 32, 18);
      const d = hctx.getImageData(0, 0, 32, 18).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
      return String(h);
    };
    const parseTc = (label) => {
      const m = /(\d+):(\d+):(\d+):(\d+)/.exec(label ?? "");
      return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 30 : null;
    };
    const mon = {
      active: false, hashing: false, deltas: [], longTasks: [], slowEvents: [], hashes: 0, lastHash: "",
      labelChanges: 0, last: 0, t0: 0,
      hash, parseTc, program,
      start(hashing) {
        mon.active = true; mon.hashing = !!hashing; mon.deltas = []; mon.longTasks = []; mon.slowEvents = []; mon.frames = []; mon.inputs = [];
        mon.hashes = 0; mon.labelChanges = 0; mon.last = 0; mon.t0 = performance.now(); mon.lastHash = "";
      },
      stop() {
        mon.active = false;
        return { deltas: mon.deltas, frames: mon.frames, inputs: mon.inputs, longTasks: mon.longTasks, slowEvents: mon.slowEvents, hashes: mon.hashes, labelChanges: mon.labelChanges, ms: performance.now() - mon.t0 };
      },
    };
    const tick = (now) => {
      if (mon.active) {
        if (mon.last) { mon.deltas.push(now - mon.last); mon.frames.push([now - mon.t0, now - mon.last]); }
        mon.last = now;
        if (mon.hashing) {
          const h = hash();
          if (h !== mon.lastHash) { mon.hashes += 1; mon.lastHash = h; }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      if (!mon.active) return;
      for (const e of list.getEntries()) mon.longTasks.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
    // Event Timing: input events whose input->next-paint duration is >= 16 ms (the API floor).
    // `processing` is the time spent in the page's handlers, the part the app controls.
    try {
      new PerformanceObserver((list) => {
        if (!mon.active) return;
        for (const e of list.getEntries()) {
          if (e.name === "pointermove" || e.name === "mousemove" || e.name === "pointerdown" || e.name === "wheel") {
            mon.slowEvents.push({ name: e.name, duration: e.duration, processing: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime });
          }
        }
      }).observe({ type: "event", durationThreshold: 16, buffered: false });
    } catch { /* Event Timing unavailable */ }
    document.addEventListener("pointerdown", (e) => { mon.pointerDownAt = e.timeStamp; }, true);
    // Input marks (for locating a slow frame within a gesture): first few moves, down, up.
    for (const type of ["mousedown", "mouseup", "mousemove"]) {
      window.addEventListener(type, (e) => {
        if (!mon.active || !mon.inputs) return;
        if (type === "mousemove" && mon.inputs.filter((i) => i[0] === "mousemove").length >= 6) return;
        mon.inputs.push([type, e.timeStamp - mon.t0]);
      }, true);
    }
    // Follow the Program canvas across remounts (project switch / open). Exactly one pair of
    // observers is live at a time: the body observer is dropped before re-attaching, otherwise
    // every re-attach stacks another body-wide observer and the harness itself adds tens of ms
    // of main-thread work to every later DOM mutation (it inflated select-clip by ~30 ms).
    let labelObserver = null;
    let bodyObserver = null;
    const watch = () => {
      labelObserver?.disconnect();
      bodyObserver?.disconnect();
      labelObserver = bodyObserver = null;
      const cv = program();
      if (!cv) return setTimeout(watch, 200);
      labelObserver = new MutationObserver(() => { if (mon.active) mon.labelChanges += 1; });
      labelObserver.observe(cv, { attributes: true, attributeFilter: ["aria-label"] });
      bodyObserver = new MutationObserver(() => { if (!cv.isConnected) watch(); });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    };
    watch();
    window.__perfMon = mon;
  });
}


/** Summarise a CDP Profiler profile: heaviest inclusive + self functions (idle excluded). */
function summarizeProfile(prof, topN = 50) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const incl = new Map();
  const self = new Map();
  prof.samples.forEach((id, i) => {
    const dt = prof.timeDeltas[i] / 1000;
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const f = byId.get(cur).callFrame;
      const k = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
      if (seen.has(k)) continue;
      seen.add(k);
      incl.set(k, (incl.get(k) || 0) + dt);
    }
    const f0 = byId.get(id).callFrame;
    const k0 = `${f0.functionName || "(anon)"} ${f0.url.split("/").pop()}:${f0.lineNumber}:${f0.columnNumber}`;
    self.set(k0, (self.get(k0) || 0) + dt);
  });
  const top = (m, n) => [...m.entries()].filter(([k]) => !k.startsWith("(idle)")).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${r1(v)} ${k}`);
  return { inclusive: top(incl, topN), self: top(self, 25) };
}

const frameStats = (s) => {
  const over = (t) => s.deltas.filter((d) => d > t).length;
  return {
    seconds: r1(s.ms / 1000),
    rafCount: s.deltas.length,
    rafMeanMs: r1(s.deltas.reduce((a, b) => a + b, 0) / Math.max(1, s.deltas.length)),
    rafP95Ms: r1(pct(s.deltas, 0.95)),
    rafMaxMs: r1(Math.max(0, ...s.deltas)),
    framesOver25ms: over(25),
    framesOver50ms: over(50),
    longTasks: s.longTasks.length,
    longTaskTotalMs: r1(s.longTasks.reduce((a, b) => a + b, 0)),
    longTaskMaxMs: r1(Math.max(0, ...s.longTasks)),
    slowInputEvents: (s.slowEvents ?? []).length,
    inputEventMaxDurationMs: r1(Math.max(0, ...(s.slowEvents ?? []).map((e) => e.duration))),
    inputEventMaxProcessingMs: r1(Math.max(0, ...(s.slowEvents ?? []).map((e) => e.processing))),
    ...(s.frames && s.frames.some((f) => f[1] > 25)
      ? { slowFrames: s.frames.filter((f) => f[1] > 25).slice(0, 6).map((f) => ({ atMs: r1(f[0]), ms: r1(f[1]) })), inputMarks: (s.inputs ?? []).map((i) => ({ type: i[0], atMs: r1(i[1]) })) }
      : {}),
  };
};

async function rulerMap(page) {
  return page.evaluate(() => {
    const ruler = document.querySelector("[data-timeline-ruler]");
    const rect = ruler.getBoundingClientRect();
    const labels = [...ruler.querySelectorAll("span")]
      .map((el) => ({ el, m: /^(\d+):(\d+):(\d+):(\d+)$/.exec(el.textContent.trim()) }))
      .filter((x) => x.m)
      .map((x) => ({ t: +x.m[1] * 3600 + +x.m[2] * 60 + +x.m[3] + +x.m[4] / 30, x: x.el.getBoundingClientRect().left }));
    labels.sort((a, b) => a.t - b.t);
    const a = labels[0], b = labels[labels.length - 1];
    const pxPerSec = (b.x - a.x) / (b.t - a.t);
    return { y: rect.top + rect.height / 2, x0: a.x - a.t * pxPerSec, pxPerSec, right: rect.right, maxT: (rect.right - 40 - (a.x - a.t * pxPerSec)) / pxPerSec };
  });
}

/**
 * Seek N random times by clicking the ruler.
 *   exact   = pointerdown -> Program label shows the target (exact frame presented)
 *   first   = pointerdown -> the program canvas pixels first change (what the user
 *             perceives; may be a low-res approximation that the exact frame replaces)
 * staleAfterFinal counts seeks whose canvas changed AGAIN after the exact frame was
 * presented (an approximation overwriting the final frame would show up here).
 */
async function scrubClicks(page, n) {
  const map = await rulerMap(page);
  const lats = [], firsts = [];
  let stale = 0, timeouts = 0, prev = 0, staleAfterFinal = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    let t;
    do { t = 1 + rnd() * Math.min(28, map.maxT - 1); } while (Math.abs(t - prev) < 1.5);
    prev = t;
    const before = await page.evaluate(() => window.__perfMon.hash());
    const waiter = page.evaluate(({ t, before }) => new Promise((resolve) => {
      const mon = window.__perfMon;
      const cv = mon.program();
      let done = false, first = null;
      const finish = (v) => { if (!done) { done = true; mo.disconnect(); resolve({ ...v, first }); } };
      const poll = () => {
        if (done) return;
        if (first === null && mon.pointerDownAt && performance.now() - mon.pointerDownAt < 4000 && mon.hash() !== before) first = performance.now() - mon.pointerDownAt;
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
      const check = () => {
        const got = mon.parseTc(cv.getAttribute("aria-label"));
        if (got !== null && Math.abs(got - t) < 0.2) {
          const lat = performance.now() - mon.pointerDownAt;
          requestAnimationFrame(() => finish({ lat, got, hash: mon.hash() }));
        }
      };
      const mo = new MutationObserver(check);
      mo.observe(cv, { attributes: true, attributeFilter: ["aria-label"] });
      setTimeout(() => finish({ lat: null }), 4000);
    }), { t, before });
    await sleep(30);
    await page.mouse.click(map.x0 + t * map.pxPerSec, map.y);
    const res = await waiter;
    if (res.lat == null) timeouts++;
    else {
      lats.push(res.lat);
      firsts.push(res.first ?? res.lat);
      if (res.hash === before) stale++;
      await sleep(250);
      const after = await page.evaluate(() => window.__perfMon.hash());
      if (after !== res.hash) staleAfterFinal++;
    }
    await sleep(100);
  }
  const stat = (a) => ({ medianMs: r1(median(a)), p95Ms: r1(pct(a, 0.95)), maxMs: r1(Math.max(0, ...a)), meanMs: r1(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)) });
  return {
    n, timeouts, staleFrames: stale, staleAfterFinal,
    // Raw per-click latencies in click order (ms): shows whether the tail is the cold first seeks or steady state.
    samplesMs: lats.map(r1),
    ...stat(lats),
    // seek-to-frame-visible, p50/p95 in the names the budgets use (same samples as medianMs / p95Ms).
    latency: latencyStats(lats, timeouts),
    firstPixelChange: stat(firsts),
  };
}

/** Cumulative CPU time (ms) of every Electron process: deltas of this are load-robust, unlike wall clock. */
const appCpuMs = (app) => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ cpu: { cumulativeCPUUsage: m.cpu.cumulativeCPUUsage } }))).then(sumCpuMs);

/** click-seek run with the CPU it cost: `cpuMsPerSeek` is CPU time per successful seek (idle waits cost ~0). */
async function scrubClicksWithCpu(app, page, n) {
  const cpu0 = await appCpuMs(app);
  const res = await scrubClicks(page, n);
  const cpu1 = await appCpuMs(app);
  const ok = res.latency.n;
  return { ...res, cpuMsPerSeek: ok ? r1(Math.max(0, cpu1 - cpu0) / ok) : null };
}

/** One 4K long-GOP H.264 clip (10 s keyframe interval like the soak's cuts), cached for the run. */
function ensureUhdClip(seconds) {
  const file = path.join(work, `uhd-long-gop-${seconds}s.mp4`);
  if (fs.existsSync(file)) return file;
  execFileSync(ffmpeg, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=s=3840x2160:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", "-bf", "2",
    "-pix_fmt", "yuv420p", "-b:v", "20M", "-c:a", "aac", "-shortest", file,
  ]);
  return file;
}

/** N distinct (hue-shifted) 3 s 1080p clips for the batch-import scenario. */
function ensureImportClips(count) {
  const dir = path.join(work, "import-n");
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (_, i) => {
    const file = path.join(dir, `import-${i}.mp4`);
    if (!fs.existsSync(file)) {
      execFileSync(ffmpeg, [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", `testsrc2=s=1920x1080:r=30,hue=h=${i * 40}`,
        "-f", "lavfi", "-i", `sine=frequency=${300 + i * 50}:sample_rate=48000`,
        "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-g", "30",
        "-pix_fmt", "yuv420p", "-b:v", "8M", "-c:a", "aac", "-shortest", file,
      ]);
    }
    return file;
  });
}

/**
 * 10 s of playback from just after the start. Pass 1 (no hashing) gives the rAF stats and the CPU cost;
 * pass 2 hashes the Program canvas every rAF to count DISTINCT presented frames, from which dropped
 * frames and effective fps follow (the hashing itself costs CPU, so pass 1 is the one timed for CPU).
 */
async function measurePlayback(app, page, sourceFps) {
  await page.evaluate(() => document.activeElement?.blur?.());
  const map = await rulerMap(page);
  await page.mouse.click(map.x0 + 0.5 * map.pxPerSec, map.y);
  await sleep(500);
  const run = async (hashing) => {
    await page.evaluate((h) => window.__perfMon.start(h), hashing);
    const cpu0 = await appCpuMs(app);
    const t0 = Date.now();
    await page.keyboard.press("Space");
    await sleep(playSeconds * 1000);
    const wallMs = Date.now() - t0;
    const cpu1 = await appCpuMs(app);
    const s = await page.evaluate(() => window.__perfMon.stop());
    await page.keyboard.press("Space");
    await sleep(600);
    return { s, cpuPct: cpuPctOfCore(cpu0, cpu1, wallMs) };
  };
  const plain = await run(false);
  const hashed = await run(true);
  return {
    tenSeconds: frameStats(plain.s),
    withHashing: frameStats(hashed.s),
    distinctFramesPerSec: r1(hashed.s.hashes / (hashed.s.ms / 1000)),
    distinctFramesPerSecNote: "measured in a second pass that hashes the program canvas every rAF",
    analysis: analyzePlayback({ presentedFrames: hashed.s.hashes, seconds: hashed.s.ms / 1000, sourceFps, rafDeltas: hashed.s.deltas }),
    cpuPctOfCore: plain.cpuPct,
    cpuPctOfCoreNote: "all Electron processes, % of one core, over the un-hashed pass",
  };
}

/** Hold the mouse on the ruler and sweep it at ~60 Hz. Returns stats + final-frame lag. */
async function dragScrub(page, seconds, { hashing = false, fromSec = 1, toSec = 28, radPerSec = 1.2 } = {}) {
  const map = await rulerMap(page);
  const lo = map.x0 + fromSec * map.pxPerSec;
  const hi = map.x0 + Math.min(toSec, map.maxT - 1) * map.pxPerSec;
  await page.mouse.move(lo, map.y);
  await page.evaluate((h) => window.__perfMon.start(h), hashing);
  await page.mouse.down();
  const end = Date.now() + seconds * 1000;
  let moves = 0;
  const start = Date.now();
  while (Date.now() < end) {
    const phase = ((Date.now() - start) / 1000) * radPerSec;
    const x = lo + ((Math.sin(phase) + 1) / 2) * (hi - lo);
    await page.mouse.move(x, map.y);
    moves++;
    await sleep(8);
  }
  const lastT = (await page.evaluate(() => window.__perfMon.parseTc(window.__perfMon.program()?.getAttribute("aria-label"))));
  await page.mouse.up();
  const stats = await page.evaluate(() => window.__perfMon.stop());
  return { moves, presentedFrames: stats.labelChanges, lastPresentedAtRelease: lastT, ...frameStats(stats) };
}

async function memorySample(app, page) {
  await page.evaluate(() => { try { window.gc?.(); } catch { /* ignore */ } });
  await sleep(300);
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? 0 })));
  const byType = {};
  for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.ws / 1024;
  const heap = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null));
  const totalMB = Object.values(byType).reduce((a, b) => a + b, 0);
  return { totalMB: r1(totalMB), rendererMB: r1(byType.Tab ?? 0), gpuMB: r1(byType.GPU ?? 0), browserMB: r1(byType.Browser ?? 0), jsHeapMB: r1(heap) };
}

/**
 * Process memory without a forced GC (a peak is what we want here, not the post-GC floor). Electron's
 * `workingSetSize` is the resident set; `privateBytes` the private footprint. Both in MB, summed over
 * every Electron process (browser, GPU, renderers, utility).
 */
async function memoryPeakSample(app) {
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? 0 })));
  const sum = (key, type) => metrics.filter((m) => !type || m.type === type).reduce((a, m) => a + m[key], 0) / 1024;
  return { totalMB: r1(sum("ws")), privateMB: r1(sum("priv")), rendererMB: r1(sum("ws", "Tab")), gpuMB: r1(sum("ws", "GPU")) };
}

async function importAndPlace(app, page) {
  const input = page.locator("input[type=file]").first();
  await page.evaluate(() => window.__perfMon.start(false));
  const t0 = Date.now();
  await input.setInputFiles(clipPath);
  const base = path.basename(clipPath);
  const item = page.getByRole("button", { name: `Select media ${base}` });
  await item.waitFor({ timeout: 60000 });
  const tBin = Date.now();
  // Wait until the media item stops being a placeholder (thumbnail <img> present).
  await page.waitForSelector(`[aria-label="Select media ${base}"] img`, { timeout: 60000 }).catch(() => {});
  const tThumb = Date.now();
  // Double-click now opens the Source monitor; the actions menu places the clip.
  await page.getByRole("button", { name: `Media actions for ${base}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 4000 }).catch(() => undefined);
  await page.waitForSelector("[data-timeline-clip]", { timeout: 60000 });
  const tPlaced = Date.now();
  // First non-empty program frame.
  await page.waitForFunction(() => {
    const cv = document.querySelector('canvas[aria-label^="Program"]');
    if (!cv) return false;
    const d = cv.getContext("2d")?.getImageData(0, 0, cv.width, cv.height).data;
    if (!d) return false;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4096) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit > 20;
  }, null, { timeout: 60000, polling: 25 });
  const tFrame = Date.now();
  await sleep(1500); // let post-import work (waveform, filmstrip) show up as long tasks
  const mon = frameStats(await page.evaluate(() => window.__perfMon.stop()));
  return {
    mainThreadDuringImportAndSettle: mon,
    importToBinMs: tBin - t0,
    importToThumbnailMs: tThumb - t0,
    dblclickToClipOnTimelineMs: tPlaced - tThumb,
    dblclickToFirstFrameMs: tFrame - tThumb,
    totalImportToFirstFrameMs: tFrame - t0,
  };
}


/**
 * OPENREEL_PERF_REACT=1: install a minimal React DevTools hook (needs a renderer built with
 * OPENREEL_REACT_PROFILING=1) that aggregates per-component self render time and render
 * counts across commits while window.__reactProf.on is true.
 */
async function installReactProfiler(page) {
  await page.addInitScript(() => {
    const acc = new Map();
    const prof = { on: false, commits: 0, acc, why: new Map() };
    window.__reactProf = prof;
    const name = (f) => {
      const t = f.type;
      if (!t) return null;
      if (typeof t === "function") return t.displayName || t.name || "(anon)";
      if (typeof t === "object") return t.displayName || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name || "(memo)";
      return null;
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), isDisabled: false,
      inject() { return 1; }, checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      onScheduleFiberRoot() {},
      onCommitFiberRoot(_id, root) {
        if (!prof.on) return;
        prof.commits++;
        // Same traversal rule as React DevTools: a child pointer shared with the alternate
        // means the subtree bailed out (its flags are stale), so do not descend.
        const stack = [[root.current, root.current.alternate]];
        while (stack.length) {
          const [f, prev] = stack.pop();
          if (!prev || f.child !== prev.child) {
            for (let c = f.child; c; c = c.sibling) stack.push([c, c.alternate]);
          }
          if (!prev) { /* mount */ }
          if (!(f.flags & 1) || ![0, 11, 14, 15].includes(f.tag)) continue;
          if (prev && f.memoizedProps === prev.memoizedProps && f.memoizedState === prev.memoizedState && f.tag !== 0 && f.tag !== 11) continue;
          let kids = 0;
          for (let c = f.child; c; c = c.sibling) kids += c.actualDuration || 0;
          const self = Math.max(0, (f.actualDuration || 0) - kids);
          let n = name(f);
          if (!n) continue;
          if (n === "(memo)" || n === "(anon)") {
            const chain = [];
            for (let up = f.return; up && chain.length < 4; up = up.return) { const un = name(up); if (un && un !== "(memo)" && !/^(Primitive|Menu|Popper|ContextMenu|Slot|Presence)/.test(un)) chain.push(un); }
            n = `${n}<${chain.join("<")}`;
          }
          const e = acc.get(n) || { self: 0, n: 0, incl: 0 };
          e.self += self; e.n += 1; e.incl += f.actualDuration || 0; acc.set(n, e);
          const alt = prev;
          if (alt && f.memoizedProps && alt.memoizedProps && f.memoizedProps !== alt.memoizedProps && typeof f.memoizedProps === "object") {
            const keys = new Set([...Object.keys(f.memoizedProps), ...Object.keys(alt.memoizedProps)]);
            let any = false;
            for (const k of keys) if (!Object.is(f.memoizedProps[k], alt.memoizedProps[k])) { any = true; const kk = `${n}.prop:${k}`; prof.why.set(kk, (prof.why.get(kk) || 0) + 1); }
            if (!any) { const kk = `${n}.sameProps(hook/ctx)`; prof.why.set(kk, (prof.why.get(kk) || 0) + 1); }
          } else if (alt) { const kk = `${n}.hook/ctx/parentBailout`; prof.why.set(kk, (prof.why.get(kk) || 0) + 1); }
        }
      },
    };
  });
}

const results = { label, root, env: {}, scenarios: {}, load: null };

/**
 * The new scenarios (scrub4k, playback4k, importN) must not take the already-baselined ones down with them: a
 * failure is recorded under results.scenarios.<name>.error, the app is closed, and the run continues, so only
 * that scenario's budgets report MISSING.
 */
async function guardScenario(names, app, body) {
  try {
    await body();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const name of names) results.scenarios[name] = { ...(results.scenarios[name] ?? {}), error: message };
    log(names.join("+"), `FAILED: ${message}`);
    if (app.current) await closeApp(app.current).catch(() => undefined);
  }
}

async function main() {
  results.env = {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    playwright: "1.60.0",
    commit: (() => { try { return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"]).toString().trim(); } catch { return "?"; } })(),
  };
  ensureClip();

  if (only.has("cold")) {
    // dwell 0 = click the instant the welcome screen is up (worst case);
    // dwell 3000 = a user who looks at the welcome screen for 3 s first.
    for (const [name, dwell] of [["cold", 0], ["coldAfter3sDwell", 3000]]) {
      const runs = [];
      for (let i = 0; i < coldRuns; i++) {
        const { app, t0 } = await launch();
        const tLaunched = Date.now() - t0;
        const shown = await waitWindowShown(app, t0);
        const page = await app.firstWindow();
        await page.waitForLoadState("domcontentloaded");
        // OPENREEL_PERF_REACT=1 (needs a renderer built with OPENREEL_REACT_PROFILING=1): per-component
        // render time while entering the editor, printed to stderr.
        const enterReact = process.env.OPENREEL_PERF_REACT === "1";
        if (enterReact) { await installReactProfiler(page); await page.reload(); await page.waitForLoadState("domcontentloaded"); }
        const { tClick, tEditor, inPage } = await enterEditor(page, dwell, enterReact);
        if (enterReact) {
          const snap = await page.evaluate(() => { const p = window.__reactProf; p.on = false; return { commits: p.commits, rows: [...p.acc.entries()] }; });
          log(name, "react commits", snap.commits, JSON.stringify(snap.rows.sort((a, b) => b[1].self - a[1].self).slice(0, 25).map(([n, e]) => `${r1(e.self)}ms x${e.n} ${n}`), null, 1));
          log(name, "react INCLUSIVE (ranked, nested double counted)", JSON.stringify(snap.rows.filter(([n]) => !/^Primitive|^Slot|SlotClone|Provider/.test(n)).sort((a, b) => b[1].incl - a[1].incl).slice(0, 30).map(([n, e]) => `${r1(e.incl)}ms x${e.n} ${n}`), null, 1));
        }
        const marks = await page.evaluate(() => ({
          origin: performance.timeOrigin,
          marks: Object.fromEntries(performance.getEntriesByType("mark").map((m) => [m.name, m.startTime])),
        }));
        const wall = (n) => (marks.marks[n] == null ? null : Math.round(marks.origin + marks.marks[n] - t0));
        if (process.env.OPENREEL_PERF_MARKS === "1") {
          const down = await page.evaluate(() => window.__enterEditor.down);
          log(name, "marks (ms after click pointerdown)", JSON.stringify(Object.entries(marks.marks).map(([k, v]) => [k, r1(v - down)]).filter(([, v]) => v > -50).sort((a, b) => a[1] - b[1])));
        }
        runs.push({
          electronLaunchedMs: tLaunched,
          windowShownMs: shown,
          welcomeVisibleMs: wall("openreel:welcome-visible"),
          editorMountedMs: wall("openreel:editor-mounted"),
          editorInteractiveFromSpawnMs: tEditor - t0,
          clickToEditorInteractiveMs: tEditor - tClick,
          clickToEditorInPageMs: inPage,
        });
        await closeApp(app);
        log(name, "run", i, JSON.stringify(runs[i]));
      }
      const keys = Object.keys(runs[0]);
      results.scenarios[name] = { runs, median: Object.fromEntries(keys.map((k) => [k, median(runs.map((r) => r[k]).filter((v) => v != null))])) };
    }
  }

  if (only.has("trace")) {
    // Load-robust CPU-time metrics: a Chromium content trace (started in the main process before the
    // renderer exists, see perf-trace-preload.cjs) of launch -> welcome -> click -> editor, analysed
    // by perf-trace.mjs. Wall-clock numbers are recorded alongside for A/B comparison only.
    for (const [name, dwell, primed] of [["traceCold", 0, false], ["traceDwell", 3000, false], ["traceCached", 0, true]]) {
      if (name === "traceCached" && !only.has("traceCached") && !only.has("trace-cached")) continue;
      const runs = [];
      // A trace whose renderer never recorded the entry mark is an invalid sample, not a slow one:
      // under heavy load the renderer's trace agent can register after the entry chunk has run, even
      // with the loadURL ordering in perf-trace-preload.cjs. Discard and retake it (bounded, and
      // reported in the results) instead of aborting the whole gate or analysing a partial trace.
      let discarded = 0;
      for (let i = 0; i < traceRuns; i++) {
        let userData = null;
        if (primed) {
          // A user's second and later launches: a first launch fills the profile's V8 code cache
          // (the renderer bundles are produced as code cache on first run), the measured launch
          // reuses the same profile. The plain traceCold/traceDwell scenarios always use a fresh
          // profile and therefore measure the worst case (every script compiled from source).
          const first = await launch([], root);
          userData = first.userData;
          await waitWindowShown(first.app, first.t0);
          await enterEditor(await first.app.firstWindow(), 0);
          await sleep(1500);
          await closeApp(first.app);
        }
        const { app, t0, load } = await launch(["--require", path.join(here, "perf-trace-preload.cjs")], root, userData);
        await waitWindowShown(app, t0);
        const page = await app.firstWindow();
        await page.waitForLoadState("domcontentloaded");
        const { tClick, tEditor } = await enterEditor(page, dwell);
        // Cumulative CPU of every Electron process at editor-interactive (load-robust: CPU time, not wall).
        const procCpu = await app.evaluate(({ app: a }) => {
          const by = {};
          for (const m of a.getAppMetrics()) by[m.type] = (by[m.type] ?? 0) + m.cpu.cumulativeCPUUsage * 1000;
          return by;
        }).catch(() => ({}));
        await sleep(300);
        const file = path.join(work, `trace-${name}-${i}.json`);
        await app.evaluate(async (_e, f) => { await globalThis.__openreelStopTrace(f); }, file);
        let metrics;
        try {
          metrics = analyzeTrace(JSON.parse(fs.readFileSync(file, "utf8")));
        } catch (error) {
          fs.rmSync(file, { force: true });
          await closeApp(app);
          if (/no openreel:entry mark/.test(String(error?.message)) && discarded < 2) {
            discarded++;
            log(name, "run", i, `discarded: ${error.message} (retake ${discarded}/2)`);
            i--;
            continue;
          }
          throw error;
        }
        if (process.env.OPENREEL_PERF_KEEP_TRACE) fs.copyFileSync(file, path.join(process.env.OPENREEL_PERF_KEEP_TRACE, `${label}-${name}-${i}.json`));
        fs.rmSync(file, { force: true });
        const proc = {
          procCpuBrowserMs: r1(procCpu.Browser ?? 0),
          procCpuRendererMs: r1(procCpu.Tab ?? 0),
          procCpuGpuMs: r1(procCpu.GPU ?? 0),
          procCpuTotalMs: r1(Object.values(procCpu).reduce((a, b) => a + b, 0)),
        };
        runs.push({ editorInteractiveFromSpawnMs: tEditor - t0, clickToEditorInteractiveMs: tEditor - tClick, loadAvg1: Math.round(load * 100) / 100, ...metrics, ...proc });
        await closeApp(app);
        log(name, "run", i, JSON.stringify(runs[i]));
      }
      const keys = Object.keys(runs[0]).filter((k) => typeof runs[0][k] === "number");
      results.scenarios[name] = { runs, discardedTraces: discarded, median: Object.fromEntries(keys.map((k) => [k, median(runs.map((r) => r[k]).filter((v) => v != null))])) };
    }
  }

  if (["import", "scrub", "playback", "memory", "session"].some((s) => only.has(s))) {
    const { app, page } = await (async () => {
      const l = await launch();
      const page = await l.app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      return { app: l.app, page };
    })();
    await enterEditor(page);
    await installMonitor(page);
    const importRes = await importAndPlace(app, page);
    results.scenarios.import = importRes;
    log("import", JSON.stringify(importRes));
    // Background seek-anchor sampling (new trees only) starts ~1.2 s after import and
    // finishes in a few seconds; give it time, and report when it completed.
    await sleep(Number(opt("settle-ms", 2500)));
    results.scenarios.seekAnchorMarks = await page.evaluate(() => Object.fromEntries(
      performance.getEntriesByType("mark").filter((m) => m.name.startsWith("openreel:seek-anchors")).map((m) => [m.name, Math.round(m.startTime)]),
    ));

    if (only.has("scrub")) {
      await page.evaluate(() => window.__perfMon.start(false));
      const clicks = await scrubClicks(page, scrubCount);
      const mon = frameStats(await page.evaluate(() => window.__perfMon.stop()));
      const drag = await dragScrub(page, 5);
      // Oscillate inside a 3 s window (about 3 passes) like a user hunting for a cut point.
      const revisit = await dragScrub(page, 6, { fromSec: 4, toSec: 7, radPerSec: 3.1 });
      // Zoom (ctrl+wheel) and horizontal scroll over a clip with a real filmstrip + waveform.
      const clipAt = await page.evaluate(() => { const r = document.querySelector("[data-timeline-clip]").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const wheelAt = (init) => page.evaluate(({ x, y, init }) => {
        document.elementFromPoint(x, y)?.dispatchEvent(new WheelEvent("wheel", { ...init, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      }, { x: clipAt.x, y: clipAt.y, init });
      await page.evaluate(() => window.__perfMon.start(false));
      for (let i = 0; i < 80; i++) { await wheelAt({ deltaY: i < 40 ? -50 : 50, ctrlKey: true }); await sleep(16); }
      const zoomReal = frameStats(await page.evaluate(() => window.__perfMon.stop()));
      await sleep(400);
      await page.evaluate(() => window.__perfMon.start(false));
      for (let i = 0; i < 80; i++) { await wheelAt({ deltaY: i < 40 ? 70 : -70, shiftKey: true }); await sleep(16); }
      const scrollReal = frameStats(await page.evaluate(() => window.__perfMon.stop()));
      results.scenarios.scrub = { clickSeek: clicks, clickSeekMainThread: mon, dragScrub5s: drag, dragScrubRevisit6s: revisit, zoomRealMedia80Events: zoomReal, scrollRealMedia80Events: scrollReal };
      log("scrub", JSON.stringify(results.scenarios.scrub));
    }

    if (only.has("playback")) {
      // The 1080p clip is generated at 30 fps (ensureClip); analysis.droppedFrames / effectiveFps are budgeted.
      results.scenarios.playback = await measurePlayback(app, page, 30);
      log("playback", JSON.stringify(results.scenarios.playback));
    }

    if (only.has("memory")) {
      const samples = [{ atSeconds: 0, ...(await memorySample(app, page)) }];
      const endAt = Date.now() + memSeconds * 1000;
      let nextSample = Date.now() + 60000;
      let cycles = 0;
      while (Date.now() < endAt) {
        await dragScrub(page, Math.min(10, Math.max(1, (endAt - Date.now()) / 1000)));
        cycles++;
        if (Date.now() >= nextSample) {
          samples.push({ atSeconds: Math.round(memSeconds - (endAt - Date.now()) / 1000), ...(await memorySample(app, page)) });
          nextSample += 60000;
        }
      }
      samples.push({ atSeconds: memSeconds, ...(await memorySample(app, page)) });
      const first = samples[0], last = samples[samples.length - 1];
      results.scenarios.memory = {
        soakSeconds: memSeconds, dragCycles: cycles, samples,
        deltaTotalMB: r1(last.totalMB - first.totalMB),
        deltaRendererMB: r1(last.rendererMB - first.rendererMB),
        deltaJsHeapMB: r1(last.jsHeapMB - first.jsHeapMB),
      };
      log("memory", JSON.stringify(results.scenarios.memory));
    }
    if (only.has("session")) {
      // Long mixed session: play, pause, click-seek, select + split + undo, scrub; memory
      // sampled once a minute. Edits are undone so the project does not grow unbounded.
      const samples = [{ atSeconds: 0, ...(await memorySample(app, page)) }];
      const endAt = Date.now() + sessionMinutes * 60000;
      let nextSample = Date.now() + 60000;
      let cycles = 0;
      const map0 = await rulerMap(page);
      while (Date.now() < endAt) {
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.mouse.click(map0.x0 + (2 + (cycles % 10) * 2.5) * map0.pxPerSec, map0.y);
        await sleep(300);
        await page.keyboard.press("Space");
        await sleep(12000);
        await page.keyboard.press("Space");
        await sleep(300);
        const clip = await page.evaluate(() => { const r = document.querySelector("[data-timeline-clip]")?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
        if (clip) {
          await page.mouse.click(clip.x, clip.y);
          await page.keyboard.press("s");
          await sleep(400);
          await page.keyboard.press("Meta+z");
          await sleep(400);
        }
        await dragScrub(page, 6);
        cycles++;
        if (Date.now() >= nextSample) {
          samples.push({ atSeconds: Math.round((Date.now() - (endAt - sessionMinutes * 60000)) / 1000), ...(await memorySample(app, page)) });
          nextSample += 60000;
        }
      }
      samples.push({ atSeconds: sessionMinutes * 60, ...(await memorySample(app, page)) });
      const first = samples[0], last = samples[samples.length - 1];
      results.scenarios.session = { minutes: sessionMinutes, cycles, samples, deltaTotalMB: r1(last.totalMB - first.totalMB), deltaRendererMB: r1(last.rendererMB - first.rendererMB), deltaJsHeapMB: r1(last.jsHeapMB - first.jsHeapMB) };
      log("session", JSON.stringify(results.scenarios.session));
    }
    await closeApp(app);
  }

  if (only.has("memory4k")) {
    // Peak memory of 4K playback across clip changes (the soak's 5.6 GB case, docs/soak-report.md):
    // three distinct 4K H.264 clips back to back, played end to end, memory sampled every 2 s.
    const clipSeconds = Number(opt("m4k-clip-seconds", 12));
    const uhdDir = path.join(work, "uhd");
    fs.mkdirSync(uhdDir, { recursive: true });
    const uhdFiles = [0, 1, 2].map((i) => path.join(uhdDir, `uhd-${i}.mp4`));
    uhdFiles.forEach((f, i) => {
      if (fs.existsSync(f)) return;
      execFileSync(ffmpeg, [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", `testsrc2=s=3840x2160:r=30,hue=h=${i * 70}`,
        "-f", "lavfi", "-i", `sine=frequency=${440 + i * 110}:sample_rate=48000`,
        "-t", String(clipSeconds + 2), "-c:v", "libx264", "-preset", "ultrafast", "-g", "250",
        "-pix_fmt", "yuv420p", "-b:v", "20M", "-c:a", "aac", "-shortest", f,
      ]);
    });
    const l = await launch();
    const page = await l.app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await enterEditor(page);
    await installMonitor(page);
    await page.locator("input[type=file]").first().setInputFiles(uhdFiles);
    for (const f of uhdFiles) await page.getByRole("button", { name: `Select media ${path.basename(f)}` }).waitFor({ timeout: 120000 });
    for (const f of uhdFiles) {
      await page.getByRole("button", { name: `Media actions for ${path.basename(f)}` }).click();
      await page.getByRole("menuitem", { name: "Add to timeline" }).click();
      await page.getByRole("button", { name: "Match Video" }).click({ timeout: 3000 }).catch(() => undefined);
      await sleep(400);
    }
    await page.waitForFunction((n) => document.querySelectorAll("[data-timeline-clip]").length >= n, uhdFiles.length, { timeout: 60000 });
    await sleep(Number(opt("m4k-settle-ms", 3000)));
    await page.evaluate(() => document.activeElement?.blur?.());
    const base = await memoryPeakSample(l.app);
    const map = await rulerMap(page);
    await page.mouse.click(map.x0 + 0.2 * map.pxPerSec, map.y);
    await sleep(500);
    const playSeconds = Math.max(6, uhdFiles.length * clipSeconds - 4);
    await page.evaluate(() => window.__perfMon.start(false));
    await page.keyboard.press("Space");
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < playSeconds * 1000) {
      samples.push({ atSeconds: r1((Date.now() - t0) / 1000), ...(await memoryPeakSample(l.app)) });
      await sleep(2000);
    }
    const mon = await page.evaluate(() => window.__perfMon.stop());
    await page.keyboard.press("Space");
    const peak = (key) => Math.max(0, ...samples.map((s) => s[key]));
    results.scenarios.memory4k = {
      clips: uhdFiles.length, clipSeconds, playSeconds, idleBefore: base, samples,
      peakTotalMB: peak("totalMB"), peakPrivateMB: peak("privateMB"), peakRendererMB: peak("rendererMB"), peakGpuMB: peak("gpuMB"),
      playback: frameStats(mon),
      droppedFrames25ms: frameStats(mon).framesOver25ms,
    };
    log("memory4k", JSON.stringify({ ...results.scenarios.memory4k, samples: undefined }));
    await closeApp(l.app);
  }

  if (only.has("scrub4k") || only.has("playback4k")) {
    const app = { current: null };
    await guardScenario(["scrub4k", "playback4k"].filter((n) => only.has(n)), app, async () => {
      // One 4K long-GOP clip on the timeline: click-seek latency, then 10 s of playback (one launch for both).
      const uhd = ensureUhdClip(Number(opt("uhd-seconds", 30)));
      const l = await launch();
      app.current = l.app;
      const page = await l.app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await enterEditor(page);
      await installMonitor(page);
      await page.locator("input[type=file]").first().setInputFiles(uhd);
      const base = path.basename(uhd);
      await page.getByRole("button", { name: `Select media ${base}` }).waitFor({ timeout: 120000 });
      await page.getByRole("button", { name: `Media actions for ${base}` }).click();
      await page.getByRole("menuitem", { name: "Add to timeline" }).click();
      await page.getByRole("button", { name: "Match Video" }).click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForSelector("[data-timeline-clip]", { timeout: 60000 });
      await sleep(Number(opt("settle-ms", 2500)));
      // Diagnostic (only with a VITE_OPENREEL_E2E=1 build): is the preview proxy ready before the clicks start?
      const proxyProbe = () => page.evaluate(() => {
        const hook = window.__openreelE2E?.proxy?.cache;
        if (!hook) return null;
        return Object.values(hook.store.getState().entries).map((e) => ({ status: e.status, enabled: e.enabled, w: e.width, h: e.height, error: e.error }));
      }).catch(() => null);
      const proxyBefore = await proxyProbe();
      if (only.has("scrub4k")) {
        await page.evaluate(() => window.__perfMon.start(false));
        results.scenarios.scrub4k = await scrubClicksWithCpu(l.app, page, scrub4kCount);
        results.scenarios.scrub4k.mainThread = frameStats(await page.evaluate(() => window.__perfMon.stop()));
        results.scenarios.scrub4k.previewProxy = { before: proxyBefore, after: await proxyProbe() };
        log("scrub4k", JSON.stringify(results.scenarios.scrub4k));
      }
      if (only.has("playback4k")) {
        results.scenarios.playback4k = await measurePlayback(l.app, page, 30);
        log("playback4k", JSON.stringify(results.scenarios.playback4k));
      }
      await closeApp(l.app);
    });
  }

  if (only.has("importN")) {
    const app = { current: null };
    await guardScenario(["importN"], app, async () => {
      // N clips handed to the import input at once; the clock stops per clip when its thumbnail <img> shows.
      const files = ensureImportClips(importClipCount);
      const l = await launch();
      app.current = l.app;
      const page = await l.app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await enterEditor(page);
      await installMonitor(page);
      await page.evaluate(() => window.__perfMon.start(false));
      const cpu0 = await appCpuMs(l.app);
      const t0 = Date.now();
      await page.locator("input[type=file]").first().setInputFiles(files);
      const readyAtMs = await Promise.all(files.map(async (f) => {
        const sel = `[aria-label="Select media ${path.basename(f)}"] img`;
        await page.waitForFunction((s) => document.querySelector(s) != null, sel, { timeout: 120000, polling: 25 });
        return Date.now() - t0;
      }));
      const cpu1 = await appCpuMs(l.app);
      const mainThread = frameStats(await page.evaluate(() => window.__perfMon.stop()));
      results.scenarios.importN = { ...summarizeImport({ readyAtMs, cpuMs: Math.max(0, cpu1 - cpu0) }), clipSeconds: 3, resolution: "1920x1080", mainThread };
      log("importN", JSON.stringify(results.scenarios.importN));
      await closeApp(l.app);
    });
  }

  if (only.has("bench")) {
    const fixture = await buildBenchFixture();
    const l = await launch();
    const app = l.app;
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const reactProf = process.env.OPENREEL_PERF_REACT === "1";
    if (reactProf) { await installReactProfiler(page); await page.reload(); await page.waitForLoadState("domcontentloaded"); }
    await enterEditor(page);
    await installMonitor(page);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, fixture);
    const tOpen = Date.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("openreel:menu:action", "open"));
    await page.waitForFunction(() => document.querySelectorAll("[data-timeline-clip]").length > 5, null, { timeout: 120000, polling: 25 });
    const openMs = Date.now() - tOpen;
    await sleep(2000);
    const visibleClips = await page.evaluate(() => document.querySelectorAll("[data-timeline-clip]").length);
    const bench = { openProject400Ms: openMs, visibleClipElements: visibleClips };

    // Selection latency: click a visible clip, wait for aria-pressed=true.
    const selLat = [], selCommit = [];
    const profileSelect = process.env.OPENREEL_PERF_PROFILE_SELECT === "1";
    const cdp = profileSelect || process.env.OPENREEL_PERF_TRACE_SELECT === "1" ? await page.context().newCDPSession(page) : null;
    if (cdp && profileSelect) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    }
    const reactAcc = new Map();
    const reactWhy = new Map();
    let reactCommits = 0, reactRuns = 0;
    const selSelf = new Map();
    const inclSelf = new Map();
    const traceEvents = cdp && process.env.OPENREEL_PERF_TRACE_SELECT === "1" ? new Map() : null;
    const addProfile = (profile) => {
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const parent = new Map();
      for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      profile.samples.forEach((id, i) => {
        const n = byId.get(id);
        if (n.callFrame.functionName === "(idle)") return;
        const seen = new Set();
        for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
          const f = byId.get(cur).callFrame;
          const k = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
          if (seen.has(k)) continue;
          seen.add(k);
          inclSelf.set(k, (inclSelf.get(k) || 0) + profile.timeDeltas[i] / 1000);
        }
        const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
        selSelf.set(k, (selSelf.get(k) || 0) + profile.timeDeltas[i] / 1000);
      });
    };
    for (let i = 0; i < 20; i++) {
      const idx = (i * 7) % Math.max(1, visibleClips);
      const box = await page.evaluate((k) => {
        const el = document.querySelectorAll("[data-timeline-clip]")[k];
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        el.dataset.perfIdx = String(k);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, idx);
      // scrollIntoView re-renders the lanes (scrollX); let that settle so only selection is measured.
      if (process.env.OPENREEL_PERF_SETTLE !== "0") await sleep(150);
      // Latency from the pointerdown event timestamp (not from when Playwright issued
      // the click, which would add its IPC cost): to the DOM commit of aria-pressed
      // (MutationObserver) and to the first rAF after it (next paint opportunity).
      const waiter = page.evaluate((k) => new Promise((resolve) => {
        const el = document.querySelectorAll("[data-timeline-clip]")[k];
        const mon = window.__perfMon;
        mon.pointerDownAt = 0;
        const t0 = performance.now();
        let settled = false;
        const mo = new MutationObserver(() => {
          if (settled || el.getAttribute("aria-pressed") !== "true" || !mon.pointerDownAt) return;
          settled = true;
          mo.disconnect();
          const commit = performance.now() - mon.pointerDownAt;
          requestAnimationFrame(() => resolve({ commit, painted: performance.now() - mon.pointerDownAt }));
        });
        mo.observe(el, { attributes: true, attributeFilter: ["aria-pressed"] });
        setTimeout(() => { if (!settled) { settled = true; mo.disconnect(); resolve(null); } }, 3000 + (performance.now() - t0) * 0);
      }), idx);
      if (process.env.OPENREEL_PERF_MUTATIONS === "1") await page.evaluate(() => {
        window.__muts = [];
        window.__mutObs?.disconnect();
        window.__mutObs = new MutationObserver((list) => { for (const m of list) window.__muts.push(m); });
        window.__mutObs.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
      });
      if (reactProf) await page.evaluate(() => { window.__reactProf.acc.clear(); window.__reactProf.why.clear(); window.__reactProf.commits = 0; window.__reactProf.on = true; });
      if (cdp && profileSelect) await cdp.send("Profiler.start");
      if (traceEvents) { await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] }, transferMode: "ReturnAsStream" }).catch(() => {}); }
      await page.mouse.click(box.x, box.y);
      const ms = await waiter;
      if (traceEvents) {
        const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
        await cdp.send("Tracing.end");
        const { stream } = await done;
        let text = "";
        for (;;) { const c = await cdp.send("IO.read", { handle: stream }); text += c.data; if (c.eof) break; }
        const parsed = JSON.parse(text).traceEvents ?? text;
        if (process.env.OPENREEL_PERF_TASKS === "1" && i === 12) {
          // Timeline of main-thread work for one click: offsets from the first event.
          const names = new Set(["RunTask", "FunctionCall", "EvaluateScript", "Layout", "UpdateLayoutTree", "Paint", "PrePaint", "Layerize", "FireAnimationFrame", "TimerFire", "EventDispatch", "MinorGC", "MajorGC", "V8.GC_MC_BACKGROUND_MARKING"]);
          const evs = parsed.filter((e) => e.ph === "X" && e.dur > 1500 && names.has(e.name));
          const tid = evs.filter((e) => e.name === "EventDispatch").map((e) => e.tid)[0];
          const main = evs.filter((e) => e.tid === tid).sort((a, b) => a.ts - b.ts);
          const t0 = main[0]?.ts ?? 0;
          bench.taskTimeline = main.map((e) => `${r1((e.ts - t0) / 1000)} +${r1(e.dur / 1000)} ${e.name} ${e.args?.data?.type ?? e.args?.data?.functionName ?? ""}`);
        }
        for (const e of parsed) if (e.ph === "X" && e.dur) { traceEvents.set(e.name, (traceEvents.get(e.name) || 0) + e.dur / 1000); if (e.name === "UpdateLayoutTree") traceEvents.set("#styleElements", (traceEvents.get("#styleElements") || 0) + (e.args?.elementCount ?? 0) * 1000); if (e.name === "Layout") traceEvents.set("#layoutObjects", (traceEvents.get("#layoutObjects") || 0) + (e.args?.beginData?.dirtyObjects ?? 0) * 1000); }
      }
      if (cdp && profileSelect) addProfile((await cdp.send("Profiler.stop")).profile);
      if (process.env.OPENREEL_PERF_MUTATIONS === "1") {
        await sleep(100);
        const summary = await page.evaluate(() => {
          const d = (n) => { if (!n || !n.tagName) return "#text"; const c = typeof n.className === "string" ? n.className.split(" ").slice(0, 2).join(".") : ""; let depth = 0; for (let x = n; x.parentElement; x = x.parentElement) depth++; return `${n.tagName.toLowerCase()}.${c}@${depth}`; };
          const out = {};
          for (const m of window.__muts) { const k = `${m.type}:${m.attributeName ?? ""}:${d(m.target)}`; out[k] = (out[k] || 0) + 1; }
          return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25);
        });
        (bench.mutationSamples ??= []).push(summary);
      }
      if (reactProf) {
        await sleep(150);
        const snap = await page.evaluate(() => { const p = window.__reactProf; p.on = false; return { commits: p.commits, rows: [...p.acc.entries()], why: [...p.why.entries()] }; });
        reactCommits += snap.commits;
        for (const [n, e] of snap.rows) { const c = reactAcc.get(n) || { self: 0, n: 0 }; c.self += e.self; c.n += e.n; reactAcc.set(n, c); }
        for (const [k, v] of snap.why) reactWhy.set(k, (reactWhy.get(k) || 0) + v);
        reactRuns++;
      }
      if (ms != null) { selLat.push(ms.painted); selCommit.push(ms.commit); }
      await page.evaluate(() => { const e = new KeyboardEvent("keydown", { key: "Escape" }); document.dispatchEvent(e); });
      await sleep(80);
    }
    if (traceEvents) bench.selectTraceMsPerClick = Object.fromEntries([...traceEvents.entries()].sort((x, y) => y[1] - x[1]).slice(0, 18).map(([k, v]) => [k, r1(v / Math.max(1, selLat.length))]));
    if (cdp && profileSelect) bench.selectProfileTopInclusiveMs = [...inclSelf.entries()].sort((x, y) => y[1] - x[1]).slice(0, 600).map(([k, v]) => `${r1(v / Math.max(1, selLat.length))} ${k}`);
    if (cdp && profileSelect) bench.selectProfileTopSelfMs = [...selSelf.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${r1(v / Math.max(1, selLat.length))} ${k}`);
    if (reactProf) {
      bench.reactCommitsPerSelect = r1(reactCommits / Math.max(1, reactRuns));
      bench.reactWhy = [...reactWhy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 600).map(([k, v]) => `${r1(v / reactRuns)} ${k}`);
      bench.reactSelfMsPerSelect = [...reactAcc.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, 120).map(([n, e]) => `${r1(e.self / reactRuns)}ms x${r1(e.n / reactRuns)} ${n}`);
    }
    bench.selectClipCommit = { n: selCommit.length, medianMs: r1(median(selCommit)), p95Ms: r1(pct(selCommit, 0.95)) };
    bench.selectClip = { n: selLat.length, medianMs: r1(median(selLat)), p95Ms: r1(pct(selLat, 0.95)), maxMs: r1(Math.max(0, ...selLat)) };

    // Wheel storms over the clip area (horizontal scroll, then ctrl+wheel zoom).
    const area = await page.evaluate(() => {
      const el = document.querySelector("[data-timeline-clip]");
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(area.x, area.y);
    // Dispatch the same WheelEvents the timeline listens for (modifier state is
    // not carried by Playwright's mouse.wheel in Electron).
    const wheel = (init) => page.evaluate(({ x, y, init }) => {
      const el = document.elementFromPoint(x, y);
      el?.dispatchEvent(new WheelEvent("wheel", { ...init, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, { x: area.x, y: area.y, init });
    await page.evaluate(() => window.__perfMon.start(false));
    for (let i = 0; i < 90; i++) { await wheel({ deltaY: 60, shiftKey: true }); await sleep(16); }
    bench.horizontalScroll90Events = frameStats(await page.evaluate(() => window.__perfMon.stop()));
    bench.scrollLeftAfterScrollPx = await page.evaluate(() => Math.round(document.querySelector(".workspace-timeline-scroll")?.scrollLeft ?? -1));
    await page.evaluate(() => { const s = document.querySelector(".workspace-timeline-scroll"); if (s) s.scrollLeft = 0; });
    await sleep(300);
    const tlWidth = () => page.evaluate(() => document.querySelector(".workspace-timeline-scroll")?.scrollWidth ?? -1);
    const ppsBefore = await tlWidth();
    await page.evaluate(() => window.__perfMon.start(false));
    let ppsPeak = ppsBefore;
    for (let i = 0; i < 60; i++) {
      await wheel({ deltaY: i < 30 ? -40 : 40, ctrlKey: true });
      if (i === 29) { await sleep(60); ppsPeak = await tlWidth(); }
      await sleep(16);
    }
    bench.zoom60Events = frameStats(await page.evaluate(() => window.__perfMon.stop()));
    await sleep(500);
    bench.zoomTimelineScrollWidthBeforePeakAfter = [ppsBefore, ppsPeak, await tlWidth()];

    // Ruler scrub on the big project.
    bench.dragScrub4s = await dragScrub(page, 4);

    // Click-seek to a presented frame on the 400-clip project (the soak's "feature timeline" case:
    // 216 / 596 ms p50 / p95). Run before the clip drag so it does not see a moved clip.
    bench.seekClick = await scrubClicksWithCpu(app, page, benchScrubCount);

    // Drag one clip 120px right.
    // Pick a clip whose centre actually hits that clip (not a splitter / ruler / another layer),
    // scrolled fully into its lane: the first harness version grabbed whatever matched
    // left > 400 and could land on the timeline resize handle, which then measured a panel
    // resize (a document-wide style recalc) instead of a clip drag. dragClip120px.movedPx validates.
    const clipBox = await page.evaluate(() => {
      const hit = (el) => {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return document.elementFromPoint(x, y)?.closest("[data-timeline-clip]") === el ? { x, y, id: el.getAttribute("data-timeline-item-id"), left: r.left } : null;
      };
      const els = [...document.querySelectorAll("[data-timeline-clip]")].filter((e) => e.getBoundingClientRect().left > 400);
      for (const el of els) { const h = hit(el); if (h) return h; }
      throw new Error("no draggable clip found for the drag scenario");
    });
    await sleep(200);
    await page.mouse.move(clipBox.x, clipBox.y);
    const dragCdp = process.env.OPENREEL_PERF_PROFILE_DRAG === "1" ? await page.context().newCDPSession(page) : null;
    if (dragCdp) { await dragCdp.send("Profiler.enable"); await dragCdp.send("Profiler.setSamplingInterval", { interval: 100 }); await dragCdp.send("Profiler.start"); }
    const traceDrag = process.env.OPENREEL_PERF_TRACE_DRAG === "1" ? await page.context().newCDPSession(page) : null;
    if (traceDrag) await traceDrag.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.invalidationTracking", "blink", "cc"] }, transferMode: "ReturnAsStream" });
    await page.evaluate(() => window.__perfMon.start(false));
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(clipBox.x + i * 4, clipBox.y); await sleep(16); }
    await page.mouse.up();
    await sleep(300);
    bench.dragClip120px = frameStats(await page.evaluate(() => window.__perfMon.stop()));
    bench.dragClip120px.movedPx = await page.evaluate((id) => {
      const el = document.querySelector(`[data-timeline-item-id="${id}"]`);
      return el ? Math.round(el.getBoundingClientRect().left) : null;
    }, clipBox.id).then((left) => (left == null ? null : left - Math.round(clipBox.left)));
    if (traceDrag) {
      const done = new Promise((r) => traceDrag.once("Tracing.tracingComplete", r));
      await traceDrag.send("Tracing.end");
      const { stream } = await done;
      let text = "";
      for (;;) { const c = await traceDrag.send("IO.read", { handle: stream }); text += c.data; if (c.eof) break; }
      const all = JSON.parse(text).traceEvents ?? [];
      const inval = new Map();
      for (const e of all) if (/InvalidationTracking|StyleRecalcInvalidation/.test(e.name)) {
        const d = e.args?.data ?? {};
        const k = `${e.name} reason=${d.reason ?? ""} node=${d.nodeName ?? ""} changed=${d.changedClass ?? d.changedAttribute ?? d.changedId ?? d.invalidatedSelectors ?? ""} extra=${d.extraData ?? ""}`;
        inval.set(k, (inval.get(k) || 0) + 1);
      }
      bench.dragInvalidationStacks = all.filter((e) => /Inline CSS style declaration/.test(e.args?.data?.reason ?? "")).slice(0, 4).map((e) => `${e.args.data.nodeName} ${(e.args.data.stackTrace ?? []).slice(0, 5).map((f) => `${f.functionName}@${String(f.url).split("/").pop()}:${f.lineNumber}:${f.columnNumber}`).join(" < ")}`);
      bench.dragInvalidations = [...inval.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${v}x ${k}`);
      const evs = all.filter((e) => e.ph === "X" && e.dur > 2000);
      const t0 = Math.min(...evs.map((e) => e.ts));
      bench.dragTrace = evs.sort((a, b) => a.ts - b.ts).slice(0, 80).map((e) => `${r1((e.ts - t0) / 1000)} +${r1(e.dur / 1000)} tid${e.tid} ${e.name} ${JSON.stringify(e.args?.data ?? e.args ?? {}).slice(0, 140)}`);
    }
    if (dragCdp) bench.dragProfile = summarizeProfile((await dragCdp.send("Profiler.stop")).profile, 70);
    results.scenarios.bench = bench;
    log("bench", JSON.stringify(bench));
    await closeApp(app);
  }
}

try {
  await main();
} finally {
  sampleLoad();
  const sortedLoad = [...loadSamples].sort((a, b) => a - b);
  results.load = {
    cpus: os.cpus().length,
    samples: loadSamples,
    median: sortedLoad.length ? sortedLoad[Math.floor(sortedLoad.length / 2)] : null,
    max: sortedLoad.length ? sortedLoad[sortedLoad.length - 1] : null,
  };
  const json = JSON.stringify(results, null, 2);
  if (outFile) fs.writeFileSync(outFile, json);
  console.log(json);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.exit(0);
