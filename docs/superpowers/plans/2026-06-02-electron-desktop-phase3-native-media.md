# OpenReel Desktop — Phase 3 (Native Decode/Proxy/Transcode + Hardware-Driven Defaults) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On desktop, route media proxy/transcode/audio-extraction/probe to the native FFmpeg sidecar (instead of `ffmpeg.wasm`) so large/4K/long source edits smoothly, and feed **real** hardware specs (`probeHardware()`) into the device-profile + export-estimator instead of browser heuristics — while leaving the web path unchanged.

**Architecture:** Mirror the proven Phase 2 patterns. A new `main/sidecar/media-job.ts` (file-in→file-out ffmpeg jobs, like `export-job.ts` but no frame streaming) + `main/ipc/media.ts` orchestrator (jobs Map + tmp paths + cleanup, like `ipc/export.ts`), exposed as `window.openreel.media.*` (new IPC channels, zod-validated `handle()`, hand-mirrored in `global.d.ts`). The renderer routes through a desktop branch in `MediaImportService` (the existing centralized proxy/transcode decision point). For §6.7, a pure `buildProfileFromNativeSpecs()` maps `OpenReelHardwareInfo` → the existing `DeviceProfile` shape (reusing the pure tier/recommendation logic), wired into `getDeviceProfile()`'s single entry.

**Scope:** §6.5 (decode/proxy/transcode/audio) + §6.7 (hardware defaults). **§6.6 native capture is OUT OF SCOPE** — it requires a GUI session, real devices, OS permissions, and macOS code-signing+entitlements (Phase 5), and cannot run or be verified in an unsigned headless build. It gets its own plan paired with Phase 5 signing.

**Spec:** `docs/superpowers/specs/2026-06-02-electron-desktop-native-offload-design.md` §6.5, §6.7.
**Builds on:** the committed `feat/electron-desktop` Phase 0–2 work (window.openreel bridge, sidecar patterns).

---

## Key facts from the seam survey (2026-06-02)

- **`ffmpeg-fallback.ts`** (`packages/core/src/media/`) — the wasm fallback. Pure file→file ops to mirror natively: `generateProxy`/`generateProxyWithPreset` (`:340-399`), `transcodeToCompatible` (`:242-286`), `extractAudioAsWav` (`:301-338`), `probeAudioStreams` (`:481-543`). Proxy thresholds `PROXY_THRESHOLDS` (`:82-87`, 4K/600s/500MB) + `shouldUseProxy`/`getRecommendedProxyPreset` are **pure CPU, platform-agnostic — reuse as the policy; only the executor changes.**
- **`MediaImportService`** (`packages/core/src/media/media-import-service.ts`) — the centralized decision point: `generateProxy` (tries MediaBunny then FFmpeg, ~472-503), `importWithFallback` (~302-374, calls `transcodeToCompatible`), `probeAudioStreams` (115/325). **Desktop branch goes here** so React callers are unaffected.
- **3 direct `extractAudioAsWav` callers bypass MediaImportService:** `audio-engine.ts:413`, `apps/web/src/utils/load-audio-buffer.ts:27`, `Preview.tsx:482` — route them through a shared helper.
- **File-format impedance:** wasm path is `Blob`-in/`Blob`-out; the desktop bridge is path-based (`fs.openWrite`/`writeChunk`). Native media ops take a **source path** and return an **output path** (proxies live on the native disk cache per spec §6.5 — no IndexedDB quota). `MediaImportService` materializes an imported `File` to a temp path first.
- **`device-capabilities.ts` + `export-estimator.ts`** (`packages/core/src/device/`) — `getDeviceProfile()` (`:419-428`) is the single entry both UI consumers (`ExportDialog.tsx`, `Toolbar.tsx`) call. Pure/reusable: `getCpuTier`/`getMemoryTier`/`getGpuTier`/`calculateOverallTier`/`getCodecRecommendations`/`getResolutionRecommendations`, and the whole estimator math. `getGpuTier` substring tables were tuned for WebGL ANGLE strings — **must be extended for native GPU strings** (e.g. `Apple M2 Pro`).
- **Existing native source (already built, unused by §6.7):** `window.openreel.probeHardware()` → `OpenReelHardwareInfo {cpu{model,physicalCores,logicalCores}, memory{totalBytes,freeBytes}, gpus[], encoders[], platform, arch}`. `encoder-probe.ts:selectEncoder` has real HW-encoder preference tables.
- **IPC patterns to mirror exactly:** channel strings `openreel:<feature>:*` in `shared/channels.ts`; zod schema in `shared/ipc-contract.ts` + hand-mirrored type in `apps/web/src/types/global.d.ts` (no codegen — keep both in sync); request/response via the `handle(channel, schema, fn)` wrapper; sidecar job classes are callback-driven + framework-free (spawn from `resolveFfmpegPath()`, pure `buildArgs`, `parseProgressBlock` on `-progress pipe:2`, `cancel()` SIGKILL); orchestration/state in `main/ipc/`, pure ffmpeg logic in `main/sidecar/`; probe-style fns swallow errors → `[]`. MessageChannelMain is NOT needed here (no high-throughput frame streaming — these are file→file).

