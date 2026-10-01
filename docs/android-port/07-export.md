# 07 - Export (iOS -> Android port spec)

This document describes the iOS export subsystem of "Openreel Video" exactly as implemented, so an Android team can rebuild it 1:1 in Kotlin. All numbers, defaults, formulas and option lists are verbatim from the iOS source.

Source files:
- `Openreel Video/Features/Export/ExportSheet.swift`
- `Openreel Video/Features/Export/ExportProgressView.swift`
- `Openreel Video/Core/Export/ProjectExportService.swift`
- `Openreel Video/Core/Export/PhotoLibraryExportSaver.swift`
- `Openreel Video/Shared/Components/ShareSheet.swift`

---

## 1. Export Sheet

The export sheet is a modal full-height `NavigationStack > ScrollView` with a `Close` toolbar button (top-trailing). Vertical layout, padding 20, spacing 24 between sections, themed with `OpenReelTheme` (background/surface/surfaceElevated/accent/accentSecondary/destructive/textPrimary/textSecondary).

The sheet is driven by these inputs/outputs:

| Input | Type | Notes |
|---|---|---|
| `project` | `OpenReelProject` | Read-only; provides current canvas (`settings.width/height`) and project frame rate. |
| `draft` (Binding) | `OpenReelProject.ExportPreferences` | The settings being edited. Mutable. |
| `estimate` | `ProjectExportService.ExportEstimate` | `{ estimatedFileSize: Int64, estimatedDuration: TimeInterval }` recomputed by parent whenever `draft` changes. |
| `requiresProjectApply` | `Bool` | True when chosen export resolution implies a different canvas aspect than the project; user must `onApplyToProject` first. |
| `isExporting` | `Bool` | Disables buttons while an export is running. |
| `onApplyToProject`, `onExport`, `onClose` | closures | |

### 1.1 Section order (top to bottom)

1. Header — title "Export Settings" (24pt rounded bold) + subtitle "Choose a preset, tune the format, and export with the current project render pipeline." (`reelBody`, secondary).
2. Presets (horizontal scroll chips)
3. Canvas (project/export comparison cards + resolution grid)
4. Frame Rate (chips)
5. Format (2-column grid of 9 cards)
6. Quality (slider + help text + "Smaller File" shortcut card)
7. Estimate (4-row summary card)
8. (Conditional) "Apply Before Export" requirement card
9. (Conditional) Apply To Project button (54pt height, `accentSecondary`, rounded 18)
10. Export button (54pt height, `accent`, rounded 18; label "Export GIF" when codec == .gif else "Export Video"; disabled when `isExporting || requiresProjectApply`, opacity 0.55 when disabled)

### 1.2 Presets section

Horizontal scrolling chips, one per `OpenReelProject.ExportPreset` case. Tapping a preset replaces `draft` via `OpenReelProject.ExportPreferences.recommended(for: preset, currentSettings: project.settings, existing: draft)`. Selected chip uses `OpenReelTheme.accent` with white text; others use `OpenReelTheme.surface` and primary text. Corner radius 16. Padding H14 V12. Spacing 10.

| Preset enum case | Display name | Subtitle |
|---|---|---|
| `.youtube` | "YouTube" | "16:9 1080p" |
| `.tiktok` | "TikTok" | "9:16 vertical" |
| `.instagramSquare` | "Instagram Square" | "1:1 feed" |
| `.instagramPortrait` | "Instagram Portrait" | "4:5 feed" |
| `.twitter` | "Twitter" | "16:9 social" |
| `.custom` | "Custom" | "Manual settings" |

The preset's job is to pick a recommended resolution + format + quality combo (see `ExportPreferences.recommended` in the project domain layer). The user can subsequently modify any field; doing so should set `draft.preset = .custom` (the "Smaller File" shortcut does this explicitly).

### 1.3 Canvas section

Two cards side by side ("Project" and "Export") each showing `WxH` and an aspect label. Below them, a 2-column `LazyVGrid` of three resolution buttons. The choices adapt to the current draft aspect:

- If aspect is roughly 1:1 (|ratio-1| < 0.02): offers `1080x1080`, `1440x1440`, `2160x2160`.
- If portrait and aspect label resolves to "4:5": offers `1080x1350`, `1440x1800`, `2160x2700`.
- Otherwise portrait (e.g. 9:16): `1080x1920`, `1440x2560`, `2160x3840`.
- Else (landscape): `1280x720`, `1920x1080`, `3840x2160`.

Tapping sets `draft.resolution = resolution`. There is no manual width/height entry — only these three quick choices per aspect.

Aspect labels are computed with `aspectLabel(for:)`:
- 16:9 if |ratio - 16/9| < 0.02
- 9:16 if |ratio - 9/16| < 0.02
- 1:1 if |ratio - 1| < 0.02
- 4:5 if |ratio - 4/5| < 0.02
- else `String(format: "%.2f:1", ratio)`

Resolution card style: rounded 16, surface or accent if selected, min height 72, H14 padding, value 14pt semibold + aspect caption.

### 1.4 Frame Rate section

Horizontal capsule chips (height 42, H14 padding) for every value in `NewProjectConfiguration.supportedFrameRates`. Label format: `"\(Int(frameRate)) fps"`. Selected uses `accent`, unselected uses `surfaceElevated`. Tapping sets `draft.frameRate = frameRate` (stored as `Double`).

