# Openreel Video — Android Port Guide

> **Offline architecture (2026-08-08):** OpenReel's cloud-GPU worker, auth
> broker, and network clients are removed. The mobile apps must remain fully
> usable offline. Smart tools use platform media APIs and on-device ML only.

This directory documents the iOS app **Openreel Video** (SwiftUI, ~77 Swift files, ~50k LOC) in enough detail for an Android team to rebuild it 1:1 in Kotlin.

Goal: **feature-parity and visual parity** with iOS. Every screen, every panel, every parameter, every preset, every gesture is captured here. We build custom views to match iOS pixel-for-pixel — no off-the-shelf "Material Design" shortcuts.

---

## Source of Truth

iOS code lives at: `/Users/augustusotu/Projects/openreel/Openreel Video/Openreel Video/`

When this doc and the Swift source disagree, **the Swift source wins**. Update the doc.

---

## How to Read This Guide

The docs are split into 8 sections. Read them in order if you're new; jump around if you're implementing one feature.

| # | Doc | Covers |
|---|-----|--------|
| 01 | [App Structure & Navigation](01-app-structure-navigation.md) | App entry, RootView, HomeView, ProjectsView, Onboarding, NewProjectSheet, Theme tokens |
| 02 | [Data Models & State](02-data-models-and-state.md) | `OpenReelProject` schema, Track/Clip/Layer, `ProjectStore`, `ActionHistory`, full `AppState` API |
| 03 | [Editor Shell](03-editor-shell.md) | EditorView layout, header, preview canvas, playback controls, timeline, tab bar, inspector panels, shared editor components |
| 04 | [Playback & Rendering](04-playback-rendering.md) | AVFoundation/Metal pipeline, effects catalog, transitions, color scopes, LUT parsing, MetalVideoView |
| 05 | [Media, Text, Audio Features](05-features-media-text-audio.md) | Media import (PHPicker, files, camera), local photo adjustments, Text panel (presets + animations), Audio panel (library, recorder, effects) |
| 06 | [Effects, Graphics, Templates, Subtitles](06-features-effects-graphics-templates-subtitles.md) | Effects/filters/blend modes, shape catalog, built-in templates, SRT subtitles |
| 07 | [Export](07-export.md) | Export sheet options, encoder pipeline, GIF export, share sheet, Photos library save |
| 08 | [On-device Smart Tools, Animation, Shared](08-ai-animation-shared.md) | On-device segmentation/tracking/captions/highlights, keyframe engine + easing, and shared helpers |

---

## Implementation Order (suggested)

We recommend building in this order so each phase has runnable output:

1. **Foundations** (doc 01, 02, parts of 08-shared)
   - Theme tokens (colors, fonts, spacing, radii)
   - Color parsing, time formatting, haptics helpers
   - `OpenReelProject` Kotlin data classes + JSON serializer (kotlinx.serialization)
   - `ProjectStore` (filesystem + thumbnails)
   - `ActionHistory` (undo/redo)
   - Top-level Compose navigation (Onboarding → Home → Editor)
2. **Editor shell** (doc 03)
   - EditorView scaffold: header, empty preview, empty timeline, tab bar
   - Shared editor components (sliders, segmented pickers, color picker, expandable rows)
3. **Playback** (doc 04)
   - ExoPlayer-backed `PlaybackController` matching iOS signature
   - Timeline composition builder (ExoPlayer concatenating + clipping media sources)
   - MetalVideoView equivalent (SurfaceView + OpenGL/Vulkan or Media3 effects)
4. **Media import** (doc 05 — Media section)
   - Android PhotoPicker, file picker, CameraX recorder
   - Add clip → timeline insertion
5. **Timeline editing** (doc 03 — Timeline section)
   - Track rendering, clip thumbnails, drag/trim/split, snapping, multi-select
