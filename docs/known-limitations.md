# Capabilities and known limitations

User-facing status of the features reviewed in wave 11. Only claims that were verified by the reviewers are listed as capabilities; everything else is a known limit. Numbers come from the reviewers' own runs (Apple M2 Pro, 16 GB, Homebrew ffmpeg 8.1.1) unless stated otherwise.

## Status at desktop 1.0.0

Release notes: [releases/v1.0.0.md](releases/v1.0.0.md). Gap status against Premiere: [PREMIERE-GAPS.md](PREMIERE-GAPS.md). Sections below were written wave by wave; where a later wave changed a limit, the section says so or this list does.

Open at 1.0.0:

- **Real-time collaboration is experimental and deferred.** Its end-to-end test fails and nothing is deployed. See the Real-time collaboration section.
- **Interchange (XMEML, FCPXML, EDL, OTIO, AAF) has not been opened in Premiere Pro, Resolve, Avid or Final Cut.**
- **Sequence pixel aspect ratio is applied to titles, shapes, SVG, stickers, captions and particles** in export, the Program monitor and template thumbnails, like video. The WebGPU compositor now rotates, scales and positions each layer in display space and squeezes it to stored pixels (the same math as Canvas2D and export), so a rotated layer is not sheared in a non-square-PAR sequence, and blur-like effects on overlays (their own effects in export) and on adjustment layers run on a display-space (stored width x PAR) copy of the pixels, so they are isotropic when displayed, in the Program monitor, the Canvas2D fallback and export. Blur on a video clip's own effects is also isotropic in the Program monitor: a CSS-filterable clip (blur, brightness and so on) is filtered in a display-space layer that is then squeezed, instead of under the 1/PAR squeeze (where `ctx.filter` radii stay in device pixels and were anisotropic by the PAR); export blurs the decoded frame before layout. Remaining gaps: in a PAR below 1 (DV NTSC 0.9091) the display-space copy is narrower than the stored frame, so an overlay or adjustment layer that has effects loses a little horizontal sharpness (the copy is made even for colour-only effects); the Program monitor does not render effects on titles and shapes at all (export does), so monitor and export agreement for an overlay's own blur is not testable and only export is measured; the monitor's CSS blur and export's effects-engine blur differ in kernel by about 23% in spread even at square pixels (not PAR related). Field order and pixel aspect on footage are applied in preview, thumbnails and export.
- **Wall-clock performance budgets were not judged on an idle machine.** CPU and memory budgets pass. Measured seek p95 is about 16 ms, 4K scrub p95 about 90 to 100 ms and dropped frames under 1%, all on a loaded Apple M2 Pro. See `apps/desktop/PERF.md`.
- **Two-pass VBR** is desktop-only (ffmpeg), and unavailable for AV1, fixed-rate codecs and Rec.2020 projects.
- Windows and Linux builds ship, but performance and the native decode paths were qualified on macOS.

Superseded by later waves (the older text below is left for history):

- ProRes: projects reopened from storage now reopen with native decode, and rotation metadata is honoured (wave 14). The "Projects reopened from storage" and "rotation metadata is ignored" lines under ProRes no longer apply.
- Memory: the governor's decoder estimate was recalibrated (120 bytes per source pixel, about 249 MB for a 4K decoder, `DECODER_BYTES_PER_PIXEL`) and a hard 4K memory gate was added, so the "149 MB estimate" and "does not degrade it in time" lines are out of date. The 3.7 to 4.0 GB figure for two overlapping 4K layers from whole 10-minute sources was not re-measured.
- LUTs: the `.cube` parser now reads 1D and 3D tables with their domain and keeps float data, and LUTs carry through render and persistence.
- Export presets can be saved, imported and managed from the Export dialog.
- Effect keyframes are keyed by effect instance (`fx:<id>:<param>`) and older type-keyed keyframes are rewritten on load.

## ProRes

| | Desktop (Electron) | Web |
| --- | --- | --- |
| Playback / scrub | Direct native decode through the ffmpeg sidecar. No proxy needed. Scrub seek-to-correct-pixels p50 146 ms, p95 160 ms; IPC frame round trip about 7 ms. | Chromium cannot decode ProRes. The editor uses a proxy and explains why the original cannot be previewed. |
| Export | Exports match the source (PSNR 37 dB at the six frames checked, threshold 33 dB). | Re-encode only. |

Limits that remain:

- Projects reopened from storage: media reloaded from IndexedDB has no disk path, so native decode does not claim it. Relink or re-import the file.
- Constant frame rate is assumed; rotation metadata is ignored.
- Audio from a ProRes `.mov` through the native path is unverified.
- Sustained playback fps, 4K scrub latency and 4444-at-4K were not measured.
- The sidecar manifest ffmpeg builds (6.1.1 x64, 7.1 arm64) were not exercised; only Homebrew ffmpeg.

## Multicam speed and reverse

Shipped and verified in a real browser: multicam clips can be retimed (constant speed and reverse). Picture and audio stay locked.

- 2x speed: 6 claps, peak audio/picture error between -0.2 and 1.8 ms.
- Reverse: 5 claps, peak error up to 4.7 ms.
- A randomised test (400 sequences, about 9,580 samples) confirms audio and picture share time.

Limits that remain:

- Speed ramps and freeze frames on multicam clips are covered by unit tests only (no e2e or export check), and cuts inside a ramped or frozen multicam clip are refused.
- Neighbouring clips at different speeds do not merge their audio into one clip.
- There is no multi-clip ripple speed.
- The Canvas2D fallback variant was not verified. XMEML multiclip round trips retimed multicam cuts in unit tests; FCPXML `mc-clip` and OTIO (which flattens multicam) were not checked with retimed cuts, and none of it was opened in Premiere Pro, Resolve or Final Cut.
- Other multicam limits: see [multicam-editing.md](multicam-editing.md). The older line "angles must play at normal speed to be switched" is superseded by the above for constant speed and reverse.

## Smart render

Guarantees (desktop native path and browser planner, shared planning code):

- Untouched, grid-aligned spans are stream-copied; touched spans are re-encoded. A copy happens only when the frame-grid test proves it identical.
- If a source file is changed or truncated while being hashed or exported, export fails or re-encodes instead of copying stale data.
- Verified: a one-byte edit in the middle of a file is detected; a 45 s source with a 1.4 s start offset copied 93% (1587 ms vs 5576 ms full re-encode, 1290 frames identical to the source); a 90 s timeline copied 98% (1307 ms vs 9587 ms). Worst PSNR of the smart output vs a full re-encode was 46.4 dB.
- Anything with effects, grading, transforms, speed, transitions, text over it and so on is always re-rendered. See `apps/desktop/SMART_RENDER.md`.

Limits that remain:

- Hashing cost was measured warm (about 0.5 s/GiB Node, 0.7 s/GiB Chrome). Cold-disk cost is unmeasured and I/O bound. The first export of a large never-hashed file may wait for the remaining hash.
- The grid tolerance (0.02 frame, or 0.6 ms) is an engineering choice.
- The native Electron copy path was exercised through real-ffmpeg integration tests, not through the full Electron app. Only Homebrew ffmpeg 8.1.1 was tested, not the sidecar 7.1 and 6.1.1 builds.

## Memory

Status after w17: the import-time peak of long 4K sources is fixed (about 1.5 GB lower), a global memory governor now degrades the preview instead of letting caches and decoders grow, and a playback freeze that turned out to be a playback restart is fixed. The 5.6 to 6.6 GB renderer peak of the 110-minute soak was **not reproduced** (highest peak seen in any run: 4.7 GB total, with tracing overhead), and the layered 4K case with two overlapping 4K layers from 10-minute sources still peaks at 3.7 to 4.0 GB. Details and what is not done are below.

### Reproduction

`apps/web/e2e/soak/memory-4k-layered.spec.ts` (`pnpm --filter @openreel/web test:memory-gate`, `test:memory-gate:long`): three real 4K long-GOP cuts (H.264, HEVC, H.264; stream-copied from the soak sources, 10 s keyframes) on three video tracks, imported with 540p proxy creation. It scrubs at random, plays 40 s layered, toggles proxies on and off six times while playing, scrubs on proxies and originals, plays 30 s more, and forces the memory governor to critical and back. `SOAK_4K_SECONDS` sets the source length: 90 s (default, proxies) or 600 s (`test:memory-gate:long`, no proxies). `playback-4k-memory.spec.ts` (`SOAK_4K_FULL=1 SOAK_4K_LAYERED=1`) is the older shape: four distinct whole 10-minute sources back to back plus one overlapping layer.

Instrumentation (all opt-in, `apps/web/e2e/soak/soak-lib.ts`): process-tree RSS split by renderer, GPU and other every second; macOS `footprint` of the renderer; Chrome memory-infra dumps through CDP (`SOAK_4K_MEMINFRA=1`: partition_alloc, blink, v8, gpu, iosurface, shared images per process); page counters (open VideoFrames, ImageBitmaps, decoders, JS heap, `SOAK_4K_TIMELINE=1`); every `Blob.arrayBuffer()` call site with its bytes (`SOAK_4K_TRACE_AB=1`); console warnings and errors; playback lifecycle events; project changes while playing. `e2e/soak/probe-memory-signals.mjs` shows which page-visible memory signals see which allocations.

### Where the memory goes

| Where | What | Size |
|-------|------|------|
| Renderer, during import of three 10-minute 4K sources | `FFmpegFallback.probeAudioStreams` read each whole file with `Blob.arrayBuffer()` and wrote it into ffmpeg.wasm to count audio tracks: 1745 MB of ArrayBuffers (memory-infra: `partition_alloc/array_buffer` 1.33 GB at the import peak) for a number mediabunny had already read from the container index | 1.3 to 1.7 GB, transient; import-phase total RSS 2.5 to 2.9 GB |
| Renderer, steady | decoded whole-file audio (230 MB per 10-minute stereo source, counted in the JS heap and in `measureUserAgentSpecificMemory`, probe-memory-signals.mjs), JS heap 0.5 to 0.8 GB | 0.7 to 0.9 GB for three sources |
| Renderer, playback of 3 layers of 4K | not attributed by JS counters: VideoFrames out equal closed, open ImageBitmaps stay at about 32, JS heap flat. Native decoder and canvas memory | RSS 1.1 to 1.7 GB |
| Renderer, two overlapping 4K layers from whole 10-minute sources (the older four-source shape) | same, much larger: RSS rises from about 1.4 GB to 3.1 to 3.6 GB for roughly 10 s while both layers decode, then falls to 1.9 GB; `footprint` dirty 3.2 to 5 GB. The renderer's memory-infra dump is missing during the spike (the dump times out), so the breakdown inside the renderer is unknown | 3.7 to 4.0 GB total |
| GPU process | `gpu/angle/metal` 180 to 330 MB, `iosurface` 140 to 340 MB, `shared_images` up to 272 MB (32 MB mailboxes: full-size 4K textures). Mostly not in the GPU process's RSS (about 150 MB), so the RSS gate undercounts it | 0.2 to 0.6 GB |
| Other processes (browser, network, utility) | | 0.4 to 0.8 GB |

RSS counts clean file-backed pages of the mapped source files and compressed pages, `footprint` counts dirty memory only; they differ by a factor of two to three on the 90 s case (RSS peak 2.3 GB, `footprint` 0.6 GB). The gate uses RSS (conservative, what Activity Monitor shows). Runs on this machine vary by 0.5 to 0.8 GB with other jobs running.

### What changed

- Import: the ffmpeg.wasm audio-stream probe is skipped for files above 64 MB when mediabunny already counted the audio tracks (`shouldProbeAudioStreamsWithFfmpeg`); below 64 MB the second opinion is kept. Import-phase peak for three 10-minute sources: 2.5 to 2.9 GB to 1.40 to 1.42 GB.
- Audio decode (`decodeAudioBufferStreaming`) copies each decoded `AudioSample` straight into the output buffer and closes it, instead of allocating an AudioBuffer per packet for the garbage collector. Its effect on the peak could not be separated from noise.
- Memory governor (`packages/core/src/device/memory-governor.ts`, `useMemoryPolicy`): estimates renderer memory as max(`performance.memory`, `measureUserAgentSpecificMemory` every 20 s) plus the frame caches plus the open decoders (4K long-GOP decoder estimated at 12 NV12 frames, 149 MB), against a limit of 30 % of system RAM clamped to 1 to 3 GB (2.4 GB when the browser reports its 8 GB cap). Above 65 % of the limit: caches at 60 %, Program monitor resolution x0.75, two decoder elements. Above 90 %: caches at 30 %, resolution x0.5, one decoder element, no read-ahead audio decode. Hysteresis 50 % / 75 % on the way back. The caches follow through the shared media budget (`getMediaMemoryBudget` times the policy scale), so no cache knows about the governor. A "Memory high" or "Low memory: reduced preview" badge shows next to the proxy toggle; exports are not affected. Registered: decoded audio, scrub frames, bitmaps, VideoEngine frame cache, VideoEngine decoder elements, every MediaBunny layer decoder during multi-track playback.
- Playback no longer restarts when a waveform finishes (`playback-project.ts`, see below).
- Frame decodes during multi-track playback have a 4 s deadline (`decode-deadline.ts`): a decoder that stops answering costs its layer for a moment and is rebuilt, instead of blocking the loop. A watchdog (`playback-watchdog.ts`) restarts a frame loop whose frame has not ended after 5 s and records where it was waiting. Neither fired in any run after the fix below.

