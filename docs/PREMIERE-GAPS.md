# OpenReel vs Premiere Pro: Release Gap Report


> Status at desktop 1.0.0. Sections 1 to 5 below are the pre-release audit, kept as written for the record. This section says what happened to each item. "Closed" means the fix is in the 1.0.0 tree and covered by a test or measurement named in `docs/releases/v1.0.0.md`. It does not mean the behaviour was checked in Premiere or on every platform.

## 0. Status at 1.0.0

### Must-fix list (section 2)

| # | Item | Status |
|---|------|--------|
| 1 | Adjustment layers ignore stacking and affectedTracks | Closed. They affect only tracks below and honour `affectedTracks`; preview and export agree (`adjustment-layer-engine.test.ts`). |
| 2 | Speed changes always shift pitch | Closed. Maintain Pitch dispatches an undoable speed change and stretches off the main thread (`stretch-cache.test.ts`, `SpeedRampSection.pitch.test.tsx`). |
| 3 | Clip pan automation never rendered | Closed. Clip and track pan and volume automation render in preview and export (`TrackAutomationLanes.test.tsx`). |
| 4 | Q/W is not ripple trim | Closed. Ripple-trims to the playhead, respects targeting and locks, honours speed (`ripple-trim-playhead.test.ts`). |
| 5 | Timeline drag has no overwrite or insert | Closed. Drops resolve overlaps and failed drops revert (`clip-drop.test.ts`). |
| 6 | No perf gates for scrub, playback, import | Closed. Budgets and a dropped-frame indicator exist (`apps/desktop/scripts/perf-budgets.json`). |
| 7 | Wall-clock gate never passed on an idle machine | **Open.** CPU and memory budgets pass; wall-clock budgets were not judged because the machine was loaded. Run `perf:budget -- --require-wall` on a quiet machine. |
| 8 | 4K layered memory and governor estimate | Partly closed. Decoder cost was recalibrated, there is a hard 4K memory gate, and large audio streams instead of decoding whole. The worst case (two overlapping 4K layers from whole 10-minute sources) was last measured at 3.7 to 4.0 GB. |
| 9 | LUT parser mis-loads LUTs | Closed. Pure float `.cube` parser with 1D/3D, domain and strict validation (`cube-lut.test.ts`). |
| 10 | Export presets cannot be saved from the UI | Closed. Presets can be saved, imported, deleted and managed (`ExportPresetManager.test.tsx`). |
| 11 | Interchange never opened in a real host | **Open.** The UI and docs label it unverified. Files were checked with independent libraries only. |
| 12 | Fonts not embedded or reported | Closed for TTF/OTF/WOFF/WOFF2: missing-font report on open and licence-aware embedding (`missing-fonts.test.ts`, `font-embedding.test.ts`). WOFF2 is read via `DecompressionStream("brotli")` or, in the desktop app, the main-process Node zlib bridge (`fonts:brotliDecompress`), or else the bundled `brotli-dec-wasm` decoder (lazy chunk), so every browser can embed it. |
| 13 | `path` shape draws nothing | Closed. Path shapes render from SVG path data or point lists (`shape-path.test.ts`). |

### `.prproj` import

**Partly closed.** File > Import timeline > Premiere project (.prproj)..., or dropping a `.prproj` on the Project panel, reads a gzip Premiere project (`packages/core/src/interchange/prproj.ts`). It reads: the object graph (ObjectID/ObjectRef, ObjectUID/ObjectURef), bins and master clips (bins are recreated for offline media), the sequences with frame rate and resolution (a picker chooses which one to import; the others are listed in the report), video and audio tracks, clip items with in/out/start/end in ticks (254016000000 per second, BigInt exact), enabled/disabled (imported transparent and muted: OpenReel has no clip enable switch), constant speed and reverse, track targeting, locks and mute, Motion position/scale/rotation, Opacity and Volume level (start value), sequence markers (range markers and chapter type), cross dissolve and dip to black/white, and nested sequences (as OpenReel nested sequences). Linked audio of a video clip is merged into that video clip, like the XMEML importer. Media is relinked to the bin by file name; the rest becomes offline placeholders for the existing relink flow. The commit is one `project/applyEditSnapshot` (one undo step, bins and nested sequences included).

Everything it cannot place goes in an import report shown before the import (dropped / approximated per clip), not silently: other effects (Lumetri and every effect besides Motion/Opacity/Volume), time-remap ramps, keyframed Motion/Opacity/Volume (start value used), anchor point, blend modes, non-uniform scale, other transitions and audio crossfades, titles/captions/graphics, adjustment layers and mattes. Master-clip markers, track mixer settings and Productions are not read.

