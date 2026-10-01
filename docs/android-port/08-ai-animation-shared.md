# OpenReel Mobile — On-device Smart Tools, Animation, and Shared Helpers

> **Offline contract (2026-08-08):** Both mobile apps operate without an
> internet connection. Do not add job APIs, uploads, authentication brokers,
> remote model downloads, or network fallbacks. A feature that cannot work
> locally must be hidden until a bundled/on-device implementation exists.

This document describes the current mobile architecture. It replaces the
retired cloud-worker protocol.

## Source of truth

### iOS

- `Core/AI/MediaAnalysisService.swift`
- `Core/AI/AIFrameContextBuilder.swift`
- `Core/AI/AIMaskCompositor.swift`
- `Core/AI/TrackingPathKeyframeAdapter.swift`
- `Core/Subtitles/OnDeviceCaptionService.swift`
- `Core/Subtitles/CaptionTimelineMapper.swift`
- `Core/Export/LocalHighlightAnalyzer.swift`
- `Core/Animation/KeyframeEngine.swift`
- `Core/Animation/EasingFunctions.swift`

### Android

- `core/ai/MLKitObjectTracker.kt`
- `core/ai/TrackingPathKeyframeAdapter.kt`
- `core/audio/MusicLibrary.kt`
- `core/export/LocalHighlightAnalyzer.kt`
- `core/animation/KeyframeEngine.kt`
- `core/animation/EasingFunctions.kt`

## 1. Offline invariant

- Android removes `INTERNET` and `ACCESS_NETWORK_STATE` from its merged
  manifest, including permissions introduced by transitive dependencies.
- Android app backup is disabled so project media and preferences are not
  copied through a cloud backup service.
- iOS media pickers set `showsCloudItems = false`.
- iOS speech recognition is exposed only when an installed recognizer reports
  `supportsOnDeviceRecognition`; requests set
  `requiresOnDeviceRecognition = true`.
- Android text-to-speech selects an installed voice whose
  `isNetworkConnectionRequired` flag is false.
- Filter LUTs required by the catalog are bundled with each app and verified
  by checksum before use.
- `scripts/check-mobile-offline.mjs` enforces these rules and rejects known
  network/client symbols in shipping mobile sources.

The device may still use local GPU/NPU/DSP hardware. “No cloud GPU” does not
mean “software rendering only”; it means no paid remote compute and no upload.

## 2. Current smart-tool mapping

| Feature | iOS | Android | Offline behavior |
|---|---|---|---|
| Subject/person segmentation | Vision person segmentation | Local effect/ML Kit path where supported | Produces a local mask; no upload |
| Object/subject tracking | Vision tracking | ML Kit object tracking | Converts detections into editor keyframes |
| Background removal / subject effects | Vision + Core Image/Metal | Local effects pipeline | Rendered on device |
| Auto Reframe | Tracking-derived transform path | Tracking-derived transform path | Centers the tracked subject with keyframes |
| Stabilize | Local motion/tracking analysis | Counter-motion tracking keyframes | No server fallback |
| Captions | Installed on-device Speech model | SRT/local caption editing | iOS button is unavailable without a local model |
| Shorts/highlights | Sampled-frame motion/detail scorer | Sampled-frame motion/detail scorer | Ranks candidate windows locally |
| Music generation | Local music tools | Prompt-guided procedural WAV synthesis | Creates a project-local audio file |
| LUT filters | Bundled `.cube` asset | Bundled `.cube` asset | Never downloaded |

Model-heavy features without a credible bundled implementation—such as stem
separation, arbitrary generative image repair, and general translation—are not
presented as working actions. Do not restore placeholder buttons for them.

## 3. Tracking to keyframes

Tracking produces normalized points over source time. The adapter converts
those samples into the shared project keyframe model:

1. Resolve the selected local media file.
2. Sample frames within the selected clip's source-time window.
3. Run the platform's on-device detector/tracker.
4. Normalize the detected center to the editor coordinate system.
5. Replace the prior generated position path for that mode.
6. Store position keyframes on the clip and refresh playback.

Track Subject follows the detected point. Auto Reframe turns the path into the
transform needed to keep the subject near the canvas center. Stabilize applies
the inverse of estimated motion. Empty or low-confidence analyses fail safely
without fabricating a successful result.

## 4. On-device captions

The iOS caption service sends a local media URL to Speech and maps timed word
segments into subtitle groups. The service must reject recognizers that need a
network connection. Caption creation is therefore capability-gated, not
silently routed online.

Android currently supports SRT import and complete local subtitle styling and
editing. Automatic transcription must stay hidden until an Android offline
speech model is bundled and tested across supported ABIs.

## 5. Local highlight analysis

The highlight analyzer samples downscaled frames, computes motion change and
edge/detail energy, aggregates scores over target-length windows, and returns
ranked candidates. Shorts generation combines that content score with the
existing local virality heuristics. If frames cannot be decoded, the app falls
back to deterministic timeline windows.

## 6. Keyframe engine

Keyframes are sorted by time. Sampling clamps before the first and after the
last keyframe, locates the surrounding pair, applies the outgoing keyframe's
easing function to normalized progress, and interpolates scalar or vector
values. Supported easing includes linear, ease-in, ease-out, ease-in-out,
bounce, elastic, and spring variants used by the editor.

Keep generated tracking keyframes in the same project schema as manual
keyframes so preview, export, undo/redo, and cross-platform project files use a
single rendering path.

## 7. Implementation checklist

- The feature works in airplane mode on a clean install.
- No permission, client library, URL, token, credential, or remote model fetch
  is required.
- Any model or LUT is bundled and included in size/license review.
- Capability-gated UI explains why a local model/voice is unavailable.
- Generated assets are written into project-local storage and survive reopen.
- Preview and export consume the same project data.
- `node scripts/check-mobile-offline.mjs` passes.
- Android compilation/unit tests and iOS simulator tests pass.

## 8. Shared helpers

Color parsing, time formatting, haptics, project cards, and theme tokens remain
ordinary local utilities. They must not start networking as a side effect.
Cross-platform project schema changes should be coordinated across iOS,
Android, web, and desktop when relevant.
