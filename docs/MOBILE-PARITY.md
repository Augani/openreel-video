# Mobile / Cross-Platform Parity Matrix

Scope: the timeline-semantics that were unified across the recent iOS correctness
work, compared against Android and the web app. This documents where the three
platforms agree and where they intentionally differ.

Legend: ✅ implemented & matches · ⚠️ intentional difference · ❌ not implemented

| Capability | iOS | Android | Web | Notes |
|---|---|---|---|---|
| Primary / base visual track rule | ✅ | ✅ | ✅ | First `video`/`image` track is the always-on base layer (`primaryVisualTrack`); overlays composite above it. |
| Overlay z-order | ✅ | ✅ | ✅ | Higher tracks render on top of the base frame; deterministic by track order. |
| Speed-aware split source-time | ✅ | ✅ | ✅ | Source time = `inPoint + localTime * speed`, clamped to `[inPoint, outPoint)`. iOS preview and export share `TimelineSourceMapper`. |
| Reverse / boomerang playback | ✅ | ✅ | ✅ | Reversed clips sample backward from `outPoint`; boomerang is forward+reverse pairing on the timeline. |
| Reversed-clip **audio** | ⚠️ muted | ⚠️ reversed | ✅ reversed | iOS mutes reversed source audio (`TimelineAudioDescriptor` zeroes volume keyframes); Android renders true reversed audio via `ReverseAudioProcessor`. |
| `audioTrackIndex` selection | ✅ | ✅ | ✅ | `nil` = all source audio tracks; an index selects one, clamped to first when out of bounds (`PlaybackCompositionBuilder.selectedAudioTracks`). |
| Text/track visibility + solo | ✅ | ✅ | ✅ | Hidden tracks exclude their clips; any soloed track restricts visible clips to soloed tracks. iOS preview and export both call `visibleTextClips(at:)`. |
| Collage / overlay compositing | ✅ | ⚠️ | ✅ | iOS composites overlays via `overlayComposer` over the base frame. Android samples PiP-over-fullframe and demotes overlays fully occluded by an opaque full-frame primary (`LayeredVideoPlacement`). |
| Time-windowed overlays (text/graphics) | ✅ | ✅ | ✅ | Overlays gate to their `[start, start+duration)` window; outside the window they are not drawn. Android uses `TimedBitmapOverlay` alpha gating. |
| Local photo tone/detail/denoise | ✅ | ✅ | ✅ | Mobile processing stays on the device; iOS uses Core Image and Android uses the Media3 GL pipeline. |
| Local portrait blur/person cutout | ✅ Vision | ✅ bundled ML Kit | ✅ browser/local runtime | Mobile subject segmentation does not upload the source. Android writes a new PNG and keeps the original media item. |
| Cloud GPU photo/generative tools | ❌ retired | ❌ retired | ❌ retired | Unsupported repair, arbitrary upscale, colorize, face reconstruction, object replacement, and outpainting controls are removed rather than left broken. |

## Intentional platform differences

- **Reversed-clip audio.** iOS deliberately mutes audio on reversed clips to avoid
  artifacts from backward AVFoundation sampling; Android produces genuine reversed
  audio through a dedicated processor. Web mirrors Android.
- **Overlay-over-full-frame.** Android's media3 compositor keeps the primary frame
  always-on-top, so overlays fully occluded by an opaque full-frame primary are
  demoted (sampled but not promoted to a layer). iOS composites overlays above the
  base frame with the same z-order rule and does not demote them.

## Photo tools after cloud GPU retirement

The mobile editors expose only tools backed by a shipping local implementation:

- **iOS:** image-aware Photo Tools with measured auto tone, luminance detail,
  Core Image denoise, gentle face polish, Vision portrait blur, and subject cutout.
- **Android:** a dedicated Photo inspector with histogram-based auto tone,
  edge-aware denoise, detail sharpening, and bundled on-device person segmentation
  for portrait blur and transparent cutout. Portrait operations create a new PNG;
  the original remains in Project Media and the clip change is undoable.

The old remote Photo Enhancement surfaces and cloud job/auth clients are not part
of either mobile build. We intentionally do not advertise generative colorization,
face reconstruction/repair, semantic object erase/replace, reference-image color
matching, arbitrary neural upscale, or outpainting without a reliable local engine.

## Preview ↔ Export parity (iOS)

The recent iOS work unified the source-of-truth so that on-device **preview** and
**export** resolve identical state:

