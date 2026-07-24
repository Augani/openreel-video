# OpenReel Desktop (Electron + Native Media Offload) — Design Spec

**Status:** Draft for review
**Date:** 2026-06-02
**Supersedes:** [`2026-05-28-kael-openreel-desktop-design.md`](./2026-05-28-kael-openreel-desktop-design.md) (native Rust + wgpu + kael rewrite)
**Owner:** Augustus Otu

## 1. Context

OpenReel is a browser video editor: `apps/web` (Vite 5 + React 18 + TypeScript) rendering through `@openreel/core` (WebGPU compositing, Web Audio, WebCodecs/MediaBunny export, AssemblyScript WASM DSP), deployed to Cloudflare Pages. Native iOS and Android companions already ship.

The survey of the codebase (2026-06-02) established two facts that drive this design:

1. **The web app is unusually portable to Electron.** No store, bridge, or service reads `window`/`document`/`navigator`/`localStorage`/`indexedDB` at module top level (the sole import-time global access is the lazily-imported `keyboardShortcuts` singleton). Routing is hash-based (`#/route`), so SPA navigation works without a server. Every heavy renderer API in use — WebCodecs, OffscreenCanvas, MediaRecorder, IndexedDB, Web Crypto, Blob-URL module workers — runs natively in an Electron renderer.

2. **The browser is not the compositing bottleneck — it is the encode / decode / capture / memory / hardware-visibility bottleneck.** The export engine silently downgrades ProRes to H.264 (`export-engine.ts:239`), forces `prefer-software` on the main-thread path (`:382`), clamps any video >120 s to 1080p/30fps and per-codec resolution caps to avoid tab OOM (`:249-268`), and GC-churns every 5 frames (`:466-473`). `ffmpeg.wasm` fetches its core from a CDN and only multithreads under `crossOriginIsolated` (`ffmpeg-fallback.ts:133-157`). Device detection is heuristic UA/WebGL-string guessing (`device-capabilities.ts`). Screen capture buffers WebM chunks in RAM and can't reliably get system audio off Chromium (`screen-recorder.ts`).

## 2. Goal & decisions locked

**Goal:** Ship a cross-platform desktop OpenReel that reuses the entire `apps/web` editor as an Electron renderer and moves all heavy media work to native binaries, removing the browser's encode/memory/hardware ceilings.

Decisions confirmed during brainstorming (2026-06-02):

| Decision | Choice |
|---|---|
| Native depth | **Native media offload** — renderer stays the compositor; encode/decode/capture/probe move native. |
| Relationship to Rust plan | **Replaces it.** The Rust/wgpu/kael doc is superseded. |
| Target platforms | **macOS arm64, macOS x64, Windows x64, Linux x64.** |
| First native wins | **All:** export/encode, transcode/proxy+decode, screen+system-audio capture, hardware probing. |
| Cloud / AI auth | **Both:** server proxy for signed-in users (reworked) **and** BYOK via OS keychain called from the main process. |
| Distribution scope | **Full pipeline:** electron-builder, per-platform FFmpeg bundling, macOS sign+notarize, Windows sign, auto-update, CI release. |

**Central architectural insight:** keep the React editor + `@openreel/core` render pipeline intact as the Electron renderer ("the compositor"); offload encode, decode/proxy, capture, and hardware probing to a **native FFmpeg sidecar in the Node main process**, reached over a typed IPC job protocol.

```
┌─ Renderer (Chromium, app://) ───────┐         ┌─ Main process (Node) ──────────────┐
│  React editor + @openreel/core       │  IPC    │  Sidecar orchestrator               │
│  compositor (WebGPU → frames)        │ ◄─────► │   • FFmpeg child processes          │
│  preload bridge (contextIsolation)   │ jobs +  │     (VideoToolbox/NVENC/QSV/AMF/     │
│                                      │ progress│      VAAPI + libx264/x265/SVT-AV1)  │
│  window.openreel.* API only          │         │   • decode / proxy / transcode      │
└──────────────────────────────────────┘         │   • screen + system-audio capture   │
        ▲ app:// protocol injects                 │   • hardware probe (CPU/RAM/GPU)    │
        │ COOP/COEP + serves dist/                 │   • OS keychain (BYOK) + cloud auth │
        └───────────── main process ───────────────┘  • auto-updater                     │
                                                  └──────────────────────────────────────┘
```

## 3. Non-goals

- **No new project format.** Reuse `.openreel` JSON 1:1 with iOS/Android/web; the renderer already owns this code unchanged.
- **No rebuild of the editor UI or compositor.** The renderer is the existing `apps/web` bundle. Changes to it are surgical ports, not rewrites.
- **No Mac App Store / sandboxed-store build in v1.** Store sandboxing conflicts with bundled FFmpeg + arbitrary filesystem + hardware access. Direct-download signed builds only.
- **No bundled cloud credentials.** Server-proxy mode uses the existing cloud Worker; BYOK keys live in the OS keychain, never in the bundle.
- **No replacement of the WebGPU compositor with native rendering.** That is the (superseded) Rust plan. Frames are produced by the existing renderer.

## 4. Architecture

