# Phase 2 Acceptance — Native Export Parity (Task 2.11)

Native desktop export must beat the browser/wasm path on the two things that path
could not do: real ProRes (it silently downgraded ProRes → H.264) and encodes above
1080p (it clamped resolution for memory). This document splits the proof into what is
**automatically verified** in CI and what still requires **human on-screen verification**.

## Automatically proven (`apps/desktop/test/export-integration.test.ts`)

Run with: `pnpm --filter @openreel/desktop test:run export-integration`

All cases drive the **real bundled ffmpeg** (`resources/bin/<platform>-<arch>/ffmpeg`)
via the real `ExportJob` / direct spawn, streaming RGBA frames over stdin with
backpressure handling (no in-RAM video buffering — frames go straight to ffmpeg's
stdin and ffmpeg writes the file to disk).

1. **Native H.264, frames + audio → mp4** — hardware-selected encoder
   (`h264_videotoolbox` on macOS via `selectEncoder`). Probe asserts a Video stream,
   an Audio stream, and the requested 320x240 dimensions; output is non-zero.

2. **Native ProRes → `.mov` (Case A)** — encoder `prores_videotoolbox`
   (falls back to software `prores_ks` if the hardware encoder fails at runtime;
   either way the codec is genuine ProRes). RGBA frames + `pcm_s16le` audio in a MOV
   container. Probe asserts the Video stream codec is **prores** and an audio stream
   is present. This is the headline win: the wasm/WebCodecs path could only emit
   H.264, so ProRes requests were silently downgraded.

3. **Higher-than-1080p encode (Case B)** — `h264_videotoolbox` at **2560x1440**, a
   resolution the wasm path would have clamped to 1080p. Reuses `buildFfmpegArgs` +
   `ExportJob` (mp4/h264). Probe asserts the Video stream is present at the requested
   2560x1440. Proves caps are lifted in desktop mode.

4. **Streamed-to-disk via stdin** — every case writes frames through
   `ExportJob.writeFrame` (or a direct stdin write for ProRes) honoring `drain`
   backpressure; ffmpeg muxes directly to the output path. No full-video Blob is held
   in renderer memory.

## Requires human on-screen verification (Task 2.11 interactive)

These cover the GUI / end-to-end experience that headless tests cannot exercise:

1. **Real high-end project export.** In the desktop app, build/open a real project
   that is **4K (3840x2160), longer than 2 minutes, ProRes** (or H.265 10-bit), then
   Export. Confirm the export completes without error.

2. **Native save dialog + direct-to-disk write.** Confirm the native OS save dialog
   appears, and the chosen file is written **directly to the selected path** — not
   assembled as an in-RAM blob and then downloaded.

3. **No 1080p/30 clamp in desktop mode.** Confirm the exported file's resolution and
   frame rate match the project settings (e.g. 3840x2160 @ 60fps) and are **not**
   clamped to 1080p/30 the way the browser/WebCodecs path is.

4. **Progress + playback parity.** Confirm the export progress bar advances during the
   render, and the resulting file opens in a standard player (QuickTime / VLC) and
   matches the editor preview frame-for-frame in content and timing.

5. **Visual equivalence web vs desktop.** Export the same short project on **web
   (WebCodecs)** and on **desktop (native ffmpeg)**, then compare a decoded frame for
   visual equivalence, e.g.:

   ```bash
   ffmpeg -i out.mp4 -vf "select=eq(n\,30)" -vframes 1 frame.png
   ```

   The same frame index from each output should look equivalent (allowing for codec
   quantization differences).

## Known v1 limitation

For a **no-audio project**, any visual tail that extends beyond `timeline.duration`
may be truncated by `-shortest` (ffmpeg ends muxing at the shortest input stream).
Tracked as a v1 limitation — see spec §13.

# Desktop GPU AI panel — pending human E2E (Task D5)

The GPU cloud-jobs pipeline (token mint → presign → upload → poll → artifact import)
is unit/integration covered (`apps/desktop/test/gpu-token-provider.test.ts`,
`gpu-job-client.test.ts`, `cloud-fetch.test.ts`; `apps/web/src/services/gpu-result-import.test.ts`;
`packages/core/src/ai/cloud-job-types.test.ts`), but the full launch-to-clip flow
requires a deployed Worker and a human on-screen run. The following are **pending
human verification**:

1. **Deploy the `apps/cloud` Worker first.** The desktop AI path depends on the new
   `plat:"desktop"` leg of `POST /auth/token` in the auth broker Worker. Deploy
   `apps/cloud` before testing desktop AI; nothing in `infra/gpu-worker` changes for
   this task (no GPU worker redeploy needed).

