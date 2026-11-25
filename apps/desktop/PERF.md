# Desktop performance harness and budgets

Real-app measurements for the Electron build (Playwright `_electron`, a throw-away
`--user-data-dir`, the built renderer in `apps/web/dist`).

```bash
pnpm --filter @openreel/desktop build              # the harness runs the BUILT app
pnpm --filter @openreel/desktop perf -- --only cold,bench --cold-runs 3 --out run.json
pnpm --filter @openreel/desktop perf:budget        # 3 harness runs, fail when a median is over budget
pnpm --filter @openreel/desktop perf:budget -- --from a.json b.json   # check saved runs, no launch
```

## Scenarios

| `--only` | What it measures |
|---|---|
| `cold` | Spawn to editor interactive. `cold` clicks the instant the welcome screen shows, `coldAfter3sDwell` waits 3 s first (a human). `clickToEditorInteractiveMs` is the Playwright wall clock (click to Program canvas + ruler, polling adds ~100 ms); `clickToEditorInPageMs` is the in-page pointerdown to first frame with both. |
| `bench` | A 400-clip, 8-track, 50-text project: open, select a clip (`selectClip`, pointerdown to first paint), wheel scroll and ctrl+wheel zoom, ruler scrub, drag one clip 120 px (`dragClip120px`, per-frame stats; `movedPx` proves the clip moved). |
| `import`, `scrub`, `memory`, `session` | 1080p import, click-seek latency, memory soak (`playback` has its own row below). |
| `memory4k` | Three distinct 4K H.264 clips (`--m4k-clip-seconds`, default 12) placed back to back and played end to end through two clip changes. Resident memory (`workingSetSize`, `privateBytes`, summed over every Electron process) is sampled every 2 s without forcing a GC, so the peak is a peak. `peakTotalMB` is budgeted (3072) and the rAF stats of the same run (`playback.framesOver50ms`) are budgeted next to it so the memory work cannot cost smoothness. |
| `playback` | (needs the shared import launch) 10 s of 1080p playback of a 30 fps clip, two passes. `analysis` = dropped frames / effective fps from the distinct Program-canvas frames of the hashing pass (`droppedFrames`, `droppedFramesPct`, `effectiveFps`, `rafOver25ms/50ms`), `cpuPctOfCore` = CPU of all Electron processes over the un-hashed pass. Budgeted: `playback.analysis.droppedFramesPct` (wall), `playback.cpuPctOfCore` (cpu). |
| `scrub4k` | One 4K long-GOP H.264 clip (`--uhd-seconds`, default 30, 10 s keyframes) on the timeline, `--scrubs-4k` (20) random ruler clicks. `latency.p50Ms/p95Ms/timeouts` = click to Program label showing the target time (seek-to-frame-visible); `cpuMsPerSeek` is the CPU analogue. |
| `playback4k` | Same 4K clip, same 10 s two-pass playback measure as `playback` (`--play-seconds` changes the 10). Shares the `scrub4k` launch when both are requested. |
| `importN` | `--import-clips` (8) distinct 3 s 1080p clips handed to the import input at once. `firstThumbnailMs`, `allThumbnailsMs`, `perClipThumbnailMs` (time until the thumbnail `<img>` of each clip shows) and `cpuMs` / `cpuMsPerClip`. |
| (in `bench`) | `bench.seekClick` is the same click-seek measure on the 400-clip project (`--bench-scrubs`, 20). |

Profiling switches (all print to stderr / the JSON): `OPENREEL_PERF_PROFILE_SELECT=1`,
`OPENREEL_PERF_TRACE_SELECT=1`, `OPENREEL_PERF_PROFILE_DRAG=1`, `OPENREEL_PERF_TRACE_DRAG=1`
(trace + style-invalidation causes), `OPENREEL_PERF_PROFILE_ENTER=1`, `OPENREEL_PERF_TRACE_ENTER=1`,
`OPENREEL_PERF_MARKS=1` (engine / bridge init marks after the click), and `OPENREEL_PERF_REACT=1`
(per-component render time; needs a renderer built with `OPENREEL_REACT_PROFILING=1`).
`--root <checkout>` benchmarks another already-built checkout with this checkout's harness, which
is how a before/after comparison is run (interleave A and B runs: the machine is rarely idle).

## Heavy-project playback benchmark (`perf:playback`, opt-in)

`perf-harness.mjs` measures one clip at a time; `perf:playback` measures the editing situation that hurts: a **heavy
project** driven through the BUILT app. It is opt-in, never part of `perf:budget`, has no gates and changes no budget.

```bash
VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build      # the e2e hooks build the project through the store
pnpm --filter @openreel/desktop perf:playback                  # table on stdout, --out file.json for the numbers
pnpm --filter @openreel/desktop perf:playback -- --play-seconds 30 --scrubs 20 --runs 3 --out run.json
pnpm --filter @openreel/desktop perf:playback -- --only playback --profile   # + renderer CPU profile (top self functions)
pnpm --filter @openreel/desktop perf:playback -- --root <other checkout>      # A/B against another built checkout
```

| Part | What it is |
|---|---|
| media (ffmpeg, generated once into `--media-dir`, default `$TMPDIR/orperf-playback-media`, deleted afterwards unless `--keep-media`) | 4K H.264 30 and 60 fps, 4K HEVC 30 and 60 fps (VideoToolbox when present), 1080p ProRes 422 (`prores_ks`, skipped when the encoder is missing), a stereo bed; noisy test pattern so decoders do real work |
| timeline | V1 three 12 s cuts (H.264 30, HEVC 30, H.264 60) with crossfade + wipe transitions, blur / glow / grade / 17^3 LUT; V2 4K HEVC 60 PiP; V3 4K H.264 60 PiP with LUT; V4 ProRes PiP; 3 titles; **10 audio tracks** |
| `playback` | 30 s (`--play-seconds`) at `Full` and `1/2` playback resolution. Dropped frames come from the editor's own paint log (no canvas read-back), plus frame-gap p50/p95/max, rAF stalls, watchdog stalls, **CPU time per process type** (Browser = main, Tab = renderer, GPU, Utility) and the ffmpeg sidecar (`ps`), JS heap and RSS |
| `scrub` | click-seek latency p50/p95 (pointerdown to the exact frame visible) and first pixel change, CPU per seek |
| `interact` | ctrl+wheel zoom, scroll and a 120 px clip drag on the 20-track timeline: rAF p95/max, frames over 50 ms, CPU |
| `open` | the saved `.oreel` opened through the real Open flow into a fresh app: time to all clips and to the first lit frame |
| `memory` | idle RSS and JS heap after the passes |

The script waits for preview-proxy / ingest ffmpeg work to go quiet before measuring (`settleMs`, `settleSidecarCpuMs`:
that is the import-time price of the project). Every run records the 1-minute load average; **wall-clock rows are only
judged when the load is below 4** (`wallClockJudged` in the JSON). Above that the table still prints them but flags them
and the CPU-time rows are the numbers to compare (CPU time moves far less with machine load than input-to-paint timings).

### WebGPU grade chain (round 30)

The per-clip effect / grade chain (Lumetri Basic Correction, wheels, curves, HSL bands, LUTs and input LUT, vignette, white
balance, Premiere-order hue curves, HSL Secondary, Lumetri Creative, Lens Correction, Dehaze, Deband, Deflicker gains) runs as
WGSL passes (`packages/core/src/video/gpu-grade-*.ts`): one `copyExternalImageToTexture` upload, every pass between two
resident rgba8unorm textures (8-bit rounding between passes exactly where the Canvas2D path rounds), one present pass into a
WebGPU canvas, `transferToImageBitmap` back. No `getImageData` / `createImageBitmap(canvas)` per stage, no readback. A clip with
an effect that has no WGSL port (blur, glow ...) keeps the old path for the whole clip so effect order never changes; the same
code is the fallback when WebGPU is missing or the device is lost. Preview (effects bridge) and export (VideoEngine) share the
shaders.

`perf:playback` takes `--grade-every-clip` (a full grade on every video clip) and `--grade-renderer canvas2d` (the A side: the
old path; same switch as `localStorage["openreel-grade-renderer"] = "canvas2d"`). The result carries `gradeChain` (frames the
chain rendered during the pass, fallbacks, readbacks).

### Round 24 results (heavy project, 30 s playback, machine load 9-14: CPU rows are the comparable ones)

Same generated project, same machine, base = `5e165883f` build vs this branch. Wall-clock rows were NOT judged (load >= 4):
dropped frames and latencies are informational, but they moved in the same direction as the CPU rows.

| Metric | base full | after full | base 1/2 | after 1/2 |
|---|---|---|---|---|
| dropped frames % | 78.5 | 62.2 | 72.7 | 41.2 |
| frame gap p95 ms | 427 | 135 | 251 | 71 |
| rAF frames > 50 ms | 113 | 4 | 180 | 0 |
| CPU ms per presented frame (all processes) | 497 | 319 | 287 | 162 |
| scrub p50 / p95 ms (click to exact frame) | 612 / 681 | 305 / 349 | | |