**Not verified against Premiere.** No `.prproj` written by Adobe Premiere Pro was available. The element names and layout follow Premiere's saved-project structure as it is publicly documented and remembered (`docs/interchange.md` lists the walk), the reader looks names up tolerantly, and the tests use hand-authored gzip fixtures that follow that layout. Speed/reverse, disabled, targeting and the Motion position units (normalised 0..1 vs pixels is guessed from the value range) are the least certain parts. Real projects may use element spellings that are not read yet; those clips would show up in the report or import without that property. Tested by `prproj.test.ts` (tick math, graph, report, undo) and `e2e/interchange-prproj.spec.ts`.

### Work packages (section 3)

- **WP1 Trim and edit points:** closed. Dynamic JKL trim previews the trimmed result live on the Program monitor, with a two-up (outgoing | incoming) view at a cut. Edit-point selection, `,`/`.` trim, numeric trim, ripple/roll toggle, gap select/delete, Go to In/Out and Mark Clip are in (`edit-point-commands.test.ts`, `dynamic-trim.test.ts`, `e2e/trim-tools.spec.ts`).
- **WP2 Effects and keyframes:** closed. Instance-keyed keyframes with migration on load, a stopwatch per parameter, mask combine modes and effect presets (`effect-instance-keyframes.test.ts`, `mask-engine.combine.test.ts`, `effect-presets.test.ts`).
- **WP3 Audio depth:** audible scrubbing, automation lanes, solo-safe and the output-device picker are closed (`track-audibility.test.ts`, `audio-output-device.test.ts`, `e2e/audio-output-solo-safe.spec.ts`). Voice-over record upgrade is closed (pre-roll countdown with playback, remembered input select, live meter, target track, punch in/out, mute-during-record, stacked named takes, desktop microphone permissions; `voiceover-logic.test.ts`, `e2e/voiceover.spec.ts`). Source-channel mapping (Clip > Audio Channels) is closed.
- **Spectral editing (partly closed):** Audio tab > Spectral editing shows an STFT spectrogram of the clip's source (log frequency axis, colour maps, time zoom and pan, computed in a worker). Rectangle selection and a frequency-band marquee (whole source) can be attenuated by N dB or removed (filled by interpolating from the surrounding frames). Edits are a "spectralRepair" clip audio effect holding source-time regions: one undo step per edit, applied before every other clip effect in both the realtime preview and the export through one shared cached repair job. Covered by `spectral-dsp.test.ts` (STFT/ISTFT reconstruction, tone removal, N dB attenuation), `spectral-repair-cache.test.ts`, `realtime-audio-graph.spectral.test.ts`, `audio-engine.render-integration.test.ts` and `e2e/spectral-editing.spec.ts`. Not done: lasso and brush selection, per-region undo within the editor panel beyond Remove, spectral healing for non-stationary content, and the agent/MCP tools (see `known-limitations.md`).
- **WP4 Colour fidelity:** closed for the LUT parser, 1D LUTs, LUT library, `.cube` export, Input LUT, scope modes, false colour, nit scale and saved looks. White-balance eyedropper is closed (Program-monitor sampling, point / 5x5, one undo step; `white-balance-eyedropper.test.ts`). Camera-log presets (Sony, Panasonic, ARRI, Canon, Nikon, Fujifilm, Blackmagic; formula based, Interpret Footage and Color tab picker) are in. **ACES is in** (project setting Preview options > Color management: Display-referred or ACES; analytic ACES 1.3 IDTs into ACEScg, ACEScct grading, RRT + ODT to sRGB, Rec.709 BT.1886, Rec.2020 PQ 1000 nit and HLG; GPU and CPU paths; per-footage and per-clip input override; undoable and saved with the project; unit tests against OpenColorIO's ACES 1.3 builtins in `aces.test.ts` and an e2e in `aces-color.spec.ts`, see docs/colour-management.md). **OCIO is partial:** an `.ocio` config's colour spaces are parsed and the ones that equal a built-in preset can be applied in Interpret Footage, the rest are reported as unsupported; OpenReel does not run an OCIO config's own transforms, LUTs, looks or views. **Still open:** ACES 2.0, gamut compression and LMTs, Display P3 and 2000/4000 nit output transforms, a full OCIO runtime.
- **WP5 Media and delivery:** closed for preset management, image-sequence and GIF export, EDL import with reel relink, Interpret Footage, and two-pass and target/max rate control. Interchange verification stays open (item 11).
- **WP6 Text, captions, graphics:** closed for on-canvas text editing, caption style model with VTT cue settings, saved styles, roll and crawl, the `path` shape and the missing-font report. **Open:** speaker diarization and translation.

### Later list (section 4)

Done since the audit: `.prproj` import (read-only, see below), multicam editable sources and retime, range markers, effect plugin hosting through the OpenReel plugin SDK (not VST3/AU), DNG and CinemaDNG RAW, 5.1 surround, spectral editing (rectangle and band repair), Dolby Digital (AC-3) and Digital Plus (E-AC-3) delivery (stereo and 5.1; see below), MXF/ProRes/DNxHR ingest and delivery, desktop HDR10/HLG export. Everything else on that list remains open, including VST3/AU, Dolby Atmos, BRAW/R3D/ARRIRAW, Dynamic Link, `.mogrt`, a full OCIO runtime (ACES 1.3 and partial OCIO config import are done, see WP4), Dolby Vision, and Windows and Linux perf qualification. Desktop watch folders (ingest and render) are done.

## 1. Verdict

OpenReel is close to Premiere on the editing core. Its tool set, sync lock, three-point edits, multicam, nesting, mixer, captions and transcript editing are broad and share one undoable action path. It is also ahead on honest docs, on-device ASR and AI/MCP surface. The release-blocking gaps are a short list of correctness and fidelity problems, not missing feature families. Three things render or play wrongly today: adjustment layers hit titles and tracks above them, speed changes shift pitch, and clip pan automation is stored but silent. Alongside those sit three Premiere-workflow gaps: Q/W is not ripple trim, timeline drags cannot overwrite or insert, and nothing gates scrub or playback performance. Everything else is parity polish or depth (format breadth, plugin hosts, RAW, HDR monitoring) that can ship after a verified release. Collaboration is excluded per the owner's priorities. Impact ratings come from the audit. I read "blocker/high" as "behaves wrongly or misleads users", and that ranking is my judgement.

## 2. Must-fix before the major release

Ranked. Effort is S/M/L/XL.

1. **Adjustment layers ignore track stacking and affectedTracks** (effects, M). They hit titles, subtitles and particles, and the position-aware resolver exists but neither renderer calls it. Wrong output in both preview and export.
   Evidence: `packages/core/src/video/video-engine.ts:1371-1380,1605-1640`, `apps/web/src/components/editor/Preview.tsx:192-232,3313-3321`, `packages/core/src/video/adjustment-layer-engine.ts:270-290`.
2. **Speed changes always shift pitch; the pitchCorrection flag is stored but never read** (audio, L). A 2x clip sounds an octave up in preview and export. The flag also implies a feature that is not there, so either implement it or hide it.
   Evidence: `packages/core/src/audio/audio-engine.ts:709`, `packages/core/src/video/speed-engine.ts:16,403`, `packages/core/src/audio/mixdown-cache.ts:78`.
3. **Clip pan automation is stored and copied but never rendered** (audio, M). The schema accepts data with no audible effect. Wire it into `clip-audio-resolution.ts`, or reject and hide it until it is wired.
   Evidence: `packages/core/src/audio/clip-audio-resolution.ts:78`, `packages/core/src/types/timeline.ts:326-329`.
4. **Q/W is not Ripple Trim to Playhead, and it ignores speed and reverse** (editing, M). It leaves the gap, bypasses the sync-lock planners, and moves inPoint by timeline delta. The speed handling is a correctness bug.
   Evidence: `packages/core/src/actions/action-executor.ts:1378`, `apps/web/src/hooks/useKeyboardShortcuts.ts`.
5. **Timeline drag has no overwrite, insert or resolution** (editing, L). `clip/move` removes and re-adds the clip with no overlap handling, so a drop onto another clip can create overlaps. Add overwrite by default, with Cmd/Ctrl for insert and Alt for copy.
   Evidence: `packages/core/src/actions/action-executor.ts:1089`, `apps/web/src/components/editor/Timeline.tsx:882-910`, `ClipComponent.tsx:640-720`.
6. **Perf has no gates for scrub latency, playback fps or import** (perf, M). The current budgets are cold start, a 400-clip bench and memory4k. Measured scrub p95 is about 600 ms, and 4K scrub p95 is about 550 ms on original media. Add budgets and a dropped-frame indicator. Dropped frames are counted but no UI reads them (S).
   Evidence: `apps/desktop/scripts/perf-budgets.json`, `docs/soak-report.md`, `packages/core/src/playback/playback-controller.ts`.
7. **The wall-clock GA gate was never passed on an idle machine, and loaded runs silently pass** (perf, M). Run it once on a quiet reference machine with `--require-wall`. This is what "ship verified states" requires.
   Evidence: `apps/desktop/PERF.md`, `apps/desktop/scripts/perf-budget.mjs`.
8. **4K layered playback peaks at 3.7-4.0 GB and the governor underestimates decoder cost** (perf, L). Whole-file audio decode remains. Recalibrate the 149 MB per-decoder estimate and window the audio decode.
   Evidence: `packages/core/src/device/memory-governor.ts`, `docs/soak-report.md`.
9. **LUT parser silently mis-loads LUTs** (color, M). DOMAIN_MIN/MAX is ignored, there is no 1D support, and data is stored as 8-bit. Wrong colour with no error.
   Evidence: `apps/web/src/components/editor/inspector/LUTLoader.tsx:42-92`.
10. **Export presets can be written but not saved from the UI** (export, M). `ExportPresetsManager` has a full API that nothing in the editor calls. This is a daily workflow.
    Evidence: `apps/web/src/services/export-presets.ts:844-960`, `ExportDialog.tsx:690`.
11. **Interchange never opened in Premiere, Resolve, Avid or FCP** (media-interop, M). Verify at least XMEML in Premiere and Resolve. Until then, label interchange as unverified in the UI and release notes.
    Evidence: `docs/interchange.md`.
12. **Fonts are not embedded or reported** (graphics-text, M). Projects and templates opened elsewhere render with the wrong font and no warning. Minimum fix: a missing-font report on open.
    Evidence: `apps/web/src/services/project-fonts.ts`, `ProjectPackageDialog.tsx:349`.
13. **`path` shape type is declared but draws nothing** (graphics-text, M). Either implement it or remove it from `SHAPE_TYPES`.
    Evidence: `packages/core/src/graphics/types.ts:124-140`, `graphics-engine.ts:505-540`.

## 3. Next wave: parallel work packages

Each package is scoped to one file area so the six can run at once.

- **WP1, Trim and edit-point model (editing; `packages/core/src/editing/*`, `ClipComponent.tsx`, `useKeyboardShortcuts.ts`).** Edit-point selection state, Trim Mode with ,/. nudges and numeric trim, dynamic JKL trim, selected-gap objects, Ctrl/Cmd ripple/roll toggles, sequence Go to In/Out, Mark Clip and Clear In/Out (S). Effort XL, split into milestones. Q/W ripple and the drag modes (must-fix 4 and 5) also live here and ship first.
- **WP2, Effects and keyframe instancing (effects; `packages/core/src/video/*effects*`, `animation/*`, `KeyframesSection.tsx`).** Key keyframes by effect instance. Add a per-parameter stopwatch in the effects inspector and extend animatable params to all classic effects. Add the mask combine modes (add/subtract/intersect/difference) and per-effect mask scope. Add exportable effect and animation presets. Effort L. Must-fix 1 can start here only if it stays inside the adjustment-layer files.
- **WP3, Audio depth (audio; `packages/core/src/audio/*`, `components/audio-mixer/*`).** Audible scrubbing (M), track fader and pan automation lanes (XL, but the lane UI can come first), a voice-over record upgrade with pre-roll, input select and level meter (M), solo-safe and output-device picker (M), and source-channel mapping (L). Must-fix 2 and 3 land first in this package.
- **WP4, Colour fidelity (color; `LUTLoader.tsx`, `color-grading-engine.ts`, `scopes/*`).** Fix the LUT parser (must-fix 9), add 1D LUTs, a LUT library with .cube export and an Input LUT slot (M). Raise scope resolution and add RGB, YC and HLS modes with a false-colour overlay and a nit scale (L). Add white-balance eyedropper parity and saved grades and looks (M). Add a camera-log preset set before touching ACES or OCIO (L).
- **WP5, Media and delivery (media-interop plus export; `packages/core/src/interchange/*`, `apps/desktop/src/main/ingest/*`, `ExportDialog.tsx`).** Export preset save, import and export (must-fix 10). Image-sequence and GIF export via the existing `exportImageSequence` (M), EDL import with real reel names, and relink by timecode and reel (M). Interpret Footage for frame rate, pixel aspect and field order (L). Two-pass and target/max rate control (L). Interchange verification (must-fix 11) comes first.
- **WP6, Text, captions and graphics (graphics-text; `packages/core/src/text/*`, `captions/*`, `graphic-templates/*`, `Preview.tsx` text layer).** On-canvas text editing (L), caption style model with stroke, shadow, position and VTT cue settings (M), saved text and caption styles (M), roll and crawl titles (M), and speaker diarization and translation (L). The `path` shape and missing-font fixes (must-fix 12 and 13) go first.

Perf work (must-fix 6 to 8) has its own owner in `apps/desktop/scripts/*` and `packages/core/src/device/*`, and does not collide with the six above.

## 4. Later

- **Large effort, low audience:** VST3/AU host, Dolby Atmos delivery (AC-3 / E-AC-3 stereo and 5.1 is done; Atmos / JOC is not), multichannel monitoring, native R3D/BRAW/ARRIRAW, Dynamic Link, `.mogrt` interchange, full OCIO (ACES 1.3 is done), display P3, HDR monitoring and Dolby Vision, ML speech enhancement, multicam editable sources and angle add/replace.
- **Architecture, ship after verification:** WebGPU effects and transition coverage, float HDR for all effects, off-thread compositing, persistent render cache with a scratch-disk setting and full-resolution previews, Windows and Linux perf qualification, a separate encoder process with watch folders.
- **Polish:** clip and master-clip markers, Source monitor history and Reverse Match Frame, multichannel source patching, multi-clip ripple speed, 1000+ clip measurements, bezier handle types, planar and corner-pin tracking, missing Premiere effects (VR; Echo, Posterize Time and Ultra Key are done), custom transitions, Media Browser, XMP metadata, Project Manager transcode, hardware encoder picker, publish targets, smart-render breadth, proxy presets, unified background-task panel, template catalog, extra caption import formats.

## 5. Strengths to market

- **Complete Premiere-style editing:** every tool (Selection, Razor, Ripple, Slip, Slide, Roll, Rate Stretch, Track Select), JKL, Lift/Extract, real three-point editing, targeting and sync lock, nested sequences and deep multicam with record-cuts.
- **One edit surface for humans, AI and MCP:** about 420 agent tools over the same undoable actions.
- **Pro colour and HDR in a web-tech editor:** Premiere-order float Lumetri, hue curves, HSL Secondary, Match Color, comparison monitor, Rec.2020, HDR10 and HLG export with measured MaxCLL and MaxFALL.
- **Real mixer:** buses, sends, per-track racks, plugin delay compensation, one DSP path for preview and export, true-peak limiter, live LUFS/LRA, 5.1 and stem export.
- **Captions and text:** on-device Whisper, transcript-based editing with filler and pause removal, caption QC, burn-in, sidecar and CEA-608 export, 51 text animation presets, responsive graphic templates.
- **Delivery and ingest:** the desktop ffmpeg sidecar decodes and exports ProRes, DNxHR and XDCAM MXF with no proxy. There is also smart render (93 to 98% copied), a persistent export queue, verified copy-ingest and a resumable proxy pipeline.
- **Interchange and reliability:** XMEML, FCPXML, OTIO and AAF with a dropped-items report, plus soak-tested stability (110 min, 787 clips, crash recovery, no leaked decoders).
- **Candid docs:** known-limitations, soak and perf reports state what is unverified.

### Dolby Digital (AC-3) and Digital Plus (E-AC-3) delivery

Done: stereo and 5.1 through ffmpeg's `ac3` / `eac3` encoders. Desktop (native ffmpeg sidecar): the audio track of MP4 and MOV (`ac-3` / `ec-3` sample entries) and MKV (`A_AC3` / `A_EAC3`), and raw `.ac3` / `.ec3` audio-only files. Web: raw `.ac3` / `.ec3` only, through the bundled ffmpeg.wasm 0.12.6 core (its `-encoders` list includes `ac3`, `ac3_fixed` and `eac3`, and its muxers include raw `ac3` / `eac3`); AC-3 tracks inside video files and MKV are refused in the browser with a desktop-only reason. Bitrates 192 to 640 kbps (AC-3) and 192 to 1024 kbps (E-AC-3), dialnorm -31 to -1 (defaults to the loudness target when loudness normalisation is on), 32 / 44.1 / 48 kHz (96 kHz is written at 48 kHz). The 5.1 mixer's L R C LFE Ls Rs order is relabelled by index to ffmpeg's `5.1(side)`. Export presets and quick exports added. Tested: the desktop integration suite runs the real sidecar and checks ffprobe `codec_name`, `channels`, `channel_layout`, `bit_rate`, duration and the Matroska codec ids, then decodes back and checks the level per channel.

**Still open:** Dolby Atmos (E-AC-3 JOC and ADM/Atmos masters; needs Dolby's licensed encoder and object metadata, and the editor has no object-based mixer), 7.1, dynamic range control profiles / other metadata beyond dialnorm, and a browser AC-3 track inside video files.