2. **Confirm the broker + GPU base URLs point at live services.** Verify
   `OPENREEL_AUTH_BROKER_BASE_URL`
   (default `https://openreel-cloud.niiyeboah1996.workers.dev`) and
   `OPENREEL_GPU_BASE_URL` (default `https://ai.openreel.video`) resolve to the
   deployed Worker and the live GPU render service.

3. **Manual E2E — upscale a clip end to end.** Launch the desktop app, open the AI
   panel via the **Sparkles** toolbar toggle, select a single clip, and run
   `upscale`. Confirm the sequence: token mint → presign → upload of the source temp
   file → status poll until `completed` → artifact download → import back into the
   media library as a clip. Verify the imported item replaces its placeholder
   **in place** (same media id, not a duplicate), is no longer stuck pending, and has
   the **correct media type** (video result imports as `type:"video"` with real
   duration — not mislabeled as an image).

4. **Spot-check non-image kinds.** Because the v1 routing now types results from the
   decoded media (see decision below), run at least one video-producing kind and one
   audio-producing kind and confirm thumbnails/waveforms generate and the
   `duration`/dimensions are non-zero.

## v1 routing decision (Task D5 Part 1)

`importGpuResult` now routes **all** artifact kinds through
`projectStore.replaceMediaAsset(mediaId, file)` instead of the image-only
`replacePlaceholderMedia`. `replaceMediaAsset` resolves the item **in place by id**,
detects `video`/`audio`/`image` from the decoded media metadata (fixing the prior bug
where every GPU result was hardcoded to `type:"image"` with `duration:0`), clears
`isPlaceholder` and leaves `isPending` falsy, and generates thumbnails/waveforms.

**Added persistence step:** unlike `replacePlaceholderMedia`, `replaceMediaAsset` does
not itself write the blob to IndexedDB (it is normally used for file-handle-backed
desktop relinks that persist via the source file). A GPU result has no `sourceFile`
handle, so `importGpuResult` explicitly calls `saveMediaBlob(projectId, mediaId, file,
metadata)` after a successful replace, ensuring the result survives a project reload.
On a failed replace it throws, which the poller (`useGpuJobPoller`) catches to flag the
placeholder's error state.

**Remaining limitation:** the result media type is inferred from the bytes the GPU
worker returns (via the native media bridge decode), not from the requested `kind`. If
a worker returns an unexpected container/codec the bridge cannot decode, the import
fails and the placeholder is flagged rather than partially imported.

# Desktop Native Pro Redesign — pending human checks (Phases 1–2)

Automated tests + builds are green; these need a real launch / packaged build to confirm:

- [ ] Frameless window renders with mac traffic lights aligned to the custom title bar (trafficLightPosition x:16 y:14) and `under-window` vibrancy is visible.
- [ ] Windows/Linux: custom min/max/close buttons work (minimize, toggle-maximize, close) and the title bar is draggable (no-drag on the controls + tab area).
- [ ] Native application menu shows File/Edit/View/Window/Help; native roles (undo/redo/cut/copy/paste/minimize/close/toggle-fullscreen/about/quit) function; accelerators (Cmd/Ctrl+N/O/E/Z) fire.
- [ ] The DaVinci-style charcoal/teal theme renders on the shell (title bar, workspace tabs, page bodies) — surfaces charcoal, accent teal, shadcn primitives (Select/DropdownMenu/focus rings) teal not emerald.
- [ ] Edit/Color/Deliver page tabs switch and persist across reload (ui-store desktopPage).
- [ ] Packaged build (`pnpm --filter @openreel/desktop run dist` with certs) — measure real installer size + cold-start per platform. Signed/notarized dist requires certs (mac hardened-runtime + notarize creds; Windows Authenticode) supplied via CI/env; per-platform native ffmpeg binaries must be present in resources/bin.
- [ ] Slimming confirmed in the packaged app: renderer ~5MB (ffmpeg.wasm stripped, fonts curated); native ffmpeg sidecar handles all decode/transcode/export.
- [ ] (Known v1 limitation) Non-curated picker fonts (Display/Serif/etc.) don't render on desktop until a lazy-font-load follow-up; curated/Popular families + Geist render correctly.

# Desktop polish pass — pending human checks (PP1–PP7)

Automated tests + builds are green; these need a real launch / packaged build to confirm:

- [ ] Rotating-logo loader appears on project open (PP2 loading screen renders and animates while the project hydrates).
- [ ] Editor layout (Media / Viewer / Inspector / Timeline) renders with resizable handles between panels and the Export button is present and functional.
- [ ] OpenReel app icon shows in the macOS dock (packaged build) and in the Windows taskbar / window chrome (`BrowserWindow.icon` on win/linux).
- [ ] SF-Symbols-style icons render correctly across the chrome (title bar, workspace tabs, toolbar, inspector) via the shared Icon system.
- [ ] Export produces a real file via the native FFmpeg sidecar (end-to-end from the Export button through the native export pipeline).