6. **Text & graphics** (docs 05-text, 06-graphics)
7. **Effects, transitions, color** (docs 04, 06-effects)
   - Port each effect — match parameter ranges and defaults exactly
   - LUT support via .cube parser
8. **Audio** (doc 05 — Audio section)
   - Audio tracks, mixer, EQ/reverb/compressor/ducking
   - Voiceover recorder
9. **Templates & subtitles** (doc 06)
10. **Export** (doc 07)
    - Media3 Transformer pipeline
    - GIF encoder
    - Save to MediaStore, Intent.ACTION_SEND share
11. **On-device smart tools** (doc 08)
    - Segmentation and tracking with Vision/ML Kit
    - Tracking-derived reframe/stabilization keyframes
    - Local captions, procedural music, and highlight analysis where supported

---

## Non-Negotiable Rules for the Android Build

- **Visual parity**: every color, padding, corner radius, font weight must match iOS. Quote the iOS modifier in code comments only if the value is non-obvious; otherwise just match.
- **No Material chrome leaking through**: no ripple effects where iOS uses opacity dim; no FABs where iOS uses tab-bar buttons; no Material `TopAppBar` styling. Build custom views.
- **Custom views, every screen**: don't reach for `BottomNavigation`, `Scaffold` defaults, `ModalBottomSheet` defaults if they look Android-ish. Match iOS sheet detents, drag handles, corner radius, blur backgrounds.
- **Haptics on every interaction iOS hits** — see doc 08, haptic helpers section, for the full event list.
- **Identical JSON project format**: Android must read/write the same `.openreel` files that iOS produces. Cross-platform projects are a future requirement; the schema must match exactly today.
- **No OpenReel GPU API**: smart-tool work must stay on-device; the old Worker protocol in doc 08 is historical only.
- **Same effect math**: shaders/CIFilter params must produce visually identical output. When in doubt, render the same frame in iOS and Android, side-by-side compare.

---

## Tech Stack (recommended)

| Concern | Android choice | iOS equivalent |
|---|---|---|
| UI | Jetpack Compose | SwiftUI |
| State | `StateFlow` + `ViewModel` per screen + shared `AppRepository` | `AppState` `@Published` |
| Persistence | filesystem JSON + thumbnails (mirror iOS layout) | `ProjectStore` |
| Video playback | Media3 ExoPlayer | AVPlayer |
| Video composition | Media3 Transformer + effects | AVMutableComposition + AVVideoComposition |
| GPU effects | Media3 GL effects + custom shaders | Metal + CIFilter |
| Audio | AudioTrack + OpenSL/AAudio + custom DSP, or Oboe | AVAudioEngine |
| Photo picker | androidx PhotoPicker | PHPickerViewController |
| Camera | CameraX | AVCaptureSession |
| ML on-device | MLKit / ONNX Runtime / TFLite | Vision, CoreML |
| Haptics | `Vibrator` (Android 12+ predefined effects) | UIImpactFeedbackGenerator |
| Animation | Compose Animation, dynamic-animation | SwiftUI animations |
| Image loading | Coil | AsyncImage / CIImage |

---

## Open Questions for Product

Things the iOS code does that we should confirm before building on Android:

- Subscription / paywall: iOS has App Store entitlements — does Android use Play Billing with the same SKUs? (Check `AppState` for IAP entry points.)
- HDR export: iOS captures and exports HDR on supported devices — Android equivalent (HDR10/Dolby Vision via Media3) needs device gating.
- Confirm each smart tool has an on-device implementation before exposing it.
- Fonts: iOS uses SF Symbols + custom fonts — we need the custom font files vendored into Android.

---

## Maintenance

- Treat these docs as living. If an iOS feature changes, update the relevant section in the same PR.
- Each section's "Source files" header lists exactly which Swift files were read to produce it — start there when verifying current behavior.
- Cross-platform JSON schema lives in doc 02. Any schema change must land on iOS, Android, web, and desktop at the same time when relevant.
