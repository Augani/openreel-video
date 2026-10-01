# 05 — Feature Panels: Media, Text, Audio

> **Offline architecture (2026-08-08):** The retired remote-tool sheets and job client
> are removed. This document describes only shipping local features.

This document is an exhaustive 1:1 spec of the Media, Text, and Audio editor panels in the iOS app "Openreel Video" so that Android engineers can rebuild it in Kotlin/Compose. Every panel row, sheet, slider range, default, swatch, picker flow, and permission is captured here. Where a number, hex code, range, or text label appears below, it must be reproduced verbatim.

Common visual scaffolding (used by every panel):

- `EditorPanelContainer(title, subtitle, symbol, onBack)` — title/back-button header strip at the top of every panel.
- `EditorMenuRow(title, subtitle, symbol, accentColor?, showsDisclosure=true, isEnabled=true, action)` — a tappable list row. The default look is an icon tile (~32x32, 10pt corner) + 2-line text + optional chevron.
- `PanelActionTile(title, subtitle, symbol, action)` — a square card for grid layouts (118pt min height, 12pt padding, 12pt radius, white opacity 0.06 border).
- `PresetGridCard(title, subtitle, symbol, isSelected, accentColor, action)` — selectable grid card.
- `CompactSliderRow(label, value, range, format?, onChange)` — horizontal slider with leading label and trailing formatted value.
- `SwatchButton(hex, isSelected, action)` — color swatch chip.
- Grid columns everywhere: `[GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]` — i.e. two equal columns with 10pt spacing.
- All sheets present at `.fraction(0.5)` detent with a drag indicator and `.ultraThinMaterial` background.
- Haptics: `UIImpactFeedbackGenerator(style: .light)` on most tappable tiles/rows; `.medium` when starting a run; `UINotificationFeedbackGenerator` `.success`/`.error` on completed local operations.

Theme tokens referenced repeatedly:

- `OpenReelTheme.accent` — accent color used for highlights, active swatches, "Add to Timeline" buttons.
- `OpenReelTheme.destructive` — red used for delete/cancel actions.
- `OpenReelTheme.textPrimary`, `OpenReelTheme.textSecondary` — text foreground colors.
- `OpenReelTheme.background`, `OpenReelTheme.surface`, `OpenReelTheme.surfaceElevated` — backgrounds.

Android mapping (global):

- `EditorPanelContainer` → Compose `Scaffold` with a custom top header row (IconButton back + title/subtitle/symbol).
- `EditorMenuRow` → `ListItem` with leading icon (24-32dp), title (14sp bold), subtitle (11sp medium), trailing chevron when `showsDisclosure`.
- `PanelActionTile`/`PresetGridCard` → `Card` (`RoundedCornerShape(12.dp)`, 1dp white 6% border) inside `LazyVerticalGrid(GridCells.Fixed(2), spacing 10.dp)`.
- `CompactSliderRow` → Material 3 `Slider` with leading `Text` and trailing value text.
- `SwatchButton` → small circular `Box` tinted via `Color(android.graphics.Color.parseColor(hex))`.
- Sheets at fraction(0.5) → `ModalBottomSheet` with `skipPartiallyExpanded = false`, half-expanded by default. Background can be the closest analogue to ultraThinMaterial (translucent blur).
- Haptics → `HapticFeedback.LocalHapticFeedback` for light/medium taps; `Vibrator` for success/error patterns.

---

## 1. Media Panel (`MediaTabPanel`)

### 1.1 Header

- Title: `Media`
- Subtitle: `Import, preview, and place clips`
- Symbol: `photo.on.rectangle` (Android: `R.drawable.ic_photo_on_rectangle` or Material `PhotoLibrary`).

### 1.2 Layout (top to bottom, single `ScrollView`, 16pt vertical spacing)

All rows are `EditorMenuRow` instances:

1. **Photos** — symbol `photo.stack`. Subtitle `Import videos and images from Photos`. `showsDisclosure = false`. Tap → opens fullScreen `MediaPicker` (PHPickerViewController).
2. **Camera** — symbol `camera.fill`. Subtitle `Record or capture new media`. `showsDisclosure = false`. Tap → fullScreen `CameraCaptureView` (UIImagePickerController).
3. **Files** — symbol `folder.fill`. Subtitle `Import video, image, or audio files`. `showsDisclosure = false`. Tap → sheet `DocumentMediaPicker` (UIDocumentPickerViewController).
4. **Selected Item** — symbol `target`. Subtitle = name of the currently selected media item, fallback `Preview selection`. `showsDisclosure = false`. Disabled when `appState.selectedMediaItem == nil`. Tap → opens `MediaPreviewSheet` for that item.
5. **Project Media** — symbol `rectangle.stack`. Subtitle `Browse {N} imported items` where N = `appState.availableProjectMedia(in: project).count`. Tap → Project Media sheet (see 1.6).

Bottom padding: 10pt.

### 1.3 PHPicker Photos flow (`MediaPicker.swift`)

Configuration:

- `PHPickerConfiguration(photoLibrary: .shared())`
- `filter = .any(of: [.videos, .images, .livePhotos])`
- `selectionLimit = 0` (unlimited)
- `preferredAssetRepresentationMode = .current`
- `selection = .ordered`

Result handling:

- For each `PHPickerResult`, the loader probes UTIs in this priority: `UTType.movie` → `UTType.video` → `UTType.image` → `UTType.audio`.
- File is loaded via `NSItemProvider.loadFileRepresentation`, then copied into `NSTemporaryDirectory()/<UUID>.<ext>` and wrapped as `ImportedMediaAsset(sourceURL, fileName, assetIdentifier, mediaType)`.
- File name is taken from `provider.suggestedName`; if missing extension, falls back to source URL extension or `UTType.preferredFilenameExtension`.

Errors:

- `MediaPickerError.unsupportedType` → "The selected file type is not supported." (silent — view falls back to cancel).

Permissions iOS: PhotoKit (`NSPhotoLibraryUsageDescription`).

Android mapping:

- `androidx.activity.result.PickVisualMedia` with `PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)` for modern photo picker (Android 13+), or `PickMultipleVisualMedia` for unlimited selection.
- Copy the returned `Uri` content into app cache (`context.cacheDir`) so the editor has a stable file URL.
- Detect MIME via `ContentResolver.getType(uri)` then dispatch image/video/audio.
- Permissions: on Android 14+ use the photo picker with no runtime permission; on older use `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` (Android 13) or `READ_EXTERNAL_STORAGE` (Android <=12).