---

## File structure

**New (`apps/desktop`):**
- `apps/desktop/src/main/sidecar/media-job.ts` — `buildProxyArgs`/`buildTranscodeArgs`/`buildExtractAudioArgs` (pure) + `MediaJob` (spawn ffmpeg file→file, progress, cancel)
- `apps/desktop/src/main/sidecar/probe-streams.ts` — `parseAudioStreams(stderr)` (pure) + `probeAudioStreams(path)` (spawn)
- `apps/desktop/src/main/ipc/media.ts` — `generateProxy`/`transcode`/`extractAudioWav`/`probeAudioStreams` handlers (jobs Map + tmp paths + cleanup)
- `apps/desktop/test/media-job.test.ts`, `apps/desktop/test/media-integration.test.ts`, `apps/desktop/test/probe-streams.test.ts`

**Modified (`apps/desktop`):**
- `apps/desktop/src/shared/channels.ts` (+`openreel:media:*` keys)
- `apps/desktop/src/shared/ipc-contract.ts` (+zod schemas)
- `apps/desktop/src/preload/index.ts` (+`media` namespace)
- `apps/desktop/src/main/index.ts` (+register media handlers + `benchmarkEncode`)

**Modified (`apps/web` / `packages/core`):**
- `apps/web/src/types/global.d.ts` (+`media` + extend hardware/benchmark types)
- `packages/core/src/media/media-import-service.ts` (desktop branch for proxy/transcode/probe)
- `packages/core/src/media/native-media-bridge.ts` — **new**, the renderer-side helper wrapping `window.openreel.media` (materialize File→temp path, call native, return path/Blob) + the shared `extractAudioWav` helper for the 3 direct callers
- `packages/core/src/audio/audio-engine.ts`, `apps/web/src/utils/load-audio-buffer.ts`, `apps/web/src/components/editor/Preview.tsx` (route `extractAudioAsWav` through the shared helper)
- `packages/core/src/device/native-profile.ts` — **new**, pure `buildProfileFromNativeSpecs(hardwareInfo, benchmark?)`
- `packages/core/src/device/device-capabilities.ts` (desktop branch in `getDeviceProfile`; extend `getGpuTier` for native GPU strings)

---

# WORKSTREAM A — Native decode/proxy/transcode (§6.5)

### Task A1: Native media IPC channels + zod schemas + types

**Files:** `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc-contract.ts`, `apps/web/src/types/global.d.ts`