- Both build a `TimelineSourceMapper.ClipTiming` from the same clip fields
  (`inPoint`, `outPoint`, `startTime`, `duration`, `speed`, `reversed`) and call the
  same `TimelineSourceMapper.sourceTime(...)`, so forward / speed / reversed clips
  sample the same source frame in preview and export.
- Both resolve visible text via the single `OpenReelProject.visibleTextClips(at:)`
  helper, so hidden/solo filtering is identical.

These invariants are locked by `PreviewExportParityTests` and
`TimelineSourceMapperTests` in the iOS test target.

## Full feature parity audit (2026-05-29)

A complete iOS↔Android feature audit (9 domains, 4 expert lenses, every gap claim
adversarially verified against source) lives in **`docs/MOBILE-PARITY-AUDIT.md`**.
This section is the source-verified shortlist; the matrix above stays as the
timeline-semantics reference.

### Genuinely-implementable gaps (source-verified)

- **iOS missing — Text-to-Speech voiceover** (no `AVSpeechSynthesizer` anywhere;
  Android has `core/audio/TextToSpeechSynthesizer.kt` + a TTS card). **P0**, Android→iOS.
- **Both missing — loudness normalization (LUFS)** and **audio-only export
  (M4A/WAV)**. **P0**, new shared builds.
- **Both missing — timeline precision:** on-ruler marker rendering + jump-to-marker,
  frame-step clip nudge, whole-clip copy/paste to playhead, 3-point insert/overwrite,
  arbitrary clip grouping. **P1**.
- **Android missing — 3-way color wheels (lift/gamma/gain)** and **Gaussian/2D blur**
  (Android only has 1D `MotionBlurEffect`). **P1**, iOS→Android.

### Corrections found while source-verifying the audit (audit over-claimed)

- **iOS reversed-clip audio works on export** (`TimelineAudioOfflineRenderer.reverseBuffer`);
  it is muted **only in live preview, by design** — AVFoundation can't play backward
  audio cleanly (`PlaybackCompositionBuilder.swift:82`). Not a port; live-preview reverse
  would require an AVAudioEngine preview path.
- **iOS voice-effect pitch works on export** (`TimelineAudioOfflineRenderer.voiceEffectSemitones`
  sets `pitchNode.pitch`: helium/chipmunk +600¢, deep/monster −500¢); residual gap is
  live preview only.
- The iOS/Android `OpenReelProject` Clip schemas are **already field-aligned** (both carry
  `voiceEffect`, `groupID`, `pan`, `speedRamp`, `reversed`, `sourceClipID`, …), so most
  audit "shared key needed" items are no-ops; Wave 0 is a small delta (`preservePitch`,
  `targetLufs`, audio-only export-format entries).
- Many informal "X is iOS-only / Android-only" assumptions were **refuted** on
  verification (ripple delete, selective HSL, glitch, GIF export engine, project archive,
  template preview, stereo pan, compressor) — see audit §4.

**Implementation note:** because adversarial verification still produced false-positive
gap claims (export vs preview path confusion), every backlog item is re-verified against
source before coding.

## Session log 2026-05-29 — shipped + remaining backlog

Branch `feat/ios-app`. Each feature below was build-verified (iOS `xcodebuild ... -sdk iphonesimulator`; Android `./gradlew :app:compileDebugKotlin`). All use the shared `OpenReelProject` JSON schema so projects round-trip.