### 4.1 Monorepo placement

A new workspace package **`apps/desktop`** (`@openreel/desktop`), added to `pnpm-workspace.yaml`'s `apps/*` glob. It depends on `@openreel/web` (consumes its built `dist/`) and `@openreel/core` (shared types only). Layout:

```
apps/desktop/
  package.json            # electron, electron-builder, electron-updater, tsup/esbuild
  electron-builder.yml    # per-platform targets, signing, native binary bundling
  tsconfig.json
  src/
    main/                 # Node main process (TypeScript, compiled to CJS/ESM bundle)
      index.ts            # app lifecycle, BrowserWindow, app:// protocol, COOP/COEP
      protocol.ts         # app:// scheme registration + header injection
      ipc/                # typed IPC handlers (see §4.4)
      sidecar/            # FFmpeg orchestration (encode/decode/capture/probe)
      cloud/              # BYOK keychain + cloud-proxy + desktop auth
      updater.ts          # electron-updater wiring
    preload/
      index.ts            # contextBridge → window.openreel.* (no nodeIntegration)
    shared/
      ipc-contract.ts     # shared request/response/event types (main ↔ preload ↔ renderer)
  resources/
    bin/                  # per-platform FFmpeg binaries (populated at build time)
```

### 4.2 Process & security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer. The renderer never touches Node directly; it calls `window.openreel.*` exposed by the preload via `contextBridge`.
- A strict CSP is injected for the `app://` origin. `webSecurity` stays on.
- All privileged work (fs, child_process, keychain, capture) lives in the main process behind validated IPC handlers. Every IPC payload is schema-validated (zod) at the main-process boundary; reject on mismatch (fail-fast, defensive).
- The renderer is loaded from a **custom `app://` protocol**, never `file://` (see §4.3).

### 4.3 Renderer delivery: the `app://` protocol

The main process registers `app://` via `protocol.registerSchemesAsPrivileged` **before** `app.ready` with the full flag set required for the editor's workers, `fetch`, and CORS to function — `{ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }` — then handles requests with `protocol.handle`. (Omitting `supportFetchAPI`/`corsEnabled` silently breaks `fetch`/worker loads under the scheme.) It serves files from the packaged `@openreel/web` `dist/` and **injects the cross-origin isolation headers** that Cloudflare's `public/_headers` provides today:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Rationale (resolves four findings at once):

1. **Preserves `crossOriginIsolated`/SharedArrayBuffer**, so the existing multithreaded `ffmpeg.wasm` / vidstab paths keep working even before native offload lands. `file://` cannot carry these headers.
2. **Stable secure origin** (`app://openreel/`) → `secure-storage.ts` (Web Crypto + IndexedDB) and the BYOK vault get a consistent, non-opaque, non-evictable partition. `file://` is opaque/partitioned and can break `crypto.subtle`.
3. **Fixes asset paths.** `dist/index.html` references root-absolute `/assets/*` which resolves correctly under a custom origin; no need for Vite `base:'./'` rewrites (though we still set `base` defensively — see §5).
4. **Enables CSP and a real `window.location.origin`** for share-link generation (with a public-web-origin override injected via preload).

COEP has one sharp edge: every renderer dependency that is fetched as a script, WASM module, worker, font, image, or media asset must either be same-origin under `app://` or carry compatible CORS/CORP headers. Phase 1 therefore includes an explicit isolation smoke test for web workers, WASM DSP/ffmpeg fallback, fonts, thumbnail/media loading, and any remote service asset used by the editor. Anything that fails this test is either bundled locally or fetched through a main-process bridge that returns same-origin bytes. The known offender today is the cross-origin **Google Fonts `<link>` in `index.html`** — it is self-hosted (bundled into `dist/`, joining the fonts already in `dist/fonts/`) for the desktop build so no font load crosses an origin under `require-corp`.

Hash routing (`#/route`) continues to work under `app://`. The SPA `_redirects` rule is irrelevant (handled by the protocol serving `index.html` for unknown paths).

### 4.4 IPC job protocol

A single typed contract in `shared/ipc-contract.ts`, consumed by main, preload, and renderer. Three message shapes:

- **Request/response** (`invoke`/`handle`): one-shot RPC — `probeHardware()`, `pickSaveFile()`, `keychainGet()`, `cloudAuthStatus()`.
- **Jobs** (long-running, cancellable, progress-emitting): `startExport`, `startTranscode`, `startProxy`, `startCapture`. Each returns a `jobId`; progress/log/done/error events stream back on a per-job channel; `cancelJob(jobId)` aborts (kills the child process, cleans temp files).
- **Streams** (high-throughput): the export frame pipe (§6.4) uses a `MessageChannelMain` port, not `ipcRenderer.invoke`, to avoid structured-clone copies.

Job lifecycle mirrors the orphaned `export-worker.ts` message protocol (`init`→`addFrame`/`addAudio`→`finalize`/`cancel`) as a naming guide, but the actual integration target is the inline encode block in `export-engine.ts` `exportVideo()` — the renderer's export orchestration changes minimally, swapping the *backend*, not the *flow*.

## 5. Renderer porting changes (surgical, in `apps/web`)