Allowed frame rates: whatever `NewProjectConfiguration.supportedFrameRates` exposes (see project creation doc). Typically: 24, 25, 30, 50, 60. GIF tops out separately (see section 2). Spacing 10.

### 1.5 Format section

2-column grid of 9 cards. Each card shows the format `label` (14pt semibold rounded) and a one-line `detailLabel`. Selected = accent / white text; unselected = surface / primary text. Min height 82, corner radius 16, H14 padding.

| label | container | codec | proResProfile | detailLabel |
|---|---|---|---|---|
| MP4 H.264 | .mp4 | .h264 | nil | "Fast and compatible" |
| MP4 H.265 | .mp4 | .hevc | nil | "Smaller files" |
| MOV H.264 | .mov | .h264 | nil | "MOV wrapper" |
| MOV H.265 | .mov | .hevc | nil | "HEVC in MOV" |
| Animated GIF | .gif | .gif | nil | "Looping animation" |
| ProRes Proxy | .mov | .proRes | .proxy | "Light offline master" |
| ProRes LT | .mov | .proRes | .lt | "Smaller ProRes" |
| ProRes 422 | .mov | .proRes | .standard | "Editing master" |
| ProRes HQ | .mov | .proRes | .hq | "Maximum quality" |

`outputSummary` strings (used in estimate row + progress view):
- h264 -> "MP4 H.264" or "MOV H.264"
- hevc -> "MP4 H.265" or "MOV H.265"
- proRes -> "MOV ProRes Proxy/LT/422/HQ"
- gif -> "Animated GIF"

Setting `draft.format = option.format` is the only side effect.

### 1.6 Quality section

Header row: "Quality" title + a right-aligned current label (caption, secondary text):

| Quality range | Label |
|---|---|
| < 0.4 | "Low" |
| < 0.7 | "Balanced" |
| < 0.9 | "High" |
| >= 0.9 | "Maximum" |

Slider: `value: $draft.quality`, range `0.2 ... 1`, step `0.05`, tint `accent`. **Disabled when codec == .proRes** (ProRes profile picks quality directly).

Help text (caption, secondary) varies by codec:
- `.proRes` -> "ProRes profile controls quality directly."
- `.gif` -> "Higher values render smoother animated GIFs, up to 15 fps."
- `.h264 / .hevc` -> "Higher values raise bitrate for H.264 and H.265 exports."

"Smaller File" shortcut (only shown when codec != .proRes): a card with `internaldrive` icon, title "Smaller File", subtitle "Switch to MP4 H.265 and trim the bitrate target for sharing." Tapping it executes:
```
draft.preset = .custom
draft.format = ExportFormat(container: .mp4, codec: .hevc)
draft.quality = min(draft.quality, 0.45)
```

### 1.7 Estimate section

Single rounded-18 surface card padded 16 with four rows (spacing 12):

1. **File Size** — `ByteCountFormatter.string(fromByteCount: estimate.estimatedFileSize, countStyle: .file)`.
2. **Export Time** — `DateComponentsFormatter` abbreviated, hours/min/sec if `>= 3600` else min/sec, drop leading zeros.
3. **Target Bitrate** — call `ProjectExportService.targetBitRates(for: draft)`. If GIF: `"Animated GIF • up to 15 fps"`. Else: `"<video> video • <audio> audio"` where each bitrate is formatted as `"%.1f Mbps"` if >= 1,000,000 else `"<kbps rounded> kbps"`.
4. **Output** — `draft.format.outputSummary` (see table above).

### 1.8 "Apply Before Export" requirement card

Shown only when `requiresProjectApply == true`. Surface card rounded 18 with accent-tinted stroke (opacity 0.35). Title "Apply Before Export", body "This export changes the canvas aspect ratio. Apply it to the project first so you can reframe clips with the existing preview crop and transform tools." Followed by the "Apply To Project" button (`accentSecondary`).

### 1.9 Defaults summary