- [ ] **Step 1: Add channels** to `CHANNELS` in `shared/channels.ts`:
```ts
  mediaGenerateProxy: "openreel:media:generateProxy",
  mediaTranscode: "openreel:media:transcode",
  mediaExtractAudioWav: "openreel:media:extractAudioWav",
  mediaProbeAudioStreams: "openreel:media:probeAudioStreams",
```
- [ ] **Step 2: Add zod schemas** to `shared/ipc-contract.ts`:
```ts
export const proxyArgsSchema = z.object({
  srcPath: z.string(),
  preset: z.enum(["low", "medium", "high"]),
});
export const transcodeArgsSchema = z.object({
  srcPath: z.string(),
  container: z.enum(["mp4", "webm", "mov"]).default("mp4"),
  videoBitrateKbps: z.number().int().positive().default(5000),
  audioBitrateKbps: z.number().int().positive().default(192),
});
export const extractAudioArgsSchema = z.object({
  srcPath: z.string(),
  streamIndex: z.number().int().nonnegative().optional(),
});
export const probeAudioArgsSchema = z.object({ srcPath: z.string() });

export const audioStreamInfoSchema = z.object({
  index: z.number().int(),
  codec: z.string(),
  channels: z.number().int(),
  sampleRate: z.number().int(),
  language: z.string().optional(),
});
export type AudioStreamInfo = z.infer<typeof audioStreamInfoSchema>;
```
- [ ] **Step 3: Add the `media` surface to the ambient type** in `apps/web/src/types/global.d.ts`'s `window.openreel`:
```ts
      media: {
        generateProxy(args: { srcPath: string; preset: "low" | "medium" | "high" }): Promise<{ outPath: string }>;
        transcode(args: { srcPath: string; container?: "mp4" | "webm" | "mov"; videoBitrateKbps?: number; audioBitrateKbps?: number }): Promise<{ outPath: string }>;
        extractAudioWav(args: { srcPath: string; streamIndex?: number }): Promise<{ outPath: string }>;
        probeAudioStreams(args: { srcPath: string }): Promise<{ streams: { index: number; codec: string; channels: number; sampleRate: number; language?: string }[] }>;
      };
```
- [ ] **Step 4: typecheck** — `pnpm --filter @openreel/desktop typecheck && pnpm --filter @openreel/web typecheck` → 0 errors.
- [ ] **Step 5: commit** — `git commit -m "feat(desktop): media IPC channels + schemas + window.openreel.media type"`

### Task A2: `media-job.ts` — pure ffmpeg arg builders (TDD)

**Files:** Create `apps/desktop/src/main/sidecar/media-job.ts`, `apps/desktop/test/media-job.test.ts`

- [ ] **Step 1: failing test** `apps/desktop/test/media-job.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildProxyArgs, buildTranscodeArgs, buildExtractAudioArgs, PROXY_SCALE } from "../src/main/sidecar/media-job";

describe("media-job arg builders", () => {
  it("proxy: scales to the preset height, h264, faststart, progress pipe", () => {
    const a = buildProxyArgs("/in.mp4", "/out.mp4", "medium");
    expect(a).toContain("/in.mp4");
    expect(a[a.length - 1]).toBe("/out.mp4");
    expect(a.join(" ")).toMatch(/scale=-2:720/); // medium = 720p
    expect(a).toContain("libx264");
    expect(a.join(" ")).toContain("faststart");
    expect(a).toContain("-progress");
  });
  it("transcode: container/codec/bitrates honored, inputs before output", () => {
    const a = buildTranscodeArgs("/in.mov", "/out.mp4", { container: "mp4", videoBitrateKbps: 5000, audioBitrateKbps: 192 });
    expect(a.indexOf("-i")).toBeLessThan(a.length - 1);
    expect(a).toContain("5000k");
    expect(a[a.length - 1]).toBe("/out.mp4");
  });
  it("extract-audio: pcm_f32le wav, optional stream map", () => {
    const a = buildExtractAudioArgs("/in.mp4", "/out.wav", 1);
    expect(a.join(" ")).toContain("-map 0:a:1");
    expect(a).toContain("pcm_f32le");
    expect(a[a.length - 1]).toBe("/out.wav");
  });
  it("exposes PROXY_SCALE heights matching the web presets", () => {
    expect(PROXY_SCALE).toEqual({ low: 540, medium: 720, high: 1080 });
  });
});
```
- [ ] **Step 2: run → FAIL** (`pnpm --filter @openreel/desktop test:run media-job`).
- [ ] **Step 3: implement** `apps/desktop/src/main/sidecar/media-job.ts`:
```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { parseProgressBlock } from "./export-job";

export const PROXY_SCALE = { low: 540, medium: 720, high: 1080 } as const;
const PROXY_CRF = { low: 32, medium: 28, high: 23 } as const;
const PROXY_PRESET = { low: "ultrafast", medium: "fast", high: "medium" } as const;

export function buildProxyArgs(srcPath: string, outPath: string, preset: "low" | "medium" | "high"): string[] {
  return [
    "-y", "-i", srcPath,
    "-vf", `scale=-2:${PROXY_SCALE[preset]}`,
    "-c:v", "libx264", "-preset", PROXY_PRESET[preset], "-crf", String(PROXY_CRF[preset]),
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    "-progress", "pipe:2",
    outPath,
  ];
}

export function buildTranscodeArgs(
  srcPath: string, outPath: string,
  opts: { container: "mp4" | "webm" | "mov"; videoBitrateKbps: number; audioBitrateKbps: number },
): string[] {
  const vcodec = opts.container === "webm" ? "libvpx-vp9" : "libx264";
  const acodec = opts.container === "webm" ? "libopus" : "aac";
  return [
    "-y", "-i", srcPath,
    "-c:v", vcodec, "-b:v", `${opts.videoBitrateKbps}k`,
    "-c:a", acodec, "-b:a", `${opts.audioBitrateKbps}k`,
    ...(opts.container === "mp4" ? ["-movflags", "+faststart"] : []),
    "-progress", "pipe:2",
    outPath,
  ];
}

export function buildExtractAudioArgs(srcPath: string, outPath: string, streamIndex?: number): string[] {
  return [
    "-y", "-i", srcPath,
    ...(streamIndex !== undefined ? ["-map", `0:a:${streamIndex}`] : ["-map", "0:a:0"]),
    "-vn", "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2",
    "-progress", "pipe:2",
    outPath,
  ];
}

export class MediaJob {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stderr = "";
  constructor(
    private readonly args: string[],
    private readonly onProgress?: (frame: number) => void,
  ) {}
  run(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(resolveFfmpegPath(), this.args);
      this.proc.stderr.on("data", (c: Buffer) => {
        this.stderr += c.toString();
        if (this.stderr.length > 16384) this.stderr = this.stderr.slice(-4096);
        const p = parseProgressBlock(this.stderr);
        if (p && this.onProgress) this.onProgress(p.frame);
      });
      this.proc.on("error", (e) => reject(e));
      this.proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });
  }
  cancel(): void { this.proc?.kill("SIGKILL"); }
}
```
- [ ] **Step 4: run → PASS.** typecheck. commit: `feat(desktop): native media-job ffmpeg arg builders + runner`