All guarded by a single runtime capability check: `const desktop = window.openreel?.platform === 'desktop'`. Each change keeps the existing web path intact (progressive enhancement).

| # | File | Change |
|---|---|---|
| 1 | `apps/web/vite.config.ts` | Add a desktop build mode (env flag) that sets `base: './'` defensively and emits an Electron-targeted `dist`. Keep COOP/COEP dev headers. |
| 2 | `apps/web/src/services/api-proxy.ts` | Add a third branch: when `desktop`, route AI calls through `window.openreel.cloud.fetch(service, path, options)` (main process decides BYOK-direct vs cloud-Worker — §6.8). Today only dev-direct / prod-same-origin exist (`:53`, `:66`). |
| 3 | `packages/core/src/media/ffmpeg-fallback.ts`, `video/stabilization/vidstab-engine.ts` | When `desktop`, prefer the native sidecar (§6.5). Keep the wasm path as fallback; **bundle the wasm core locally** (remove the unpkg CDN dependency at `:135-157`) so offline works in all modes. |
| 4 | `apps/web/src/services/project-manager.ts`, `media-storage.ts`, `stores/project-store.ts` | When `desktop`, replace File System Access API (`showSaveFilePicker`/`showOpenFilePicker`/`FileSystemFileHandle` persistence) with `window.openreel.fs.*` (native dialogs + Node fs + a stable path-handle store). Existing capability guards already provide graceful fallback. |
| 5 | `apps/web/src/services/screen-recorder.ts` | When `desktop`, route capture through `window.openreel.capture.*` (native, §6.6) instead of `getDisplayMedia` + `MediaRecorder`. |
| 6 | `apps/web/src/services/service-worker.ts`, `main.tsx` | Skip `registerServiceWorker()` when `desktop` (SW is unsupported/redundant under `app://`). |
| 7 | `apps/web/src/hooks/use-router.ts`, `services/share-service.ts` | `generateShareableLink()`/`getSharePageUrl()` build links from `window.location.origin` — inject the public web origin (`https://app.openreel.video`) via `window.openreel.publicOrigin` when `desktop`. |
| 8 | `apps/web/src/components/MobileBlocker.tsx` | Ensure the default `BrowserWindow` is ≥ 1024px so the `<768px` blocker never trips; no code change needed if window sizing is correct. |
| 9 | `apps/web/src/services/secure-storage.ts` | When `desktop`, prefer `window.openreel.keychain.*` over the Web Crypto + IndexedDB vault for API keys. The main process owns key persistence: use the OS keychain where available, or encrypted ciphertext in `app.getPath('userData')` via Electron `safeStorage` with an explicit Linux fallback/error path. Keep the web vault for browser. |
| 10 | `apps/web/index.html` (+ build) | Self-host the cross-origin Google Fonts `<link>` for the desktop build (bundle into `dist/`) so no font load crosses an origin under COEP `require-corp` (§4.3). Web build keeps the CDN `<link>`. |

These are the only renderer-side edits; stores, bridges, and the compositor are untouched.

## 6. Native sidecar design

### 6.1 FFmpeg bundling

Ship a **statically-linked FFmpeg binary per platform/arch** under `resources/bin/`, invoked via `child_process.spawn` (separate process — see licensing, §8.4). One binary per: `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`. electron-builder's `extraResources` places them next to the app; the main process resolves the path via `process.resourcesPath` (packaged) or a dev path.

Each build is compiled with the platform's hardware encoders enabled (see matrix below) plus software fallbacks. A build script (or a vetted upstream like BtbN/FFmpeg-Builds for Windows/Linux and a custom macOS build) produces the binaries; their versions and checksums are pinned and recorded in `resources/bin/MANIFEST.json`.

### 6.2 Encoder selection matrix

The sidecar probes available encoders at first run (parse `ffmpeg -hide_banner -encoders` + a 1-frame trial encode per candidate + GPU presence) and caches the result. Selection per requested codec:

| Codec | macOS | Windows | Linux | Software fallback |
|---|---|---|---|---|
| H.264 | `h264_videotoolbox` | `h264_nvenc` → `h264_qsv` → `h264_amf` | `h264_nvenc` → `h264_vaapi` | `libx264` |
| HEVC/H.265 | `hevc_videotoolbox` | `hevc_nvenc` → `hevc_qsv` → `hevc_amf` | `hevc_nvenc` → `hevc_vaapi` | `libx265` |
| AV1 | `libsvtav1` (no broad HW AV1 encode on macOS) | `av1_nvenc` → `av1_qsv` → `av1_amf` | `av1_nvenc` → `av1_vaapi` | `libsvtav1` |
| ProRes | `prores_videotoolbox`† → `prores_ks` | `prores_ks` | `prores_ks` | `prores_ks` |

† where the hardware supports it; otherwise fall to the next entry. The renderer's existing browser-driven per-codec resolution clamps (`export-engine.ts:249-268`) are **replaced in desktop mode by hardware-driven export limits** from `probeHardware()` and measured encoder throughput. Native encode + stream-to-disk removes the tab OOM driver, but the renderer still has WebGPU render-target, readback, transfer-bandwidth, and GPU-memory limits, so desktop keeps explicit guardrails instead of unbounded exports.