### Before and after (3 runs each, total browser RSS peak, MB)

| Case | Before (82fec2cd) | After |
|------|-------------------|-------|
| 3 x 10 min, 4K layered, no proxies | 3191, 2544, 2900 (median 2900); import phase 2913, 2527, 2900 | 2552, 2397, 2384 (median 2397); import phase 1414, 1416, 1404 |
| 3 x 90 s, 4K layered, proxies, toggling | 2258, 2382, 1967 (median 2258) | 2296, 2278, 2245 (median 2278): unchanged |
| 4 whole 10-minute sources back to back + 1 overlapping layer (`playback-4k-memory`, layered) | 3749, 3840, 3799 (median 3799) | 3755, 4027, 3903 (median 3903): unchanged within noise |
| Desktop `memory4k` (Electron, three 12 s 4K clips back to back, `apps/desktop/scripts/perf-harness.mjs --only memory4k`), peak total, idle before 1.22 GB | 1628, 1631, 1637 | 1642, 1670, 1613: unchanged (frames over 50 ms: 0 in all six runs) |

Scrub latency (p50 / p95, ms, median of 3 runs): 10-minute case, original 216 / 1150 before, 217 / 917 after; proxy 216 / 802 before, 233 / 967 after; 90 s case, original 382 / 801 before, 216 / 910 after, proxy 133 / 493 before, 82 / 483 after. The medians move by less than the run-to-run spread, so read them as no regression, not as an improvement. Playback of the 90 s case: 39.7 to 40.2 s advanced in 40 s before and after, 0.98 audio clock rate, longest playhead flat 750 ms; four-source case: frames over 50 ms 3, 3, 6 before and 3, 3, 4 after, 95th percentile frame 16.7 ms both. The goal of under 4 GB total on the layered long-GOP case is met for both layered cases with three layers (2.2 to 2.6 GB); it is not met on every run of the four-source overlap case (3.7 to 4.0 GB).

### Playback freeze

One layered playback in w16 advanced 16 s of 46 s. It reproduced here on the build without any w17 change (playhead stuck at 17.13 s for the remaining 28 s, no console message), and on 9 of 9 runs on pre-fix builds that had memory-infra tracing on (stuck at 23 to 26 s for 20 s; the one traced run that also forced garbage collections through the diagnostics did not), because tracing slows the renderer enough for the trigger to fire. Untraced it was rare: 1 of 17 pre-fix four-source runs (plus the w16 report). The playback events log shows the cause: the playback effect depends on `project`, and a waveform finishing in the background writes `waveformData` into the media library, a new project identity. Each write tore playback down (clock paused, decoders closed) and restarted it, once at about 7.6 s, 11.1 s, 24.6 s and 25.1 s of the run. Every restart cost a 0.7 to 1 s hitch (the "maxFlat 750 ms" at 7 to 9 s in every run since w16), and the one at 24.6 s took the single-clip native path, which never reached "started" (no `native-started` or `multi-start` event after `effect-start`), so the playhead stayed frozen. `useStablePlaybackProject` keeps the project identity while only `waveformData`, `thumbnailUrl` and `filmstripThumbnails` change (and `sameProjectForPlayback` replaces the two identity checks in the paused-frame commit and the compound audio preview). After it: 0 of 6 traced runs froze (advanced 45.3 to 45.6 s of 46 s) and the events log of each shows a single effect start, 0 of 6 untraced four-source runs and 0 of 8 gate runs. A hitch of 0.75 to 1.25 s at 7 to 9 s of the four-source case remains and is not explained (it is no longer a restart).

### Gate

`memory-4k-layered.spec.ts` fails when the total RSS peak is above 3072 MB (the highest measurement of the fixed build, 2552 MB, plus about 20 %; the target is 4 GB), when the import phase of 600 s sources is above 2048 MB (the unfixed build measured 2527 to 2913 MB, so it fails; the fixed build measures 1.4 GB), when the playhead is flat for 3 s or playback advances less than 90 % of wall time, or when forcing critical pressure does not shrink the Program canvas, show the badge, and recover. `playback-4k-memory.spec.ts` keeps its own gates (2560 MB for short cuts, 4608 MB for whole 10-minute layered). `scrub-smoke.spec.ts` checks that seeking repaints the monitor on the fixture and, with `SOAK_SMOKE_4K=1`, on a 4K cut (it caught a regression in the first version of the playback project change: the paused-frame commit compared project identities).

### Not done and limits

- The four-source shape (two simultaneous 4K layers decoded from whole 10-minute sources) still peaks at 3.7 to 4.0 GB, and the memory inside the renderer during that spike is not attributed: JS counters are balanced, memory-infra cannot dump the renderer while it spikes. The governor's decoder estimate (149 MB per 4K decoder) is far below what this case shows, so the governor does not degrade it in time.
- The 5.6 to 6.6 GB peak was not reproduced. The long soak (800 clips, 110 minutes) was not rerun.
- Whole-file decoded audio remains: 230 MB per 10 minutes of stereo per source. There is no windowed audio decode.
- Web proxy creation (ffmpeg.wasm, "Create proxies" ingest) still copies the whole source into WebAssembly memory.
- The governor does not turn proxies on by itself and does not limit decoders for fully occluded layers. Its numbers (30 % of RAM, thresholds, 12-frame decoder estimate) are engineering choices tuned on one 16 GB Mac. On desktop it sees the renderer only (no main or GPU process metrics). Not tried on 8 GB machines, Windows or Linux.
- A restart of playback mid-play (any real edit) can still hit the native-start hang that froze the soak; its location is recorded (events log) but the cause is not fixed. The 5 s watchdog only covers the multi-track frame loop.
- `VideoEngine.setMaxVideoElements` and the Preview wiring of the governor have no unit test; they are covered by the gate spec only.
- Desktop: the Electron `memory4k` row did not move (12 s clips, one 4K layer at a time): 1628, 1631, 1637 MB before and 1642, 1670, 1613 MB after. The overlapping-layers and 10-minute-source shapes were not run on desktop.

Hardware needed (unchanged): 8 GB RAM minimum for HD editing; 16 GB or more for 4K long-GOP. The 3 GB desktop budget (`perf-budgets.json`) is a regression guard on a light fixture.

## Basic Correction, Auto Tone and Match Color

Basic Correction (exposure, contrast, highlights, shadows, whites, blacks) is one 256-entry tone curve and the vignette is a radial multiply. Both run in the fused CPU grading stage (after the colour wheels, before curves, LUT and HSL), so the WebGL2 preview, the Canvas2D fallback and export use identical code; they are not in the WebGL2 wheels shader.

Limits that remain:

- On clips using the classic processing order (every clip graded before the Premiere-order pipeline existed), tone and vignette are 8-bit per channel and apply after the colour wheels. Switch such a clip to Premiere order (Color tab, Processing order) for Basic Correction first in float; see the next section.
- Shadows and Highlights have deliberately bounded reach (about 0.15 of full scale at the slider extremes, within the lower and upper halves of the range) to keep the curve monotonic.
- Auto Tone and Match Color measure the Program monitor frame: Match Color reads the reference with its grade and the target ungraded, and it replaces the wheels and the Contrast slider and adds saturation to every HSL band. Curves, LUT and keyframed values on the target are kept, so the result is closest when those are neutral. Overlapping video layers contaminate the measurement.
- The Match Color reference is a frame of another timeline clip (the playhead frame when it is over that clip, otherwise its middle). There is no click-to-pick on the timeline yet.
- Basic Correction keyframes are sampled per frame in the preview and export (unit-tested); the e2e specs do not exercise keyframed tone in an export.

## Essential Sound panel

Shipped and verified in a real browser (`apps/web/e2e/essential-sound.spec.ts`): tag a clip as Dialogue, Music, SFX or Ambience, then Auto-Match loudness (Dialogue -16 LUFS, Music -23, SFX -20, Ambience -28), clarity EQ, dialogue repair and ducking under tracks with the Dialogue role. Quiet and loud dialogue both measured -16.0 LUFS in the mixdown (editor meter and ffmpeg ebur128). Every preset is built from the existing clip effects, volume and volume automation, and one "Apply all presets" is one undo step.

Limits that remain:

- The SFX preset uses the lookahead Brickwall Limiter and the Ambience preset the Low-Pass Filter (see docs/pro-audio.md). 5.1 surround is supported (sequence layout, surround panner, six-channel AAC in MP4/MOV, 5.1 stems, BS.1770 surround loudness); its limits (stereo clip-level effects, stereo down-mix monitoring, six-channel Opus is not available; AC-3 / E-AC-3 delivery is covered in docs/PREMIERE-GAPS.md) are listed in docs/pro-audio.md.
- Auto-Match is limited by the +12 dB clip gain ceiling; a clip that needs more shows a warning and lands short of the target.
- Ducking is live: it follows the Dialogue clips when they move or trim (docs/pro-audio.md). It reacts to dialogue clip presence, not to speech level inside a clip. Ducks baked by earlier versions stay as keyframes until Duck is switched off and on.
- Matching is not repeated when you change the clarity or ducking options (it would re-measure every drag); press "Match again" if the effect chain changed the level.
- The panel only touches effects it added. If you edit one of them it is kept as yours and not overwritten; Clear Audio Type removes only the panel's own effects and restores the gain and volume lane it replaced, unless you edited those afterwards.

## Interchange (nests and multicam)

- XMEML multiclip layout (`multiclip > angle`, with an extra `offsetseconds`) follows Final Cut Pro 7 from memory and was not opened in Premiere Pro or DaVinci Resolve; unknown hosts still get the active-angle clips. Imported multiclip sources get sync method "manual" (the angle offsets are exact, but no audio-sync confidence exists).
- Importing a multiclip needs at least two angles with media; otherwise the cuts import as ordinary clips with a warning. Angle audio routing (a fixed audio angle) is not carried.
- FCPXML import keeps only the selected angle of an `mc-clip`; OTIO and EDL do not carry multicam at all (flattened to the active angle).
- OTIO writes every instance of a nest in full (OTIO has no shared definition); the importer re-shares them only when the `nestedSequence.id` metadata is present, i.e. for OpenReel-written files. Foreign OTIO stacks import as one nest per stack.
- Nests keep retime (speed, reverse), opacity and level; other clip effects on a nest clip are dropped on export and reported. Speed ramps / freeze frames on a nest clip are exported as the constant speed only.
- OTIO output was validated with the reference `opentimelineio` library (0.18.1) by `packages/core/scripts/validate-otio.py` on a developer machine; CI does not run it. FCPXML nests and multicam are DTD-validated; XMEML has no public schema and is checked by `validateXmeml` and `xmllint` only.

## Interchange (AAF)

- AAF export and import carry the edit only: tracks, clip source ranges, constant speed and reverse, video dissolves, constant clip and track levels, markers, edit rate and start timecode. Effects, colour, titles, transforms, opacity, nested sequences, audio retiming, fades, pan, keyframes and marker colours are not carried (the export report lists them per clip). Media is referenced by path and name and never embedded; imported AAF media is relinked by file name or becomes an offline placeholder, and embedded essence in a foreign AAF is not extracted.
- The files were checked with pyaaf2 (an independent AAF library) and read back by the importer; they were NOT opened in Avid Media Composer, Premiere Pro or DaVinci Resolve. The container, class and property layout follows pyaaf2's, which those hosts read, but host-specific behaviour (linked-media resolution from the ImportDescriptor, transitions at clip boundaries, stereo as two mono slots) is unverified. The pyaaf2 tests are skipped on machines without `pip install pyaaf2`.
- A dissolve borrows frames from both neighbours (AAF semantics). Without enough source handle it is shortened, or written as a cut, and reported.
- The AAF start timecode is written as 01:00:00:00 and is not stored on import (OpenReel sequences have no start timecode).

## Hue curves, Premiere-order colour pipeline, working colour space and HDR export

Shipped and verified in a real browser (`apps/web/e2e/color-pipeline.spec.ts`, `fallback-color-pipeline.spec.ts`, `hdr-export.spec.ts`; unit tests in `hue-curves.test.ts`, `lumetri-pipeline.test.ts`, `color-output.test.ts`).

