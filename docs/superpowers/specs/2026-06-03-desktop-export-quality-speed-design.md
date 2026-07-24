# Desktop Export: Quality, Size, Speed & Format — Design

Date: 2026-06-03
Status: Proposed (awaiting review)
Scope: Desktop (Electron) video export pipeline only. Web export (WebCodecs) is unchanged except for the shared settings type.

## Problem

Desktop export is forced onto `NativeFFmpegBackend` (`apps/web/src/main.tsx` → `setEncoderBackendFactory`), which renders each frame, reads it back GPU→CPU (`getImageData`), and pipes raw RGBA to ffmpeg. Two independent weaknesses:

1. **Encoder/rate-control:** `buildFfmpegArgs` (`apps/desktop/src/main/sidecar/export-job.ts`) always emits fixed-bitrate H.264 (`-b:v <kbps>`, `-pix_fmt yuv420p`, `-c:a aac`, mp4). Fixed bitrate produces larger files than necessary for a given quality, and the codec/container/pixel-format are hardcoded — HEVC/AV1/ProRes are not properly supported even though `selectEncoder` can pick their encoders.
2. **Throughput:** per-frame composite render + readback + raw pipe. The zero-copy frame transfer is already landed; the remaining cost split between render / readback / encode is unmeasured.

## Goals

- **Smaller files at equal/better quality** — quality-based rate control (CRF software / CQ hardware) instead of fixed bitrate; modern codecs (HEVC, AV1).
- **Faster** for the common case via hardware encoding, plus measure where time actually goes before investing in a deeper speed effort.
- **More formats** — H.264 (MP4), HEVC (MP4), AV1 (MP4), ProRes (MOV), each with correct container/pixel-format/audio.
- **Reliable** — build on the EPIPE-crash + ffmpeg-stderr-surfacing fixes already landed; no uncaught main-process crashes.
- **User control** — a Fast / Balanced / Smallest mode in the export dialog (desktop only).

## Non-Goals (this iteration)

- Rewriting the web WebCodecs backend.
- Eliminating the GPU→CPU readback via a WebCodecs/dual-backend path on desktop (kept as a *possible* fast-follow, gated on profiling — see Future Work).
- Optimizing the per-frame composite renderer itself (separate effort if profiling shows render dominates).
- Two-pass encoding.

## Approach (chosen: A — unified native ffmpeg, made smart)

Keep the single `NativeFFmpegBackend` → main-process ffmpeg path. Drive encoder selection and rate control from a new export **mode** plus the existing codec/quality settings. This delivers smaller files + higher quality + all four formats + reliability with one well-understood code path, and supports software x265/SVT-AV1 and ProRes that a browser hardware encoder cannot. Rejected alternative B (dual WebCodecs+ffmpeg backend) trades a readback-elimination speed win for materially more surface area and uncertain WebCodecs-HEVC support in the bundled Electron — deferred to Future Work pending profiling.

## Design

### 1. Settings model

Add an encode mode to `VideoExportSettings` (`packages/core/src/export/types.ts`):

```
encodeMode?: "fast" | "balanced" | "smallest"  // default "balanced"; desktop-honored
```

Reuse the existing `quality: number` (0–100) as the quality target; `bitrate` stays as a ceiling/fallback. Web/WebCodecs ignores `encodeMode` (or maps it to `bitrateMode`), so the field is optional and non-breaking.

### 2. Export dialog (desktop only)

In `ExportDialog.tsx`, when `window.openreel?.platform === "desktop"`, render a compact **Fast / Balanced / Smallest** segmented control (default Balanced) wired into `customSettings.encodeMode` and applied to preset-derived settings too. A one-line helper under it states the trade-off (e.g., "Balanced — hardware HEVC, great quality, much smaller files"). Non-desktop: control hidden, behavior unchanged.

### 3. Data flow

`ExportDialog` settings → `useExportRunner`/export-engine → `NativeFFmpegBackend.start(settings, project)` → `bridge.export.start(args)` → main `startExport` → `buildFfmpegArgs`.

`encodeMode` and `quality` must be threaded through the two boundaries that currently drop them:
- `NativeFFmpegBackend.start` (`apps/web/src/services/native-ffmpeg-backend.ts`): include `encodeMode` and `quality` in the `bridge.export.start` payload.
- IPC contract (`apps/web/src/types/global.d.ts` `OpenReelExportStartArgs`, `apps/desktop/src/main/ipc/export.ts` `ExportStartArgs`): add `encodeMode` and `quality`.

### 4. Encoder + rate-control matrix

`selectEncoder` (`encoder-probe.ts`) already maps codec→platform→hardware/software candidates. Extend selection to be mode-aware (Smallest forces the software encoder; Fast/Balanced prefer hardware), and rewrite `buildFfmpegArgs` to emit per-codec, per-mode, quality-based args:

| Mode | H.264 / HEVC | AV1 | ProRes |
|---|---|---|---|
| **Fast** | VideoToolbox (HW), CQ from `quality` | HW AV1 if present → else HEVC HW | `prores_videotoolbox` (profile from `quality`) |
| **Balanced** (default) | VideoToolbox (HW), higher CQ | `libsvtav1` fast preset, CRF | `prores_ks`/`prores_videotoolbox` |
| **Smallest** | `libx264`/`libx265`, CRF + slow preset | `libsvtav1`, CRF + slower preset | n/a (ProRes is inherently large; ignore mode) |