| Field | Default source |
|---|---|
| `draft.preset` | Whatever the caller passes in (typically `project.exportPreferences.preset`). |
| `draft.resolution` | `project.exportPreferences.resolution`; mutated when preset/aspect changes. |
| `draft.frameRate` | `project.exportPreferences.frameRate` (defaults to project's frame rate). |
| `draft.format` | `ExportFormat(container: .mp4, codec: .h264)` is the typical default; ExportPreferences may carry a different value. |
| `draft.quality` | 0.2 ... 1, defaults from `ExportPreferences` (typically ~0.65 - "Balanced"). |
| Audio sample rate | 48,000 (hard-coded). |
| Audio channels | 2 (hard-coded). |

### 1.10 Inter-option dependencies

- ProRes -> quality slider disabled; quality help text changes; bitrate fully driven by `proResProfile`.
- GIF -> audio settings nil; export button label "Export GIF"; `quality` reinterpreted as smoothness up to 15 fps; bitrate row shows "Animated GIF • up to 15 fps".
- GIF -> file size estimate uses a wholly different formula (see 1.11 / section 2).
- Changing resolution that flips the aspect ratio relative to the project -> parent sets `requiresProjectApply = true` and shows the apply card + apply button, and disables the export button.
- "Smaller File" -> forces `format = MP4 H.265`, clamps `quality` to <= 0.45, sets `preset = .custom`.

### 1.11 Estimate formulas (`ProjectExportService.estimate`)

```
duration = max(project.timeline.duration, 1 / max(frameRate, 1))

if codec == .gif:
  frameCount = duration * gifFrameRate(prefs)            // see section 2
  pixels     = width * height
  qualityScale = 0.16 + quality * 0.18
  fileSize = max(frameCount * pixels * qualityScale, 128_000)   // bytes, Int64
else:
  fileSize = (duration * (videoBitRate + audioBitRate)) / 8     // bytes

megapixels = (width * height) / 1_000_000

baseFactor = { .h264: 0.75, .hevc: 0.9, .proRes: 1.4, .gif: 1.15 }[codec]

estimatedDuration = max(duration * megapixels * baseFactor, 1)  // seconds
```

`videoBitRate` (`estimatedVideoBitRate`) is computed as:
```
scale = (width * height * frameRate) / (1920 * 1080 * 30)
normalizedQuality = (quality - 0.2) / 0.8
base = lerp(minimumBase, maximumBase, normalizedQuality)
bitrate = clamp(base * scale, minimum, maximum)
```

| Codec | minimumBase | maximumBase | minimum | maximum |
|---|---|---|---|---|
| h264 | 1,400,000 | 4,200,000 | 900,000 | 28,000,000 |
| hevc | 900,000 | 2,800,000 | 650,000 | 20,000,000 |

ProRes overrides the formula:
```
baseBitRate = { proxy: 45_000_000, lt: 100_000_000, standard: 147_000_000, hq: 220_000_000 }
bitrate = max(baseBitRate, baseBitRate * scale)
```
GIF returns 0.

`audioBitRate` (`estimatedAudioBitRate`):
- gif: 0
- proRes: 1,536,000 (16-bit 48 kHz stereo PCM)
- h264 / hevc: 128,000 (AAC)

---

## 2. GIF export specifics

GIF takes a completely different code path (`writeGIFExport`) that bypasses `AVAssetWriter` and uses `ImageIO` / `CGImageDestination`.

- **File type identifier**: `UTType.gif.identifier`.
- **Looping**: `kCGImagePropertyGIFLoopCount = 0` (infinite loop) set as destination-level property.
- **Frame rate**: `gifFrameRate(for: prefs)`:
  ```
  qualityFrameRate = 8 + ((clamp(quality, 0.2, 1) - 0.2) / 0.8) * 7  // 8..15
  return min(max(prefs.frameRate, 1), round(qualityFrameRate))
  ```
  So GIF fps is the smaller of (a) the chosen project fps and (b) a quality-driven ramp from 8 fps (quality=0.2) to 15 fps (quality=1.0), rounded.
- **Frame delay**: `1 / gifFrameRate` set per-frame via `kCGImagePropertyGIFDelayTime` and `kCGImagePropertyGIFUnclampedDelayTime`.
- **Dimensions**: directly the chosen `resolution.width x resolution.height` (no downscale).
- **Palette**: implicit — `CGImageDestinationAddImage` writes 8-bit palette GIF; no custom palette is generated.
- **Audio**: none. `audioSettings` returns `nil` for GIF in `audioSettings(for:bitRate:)`.
- **Pipeline**: pull pixel buffer from `AVAssetReaderVideoCompositionOutput` (BGRA, Metal compatible), wrap as `CIImage`, render via `CIContext.createCGImage` at `configuration.renderSize`, append to `CGImageDestination`. Frames are time-gated: any sample whose PTS is earlier than `nextFrameTime` is skipped; `nextFrameTime = presentationTime + frameInterval` (where `frameInterval = CMTime(seconds: frameDelay, preferredTimescale: 600)`).
- **Output extension**: `.gif`.
- **Progress**: detail "Rendering GIF frame N"; fraction `min(0.92, 0.2 + progressOfDuration * 0.7)`; finalize step "Encoding animated GIF" -> "Wrapping up GIF metadata".
- **No frames -> error**: `"No GIF frames were rendered."`

---

## 3. ExportProgressView

`ExportProgressView` is a centered modal overlay on top of a black 35% scrim (`ZStack`, `Color.black.opacity(0.35)`).

Inputs:
- `status: ProjectExportService.ExportProgress { fraction: 0..1, stage, detail }`
- `remainingTime: TimeInterval?`
- `preferences: OpenReelProject.ExportPreferences` (only for the summary line)
- `onCancel: () -> Void`

Layout (centered card on `surfaceElevated`, rounded 20, padded 24, VStack spacing 16):

1. `ProgressView(value: status.fraction)` — linear bar, tinted `accent`, width 220, animated easeInOut 0.2 on fraction change.
2. Stage title (`reelBody`, white) from `status.stage.title`:
   - `.preparing` -> "Preparing Export"
   - `.rendering` -> "Rendering Export"
   - `.finalizing` -> "Finalizing Export"
   - `.completed` -> "Export Complete"
3. Percent label: `"\(Int(status.fraction * 100))%"` (14pt semibold rounded, secondary).
4. `status.detail` (caption, secondary) — sub-step description, e.g. "Rendering video and audio", "Encoding animated GIF", "Wrapping up metadata".
5. Summary line: `"<W>x<H> • <format.outputSummary>"` (caption, secondary).
6. If `remainingTime != nil`: `"About <formattedDuration(remainingTime)> remaining"` (caption, secondary), formatted with `DateComponentsFormatter` (hour/min/sec if >=3600 else min/sec, abbreviated style, dropLeading).
7. **Cancel button** — "Cancel Export" capsule, 42 high, H18 padded, on `OpenReelTheme.destructive`. Calls `onCancel`.

The view does NOT render a completion success card. When `status.stage == .completed`, the parent screen is responsible for dismissing this overlay and presenting next-step affordances (Save to Photos, Share, Open in...). Those affordances live outside this file; expect the parent to:
- Show a `ShareSheet` (section 6) with the exported file URL.
- Offer "Save to Photos" via `PhotoLibraryExportSaver.saveVideo(at:)` or `saveAnimatedImage(at:)`.
- Surface any thrown `ExportError` via an alert with `error.errorDescription`.

`remainingTime` is computed by the parent from `status.fraction` and elapsed time; this view only formats it.

### Stage -> fraction progression

`ExportProgressBox` (in ProjectExportService) drives the fraction for non-GIF exports:
- Preparing stages explicitly emit fixed fractions: 0.02 "Analyzing timeline", 0.05 "Building composition", 0.08 "Preparing media and audio", 0.18 "Configuring effects and render pipeline".
- Rendering: weighted sum: `videoFraction * (hasAudio ? 0.56 : 0.74) + audioFraction * (hasAudio ? 0.18 : 0)`, mapped onto `0.18 + ... + 0.99` band, **monotonically increasing** (`lastProgress = max(lastProgress, ...)`).
- Finalizing: adds `finalizingFraction * 0.08`, with synthetic emissions 0.96 "Finishing the export file", 0.99 "Wrapping up metadata".
- Completion: `fraction: 1, stage: .completed, detail: "Export ready"`.

GIF progression: 0.2 "Rendering GIF frames" -> per-frame `min(0.92, 0.2 + frac*0.7)` -> 0.96 "Encoding animated GIF" -> 0.99 "Wrapping up GIF metadata" -> 1 completed.

---

## 4. ProjectExportService (encoding pipeline)

Top-level entry point: `static func export(project, sources, projectDirectoryURL, configuration, progress) async throws -> URL`. Returns the temporary file URL of the produced export.

### 4.1 Pipeline architecture

The service uses a hand-rolled `AVAssetReader` + `AVAssetWriter` pipeline (NOT `AVAssetExportSession` — there is a legacy `legacyExport` helper retained for iOS 16, but the main path is the reader/writer pair). Reason: it needs per-frame CIFilter compositing for effects, text, graphics, overlays, transitions and AI effects, plus full control over progress, cancellation, and codec settings.

High-level steps:

1. **Resolve configuration** (`resolveConfiguration`) -> `ResolvedExportConfiguration { preferences, fileType, renderSize, videoSettings, audioSettings, videoBitRate, audioBitRate }`. `fileType` is `.mp4`, `.mov`, or `nil` (GIF).
2. **Build playback composition** via `PlaybackCompositionBuilder.build(sources, audioDescriptor)` -> `{ composition: AVMutableComposition, audioMix: AVAudioMix? }`. Throws `.noPlayableTracks` if nil.
3. **Prepare audio** (`prepareCompositionForExport`):
   - If `TimelineAudioDescriptor` has any non-zero pan or any enabled audio effect, render audio offline via `TimelineAudioOfflineRenderer.render(descriptor, sampleRate: 48_000, channels: 2)` to a temp file. Replace all audio tracks in the composition with the processed track and clear `audioMix`.
   - Otherwise keep the live `audioMix` and original audio tracks (no offline render).
   - The processed temp file is deleted in `defer`.
4. **Compose video** (`makeFilteringVideoComposition`) — uses `AVMutableVideoComposition.videoComposition(with:applyingCIFiltersWithHandler:)`. For each frame:
   - Compute `timelineTime = compositionTime.seconds` (clamped >= 0).
   - Call `composePreviewFrame(sourceImage, ...)` to bake the entire visual stack (transitions, active video clip with effects + keyframe animation, image overlays, graphics clips, text clips) onto a black canvas of `renderSize`.
   - `request.finish(with: frame, context: context)`.
   - The CI context is Metal-backed (`MTLCreateSystemDefaultDevice` -> `CIContext(mtlDevice:)`), falling back to a software CIContext.
   - Set `videoComposition.renderSize = renderSize`, `frameDuration = CMTime(value: 1, timescale: max(round(frameRate), 1))`.
5. **Read+write** (`writeConfiguredExport` for video, `writeGIFExport` for GIF):
   - Add `AVAssetReaderVideoCompositionOutput` with pixel format `kCVPixelFormatType_32BGRA`, `kCVPixelBufferMetalCompatibilityKey: true`, `alwaysCopiesSampleData = false`, `.videoComposition = videoComposition`.
   - Optionally add `AVAssetReaderAudioMixOutput(audioTracks, audioSettings: nil)` with `audioMix` attached.
   - Add `AVAssetWriterInput(mediaType: .video, outputSettings: configuration.videoSettings)`, `expectsMediaDataInRealTime = false`.
   - Optionally add `AVAssetWriterInput(mediaType: .audio, outputSettings: configuration.audioSettings)`.
   - `writer.startWriting()`, `reader.startReading()`, `writer.startSession(atSourceTime: .zero)`.
   - Drain video and audio in parallel on two `DispatchQueue`s ("openreel.export.video" / "openreel.export.audio") via `requestMediaDataWhenReady`. Each pulls samples from its output with `copyNextSampleBuffer` and appends them to the writer input until exhausted, then `markAsFinished()`. A `DispatchGroup` waits for both.
   - PTS-based progress: `fraction = clamp(pts.seconds / max(duration, 0.1), 0, 1)`; main-actor dispatched to the progress callback.
   - At the end: `finishWriting` async; final progress emissions; cleanup.

### 4.2 Video encoder settings (`videoSettings`)

For h264/hevc/proRes (not GIF):
```
AVVideoCodecKey   = .h264 | .hevc | .proRes422Proxy | .proRes422LT | .proRes422 | .proRes422HQ
AVVideoWidthKey   = preferences.resolution.width
AVVideoHeightKey  = preferences.resolution.height

if codec != .proRes:
  AVVideoCompressionPropertiesKey = {
    AVVideoAverageBitRateKey:          targetVideoBitRate,
    AVVideoExpectedSourceFrameRateKey: Int(round(frameRate)),
    AVVideoMaxKeyFrameIntervalKey:     Int(max(round(frameRate) * 2, 1))   // ~ every 2 seconds
  }
```
ProRes intentionally has no bitrate / GOP override (codec is intra-frame, profile picks data rate).
There is **no HDR / 10-bit color setting**, **no color primaries / transfer function override**, **no profile/level setting**, **no B-frame configuration**, **no entropy mode**. Whatever AVFoundation chooses by default is used.

### 4.3 Audio encoder settings (`audioSettings`)

- GIF -> `nil`.
- ProRes -> LPCM:
  ```
  AVFormatIDKey                = kAudioFormatLinearPCM
  AVSampleRateKey              = 48_000
  AVNumberOfChannelsKey        = 2
  AVLinearPCMBitDepthKey       = 16
  AVLinearPCMIsBigEndianKey    = false
  AVLinearPCMIsFloatKey        = false
  AVLinearPCMIsNonInterleaved  = false
  ```
- H.264 / HEVC -> AAC:
  ```
  AVFormatIDKey         = kAudioFormatMPEG4AAC
  AVSampleRateKey       = 48_000
  AVNumberOfChannelsKey = 2
  AVEncoderBitRateKey   = targetAudioBitRate    // 128_000
  ```

### 4.4 How effects bake in

`composePreviewFrame` runs inside the CIFilter handler for every output frame and:
1. Starts with a solid black `CIImage` cropped to `renderSize`.
2. Renders any active visual transition between two clips (`activeTransitionFrame`) via `TransitionCompositor.apply(outgoing, incoming, transition, progress)`. The two clips involved are recorded so they are not drawn again as plain clips.
3. Renders the active video clip — animated by `KeyframeEngine.animatedClip(clip, at:)` — through `VideoEffectRenderer.render(image, effects, projectDirectoryURL, timelineTime, effectContext)`. AI effects can additionally receive a `FrameEffectContext` resolved synchronously by `AIFrameContextBuilder.frameContextSynchronously(...)` using a `MediaAnalysisService` and a CVPixelBuffer rendered for that frame.
4. Renders active image overlays the same way (animated + effected + positioned via `presentVisualLayer`).
5. Renders active graphics clips (`renderGraphicsLayer`).
6. Renders active text clips (`renderTextLayer`).

Each layer is `composited(over:).cropped(to: canvasRect)`. The final cropped `CIImage` is returned to `request.finish(with:context:)`.

### 4.5 How audio mixes

Two modes (decided by `requiresProcessedAudio(for: descriptor)`):

- **Live mix** — uses the `AVAudioMix` produced by `PlaybackCompositionBuilder`. Tracks remain individual and the reader's `AVAssetReaderAudioMixOutput` applies the mix (volume, fades, etc.) on the fly. Used when no segment has per-clip or per-track pan and no audio effect is enabled.
- **Offline-rendered processed audio** — when any segment has |trackPan + clipPan| > 0.0001 or any enabled audio effect, the service calls `TimelineAudioOfflineRenderer.render(descriptor, sampleRate: 48_000, channels: 2)`. The resulting file (likely WAV/CAF) is loaded as `AVURLAsset`, its audio track copied into a freshly added composition audio track (after removing all existing audio tracks). `audioMix` is set to `nil`. This pre-bakes panning + audio effects.

Either way the writer receives stereo 48 kHz audio.

### 4.6 Error handling

`ExportError: LocalizedError, Equatable`:
- `.noPlayableTracks` -> "Add video or audio clips before exporting."
- `.noVideoTracks` -> "Export currently requires at least one visible video clip."
- `.sessionCreationFailed` -> "The export session could not be created."
- `.unsupportedFileType` -> "This device does not support the current export format."
- `.exportFailed(String)` -> message verbatim.

Specific surfaces:
- Reader/writer construction failures -> `.sessionCreationFailed`.
- `fileType == nil` for non-GIF -> `.unsupportedFileType`.
- `canAdd` fails for inputs/outputs -> `.exportFailed("...could not create...")`.
- `startWriting` / `startReading` false -> `.exportFailed(writer.error?.localizedDescription ?? ...)`.
- Sample append failure -> `.exportFailed("The export writer rejected a video/audio frame/sample.")`.
- Reader status `.failed` -> `.exportFailed(reader.error?.localizedDescription)`.
- Writer not `.completed` after finishWriting -> `.exportFailed(writer.error?.localizedDescription)`.
- Cancellation (any source) -> `.exportFailed("The export was cancelled.")`.
- GIF: destination create failure, frame render failure, no frames, finalize failure all map to `.exportFailed("...")`.

On any throw the temp output file at `outputURL` is deleted (`try? FileManager.default.removeItem(at: outputURL)`). The processed audio temp file is deleted in `defer`.

### 4.7 Cancellation

Cancellation is plumbed through:
- A `ExportCancellationBox` (NSLock-protected `Bool`) wired to `withTaskCancellationHandler(onCancel: { cancellation.cancel() })`. Swift task cancellation propagates here.
- The UI cancel button calls a parent closure that cancels the wrapping `Task`.
- Inside both video and audio drain loops, `exportLoopError` checks `cancellation.isCancelled || Task.isCancelled || writer.status == .cancelled || reader.status == .cancelled`. If true, the loop pushes an `.exportFailed("The export was cancelled.")` into the shared `ExportFailureBox`, marks the input finished, and ends.
- The catch block calls `reader.cancelReading()` + `writer.cancelWriting()`.
- For GIF, the per-frame loop also checks cancellation and calls `reader.cancelReading()` before throwing.

### 4.8 Background mode behavior

There is no explicit background task or `UIApplication.beginBackgroundTask` handling in this file. The service runs as a standard Swift task. If the app is backgrounded:
- AVAssetWriter encoding can continue briefly with default iOS rules (no special audio session); long exports may be suspended.
- No re-entry / resumption mechanism exists; canceling and restarting is the user's only option.
- The Android port should explicitly use a foreground service (see section 8) to avoid this fragility.

### 4.9 Output file location

`makeOutputURL`:
```
extension = mov | mp4 | gif (from container)
sanitized = project.name keeping only alphanumeric runs joined by '-'  (fallback "OpenReel-Export")
timestamp = ISO8601 with ':' replaced by '-'
url = FileManager.default.temporaryDirectory / "<sanitized>-<timestamp>.<ext>"
```
The file lives in the app's temp dir. Any existing file at that URL is removed before writing.

### 4.10 ExportProgress.Stage detail strings (verbatim, for parity)

Preparing emissions: "Analyzing timeline", "Building composition", "Preparing media and audio", "Configuring effects and render pipeline".
Rendering emissions: "Rendering video frames" (no audio) or "Rendering video and audio".
Finalizing emissions: "Packaging the movie file", "Finishing the export file", "Wrapping up metadata".
GIF rendering: "Rendering GIF frames" / "Rendering GIF frame <N>"; finalizing: "Encoding animated GIF", "Wrapping up GIF metadata".
Completed: "Export ready".

---

## 5. PhotoLibraryExportSaver

Tiny `enum` wrapping Photos save logic.

```
enum SaveError: LocalizedError {
  case permissionDenied  -> "OpenReel needs Photos access to save exports."
  case creationFailed    -> "The export could not be saved to Photos."
}
```

Three async functions:

1. `saveVideo(at url: URL)` — saves a video file (mp4/mov):
   - `await PHPhotoLibrary.requestAuthorization(for: .addOnly)`; only `.authorized` and `.limited` proceed, anything else throws `.permissionDenied`.
   - `PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) }`.
   - Completion: error -> rethrow; `success == true` -> ok; else `.creationFailed`.

2. `saveAnimatedImage(at url: URL)` — for GIFs:
   - `let data = try Data(contentsOf: url)`; delegates to `saveImage(data:)`.

3. `saveImage(data: Data)`:
   - Same auth flow as above.
   - `PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)`.

**Notes**:
- No album creation. The asset goes straight to the "All Photos" / camera roll. No "OpenReel" album is created on iOS today.
- Permission is requested with `.addOnly` (Photos add-only API; doesn't require full library access).
- No retries, no progress, no thumbnail generation.

---

## 6. ShareSheet

`ShareSheet` is a one-shot `UIViewControllerRepresentable` over `UIActivityViewController`:

```swift
struct ShareSheet: UIViewControllerRepresentable {
  var activityItems: [Any]
  func makeUIViewController(context:) -> UIActivityViewController {
    UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
  }
}
```

That's the entire file. There are no `excludedActivityTypes`, no custom `applicationActivities`, no completion callback. The parent screen creates the sheet with `activityItems: [exportedFileURL]` (a single `URL` to the temp file produced by `ProjectExportService`). UIKit infers UTType from the file extension (`.mp4`, `.mov`, `.gif`) and offers the system's standard apps: Messages, Mail, AirDrop, Save to Files, Save Video / Save Image, Copy, plus any installed share extensions (Instagram, TikTok, WhatsApp, etc.).

What's included in the share payload: **only the file URL**. No metadata, no caption text, no preview thumbnail override, no project JSON.

---

## 7. Edge cases

| Scenario | iOS behavior today |
|---|---|
| Out of storage during write | `AVAssetWriterInput.append` returns false -> `.exportFailed(writer.error?.localizedDescription)`; partial file is removed in catch. No proactive free-space check before starting. |
| Phone call / interruption | AVFoundation continues (no `AVAudioSession` is configured by this service); typically unaffected. Audio session collisions are not handled here. |
| App backgrounded | No `beginBackgroundTask`; iOS will eventually suspend the process and the writer fails. User must restart export. |
| Very long projects | `duration` derives from `composition.duration`, project timeline, or `0.1` minimum. No special chunking; everything streams through a single reader+writer pass. Memory is bounded by pixel buffer pool size (Metal-compatible BGRA). Estimate time grows linearly with `duration * megapixels * baseFactor`. |
| Cancelled mid-flight | Both inputs are stopped, partial file deleted, throws `"The export was cancelled."` |
| No video clips | `.noVideoTracks` -> "Export currently requires at least one visible video clip." |
| No clips at all | `.noPlayableTracks` -> "Add video or audio clips before exporting." |
| Unsupported file type | `.unsupportedFileType` -> "This device does not support the current export format." |
| ProRes on devices without HW encoder | Falls through to whatever AVFoundation reports; surfaces as writer error. No explicit pre-flight check. |
| Bitrate above device capability | Same; relies on AVFoundation. |
| Memory pressure (4K @ 60 fps with many effects) | No guards; CIContext is Metal-backed which helps, but no frame-rate throttling or quality fallback. |
| Empty title sanitization | `"OpenReel-Export"` is used. |
| Filename collision | Timestamped per-export, so unlikely; pre-write `removeItem` ensures clean slate. |
| GIF with quality 0.2 and frameRate 60 | Effective GIF fps = min(60, round(8)) = 8 fps. |
| GIF with quality 1.0 and frameRate 24 | Effective GIF fps = min(24, round(15)) = 15 fps. |
| Audio with effects + cancellation during offline render | Offline render runs before reader/writer setup; cancelling at that stage is not propagated explicitly (it's synchronous via `TimelineAudioOfflineRenderer.render`). After it completes, the processed file is cleaned up in `defer`. |
| Photos permission denied | `PhotoLibraryExportSaver.SaveError.permissionDenied` thrown; parent should alert the user. |
| Photos save fails | `.creationFailed` thrown. |

---

## 8. Android mapping suggestions

Below: a direct 1:1 mapping plan. Names map iOS -> Android.

### 8.1 Data models

Mirror `OpenReelProject.ExportPreferences` in Kotlin as a `@Serializable` data class with the exact same fields: `preset`, `resolution(width,height)`, `frameRate: Double`, `format(container, codec, proResProfile?)`, `quality: Float`. Use sealed classes / enums for `ExportPreset`, `ExportContainer (MP4, MOV, GIF)`, `ExportCodec (H264, HEVC, PRORES, GIF)`, `ProResProfile (PROXY, LT, STANDARD, HQ)`. Note: Android **cannot encode ProRes** natively (no MediaCodec support); either:
- Hide ProRes options on Android, or
- Bundle FFmpeg (e.g. `FFmpegKit`) and use it for ProRes only — accepting binary-size cost.

### 8.2 Encoding pipeline

Use **AndroidX Media3 Transformer** (recommended for 1:1 effort) — it provides AVMutableComposition-style composition (`EditedMediaItemSequence`, `EditedMediaItem`, `Composition`), per-frame `Effects` (custom `GlEffect` for the equivalent of CIFilters), audio mixing, progress callbacks, and cancellation. It outputs MP4 (H.264 / H.265).

| iOS construct | Media3 equivalent |
|---|---|
| `AVMutableComposition` | `Composition` / `EditedMediaItemSequence` |
| `AVMutableVideoComposition` + CIFilter handler | `Effects` with custom `GlEffect`s |
| `AVAudioMix` | `AudioProcessor` chain attached per `EditedMediaItem` |
| `AVAssetReader` + `AVAssetWriter` | `Transformer` (single class manages both) |
| `videoSettings`/`audioSettings` | `TransformationRequest` + `Transformer.Builder` (set bitrate/codec/resolution) |
| `progress` callback | `Transformer.Listener.onTransformationProgressUpdate` + `getProgress(holder)` |
| Cancellation | `Transformer.cancel()` |

For container = MOV, Media3 supports `.mov` output via `Muxer` configuration; if unavailable for the codec mix you need, remux via MediaMuxer or fall back to FFmpeg.

If Media3 doesn't cover something (e.g. ProRes, GIF), drop to **`MediaCodec` + `MediaMuxer`** directly. Pipeline shape:
1. Decode each source via `MediaCodec` (async surface decoder) -> GL texture.
2. Composite on a shared `EGLContext` using shaders mirroring `VideoEffectRenderer`.
3. Push the composited frame to an encoder `MediaCodec` input surface (CONFIGURE for H264 / HEVC via `MediaFormat.MIMETYPE_VIDEO_AVC / HEVC`, set `KEY_BIT_RATE`, `KEY_FRAME_RATE`, `KEY_I_FRAME_INTERVAL = 2`, `KEY_COLOR_FORMAT = COLOR_FormatSurface`).
4. Mux video + audio with `MediaMuxer` (`OutputFormat.MUXER_OUTPUT_MPEG_4`).

Keyframe interval mapping: iOS uses ~ `frameRate * 2` frames; Android's `MediaFormat.KEY_I_FRAME_INTERVAL` is in **seconds** -> set to `2`.

Bitrate constants from section 1.11 should be reused verbatim — Android encoders accept the same numeric bitrates.

### 8.3 Audio

Use Media3's `AudioProcessor` chain for pan + audio effects, or pre-render with `AudioTrack`/OpenSL/Oboe + a custom mixer if you need full parity with `TimelineAudioOfflineRenderer`. Encode AAC at 128 kbps (h264/hevc) or LPCM (ProRes path) with `MediaCodec` AAC encoder (`audio/mp4a-latm`, `KEY_AAC_PROFILE = AACObjectLC`, `KEY_SAMPLE_RATE = 48000`, `KEY_CHANNEL_COUNT = 2`, `KEY_BIT_RATE = 128000`).

### 8.4 GIF

There is no built-in GIF encoder on Android. Recommended encoders:
- **AnimatedImageDrawable + ImageDecoder** (decode-only, can't encode).
- **`android-gif-encoder`** (small Java GIF encoder library, palette = NeuQuant) — use this for parity with iOS.
- **`Glide`'s `GifEncoder`** is internal; prefer a standalone library.
- For best quality, run FFmpeg with `palettegen` + `paletteuse`.

Mirror iOS behavior:
- `loopCount = 0` (infinite).
- Frame delay = `1 / gifFps` seconds.
- `gifFps = min(prefs.frameRate, round(8 + ((clamp(quality,0.2,1)-0.2)/0.8) * 7))`.
- Dimensions = chosen `resolution`.
- No audio.
- Output extension `.gif`.

Pipeline: decode each source frame via Media3 `FrameProcessor` -> Bitmap (or read PBO from GL) at `renderSize`, feed into the GIF encoder one frame at a time, finalize.

### 8.5 Saving to "Photos" (MediaStore)

Replace `PhotoLibraryExportSaver` with **MediaStore**:
- Video: `MediaStore.Video.Media.EXTERNAL_CONTENT_URI`, ContentValues with `DISPLAY_NAME`, `MIME_TYPE = "video/mp4"` (or `video/quicktime` for .mov), `RELATIVE_PATH = "Movies/OpenReel"` (this creates the "OpenReel" album equivalent), `IS_PENDING = 1` while writing, then set to `0`.
- GIF: `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`, MIME `image/gif`, `RELATIVE_PATH = "Pictures/OpenReel"`.

Permissions:
- Android 13+ (`TIRAMISU`): no permission needed for own files via scoped MediaStore.
- Android <= 12: `WRITE_EXTERNAL_STORAGE` (request at runtime).
- If you want to read other people's media to import (separate concern), request `READ_MEDIA_VIDEO` / `READ_MEDIA_IMAGES`.

Error mapping:
- `permissionDenied` -> `SecurityException` from `ContentResolver.insert`.
- `creationFailed` -> any `IOException` / null URI from insert / OutputStream.

### 8.6 ShareSheet -> Intent.ACTION_SEND

```kotlin
val uri = FileProvider.getUriForFile(context, "$packageName.fileprovider", exportedFile)
val mime = when (extension) { "mp4" -> "video/mp4"; "mov" -> "video/quicktime"; "gif" -> "image/gif"; else -> "*/*" }
val intent = Intent(Intent.ACTION_SEND).apply {
    type = mime
    putExtra(Intent.EXTRA_STREAM, uri)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
}
context.startActivity(Intent.createChooser(intent, "Share export"))
```

Mirror iOS's "include only the file URL" — no caption text. Register a `FileProvider` for the app's cache/files dir to grant temporary read access.

### 8.7 Cancellation + foreground service

Wrap the whole export in a **foreground service** (`Service` with `startForeground(notificationId, notification)`) so the OS doesn't kill it when the app is backgrounded. Use a `CoroutineScope` tied to the service; expose a `cancel()` that maps to `Transformer.cancel()` and propagates `CancellationException`. The notification mirrors `ExportProgressView`: stage title + percent + cancel action.

For Android 14+ declare `foregroundServiceType="mediaProcessing"` (or `dataSync`) in the manifest and request `FOREGROUND_SERVICE_MEDIA_PROCESSING` permission.

### 8.8 UI parity

Reuse the section layout 1:1 in Jetpack Compose:
- Presets row -> `LazyRow` of `FilterChip`-like cards.
- Resolution grid -> `LazyVerticalGrid(GridCells.Fixed(2))`.
- Frame rate chips -> `Row` of toggle chips.
- Format grid -> `LazyVerticalGrid(GridCells.Fixed(2))` with 9 cards (omit/disable ProRes if not implemented).
- Quality slider -> `Slider(value, range = 0.2f..1f, steps = 15)` (16 stops for step 0.05).
- Estimate card -> `Column` with 4 rows; use `android.text.format.Formatter.formatFileSize` for size and a manual `mm:ss` / `hh:mm:ss` formatter for time.
- Progress overlay -> `Dialog` with `LinearProgressIndicator` and a destructive "Cancel Export" button.

### 8.9 Defaults reference (copy verbatim into Android constants)

```
AUDIO_SAMPLE_RATE = 48_000
AUDIO_CHANNELS    = 2
AAC_BITRATE       = 128_000
PRORES_PCM_BITRATE = 1_536_000

H264_MIN_BASE = 1_400_000
H264_MAX_BASE = 4_200_000
H264_MIN      =   900_000
H264_MAX      = 28_000_000

HEVC_MIN_BASE =   900_000
HEVC_MAX_BASE = 2_800_000
HEVC_MIN      =   650_000
HEVC_MAX      = 20_000_000

PRORES_PROXY    =  45_000_000
PRORES_LT       = 100_000_000
PRORES_STANDARD = 147_000_000
PRORES_HQ       = 220_000_000

KEYFRAME_INTERVAL_SECONDS = 2

QUALITY_RANGE = 0.2f..1f
QUALITY_STEP  = 0.05f

GIF_MIN_FPS   = 8
GIF_MAX_FPS   = 15
GIF_LOOP      = 0   // infinite
GIF_MIN_SIZE_BYTES = 128_000
GIF_FILE_SIZE_QUALITY_OFFSET = 0.16
GIF_FILE_SIZE_QUALITY_SLOPE  = 0.18

ESTIMATE_TIME_FACTOR_H264   = 0.75
ESTIMATE_TIME_FACTOR_HEVC   = 0.9
ESTIMATE_TIME_FACTOR_PRORES = 1.4
ESTIMATE_TIME_FACTOR_GIF    = 1.15
```

---

End of EXPORT spec.