### 6.3 Job orchestration

`sidecar/` owns a small job manager: bounded concurrency (default = `min(cores−1, 4)` for transcode/proxy; export is single-job-at-a-time unless the user opts into batch), per-job temp dir under `app.getPath('temp')`, child-process lifecycle, progress parsing (FFmpeg `-progress pipe:` → structured events), and guaranteed cleanup on cancel/crash/quit.

### 6.4 Native export (the performance-critical path)

This is the only place with meaningful engineering risk and the most important piece to get right.

**Flow.** The renderer's export orchestration is unchanged conceptually; only the encoder backend swaps. Introduce a backend interface at the `export-engine.ts` `exportVideo()` seam — all real encoding happens inline in that async generator (the sibling `export-worker.ts` is dead/unimported scaffolding and is NOT the seam). The interface:

```ts
interface ExportEncoderBackend {
  init(settings: VideoExportSettings, projectName: string): Promise<void>;
  addFrame(frame: VideoFrame | ImageBitmap, index: number, tsMicros: number): Promise<void>;
  addAudio(pcm: { channels: Float32Array[]; sampleRate: number; length: number }): Promise<void>;
  finalize(): Promise<void>; // resolves when the file is fully written to disk
  cancel(): void;
}
```

- `WebCodecsBackend` — the current MediaBunny path (`export-worker.ts`), used in the browser and as a desktop fallback.
- `NativeFFmpegBackend` (desktop) — established over a `MessageChannelMain` port handed to the renderer at export start. The handoff path is `main: webContents.postMessage('export-port', null, [port2])` → preload relays the received `MessagePort` through `contextBridge` to the renderer. **The Phase-2.1 spike validated this handoff under `sandbox: true`** — the port itself transfers fine. Crucially, the same spike disproved the original zero-copy assumption (see Frame transport).

**Frame transport.** The renderer already reads back composited pixels for export (existing OffscreenCanvas path). Instead of wrapping them in a `VideoSample`, the backend sends the raw pixel buffer (as a `Uint8Array`/`ArrayBuffer` **message value, with NO transfer list**) over the MessagePort, and the main process writes it to the FFmpeg child's video input as `-f rawvideo -pix_fmt rgba -s WxH -r FPS`. FFmpeg performs color conversion (swscale → NV12/yuv420p) and hardware encode natively — offloading conversion off the JS thread.

> **Transport correction (Phase-2.1 spike, verified):** Electron's `MessagePortMain.postMessage(message, transfer)` only accepts **`MessagePortMain` handles** in the transfer list — NOT `ArrayBuffer`s (unlike the DOM Worker `postMessage` contract). Putting a frame buffer in the transfer list **detaches it on the renderer and delivers `null` to main — silent data loss, no error thrown.** Frame bytes therefore travel by **structured-clone copy** (one clone/memcpy per frame), which the spike confirmed delivers intact bytes. **Never put frame data in a transfer list** anywhere in the export IPC; a guard/test enforces this. True zero-copy is not available over Electron MessagePorts — if copy throughput proves insufficient, the escalation is `SharedArrayBuffer` (COOP/COEP already enabled), not transferables.

- **Backpressure:** credit-based. Main acks every N frames; the renderer pauses frame production when outstanding credits hit a cap (bounds memory; no unbounded queue like the current `frameQueue`).
- **Buffer reuse:** because the copy path does NOT detach the source buffer, the renderer can keep one reusable scratch readback buffer and overwrite it each frame (structured clone is taken synchronously at `postMessage` time, so reuse after the call is safe). This avoids the per-frame allocate-and-discard GC churn the current export path fights (`export-engine.ts:466-473`) — no buffer hand-back protocol is needed.
- **Sequencing:** the full audio mixdown completes and is written to the temp file *before* FFmpeg is spawned and video streaming begins (the existing engine already mixes audio in 15 s chunks separately). Video frames are written to stdin in strict index order; the renderer composites sequentially, so no reorder buffer is needed in v1.
- **Input topology:** FFmpeg inputs are declared before the child process starts. The default implementation prepares the mixed audio as a per-job temp WAV/PCM file first, then starts FFmpeg with both inputs declared (`-i pipe:0` for video, `-i audio.wav` for audio) while video frames stream over stdin. If memory/disk pressure makes this too slow, the next implementation uses extra OS pipes (`stdio: ['pipe', ...]`) and passes one named pipe/file descriptor for audio. Do not try to add a second FFmpeg input after video streaming has started.
- **Audio:** mixed PCM (existing `OfflineAudioContext` mixdown, or — later — native audio mixdown) is normalized to a known sample format (`f32le` or WAV), written in timeline order, and muxed as the declared audio input.
- **Timing:** desktop native export is CFR for v1. `tsMicros` is still passed to `addFrame`, but the backend uses it to duplicate/drop frames onto the requested export frame grid before writing raw frames to FFmpeg. Audio is padded/trimmed to the same timeline start/end, and tests cover gaps, still frames, muted ranges, and non-zero timeline offsets. If VFR export becomes required later, it gets a separate backend path instead of overloading `-r FPS` rawvideo.
- **Output:** FFmpeg writes directly to the user-chosen path (native save dialog). No in-RAM buffering — removes the Firefox/Safari in-RAM ceiling (`Toolbar.tsx:271-327`) and the Chromium `createWritable` dependency entirely.