Rate control specifics (per encoder family):
- Software x264/x265: `-crf <N>` `-preset <p>` (no `-b:v`).
- SVT-AV1 (`libsvtav1`): `-crf <N>` `-preset <p>`.
- VideoToolbox (h264/hevc): constant quality `-q:v <N>` when supported by the bundled ffmpeg build; otherwise capped VBR (`-b:v` + `-maxrate`/`-bufsize`) derived from `quality`/resolution. Selection probes once.
- ProRes: `-profile:v <0..3>` (proxy/lt/std/hq) chosen from mode/`quality`; ProRes ignores CRF/bitrate.

**Quality → CRF/CQ mapping** (single shared helper so UI and encoder agree): map the 50–100 UI quality range to sensible per-family values — e.g. x264/x265 CRF ≈ 28→16, SVT-AV1 CRF ≈ 40→22, VideoToolbox `-q:v` ≈ 40→75. Exact tables decided in the plan; the helper is unit-tested.

### 5. Per-codec correctness

- **Container/extension:** ProRes → `.mov`; H.264/HEVC/AV1 → `.mp4` (HEVC/AV1 in mp4 use the right tags, e.g. `-tag:v hvc1` for HEVC so Apple players accept it). `extForFormat`/`exportFilename` (export-runner) and the save dialog filter must follow the chosen codec, not just `format`.
- **Pixel format:** H.264/HEVC/AV1 → `yuv420p` (or `p010le` for 10-bit HEVC/AV1 if exposed later); ProRes → `yuv422p10le`. Stop hardcoding `yuv420p`.
- **Audio:** AAC for mp4; for ProRes/mov keep AAC (or PCM if requested later). Driven by container.

### 6. Reliability (already landed; extend)

`ExportJob` now handles `stdin` errors (no EPIPE crash), stops writing after ffmpeg exits, and reports `ffmpeg exited with code N: <stderr tail>`. New per-codec args must keep this intact; any encoder/arg failure surfaces as a clean error string to the dialog. Add a guard: if a chosen hardware encoder isn't in the probe list, fall back to its software sibling rather than emitting an invalid `-c:v`.

### 7. Speed

- Ship cheap wins: hardware encode for Fast/Balanced, the zero-copy transfer already in place, and a deeper credit pipeline (raise `INITIAL_CREDITS` / decouple render-ahead from encode) so render and encode overlap more.
- **Profiling instrumentation (one-time, dev-gated):** record mean ms/frame for render, readback, and encode-stall (credit wait) during an export and log a summary. This tells us whether a future speed effort should target the readback (WebCodecs/dual-backend) or the composite renderer. No user-facing change.

## Components & boundaries

- `packages/core/src/export/types.ts` — add `encodeMode`; shared quality→CRF/CQ helper lives in core (`export/encode-quality.ts`) so both UI hints and main-process args can reference the same intent (main imports the pure mapping, or it is duplicated as a tiny pure module compiled into the desktop bundle).
- `apps/web/src/components/editor/ExportDialog.tsx` — desktop-only mode control.
- `apps/web/src/services/native-ffmpeg-backend.ts` — pass `encodeMode`/`quality` over IPC.
- `apps/web/src/services/export-runner.ts` — codec-aware extension/filename + save filter.
- `apps/web/src/types/global.d.ts` & `apps/desktop/src/main/ipc/export.ts` — IPC contract fields.
- `apps/desktop/src/main/sidecar/encoder-probe.ts` — mode-aware encoder selection + hardware-availability fallback.
- `apps/desktop/src/main/sidecar/export-job.ts` — `buildFfmpegArgs` rewrite (per-codec/mode/quality), container/pixfmt/audio correctness.

Each unit stays single-purpose: the dialog only chooses settings; the backend only ferries settings + frames; `encoder-probe` only decides the encoder; `buildFfmpegArgs` only translates settings→args (pure, fully unit-testable).

## Error handling

- Invalid/unavailable encoder → fall back to software sibling; if none, clean error to dialog.
- ffmpeg non-zero exit → existing `code N: <stderr>` surfaced to the export error UI.
- Truncated-output guard: if ffmpeg ends (code 0) having consumed fewer frames than `totalFrames` (e.g. `-shortest` + short audio), log it; decide in the plan whether to drop `-shortest` in favor of explicit duration.

## Testing

- `buildFfmpegArgs` — table-driven unit tests: every (codec × mode) emits the expected encoder, rate-control flag, pixel format, container, audio codec, and tags. (Extends existing desktop sidecar tests.)
- `selectEncoder` — mode-aware selection + hardware-missing fallback (extends `encoder-probe.test.ts`).
- quality→CRF/CQ helper — monotonic, clamped, per-family bounds.
- `extForFormat`/filename — codec-correct extension (ProRes→mov).
- Manual desktop verification matrix: each codec × mode actually produces a playable file; record file size + wall-clock vs. the current H.264 fixed-bitrate baseline.

## Risks & open questions

- VideoToolbox constant-quality (`-q:v`) support varies by ffmpeg build → must probe and fall back to capped VBR.
- HEVC/AV1 mp4 playability depends on correct tags (`hvc1`) and the viewer; H.264 remains the safe default.
- Sharing the quality-mapping helper across the web bundle and the desktop main process (different build targets) — plan picks "import from core" vs "tiny duplicated pure module."
- Whether to drop `-shortest` (truncation risk) — decided in the plan after confirming the export engine's audio coverage.

## Future work (not in this iteration)

- If profiling shows readback dominates: dual backend — WebCodecs hardware encode for Fast/Balanced to eliminate `getImageData`, ffmpeg for Smallest/ProRes.
- If render dominates: optimize the per-frame composite (GPU path, parallel frame rendering).
- 10-bit/HDR output; two-pass for absolute-smallest at a target size.