### Task A3: `probe-streams.ts` — audio stream probe (TDD on the parser)

**Files:** Create `apps/desktop/src/main/sidecar/probe-streams.ts`, `apps/desktop/test/probe-streams.test.ts`

- [ ] **Step 1: failing test** asserting `parseAudioStreams(stderr)` extracts index/codec/channels/sampleRate from real `ffmpeg -i` stderr lines, e.g. input:
```
  Stream #0:1[0x2](eng): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s
  Stream #0:2(jpn): Audio: ac3, 48000 Hz, 5.1, 384 kb/s
```
→ two streams: `{index:1,codec:"aac",channels:2,sampleRate:48000,language:"eng"}` and `{index:2,codec:"ac3",channels:6,sampleRate:48000,language:"jpn"}` (map `stereo`→2, `5.1`→6, `mono`→1).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** `parseAudioStreams(stderr: string): AudioStreamInfo[]` (regex over `Stream #0:(\d+).*Audio: (\w+).*?(\d+) Hz, (mono|stereo|[\d.]+)`, channel-layout→count map) + `async probeAudioStreams(srcPath): Promise<AudioStreamInfo[]>` (spawn `ffmpeg -i srcPath -hide_banner`, capture stderr, parse; the process exits non-zero with no output file — that's expected, parse stderr regardless).
- [ ] **Step 4: run → PASS.** typecheck. commit: `feat(desktop): native audio-stream probe (parse + spawn)`

### Task A4: `main/ipc/media.ts` orchestrator + register handlers

**Files:** Create `apps/desktop/src/main/ipc/media.ts`; modify `apps/desktop/src/main/index.ts`

- [ ] **Step 1: implement `media.ts`** mirroring `ipc/export.ts`'s tmp-file + cleanup pattern (no jobs Map needed unless you support cancel; v1 awaits each job):
```ts
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { MediaJob, buildProxyArgs, buildTranscodeArgs, buildExtractAudioArgs } from "../sidecar/media-job";
import { probeAudioStreams as probe } from "../sidecar/probe-streams";

function tmp(ext: string): string { return path.join(os.tmpdir(), `openreel-${randomUUID()}.${ext}`); }

export async function generateProxy(a: { srcPath: string; preset: "low" | "medium" | "high" }): Promise<{ outPath: string }> {
  const outPath = tmp("mp4");
  await new MediaJob(buildProxyArgs(a.srcPath, outPath, a.preset)).run();
  return { outPath };
}
export async function transcode(a: { srcPath: string; container?: "mp4" | "webm" | "mov"; videoBitrateKbps?: number; audioBitrateKbps?: number }): Promise<{ outPath: string }> {
  const container = a.container ?? "mp4";
  const outPath = tmp(container);
  await new MediaJob(buildTranscodeArgs(a.srcPath, outPath, { container, videoBitrateKbps: a.videoBitrateKbps ?? 5000, audioBitrateKbps: a.audioBitrateKbps ?? 192 })).run();
  return { outPath };
}
export async function extractAudioWav(a: { srcPath: string; streamIndex?: number }): Promise<{ outPath: string }> {
  const outPath = tmp("wav");
  await new MediaJob(buildExtractAudioArgs(a.srcPath, outPath, a.streamIndex)).run();
  return { outPath };
}
export async function probeAudioStreams(a: { srcPath: string }): Promise<{ streams: Awaited<ReturnType<typeof probe>> }> {
  return { streams: await probe(a.srcPath) };
}
```
- [ ] **Step 2: register** in `main/index.ts` (inside `app.whenReady().then`, using the `handle` wrapper + the schemas from A1):
```ts
  handle(CHANNELS.mediaGenerateProxy, proxyArgsSchema, generateProxy);
  handle(CHANNELS.mediaTranscode, transcodeArgsSchema, transcode);
  handle(CHANNELS.mediaExtractAudioWav, extractAudioArgsSchema, extractAudioWav);
  handle(CHANNELS.mediaProbeAudioStreams, probeAudioArgsSchema, probeAudioStreams);
```
- [ ] **Step 3: expose in preload** (`preload/index.ts`, new `media` namespace mirroring the others):
```ts
  media: {
    generateProxy: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaGenerateProxy, args),
    transcode: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaTranscode, args),
    extractAudioWav: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaExtractAudioWav, args),
    probeAudioStreams: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaProbeAudioStreams, args),
  },
```
- [ ] **Step 4: typecheck + build:main + full desktop test suite green.** commit: `feat(desktop): media IPC orchestrator (proxy/transcode/extract-audio/probe)`

### Task A5: real-ffmpeg media integration test

**Files:** Create `apps/desktop/test/media-integration.test.ts` (mock `electron`+`ffmpeg-path` file-scoped like `export-integration.test.ts`)

- [ ] **Step 1: write the test** — make a small test source (`ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine -t 1 src.mp4`), then:
  - `generateProxy({srcPath, preset:"low"})` → ffprobe/`-i` the outPath shows height 540 + a video+audio stream.
  - `extractAudioWav({srcPath})` → outPath is a WAV with an audio stream (pcm_f32le, 48kHz).
  - `probeAudioStreams({srcPath})` → returns ≥1 stream with codec/channels/sampleRate.
- [ ] **Step 2: run → PASS** (real ffmpeg, headless). full suite green. typecheck. commit: `test(desktop): native media proxy/extract/probe integration`

### Task A6: renderer `native-media-bridge.ts` + `MediaImportService` desktop branch

**Files:** Create `packages/core/src/media/native-media-bridge.ts`; modify `media-import-service.ts`; route the 3 direct `extractAudioAsWav` callers.

- [ ] **Step 1: TDD the bridge** (`packages/core/src/media/native-media-bridge.test.ts`) with a mocked `window.openreel`: `nativeMediaAvailable()` returns true iff `window.openreel?.media` exists; `materializeToTemp(file)` writes a File via `fs.openWrite/writeChunk/closeWrite` and returns a path; `proxyViaNative(file, preset)` materializes → `media.generateProxy` → reads the outPath back via `fs.readFile`/a path handle into a Blob (or returns the path for path-based storage — choose Blob for v1 to match the existing `generateProxy: Promise<Blob>` contract); `extractAudioWavViaNative(file, streamIndex)` similarly → Blob; `probeAudioStreamsViaNative(file)` materializes → `media.probeAudioStreams`.
  > DECISION: v1 returns Blobs (read the temp output back) to keep `MediaImportService`'s existing `Blob` contract unchanged and minimize blast radius. A later optimization can keep proxies as on-disk paths in the native cache (spec §6.5) — track as a follow-up. Note `fs.readFile` returns a string today (utf8) — extend the fs bridge with a binary read (`readFileBytes(path): Promise<ArrayBuffer>`) OR have `media.*` return bytes directly. Pick ONE and implement it in this task (recommend adding `media.*` returning `{ bytes: ArrayBuffer }` OR a `fs.readFileBytes`); update A1's types + the main handler accordingly and re-run A5.
- [ ] **Step 2: desktop branch in `MediaImportService`** — at the top of `generateProxy`, `importWithFallback`'s transcode step, and `probeAudioStreams`, add `if (nativeMediaAvailable()) return <bridge call>;` before the MediaBunny/FFmpeg-wasm path. Keep the wasm/MediaBunny path for web (when the bridge is absent). Reuse the platform-agnostic `shouldUseProxy`/`getRecommendedProxyPreset` policy unchanged.
- [ ] **Step 3: shared `extractAudioWav` helper** — create one helper (in `native-media-bridge.ts` or a small `media/extract-audio.ts`) that does `nativeMediaAvailable() ? extractAudioWavViaNative(...) : getFFmpegFallback().extractAudioAsWav(...)`, and route `audio-engine.ts:413`, `load-audio-buffer.ts:27`, `Preview.tsx:482` through it (each currently calls `getFFmpegFallback().extractAudioAsWav` directly).
- [ ] **Step 4: verify** — `pnpm --filter @openreel/core test:run` (bridge tests + no regressions), `pnpm --filter @openreel/core typecheck`, `pnpm --filter @openreel/web typecheck`, `pnpm --filter @openreel/web build` (web path unaffected — bridge is undefined on web), `pnpm --filter @openreel/web test:run` (147/7 baseline, no new failures). commit: `feat(core): route proxy/transcode/extract-audio to native sidecar on desktop`

---

# WORKSTREAM B — Hardware-driven defaults (§6.7)

### Task B1: pure `buildProfileFromNativeSpecs()` (TDD)

**Files:** Create `packages/core/src/device/native-profile.ts`, `packages/core/src/device/native-profile.test.ts`; export an `encoders[]→EncodingSupport` mapper.

- [ ] **Step 1: failing test** — `buildProfileFromNativeSpecs(info)` where `info` is an `OpenReelHardwareInfo`-shaped object (cpu.logicalCores, memory.totalBytes, gpus, encoders, platform, arch) produces a valid `DeviceProfile`:
  - cores → `getCpuTier`; totalBytes/2^30 → gb → `getMemoryTier`; gpus[0] → renderer/vendor → (extended) `getGpuTier`; platform → `platform.os`.
  - encoders `["h264_videotoolbox","hevc_videotoolbox","libx264"]` → `encoding.h264.hardware=true`, `h265.hardware=true`, `av1.supported=false` (no av1 encoder), etc.
  - assert `overallTier` via `calculateOverallTier`.
  - assert `encoding.<codec>.hardware` matches the presence of any hardware encoder for that codec (reuse a mapping mirroring `encoder-probe.ts`'s preference families).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** `native-profile.ts`: import the pure helpers from `device-capabilities.ts` (export `getCpuTier`/`getMemoryTier`/`getGpuTier`/`calculateOverallTier` if not already exported), define `encodersToSupport(encoders: string[]): EncodingSupport` (h264: any of h264_videotoolbox/nvenc/qsv/amf/vaapi → hardware; libx264 → supported; same families for hevc/av1/vp9), and assemble the `DeviceProfile`. No `localStorage`/DOM/WebGL access — pure.
- [ ] **Step 4: run → PASS.** typecheck. commit: `feat(core): pure buildProfileFromNativeSpecs (HardwareInfo -> DeviceProfile)`

### Task B2: extend `getGpuTier` for native GPU strings (TDD)

**Files:** `packages/core/src/device/device-capabilities.ts` + its test

- [ ] **Step 1: failing test** — `getGpuTier("Apple M2 Pro")` → high-ish (mid/high), `getGpuTier("Apple M1")` → mid, `getGpuTier("NVIDIA GeForce RTX 4080")` → high, `getGpuTier("Intel UHD Graphics 630")` → low/mid. (Native strings lack the `ANGLE (...)` wrapper the current tables assume.)
- [ ] **Step 2: run → FAIL** for the native (non-ANGLE) strings.
- [ ] **Step 3: extend** the `getGpuTier` highEnd/midEnd substring tables to recognize native renderer strings (`apple m`, `nvidia geforce rtx`, `radeon rx`, etc.) in addition to the existing ANGLE patterns. Keep existing web behavior (don't remove ANGLE patterns).
- [ ] **Step 4: run → PASS** (native + existing web cases). typecheck + `pnpm --filter @openreel/core test:run`. commit: `feat(core): recognize native GPU renderer strings in getGpuTier`

### Task B3: wire `getDeviceProfile()` desktop branch

**Files:** `packages/core/src/device/device-capabilities.ts`

- [ ] **Step 1: desktop branch** at the top of `getDeviceProfile(forceRefresh)`:
```ts
  if (typeof window !== "undefined" && window.openreel?.platform === "desktop") {
    const info = await window.openreel.probeHardware();
    cachedProfile = buildProfileFromNativeSpecs(info);
    return cachedProfile;
  }
```
(Keep the existing `detectDeviceCapabilities()` path for web. Preserve `cachedProfile` memoization + `forceRefresh`.)
- [ ] **Step 2: verify** — `pnpm --filter @openreel/core typecheck && test:run`, `pnpm --filter @openreel/web typecheck && build && test:run` (web path uses the browser detection unchanged; consumers `ExportDialog.tsx`/`Toolbar.tsx` need zero changes — same `DeviceProfile` shape). commit: `feat(core): desktop device profile from real probeHardware specs`

> **Deferred (optional follow-up, not in this plan):** native-encode FPS to replace the in-browser `runBenchmark()` (a `CHANNELS.benchmarkEncode` running a short real encode → `profile.benchmark` → measured estimates). Phase 3 already delivers accurate tier/encoder info feeding the deterministic FPS tables — a big improvement. The live native benchmark is a refinement; track separately.

---

## Self-Review

**Spec coverage:** §6.5 native decode/proxy/transcode/audio → Workstream A (A1–A6) ✓ (proxy thresholds reused as policy; proxies routed to native; 3 direct audio-extract callers handled). §6.7 hardware-driven defaults → Workstream B (B1–B3) ✓ (real specs → DeviceProfile; encoders → EncodingSupport; GPU strings extended). §6.6 capture → explicitly OUT OF SCOPE (deferred to Phase 5-paired plan, with rationale).

**Placeholder scan:** One deliberate DECISION point in A6 Step 1 (Blob-vs-path return + the binary-read mechanism) — it states the v1 choice (Blobs + add a binary read path) and the follow-up; the implementer must pick and implement the binary-read mechanism in A6 and reconcile A1's types. Not a vague placeholder — a scoped decision with a default.

**Type consistency:** `window.openreel.media` shape is identical across `global.d.ts` (A1), preload (A4), and the bridge consumer (A6). The `media` IPC arg/return shapes match the zod schemas (A1) ↔ main handlers (A4). `buildProfileFromNativeSpecs` output is the existing `DeviceProfile` (B1) consumed unchanged by `getDeviceProfile` (B3) and the UI. The native ProRes/encoder families in `encodersToSupport` (B1) mirror `encoder-probe.ts`'s `selectEncoder` families.

**Headless-verifiability:** every Task has a real test gate (pure-arg-builder TDD, parser TDD, real-ffmpeg integration, mocked-bridge unit tests, pure-profile TDD) — no Task depends on a GUI. The capture work that WOULD need a GUI/permissions/entitlements is excluded.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-02-electron-desktop-phase3-native-media.md`. Two options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks (same as Phases 0–2).
2. **Inline Execution** — batch with checkpoints.

Which approach? (And confirm the §6.6 capture deferral, or say if you want its headlessly-buildable scaffolding included too.)