- **Hue curves.** Hue vs Sat, Hue vs Hue, Hue vs Luma and Luma vs Sat in the Color tab (Hue Curves). A point at 0.5 is neutral; Hue vs Sat and Luma vs Sat scale saturation by 0 to 2, Hue vs Hue rotates up to 90 degrees, Hue vs Luma shifts lightness by up to 0.25. Each curve is baked to a 256-entry float LUT; the WebGL2 shader and the CPU reference read the same LUT and run the same arithmetic. In the e2e card (hue x saturation x lightness, all four curves plus wheels and Basic Correction) the GPU pass and the CPU reference differed by at most 0 levels on the test machine; the spec allows 3.
- **Processing order.** A clip's first grade now uses the Premiere-order pipeline (`pipelineVersion` 2): white balance, then Basic Correction, colour wheels and hue curves in one float pass, then Curves, LUT, HSL and Vignette. Clips that already carry a grade have no version and keep the classic order (wheels, then 8-bit tone/vignette/curves/LUT/HSL, then white balance) exactly as before; the Color tab shows the order and switches it with one undoable click. Hue curves do nothing on a classic clip (the editor says so and offers the switch).
- **ACES colour management (project setting, see docs/colour-management.md).**
  - **Which frames.** ACES mode renders through the float compositor. Frames with an active adjustment layer or text-behind-subject still take the classic display-referred path as a whole (the same rule as the Rec.2020 mode), so the look jumps while one is on screen. Clips that need the 8-bit path (masks, background removal, stabilisation, effects other than blur / sharpen / glow, 3D transforms, emphasis animations, interpolated slow motion, an Input LUT, compound clips, other transitions) are treated as already display-referred: their camera log / wide-gamut input transform is the display-referred one, and the result then goes through the sRGB IDT and the RRT, so they are not scene-referred ACES clips.
  - **Transforms.** ACES 1.3 RRT + ODT only: no ACES 2.0, no Reference Gamut Compression or other LMT, no D60 sim, and the only HDR targets are Rec.2020 PQ 1000 nit (15 nit mid) and the matching HLG; no P3 / Display P3 monitor transform, 2000 / 4000 nit or cinema targets. The sRGB / Rec.709 ODT renders sRGB code 255 (ACES scene 1.0) at display 0.812, which is how ACES behaves; 8-bit titles therefore look slightly grey until HDR graphics white is raised. The camera IDTs are the log decoders already in the product with matrices computed from the published primaries (Bradford adaptation to the ACES white), not the manufacturers' own IDT matrices; they agree with colour-science to 1e-6 but have not been compared with a camera vendor's IDT. HLG is a port without an independent oracle (BT.2100 anchors only); the PQ transform is within a relative 1e-3 of OCIO's builtin, not bit exact.
  - **Grade.** Sliders operate on ACEScct code values (mid grey 0.41, black 0.073), so they do not behave like the display-referred sliders: Basic Correction, wheels and curves are tuned for PQ / display values and are only a first approximation in ACEScct. An sRGB / linear LUT sees ACEScg light with the sRGB curve applied (not a display-referred picture), a "PQ" LUT sees PQ of the working linear.
  - **Preview cost.** The Program monitor renders every ACES frame through the engine (WebGL2 half float; the Float32 CPU reference at about 1 s per 1080p frame where WebGL2 float targets are missing), and the native video-element playback path is off in ACES mode. Playback frame rates in ACES mode were not measured; the float composite of the existing HDR mode costs about 14 ms per 1080p frame on an Apple GPU and the ACES output pass was not timed separately.
  - **Export.** An SDR export in ACES mode is the classic 8-bit encode of the output-transformed frame (tagged like any SDR export, nothing says ACES); HDR10 / HLG exports encode the PQ / HLG transform output. The HDR export path was verified at the encoded-signal level (CPU / GPU parity, unit values), not through a real 10-bit encode, and the desktop (Electron) path was not run.
  - **Scopes** measure the Program monitor, i.e. output-transform code values, not ACEScct. The Working color space setting is ignored while ACES is on.
  - **Input override.** Per footage item (Interpret footage) and per timeline clip (Color tab > Camera input > This clip only, undoable). On the web build the browser still converts tagged HDR / wide-gamut files before OpenReel sees them, so only an override changes how they are read there. The override is available to the user; ACES mode and the clip override are not exposed to the agent / MCP tools.
  - **OCIO** is import-and-map only (see docs/colour-management.md): no evaluation of an OCIO config's transforms, LUTs, looks or views, no `.ocioz`, and a space is matched by builtin style or well-known name only.
- **Working colour space.** Preview options, Working color space: Rec.709 (default; exports are byte-for-byte what they were) or Rec.2020 (undoable). With Rec.2020 the export converts sRGB-referred pixels to BT.2020 primaries, encodes them as BT.2020 non-constant-luminance YCbCr and tags the file (colr/nclx, verified with ffprobe on an H.264 export: `bt2020` primaries, `bt2020nc` matrix, `bt709` transfer).
- **HDR export.** Export dialog, Custom Settings, Color / HDR: HDR10 (PQ) or HLG, 10-bit H.265 (Main10) in MP4/MOV, BT.2020 primaries, tagged in the container and in the frames handed to the encoder.

Limits that remain:

- **The HDR file path was not encoded end to end in this environment.** The test Chrome has no 10-bit HEVC encoder, so the 10-bit PQ/HLG export is covered by unit tests of the conversion and tagging only, and the e2e verifies the disabled state. The option is enabled only when `VideoEncoder.isConfigSupported` accepts HEVC Main10, and the export fails with a clear message if the browser then refuses the real configuration. A HEVC bitstream's own VUI colour fields are whatever the browser encoder writes; the container tag is set by us.
- **HDR is disabled with the reason shown** on the desktop (ffmpeg) export path, in browsers without a 10-bit HEVC encoder, and for WebM/VP9/AV1/H.264/ProRes. Smart render is bypassed when Rec.2020 or HDR output is on, because stream-copied packets would carry the source's colour.
- **Source colour management (browser path).** Browsers decode wide-gamut and HDR sources to SDR before the canvas sees them, so on the web build HDR footage still enters as SDR (the float path then grades and encodes it, but there are no highlights above SDR white to keep). The desktop native decode path (ProRes, DNxHD, MXF...) hands over raw code values and, in HDR working mode, 16-bit ones. See docs/colour-management.md, Scene-referred HDR working mode. The preview is not gamut-mapped to the display.
- 8-bit sources (everything the browser decodes, stills, titles) have 8-bit precision inside a 10-bit file; smooth gradients can band. Natively decoded footage on desktop has 16-bit precision.
- "GPU" for grading means the WebGL2 grading engine (there is no WebGPU grading shader in the codebase). The Canvas2D fallback project runs the same WebGL2 pass where WebGL2 exists and the CPU float reference otherwise; a run with no WebGL2 at all was not available to compare.
- Hue curves, the pipeline switch and Rec.2020 are not exposed to the agent/MCP tools. Hue curves are keyframable (see docs/colour-management.md). The Lumetri vignette moves to after HSL on Premiere-order clips (it stays where it was on classic ones).
- Basic Correction in float applies the 256-entry tone curve with linear interpolation (the classic path indexed it by 8-bit level), so a Premiere-order clip differs from the same sliders on a classic clip by at most about one level plus the order change.

## Source colour management and desktop 10-bit HDR export

See docs/colour-management.md for the design. Limits:

- Scene-referred HDR working mode (Rec.2020 working space or an HDR export) composes and grades video / image clips in half float. In float since wave 18: the whole Lumetri grade including the LUT (in its declared space), the HSL bands and the vignette; the blur, sharpen and glow effects; crossfade, dip to black and dip to white transitions. Still on the 8-bit canvas (they enter the float image at graphics white and highlights above SDR white of such a clip are tone-mapped as before): any other effect (vignette effect, HSL Secondary effect, chroma key, pro effects...), masks, background removal, stabilisation, border radius / 3D transforms, emphasis animations, frame-interpolated slow motion, every other transition (wipe, slide, zoom...) and a crossfade / dip where either clip is not float-eligible, compound clips, and text, shapes, stickers, motion graphics and subtitles (graphics, composited at the project's HDR graphics white, 203 nit by default). A frame with active adjustment layers or text-behind-subject renders on the classic 8-bit path as a whole.
- The float effects follow the 8-bit ones in intent, not pixel for pixel: blur is a Gaussian of sigma = radius (capped at a 64-tap half kernel) where the 8-bit shader path is a box blur limited to radius 10; glow is an additive screen above SDR white; sharpen works on the PQ encoding. A float crossfade is an exact linear mix with alpha 1 and honours the clips' transforms, which the 8-bit transition engine does not.
- LUTs carry no colour-space tag in their .cube / .3dl files: the LUT colour space is a per-LUT choice (default Display sRGB) and only HDR projects read it. A LUT authored for Rec.709 gamma 2.4 or a log camera space is approximated by the sRGB choice.
- HDR graphics white is a project-wide value for all 8-bit graphics; there is no per-title override, and the SDR preview (tone-mapped view) of a raised graphics white rolls off like any other highlight.
- In HDR working mode every graded clip uses the Premiere processing order, regardless of its `pipelineVersion`; exposure is a linear gain and the other Basic Correction sliders, wheels, hue curves and Curves act on a PQ encoding of the image, so their feel differs slightly from the same numbers in an SDR project.
- The SDR monitor view and SDR exports of a Rec.2020 project put SDR white at about 97 % (code ~247) to leave headroom for the highlight shoulder. The preview does not use a display's own HDR (canvas `toneMapping: "extended"` / HDR canvas) even where it exists; it always shows the tone-mapped SDR view.
- The web (WebCodecs) build can write HDR10 / HLG when the browser has a 10-bit HEVC encoder (not available in the test Chrome, so that file path has unit and GPU-parity coverage only); its sources arrive SDR, as above.
- A preview render-cache frame is never used for an HDR export (it holds only the tone-mapped 8-bit view); upscaling replaces the frame, so an HDR export with AI upscaling on falls back to the 8-bit conversion.
- Mastering display metadata is fixed (BT.2020 primaries, D65, 1000/0.0001 nit range). MaxCLL / MaxFALL are now measured from the rendered frames of a PQ export and returned in the export stats and shown in the finish notice, but the HEVC stream still declares 1000,400 (libx265 needs the values before the first frame; no second pass or SEI rewrite exists). HLG exports are not measured.
- The resampler is bilinear in linear light; a large downscale of a layer can alias more than Canvas2D's "high" quality smoothing.
- The 16-bit native decode is only used for clips on the float path; its frame cache entries are 8 bytes a pixel (a 4K frame is 66 MB), so the cache holds half as many frames as the 8-bit path.
- Hue-curve keyframes animate each control point's output value (y); the point positions (x) are fixed while a point is animated.
- The Electron e2e `apps/desktop/test/hdr-export-electron.test.ts` (`pnpm --filter @openreel/desktop test:hdr-e2e`, needs a `VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build` and ffmpeg/ffprobe) was run for this change and passed, including the PQ highlight check.

## Camera RAW

DNG stills and CinemaDNG sequences import on web and desktop with RAW Source Settings (white balance, exposure, highlight recovery, demosaic quality, output colour space). Details and the format matrix are in `docs/raw.md`.

Limits that remain:

- **Proprietary RAW is not decoded by OpenReel.** CR2/CR3, NEF, ARW, RAF, ORF, RW2, PEF and the other vendor stills import only on the desktop app for macOS, through Apple ImageIO (`sips`): Apple chooses white balance and tone and the RAW Source Settings controls are unavailable for those items. On the web and on Windows/Linux they are refused with "convert to DNG". No LibRaw/dcraw WASM build is bundled.
- **BRAW, R3D and ARRIRAW are not supported** (proprietary vendor SDKs). Export DNG sequences or ProRes from the vendor tool.
- **The decoder was verified on synthetic DNGs only.** No real camera DNG was available, so camera-specific behaviour (maker profiles, lens opcodes, unusual tag combinations) is untested. The macOS ImageIO path was verified through the real `sips` handler with a plain image, never with a real camera file (ImageIO rejects the synthetic DNGs).
- **DNG features not supported**: lossy and deflate compression, floating-point data, X-Trans / non-2x2 / four-colour sensors, opcode lists (lens correction), noise profiles, profile tone curves and LookTables. These files are refused or developed without those corrections. There is no Adobe-style baseline tone curve: the look is linear plus an sRGB curve, so it is flatter than Lightroom / Camera Raw on the same file.
- **Output is 8-bit.** The developed image is an 8-bit sRGB-encoded bitmap with a highlight shoulder. The scene-linear Float32 result (`developRawLinear`) exists but is not yet fed into the Rec.2020 / HDR working mode, so RAW highlights above the shoulder do not reach HDR exports as true HDR.
- **CinemaDNG sequences are baked, not live.** The frames are developed once at import (as-shot settings, sRGB, up to 3840 px, H.264) and the DNG frames are not kept, so the settings cannot be edited afterwards; re-import to change them. Web needs a browser that can encode H.264 with WebCodecs. Audio files that ship beside the frames are not imported. Frames must be numbered with three or more digits in the same folder pick.
- **Images above 6144 px on the long edge are downscaled** (integer box filter) in preview and export alike.
- **Demosaic is bilinear or Malvar-He-Cutler**, not AHD or an algorithm tuned per sensor; fine detail and false-colour behaviour on very sharp lenses is below the best RAW converters. Noise reduction and sharpening are not applied.
- **Crop mode** on a RAW still shows the 320 px library thumbnail behind the crop handles, not the full-resolution development.
- **Not run:** the Playwright spec `apps/web/e2e/raw-import.spec.ts` was written but never executed (the heavy-run lock could not be acquired), so the browser flow (dialog, one undo step, preview vs export renderer, CinemaDNG bake) is unverified end to end.

## Linked compositions

Live linked compositions (see [linked-compositions.md](linked-compositions.md)) are verified by unit tests (core, web store, desktop relay). Limits that remain:

- A composition is a graphics document. Only text, shape and SVG clips (or an existing graphic) can be replaced with one; video, image and audio clips cannot. Use Nest for those. Motion compositions (`motionCompositions`) are not linkable: this build has no editor for them.
- Only number controls for opacity, rotation and X/Y position can be keyframed. Text, colour, font size, width/height and the combined Position control cannot.
- The composition window edits layers and controls; it has no timeline of its own, and its preview is a still of the hold pose, not playback.
- Edits from a composition window and from the editor at the same time are not merged: the window's edit on an outdated revision is refused and the window shows the current version.
- Render and Replace in the browser renders opaque H.264 (no transparency); only the desktop app renders ProRes 4444 with alpha. A rendered composition is not re-rendered automatically when the master changes; it is marked out of date.
- XML, FCPXML, EDL, OTIO and AAF carry no graphics. A rendered composition exports as its media clip; a live one is dropped with a warning (it is not rendered for you on export).
- The desktop two-window flow is covered by hub/IPC unit tests; a real two-window Electron run and the browser end-to-end spec were not run in the same environment unless noted in the wave report.
- Deleting a rendered clip from the timeline leaves its composition record behind, unused; the live layers cannot be restored from it. Use Restore Unrendered (or undo) instead of deleting the rendered clip.
- Portable edits (`createPortableEdit`) refuse projects with linked compositions, like other graphics.

## Real-time collaboration

See docs/collaboration.md for the design and security model. Limits:

- **Media is not synced.** Peers get placeholders (name, size, modified time) and relink their own files. Importing media on one machine is not an action: the file stays local, and collaborators see the item only when it is used by a shared edit. Media-import actions are reported as "not shared".
- **Conflicts are rejected, not merged.** Concurrent edits to the same clip, the same track (any clip on it), the same media item or the bin tree: the second op in is rejected and rolled back with a notice; project-wide replacements (frame-size change with graphics scaling, `project/applyEditSnapshot`) conflict with everything concurrent. There is no text/property merging inside one clip.
- **Grouped edits are not atomic across the wire.** A multi-step edit (one undo group) is sent as separate ops; if one is rejected the others stay.
- **Offline edits older than the room's retained history (about the last 500 ops) are rejected as stale**, and the local copy is replaced by the shared project. Offline work is not saved as a separate copy.
- **Edits that bypass the action system are local.** Switching the active sequence, creating sequences, and any store-only changes (UI layout, track targeting, playback) do not sync. Playheads and selections are shown as presence only.
- **Locks are soft** (anyone can take over; they expire after two idle minutes) and cover bins and the active sequence only, not tracks or single clips. There is no lock control inside the project panel yet; use the Collaborate dialog.
- **Security.** The server does not validate actions or the conflict keys an author declares; editors are trusted. Room access is a bearer link (anyone holding it joins); there are no per-user accounts, revocation, or audit trail, and a link cannot be revoked short of abandoning the room. Cloud identities are still the dev shim.
- **Text, shape, graphics and other overlay clips** sync through their actions but the title/graphics engines are re-synced from the project only after each remote batch; rapid concurrent overlay edits were covered by unit tests only, not an end-to-end run.
- The Durable Object itself was exercised through a fake `DurableObjectState`/socket harness (the real `RoomCore` and storage layout), not a live `wrangler dev`/miniflare instance, and nothing was deployed.

## Audio Channels

- Waveforms for a mapped clip are recomputed by decoding the whole file; media over 200 MB keeps the unmapped waveform (playback and export still follow the map).
- Edits to a channel map made during playback take effect when playback restarts, like other audio edits.
- Channel maps are verified end to end for WAV and for AAC video sources; exotic codecs that the browser cannot decode natively go through the ffmpeg fallback, which keeps up to six source channels only when a clip is mapped to a channel beyond L/R or to 5.1.

## Speaker detection (captions)

Detect speakers runs entirely on this device and uses a small voice-print (MFCC statistics plus pitch) with clustering, not a trained speaker-recognition model. No such model is bundled, and nothing is downloaded or sent off the machine.

- **Accuracy on real voices is limited.** It separates clearly different voices (for example a low and a high voice) well, but similar voices can be merged into one speaker and one voice can be split into two. In a test with three synthetic voices reading different sentences, Auto and a fixed count both got only some of the passages right. Treat the result as a first pass and check the labels.
- **Overlapping speech is not separated.** A caption passage is assigned to a single speaker.
- **Fixing the speaker count helps only when you know it.** Auto picks the count from the clearest gap between voices and can be wrong; the speaker-count menu overrides it.
- **Re-running detection replaces the labels,** including passages you reassigned by hand. Renames, colours and positions of speakers that are still found are kept.
- **Clearing a passage's speaker restores the caption look it had before it was labelled,** which discards style edits made to that caption in between.
- **Clips with no audio track** cannot be labelled; Detect speakers says so.
- The only real-voice evidence is a short fixture of two synthetic text-to-speech voices; no recorded human interviews are in the test suite.

## Caption translation

- **Machine translation quality is the engine's.** Translation uses the connected AI model or the browser's on-device Translator API (Chrome 138+, language packs may download). Neither was verified against a live provider in automated tests (mocked clients and a Translator test double); with neither available the Translate tool says so and adds nothing.
- **Translated cues drop word timings**, so karaoke-style word animations fall back to whole-cue display. Cue timing, style and speakers are preserved.
- **A translation is kept out of the picture by default** (its cues are hidden) so two languages never overlap. Choose which track is shown with "Show this track in the picture"; showing one track hides the others. Sidecar and embedded caption files still include every track.
- The browser engine translates one cue per call, so long tracks take a while.

## Ultra Key

- **The Effects-tab card key is a heuristic, labelled "Sample key".** The card previews the effect on your own footage by guessing a key colour from that frame, then narrowing tolerance and transparency until at most about 40% of the frame is keyed. On non-green footage (for example an interview shot) it shows a representative checkerboard-keyed sample, not a prediction of the result. Pick the real key colour with the eyedropper in the Inspector, which samples the Program monitor.
- **Preview/export parity was verified on WebGL2 in headless Chromium** (shader versus the CPU reference used by the Canvas2D fallback and export: 0 pixels off in RGB and alpha on the test frames). It has not been exercised on real WebGPU hardware or in the Electron desktop app.

## Background-task panel

The panel (status bar pill and popover) is a presentation layer over `BackgroundTaskRegistry`; it owns no work. Limits, stated in the panel itself where they affect the user:

- **Pause is per export-queue only.** Pause and Resume exist only for export-queue jobs, and they act on the whole queue (a queued row reads "Export queue is paused" and Resume starts the whole queue). A running export, proxy job, transcription, import, scene detection, beat detection or tracking run cannot be paused; those can be cancelled. The panel footer says so.
- **Import Cancel discards, it does not stop the decode.** The decode keeps running in the background and its result is thrown away. Retry re-runs the full import action; caller-specific follow-ups (for example placing the clip on the timeline) are not replayed.
- **Cleared rows stay cleared for the session**, including mirrored export-queue rows. A retried job shows again. Finished history (40 rows) is not persisted across reloads.
- **Proxy history is session-only.** A proxy that finished or was cancelled shows as such until cleared; proxies that were already ready when the editor loaded are not listed.
- **Not exercised on real footage or hardware:** scene detection, beat detection, transcription, motion tracking, desktop copy-to-project and the desktop native proxy rows, and import cancel on large media. They are covered by typecheck, registry unit tests and synthetic e2e only.
- The popover opens upward over the timeline; it has no pin or dock mode.

## Keyframe temporal interpolation

- **Numeric properties only.** Auto Bezier and Continuous Bezier need a numeric value to compute a tangent; keys on non-numeric properties (colour strings, text) ignore those two types and keep their normal easing.
- **Hold belongs to a whole segment.** Hold is an outgoing type by definition (the value is held until the next key), so choosing Hold with "Both sides" applies it to the outgoing side only. Choosing Linear, Bezier or an Auto type on the In side of the key that follows a held segment converts that segment, because both ends share it. Ease In is always the In side and Ease Out always the Out side; the side menu is ignored for them.
- **Continuous Bezier always links both sides.** Applying it to one side links both. Editing a single handle keeps the link and mirrors the other side's tangent; replacing a whole segment (an ease preset, an easing change) unlinks it.
- **Handle time influence is preserved, not chosen.** Auto and Continuous re-derive the tangent (slope) and keep each handle's existing time length (one third for fresh Auto handles). There is no separate control for influence beyond dragging a handle, which converts an Auto side to plain Bezier.
- **The agent tool registry (`packages/agent`) does not expose the new types yet.** Agents can set easing and Bezier handles as before.

## Encoder choice and proxy presets

- **The browser capability probe asks WebCodecs about one representative profile per codec** (H.264 High L4.0, HEVC Main, AV1 Main, 5 Mbps) at the export size and frame rate. A machine can accept that and still refuse the project's exact bitrate or profile; the export then fails with the encoder's own message (Hardware and Software are strict, they never switch kind silently). Auto is the only choice that falls back.
- **Hardware encoding on the desktop is not offered with Two-pass VBR or Rec.2020 / HDR output** (hardware encoders have no two-pass mode; HDR needs libx265 for the HDR metadata). Choosing Hardware there is refused with the reason; Software and Auto work. A failed hardware encode with Hardware chosen is reported, not retried on the software encoder.
- **Hardware encoders (VideoToolbox, NVENC, Quick Sync, AMF) were exercised end to end only on VideoToolbox (macOS).** NVENC, Quick Sync and AMF are covered by argument and capability-mapping tests, not by a run on that hardware.
- **Create Proxies with a preset only targets clips that have no proxy (or a failed or missing one).** To rebuild an existing proxy in another preset, use Rebuild on the row after changing the preset in the Proxies panel.

## Premiere projects (.prproj)

- Import only, and read from hand-authored fixtures: a project saved by Adobe Premiere Pro has not been tested. Treat the import report as the source of truth for what arrived.
- One sequence per import (pick it in the dialog). Other sequences, master-clip markers, Lumetri and other effects, time-remap ramps, keyframed motion/opacity/volume, titles and graphics, captions, adjustment layers, track mixer settings and Productions are not carried and are reported.
- A disabled clip is imported fully transparent and muted (there is no clip enable switch); Premiere sizes media from native pixels while OpenReel fits the frame first, so scaled or moved clips can frame differently.

## Dolby Digital (AC-3) and Digital Plus (E-AC-3)

- AC-3 / E-AC-3 inside MP4, MOV and MKV is desktop only (the native ffmpeg sidecar). The browser writes raw `.ac3` / `.ec3` audio-only files through ffmpeg.wasm and refuses AC-3 video-file tracks with a desktop-only message.
- Stereo and 5.1 only. Dialnorm is the only Dolby metadata written; no DRC profiles, no Dolby Atmos (E-AC-3 JOC) and no 7.1.
- The sample rate is 44.1 or 48 kHz (anything else is written at 48 kHz).
- The browser path is tested at the unit level and by confirming the bundled core lists the encoders and muxers; the ffprobe and per-channel level checks run against the desktop sidecar only.

## Spectral editing

- **Rectangle and frequency-band selection only.** No lasso, brush or magic-wand selection, and no harmonic (overtone-following) selection. A band marquee always covers the whole source.
- **Source-time regions.** Regions live in the clip's source time, so trimming the clip does not move them; a region outside the clip's in/out range stays stored but is inaudible. Behaviour under speed changes was not tested.
- **Remove is interpolation, not resynthesis.** It fills the region from the bins above and below (and the frames around it) with a short cross-fade; it clears steady tones, hum and short clicks cleanly, but broadband or fast-moving sounds inside the box leave audible artefacts. Attenuation is exact only for steady content; the tested tolerance is a tone attenuated by N dB within 0.1 dB.
- **Preview and export play the same repaired samples** (one shared cached repair job, applied before every other clip effect, verified at -92 dB residual in the e2e). The first repair of a clip renders before it can play, in a worker, and the cost grows with clip length (not benchmarked); very long sources (over 400 MB of media) are refused by the editor.
- **No agent/MCP tool.** `packages/agent` does not expose spectral regions, so `docs/AGENT-CAPABILITIES.md` is unchanged (it is generated from the tool registry).
- **The desktop app was not given its own spectral e2e**; the feature runs from the shared web bundle and was exercised end to end in the web e2e only.

## Watch folders (desktop)

- **Desktop only.** The web app has no folder access, so there is no web equivalent.
- **Polling, not OS events.** Folders are rescanned every 5 s and candidate files are re-checked every 0.7 s; a file must keep the same size and modified time for 2.5 s before it is touched. A copy that stalls for longer than that (a slow network or card reader) can be picked up while still incomplete. Network shares are scanned the same way and were not tested.
- **Ingest needs an open project and an editor window.** With none, files wait (shown as waiting in the panel) and import once a project is open. Imports go through the editor one file at a time, and the import tool's limits apply (files over 1 GiB are skipped and shown as failed).
- **Existing files are not processed** when a folder is added (they are recorded and skipped) and there is no switch for it in the UI (only the saved `processExisting` setting in `watch-folders.json` turns it on).
- **Media export is a re-encode by the bundled ffmpeg**, not the editor's renderer: it applies the preset's size, frame rate and bitrate to the source file (letterboxed to fit) and is not a render of a timeline. Colour management, HDR, LUTs and effects are not applied. Audio-only (WAV) cannot render a project.
- **Project export uses the editor window.** Dropping a project file opens it in the editor (the open project is saved first and is replaced in the editor) and renders it through the export queue, so it is not a background render and it interrupts whatever is open. The project's footage must be reachable: the editor reconnects remembered paths, then searches the folders the project recorded and the folder the project file sits in; media that cannot be found fails the item with the editor's "Relink the original media" message. Only the video presets apply to projects.
- **Duplicates** are detected by content (size plus a hash of the first and last 256 KiB), not by name, so a renamed copy is caught but a file that differs only in its middle is not. The ledger keeps 5,000 entries per folder, so a very old duplicate may be processed again.
- **Verified** with synthetic clips on macOS (arm64) only. Not exercised: Windows and Linux, network drives, long camera-card ingests, 4K render timing.
