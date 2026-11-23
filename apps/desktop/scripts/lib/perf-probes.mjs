/**
 * In-page probes shared with the playback benchmark (perf-playback.mjs): the rAF / long-task / Event Timing
 * monitor (`window.__perfMon`), frame statistics and the click-seek latency probe. The bodies are the same code
 * perf-harness.mjs runs (copied, not imported: the harness is a script that executes on import).
 */
import { latencyStats } from "../perf-analysis.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};
export { sleep, r1, median, pct };

export async function installMonitor(page) {
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



export const frameStats = (s) => {
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

export async function rulerMap(page) {
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
export async function scrubClicks(page, n) {
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