Where it went (renderer main thread, 15 s of playback, `--profile`): the CPU 17^3 LUT (`applyLutToData`, closures per
pixel) was 7.4 s, white balance 0.5 s, `createImageBitmap` of the effects canvas 2.5 s, GC 1.5 s, `texImage2D` 0.9 s.
Fixed so far: the LUT and white-balance kernels (bit-identical output, unit-tested against the previous code), layers
shown small decode small, decoders open in parallel and ahead of a cut. Open: the 1.1-1.5 s frame gap at the first
transition frame (timeline 11.5 s, the first transition render), the per-layer bitmap round trips
(`createImageBitmap` / GC) and the CPU grading itself (a GPU LUT path would remove the rest of `applyLutToData`).

## Export pipeline (round 32)

Profile first (`apps/desktop/scripts/export-parallel-bench.mjs --grade-all`, opt-in `localStorage["openreel-stage-profile"] = "1"` prints an
`[export-stages]` line per export; `--res 2160 --src 2160` for 4K, `--encoder hardware`, `--clean` for footage without the noise filter). On the
heavy generated project with a Lumetri grade on every clip the renderer was never the bottleneck: `VideoEngine.renderFrame` is 2-4 ms per frame at
1080p and 11-30 ms at 4K, the grade chain 0.5-7 ms of that. The costs that mattered were the final readback (`drawImage` into a CPU canvas +
`getImageData`, a synchronous GPU stall: 11 ms/frame at 1080p, 35-50 ms at 4K), the 4 B/pixel RGBA frame crossing the IPC port into ffmpeg's stdin
(8.3 MB at 1080p, 33 MB at 4K: structured clone, main-process receive, pipe write, 20-70 s of Browser-process CPU per export) and ffmpeg's own
RGB to YUV conversion.