### 1.4 Camera flow (`CameraCaptureView` in `MediaInputViews.swift`)

- Uses `UIImagePickerController` with `sourceType = .camera` (falls back to `.photoLibrary` if camera unavailable).
- `mediaTypes = [UTType.movie.identifier, UTType.image.identifier]` — captures both photos and videos.
- `videoQuality = .typeHigh`.
- Captured video → copied to `NSTemporaryDirectory()/Camera-<unix>.mov` and emitted as `ImportedMediaAsset(mediaType: .video)`.
- Captured still → JPEG, compression quality 0.9, file `Camera-<unix>.jpg`, emitted as `ImportedMediaAsset(mediaType: .image)`.

Permissions iOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`.

Android mapping:

- For full feature parity (resolution control, both video/photo modes), use **CameraX** (`androidx.camera.*`) with `ImageCapture` + `VideoCapture` use cases. For a simpler flow, use `ActivityResultContracts.TakePicture` and `ActivityResultContracts.CaptureVideo`, but those don't expose quality settings.
- Permissions: `CAMERA`, `RECORD_AUDIO` (for video).

### 1.5 Document picker (`DocumentMediaPicker`)

- `UIDocumentPickerViewController(forOpeningContentTypes: [.movie, .video, .image, .audio, .mpeg4Movie, .quickTimeMovie, .mp3, .wav, .mpeg4Audio], asCopy: true)`.
- `allowsMultipleSelection = true`.
- For each picked URL: calls `startAccessingSecurityScopedResource`, copies to `NSTemporaryDirectory()/<UUID>.<ext>`, infers `ImportedMediaType` from the file extension's `UTType` (audio → audio, image → image, else video).

Android mapping:

- `ActivityResultContracts.OpenMultipleDocuments` with MIME filters `video/*`, `image/*`, `audio/*`.
- Persist via `ContentResolver.openInputStream` + copy to cache.

### 1.6 On-device smart-tool placement

The Media panel has no generic smart-tool sheet and no job progress UI. Import,
preview, and project-library actions stay here. Clip-specific on-device Vision,
tracking, reframe, stabilization, and background tools live in the Effects
panel. Local highlight/shorts generation lives with export/publishing tools.

### 1.7 Project Media sheet

Header HStack: `Project Media` (14pt bold rounded) on left, count (12pt monospaced bold accent) on right.

Empty state card (when `mediaItems.isEmpty`):

- `rectangle.stack.badge.plus` icon (28pt accent).
- Text: `Import something to start building the timeline.`
- 28pt vertical padding, 14pt corner card.

Non-empty: 2-column `LazyVGrid` of `mediaCard` tiles. Each card:

- Aspect ratio thumbnail (16:10, fill, clipped).
- Top-left circular accent badge (24x24) with media type symbol (video=`film.stack`, audio=`waveform`, image=`photo`).
- Bottom-right time pill (`mediaItem.metadata.duration.shortClock()`, 10pt monospaced bold white on black 65% capsule).
- Top-right `In Use` pill (9pt bold rounded white on accent 92% capsule) when the clip is on the timeline.
- Below thumbnail: name (12pt semibold rounded, 1 line) + detail line (10pt medium):
  - Audio: `{CODEC} · {sampleRate/1000} kHz`
  - Video/Image: `{width}x{height} · {CODEC}`
- For audio items, thumbnail is a waveform: 24 capsules of width 4pt, height `max(8, sample * 44)`, accent 75% color, drawn over `surfaceElevated` rounded rect (10pt corner).
- Tap → opens `MediaPreviewSheet` for that item.

Android mapping: same layout via `Card { Column { Box(thumb) ... Text(name) Text(detail) } }`. For audio waveform use a `Row { repeat(24) { Box(width=4.dp, height=peakDp) } }`.

### 1.8 MediaPreviewSheet (presented when a media item is tapped)

Container: `EditorPanelContainer(title = mediaItem.name, subtitle = "{duration} · {WxH or Audio} · {CODEC}", symbol per type)`.

Body VStack (16pt spacing):

- Preview surface:
  - Video: `AVPlayer + VideoPlayer`; aspect ratio = `width/height` (clamped >=1px). Player created `onAppear`, paused/nilled `onDisappear`.
  - Image: `UIImage(contentsOfFile:)`, resizable, scaledToFit. Falls back to `AsyncImage` of thumbnail URL.
  - Audio: vertical waveform of `waveformSamples` (48 capsules, width 4pt, height `max(10, sample * 76)`, accent 85%), with a circular accent play/pause button (42x42) below. Toggles `AVPlayer.play/pause`.
- "Add to Timeline" button — full width, accent background, 14pt corner, height 13pt padding vertical, 15pt bold rounded text, white `plus.circle.fill` icon. Calls `appState.addMediaItemToTimeline(at: playbackController.currentTime)`.
- For images only: secondary "Add as Graphic Overlay" button — `square.on.square.squareshape.controlhandles` icon, surfaceElevated background. Calls `appState.addGraphicsImageClip(...)`.

Aspect ratio for audio preview surface: 16:5.

Android mapping: `ExoPlayer` (`media3`) for video; `Image` + Coil for stills; custom drawn waveform with `Canvas`.

### 1.9 Import behavior (`MediaImportService`)

- Imports run in an `actor`. Each `ImportedMediaAsset` is processed by `prepareImported{Video|Image|Audio}` which:
  - **Video**: loads `AVURLAsset`, the first video track, duration, naturalSize, preferredTransform, nominalFrameRate, format descriptions, audio track count. Derives width/height after applying preferredTransform. Frame rate defaults to 30 if unknown. Codec is 4CC of subtype. Generates a JPEG poster (`AVAssetImageGenerator`, max 720x720, quality 0.82) and a filmstrip of `max(4, min(8, ceil(duration)))` evenly spaced frames. Persists media + thumbnails to project store. Volume defaults to 1.0, fitMode `.contain`, position `(0.5,0.5)`, scale `(1,1)`.
  - **Image**: reads `UIImage`, width/height = `size × scale`. JPEG thumbnail quality 0.82. Default placed `duration = 5.0s`. Volume = 0.
  - **Audio**: reads `AVAudioFile` for sample rate + channel count (fallback 44100/1 or 48000/2). Codec stored as `"aac"`. Generates 48-sample waveform via PCM peak buckets, normalized + clamped to `[0.08, 1]`. Volume = 1.

- Insertion strategy: appends to the appropriate track (`video`, `image` or fallback to video, `audio`). New clips start at `max(existing clip end times, 0)`. Timeline duration extended accordingly.

Android mapping: use **MediaMetadataRetriever** for duration/codec/dimensions, **MediaExtractor** for codec/sample rate, **MediaPlayer**/Exo for playback. Generate frame thumbnails with `MediaMetadataRetriever.getFrameAtTime(timeUs)` or `MediaCodec`+`ImageReader`. Persist into app's private storage (`Context.filesDir/projects/<id>/media/...`).

