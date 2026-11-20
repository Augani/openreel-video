/**
 * Loaded into the Electron main process (`electron --require this.cjs <app>`) by the perf harness's
 * `trace` scenario. Starts a Chromium content trace before the app module runs so the renderer's
 * script compile / evaluate and main-thread tasks are recorded from the very first byte, which a
 * CDP session attached after launch cannot do. The harness stops it through
 * `globalThis.__openreelStopTrace(file)` once the page has settled.
 *
 * Race this file closes: `contentTracing.startRecording` resolves asynchronously (every process has
 * to acknowledge it), while the app's own `whenReady` handler creates the window and calls
 * `loadURL` in the same tick. On the fast lazy-engine build about one run in four had a renderer
 * that evaluated its entry chunk before recording began, so the `openreel:entry` mark was missing.
 * The fix is ordering, not a retry: `BrowserWindow.prototype.loadURL` / `loadFile` wait for the
 * recording to be confirmed, so the renderer cannot run a single line of app code before it.
 * (The BrowserWindow itself, and therefore the window-creation cost, is still created on time.)
 */
const { app, contentTracing, BrowserWindow } = require("electron");

let releaseLoads;
const traceStarted = new Promise((resolve) => {
  releaseLoads = resolve;
});

for (const method of ["loadURL", "loadFile"]) {
  const original = BrowserWindow.prototype[method];
  BrowserWindow.prototype[method] = function (...args) {
    return traceStarted.then(() => original.apply(this, args));
  };
}

app
  .whenReady()
  .then(() =>
    contentTracing.startRecording({
      included_categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "v8",
        "blink.user_timing",
        "loading",
        // Extra categories for investigations only (OPENREEL_PERF_TRACE_EXTRA="v8.wasm,disabled-by-default-v8.cpu_profiler").
        ...(process.env.OPENREEL_PERF_TRACE_EXTRA ? process.env.OPENREEL_PERF_TRACE_EXTRA.split(",") : []),
      ],
      recording_mode: "record-until-full",
    }),
  )
  .catch((error) => console.error("[perf-trace] startRecording failed", error))
  .finally(releaseLoads);

globalThis.__openreelStopTrace = (file) => contentTracing.stopRecording(file);