**Throughput budget & fallback.** 4K RGBA ≈ 33 MB/frame (≈ 1 GB/s at 30 fps); NV12 ≈ 12.4 MB/frame. Frame transport is a **structured-clone copy** (per the Phase-2.1 spike — not zero-copy), so each frame costs one clone/memcpy main-side; export runs slower-than-realtime so this is acceptable for correctness, but it is the real cost to budget. If end-to-end throughput saturates at 4K/60, the documented escalation ladder is: (a) pre-convert to NV12 in a renderer worker before sending (halves the copied bytes); then (b) a `SharedArrayBuffer` ring buffer shared renderer↔main for true zero-copy (COOP/COEP are already set). Start with RGBA-by-copy over MessagePort; measure; escalate only if needed.

### 6.5 Native transcode / proxy / decode

When `desktop`, proxy generation, transcode, and audio extraction call the sidecar instead of `ffmpeg.wasm` (`ffmpeg-fallback.ts`). Native FFmpeg removes the `-threads 4` cap, the CDN fetch, and the `crossOriginIsolated` requirement, and uses hardware decoders. The renderer keeps editing **originals** far more often because native hardware decode + larger memory shrinks the need for proxies; the existing proxy thresholds (4K / >10 min / >500 MB, `ffmpeg-fallback.ts:77-82`) are raised in desktop mode. Proxies, when generated, are written to the native disk cache (no IndexedDB quota).

### 6.6 Native screen + system-audio capture

`window.openreel.capture.*` in the main process:

- **Source picking:** `desktopCapturer.getSources()` + a custom in-app picker (or `setDisplayMediaRequestHandler` to keep the renderer's `getDisplayMedia` call working while supplying native sources).
- **System/app audio:** platform-native — macOS via ScreenCaptureKit/Core Audio tap (or a bundled helper), Windows via WASAPI loopback (FFmpeg `dshow`/`wasapi`), Linux via PulseAudio/PipeWire monitor source. This is the capability the browser cannot deliver reliably.
- **Encode + write:** capture streams straight into a sidecar FFmpeg job that writes any codec directly to disk — no in-RAM WebM chunking (`screen-recorder.ts:159-193`), unlimited duration.

Capture ships in two steps inside Phase 3: first video-only native capture with direct-to-disk encoding and platform permission UX, then system/app-audio capture per platform. The Phase 3 exit requires both, but implementation and tests track them separately because macOS audio capture in particular may require ScreenCaptureKit-specific code or a signed helper.

### 6.7 Hardware probing

`window.openreel.probeHardware()` returns real specs from the main process: CPU model/physical+logical cores (`os.cpus()`), total/free RAM (`os.totalmem()`), GPU model(s) (platform queries — `system_profiler` on macOS, `wmic`/DXGI on Windows, `lspci`/`glxinfo` on Linux), and the probed encoder list (§6.2). This replaces the heuristic `device-capabilities.ts` (UA + WebGL-string + `navigator.deviceMemory` default-4) in desktop mode and feeds `export-estimator.ts` accurate, deterministic inputs (native encode FPS is far more predictable than the in-browser micro-benchmark).

### 6.8 Cloud / AI: server-proxy **and** BYOK

`window.openreel.cloud.fetch(service, path, options)` in the main process decides per call:

- **BYOK mode (default if a user key exists):** the key is read through the main-process key store (OS keychain where available, or `safeStorage`-encrypted ciphertext persisted under `userData`; never exposed to the renderer) and the request is made **directly from the main process** to `api.openai.com` / `api.anthropic.com` / `api.elevenlabs.io` using the `DIRECT_CONFIG` headers already defined in `api-proxy.ts`. No same-origin proxy needed; works offline-of-Cloudflare.
- **Server-proxy mode (signed-in users without their own key):** the main process calls the **absolute** cloud Worker proxy (`https://openreel-cloud.<...>.workers.dev` / `api.openreel.video`) — *not* the relative `/api/proxy/*` Pages Function, which has no same-origin under `app://`. This requires two backend changes:
  1. The Pages Function `ALLOWED_ORIGINS` allowlist (`functions/api/proxy/[[catchall]].ts`) — or a new Worker route — must accept the desktop client. Since the desktop request originates from the **main process** (Node, not a browser), it isn't subject to browser CORS; it sends a desktop auth token instead.
  2. **Desktop auth:** the cloud auth broker today attests only Apple App Attest / Play Integrity (`apps/cloud/wrangler.jsonc`). Add a desktop path: browser-based OAuth/device-code handoff → short-lived scoped JWT, stored in the keychain, sent as a bearer token to the Worker. This mirrors the mobile short-lived-token model without native attestation.

The GPU services (transcribe `cloud.openreel.video`, TTS `transcribe.openreel.video`, render `ai.openreel.video`) are reached the same way (main-process fetch with the desktop JWT).

## 7. Data flows

**Export (native):**
```
User clicks Export
 → renderer picks save path via window.openreel.fs.pickSaveFile()
 → renderer mixes audio (OfflineAudioContext) → transfers PCM to main → main writes temp audio.wav
 → main spawns ffmpeg with ALL inputs declared up front: -i pipe:0 (rawvideo) + -i audio.wav, HW encoder, output=path
 → renderer composites frame N (WebGPU) → readback → send pixel buffer over MessagePort (structured-clone COPY, no transfer list; credit-gated)
 → main writes frame to ffmpeg stdin; emits progress events ← parsed from ffmpeg -progress
 → finalize: renderer closes stdin → ffmpeg flushes/muxes → file on disk → done event → renderer shows "Reveal in Finder"
```

**AI call (BYOK):**
```
renderer apiFetch('openai', '/chat/...', options)  [desktop branch]
 → window.openreel.cloud.fetch('openai', path, options)
 → main reads OpenAI key from the desktop key store
 → main fetch https://api.openai.com/v1/chat/... with Authorization header
 → response streamed back to renderer
```

## 8. Packaging & distribution

### 8.1 Tooling

**electron-builder** (chosen over Forge for its mature multi-platform signing, notarization, `extraResources` native-binary bundling, and `electron-updater` integration). Config in `apps/desktop/electron-builder.yml`.

### 8.2 Targets

| Platform | Arch | Installer(s) |
|---|---|---|
| macOS | arm64 + x64 (universal or per-arch) | `.dmg` + `.zip` (zip required by electron-updater) |
| Windows | x64 | NSIS `.exe` |
| Linux | x64 | `.AppImage` + `.deb` |

FFmpeg binaries bundled per target via `extraResources`, selected by arch at build time so each installer ships only its own binary.

### 8.3 Signing & notarization

- **macOS:** Developer ID Application cert; `hardenedRuntime: true` with entitlements for JIT/`allow-unsigned-executable-memory` (Chromium) and the bundled FFmpeg/helper; notarize via `notarytool` (electron-builder `afterSign` hook); staple. Reuses the existing Apple Team ID (`APPLE_TEAM_ID` is already configured for mobile).
- **Windows:** Authenticode signing (EV or OV cert) to avoid SmartScreen warnings. If no cert at first, ship unsigned and document the warning (per the "full pipeline now" scope, the slot exists; cert acquisition is the only blocker).
- **Linux:** no mandatory signing; AppImage may be GPG-signed; checksums published.

### 8.4 FFmpeg licensing (decision required, flagged not hidden)

FFmpeg compiled with `libx264`/`libx265` is **GPL v2+**. The planned architecture invokes FFmpeg as a **separate process via `spawn`** (not linked into the app binary), but this is still a shipping/legal decision, not an engineering assumption to hide in the implementation. Before Phase 5, get legal approval for the chosen distribution model, publish the exact FFmpeg source/build scripts required by that model, and review codec patent/licensing exposure for H.264/H.265 distribution in the target markets.

Two compliant options; pick one before shipping:

- **(A) Ship GPL FFmpeg as a separate executable** + include the GPL text and a written source offer (link to the exact build's source + scripts), after legal approval. Full codec support (x264/x265). Recommended default from a product/engineering perspective — simplest, no feature loss, standard practice.
- **(B) Ship LGPL FFmpeg** (configure `--enable-shared` without GPL components): keep hardware encoders (VideoToolbox/NVENC/QSV/AMF/VAAPI are not GPL) + permissive software (`openh264`, `SVT-AV1`); drop `libx264`/`libx265`. Lets the whole app stay permissive at the cost of software H.264/H.265 quality.

Record the choice and the exact FFmpeg build config in `resources/bin/MANIFEST.json` and a `LICENSES/FFMPEG.md`.

### 8.5 Auto-update

`electron-updater` with **GitHub Releases** as the host (default; swappable for a generic/S3 feed later). macOS updates require the signed `.zip`; Windows uses NSIS differential updates; Linux AppImage self-update via the built-in updater. Update channel (`latest`/`beta`) selectable; checks on launch + periodic, user-confirmed install.

## 9. CI release pipeline

GitHub Actions workflow (`.github/workflows/desktop-release.yml`), triggered on `v*-desktop` tags:

1. **Matrix build** on `macos-14` (arm64), `macos-13` (x64), `windows-latest`, `ubuntu-latest`.
2. Per job: `pnpm install` → `pnpm build` (wasm + `@openreel/web` dist in desktop mode) → fetch/verify the platform FFmpeg binary (checksum against `MANIFEST.json`) → `electron-builder --publish always`.
3. **macOS:** import Developer-ID cert from secrets (`CSC_LINK`/`CSC_KEY_PASSWORD`), notarize with `APPLE_API_KEY`/`APPLE_API_ISSUER` (App Store Connect API key). **Windows:** sign with `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` if present.
4. Publish artifacts + `latest*.yml` update manifests to a GitHub Release (draft → manual promote).
5. A separate lightweight CI job on PRs builds **unsigned** artifacts for all platforms to catch packaging breakage early.

## 10. Phased build plan

Even though the end-state is full native offload, the build sequences so each phase is independently shippable and de-risks the next. The hard gate is Phase 1 (the renderer must run correctly under `app://` before anything can be offloaded).

### Phase 0 — Workspace & shell skeleton
- Scaffold `apps/desktop` (electron, electron-builder, preload, contextIsolation/sandbox).
- `app://` protocol serving a placeholder + COOP/COEP injection; verify `crossOriginIsolated === true`.
- COEP/CSP asset smoke: workers, WASM, fonts, thumbnails/media loads, and remote-service assets either load under `app://` or have an explicit bridge/bundling fix.
- Typed IPC contract scaffold + a `probeHardware()` round-trip as the first working IPC.
- **Exit:** an Electron window opens, loads a trivial page over `app://`, and `window.openreel.probeHardware()` returns real CPU/RAM/GPU.

### Phase 1 — Renderer runs in Electron (parity with web, no offload yet)
- Build `@openreel/web` in desktop mode; serve `dist/` over `app://`.
- Apply renderer ports §5 (#1, #6, #8, #10 minimum) so the editor loads, routes, self-hosts fonts under COEP, and the wasm export path still works (now multithreaded via injected COOP/COEP, wasm core bundled locally).
- Native fs bridge (§5 #4): open/save `.openreel`, import media via native dialogs.
- **Exit:** a user imports → edits → exports an MP4 (via the existing wasm/WebCodecs path) entirely inside the desktop app; project round-trips through save/reload. This is a functionally complete local build (distribution/signing comes in Phase 5).

### Phase 2 — Native export offload
- **Spike first:** confirm the `MessageChannelMain` port handoff + zero-copy transferable `ArrayBuffer` round-trip works under `sandbox: true` before committing the transport (§6.4).
- FFmpeg bundling (§6.1) + encoder probe (§6.2) + job orchestrator (§6.3).
- `NativeFFmpegBackend` + MessagePort frame transport + backpressure + buffer recycling (§6.4).
- Replace browser resolution/fps/duration caps with hardware-driven desktop limits and lift the ProRes downgrade in desktop mode.
- Implement the FFmpeg input topology explicitly: raw-video pipe plus temp audio file for v1, CFR frame-grid mapping from `tsMicros`, and audio padding/trimming.
- **Exit:** export a 4K, >2-min, ProRes/10-bit project with hardware encode, streamed to disk, faster than the wasm path, with accurate progress/ETA. Golden-frame check: native vs WebCodecs output within tolerance.

### Phase 3 — Native decode/proxy + capture + hardware-driven defaults
- Sidecar transcode/proxy/decode (§6.5); raise proxy thresholds; native disk cache.
- Native video capture, then system/app-audio capture per platform (§6.6).
- Wire `probeHardware()` into `device-capabilities`/`export-estimator` for deterministic defaults (§6.7).
- **Exit:** edit 4K originals without forced proxies; record screen with system audio to disk for >30 min; export estimates within ±15% of actual.

### Phase 4 — Cloud/AI: BYOK + server proxy + desktop auth
- Keychain BYOK path (§6.8) + `apiFetch` desktop branch (§5 #2, #9).
- Cloud Worker absolute-URL proxy rework + desktop OAuth/device-code → short-lived JWT (backend change in `apps/cloud`).
- Share-link public-origin injection (§5 #7).
- **Exit:** AI features (transcription, captions, TTS) work in both BYOK and signed-in modes; GPU services authenticate from desktop.

### Phase 5 — Packaging, signing, auto-update, CI
- electron-builder targets (§8.2), FFmpeg licensing decision (§8.4), per-platform signing/notarization (§8.3), auto-update (§8.5), release workflow (§9).
- **Exit:** signed, notarized installers for all four targets download, install, run, and auto-update from a GitHub Release.

## 11. Testing strategy

- **Renderer ports:** unit tests for each desktop-branch (`apiFetch` desktop mode, fs bridge fallbacks) using a mocked `window.openreel`. Existing Vitest suites must stay green for the web path (no regression).
- **IPC contract:** type-level tests + runtime zod validation tests on every handler (reject malformed payloads).
- **Native export parity:** golden-frame harness — render the same `.openreel` through `WebCodecsBackend` and `NativeFFmpegBackend`; assert decoded-output ΔE within tolerance + container/codec correctness (ffprobe).
- **Export timing/audio:** fixture projects with gaps, still frames, muted ranges, non-zero offsets, and fractional durations; assert decoded frame count/duration and audio sync against the expected CFR timeline.
- **Sidecar jobs:** integration tests spawning real FFmpeg against fixture media (probe, proxy, transcode, capture-to-file), asserting outputs + clean cancel/cleanup (no orphaned processes or temp files).
- **Throughput benchmark:** export FPS at 1080p/4K, RGBA-vs-NV12 transport, gating the §6.4 fallback decision with numbers.
- **Hardware probe:** snapshot real values per CI runner; assert shape + plausibility.
- **Packaging smoke (CI):** each tagged build installs and launches headless where possible; manual smoke matrix per platform before promoting a release.
- **Security:** assert `contextIsolation`/`sandbox`/`nodeIntegration:false`, CSP present, no `window.require`, IPC rejects unvalidated input.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| FFmpeg rawvideo/audio inputs are wired incorrectly | Declare all inputs up front; v1 uses video stdin plus a temp WAV/PCM audio input, with tests for mux success and sync (§6.4). |
| Timeline drift from raw `-r FPS` export | Native export maps `tsMicros` onto a CFR frame grid, duplicates/drops frames deterministically, and pads/trims audio to the same range (§6.4). |
| Frame-transport copy cost at 4K/60 (zero-copy NOT available over Electron MessagePorts — Phase-2.1 spike) | Frames travel by structured-clone copy with NO transfer list (transferables silently null the payload). Renderer reuses one scratch buffer. Escalate only if saturated: NV12 pre-convert → SharedArrayBuffer ring buffer (§6.4). A guard/test forbids frame data in any transfer list. Benchmark-gated. |
| FFmpeg GPL/patent licensing for a distributed product | Legal approval before Phase 5; separate-process invocation + written source offer (A), or LGPL build dropping x264/x265 (B), plus codec patent/licensing review (§8.4). |
| macOS notarization + hardened-runtime entitlements vs bundled FFmpeg | Sign the FFmpeg binary + correct entitlements; CI notarize/staple; test on a clean machine. |
| Cloud Worker rework / desktop auth scope creep | Phase 4 isolates it; BYOK ships first (no backend change), server-proxy + JWT follows. |
| `crossOriginIsolated` not actually true under `app://` | Verify in Phase 0 as an explicit exit criterion before building on it. |
| COEP blocks workers/WASM/assets under `app://` | Phase 1 asset smoke tests; bundle failed assets locally or fetch through a same-origin main-process bridge (§4.3). |
| Per-platform hardware-encoder absence (e.g. no NVENC) | Probe + trial-encode at runtime (§6.2); always have a software fallback; surface the chosen encoder in the UI. |
| macOS system-audio capture expands Phase 3 | Split native video capture and system/app-audio capture implementation/tests; choose ScreenCaptureKit vs helper before the audio substep (§6.6). |
| Renderer assumes browser globals somewhere not yet found | Survey found none at import time; add a desktop smoke test that boots the full editor and asserts no thrown globals. |

## 13. Open questions (do not block Phase 0)

- **FFmpeg binary source:** custom-built (full control, more maintenance) vs vetted upstream (BtbN for Win/Linux; custom macOS). Pin + checksum either way.
- **Universal vs per-arch macOS build:** universal `.dmg` (simpler UX, larger) vs two builds. Lean per-arch to keep FFmpeg bundling clean.
- **Auto-update host:** GitHub Releases (default) vs self-hosted/S3 feed. GitHub for v1.
- **Windows code-signing cert:** EV (immediate SmartScreen trust, hardware token) vs OV (cheaper, reputation builds over time). Acquisition is the only blocker for signed Windows builds.
- **System-audio capture on macOS:** ScreenCaptureKit (modern, 13+) vs a bundled audio-tap helper for older OS. Decide in Phase 3.
- **No-audio native export + `-shortest` (known v1 limitation, Task 2.8):** the native backend's silent-WAV fallback is sized to `project.timeline.duration`, but `exportVideo` renders video to the richer `calculateTimelineDuration` (which also counts text/shape/sticker/subtitle clips in separate engines). With ffmpeg `-shortest`, a project with **no audio** whose visual content extends past `timeline.duration` could be truncated to the shorter silent audio. Affects only the no-audio path; the common (audio-present, full-length render) case is unaffected. Clean fix when prioritized: pass the authoritative `calculateTimelineDuration` to the backend for the silent-WAV length, or use ffmpeg `-f lavfi -i anullsrc` for the no-audio case and drop `-shortest`. Verify in Task 2.11.

- `apps/web/src/services/api-proxy.ts` — `apiFetch` seam for the cloud/BYOK rework (§6.8).
- `packages/core/src/export/export-engine.ts` `exportVideo()` — encoder-backend seam for native export (§6.4). Note: `export-worker.ts` is dead/unimported and is NOT the seam.
- `packages/core/src/export/export-engine.ts` — browser caps to lift (`:239`, `:249-268`, `:382`, `:466-473`).
- `packages/core/src/media/ffmpeg-fallback.ts` — wasm/CDN path replaced by native sidecar (§6.5).
- `apps/web/src/services/screen-recorder.ts` — capture path replaced natively (§6.6).
- `apps/web/src/services/project-manager.ts`, `media-storage.ts` — File System Access bridge targets (§5).
- `apps/web/public/_headers`, `vite.config.ts` — COOP/COEP reproduced via `app://` (§4.3).
- `apps/cloud/wrangler.jsonc`, `functions/api/proxy/[[catchall]].ts` — cloud Worker proxy + desktop auth changes (§6.8).
- [`2026-05-28-kael-openreel-desktop-design.md`](./2026-05-28-kael-openreel-desktop-design.md) — superseded Rust plan; retained for feature inventory & parity invariants.