### 1.10 Photo tools

The former remote Photo Enhancement screen is not part of the shipping mobile
UI. Still images use the normal local Effects controls and render path. Do not
expose restore, object erase, arbitrary upscale, or generative cleanup buttons
until a fully bundled implementation exists.

---

## 2. Text Panel (`TextTabPanel`)

### 2.1 Modes

The same panel renders in two modes:

- `mode = .add` — when adding text to the timeline.
- `mode = .edit` — when a text clip is selected. If the selected text clip belongs to the subtitle/caption track (`appState.isEditingSubtitleTrack` and clip is in `appState.subtitleTextClips()`), the panel enters the **caption track editor**. Otherwise it shows the **single text clip editor**.

Title/subtitle/symbol by state:

| State | Title | Subtitle | Symbol |
|-------|-------|----------|--------|
| add | `Text` | `Titles, captions, and animated overlays` | `textformat` |
| edit clip | `Edit Text` | `Style, motion, and timing controls` | `textformat.size` |
| edit caption track | `Edit Captions` | `Style the whole caption track and edit every cue` | `captions.bubble.fill` |

### 2.2 Add mode

Rows:

1. **Text Presets** — `text.badge.plus`. Subtitle `Choose a title or caption style to place at the playhead`. Tap → presets sheet.
2. Helper card (when no preset chosen): `text.badge.plus` 30pt accent icon + body `Choose a preset to place editable text at the playhead.`

#### 2.2.1 Preset grid (sheet)

Header: `Text Presets` (14pt bold rounded). 2-column `LazyVGrid` of `PresetGridCard`s. Selection shown when `selectedTextClip.metadata["preset"] == preset.id`.

Catalog (`TextPresetCatalog.presets` — 8 presets total):

| id | Name | Subtitle | Symbol | Default Text | Default Duration | Font | Size | Weight | Color | Background | Align | Shadow | Position (x,y) | Scale | Animation (preset / params / inDur / outDur / stagger / unit) |
|----|------|----------|--------|--------------|------------------|------|------|--------|-------|-----------|-------|--------|----------------|-------|--------|
| title-bold | Bold Title | Large centered headline | `textformat.size.larger` | `Your Title` | 4s | SF Pro Display | 76 | bold | #FFFFFF | nil | center | yes | 0.5, 0.42 | 1 | pop / popOvershoot=1.22 / 0.45 / 0.25 / 0.03 / character |
| subtitle-clean | Subtitle | Readable lower caption | `captions.bubble` | `Add a caption` | 5s | SF Pro Display | 38 | bold | #FFFFFF | #000000 | center | no | 0.5, 0.78 | 1 | fade / fadeOpacity {start:0,end:1} / 0.35 / 0.25 / 0.02 / character |
| lower-third | Lower Third | Name and detail label | `person.text.rectangle` | `Name / Role` | 5s | Avenir Next | 34 | bold | #111827 | #4ADE80 | left | no | 0.32, 0.72 | 1 | slideRight / slideDistance=0.22 / 0.45 / 0.25 / 0.04 / character |
| quote-card | Quote | Editorial pull quote | `quote.opening` | `Make the moment count.` | 5s | New York | 52 | 700 | #FFFFFF | nil | center | yes | 0.5, 0.5 | 0.98 | wordByWord / wordDelay=0.16 / 0.9 / 0.35 / 0.12 / word |
| label-pill | Pill Label | Compact callout badge | `tag.fill` | `NEW` | 3s | SF Pro Display | 30 | bold | #052E16 | #4ADE80 | center | no | 0.78, 0.22 | 0.86 | bounce / bounceHeight=0.09, bounceCount=2 / 0.7 / 0.25 / 0.03 / character |
| typewriter-note | Type Note | Character reveal caption | `keyboard` | `Typing something true` | 5s | Menlo | 32 | 600 | #E5E7EB | #111827 | left | no | 0.42, 0.62 | 1 | typewriter / {} / 1.0 / 0.25 / 0.045 / character |
| countdown | Countdown | Bold numeric moment | `timer` | `03` | 3s | SF Pro Display | 118 | bold | #4ADE80 | nil | center | yes | 0.5, 0.48 | 1 | scale / scaleFrom=0.35, scaleTo=1 / 0.35 / 0.2 / 0 / character |
| cta-button | CTA | Action prompt overlay | `hand.tap.fill` | `Tap to follow` | 4s | Avenir Next | 36 | bold | #FFFFFF | #16A34A | center | yes | 0.5, 0.82 | 0.94 | wave / waveAmplitude=0.025, waveFrequency=2 / 0.3 / 0.2 / 0.04 / character |

Default shadow when `shadow: true` is `{ color: "#000000", blur: 12, offsetX: 0, offsetY: 4 }`.
Default `lineHeight = 1.2`, `letterSpacing = 0`, `verticalAlign = .middle`, `fontStyle = "normal"`.

Tap a preset card → `appState.addTextClip(from: preset, at: playbackController.currentTime, ...)`.

### 2.3 Edit Text mode (single clip)

Rows in main panel:

1. **Content** — `text.cursor`. Subtitle = trimmed/cleaned text preview, capped at 36 chars + ellipsis. Fallback `Edit the copy inside this text clip`. Tap → content sheet.
2. **Font & Alignment** — `textformat`. Subtitle `{fontFamily} · {alignment.capitalized}`. Tap → font sheet.
3. **Size & Opacity** — `textformat.size`. Subtitle `{Int(fontSize)}pt · {Int(opacity*100)}%`. Tap → size sheet.
4. **Colors** — `paintpalette`. Subtitle `Text, background, and contrast styling`. Tap → color sheet.
5. **Shadow & Stroke** — `shadow`. Subtitle `{Shadow on/off} · {Stroke on/off}`. Tap → effects sheet.
6. **Animation** — `sparkles`. Subtitle = animation name (from catalog) or `None`. Tap → animation sheet.
7. **Delete Text** — `trash`, destructive accent. Subtitle `Remove the selected text clip from the timeline`. `showsDisclosure = false`. Tap → `appState.deleteSelectedTextClip(...)`.

#### Sheets

- **Content sheet**: `SelectAllTextField` (UIKit-backed) with placeholder `Text`. Auto-selects all on focus. 36pt min height, 12pt padding, 12pt rounded surface bg.
- **Font & Alignment sheet** (combined card, 14pt corners, 14pt padding):
  - Horizontal scrolling font picker with capsule pills (12pt bold rounded). Active pill: accent bg + black text. Inactive: surfaceElevated + secondary text.
  - Fonts (`TextPresetCatalog.fonts`): `SF Pro Display`, `Avenir Next`, `New York`, `Helvetica Neue`, `Menlo`, `Georgia`.
  - Alignment picker — 3 equally wide buttons (left/center/right). Active: accent bg + black icon. Icons: `text.alignleft`, `text.aligncenter`, `text.alignright`. Justify is supported in the model (`text.justify`) but not surfaced in the picker.
- **Size & Opacity sheet**:
  - `Size` slider: `18...160`, label format `{Int(value)}pt`.
  - `Opacity` slider: `0...1`.
- **Colors sheet**:
  - `Color` swatch row from `TextPresetCatalog.colorSwatches`: `#FFFFFF, #4ADE80, #FDE047, #38BDF8, #F472B6, #FB7185, #111827`.
  - `Background` swatch row from `TextPresetCatalog.backgroundSwatches`: `none, #000000, #1A1A1A, #14532D, #1E3A8A, #7F1D1D`. Selecting "none" clears the background.
- **Shadow & Stroke sheet**: two `PanelActionTile`s arranged as 2 columns:
  - `Shadow On/Off` (icon `shadow`, subtitle `Readable lift`). Toggles `shadowColor` between `#000000` (with `shadowBlur = 12`) and "none" (`shadowBlur = 0`).
  - `Stroke On/Off` (icon `pencil.line`, subtitle `Outline text`). Toggles `strokeColor` between `#000000` (with `strokeWidth = 3`) and "none" (`strokeWidth = 0`).
- **Animation sheet**: 2-column `LazyVGrid` of `PresetGridCard`s from `TextPresetCatalog.animations`. Selection matches when the clip's `animation` equals the choice's animation (or both are nil). Card data:

| id | Name | Subtitle | Symbol | Preset | Params | inDur | outDur | Stagger | Unit |
|----|------|----------|--------|--------|--------|-------|--------|---------|------|
| none | None | Static title | `circle.slash` | nil | — | — | — | — | — |
| typewriter | Typewriter | Character reveal | `keyboard` | typewriter | {} | 1.0 | 0.3 | 0.05 | character |
| typewriter-fast | Fast Type | Quick character reveal | `text.cursor` | typewriter | {} | 0.55 | 0.2 | 0.025 | character |
| fade | Fade | Soft opacity in | `circle.dashed` | fade | fadeOpacity {start:0,end:1} | 0.5 | 0.25 | 0.02 | character |
| fade-slow | Slow Fade | Long smooth fade | `moonphase.first.quarter` | fade | fadeOpacity {start:0,end:1} | 1.1 | 0.45 | 0.04 | character |
| slide-up | Slide Up | Enter from below | `arrow.up.to.line` | slideUp | slideDistance=0.22 | 0.45 | 0.25 | 0.08 | word |
| slide-down | Slide Down | Enter from above | `arrow.down.to.line` | slideDown | slideDistance=0.22 | 0.45 | 0.25 | 0.08 | word |
| slide-left | Slide Left | Enter from right | `arrow.left.to.line` | slideLeft | slideDistance=0.24 | 0.45 | 0.25 | 0.04 | character |
| slide-right | Slide Right | Enter from left | `arrow.right.to.line` | slideRight | slideDistance=0.24 | 0.45 | 0.25 | 0.04 | character |
| scale | Scale | Grow into frame | `arrow.up.left.and.arrow.down.right` | scale | scaleFrom=0.25, scaleTo=1 | 0.45 | 0.25 | 0.03 | character |
| scale-subtle | Subtle Scale | Small lift | `plus.magnifyingglass` | scale | scaleFrom=0.82, scaleTo=1 | 0.4 | 0.2 | 0.02 | character |
| blur | Blur | Unblur into focus | `camera.filters` | blur | blurAmount=10 | 0.55 | 0.3 | 0.06 | word |
| bounce | Bounce | Playful entrance | `arrow.down.circle` | bounce | bounceHeight=0.1, bounceCount=3 | 0.8 | 0.3 | 0.05 | character |
| bounce-soft | Soft Bounce | Gentle hop | `arrow.down.circle.dotted` | bounce | bounceHeight=0.05, bounceCount=2 | 0.65 | 0.25 | 0.04 | character |
| rotate | Rotate | Spin into place | `rotate.right` | rotate | rotateAngle=180 | 0.6 | 0.25 | 0.04 | character |
| rotate-small | Tilt In | Small rotation | `rotate.3d` | rotate | rotateAngle=24 | 0.42 | 0.2 | 0.02 | character |
| wave | Wave | Continuous ripple | `water.waves` | wave | waveAmplitude=0.03, waveFrequency=2 | 0.2 | 0.2 | 0.02 | character |
| shake | Shake | Energetic motion | `waveform.path` | shake | shakeIntensity=0.018, shakeSpeed=18 | 0.2 | 0.2 | 0 | character |
| pop | Pop | Overshoot snap | `sparkle.magnifyingglass` | pop | popOvershoot=1.24 | 0.42 | 0.25 | 0.04 | character |
| glitch | Glitch | Digital jitter | `bolt.horizontal` | glitch | glitchIntensity=0.03, glitchSpeed=12 | 0.2 | 0.2 | 0 | character |
| split | Split | Letters part outward | `arrow.left.and.right` | split | splitDirection="horizontal" | 0.5 | 0.25 | 0.02 | character |
| flip | Flip | Card flip reveal | `rectangle.portrait.rotate` | flip | flipAxis="y" | 0.58 | 0.25 | 0.04 | character |
| word-by-word | Word by Word | Spoken rhythm | `text.word.spacing` | wordByWord | wordDelay=0.16 | 0.95 | 0.35 | 0.14 | word |
| rainbow | Rainbow | Cycling color | `paintpalette.fill` | rainbow | rainbowSpeed=1 | 0.2 | 0.2 | 0.02 | character |