### Shipped (build-verified, NOT yet device-tested)
- **iOS Text-to-Speech voiceover** — `Core/Audio/TextToSpeechSynthesizer.swift` (AVSpeechSynthesizer, 7 voices matching Android's set) + `Features/Audio/TextToSpeechView.swift`, routed through the existing `importAndPlace` path. Closes the one genuinely-absent P0 (iOS had zero `AVSpeechSynthesizer`).
- **Android Gaussian blur** — `core/effects/GaussianBlurEffect.kt` (separable 2-pass GL) + `GaussianBlurConfig.kt`, shared effect type `"blur"` (`{radius, type:"gaussian", intensity}`) matching iOS `VideoEffectType.blur`. Wired into `ClipEffectPipeline` (preview+export), `AppState.toggleGaussianBlur`, Effects panel.
- **Android 3-way color wheels** — `core/effects/ColorWheelsEffect.kt` + `ColorWheelsConfig.kt`, ports iOS `VideoEffectRenderer.applyColorWheels` math to GL. Shared type `"colorWheels"`: scalars `shadowsLift`/`midtonesGamma`/`highlightsGain` + per-tone `{r,g,b}` objects `shadows`/`midtones`/`highlights`. Formula `out_c = pow(in_c*(gain+highlights_c*0.18) + (lift*0.08+shadows_c*0.08+midtones_c*0.04), gamma)`. Toggle applies a cinematic teal/orange default; the full per-wheel pad UI is a follow-up (the engine renders any params iOS writes — web already has `ColorWheelsControl.tsx`).

### Corrections confirmed (user's named examples already exist on BOTH)
- **Detach audio** — iOS `AppState.detachSelectedClipAudio`, Android `AppState.detachAudio`.
- **Ducking** — iOS `TimelineAudioDuckingConfig` (threshold/reduction/attack/release/hold + trigger role) in `PlaybackCompositionBuilder.duckingRanges`; Android auto-ducks off Dialogue clips (`DuckingAudioProcessor` + `computeDuckWindows`, fixed 0.32 gain, no UI).

### Remaining backlog — precise execution notes for next session

**1. Audio-only export (M4A/WAV) — both. Schema-touching; keep enums aligned.**
- Shared enum: add `m4a`, `wav` to `ExportCodec` (iOS `OpenReelProject.swift:284`; Android `OpenReelProject.kt:180`) and a matching container (`m4a`/`wav`). Decode-if-present, additive.
- iOS: `ProjectExportService.export` hard-throws `noVideoTracks` (`:298`, `:505-507`) and `resolveConfiguration` maps only mov/mp4 fileType (`:905`). Add an early audio-only branch BEFORE the video guard: reuse `prepareCompositionForExport` (it already produces `processedAudioURL`/`audioMix`), then export audio with `AVAssetExportSession(preset: AVAssetExportPresetAppleM4A)` → `.m4a`, or for WAV use `AVAssetWriter` with `fileType .wav` + LinearPCM settings. `makeOutputURL` extension must follow the codec.
- Android: `core/export/ProjectExportService.kt` uses media3 `Transformer`. For audio-only set `Transformer.Builder().setVideoMimeType(null)` / `EditedMediaItem` with `removeVideo=true`, or drop to `MediaMuxer` with only the AAC audio track for `.m4a`. WAV needs a PCM writer (no muxer support) — simplest: render PCM via existing audio path and write a WAV header.
- UI: add chips in both ExportSheets (iOS `Features/Export/ExportSheet.swift`; Android `ui/editor/ExportSheet.kt`).

**2. LUFS loudness normalization — both. New shared keys `targetLufs`, `loudnessNormalizeEnabled`.**
- Implement ITU-R BS.1770 integrated loudness: K-weighting pre-filter (two-stage: high-shelf + high-pass) → mean-square per 400ms block (75% overlap) → absolute gate −70 LUFS → relative gate (−10 LU below ungated mean) → integrated loudness → gain = target − measured, applied as a master gain.
- iOS: measure on the offline-rendered PCM in `TimelineAudioOfflineRenderer` (Accelerate/vDSP for the filters); apply gain in the final mix.
- Android: offline measure over decoded PCM; apply via a master-gain `AudioProcessor` (mirror `DuckingAudioProcessor` structure) in the export audio chain.
- Risk: BS.1770 done half-right is worse than none — implement with care + a known-value unit test (a −23 LUFS reference tone should measure ≈ −23).

**3. Lower-risk parity items (build-provable, no DSP):**
- On-ruler marker rendering + jump-to-next/prev (markers already modeled both: iOS `OpenReelProject.swift:354`, Android `:249`).
- Frame-step clip nudge (operates on `clip.startTime`; iOS has playhead-step only at `PlaybackController.swift:673`).
- Surface Android ducking controls (depth/timing) to match iOS's tunable config.
- Add 4:5 aspect preset to Android crop; arbitrary chroma-key color picker on Android (engine already supports any key color).

### Update — audio-only export: iOS shipped, Android spec'd (not yet built)
- **iOS audio export SHIPPED** (`ProjectExportService.exportAudioOnly`, commit on this branch) — isolated path, M4A via `AVAssetExportSession`, WAV via PCM rewrap, "Export Audio" row in the Audio panel + share sheet. Zero video-enum changes.
- **Android audio export — implementation-ready spec (deliberately not built this session: it lives in the 2153-line render-path `core/export/ProjectExportService.kt`, compile-only verifiable, deserves a device-tested session):**
  1. Add `suspend fun exportAudioOnly(project, mediaUriResolver, format)` to `ProjectExportService`.
  2. Populate the shared `mediaById` field (`project.mediaLibrary.items.associateBy { it.id }`) — `buildAudioSequences`/`exportMediaItemFor` depend on it (class field at line 36, populated in `runExport` at ~148).
  3. Build an **audio-only** `Composition` from `buildAudioSequences(project, mediaUriResolver)` (already returns the ducked, multi-track `List<EditedMediaItemSequence>`) — no video sequence.
  4. `Transformer.Builder(context).setAudioMimeType(MimeTypes.AUDIO_AAC)` (drop `setVideoMimeType`), `.build()`, `transformer.start(composition, cacheFile.absolutePath)` to an `.m4a` cache file. Reuse the existing `ProgressHolder` polling + `Transformer.Listener` pattern from `runExportOnMain`.
  5. Save via a `saveToMediaStore` variant targeting `MediaStore.Audio` (`Environment.DIRECTORY_MUSIC/OpenReel`, MIME `audio/mp4` for m4a), mirror the `IS_PENDING` flow.
  6. WAV on Android needs a PCM writer (media3 muxer has no WAV) — render PCM via an audio-only Transformer to raw then prepend a WAV header, OR ship M4A-only first.
  7. UI: add an "Export Audio" entry to `ui/editor/panels/AudioTabPanel.kt` mirroring iOS.
- Keep the file format aligned with iOS (`.m4a`, `.wav`); no `OpenReelProject` schema change needed (export format is a transient choice, not persisted).

### Update 2 — LUFS + audio export status (final this session)
- **iOS audio-only export + LUFS: COMPLETE & test-verified.** `exportAudioOnly` (M4A/WAV) with a "Normalize loudness" toggle (target −16 LUFS). `LoudnessNormalizer` (BS.1770) verified by `LoudnessNormalizerTests` (5 tests, 0 failures: round-trip measure→gain→re-measure within 0.3 LU, +6dB on amplitude double, monotonicity).
- **Android audio-only export: COMPLETE** (`exportAudioOnly` → AAC `.m4a` → MediaStore.Audio, "Export Audio" row). Compiles.
- **Android LUFS: DSP core COMPLETE & test-verified** (`LoudnessNormalizer.kt`, identical math to iOS; `LoudnessNormalizerTest` passes). **Remaining (1 follow-up): wire it into Android audio export.** Android export streams through media3 Transformer to AAC with no intermediate PCM, so auto-normalize needs a two-pass:
  1. In `runAudioExport`, after building the audio `Composition`, run a first Transformer pass exporting to a temp file, then decode that to interleaved PCM via `MediaExtractor` + `MediaCodec` (or reuse `WaveformExtractor`'s decode if it exposes full samples).
  2. `LoudnessNormalizer.integratedLufs(pcm, channels=2, 48000.0)` → `linearGain(target=-16, measured)`.
  3. If `|gain−1| > 0.001`, second pass: apply gain via a master-gain `BaseAudioProcessor` (multiply PCM-16 samples, mirror `DuckingAudioProcessor`'s structure) set on the Composition's `Effects.audioProcessors`, re-encode, then save to MediaStore.Audio.
  4. Add a "Normalize loudness" toggle to the Android export UI mirroring iOS.
  This was deliberately deferred: it is device-untestable here and adds fragile MediaCodec plumbing to the render path — it deserves a device-tested session.

### Update 3 — Android audio export + LUFS COMPLETE (wired)
- **Android audio-only export is now fully wired** (commit 0f63d34, fixing dead code from 6a39cb9). `exportAudioOnly(project, mediaUriResolver, normalizeToLufs)` → audio-only media3 Transformer (AAC) → `.m4a` → MediaStore.Audio (Music/OpenReel). Surfaced via `AppState.startAudioExport(normalizeLoudness)` and an "Export Audio" row in the Audio panel.
- **Android LUFS normalization wired into export.** When the "Normalize Loudness" toggle (−16 LUFS) is on, a two-pass runs: render the mix → `decodePcm` (full interleaved PCM via MediaExtractor+MediaCodec, no decimation) → `LoudnessNormalizer.integratedLufs` → `linearGain` → re-encode with a `MasterGainAudioProcessor`. iOS uses the same target and the same BS.1770 math.
- **Verification:** `gradlew compileDebugKotlin` SUCCESSFUL; `LoudnessNormalizerTest` 5/5 (XML tests=5 failures=0). The two-pass `decodePcm`/`MasterGain` MediaCodec plumbing compiles but is **not device-tested** — needs a real device run (export an M4A with normalize on, confirm it measures ≈ −16 LUFS).
- **Parity status:** iOS and Android now both have audio-only export + LUFS normalization with identical loudness math. iOS adds WAV output (Android is M4A-only — media3 muxer has no WAV; a PCM+header writer is the only remaining audio-export delta).