| Change | Where |
|---|---|
| Frames are read back through a ring of MAP_READ buffers (`copyExternalImageToTexture` + `copyTextureToBuffer` + `mapAsync`), begun in call order and awaited later, so the GPU copy of frame N overlaps the render of N + 1 and the encoder write of N - 1; packed buffers are recycled after `postMessage` (which clones). Byte-identical to `getImageData` (e2e asserts it at padded and unpadded widths) | `packages/core/src/video/gpu-frame-readback.ts`, `NativeFFmpegBackend.addVideoFrame` |
| Experimental single-pass H.264 / H.265 conversion (bench flag `--yuv-on`): the same pass converts to planar 4:2:0 (BT.709 limited, swscale's chroma subsampling: pair mean, 8-tap bicubic vertical, fixed-point luma) so 1.5 B/pixel go over the port and ffmpeg runs no conversion (`rawYuv420` start field, `-vf setparams` instead of `scale`). CPU reference and fallback: `rgbaToI420Bt709`. Main process refuses the mode for ProRes / DNxHR / alpha / colour-managed / two-pass / smart render / broadcast, and rejects a frame of the wrong size | `export/yuv420-sdr.ts`, `sidecar/raw-yuv420.ts`, `ipc/export.ts`, `segment-args.ts` |
| Parallel segment workers take the session's pipe format from the start result (the orchestrator probes the GPU path once) | `parallel-segment-export.ts`, preload `export.start` |
| Escape hatches for A/B: `localStorage["openreel-gpu-readback"] = "off"` (CPU readback), `localStorage["openreel-yuv-input"] = "on"` (opt in to experimental I420) | |

ProRes, DNxHR, alpha, HDR / colour-managed, two-pass and smart render keep the RGBA pipe and ffmpeg's conversion, so their output is unchanged
(ProRes frame MD5s equal the previous build's). The WebCodecs backend already builds a `VideoFrame` straight from the bitmap (no readback) and is untouched.
Experimental I420 H.264 output differs from the previous build by the conversion arithmetic (about 1 code value on 0.15 % of luma samples, chroma within 1 on ~99 %): PSNR
against the previous export is 48-49 dB on ordinary footage and 44-45 dB on the noise-filtered stress pattern, where any change of input makes x264 diverge.
Files on that experimental path are tagged BT.709 primaries and transfer as well as matrix (they were `unknown`).

Measured on an M2 Pro, machine load 5-12, interleaved A/B in one build (a = old readback + RGBA, c = experimental I420): H.264 hardware 1080p 14.4 -> 7.1 s (CPU 52 -> 31 s),
H.264 software 4K 48.2 -> 28.5 s, H.264 hardware 4K 40.6 -> 18.6 s (CPU 131 -> 81 s). The shipped RGBA readback (b) saves 0-5 % wall, 5-14 % CPU; ProRes (RGBA, step b only) 1080p
15.9 -> 15.3 s. Software encoders at 1080p are bound by libx264 itself (creditWait is the encoder), so the wall gain there is the CPU the pipe no longer burns.

## Budget check

`scripts/perf-budget.mjs` runs the harness `--runs` times (default 3), takes the **median across
runs** of each metric in `scripts/perf-budgets.json` and exits 1 when one is over its budget.
Budgets are set for an otherwise idle machine.

It is deliberately **not** part of required CI: these are real input-to-paint timings and shared
or throttled runners move them by 2x. Use it locally before merging perf-sensitive changes or in a
dedicated idle job; one failure means re-run, two in a row means a regression.

## Harness fixes worth knowing

- `waitWindowShown` retries on "Execution context was destroyed" (it polls the main process while
  the window navigates), which crashed combined cold + bench runs.
- The Program-canvas watcher used to stack another body-wide MutationObserver every time the canvas
  was remounted (project open), adding tens of ms to every later DOM mutation and inflating
  `selectClip`. One pair of observers is live now.
- The drag scenario used to grab the first clip with `left > 400`, which could be the timeline
  splitter's hit area: it then measured a panel resize (one 40 ms document-wide style recalc), not a
  clip drag. It now picks a clip whose centre hit-tests to that clip and records `movedPx`.

## Perf gate (CI)

`.github/workflows/perf-gate.yml` runs two jobs on a weekly schedule and on demand
(`Actions -> Perf Gate -> Run workflow`, optional `runs`). It is **not** a required check and is
never triggered by pull requests: shared runners move real input-to-paint timings by 2x, so a single
red run means "re-run", two in a row on the same ref means a regression.

| Job | Runner | What it checks |
|---|---|---|
| `web-bench` | ubuntu | `pnpm --filter @openreel/web perf:gate`: the `*.performance.test.*` Vitest suites (timeline render budget, shader browser, timeline item actions). Budgets live in those test files. |
| `desktop-budget` | macos-15 | `pnpm --filter @openreel/desktop perf:budget -- --runs 5 --save <dir>`: builds the app, launches it 5 times (each run = a cold-start pass plus the 400-clip bench pass), takes the **median across runs** of each metric in `scripts/perf-budgets.json` and fails when one is over budget. The per-run harness JSON and the table are uploaded as the `desktop-perf` artifact and shown in the job summary. |

Run the same checks locally:

```bash
pnpm --filter @openreel/web perf:gate
pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop perf:budget -- --runs 5
```

### How budgets are set

`scripts/perf-budgets.json` maps a dotted path into the harness JSON to a `max`. A budget is
set from the **median of >= 5 runs on an otherwise idle developer machine** (Apple M2 Pro class),
rounded up to leave roughly 10 % headroom, then tightened only when a change measurably improves the
metric. Medians, not means or single runs, are checked, and every metric has a short `note` saying
what it measures. Raise a budget only with data (before/after medians in the commit message); a
budget that is only ever met on a quiet machine is a CI-runner problem, which is why the gate is
manual/scheduled and why `macos-15` results are compared with each other, not with the local
numbers. Measure on a quiet machine: with other builds/test runs sharing the CPU the cold-start
median moves by 20-40 %.

## Cold start analysis (release hardening)

`cold.median.editorInteractiveFromSpawnMs` (spawn -> editor interactive, clicking the instant the
welcome screen shows) measured on an otherwise idle M2 Pro, 6 interleaved harness invocations x 8
cold runs = 48 runs of the unmodified tree: **median 1087 ms, p25 1073, p75 1148**. The 1150-1172 ms
that was reported earlier came from runs taken while other builds and test suites shared the
machine (load average 10-57 makes the same build read 1400-1800 ms). The old 1100 ms budget sat 1 %
above the idle median and flapped, so it is now 1200 ms (about 10 % headroom, see "How budgets are set").

Where the time goes (medians, idle):

| Phase | ms | Notes |
|---|---|---|
| `_electron.launch` returns (Electron boot + Playwright handshake) | ~260 | not app code; main-process `module-load` is at ~70 ms uptime, `whenReady` ~115 ms |
| `whenReady` -> `BrowserWindow` created | ~80 | `protocol.handle` ~35-45 ms, window construction (vibrancy, hiddenInset) ~70 ms |
| window created -> `ready-to-show` | ~200 | renderer boot: `index.html`, entry chunk, `DesktopApp` chunk, first React commit |
| welcome visible -> editor interactive | ~465 wall clock | of which only ~165 ms is in-page (pointerdown -> first frame with canvas + ruler); the rest is the editor chunk and engine init still finishing when the click is instant, plus Playwright's actionability polling on a busy main thread (a user who waits 3 s sees 190-270 ms wall clock, 120-170 in-page) |

Tried and rejected, each A/B'd against the unmodified build in interleaved runs on the idle machine
(so a drifting machine hits both sides): (1) start the editor-chunk/engine warm-up right after the
welcome screen's first paint instead of in `requestIdleCallback`: 1085 -> 1135 ms median (worse
when idle; it looked 9 % better only on a heavily loaded machine, where the idle slot comes late);
(2) load `electron-updater` lazily (saves ~12-15 ms of main-process module evaluation, visible in
the `[startup]` marks but below the run-to-run noise of +-25 ms: 1105 -> 1127 median, no gain
demonstrated), so neither was kept. Remaining cost is spread over Electron boot, window creation and
renderer boot with no single dominant item left to remove; a real step down needs a V8 code cache
for the renderer bundles in a packaged build (the harness uses a throw-away profile, so every run is
a first run with no code cache), which has to be measured on a packaged app.

## Load-robust metrics (w8)

Wall-clock numbers move 2-5x when other builds share the machine (load average 40-60 measured:
the same build read 2.7-6.5 s spawn-to-editor), so the gate also records **renderer main-thread CPU
time** from a Chromium content trace. `--only trace` (scenarios `traceCold` = click at once,
`traceDwell` = click after 3 s) launches the app with `scripts/perf-trace-preload.cjs`
(`electron --require`, starts `contentTracing` once `app` is ready, before the window exists),
clicks "New project", stops the trace and `scripts/perf-trace.mjs` reads it. Every trace event
carries `tdur`/`tts` (thread CPU time), which does not grow when the core is shared, unlike wall time.

| Metric (ms unless noted) | Meaning |
|---|---|
| `startupCpuMs`, `startupCompileCpuMs`, `startupEvalCpuMs`, `startupLongTasks` | navigation start -> welcome screen visible: main-thread CPU, `v8.compile*` CPU, outermost `v8.evaluateModule` CPU, tasks > 50 ms |
| `warmCpuMs`, `warmCompileCpuMs` | welcome visible -> click (editor chunk + engine warm-up) |
| `enterCpuMs`, `enterTaskCpuMs`, `enterLayoutCpuMs`, `enterGcCpuMs`, `enterLongTasks` | click -> Program canvas + ruler present |
| `totalCpuMs`, `totalCompileCpuMs`, `totalChunksCompiled` | navigation start -> editor interactive |
| `agentStackCompileBeforeClickCpuMs`, `agentStackCompileInEnterCpuMs` | compile cost of the agent/MCP chunks on the user's path (informational) |
| `*CompilePerChunk` | top chunks by compile CPU |

Limit: module *evaluation* is one `v8.evaluateModule` event per top-level graph, so evaluation is
not attributable per chunk (compile is). Budgets for these are in `scripts/perf-budgets.json`
(`traceCold.*`, `traceDwell.*`). Even CPU time is noisy at load 60 (same build: total 449-947 ms),
so use the A/B tool for any claim:

```bash
# build both trees, copy each desktop dist + web dist into <root>/apps/{desktop,web}/dist, then
node scripts/perf-ab.mjs --a <baseRoot> --b <candidateRoot> --pairs 5 --out ab.json
```

It alternates A/B order each pair and prints the median per side plus the median of per-pair
differences. `OPENREEL_PERF_KEEP_TRACE=<dir>` keeps the raw traces (open in `chrome://tracing`).

## Cold-path work removed in w8

| Change | Effect (deterministic where possible) |
|---|---|
| `packages/core` `sideEffects` allow-list (action handlers, `motion-keyframes`, workers); unused modules and singletons are no longer retained in the entry chunk | entry chunk 2097.6 -> 1908 KB raw, 605.8 -> 539 KB gzip; gsap (307 KB) and ~190 KB of engines moved to lazy chunks; the multicam-analysis worker 510 -> 4.9 KB |
| `ColorGradingEngine`/`VideoEffectsEngine` compile GL programs on first use instead of 4 + 13 programs at warm-up (`lazy-shader-compile.test.ts`) | no GPU round trip per program on the warm-up path |
| gsap plugin registration on first use | gsap no longer a module-level side effect |
| Agent/MCP stack (executor chunk, 860 KB) loads after the editor warm-up settled and the thread is idle, not on the first animation frame | off the cold-start and enter-editor paths; an MCP client talking to the app in the first ~2 s after launch now waits for the stack |

## Required-capable CI: `perf-smoke`

`.github/workflows/ci.yml` job `perf-smoke` (ubuntu, no timings, safe to mark required):

- `pnpm --filter @openreel/web bundle:budget` (`apps/web/scripts/check-bundle-size.mjs`, budgets in
  `apps/web/bundle-budgets.json`): raw and gzip size of the entry chunk, the initial JS closure (entry +
  static imports + modulepreloads), the editor chunk and the agent chunk.
- `pnpm --filter @openreel/web perf:gate`: the `*.performance.test.*` suites including
  `Timeline.select-drag.performance.test.tsx`, which counts ClipComponent renders on a 400-clip
  project: select 1, move selection 2, playhead tick 0; committing a one-clip move re-renders every
  mounted clip once (288 today; the budget stops it growing).

Desktop trace budgets stay in the scheduled `perf-gate` workflow (real Electron, macOS).
`OPENREEL_E2E_DIST=<build made with VITE_OPENREEL_E2E=1>` makes the Playwright e2e run against that
production bundle instead of the dev server (needed to prove tree-shaking changes).

### w8 A/B result (6 interleaved pairs, `perf-ab.mjs`, base = w7 tip, load average 6-13)

| Metric (median, ms) | w7 base | w8 | diff |
|---|---|---|---|
| traceCold startupCpuMs | 167 | 152.3 | -14.7 |
| traceCold startupCompileCpuMs / startupEvalCpuMs | 39.9 / 60.1 | 35.7 / 53.8 | -4.2 / -6.3 |
| traceCold enterCpuMs | 143.2 | 131.2 | -12 |
| traceCold totalCpuMs (nav -> editor interactive) | 456.6 | 444.2 | -12.4 |
| traceDwell startupCpuMs / enterCpuMs / totalCpuMs | 157.2 / 124.3 / 456.3 | 148.3 / 119.5 / 446.5 | -8.9 / -4.8 / -9.8 |
| traceCold clickToEditorInteractiveMs (wall) | 600 | 557 | -43 (per-pair median +10: noise) |
| traceCold editorInteractiveFromSpawnMs (wall) | 1731 | 1733 | +2 (noise) |

The CPU gain is small (about 10-15 ms of ~450 ms of renderer main-thread work, 2-3 %): the
cold path is dominated by Electron boot and module compile/evaluate of the 1.9 MB entry chunk, and
wall-clock deltas of that size are inside run-to-run noise. A larger step needs the entry chunk's
remaining engines (video, motion, audio, ~1.4 MB, kept alive by the project store importing them)
moved behind lazy imports, which is a store-architecture change not done here.

## Cold start round 2 (perf/cold-start-r2)

Starting point: `cold.median.editorInteractiveFromSpawnMs` about 1,225 ms at machine load ~7 (base `8f928b3df`).
The question was what sits between the welcome screen and the editor when the click is instant.

### Where the time went (Chromium trace + V8 CPU profile, `OPENREEL_PERF_TRACE_EXTRA`)

`perf-trace-preload.cjs` accepts `OPENREEL_PERF_TRACE_EXTRA="v8.wasm,disabled-by-default-v8.cpu_profiler,toplevel"`
(comma separated extra trace categories); the profile samples show native frames, so a blocked main thread is
attributable. Every cold trace had one main-thread task of **158-178 ms with 3-7 ms of CPU** between the editor chunk's
compile and `openreel:engine:start`. The profile put it in `MasterTimelineClock`'s `new AudioContext()`
(`getPlaybackController()` runs first in `engine-store.initialize`): the **first AudioContext of an app run blocks its
constructor ~150-170 ms** (output-device discovery in the audio service), even at load 3.6. A micro-benchmark (bare
Electron window, `new AudioContext()`; apps/desktop is not involved):

| first `new AudioContext()` | ms |
|---|---|
| plain | 155-175 |
| `latencyHint`, `sampleRate` variants | no change |
| `--disable-features=AudioServiceOutOfProcess` | 90-95 (architecture change, not taken) |
| `--enable-features=AudioServiceLaunchOnStartup` | 120-130 (no gain once enumeration is warm) |
| a second renderer already created one | 3.8 |
| `navigator.mediaDevices.enumerateDevices()` (async) issued 150-800 ms earlier | **46-50** (60-70 if issued 150 ms earlier, while enumeration is still running) |

`enumerateDevices()` is asynchronous (it takes ~270 ms in the background and costs the main thread nothing), walks the
same device list, and with no capture permission returns unlabelled entries, so it neither prompts nor reveals
anything. `DesktopApp` now calls `warmAudioDevices(navigator)` (`src/desktop/audio-warmup.ts`) in the effect that
marks the welcome screen mounted, i.e. after it is committed. macOS only was measured; Windows and Linux were not.

### Interleaved A/B (A = `8f928b3df`, B = this branch)

Real harness `cold` scenario (the budgeted metric), 8 alternating A/B launches, medians, ms. Load average per pair
11.6 13.2 11.3 11.6 9.8 8.6 8.5 7.5 (the machine runs other agents' work; all numbers are "loaded", none is idle):

| | A | B | B - A (median of pairs) |
|---|---|---|---|
| `editorInteractiveFromSpawnMs` | 1227 | 1150 | **-73** |
| `welcomeVisibleMs` | 661 | 635 | -9 |
| `clickToEditorInteractiveMs` (Playwright wall) | 455 | 373 | -82 |
| `clickToEditorInPageMs` (pointerdown to first frame) | 155 | 161 | -4 |

Chromium-trace A/B (`perf-ab.mjs`, 8 pairs, load 6.2-7.9), medians:

| `traceCold` | A | B | pairDiff |
|---|---|---|---|
| `editorInteractiveFromSpawnMs` | 1211 | 1181 | -39 |
| `clickToEditorInteractiveMs` | 528 | 405 | -121 |
| `startupWallMs` / `startupCpuMs` | 254.6 / 98.2 | 251.9 / 98.5 | -2.7 / +0.6 |
| `enterCpuMs` | 136.7 | 130.3 | -1.7 |
| `totalCpuMs` / `totalCompileCpuMs` | 413 / 94.5 | 425 / 96.5 | +10 / +2.7 |
| `warmCpuMs` | 190 | 200.4 | +13 |

CPU did **not** go down: the enumeration adds about 10 ms of main-thread work (IPC replies) to the warm window; what
shrinks is the blocked wall time. The `traceDwell` rows (human-speed click) are unchanged (`enterCpuMs` +1.4,
`clickToEditorInteractiveMs` -8, `totalCpuMs` +12): a user who waits has the editor warm either way, the gain is for a
click that lands while the warm-up is still running. `traceCached` (repeat launch, code cache): compile 10.8 ms, produce
0 in both trees, so the cache path is unaffected.

Where the enumeration is issued matters (each variant 8 interleaved pairs against the base, real `cold`):

| variant | `editorInteractiveFromSpawnMs` pairDiff | `welcomeVisibleMs` pairDiff |
|---|---|---|
| issued from the preload (first thing in the renderer) | -63 | **+31** (the browser-side enumeration slows the first paint) |
| issued when the welcome screen mounts (kept) | -73 | -9 |

### Tried and rejected (all measured, interleaved)

- **Serve built `.js`/`.css` from memory in the `app://` handler** instead of `net.fetch(file://)`: the warm-up's ~55
  chunk requests did complete sooner (all done 33 ms after the burst vs 65 ms), and the code cache kept working, but the
  editor opened 116-133 ms **later** (5 pairs, click to interactive +116). Not kept; the cause was not isolated.
- **Start the warm-up right after the welcome's first paint (rAF + timeout) instead of an idle callback, run the effects
  bridge in parallel with the engine init, prefetch the `mediabunny` chunk, and drop the eager 1920x1080 title canvas**:
  on top of the audio warm-up, 6 pairs: `editorInteractiveFromSpawnMs` pairDiff +5 (click to interactive -61, but the
  welcome screen moved later by the same amount). No net gain, so none of it was kept. (The title canvas was not the
  blocking call; the profile showed the AudioContext.)
- **Register `protocol.handle` after `createWindow()`** to overlap its 35-45 ms with the renderer starting: the page
  never loaded (the navigation does not wait for the handler). Reverted.
- **`experimentalMinChunkSize` 150k / 300k**: chunks on the editor path 57 -> 54 / 53 but compile CPU 97 -> 108 and no
  wall gain.
- **Vibrancy / `hiddenInset` cost in the `BrowserWindow` constructor**: 56-78 ms with it, 71-89 ms without (bare window);
  it is the constructor itself, not those options.
- A V8 code cache for the renderer already exists (`v8CacheOptions: "bypassHeatCheck"`, `codeCache: true`); `traceCached`
  above shows it working. A *first* launch still compiles everything, which is what the harness measures.

### What is left

One main-thread block remains on the path: the first `AudioContext` still costs ~48 ms after the warm-up, plus the
`EditorInterface` first commit (React 66 ms inclusive, 33 ms layout, 497 buttons / 164 Popper / 99 DropdownMenu mounted at
once). Making the audio graph lazy until first play touches `MasterTimelineClock`, `RealtimeAudioGraph`, `AudioEngine` and
`Preview`'s mount effects, which was not attempted here. The wall-clock budget stays 1200 ms: the measured 1150-1181 ms was
taken at load 6-13, not on the idle machine the budget is defined for, so it is not tightened on that evidence.

## Desktop ingest + proxies (w9)

Proxies on desktop are built by the main process with the native ffmpeg sidecar (`src/main/ingest/`):
ProRes 422 Proxy (`.mov`, with an H.264 preview twin because Chromium cannot decode ProRes) or H.264
(`.mp4`), at 1/2, 1/4, 720p or 1080p, into `Proxies/` beside the project file. The queue runs 1-2 jobs,
each ffmpeg at `nice 10` (BELOW_NORMAL on Windows) with about a quarter of the cores, writes `*.part` then
renames, and persists to `proxy-queue.json` so an app restart resumes it.

Real-Electron check: build with `VITE_OPENREEL_E2E=1`, then
`pnpm --filter @openreel/desktop test:ingest-e2e`. Set `OPENREEL_FFMPEG_PATH` to use another ffmpeg
(ignored in packaged builds).

Playback / scrub cost (sum of `app.getAppMetrics()` `percentCPUUsage` over all Electron processes, M-series Mac,
12 s 4K long-GOP H.264 source at 60 Mbps, proxy = 1080p H.264; two runs, machine shared with other jobs):

| | proxies on | proxies off |
|---|---|---|
| playback 8 s | 3.7 / 5.2 | 6.3 / 7.6 |
| scrub 6 s (24 seeks) | 1.8 / 2.6 | 5.4 / 7.3 |

**Unit correction (w19):** `percentCPUUsage` is a share of all cores, not of one core: a busy loop that keeps
one core at 100 % (by `cumulativeCPUUsage`) reads 8.3 on this 12-core machine. Multiply the table by the core count
(x12 here) for % of one core: playback 44-62 (proxy) / 76-91 (original), scrub 22-31 / 65-88. The perf-harness
`cpuPctOfCore` and `cpuMsPerSeek` rows use `cumulativeCPUUsage`, so their budgets are set from the corrected values.

Hardware decode keeps absolute numbers low; the proxy saves roughly 30-40 % on playback and 55-70 % on scrubbing.

### scrub4k p95: the proxy warm-up window (w21 f-scrub)

Profiling with per-click samples (`scrub4k.samplesMs`, click order) and the preview-proxy state (`scrub4k.previewProxy`,
only in a `VITE_OPENREEL_E2E=1` build) showed the p95 was not a steady-state cost. With the native ffmpeg present the 4K
clip is auto-proxied (720p, GOP 30) and every click after the proxy is ready costs about 60 ms. The first five clicks, made
while the proxy was still encoding, cost 290 / 656 / 905 / 661 / 468 ms on the 10 s-GOP original. With 20 clicks the p95 is
the single worst sample, i.e. click 3 of the warm-up window. (Without a bundled ffmpeg the proxy fails and all clicks hit the
original, p50 about 440 ms; set `OPENREEL_FFMPEG_PATH` in a worktree that lacks `resources/bin`.)

The fix is to make the proxy ready sooner, not to approximate frames: on macOS the proxy job no longer passes
`-hwaccel auto` (`proxyUsesHwDecode`). VideoToolbox decode plus a readback per 4K frame for the CPU scaler is slower than
frame-threaded software decode (30 s 4K to 720p, `h264_videotoolbox` encode, M2 Pro): 4K H.264 5.7 s vs 2.6 s, noisy 60 Mbps
H.264 10.6 s vs 5.6 s, 4K HEVC 6.7 s vs 4.6 s. The proxy is ready before the first click, so no click sees the original.
Latency is still time to the exact (proxy-resolution) frame; the metric definition is unchanged. Other platforms keep hwaccel
(not measured). Evaluated and not built: an all-intra scrub proxy (the existing proxy is already GOP 30 and the encode, not
the GOP, was the cost), a nearest-thumbnail-first display (the harness already records `firstPixelChange`, 34 ms, but the
budget is time to exact), parallel seek decoders (CPU-bound on a 10 s GOP, same total work), hardware decode of the original
(already used by Chromium's `<video>`).

`--only scrub4k,playback4k`, 5 interleaved base/new runs, same session, medians (min-max):

| | before | after |
|---|---|---|
| scrub4k latency p95 (budget 800) | 901.4 ms (899.2-905.2) | 90.1 ms (88.6-94.5) |
| scrub4k latency p50 | 60.3 ms (58.9-65.2) | 60.5 ms (55.4-62.3) |
| scrub4k `cpuMsPerSeek` | 488.3 (471.2-497.7) | 421.6 (419.9-435.4) |
| scrub4k `staleAfterFinal` | 0 (one run 1) | 0 in all runs |
| playback4k `cpuPctOfCore` | 47.8 (46.5-48.6) | 47.7 (46.9-48.3) |
| playback4k dropped frames (10 s) | 0 (one run 1) | 1 in three runs, 0 in two (1 frame of 300, effective 29.9 fps; not shown to be caused by the change, but not ruled out) |

Limit: this removes the window for a clip whose proxy finishes before the first scrub (30 s here, about 3 s of encode). A
long 4K clip still scrubs on the original, at the cold long-GOP cost, until its proxy is ready (the encode is now about
twice as fast, not instant). A progressive proxy would be the next step.

### Paused-frame element retention (w20 g-scrub)

`SCRUB_VIDEO_RELEASE_DELAY_MS` 350 -> 4000 ms, `--only scrub4k,playback4k`, 5 interleaved runs each (base/new alternating,
idle-ish machine, medians with min-max):

| | 350 ms | 4000 ms |
|---|---|---|
| scrub4k `cpuMsPerSeek` | 614 (607-710) | 513 (468-541), about -16 % |
| scrub4k latency p50 | 441 ms (434-461) | 429 ms (425-450) |
| scrub4k latency p95 | 919 ms (913-952) | 907 ms (890-912), still over the 800 ms budget |
| playback4k `cpuPctOfCore` | 41 (38.6-47.4) | 45.4 (38.6-46), ranges overlap; no clear regression, not proven |
| playback4k dropped frames | 0 (one run 1) | 0 (one run 1) |

The change removes CPU, not tail latency: p95 is dominated by cold long-GOP seeks (up to a 10 s GOP) and is
unchanged. Retention is bounded by Preview's cap of two paused-frame elements; peak GPU / renderer memory with the
longer delay was not measured.

## w9 release hardening

### Entry chunk (web)

The project store, engine store, bridges and `project-manager` no longer import the video, motion,
audio, media-import, text-animation, export or action-handler code statically.
`services/engine-modules.ts` is the only static importer; `services/lazy-engines.ts` resolves a
memoised dynamic import (warmed together with the editor chunk by `editor-loader`);
`LazyActionExecutor` keeps the action handlers lazy; `encoder-backend.ts` holds the encoder-factory
state so `main.tsx` no longer retains the export engine. Entry chunk **1988.0 KB raw / 568.8 KB gzip
-> 608.5 KB / 179.0 KB**; initial JS closure 2570.2 / 747.6 -> 1190.7 / 357.8 KB. The 565 -> 575 KB
gzip budget raise is reverted into a real budget of 190 KB.

### Drag path (deterministic render counts)

Committing a one-clip move re-rendered every mounted clip (288 of 288) on every frame of a drag, because
`tracks`, `trackHeights` and `onSelect` got new identities on each commit, and `clip/move`
`structuredClone`d the whole project for its inverse and rebuilt every track. Now: `ClipLaneInfo`
(cross-clip derived state computed once per lane, identity-preserving), a `ClipComponent` memo that ignores
the track list identity, a stable `trackHeights` Map and select handler, `clip/move` rebuilding only the
source/target track and no project copy for its inverse.
`Timeline.select-drag.performance.test.tsx`: one-clip move **288 -> 1** re-renders (budget now <= 2).

### Wall-clock budgets on a loaded machine

Cold `editorInteractiveFromSpawnMs`, `dragClip120px.rafP95Ms` and `framesOver50ms` are wall-clock and
cannot be judged while 4-6 agents share the machine (load 9-12). The budgets were NOT loosened. To judge
them on an idle machine:

```bash
pnpm --filter @openreel/desktop build
pnpm --filter @openreel/desktop perf:budget -- --runs 5      # medians vs scripts/perf-budgets.json
# CPU/trace A/B against the previous tip (both built):
node apps/desktop/scripts/perf-ab.mjs --a <4d306980 checkout> --b <this checkout> --pairs 5
```

### Early MCP request (real Electron)

`apps/desktop/test/mcp-early-request.electron.test.ts` (opt in: `pnpm --filter @openreel/desktop build`,
then `pnpm --filter @openreel/desktop test:electron`) sends `tools/list` and `tools/call` through the
loopback MCP endpoint -> main bridge -> renderer ~2 ms after window creation. Before the fix the request
was dropped by IPC (page had no listener yet) and timed out after 10 s; the preload now announces
readiness and main queues until then (answered in 1.5 s, 403 tools).

## w10 perf GA gate

### Idle-machine reference procedure (wall-clock budgets)

`perf-budget.mjs` records the 1-minute load average (`os.loadavg()[0]`) around every Electron launch
(`load.samples/median/max` in each harness JSON) and prints the load next to its verdict. Two kinds of budget:

| Kind | Budgets | Judged |
|---|---|---|
| `cpu` | `traceCold.*`, `traceDwell.*`, `traceCached.*` (renderer main-thread CPU time from a Chromium trace), `scrub4k.cpuMsPerSeek`, `playback.cpuPctOfCore`, `playback4k.cpuPctOfCore` (process CPU time) | always |
| `mem` | `memory4k.*` | always |
| `wall` | `bench.*` (incl. `bench.seekClick.*`), `cold.*`, `coldAfter3sDwell.*`, `scrub4k.latency.*`, `playback*.analysis.*`, `importN.*` (Playwright wall clock) | only when the median over runs of each run's max load is <= `--max-load` (default 2.5, env `OPENREEL_PERF_MAX_LOAD`); otherwise the row is `n/j ... not judged: load X > 2.5` and does not fail the check |

CPU time is not load-proof either (shared caches, SMT and clocks stretch it 1.3-2x at load 30-60), so an `OVER` CPU row taken
above the threshold is annotated, and an interleaved A/B is the only way to make a claim. `--require-wall` makes the exit code 3
when wall budgets could not be judged (use it in the release job so an unjudged gate cannot pass silently).

To produce the number the GA gate needs (`cold.median.editorInteractiveFromSpawnMs` <= 1200):

1. Quit Xcode, simulators and every other agent/test run; wait until `uptime` shows a 1-minute load below 2 and Spotlight
   is not indexing. An Apple M2 Pro idles at 1-2 with the editor closed.
2. `pnpm --filter @openreel/desktop build`
3. `pnpm --filter @openreel/desktop perf:budget -- --runs 5 --save perf-out/ --require-wall`
4. Record the printed `machine load` line together with the medians. A result with `n/j` rows is not a pass: the last
   output line must be `ALL BUDGETS VERIFIED, including wall-clock` and the exit code 0. `WALL-CLOCK NOT VERIFIED` on the
   last line (exit 3 with `--require-wall`) means the machine was too busy; find what is running (`top -o cpu`), quit it and
   repeat. Keep the machine untouched for the whole run (a run takes several minutes per harness pass, and the scrub,
   playback and import scenarios make each pass longer): moving the mouse in another app or starting a build raises the load
   mid-run and turns the verdict into `NOT VERIFIED` even if the start was quiet.
5. Do not copy a `provisional` budget's number into a release note as if measured: replace it with 1.3-2x the median you
   just recorded, in the same commit as the recorded numbers.

### Reading the report: "WALL-CLOCK NOT VERIFIED"

The last line of `perf:budget` is the verdict. If any wall-clock budget was skipped because the machine was
busier than `--max-load`, it reads `WALL-CLOCK NOT VERIFIED: N wall-clock budget(s) were not judged ...` even
when every judged (CPU and memory) budget passed, and `all judged budgets met` above it is NOT a pass for the
wall-clock gate. The exit code stays 0 in that case so a developer run on a busy laptop does not fail, and
becomes 3 only with `--require-wall`; 1 always means a budget was exceeded. `ALL BUDGETS VERIFIED, including
wall-clock` is printed only when no wall-clock row was `n/j`. (`budgetVerdict` in `scripts/perf-analysis.mjs`,
unit-tested in `test/perf-analysis.test.ts`.)

### Scrub, playback and import budgets (w19)

These budgets (`bench.seekClick.*`, `scrub4k.*`, `playback.*`, `playback4k.*`, `importN.*`) were written without
being run (the harness holds a shared machine lock). Each one is set from a figure already documented in
`docs/soak-report.md` / this file, named in its `note` in `perf-budgets.json`; where the documented figure came
from a different fixture the note says PROVISIONAL, and `importN` has no small-clip baseline at all. The first
idle-machine `--require-wall` run should replace them with 1.3-2x the measured median. Latency and dropped-frame
budgets are wall-clock (judged at load <= 2.5); the `cpuMsPerSeek` and `cpuPctOfCore` analogues are `"kind":"cpu"`
and judged at any load. A saved harness JSON from before w19 has none of these keys, so `--from old.json` reports
them as MISSING.

### What was changed and measured

All A/B numbers: `perf-ab.mjs`, A = `eb120bb4` built and copied to a scratch root, B = this branch, interleaved, median of the
per-pair differences ("pairDiff", negative = B better), on a machine shared with five other agents (load 25-55, so CPU time is
inflated and noisy; the same build against itself moves enter-CPU by +-30 ms, see the protocol note below). Only differences that
kept their sign across runs are claimed.

| Change | Evidence |
|---|---|
| `electron-updater` (+ js-yaml, fs-extra, builder-util-runtime, semver, sax) is imported after the first paint, packaged builds only (`updater.ts`, `index.ts`) | ~45 % of the main bundle's module-evaluation time in a `--cpu-prof` of `require(dist/main/index.js)` (50.7 + 36.2 ms of 105 ms inclusive). Main-process module-load CPU, 7 interleaved launches (`process.cpuUsage`): **53.4 -> 39.1 ms median (-14 ms)**, wall 55.9 -> 44.6 ms |
| The desktop shell chunk (`DesktopApp`, `WindowControls`, icons) is `modulepreload`ed from `index.html` (`vite-plugins/desktop-preload.ts`) instead of being discovered after the 52 ms entry evaluation | Chromium trace: entry request at 202 ms, shell request at 318 ms (a whole extra fetch round before the welcome screen). Welcome screen earlier: `startupWallMs` pairDiff **-58.8 / -133.6 ms** (traceCold / traceDwell, 5 pairs, load 25-44), **-289.7 / -57.2 ms** (6 pairs, load 32-54), **-46.6 ms** on a repeat launch |
| lucide icons are one `icons` chunk in the desktop build (`vite.config.ts`, desktop only) instead of ~20 four-hundred-byte chunks | `totalChunksCompiled` **61 -> 49** in every A/B run, renderer `startupTasks` pairDiff -49..-65, 8 of the welcome path's requests gone. The web build is unchanged (its `initialJs` bundle budget is untouched) |
| Trace GC metric fixed (`perf-trace.mjs`) | see "Click-path GC" |
| `traceCached` scenario (repeat launch with a primed profile) | see "V8 code cache" |

Tried and not kept:

- A direct `fs.readFile` fast path in the `app://` protocol handler instead of `net.fetch(file://)`. A/B of the same build with and
  without it (5 pairs, `perf-ab.mjs --env-a`): startup wall -8.5 ms, enter CPU -32 / +29.7 ms (opposite signs). No measurable
  effect, so the extra code path was removed.
- V8 heap flags for the renderer (`OPENREEL_JS_FLAGS`, appended after `--max-old-space-size`, kept as a test hook).
  `--min-semi-space-size=16` removes the young-generation scavenges (total GC 11-17 -> 8-10 ms) but the one mark-compact in
  the click window stays; `--initial-old-space-size=96` removes the mark-compact but adds two scavenges. At most ~5 ms inside noise
  that is several times larger, with a memory cost, so no flag is shipped.
- The agent/executor stack (`chat-store` -> `@openreel/agent` + `host-singleton`: 13.5 + 3.7 ms of compile plus evaluation, roughly
  20-30 ms of CPU on the warm-up path) is still statically reachable from the editor chunk. Making it lazy is the largest purely
  eager item left, but `ChangesPanel`, `ChatMessage` and `MobileAIResultCard` call `editingToolReadOnly` synchronously on persisted
  chat history, which needs the tool registry, so it is a behaviour change rather than a mechanical split. Not done in this wave.

### Harness race (`openreel:entry` missing in ~1/4 runs): fixed, not retried

`contentTracing.startRecording` resolves asynchronously, but the app's `whenReady` handler created the window and called `loadURL` in
the same tick, so on the fast build the renderer could evaluate its entry chunk before recording began. `perf-trace-preload.cjs` now
wraps `BrowserWindow.prototype.loadURL/loadFile` to wait for the recording to be confirmed (the window is still created on time, so
window-creation cost stays in the trace). The retry loop in `perf-ab.mjs` is gone: a run with a missing mark fails the comparison.
0 of 100+ traced launches in this wave (A/B runs, flag experiments, repeat-launch runs) lacked the mark.

### Click-path GC (+21 ms)

The reported delta was a metric artifact. `enterGcCpuMs` summed every `V8.GC_*` event, but V8 emits a tree per collection
(`MajorGC > V8.GCFinalizeMC > V8.GC_MARK_COMPACTOR > V8.GC_MC_*`), so one mark-compact was counted four to six times. On four
recorded traces the old formula read 18-35 ms while the top-level events (`MajorGC`, `MinorGC`, `V8.GCIncrementalMarking`) read
**7-11 ms**: one major GC ("finalize incremental marking via stack guard", 4-6 ms) plus incremental marking, because the heap crosses
V8's initial old-space limit while the editor chunk and engines initialise. `gcCpuMs` now counts top-level events only and
`enterMajorGcs`, `enterMinorGcs`, `totalGcCpuMs` are reported. The A/B shows no GC regression (`enterGcCpuMs` pairDiff -5.9 / -0.3 ms
and -1.0 / -1.1 ms in the two comparisons, `totalGcCpuMs` -3 / +1.1 and -2.2 / -0.7).

### V8 code cache (what a returning user gets)

The harness uses a throw-away profile per launch, so every `traceCold`/`traceDwell` run compiles every script from source and *produces*
the code cache (`v8CacheOptions: "bypassHeatCheck"`, `codeCache: true` on the `app` scheme). `traceCached` fills a profile with one
launch and measures the second launch of the same profile (3 runs, load 55-65):

| renderer main thread, navigation -> editor interactive | fresh profile | repeat launch |
|---|---|---|
| `totalCompileCpuMs` | 217-223 | **18.8-22.5** |
| `startupCompileCpuMs` | 38.7-42.3 | **3.1-5.8** |
| `totalCacheProduceCpuMs` | 72.5-74 | **0** |
| `totalCpuMs` | 977-1041 | 697-780 |

The cache already works end to end for the custom scheme: a returning user's cold start costs ~200 ms less renderer CPU than the
harness's fresh-profile number, and that number is the worst case (first launch after install or update). `traceCached.*` budgets
fail if the cache stops being used. Seeding a profile with a pre-built cache at install time was not attempted (entries are keyed to
the exact Chromium/V8 build and flags).

### Honest state of the GA wall-clock gate

`cold.median.editorInteractiveFromSpawnMs <= 1200` was **not judged** in this wave: every measurement was taken at load 25-60, and the
budget tool now refuses to judge it above load 2.5. What the A/B evidence supports: the welcome screen appears roughly 50-290 ms
earlier at load 25-55, main-process startup CPU is ~14 ms lower, and 12 fewer chunks are fetched and compiled. The 1284 ms reading
(load 5-13) should fall, but whether it is under 1200 ms has to be read off the idle-machine procedure above.
`traceCold.median.totalChunksCompiled` was tightened 64 -> 54 (49 measured).

Desktop onboarding (after w18) moved `totalChunksCompiled` 46 -> 55 with no compile-time cost
(`totalCompileCpuMs` 105 -> 102, `totalCpuMs` 470 -> 430, both at high load): six modules the editor already loaded
(chat-store, api-endpoints, SettingsDialog, useTour, workspace-apply, ConnectSnippets) are now also imported by the
lazy onboarding sheets, so Rollup emits them as shared chunks instead of inlining them into `EditorInterface`, and the
onboarding host chunk is warmed at idle. The budget is 58. Each trace now records `totalChunkNames`, so the next
chunk-count change can be attributed by diffing the lists.

## Peak memory during 4K playback

The 4K soak (`docs/soak-report.md`) peaked at 5.6 GB renderer / 6.6 GB all processes in the first minutes of 4K
long-GOP playback. Where it went, measured with `apps/web/e2e/soak/playback-4k-memory.spec.ts` (four ten-minute
sources, 4K H.264/HEVC plus 1080p, one of them layered over another) and macOS `footprint` on the renderer:

* **Whole-file audio buffers, never evicted.** Preview decoded the audio of every source on the timeline to a full
  `AudioBuffer` (230 MB for ten minutes of stereo) and kept them all. On the web build the decode went through
  ffmpeg.wasm, which first copies the whole *video* file (683 MB for the 4K source) into wasm memory.
  Now: audio buffers live in a byte-budgeted LRU (`ByteBudgetCache`, sized from device memory, see below), buffers of
  clips within 15 s of the playhead are pinned, upcoming clips are decoded ahead, nearest clips first, and the web build
  streams the track out of the Blob with mediabunny (`decodeAudioBufferStreaming`) instead of copying the file.
* **Source-resolution playback canvases.** The multi-layer playback path created a `CanvasSink` without a size, so every
  pooled canvas and every captured `ImageBitmap` was 3840x2160 (33 MB) for a monitor that is at most 1920 wide.
  Now the sink is asked for the monitor size (times the clip's own scale), 4x fewer bytes per frame.
* **A decoder per source, opened up front.** Native single-element playback opened a `<video preload=auto>` for every
  distinct source on the timeline before the first frame. Now only the playing clip and the next one are open; clips
  are released as playback moves on.
* **Caches budgeted in entries, not bytes.** The decoded frame cache, scrub cache and audio cache now share one budget
  (`computeMediaMemoryBudget`: about 12 % of system RAM, 384 MB to 2 GB, split audio 40 / frames 35 / scrub 10 /
  images 15). System RAM is `navigator.deviceMemory` on the web and the hardware probe (`os.totalmem`) on desktop.

RSS caveat: on macOS most of a renderer's RSS during playback is "reclaimable" pages (freed decoded frames the kernel
has not taken back yet). `footprint` reports them separately and the soak spec records both, `peakTotal` (RSS, what
the budget row uses) and `peakInUse` (dirty minus reclaimable).

## Cold start round 3 (perf/cold-start-r3)

Starting point: base `190d0da0a` (1.0 release content, r1 and r2 included), `cold.median.editorInteractiveFromSpawnMs`
about 1,090 ms at load 4-8.

### Where the time goes now

`cold` clicks the instant the welcome screen shows, but Playwright's click only lands once the renderer main thread
has finished the warm-up, so spawn -> editor interactive is about **warm-up done + 160-200 ms** (`openreel:warm-done`,
new mark; `warmDoneMs` in the harness output). Renderer marks, ms after navigation start, median of 7 launches:

| mark | ms |
|---|---|
| `welcome-visible` | 180 |
| `warm-start` (idle callback) | 209 |
| `warm-editor` / `engine:modules` (editor chunk graph, 55 requests, loaded) | 394 |
| `engine:start` (after `getPlaybackController()`) | 461 |
| `warm-done` (video init, effects bridge) | 520 |

`engine:start - engine:modules` is the playback controller's `new AudioContext()`. The V8 CPU profile (`OPENREEL_PERF_TRACE_EXTRA`)
puts a 52-89 ms **blocked** (13-20 ms CPU) main-thread task there on every cold run, the largest single block left on the
path. The editor-enter task (click -> canvas + ruler) is one 115-125 ms task: about 60 ms React render (64 commits, the
Preview component renders 24 times), 42 ms layout (the first layout is forced inside the timeline's
`useLayoutEffect` that sets `scrollLeft`) and a major GC.

### What r2 left on the table

r2 warmed the audio stack with `navigator.mediaDevices.enumerateDevices()` (async, ctor 150 -> 46-70 ms). Findings this round:

- `enumerateDevices()` also starts the **video capture service** (a 150-200 ms `device_monitor_mac` task in its own
  process) and costs the editor chunk graph about 25 ms (`modules` 369 ms without it, 391 ms with it).
- What makes the first `new AudioContext()` fast is *another* AudioContext having been built by some other renderer
  first (output stream parameters of the default device are then cached browser-side), not a device-list walk. Bare
  Electron, main renderer's first AudioContext, ms:

| setup | first `new AudioContext()` |
|---|---|
| nothing | 165-220 |
| `new AudioContext({sinkId: {type: "none"}})` | 163-175 (no gain; `setSinkId("")` afterwards works) |
| `enumerateDevices()` in a helper window | 155-170 |
| another window's AudioContext, 800 ms earlier | **3.8-7** |
| a cross-scheme hidden iframe's AudioContext (own renderer process), 900 ms earlier | **3.7-4.4** |
| a `WebContentsView` that is never attached to a window, 800 ms earlier | **6-6.5** (main-process cost of creating it: 1 ms; a hidden `BrowserWindow` costs about 60 ms) |

In the real app the helper has far less lead time (its process boots while the main renderer boots), so a warm-up frame
alone still left the editor's constructor at 60-66 ms: the audio **service** process was only started at about 307 ms.

### What shipped

1. **A throw-away frame process pays the first-use cost.** The preload inserts a hidden, sandboxed `<iframe>` of the
   new `openreel-warm://` scheme at `DOMContentLoaded` (about 90 ms in); the main process serves one tiny page that
   only runs `new AudioContext()`. A different scheme is a different site, so Chromium gives it its own renderer
   process (the harness does not see it as a window: it is a frame, not a page, which a hidden `WebContentsView`
   would be: Playwright's `firstWindow()` returned it and broke every e2e). Only windows created by `createWindow`
   pass `--openreel-audio-warm` (`additionalArguments`), so linked-composition windows do not pay for it. The frame
   is removed 1.5 s after it loaded.
2. **`--enable-features=AudioServiceLaunchOnStartup`** (`gpu/switches.ts`, merged into the single `enable-features`
   list) starts the audio service with the app, so the frame's constructor is not waiting for the service to boot.
   Neither half works alone (A/B below).
3. `warmAudioDevices` / `enumerateDevices()` (r2) is removed.
4. New marks `openreel:engine:modules`, `warm-start`, `warm-editor`, `warm-done`; `warmDoneMs` in the harness `cold` rows.

First-AudioContext block (ctor = `engine:start - engine:modules`) and warm-up end, medians of 10 interleaved launches
(load 5-6), ms after navigation start:

| variant | ctor | `modules` | `warm-done` |
|---|---|---|---|
| r2 (enumerate) | 65-72 | 390 | 511-516 |
| nothing | 158 | 368 | 580 |
| audio service on startup only | 120 | 369 | 543 |
| warm frame only (inserted at DOMContentLoaded) | 65 | 374-376 | 492-496 |
| warm frame + enumerate | 63 | 403 | 522 |
| **warm frame + service on startup (shipped)** | **25-27** | 368-373 | **454-460** |

### Interleaved A/B on the real `cold` scenario (A = `190d0da0a`, B = this branch)

8 alternating pairs x 2 launches per harness invocation, so 16 runs per side; load average per pair
5.6 4.9 4.1 7.0 7.5 8.3 6.8 6.0 (the machine runs other agents' work; nothing here is an idle-machine number).

| metric (median, ms) | A | B | B - A |
|---|---|---|---|
| `editorInteractiveFromSpawnMs` | 1088 | 994 | **-94** |
| `editorInteractiveFromSpawnMs` p25 / p75 / max | 1072 / 1112 / 1334 | 982 / 1007 / 1071 | |
| `clickToEditorInteractiveMs` | 346 | 295 | -51 (bimodal, not reproduced: see below) |
| `editorMountedMs` | 897 | 827 | -70 |
| `welcomeVisibleMs`, `windowShownMs` | 540, 534 | 536, 531 | -4, -3 (no first-paint cost) |
| `clickToEditorInPageMs` | 146 | 141 | -5 |
| `coldAfter3sDwell.editorInteractiveFromSpawnMs` | 3910 | 3898 | -12 (a user who waits has the editor warm either way) |

Independent re-run (verify-launch3, 8 interleaved pairs x 2 launches, load 4.5-10): `editorInteractiveFromSpawnMs` median 1080 -> 1004
(-76; p25/p75 1060/1091 -> 992/1012; 7 of 8 pair medians negative, the positive pair is a single 1318 ms B outlier). `clickToEditorInteractiveMs`
is bimodal (about 230 when the click lands after the warm-up, 360-420 when it lands during it) and its median is decided by the mix: it
read 248 -> 301 there (mean 305 -> 307), so the -51 above is not a reliable effect; the spawn-to-interactive number is the one to trust.

The gain is for a click that lands while the warm-up is still running (the budgeted `cold` case); a human-speed click
sees the same editor. `perf-budgets.json`: `cold.median.editorInteractiveFromSpawnMs` 1200 -> 1100.
Chromium-trace A/B (`perf-ab.mjs`, 8 pairs, load 4.8-8.4), medians: `traceCold.editorInteractiveFromSpawnMs` 1120 -> 1028
(pairDiff -70), `clickToEditorInteractiveMs` 364 -> 308 (-47); renderer main-thread CPU does not move (`totalCpuMs` 423.7 ->
427.5, `startupCpuMs` 91.7 -> 93.1, `totalCompileCpuMs` 97.4 -> 96.6): the constructor's wait was blocked time, not CPU. All
Electron processes together burn about 100 ms more CPU in `traceCold` (`procCpuTotalMs` 2433 -> 2518, pairDiff +103): the audio
service starts at launch and the frame process runs its page. `traceDwell` rows are unchanged (enter -2.8 ms CPU).

`pnpm perf:budget -- --runs 3` on the final tree (load 5.0): all 17 CPU/memory budgets met; the wall budgets were not
judged (load > 2.5) but `cold.median.editorInteractiveFromSpawnMs` read 1027 / 1010 / 1032 against the new 1100.

### Limits

- macOS only was measured. On Windows the audio service is already out of process but its start and device
  discovery cost was not measured; on Linux (PulseAudio/PipeWire) nothing was measured. The frame and the feature
  are harmless where they do not help.
- One more renderer process lives for about 1.5-3 s at start-up, and the audio service process now exists from
  launch even when the editor is never opened.
- The frame's response carries `COEP`/`CORP` headers because the app page is cross-origin isolated (a cross-origin
  frame under `require-corp` has to opt in). Not tested without them; a failure only loses the warm-up, the editor
  builds its own AudioContext as before.

### Tried and rejected this round (all measured)

- **Pre-building the master clock's AudioContext when the warm-up starts** (in the idle callback, right after the editor
  chunk fetch is issued): the constructor blocked 252 ms at that point (the audio service was not up yet) and delayed the
  chunk graph; `editorInteractiveFromSpawnMs` +81 (pairDiff, load 18-25, noisy but the block is in the trace).
- **Mounting the media library, inspector and action rail after the first paint** (`useAfterFirstPaint`, desktop only):
  `enterCpuMs` -0.7 / +5 (traceCold / traceDwell). The React profile explains it: those panels are about 10 ms of 125;
  the editor DOM is only about 700 nodes, the cost is cold-JS execution, the forced first layout and 64 commits.
- **`v8CacheOptions: "bypassHeatCheckAndEagerCompile"`**: repeat-launch `enterCpuMs` 133 -> 128, 128 -> 129. Lazy function
  compilation is not what the enter task spends.
- **Deferring `warmEncoderProbe` (4 s) and the renderer's WebCodecs hardware probe (2.5 s)**: totalCpuMs -3.7, no wall
  change (6 pairs).
- **`fs.readFile` + `new Response(buffer)` for built assets in the `app://` handler**: warm-done 525 -> 516 (10 launches,
  within noise). A bare Electron micro-benchmark of the handler (56 chunk-sized fetches) completes in 35 ms with the
  current `net.fetch` re-wrap, 17-21 ms from memory; the 55-request burst takes 130-190 ms in the real app because the
  browser UI thread and the GPU process are busy with the first frame, not because of the handler.
- **Starting `loadEditorModule()` from `main.tsx` instead of the idle callback**: the chunk graph then finished at the
  same absolute time (about 400 ms) with a later welcome mark (+20); it is contention, not request latency.
- **Prefetching the effects-bridge chunk next to the editor chunk**: warm-done 519 -> 517.
- **`sinkId: {type: "none"}` for the first context**: constructor unchanged (163-175 ms).
- **Hidden helper `BrowserWindow` / `WebContentsView` created by the main process**: the best bare-Electron numbers
  (constructor 4-6 ms) but Playwright lists every WebContents as a window, so `app.firstWindow()` (about 17 test files and
  the harness) returned the helper. A same-process frame of another scheme gives the same warm-up without a window.

## Render cache: heavy stack, live vs rendered

`--only renderCache` (needs a `VITE_OPENREEL_E2E=1` build for the effect and cache hooks): a 1080p30 clip with two
glows, a Gaussian blur, a 17^3 LUT and a grade. It plays 10 s live, runs Render In to Out over the first 12 s (frames go to
the scratch-disk folder under the throw-away profile), then plays the same 10 s again. Two measures per pass:

* `paintLog`: the editor's own log of frames painted to the Program canvas (`renderCache.getTelemetry()`), each tagged
  `cache` or `live`; dropped = 30 fps ideal minus distinct frames painted. This adds no per-frame cost and is the result.
* `canvasHashing`: the older pass that reads the Program canvas back every rAF. On a 1080p canvas the read-back costs more
  than cached playback itself (rAF gaps of hundreds of ms), so it under-reports the cached path badly; it is kept for
  comparison only (`canvasHashingNote` in the JSON).

Measured on an Apple Silicon Mac (12 cores) with a load average of 14 to 17 from other jobs (so absolute numbers are
pessimistic; the harness records `load`):

| pass | frames painted / expected | dropped | source of frames | CPU % of a core |
|---|---|---|---|---|
| live compositing | 17 / 311 | 294 (94.5 %), 1.6 fps | 17 live | 119 |
| after Render In to Out | 301 / 301 | 0 (0 %), 30 fps | 301 cache, 0 live | 91 |

Rendering 360 frames took 211 s (0.59 s per frame, the same cost as the live path), 11.5 MB on disk (about 32 KB per
frame). The Electron e2e (`pnpm --filter @openreel/desktop test:render-cache-e2e`, 2 clips of a 720p ProRes source at a
1080p sequence, load 10 to 12) measured: live 80 of 92 dropped, from cache in the same session 0 of 90, and from cache
after quitting and relaunching the app, reopening the project 0 of 90, with 0 live frames. Render of 120 frames: 29 s.


## Clip drag frames (w22)

`dragClip120px` used to report two frames of 50 to 58 ms. A trace (`OPENREEL_PERF_TRACE_DRAG=1`, raw events with
`OPENREEL_PERF_TRACE_DRAG_RAW=<file>`; CPU profile with `OPENREEL_PERF_PROFILE_DRAG=1` and `OPENREEL_PERF_PROFILE_DRAG_RAW=<file>`,
resolve names with a `vite build --sourcemap`) showed store commits and an inspector mount stacked into single frames:

* **Drop.** The queued live move and the drop's own move to the same time were two store commits, each re-rendering the timeline
  (about 25 ms at 400 clips), in one mouseup task. A lone clip now skips the queued move, and skips the drop's move when the store
  already has the clip there. Companions and batches keep the queued move.
* **Activation.** The activating mousemove rendered the drag state and the first live move committed in the same frame's rAF; the
  first move now lands a frame later. Selecting the dragged clip also mounted the whole inspector (every tab panel) in a task right
  after; the inspector holds its selection while a clip drag is active (`timeline/clip-drag-activity.ts`, catches up 160 ms after the
  drop) and tab panels mount on first visit.

Measured at load 4 to 13 (3 runs each): before 2/58.3, 1/58.7, 0/50 (`framesOver50ms` / `rafMaxMs`); after 0/42.6, 0/33.3, 0/33.3.

## Everyday-editing snappiness (perf/snappy-r20)

Wall-clock timings have never been judged (machine load 5-26), so this round measures what does
not move with load: **React component renders** (counted from fibers via a DevTools-hook shim,
`apps/web/src/test/render-hook.ts`) and **process CPU ms** (`process.cpuUsage`), on the real
`<Timeline/>` + `<InspectorPanel/>` in jsdom with a 320-clip, 8-track, 4K-media project that has
effects and keyframes (`apps/web/src/perf/timeline-fixture.ts`).

```bash
cd apps/web
PERF_PROFILE=1 PERF_RUNS=7 PERF_PROFILE_OUT=run.json npx vitest run src/perf/interactions.test.tsx   # table of medians
PERF_TOP=40 ...   # list the top re-rendering components per interaction
npx vitest run src/perf                                                         # regression pins (also part of `pnpm test:run`)
```

jsdom CPU is a proxy (dev React, jsdom DOM), the render counts are exact. Median of 7 runs, load average
about 6-7 (1 min) during both sides; `base` = integration/1.1 7db61eb27, `cur` = this branch.

| interaction | CPU ms base | CPU ms cur | CPU | commits base/cur | renders base | renders cur | renders |
|---|---|---|---|---|---|---|---|
| clipSelect | 63.7 | 63.7 | +0% | 7/7 | 1166 | 1166 | +0% |
| clipSelectBurst | 447.1 | 428.1 | -4% | 71/71 | 12057 | 12057 | +0% |
| dragClip | 423.1 | 263.2 | -38% | 30/30 | 19786 | 11026 | -44% |
| trim | 554.8 | 132 | -76% | 20/20 | 31666 | 3116 | -90% |
| rippleDelete | 36.1 | 24.2 | -33% | 2/2 | 1203 | 613 | -49% |
| scrub | 6 | 5 | -17% | 59/59 | 59 | 59 | +0% |
| play10s | 35.8 | 19.3 | -46% | 300/300 | 300 | 300 | +0% |
| zoom | 866.5 | 682.7 | -21% | 13/13 | 28737 | 16311 | -43% |
| inspectorTabs | 131.1 | 121.8 | -7% | 11/11 | 3065 | 3065 | +0% |
| effectSlider | 1115.8 | 431 | -61% | 42/42 | 75978 | 15582 | -79% |
| undoRedoBurst | 594.5 | 127.6 | -79% | 24/24 | 38280 | 3468 | -91% |
| import20 | 35.9 | 10.4 | -71% | 2/2 | 3175 | 265 | -92% |

Interactions of the brief not in the table: *panel switch* (Radix tab remount, no change here) and a real
*import of 20 files* (decode work, not React; `import20` only measures the library update reaching the timeline).
Seven interactions improve by >= 30% in render count (drag, trim, ripple delete, zoom, effect slider, undo/redo,
import), six by >= 30% CPU in jsdom (drag, trim, ripple, slider, undo/redo, import). Selecting a clip and the inspector
tabs are unchanged (their cost is the inspector mounting).

### What was fixed

- **`TransitionHandle`**: `TrackLane` re-resolves its handles on every project change, so the
  `React.memo` never hit and every visible cut rebuilt a Radix dropdown (about 15 components each, 50+ cuts per
  commit). It now compares by field, and the dropdown only mounts once the pointer/focus reaches the badge
  (or a right click / Shift+F10 / press with no hover). This is most of the render count of the editing rows above.
- **`TrackHeader`** subscribed to the whole `project`, so all headers re-rendered on every edit. The cross-track data
  it needs (badge, bus, solo state, gaps, group candidates) is now a `useShallow` selector of primitives.
  `Timeline.handleTrackDrop` reads tracks from a ref so its identity is stable.
- **Action executor** (`packages/core/src/actions/stabilize-tracks.ts`): handlers rebuild every track with
  `{...track, clips: track.clips.map(...)}`, so every track got a new identity per edit and no memo downstream could
  hold. After each applied action (also undo/redo) unchanged tracks/clips are handed back as their previous objects.
- **`snapshotProjectForInverse`** (a `structuredClone` of the project) is skipped for `effect/*`, `keyframe/*`,
  `clip/trim` and `clip/trimToPlayhead`, whose inverses only read the affected clip's scalars (a held effect slider or
  trim drag copied the whole project per step).
- **`buildLinkIndex`** was rebuilt for every visible clip on every commit (`findLinkedPartners(clip, tracks)` without an
  index, from `computeLaneInfos`); a lane's index is now cached per `track.clips` array and validated element by element.

### Regression pins

`apps/web/src/perf/timeline-render-counts.test.tsx` fails on the old code and passes now: selecting a clip renders
<= 2 clips and no transition handles; a playhead move renders only `Playhead`; an effect slider step / trim step renders
<= 2 clips and <= 1 header; undo/redo, and a 20-item import, render 0-4 clips and no headers/handles; untouched tracks
and clips keep their identity. `packages/core/src/actions/stabilize-tracks.test.ts` covers the identity reuse.

### Real app (Electron) counters

`perf-harness.mjs` now records, next to the existing timings, CDP `Performance.getMetrics` deltas (informational, not budgeted):
`bench.selectClipCpu` (per click) and `bench.dragClip120px.cpu`: `mainThreadTaskMs`, `scriptMs`, `layoutMs`,
`styleRecalcMs`, `layoutCount`, `styleRecalcCount`, `nodesAdded`, `jsHeapDeltaKB`. Interleaved base/cur, 5 runs each,
`--only bench` on the 400-clip project (no inspector open), median:

| metric | base | cur |
|---|---|---|
| drag 120 px, main-thread task ms | 790 | 668 (-15%) |
| drag 120 px, script ms | 369 | 274 (-26%) |
| drag 120 px, layouts / style recalcs | 14 / 223 | 14 / 217 |
| select clip, task ms per click | 99.7 | 102 (unchanged) |

Wall-clock budgets were not judged (load 6-12 > 2.5); the CPU/memory budgets of `perf:budget` all passed
(`totalChunksCompiled` 54 / 58, `totalCompileCpuMs` 100.1 / 110, `startupCpuMs` 102.6 / 200, `totalCpuMs` 436.9 / 540).