Text style model fields (full schema for Android):

```
fontFamily: String
fontSize: Double          // pt
fontWeight: named(String) | numeric(Int)  // e.g. .named("bold") or .numeric(700)
fontStyle: String         // "normal" | "italic"
color: String             // hex "#RRGGBB" or "#RRGGBBAA"
backgroundColor: String?  // hex or nil
strokeColor: String?      // hex or nil
strokeWidth: Double?      // pt
shadowColor: String?      // hex or nil
shadowBlur: Double?       // pt
shadowOffsetX: Double?
shadowOffsetY: Double?
textAlign: .left | .center | .right | .justify
verticalAlign: .top | .middle | .bottom
lineHeight: Double        // multiplier (default 1.2)
letterSpacing: Double     // px (default 0)
textDecoration: String?   // e.g. "underline" | "line-through"
```

Transform model fields (text uses the same `Transform` as media): `position(x,y)` in normalized 0..1, `scale(x,y)`, `rotation` (deg), `anchor(x,y)`, `opacity` 0..1, `borderRadius`, `fitMode`, `crop`.

### 2.4 Caption track editor

Triggered when editing a text clip that belongs to the subtitle/caption track.

Rows in main panel:

1. **Track Style** — `captions.bubble.fill`. Subtitle `Font, size, placement, and animation for the whole caption track`. Tap → caption style sheet.
2. **Caption Text** — `text.quote`. Subtitle `Edit each subtitle cue and review timing`. Tap → caption cues sheet.
3. **Single Clip** — `text.cursor`. Subtitle either `No managed clip available yet` (disabled) or `Jump back to the first caption clip for per-clip edits`. Tap → selects the first managed caption clip (returns to the single-clip edit view).

#### Track Style sheet

Card (14pt corner, surface bg, 14pt padding) containing:

- `Track Style` headline.
- Font picker (same horizontal pill list as single-clip mode).
- `Size` slider `18...160` (`{Int(value)}pt`).
- Position picker — 3 equal-width buttons for `OpenReelProject.SubtitlePosition` (top / middle / bottom). Active: accent bg + black text.
- Animation picker — horizontal scroll of 72x56pt rounded tiles. Choices (`subtitleAnimationStyles`):

| Style | Label | Symbol |
|-------|-------|--------|
| `.none` | None | `text.alignleft` |
| `.wordHighlight` | Highlight | `highlighter` |
| `.wordByWord` | Word Pop | `text.word.spacing` |
| `.karaoke` | Karaoke | `music.mic` |
| `.bounce` | Bounce | `arrow.up.and.down` |
| `.typewriter` | Typewriter | `keyboard` |

- Text Color swatches: same as `TextPresetCatalog.colorSwatches`.
- Background swatches (`subtitleBackgroundSwatches`): `#000000BF, #000000, #1A1A1A, #14532D, #1E3A8A, #7F1D1D` (note the first is 75% black via the BF alpha byte).

#### Caption Text sheet (cue list)

- Headline `Caption Text`.
- Empty state: `captions.bubble` icon (28pt accent) + `Import or generate captions to edit the track here.`
- Otherwise, for each cue (sorted by `startTime` then `id`):
  - Time range header `MM:SS:FF - MM:SS:FF` where frame is `(time%1)*30` (10pt monospaced bold accent).
  - Multiline `TextField` (axis: vertical) with placeholder `Caption` (15pt semibold rounded text primary). Each keystroke calls `appState.updateSubtitleCueText(cueID, text)`.

### 2.5 Android mapping (Text)

- Custom text rendering: prefer Compose's `Text` with `TextStyle`. For stroke + shadow, fall back to drawing via `androidx.compose.ui.graphics.drawscope.DrawScope.drawText` or `NativeCanvas.drawText` with `Paint.setShadowLayer(blur, offsetX, offsetY, color)` and `Paint.style = STROKE`.
- Fonts: ship the iOS-named fonts via `FontFamily(Font(R.font.sf_pro_display))` etc.; map "SF Pro Display" → Roboto Flex / Inter; "New York" → a serif (Source Serif / Roboto Serif); "Menlo" → JetBrains Mono / Roboto Mono.
- Animations: implement each preset as a Compose `infiniteTransition` or `animateFloatAsState` keyed off the text clip lifetime. For per-character/word staging, split the string into glyphs and animate each with a `delayMillis = stagger * index`.
- Caption track cue editor: `LazyColumn` of `Card { Column { Text(timecode) ; OutlinedTextField(... multiline) } }`.

---

## 3. Audio Panel (`AudioTabPanel`)

### 3.1 Header

- Title: `Audio`
- Subtitle: `Music, sound effects, and voiceover`
- Symbol: `music.note`

### 3.2 Layout (top to bottom rows)

1. **Music Library** — `music.note.list`. Subtitle `Import tracks from the device music library`. `showsDisclosure = false`. Tap → `MusicLibraryPicker` (MPMediaPickerController) sheet.
2. **Audio Files** — `folder.badge.plus`. Subtitle `Import audio files from storage`. `showsDisclosure = false`. Tap → `DocumentMediaPicker` filtered to audio only on output.
3. **Selected Clip** — `waveform`. Subtitle = selected media item name, or `Choose a clip with audio to adjust pan, fades, and processing` if none. Enabled only when both `selectedClip` and `selectedMediaItem` exist. Tap → Selected Clip sheet.
4. **Mixer** — `slider.horizontal.3`. Subtitle `Balance track gain, pan, and roles`. Tap → Mixer sheet.
5. **Sound Effects** — `speaker.wave.2`. Subtitle `Generate short effects and place them on the timeline`. Tap → Sound Effects sheet.
6. **Voiceover** — `mic.fill`. Subtitle `Record narration directly into the timeline`. Tap → Voiceover sheet.

