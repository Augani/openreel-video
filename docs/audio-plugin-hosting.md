# Audio plugin hosting (desktop)

Status: Audio Units and VST3 plugins are hosted on the macOS desktop app, each by its own helper binary speaking one protocol. Limits: [known-limitations.md](known-limitations.md#audio-plugins-audio-unit-host-macos-desktop). Track, bus and master racks can also play LIVE in the preview (see [Live inserts](#live-inserts-preview-of-track-bus-and-master-racks)); renders and exports are always the offline path described below.

## Why out of process

A third-party plugin can crash, hang or corrupt memory. The editor never loads one. All plugin code runs in `openreel-plughost`, a small native helper spawned by the main process; the worst a plugin can do is end that process, which the editor reports as a failed render (never a crashed editor).

```
renderer (web)  --IPC-->  main process  --pipe-->  openreel-plughost   --> AudioUnit   (.component)
 NativePluginsSection      PlugHostService    \--pipe-->  openreel-vst3host  --> VST3       (.vst3)
 NativePluginRenderCache   scanner, blocklist       one process per scan probe, render job and plugin window
```

## Pieces

| Where | What |
| --- | --- |
| `apps/desktop/native/plughost/main.swift` | The helper. `serve` (framed protocol), `ui` (plus a plugin window), `offline` (command line render, the reference the tests compare against). Built by `scripts/build-plughost.mjs` into `resources/plughost/<platform>-<arch>/` (gitignored; `--all` builds arm64 and x64). |
| `apps/desktop/native/vst3host/` | The VST3 helper `openreel-vst3host` (C++17, `main.cpp`, `json.h`, `protocol.h`, `ui_mac.mm`, `ui_stub.cpp`, `CMakeLists.txt`). Same frames, same messages, same three modes as the Swift helper; built against the Steinberg VST3 SDK hosting classes (`Module`, `PlugProvider`, `HostProcessData`, `ParameterChanges`, `MemoryStream`, `IPlugView`). Built by `scripts/build-vst3host.mjs` into `resources/vst3host/<platform>-<arch>/` (gitignored; `--all` builds arm64 and x64 on macOS). |
| `apps/desktop/scripts/lib/vst3sdk.mjs` | Fetches the pinned SDK (see Licensing). |
| `apps/desktop/scripts/build-vst3-testplugins.mjs` | Builds the test plugins (below) from the SDK's own `adelay` example into a temp folder. |
| `apps/desktop/src/shared/plughost-protocol.ts` | Wire format: frame = magic `ORPH` u32 LE, json length u32 LE, binary length u32 LE, json, binary. Audio is planar float32 in the binary part; blocks are 512 frames. Garbage, bad magic or oversize frames end the session. |
| `apps/desktop/src/main/plughost/` | `helper-process.ts` (spawn, request ids, per-request timeout, SIGKILL on hang, crash reasons), `scanner.ts` (list, then one sandboxed probe process per plugin), `blocklist.ts`, `scan-paths.ts` (standard folders, VST3 discovery without loading), `render.ts` (the pipe block loop), `host-service.ts` (scan state, concurrency 2, cancel, describe, plugin windows). |
| `apps/desktop/src/main/ipc/plughost.ts`, preload `plughost` | IPC. A render returns `{ok, kind: unavailable | failed | cancelled}` so the renderer can tell "not there" (bypass) from "broke" (fail). |
| `packages/core/src/audio/native-plugin/` | Shared logic: the `nativePlugin` effect, keyframe baking, block loop maths (`planNativeRender`, `evaluateLane`, `blockParameterValues`), the render cache, and the track / bus / master rack model (`native-plugin-rack.ts`: edits, stem projects, the master target `__master__`; `rack-stems.ts`: stem resolution and cache). No Node or Electron. |
| `apps/web/src/services/native-plugin-*.ts`, `NativePluginsSection.tsx` | Backend bridge, editing actions (all undoable), missing-plugin report, the inspector UI. |

## VST3 helper

`openreel-vst3host` is the VST3 counterpart of the Swift helper and is selected by plugin format (`vst3:` ids go to it, `au:` ids to `openreel-plughost`; `formatHelperSpawner`). Differences that follow from VST3:

* A plugin is a `.vst3` bundle, so `probe`, `open` and `ui-open` carry a `path`. The id is `vst3:<class id>`; a bundle without `moduleinfo.json` first gets a provisional id derived from its path, and the probe reply carries the real `classId` (plus name, vendor, version, sub categories) which replaces it. Only the first audio effect class of a bundle is hosted (instruments are refused). `list` returns nothing: bundles are found by the editor's folder walk, never by loading code.
* Parameters are the controller's normalized values: `min` 0, `max` 1, key = the VST3 parameter id. Hidden, read-only (meters) and program-change parameters are not exposed. `unitName` is the parameter's units, `indexed` is `stepCount > 0`.
* The state chunk is `"ORV3" | 1 | u32 componentLen | IComponent::getState | u32 controllerLen | IEditController::getState`, base64. Restore calls `setState`, `setComponentState`, `setState` on the controller. Values set since the last block only reach the processor with the next `process` call, so before reading the state the helper hands pending values over with one silent block (at open and when a window closes, never between blocks of a render).
* Processing: 32 bit float, `kOffline`, planar 512 frame blocks, one main input and output bus (stereo or mono; other layouts only through the bus arrangement the plugin accepts), auxiliary buses inactive, `ProcessContext` with 120 bpm, 4/4, playing. A parameter change is one point at sample offset 0 of the next block. Latency is `getLatencySamples()` after activation; tail is `getTailSamples()` (infinite is treated as none).
* Plugin window (`ui` mode, macOS): `createView("editor")`, `attached` to an `NSView` in an `NSWindow`, `IPlugFrame::resizeView` honoured, edits arrive through `IComponentHandler::performEdit` and stream back as `paramChanged`; closing returns `uiState` (state chunk and parameters) and `uiClosed`. A plugin without an editor reports "the plugin has no editor window".
* The library of a loaded plugin is never unloaded inside the helper (unloading is where plugins crash; the process ends instead).

## Scan and validation

1. The helper lists Audio Unit effects (`aufx`, `aumf`) through `AVAudioUnitComponentManager` (it covers `/Library/Audio/Plug-Ins/Components`, `~/Library/Audio/Plug-Ins/Components` and the system AUs without running plugin code).
2. Each plugin is validated in its own helper process: instantiate, allocate render resources, render 8 blocks of noise, reject NaN/Inf or runaway output. 15 s deadline.
3. A crash, a timeout or garbage on the pipe adds the plugin to `plugin-blocklist.json` (id, kind, reason, count, version). A plain refusal (for example an unsupported channel layout) is reported for that scan only. Blocked plugins are not probed again; a different plugin version, or Unblock, retries.
4. VST3 bundles under the standard folders (plus `OPENREEL_VST3_PATH`, folders separated like `PATH`) are found by a folder walk that runs no plugin code, then validated exactly like an Audio Unit, one `openreel-vst3host` process per bundle with the same deadline and blocklist. They are listed as `unsupported` only in a build that has no `openreel-vst3host`.

## Render (preview cache and export)

For a clip with plugins the effect chain is rendered over the whole decoded source, plugin by plugin (each plugin is one cache entry keyed by the content of its input, the plugin id, state chunk, values and automation lanes):

* `open` the plugin (state chunk restored, then values applied), read its latency L.
* Feed `N + L` frames (the last L silence) in 512 frame blocks, setting the parameter values of each block first (base values overridden by each lane evaluated at the block's start time), and drop the first L output frames. The result is aligned with the input for any L.
* The preview graph plays the original until the cached render is ready, then swaps with a crossfade (`RealtimeAudioGraph.withNativePlugins`); the export awaits the same cache (`AudioEngine.renderNativePlugins`).
* Not installed, blocked, or no host: bypass and report. Crash or failure during the render: the export fails with the reason.

The helper's `offline` mode implements the same loop in Swift; `plughost-au.integration.test.ts` and `plughost-electron.test.ts` require the editor's render to equal it sample for sample (and the latency compensation to line up a noise burst with lag 0).

## Live inserts (preview of track, bus and master racks)

The cached render above is the reference and the export path. For the PREVIEW, a rack can instead stream its audio through the helpers while the transport plays, so a parameter edit is heard within the block pipeline instead of after a re-render. Each rack has a switch, **Live preview** (the default) or **Rendered** (`AudioPluginRack.livePreview`, stored only when false; one undoable `audioPluginRack/set`). The switch never changes what is rendered or exported: it is left out of every render fingerprint (`rackForFingerprint`), the export always uses the offline render, and while the transport is stopped the offline render keeps being refreshed in the background exactly as before (while the transport runs with every rack live, that background render waits, so it does not compete with the helpers for CPU, and catches up on stop).

```
AudioWorklet (renderer audio thread)             Electron main                    helpers (one per plugin)
 LiveInsertDsp: cut input into B-frame blocks     LiveChain                         openreel-plughost / openreel-vst3host
 jitter buffer J blocks, dry delay line  --MessagePort-->  queue, <= 4 blocks in flight  --pipe-->  open {realtime: true}
 wet/dry crossfade, underrun counting    <--MessagePort--  block k out of the last plugin <--pipe--  block {params}
```

* **Where it lives.** `packages/core/src/audio/native-plugin/live/`: `live-insert-dsp.ts` (the audio thread state machine, pure, no Web Audio), `live-latency.ts` (latency maths), `live-ring.ts` (single producer / single consumer planar ring over a `SharedArrayBuffer`, used as the dry delay line and available to any cross-thread transport), `live-insert-worklet.ts` and `live-insert-node.ts` (the AudioWorklet and its node pair). `RealtimeAudioGraph.setLiveInsert` splices a node pair in front of a track's, bus's or the master's built-in rack, where hosted plugins sit. Main process: `main/plughost/live-chain.ts` (the block pipeline) and `live-service.ts` (sessions, ports). Renderer: `services/live-plugin-inserts.ts` (controller), `live-plugin-insert-state.ts` (status and the lazy door). Everything is a lazy chunk (a dynamic import the first time a rack with plugins and live preview exists on a desktop build), and the main-process half is imported by the IPC handler on first use; `test/live-insert-lazy.test.ts` checks that nothing the entry page loads statically contains any of it.
* **Transport, and why not shared memory.** The worklet talks to the main process over a `MessagePort` (a `MessageChannelMain` end handed to the page by `window.postMessage` from the preload and transferred into the worklet), and the main process talks to each helper over its stdio pipe. A zero-copy path would need memory that the AudioWorklet, the Electron main process and a separate helper process can all map: Chromium gives a worklet a `SharedArrayBuffer` only on a cross-origin isolated page, which does not reach another process, and a native addon would be needed for POSIX shared memory. A block is 2 KB, the port never touches the page's main thread, and the measured cost (below) is a fraction of a millisecond per block, so the pipe transport was kept; `LiveRing` is what a shared-memory transport would use. Two details learned the hard way: Electron's `MessagePortMain` does not accept transferred `ArrayBuffer`s (the worklet clones blocks), and a block must never be skipped when the pipeline is full (the plugin would see a hole in its input and click), so blocks wait in a queue (up to 32, then the oldest is dropped and the plugins are reset).
* **Helpers.** `open` takes `realtime: true`: Audio Units get `isRenderingOffline = false`, VST3 gets `kRealtime`, and the helper thread asks for the user-interactive scheduling class. A new `reset` message clears a plugin's delay lines and tails (`AUAudioUnit.reset`, VST3 `setActive(false/true)`); the chain sends it when the playhead moves. Renders and the offline command line keep offline mode, so the reference path is unchanged.
* **Latency and compensation.** Wet block s (input frames sB..(s+1)B) must be back before output block s + J starts, so the insert delays the signal by `D = J * B + L` frames, `L` being the chain's own reported latency (summed over the plugins). The dry fallback is the input delayed by the same D, so wet and dry stay aligned. `J` is sized when the session opens from a measured round trip: `ceil(p95 / blockMs) + 1 + 1`, but never less than 20 ms of transport (`MIN_TRANSPORT_MS`: the idle round trip is 0.05 to 0.2 ms; what misses deadlines is a scheduling stall of several milliseconds). D enters the graph's plugin delay compensation like any rack latency (`setLiveInsert` -> `refreshLatency`, a bus's through `planTimelineDelayCompensation`'s new `busExtraLatency`, the master's added to the master rack's), so every other track is delayed to match, and the scheduler starts sources `D` early as it does for built-in latent effects. Typical inserts: 256 frame blocks, J = 4: 21.3 ms + L (AUPeakLimiter 96 samples: 23.3 ms; AUMultibandCompressor 256 samples: 26.7 ms); 128 frames, J = 8: 21.3 ms; 512 frames, J = 3: 32 ms. The block size is a per-install setting (128 / 256 / 512, in the panel).
* **Underruns.** The worklet decides, `fade` frames (up to 128) before an output block starts, whether the wet block for it is there. If not, the wet gain ramps to zero and the aligned dry signal takes over (the same linear ramp every switch uses, never a step); the miss is counted (`underruns`), a block that shows up afterwards is discarded and counted (`lateBlocks`), and when blocks flow again the wet gain ramps back in. The count and the whole-insert latency are shown in the rack panel. The cached render is NOT substituted mid-playback (that would be a cut); a crashed insert plays dry until the transport stops, then the rack's rendered version takes over until the user retries live.
* **Crash isolation.** A helper that crashes, hangs (1.5 s per block), writes garbage or returns NaN ends that rack's chain: the main process tells the worklet (`status: crashed`), which crossfades to the aligned dry signal, and the panel shows the reason and a Retry button. The editor and the other racks never notice (verified by killing the helper with SIGKILL mid-playback in the real app). A plugin that crashes at open is reported (`failed`) and the rack plays rendered.
* **Parameters and automation.** A slider drag calls `liveSet` straight away (IPC to the main process, applied with the next block that reaches the plugin) and the debounced undoable edit follows as before; keyframes and the baked automation lanes are sent whenever they change and evaluated per block at timeline time (epoch start + block * B / rate), so automation is block rate and aligned to ±the playback latency. The transport restarts the stream on play, seek and loop (a new epoch: stale blocks are discarded, plugins reset); after a stop the streams keep running for 3 s so tails ring out.
* **Not live.** Clip plugins (they stay offline whole-source renders), 5.1 sequences (bypassed as before), and a plugin enabled/disabled or reordered while live (that reopens the session, about 0.1 s of dry). Remaining limits: [known-limitations.md](known-limitations.md#live-plugin-inserts-macos-desktop).

### Measured (Apple silicon Mac, 12 cores, 48 kHz; the machine was shared with other jobs, load average 15 to 22)

Helper round trip of one block through an idle pipe (`LiveChain.open` warm-up, 200 blocks, AUDelay / AULowpass / AUPeakLimiter / AUMultibandCompressor): p50 0.03 to 0.08 ms, p95 0.04 to 0.10 ms, max 0.7 ms (worst case) at every block size (128 / 256 / 512), so block size changes the latency through J * B, not the round trip. Through the real app's port, main process and helper while streaming (Electron e2e, AULowpass, 256 frames): p50 0.61 ms, p95 1.4 ms, max 5.3 ms.

Parameter change to audible change (a level change, first 128 frame quantum of output in which the new level is audible):

| Block size | J | Insert latency | Test rig (worker thread audio, main-process chain) | Real Electron app (renderer IPC included) |
| --- | --- | --- | --- | --- |
| 128 | 8 | 21.3 ms | 24.0 to 25.3 ms | 34.7 to 37.3 ms |
| 256 | 4 | 21.3 ms | 22.7 to 24.0 ms | 34.7 ms |
| 512 | 3 | 32.0 ms | 29.5 to 31.3 ms | 40.0 to 45.3 ms |

All under the 50 ms goal, including the renderer-to-main IPC; the extra 10 to 14 ms of the app column is the `liveSet` invoke, the block already in flight, and the 256 sample `ScriptProcessor` recorder the test taps the output with. The 512 frame case is closest to the limit. (VST3 adelay in the rig: 24.0 / 21.5 / 33.4 ms.)

Live against the offline reference (same plugin, same values, helper `realtime` mode against the cached offline render, latency aligned by D, 4 s of noise): **bit exact, 0 difference** for AUDelay, AULowpass, AUPeakLimiter, AUMultibandCompressor, an AULowpass > AUDelay chain, the VST3 `adelay` (also equal to its analytic output) and the 100 sample latency `adelay`; and, through the real Electron app and AudioWorklet, AULowpass and `adelay`: exact. (AUPeakLimiter and AUMultibandCompressor compared sample for sample with no tolerance: realtime mode did not change their output on this macOS version; other plugins that behave differently in realtime mode will differ from the offline render, and the export is the offline one.)

CPU, 4 live inserts (AUDelay, AULowpass, AUPeakLimiter, AUMultibandCompressor, one helper each) for 60 s with 6 CPU burners running (`test/live-bench.integration.test.ts`, run with `OPENREEL_LIVE_BENCH=1`):

| Block size | Underruns per insert (of 11,250 / 22,500 blocks) | Helper CPU per insert | Main-process thread CPU per insert | Audio thread late p99 / p99.9 / max |
| --- | --- | --- | --- | --- |
| 256 | 8, 9, 10, 13 (0.07 to 0.12 %) | 1.7 to 2.1 % of a core | about 17 % of a core | 0.8 / 4.6 / 14.9 ms |
| 128 | 120, 133, 130, 133 (0.53 to 0.59 %) | 2.5 to 3.8 % of a core | about 18 % of a core | 4.4 / 24.7 / 37.8 ms |

In the rig the "audio thread" is an ordinary worker thread, not a real-time one, and it was scheduled up to 15 ms (256) and 38 ms (128) late under that load; the underruns line up with those stalls, not with the helpers (their round trips stayed at p95 0.4 to 1.6 ms). A real AudioWorklet runs on the browser's real-time audio thread, so these underrun rates are pessimistic for the audio side and honest for the main process side. Every underrun was a counted, crossfaded dry block. The main-process cost (message clone, pipe I/O, JSON framing per block) is the largest per-insert cost: about 17 % of one core for each insert at 256 frame blocks; it was not optimised. The worklet's own CPU was not measured.

Forced failures: a helper stopped for 60 ms mid-stream (SIGSTOP) gave 16 to 17 underruns at 128 frame blocks (J = 8), all counted, the pipeline caught up through the queue (no block lost, no plugin reset) and the last second again equals the offline reference (below -60 dB); a helper killed with SIGKILL, a VST3 that segfaults after 60 blocks, one that hangs and one that returns NaN all end only their own chain and are reported.

Startup cost (desktop `perf:budget`, 3 runs, machine load about 30, so only the CPU and memory budgets were judged): `totalChunksCompiled` 53 (budget 58), `totalCompileCpuMs` median 100.7 to 105.9 (budget 110), `startupCpuMs` about 100 (budget 200), `totalCpuMs` 455 to 466 (budget 540). Web `bundle:budget`: entry 137.1 KB gzip (182), initialJs 359.9 (375), editor 490.9 (505), agent 163.5 KB gzip / 646 KB raw. One naming artifact: Rollup merges the one-line module that holds the worklet's URL into a chunk the startup path already loads (it shows up as `live-insert-worklet-*.js` in the startup chunk list at 0.1 to 0.9 ms of compile); none of the controller, node factory, DSP or worklet code is in the startup closure (`test/live-insert-lazy.test.ts`).

### Tests

```
pnpm --filter @openreel/desktop exec vitest run test/live-chain.test.ts test/live-insert-lazy.test.ts   # mock helper, any platform
pnpm --filter @openreel/desktop test:live-realtime                                                                                       # real helpers, macOS; wall-clock audio thread, run on a quiet machine (opt-in)
OPENREEL_LIVE_BENCH=1 pnpm --filter @openreel/desktop exec vitest run test/live-bench.integration.test.ts                              # the 60 s benchmark
VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop test:live-e2e                             # real Electron
pnpm --filter @openreel/core exec vitest run src/audio/native-plugin/live                                                          # ring, latency maths, DSP (underrun, crossfade, recovery)
```

The integration tests run the real `LiveChain` and the real helpers in the test process and the real `LiveInsertDsp` in a worker thread on a wall clock (`test/live-sim/`), which is the AudioWorklet's part without Electron; the Electron test adds the real AudioContext, worklet and port. The wall-clock tests are opt-in (`OPENREEL_LIVE_REALTIME=1`, `test:live-realtime`) because a machine running a whole test suite starves the simulated audio thread: a run that still has dropouts after retries on a starved thread is not held against the host, and a sample-exact comparison is only made on a run with no dropout. All of them passed on this machine at load 25 to 40.

## Parameter automation

Ordinary clip keyframes, property `effect.nativeplugin:<effectId>.<paramKey>` (clip-local seconds). `resolveClipAudioEffects` bakes them into `params.automation` (source seconds; a reversed clip is mirrored) for both preview and export; the baked lanes are never stored.

## Plugin state

`params.state` is the plugin's `fullState` as a binary property list, base64; `params.values` are the parameters the user set. Both are saved in the project file. The plugin window runs in its own helper (`ui` mode) and returns the final state and parameters when it closes, as one undoable edit.

## Licensing

OpenReel is MIT. The Swift helper is original code against Apple system frameworks; no third-party code is linked.

`openreel-vst3host` links code from the Steinberg VST 3 SDK. Verified from primary sources on 2026-11-20:

* `https://github.com/steinbergmedia/vst3sdk/blob/master/LICENSE.txt` (and the same file in the `vst3_base`, `vst3_pluginterfaces`, `vst3_public_sdk` and `vst3_cmake` repositories at the pinned commits) is the MIT License, "Copyright (c) 2026, Steinberg Media Technologies GmbH". The README of the SDK (section "License & Usage guidelines") states: the VST 3 SDK is under the MIT license; code under it may be used, modified and redistributed freely, including in commercial products; licensing under GPLv3 and the Steinberg proprietary license is no longer available (details at `www.steinberg.net/sdklicenses_vst3`). Older releases (3.7.x and earlier) were GPLv3 or proprietary and must not be used.
* Used version: **3.8.1, tag `v3.8.1_build_84`** of `steinbergmedia/vst3sdk`. The tag references its sub repositories by commit; `scripts/lib/vst3sdk.mjs` fetches each from `codeload.github.com` at its pinned commit and checks a SHA-256: `vst3sdk` 3cdf9ca5, `vst3_base` fcf9da0b, `vst3_cmake` 054c9143, `vst3_pluginterfaces` 4f547e8e, `vst3_public_sdk` 586dc5e6 (full hashes in the script). The `vstgui4`, `doc` and `tutorials` repositories are not used (VSTGUI is switched off; it has its own licence and the helper has no use for it).
* MIT is compatible with distributing this MIT app. The condition is that the notice travels with the binary: `build-vst3host.mjs` copies `LICENSE.txt` to `resources/vst3host/LICENSE-vst3sdk.txt` next to a `NOTICE.txt`, and `electron-builder.yml` ships the folder in the app's resources.
* Not committed: the SDK is never checked in. It is fetched into `apps/desktop/.cache/vst3sdk-3.8.1` (gitignored), or taken from `OPENREEL_VST3_SDK_DIR`. Offline, or on a checksum mismatch, the build prints why and skips (VST3 plugins are then listed as unsupported); the release workflow sets `OPENREEL_REQUIRE_VST3HOST=1` so a release cannot silently lose the helper.
* Trademark: "VST" is a trademark of Steinberg; the MIT licence makes using the name or logo optional, and when used it must follow Steinberg's rules (`VST3_Usage_Guidelines.pdf` in the SDK). The app text says "VST3 plugins" in a factual sense only and shows no logo.
* The test plugins are built from the SDK's own MIT example sources (`public.sdk/samples/vst/adelay`) in a temp folder; they are never committed or shipped.

## Building and testing

```
pnpm --filter @openreel/desktop build:plughost                # Swift helper, host arch
pnpm --filter @openreel/desktop build:vst3host                # C++ VST3 helper (needs CMake 3.25+, fetches the SDK on first run)
pnpm --filter @openreel/desktop exec vitest run test/plughost-*.test.ts test/plughost-au.integration.test.ts
VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build     # then:
pnpm --filter @openreel/desktop test:plughost-e2e             # real Electron, real helper, Apple AUs
pnpm --filter @openreel/desktop exec vitest run test/plughost-vst3.test.ts test/vst3-host.integration.test.ts   # mock parity, then the real helper on the SDK's adelay example
pnpm --filter @openreel/desktop test:vst3-e2e                 # real Electron, real VST3 helper, adelay built into a temp folder
```

The VST3 integration test builds `adelay` (and variants with a different class id: 100 samples of latency, a test editor, a segfault in `process`, a segfault after 60 blocks, a hang, NaN output) with `scripts/build-vst3-testplugins.mjs`, and checks the helper against the plugin's analytic output (`out[n] = in[n - trunc(delay x sampleRate)]`), the helper's own `offline` render, the state chunk, crash/hang/NaN isolation and the plugin window.

On a Mac where a freshly built helper is killed on its second launch (seen on macOS 27 inside agent worktrees, for the Swift helper as well), point `OPENREEL_VST3HOST_PATH` / `OPENREEL_PLUGHOST_PATH` at a copy outside the worktree; both are honoured only by unpackaged builds.