### 3.3 Audio sources

#### 3.3.1 Music Library (`MusicLibraryPicker`)

- `MPMediaPickerController(mediaTypes: .music)` with `allowsPickingMultipleItems = true`, `showsCloudItems = false`.
- For each picked `MPMediaItem`, takes `assetURL`, derives file name from `title` (or URL stem) plus extension (defaults `m4a` if missing).
- Emitted as `ImportedMediaAsset(mediaType: .audio)`.

Permission iOS: `NSAppleMusicUsageDescription`.

Android mapping: there is **no direct Apple Music equivalent**. Map to:

- **MediaStore Audio**: `ActivityResultContracts.OpenDocument` with MIME `audio/*`, or query `MediaStore.Audio.Media.EXTERNAL_CONTENT_URI` for an in-app track picker UI.
- Permissions: `READ_MEDIA_AUDIO` on Android 13+, `READ_EXTERNAL_STORAGE` on older.

#### 3.3.2 Audio Files

- Same `DocumentMediaPicker` as the Media panel, but consumed assets are filtered to `mediaType == .audio` only.

Android mapping: `ActivityResultContracts.OpenMultipleDocuments` with `mimeTypes = arrayOf("audio/*")`.

#### 3.3.3 Voiceover Recorder (`VoiceRecordView`)

Layout (inside a 14pt-corner card on surface):

- Header HStack: `Voiceover` label (14pt bold rounded) + elapsed time (12pt monospaced bold, accent when recording, secondary otherwise).
- Level meter: 22 vertical capsules, equal flex width, height `8 + (index%5)*6` pt. Each capsule is filled accent if `index/22 < level`, else white 10%. `level = clamp((averagePower + 60) / 60, 0, 1)`.
- Permission denied warning text in destructive red: `Microphone access is required for voice recording.`
- Two equal-flex 12pt-vertical-padded buttons:
  - Record/Stop: accent bg (mic.fill, black text) when idle → `Record`; destructive bg (stop.fill, white text) when recording → `Stop`.
  - Cancel: surfaceElevated bg, secondary text label `Cancel`. Disabled when not recording and there's no recording on disk.

Recording flow:

- iOS 17+ uses `AVAudioApplication.requestRecordPermission`; older uses `AVAudioSession.requestRecordPermission`.
- On grant: sets session category `.playAndRecord` mode `.spokenAudio` options `[.defaultToSpeaker, .allowBluetoothHFP]`.
- File: `NSTemporaryDirectory()/Voiceover-<unix>.m4a`. Settings:
  - format `kAudioFormatMPEG4AAC`
  - sample rate `44100`
  - channels `1` (mono)
  - encoder quality `.high`
- `recorder.isMeteringEnabled = true`. Metering polled every 80ms via `Timer.publish(every: 0.08)`.
- On Stop: stops recorder, emits `ImportedMediaAsset(mediaType: .audio)`, restores session to `.playback / .moviePlayback`.
- On Cancel: stops recorder, deletes the temp file.

Permissions iOS: `NSMicrophoneUsageDescription`.

Android mapping:

- `MediaRecorder` or `AudioRecord` (lower-level). Suggested:
  - `setAudioSource(MediaRecorder.AudioSource.MIC)`, `setOutputFormat(MPEG_4)`, `setAudioEncoder(AAC)`, `setAudioSamplingRate(44100)`, `setAudioChannels(1)`, `setAudioEncodingBitRate(128000)`.
  - Output to `context.cacheDir/Voiceover-${timestamp}.m4a`.
  - Level metering: poll `MediaRecorder.maxAmplitude` every 80ms, map to 0..1 with `clamp(20*log10(amp/32767)/-60 ... , 0, 1)` or use `AudioRecord` directly for accurate dB.
- Permissions: `RECORD_AUDIO`. Show denial copy verbatim.

#### 3.3.4 Sound Effects (`SoundEffectCatalog`)

A built-in catalog of synthesized short effects (no library download). Each generates a WAV in `NSTemporaryDirectory()`. The synthesizer uses:

- Sample rate: 44100, mono, 16-bit PCM.
- Per-frame: `frequency(t) = effect.frequency + effect.sweep * t/(N-1)`, envelope `sin(π*t) * (1-t)^0.35`, gain 0.72.
- WAV header is hand-built (RIFF / WAVE / fmt 16 / PCM 1ch / data).

Catalog entries (`SoundEffectChoice`):

| id | Name | Subtitle | Symbol | Frequency (Hz) | Duration (s) | Sweep (Hz) |
|----|------|----------|--------|----------------|--------------|------------|
| tap | Tap | Short UI click | `hand.tap` | 740 | 0.16 | 0 |
| pop | Pop | Soft impact | `circle.circle` | 420 | 0.22 | -120 |
| chime | Chime | Bright accent | `bell` | 880 | 0.55 | 180 |
| success | Success | Positive cue | `checkmark.seal` | 660 | 0.62 | 330 |
| whoosh | Whoosh | Fast transition | `wind` | 220 | 0.5 | 520 |
| riser | Riser | Build tension | `arrow.up.forward` | 180 | 0.85 | 700 |

Sound Effects sheet UI: 2-column grid of `PresetGridCard`s (title/subtitle/symbol/accent). Tap → synthesizes the WAV, imports it via `importMediaToLibrary`, then places it on the timeline at the playhead.

Android mapping: synthesize the same WAV programmatically (write RIFF header + 16-bit LE PCM samples) into `cacheDir`. The math is identical. Then enqueue with the editor's import pipeline.

#### 3.3.5 Local Music (Android)

Android exposes **Local Music** / **Create offline**. A prompt selects and tunes
one of the bundled procedural styles; duration and tempo customize the result.
MusicLibrary.materialiseGenerated writes a mono PCM WAV into project-local
storage and places it on the timeline. There is no request, token, progress
polling, or network fallback.

iOS does not currently expose a matching generator. Keep it absent until an
on-device implementation is added; the ordinary Music Library, Audio Files,
Sound Effects, Voiceover, and offline Text to Speech paths remain available.

### 3.4 Selected Clip sheet

Visible only when both a clip is selected and its media item supports audio (`mediaItem.type == .audio` or `video with audioTrackCount > 0`).

Card with: media item name (13pt bold), track name (or `Timeline Clip`, 11pt medium secondary). When `canDetachSelectedClipAudio`: a `Detach` button (32pt high, accent bg, 10pt corner) which calls `appState.detachSelectedClipAudio(...)`.

Sliders:

| Label | Range | Format | Action |
|-------|-------|--------|--------|
| Pan | -1...1 | `C` when |v|<0.01; otherwise `L NN` or `R NN` where `NN = int(abs*100)` | `updateSelectedClipPan` |
| Fade In | 0...max(min(clipDuration, 5), 0.2) | `"%.2fs"` | `updateSelectedClipFade(.fadeIn, ...)` |
| Fade Out | 0...max(min(clipDuration, 5), 0.2) | `"%.2fs"` | `updateSelectedClipFade(.fadeOut, ...)` |

Below sliders, two side-by-side menu pickers ("In Curve" / "Out Curve"). Choices (`OpenReelProject.AudioAutomationCurve`):

- `linear` → "Linear"
- `exponential` → "Expo"
- `logarithmic` → "Log"
- `sCurve` → "S-Curve"
- (`bezier` exists in the model but is not surfaced in the picker)

Selecting a curve calls `updateSelectedClipFade(edge, duration, curve)` with the current duration retained.

Empty state (when no eligible clip): card with title `No audio clip selected`, body `Select a clip with audio to adjust pan, fades, and detached audio behavior.`

#### 3.4.1 Audio effects processing rack

Five effect cards stacked vertically inside the selected clip sheet. Each card has:

- Title + subtitle on the left.
- A `Toggle` on the right (accent tint) that enables/disables the effect. Turning on for the first time inserts a default-params effect via `upsertSelectedClipAudioEffect(type:params:)`.
- When enabled, controls appear below.

**1) EQ** — Title `EQ`, subtitle `Bass, presence, and air shaping`.

- Default `EQ` is 5 bands; the panel exposes 3 of them via sliders, but persists all 5 internally:

| Index | Type | Frequency (Hz) | Default gain (dB) | Q |
|-------|------|----------------|-------------------|---|
| 0 | lowshelf | 60 | 0 | 0.707 |
| 1 | peaking | 250 | 0 | 1.4 |
| 2 | peaking | 1000 | 0 | 1.4 |
| 3 | peaking | 4000 | 0 | 1.4 |
| 4 | highshelf | 16000 | 0 | 0.707 |

- Surface sliders (range -12...12 dB, format `+/-NN dB`):
  - `Bass` → band 0 gain
  - `Presence` → band 2 gain
  - `Air` → band 4 gain
- Internally clamped to `-24...24 dB` for gain; frequency `20...20000`; Q `0.1...18`.
- Filter types supported (`TimelineAudioEQBand.FilterType`): `lowshelf, highshelf, peaking, lowpass, highpass, notch`.

**2) Compressor** — Title `Compressor`, subtitle `Tighten dynamics and add makeup gain`.

| Param | Default | Surface range | Internal clamp | Format |
|-------|---------|---------------|----------------|--------|
| threshold | -20 dB | -60...0 | -60...0 | `+/-NN dB` |
| ratio | 4 | 1...12 | 1...20 | `%.1f:1` |
| attack | 0.01 s | (not in UI) | 0.001...1 | — |
| release | 0.1 s | (not in UI) | 0.01...3 | — |
| knee | 6 dB | (not in UI) | 0...40 | — |
| makeupGain | 0 dB | 0...12 | -24...24 | `+/-NN dB` |

**3) Reverb** — Title `Reverb`, subtitle `Blend room size with wet mix`.

| Param | Default | Surface range | Internal clamp | Format |
|-------|---------|---------------|----------------|--------|
| roomSize | 0.5 | 0...1 | 0...1 | `NN%` |
| damping | 0.5 | (not in UI) | 0...1 | — |
| wetLevel | 0.3 | 0...1 | 0...1 | `NN%` |
| dryLevel | 1.0 | (not in UI) | 0...1 | — |
| preDelay | 0 | (not in UI) | 0...100 | — |

Internally maps to `AVAudioUnitReverb` presets (smallRoom/mediumRoom/plate/largeRoom/mediumHall/largeHall) based on `roomSize` and `damping`.

**4) Noise Reduction** — Title `Noise Reduction`, subtitle `Reduce hiss and room wash`.

| Param | Default | Surface range | Internal clamp |
|-------|---------|---------------|----------------|
| threshold | -40 | — | -80...0 |
| reduction | 0.5 | 0...1 | 0...1 |
| attack | 10 ms | — | 0...100 |
| release | 100 ms | — | 0...500 |
| focus | `balanced` | (menu) | enum |

Focus menu values: `Balanced` (balanced), `Speech` (speech), `White Noise` (whiteNoise), `Music` (music), `Heavy` (heavy), `Wind` (wind), `Hum` (hum). Each focus selects a different internal EQ band profile applied before a dynamics processor.

**5) Ducking** — Title `Ducking`, subtitle `Pull music under the active role`.

| Param | Default | Surface range | Internal clamp |
|-------|---------|---------------|----------------|
| threshold | -60 dB | — | -80...0 |
| reduction | 0.5 | 0...1 | 0...1 |
| attack | 0.15 s | — | 0...3 |
| release | 0.3 s | — | 0...3 |
| holdTime | 0.1 s | — | 0...3 |
| triggerRole | `dialogue` | menu | enum |

Trigger role menu values: rawValues from `OpenReelProject.AudioTrackRole` (capitalized): `Music, Dialogue, Effects, Voiceover, Ambient` (whichever the model defines via `allCases`).

Note: Ducking does **not** create a `AVAudioNode` in offline render — it's a control signal handled elsewhere in the timeline. The Compressor maps to `AudioUnit kAudioUnitSubType_DynamicsProcessor` with computed `attackTime`/`releaseTime` (in ms), `headRoom = max(0.1, 18/ratio)`, and `expansionRatio = 1`.

Effect persistence schema (`OpenReelProject.Effect`):

```
{
  id: String,
  type: "eq" | "compressor" | "reverb" | "noiseReduction" | "ducking",
  enabled: Bool,
  params: { ... per-effect keys, exact names listed above ... }
}
```

EQ params shape:

```
"params": {
  "bands": [{ "type": "...", "frequency": Hz, "gain": dB, "q": Q }, ...]
}
```

#### 3.4.2 Stem separation

Stem separation is not exposed on mobile because no reliable bundled model is
currently shipped. The selected-clip sheet contains the local processing rack
only. Do not add a placeholder action or remote fallback.

### 3.5 Mixer sheet

For each audio track in `currentProject.timeline.tracks` where `type == .audio`:

- Card: track name (13pt bold) + `{N} clips` (11pt medium secondary).
- Trailing role menu showing `track.audioMix.role.rawValue.capitalized` with chevrons. Tap → choose role from `OpenReelProject.AudioTrackRole.allCases`. Calls `updateTrackAudioMix(trackID, role:)`.
- `Gain` slider — range `0...2` (so 2x boost is possible). No format string by default (raw slider value), but consumer can show 0..200%.
- `Pan` slider — range `-1...1`, format `C` / `L NN` / `R NN` (same as clip pan).

Empty state: card with title `No audio tracks yet`, body `Import music, sound effects, or voiceover to start shaping your mix.`

Android mapping: `LazyColumn` of `Card { Column { Row { Text(name) ; Spacer ; DropdownMenu(role) } ; Slider(gain) ; Slider(pan) } }`. Gain >1 should be shown as +N% boost.

### 3.6 Offline render (informational — `TimelineAudioOfflineRenderer`)

For Android export pipeline parity, the offline mixer renders each segment with:

- A `AVAudioPlayerNode → AVAudioUnitTimePitch → effect nodes → mainMixerNode` chain.
- Time-stretch rate clamped to `[1/32, 32]`.
- Per-frame volume from automation (fade ramps using the chosen curve), then pan via constant-power-ish `leftGain = pan<=0 ? 1 : 1-pan`, `rightGain = pan>=0 ? 1 : 1+pan`.
- Output: 32-bit float WAV `.caf` at the timeline sample rate (min 8000 Hz) with stereo channels.

Android mapping: implement with **ExoPlayer audio processors** or **Oboe** + a custom DSP chain. The mixing math (per-sample volume * leftGain/rightGain, summed into a stereo mix buffer, clamped to [-1,1]) is identical. For time-stretch use **Sonic** (open-source) or `androidx.media3.exoplayer.audio.SonicAudioProcessor`. EQ via `android.media.audiofx.Equalizer` (simple) or custom biquad filters. Compressor/limiter via `DynamicsProcessing` (API 28+) or a manual biquad+envelope follower. Reverb via `android.media.audiofx.PresetReverb` / `EnvironmentalReverb`. Noise reduction has no AOSP equivalent — port the EQ-band+expander recipe documented above.

### 3.7 Permissions summary (Audio panel)

| iOS | Android |
|-----|---------|
| `NSAppleMusicUsageDescription` (Music Library picker) | `READ_MEDIA_AUDIO` (33+) / `READ_EXTERNAL_STORAGE` (≤32) |
| `NSMicrophoneUsageDescription` (Voiceover) | `RECORD_AUDIO` |
| File access via document picker (no extra perm) | Storage Access Framework picker (no perm needed) |

---

## 4. Cross-panel notes for Android

### 4.1 State container

iOS uses two SwiftUI `@Environment` injectables:

- `AppState` — project document model + local actions (`addMediaItemToTimeline`, `addTextClip(from preset:)`, `updateSelectedTextClipStyle(...)`, `updateSubtitleTrackStyle(...)`, `upsertSelectedClipAudioEffect(...)`, etc.). It exposes current project and selection state plus local import/operation status.
- `PlaybackController` — playhead time (`currentTime`).

Android equivalent: a single `ViewModel` (or per-feature `ViewModel`s) exposing `StateFlow<EditorState>`. Mutations live on the ViewModel and dispatch to a repository/service. Maintain the exact field names so JSON serialization stays compatible.

### 4.2 Sheet detent

All sheets use `presentationDetents([.fraction(0.5)])`. In Compose use `ModalBottomSheet(sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false))` and an initial half-expand state. Drag indicator is always visible.

### 4.3 Loading, empty, and error states (recap)

- **Media empty library**: `rectangle.stack.badge.plus`, copy `Import something to start building the timeline.`
- **Audio Selected Clip (no audio)**: `No audio clip selected` / `Select a clip with audio to adjust pan, fades, and detached audio behavior.`
- **Mixer empty**: `No audio tracks yet` / `Import music, sound effects, or voiceover to start shaping your mix.`
- **Caption track empty**: `captions.bubble` + `Import or generate captions to edit the track here.`
- **Voiceover permission denied**: `Microphone access is required for voice recording.`
- **Photo Tools loading text states**: `Loading photo`, `Preparing photo`, `Rendering result`, `Downloading result`, `Import failed`, `Edit failed`, `Cancelled`, and per-tool `<Tool> ready` on success.
- **Errors**: imports surface via `appState.importErrorMessage`; AI photo edits raise alerts (`Photo Import Failed`, `Reference Load Failed`, `Edit Failed`, `Cancel Failed`, `Save Failed`, `Saved To Photos`).

### 4.4 Permissions consolidated

| Capability | iOS Info.plist key | Android permission |
|-----------|--------------------|---------------------|
| Photo library read | `NSPhotoLibraryUsageDescription` | `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (33+) or PhotoPicker (no perm) |
| Photo library add (save enhanced) | `NSPhotoLibraryAddUsageDescription` | `WRITE_EXTERNAL_STORAGE` (≤28) / MediaStore (29+) |
| Camera | `NSCameraUsageDescription` | `CAMERA` |
| Microphone | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` |
| Music library | `NSAppleMusicUsageDescription` | `READ_MEDIA_AUDIO` (33+) |
| Files | (none — Document picker handles) | (none — SAF handles) |

### 4.5 File naming conventions (used when copying into temp)

- Camera photo: `Camera-{unixSeconds}.jpg` (JPEG q=0.9).
- Camera video: `Camera-{unixSeconds}.mov`.
- Voiceover: `Voiceover-{unixSeconds}.m4a` (AAC mono 44.1k, high quality).
- Sound effect: `OpenReel-{effectId}-{unixSeconds}.wav` (16-bit PCM mono 44.1k).
- Document picker copies: `{UUID}.{originalExt}`.

Reproduce these exactly on Android so logs, telemetry, and any user-facing filenames match.

---

End of MEDIA / TEXT / AUDIO panel specification.
