# 03 — Editor Shell

This document describes the main editing screen of "Openreel Video" so an Android team can rebuild it 1:1 in Kotlin / Jetpack Compose.

The editor is implemented in a single SwiftUI file: `Openreel Video/Openreel Video/EditorView.swift` (~5,488 lines). It is entered when `AppState.activeScreen == .editor` and a project is loaded. The app targets iPhone only (single-orientation portrait — see "Orientation").

Theme tokens used throughout (`OpenReelTheme`, defined in `Openreel Video/Openreel Video/Theme.swift`):

| Token | Light | Dark |
|---|---|---|
| `background` | `#FBFCF8` | `#0D0D0D` |
| `surface` | `#F0F4EE` | `#1A1A1A` |
| `surfaceElevated` | `#FFFFFF` | `#262626` |
| `accent` | `#047857` | `#047857` |
| `accentSecondary` | `#036B3A` | `#036B3A` |
| `textPrimary` | `#101814` | `#FFFFFF` |
| `textSecondary` | `#5F6F67` | `#A3A3A3` |
| `destructive` | `#DC2626` | `#EF4444` |

System font is SF Rounded for UI text, SF Mono for time/numeric values.

---

## 1. Overall layout

The editor is a `VStack(spacing: 0)` that fills the screen vertically. Top-down stack with no gaps (per-section padding only):

```
VStack(spacing: 0) {
    topBar               (.padding(.top, 4).padding(.bottom, 6))
    previewStage         (maxHeight: 240, .padding(.horizontal, 16))
    timecodeBar          (.padding(.top, 6).padding(.bottom, 4), .padding(.horizontal, 20))
    transportBar         (.padding(.bottom, 6), .padding(.horizontal, 20), .padding(.vertical, 4))
    timeline             (fills remaining vertical space — maxHeight: .infinity, .padding(.horizontal, 12))
    lowerPanel           (height = 56 tabBar + optional 56 contextToolBar)
}
.background(OpenReelTheme.background.ignoresSafeArea())
```

Vertical totals (typical iPhone, portrait):

| Section | Approximate height (pt) |
|---|---|
| Top bar | ~70 (44 button + 12+12 padding) |
| Preview stage | up to 240 (clamped by aspect ratio) |
| Timecode bar | ~24 |
| Transport bar | ~52 |
| Timeline | flex (everything else) |
| Lower panel — context tool bar | 56 (only when selection panel is active) |
| Lower panel — tab bar | 56 (always) |

Safe-area: only the root container honours safe area; sheets use `ignoresSafeArea()` for full-screen presentation (`MediaPicker`, the importing-overlay). The top bar sits inside the safe area; the bottom tab bar is part of the layout (not pinned to the bottom safe inset by itself — the system safe inset is provided by the parent).

The top bar, preview, timecode bar, and transport bar are encapsulated in panels with rounded backgrounds; padding is applied as `.padding(.horizontal, 16)` on the outer container while inner elements have their own padding.

### Orientation

The app currently targets iPhone-only and is locked to portrait orientation by Info.plist (the recent commit explicitly switched the target device family to iPhone only). The code has no orientation observers; layout assumes a tall narrow viewport with `maxHeight: 240` for preview and a tall timeline below.

### Empty state

When `appState.currentProject == nil`:

```
VStack(spacing: 18) {
    Image("film.stack")                size 32, semibold, accent
    Text("Create a project to start editing")   20pt bold rounded, textPrimary
    Button("New Project")               14pt semibold rounded, accent text, plain
}
.frame(maxWidth: .infinity, maxHeight: .infinity)
```

---

## 2. Header bar (Top bar)

Implemented in `topBar(project:)` (line 567). It is a `HStack(spacing: 12)` inside a rounded surface card:

- Outer container:
  - `.padding(.horizontal, 16)` (within row), `.padding(.vertical, 12)`
  - `.background(OpenReelTheme.surface.opacity(0.96))` with `RoundedRectangle(cornerRadius: 20)`
  - 1pt overlay border `Color.white.opacity(0.05)`
  - Outer `.padding(.horizontal, 16)` to inset the card from screen edges.

Children, left to right:

1. **Back button**
   - 42x42, `RoundedRectangle(cornerRadius: 14)`, `OpenReelTheme.surfaceElevated`
   - SF Symbol `chevron.left`, size 16, weight `.bold`, color `textPrimary`
   - Action: `playbackController.pause()`, then `appState.closeEditor()`

2. **Project title block** (`VStack(alignment: .leading, spacing: 4)`, `frame(maxWidth: .infinity, alignment: .leading)`):
   - Title: `project.name`, 18pt bold rounded, `textPrimary`, single line
   - Subtitle: `"{width}x{height} · {fps}fps · Saved {time}"`, 11pt medium rounded, `textSecondary`, single line. "Saved …" suffix appears only when `lastSavedAt != nil`.

3. **Right cluster** (`HStack(spacing: 8)`):
   - **Undo button** (`historyButton(symbol: "arrow.uturn.backward", isEnabled: canUndo)`):
     - 38x38, RoundedRectangle(14), `surfaceElevated`, icon 15pt semibold. Disabled state dims foreground to `textSecondary.opacity(0.35)`.
   - **Redo button** (`arrow.uturn.forward`, same style)
   - **Export button**: 44x44, RoundedRectangle(15), `accent` background, icon `square.and.arrow.up.fill` (16pt bold white). While exporting, replaces icon with `ProgressView(value: exportStatus.fraction)` `.progressViewStyle(.circular)`. Tapping presents the export sheet.

There is no "Settings" cog inside the editor; project-level settings are exposed via the export sheet & the tab panels.

---

## 3. Preview canvas

`previewStage(for:)` (line 639). A `ZStack` containing a black rounded rectangle (`cornerRadius: 12`) clipped to `appState.selectedAspectRatio.value`:

- `aspectRatio(.fit)` — the canvas reserves the aspect ratio of the selected ratio (16:9 / 9:16 / 1:1 / 4:5 / 4:3) and never exceeds height 240.
- Width: `.frame(maxWidth: .infinity)`, plus `.padding(.horizontal, 16)`.
- Background: pure black, with a 1pt 8%-white stroke border.
- `clipShape(RoundedRectangle(cornerRadius: 12))`

### Layer composition (front-to-back is reverse of code order)

Inside a `GeometryReader { previewProxy in … }`:

1. **Video layer** — `MetalVideoView` if a player is loaded, otherwise either:
   - `placeholderPreview(project:)` — a `ZStack` with the project's gradient + `video.badge.plus` icon and "Import a video from Media" / "Preview activates after first import." (only shown when the timeline has no visual content at all).
2. **Image overlays** — for every image clip active at `playbackController.currentTime`. Uses `EffectImageView` (still-image renderer that applies the clip's effect stack). Crop is implemented by oversizing the frame and offsetting, fit mode controlled by `previewFitScale`:
   - `.contain` → 1.0
   - `.cover` → 1.12
   - `.stretch` → x=1.12, y=1
   - `.none` → 0.82
3. **Graphics overlays** — shapes, emojis, stickers, raster images. Shape rendering switches on `shapeType`:
   - `circle` / `ellipse` → `Ellipse` filled + optional stroke
   - `triangle` → custom `TimelineTriangle` shape
   - `star` → `star.fill` SF symbol
   - `arrow` → `arrowshape.right.fill`
   - `line` → `Capsule` of `max(strokeWidth, 3)` height
   - `polygon` → custom `TimelinePolygon(points: 3..n)`
   - default → `RoundedRectangle(cornerRadius: style.cornerRadius ?? 8)`
   - Emoji/sticker → Text rendered at `min(width, height) * 0.82` font size
   - Image → `UIImage(contentsOfFile:)` resizable scaledToFit
4. **Text overlays** — applies font (`style.fontFamily`, size scaled by preview-to-project ratio), weight, multiline alignment, line height, background pill, shadow, and animation render state (see Section 5 of `EditorView.swift` for the 19 text-animation presets).

### Selection rendering

Selected clip/image/text/graphics gets a 2pt accent `RoundedRectangle` overlay with corner radius 12. For text the overlay is inset by `-8 * textMetricScale` (a small padding outside the text bounds). Only one item can have selection visible at a time; `stageOverlayHitTesting` disables hit testing for other layers when something is selected, and `stageOverlayZIndex` raises the selected one to z=2 (others z=0).

### Gestures

On the active layer (video clip, image overlay, graphics, text), three gestures are attached:

- `previewDragGesture(for:in:)` — `DragGesture(minimumDistance: 2)` `.onEnded` — translates `transform.position` by `value.translation / previewSize`, clamped to `[-0.5, 1.5]`.
- `previewScaleGesture(for:)` — `MagnifyGesture()` `.onEnded` — multiplies scale by `value.magnification`. Limits per layer type:
  - Video / image clip: `[0.25, 4]`
  - Text: `[0.25, 4]`
  - Graphics: `[0.02, 2]`
- `previewRotationGesture(for:)` — `RotationGesture()` `.onEnded` — adds `angle.degrees` to current rotation.

Behaviour notes:
- Drag/scale/rotate commit only on `.onEnded` (single update at gesture end, not continuous). Gestures use `.gesture` (drag) plus `.simultaneousGesture` (scale & rotation) so they compose.
- **Double-tap on the video layer** resets the selected clip's transform (position / scale / rotation back to identity).
- **Double-tap on a text overlay** (highPriorityGesture, count: 2) opens the text editor sheet via `presentTextClipEditor`.
- Single tap on an image / text / graphics overlay → selects that clip and sets editor tab back to `.edit`.

### MetalVideoView details (`Features/Preview/MetalVideoView.swift`)

`UIViewRepresentable` wrapping a `MTKView`. Highlights for the Android team:

- Uses `MTLCreateSystemDefaultDevice()` + `CIContext(mtlDevice:)`. Pixel format `bgra8Unorm`, clear color black.
- Pulls frames from `AVPlayer` via `AVPlayerItemVideoOutput` (kCVPixelFormatType_32BGRA, metal-compatible).
- Frame timing: when paused, uses `currentPlayer.currentTime()`; when playing, uses `videoOutput.itemTime(forHostTime: CACurrentMediaTime())`.
- Effects are applied through `VideoEffectRenderer` (per-frame CIImage pipeline with `effectContext` for AI-driven effects).
- Output is aspect-fit centered into the drawable using `aspectFitImage(_:in:)` — calculates `min(boundsWidth/sourceWidth, boundsHeight/sourceHeight)` scale and centers within a black background.
- Updates color scopes every 8 frames via `ColorScopesEngine.snapshot(cgImage:)`, posted back to the SwiftUI state via the `onScopesUpdate` callback.
- AI frame context is debounced/keyed by `(clipID|mediaID|frameIndex|descriptorSignature)` so it is recomputed only when descriptors or frame change.

`EffectImageView` (`Features/Preview/EffectImageView.swift`) is the still-image equivalent: renders once per `renderKey` change (path + project dir + effect signatures) using `StillImageEffectRenderer.render(...)` and reports color scopes once.

Android mapping: a `SurfaceView` or `TextureView` with an OpenGL ES/Vulkan / `RenderEffect` pipeline. ExoPlayer with a custom `GLSurfaceView` renderer, and a parallel `Bitmap` pipeline for still images.

---

## 4. Playback controls

### Timecode bar (`timecodeBar(for:)`, line 1686)

`HStack`, `.padding(.horizontal, 20)`:

- Left: current time formatted via `playbackController.currentTime.openReelClock(frameRate:)`, 13pt bold monospaced, `textPrimary`. Format is `HH:MM:SS:FF` (drop-frame aware via `openReelClock`).
- Right: aspect-ratio `Menu` — label is `HStack(spacing: 4)` of the ratio (`16:9`, `9:16`, `1:1`, `4:5`, `4:3`) at 12pt semibold rounded + `chevron.up.chevron.down` (9pt bold), all `textSecondary`. Menu items show ratio + system symbol (`rectangle.ratio.16.to.9` / `rectangle.portrait` / `square` / `rectangle.portrait.and.arrow.right` / `rectangle`).

### Transport bar (`transportBar(for:)`, line 1722)

`HStack(spacing: 0)`, `.padding(.horizontal, 20)`, `.padding(.vertical, 4)`, evenly spaced with `Spacer()` between buttons:

1. **Prev-frame**: 36x36 circle, `surfaceElevated`, icon `backward.frame.fill` (14pt semibold). Steps `playbackController.step(frames: -1)`.
2. **Play / Pause**: 44x44 circle, `accent` background, icon `play.fill` / `pause.fill` (16pt bold white). Disabled when no timeline content.
3. **Next-frame**: 36x36 `forward.frame.fill`, mirror of #1.
4. **Volume toggle**: 36x36 (no background), icon switches based on `playbackController.volume`:
   - `0` → `speaker.slash.fill`
   - `<0.4` → `speaker.wave.1.fill`
   - else → `speaker.wave.2.fill`
   Single tap toggles mute/full. **Long press (0.4s)** opens the volume sheet.
5. **Volume percent text** — 36x36, "`{0..200}%`" at 11pt semibold rounded `textSecondary`. Tap opens the volume sheet.

All transport buttons except play are disabled when `hasTimelineContent == false`. Tapping any of them ensures `appState.syncPlayback(with:)` is called first if the player is nil (lazy-init pattern).

There is no separate "fps display" beyond the project subtitle in the header. There is no zoom-control widget for the preview; preview zoom is implicit (gesture only).

### Volume sheet (`volumeSheet`, line 4233) — half-sheet detent `.fraction(0.5)`

`VStack(spacing: 20)`, `.padding(20)`:
- Header row: "Volume" (17pt bold rounded) on the left, "`{n}%`" on the right (15pt semibold monospaced accent).
- Slider row: `speaker.fill` (12pt) — `Slider` tinted accent, range `0...2` — `speaker.wave.3.fill` (12pt). Both icons are `textSecondary`.
- Preset row of 4 buttons: "Mute", "50%", "100%", "200%". Each `volumePresetButton` is full-width-fluid, 10pt vertical padding, `surfaceElevated` background, 10-radius. The active preset uses `accent.opacity(0.12)` background and accent text color.

---

## 5. Timeline

Implemented in `timeline(for:)` (line 1797) and the four lane composers below it. Wrapper background: `OpenReelTheme.surface.opacity(0.5)`, with a 1pt 4%-white horizontal divider on top.

### Geometry

- `pixelsPerSecond = appState.timelineZoom` (range clamped to `[20, 300]`, default 48)
- Track badge column: width 48, gap 10 to the lanes
- Lane widths: `contentWidth = max(duration * zoom + 120, trackAreaWidth)`
- Lane heights: 56 for video/image/text/graphics; 48 for audio (`timelineLaneHeight(for:)`, line 4440)
- Ruler height: 34
- Row spacing between lanes: 8
- Outer horizontal padding: 12; vertical padding 10 top, 8 bottom

The full timeline is a vertical `ScrollView(.vertical)` whose body is an `HStack(spacing: 10)` containing:
1. A left column of fixed 48-wide **track badges** (a vertical `VStack(spacing: 8)`):
   - First item is the **Add-track menu** (`Image("plus")` 14pt bold accent, 48x34, RoundedRectangle(12), `surfaceElevated`). Menu shows: Video, Audio, Text, Graphics — each adds a track via `appState.addXxxTrack()`.
   - Then one badge per track: `Image(systemName: trackSymbol(for: track.type))` (17pt semibold accent), 48 x `laneHeight`, RoundedRectangle(16) `surfaceElevated`.
     - Track symbols: `film.stack` (video), `waveform` (audio), `photo.stack` (image), `textformat` (text), `sparkles` (graphics).
     - Tap on an **audio** badge opens the Track Mix sheet (`activeEditingSheet = .trackMix`).
     - Long-press / context menu: Move Up, Move Down, Select All, Delete Track (destructive). Audio tracks also get a "Track Mix" item at the top.
2. A horizontal `ScrollView(.horizontal)` containing the ruler + lanes + playhead.

### Ruler (`timelineRuler`, line 1912)

- Step pixels target ~84 per tick. `rulerStep` returns the smallest of `[0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]` seconds satisfying that target.
- Each mark is a 11pt medium rounded `textSecondary` label (`mm:ss` short clock) plus a 1pt × 12pt 14%-white tick line.
- A live timecode pill (capsule, accent fill, 11pt bold mono white, padded 8/4) is overlaid above the playhead position.

### Playhead

Two views stack on top of all lanes:

- `playheadView(x:height:)` (line 2262) — visual only. A 14×18 RoundedRectangle(4) accent flag head, plus a 2×(height-18) accent vertical line. zIndex 10.
- `playheadGrabHandle(x:duration:)` — a 56×46 transparent hit-test rectangle on top of the ruler. zIndex 20. `DragGesture(minimumDistance: 0)`:
  - On first touch: pauses playback, captures `playheadDragStartTime`.
  - During: seeks to `baseTime + translation.x / zoom`, clamped to `[0, duration]`.
  - On end: clears drag state.

When `isDraggingPlayhead` is true, the horizontal scroll view is `scrollDisabled(true)` to avoid conflicting gestures.

During playback, the horizontal scroll auto-tracks the playhead: `scrollOffset = max(0, targetX - trackAreaWidth * 0.5)` keeping it horizontally centred.

### Lane content

Four lane composers dispatched by `track.type`:

- `visualTrackLane` (video, image) → `TimelineClipBlock`
- `audioTrackLane` → `TimelineAudioClipBlock`
- `textTrackLane` → `TimelineTextClipBlock`
- `graphicsTrackLane` → `TimelineGraphicsClipBlock`

If the lane has no clips, an `emptyTimelineLaneButton` is shown spanning the lane:

- Inset 18 horizontal, `surfaceElevated` background, RoundedRectangle(16)
- Icon (15pt bold accent) + title (13pt semibold rounded textSecondary)
- Icons / titles per track type:
  - video/image → `plus.rectangle.on.folder` / `photo.badge.plus` , "Open Media Sheet"
  - audio → `waveform.badge.plus`, "Add Audio"
  - text → `plus.bubble`, "Add Text" — opens `text` tab
  - graphics → `sparkles.square.filled.on.square`, "Add Graphic" — opens `graphics` tab

### TimelineClipBlock (video / image — line 4594)

- Height 54, width = `max(clip.duration * zoom, 44)`
- Background: project-style gradient (one of emerald/cobalt/amber/coral linear gradients) with corner radius 12.
- Selection stroke: 2pt accent when selected, else 1pt 6%-white.
- Foreground content layered with thumbnails (when `filmstripThumbnails` exists):
  - Horizontal strip of `AsyncImage` thumbnails. Count = `ceil(clipWidth / 56)`. Each thumbnail is exactly `clipWidth / count` wide, height 54, clipped to a RoundedRectangle(12).
  - Thumbnails are picked by mapping each strip position to a timestamp in `[clip.inPoint, clip.outPoint]` (reversed if `clip.reversed`) and choosing the nearest source thumbnail.
- Label (top-left, 14h / 8v padding): two-line VStack(spacing: 3):
  - Media name, 11pt semibold rounded, white, 1 line.
  - Duration `clip.duration.shortClock()`, 10pt medium rounded, white opacity 0.82.
- Trim handles on left & right edges: 12×34 RoundedRectangle(5) accent (opacity 0.95 selected, 0.45 idle), with hit-area expanded by `-8` inset on all sides.
- Keyframe lane overlay (top-leading) when `clip.keyframes` is non-empty: each keyframe is a `TimelineKeyframeMarker` — a 12×12 yellow square rotated 45° (selected → accent), with a 2×18 vertical pin below it. A dashed yellow line connects multiple markers if ≥2 exist (`strokeBorder(Color.yellow.opacity(0.6), dash: [4,3])`).

#### Clip gestures (all block types)

- **Tap** → `onSelect` (select, seek to clip start, set tab to `.edit`).
- **Long press (0.25s) → drag** → `moveGesture`. On end, calls `onMove(translation.x / zoom)` and fires `UIImpactFeedbackGenerator(.medium)`. During the drag, the block visually offsets by `moveTranslation`.
- **Drag on a trim handle** → resizes the block live (`leadingTrimOffset` / `trailingTrimOffset` updated on `.onChanged`). On end commits `onTrim(edge, delta)` and fires `.light` haptic.
- **Double-tap** is only on text blocks (opens editor).

There is **no built-in snapping** in the iOS code; the user moves clips by raw delta-seconds, and the engine layer (`appState.moveClip`) is responsible for boundary clamping. Multi-select operations exist (`selectAllClipsOnTrack`) but no marquee-drag.

### TimelineAudioClipBlock (line 4813)

- Height 46, background hard-coded brown `Color(red: 0.36, green: 0.24, blue: 0.10)`, corner radius 14.
- Waveform: `HStack(spacing: 3)` of 28 `Capsule`s, each 4pt wide; height = `max(8, sample * 30)`. Samples come from `mediaItem.waveformData` (downsampled to 28 points) or a synthetic sin-based fallback.
- 12pt padding inset.
- Trim handles 12×30 (smaller than visual lane).
- A small `link` icon (10pt bold accent, padded 8) sits top-trailing when `clip.audioConfiguration.detachedSourceClipID != nil` (i.e., this is detached audio from a video).

### TimelineTextClipBlock (line 4930)

- Height 54, gradient background = `LinearGradient(colors: [textTintColor.opacity(0.32), surfaceElevated], topLeading -> bottomTrailing)`. `textTintColor` is the text clip's foreground color.
- Content (top: name, bottom: animation hint):
  - Text content, 12pt bold rounded, color is white-or-black based on luminance of the text style color (`prefersDarkTrackLabels` uses `0.2126 R + 0.7152 G + 0.0722 B > 0.62`).
  - Animation row: `HStack(spacing: 6)` of an animation-specific SF symbol (10pt bold) + the preset name (10pt medium rounded). Symbols per preset:
    - `typewriter` → `keyboard`
    - `fade` → `circle.dashed`
    - slide* → `arrow.up.left.and.down.right.and.arrow.up.right.and.down.left`
    - `scale` / `pop` → `sparkle.magnifyingglass`
    - `bounce` → `arrow.down.circle`
    - `wave` → `water.waves`
    - `shake` / `glitch` → `waveform.path`
    - `rotate` / `flip` → `rotate.right`
    - `blur` → `camera.filters`
    - `split` → `arrow.left.and.right`
    - word-* → `text.word.spacing`
    - `rainbow` → `paintpalette.fill`
    - else / none → `textformat`
- 12pt padding. Trim handles 12×34.
- **Double-tap → onEdit** (opens the text editor panel).

### TimelineGraphicsClipBlock (line 5136)

- Height 54, gradient `[accent.opacity(0.24), surfaceElevated]`. Corner 14.
- Left icon (30×30):
  - emoji/sticker → the emoji itself at 24pt
  - shape → SF symbol from shape type (`circle.fill`, `oval`, `triangle.fill`, `arrowshape.right.fill`, `minus`, `hexagon.fill`, `star.fill`, default `rectangle.fill`)
  - image → `photo`
- Title (12pt bold rounded textPrimary) + duration (10pt medium rounded textSecondary).
- Trim handles 12×34.

### TimelineTransitionMarker (line 4539)

Floats over the boundary between two clips on a video lane:

- HStack(spacing: 6) — `diamond.fill` (9pt bold) + transition label (10pt bold rounded), 1-line.
- Height 34, width `max(duration * zoom, 44)`. Capsule background — `accent` when selected else `surfaceElevated`. 1pt stroke (28%-white selected, 8%-white idle). Drop shadow `black.opacity(0.18) radius 5 y=2`.
- Dragging horizontally retimes the transition duration with min-clamp at `TimelineTransitionEngine.minimumDuration`. Drop fires `.light` haptic.

### Pinch-to-zoom

A `MagnifyGesture()` is attached to the whole timeline:

- On change: `newZoom = startingZoom * magnification`, clamped `[20, 300]`.
- On end: clears `timelineZoomGestureStart`.

There is no two-finger horizontal pan; horizontal panning is the standard `ScrollView` recognizer.

### Tap on the timeline track area

Tapping (not on a clip) seeks to `location.x / zoom` (clamped) and pauses playback.

---

## 6. Tab bar (bottom)

`tabBar` (line 2370): a single horizontal `ScrollView` with horizontal indicators hidden, `HStack(spacing: 0)`, `.padding(.horizontal, 8)`. The tabs are `AppState.EditorTab.allCases` excluding `.edit` (so `.edit` is the implicit "no tab open" state).

Order, label, icon (each tab is 56pt wide, internal `VStack(spacing: 3)`, 28×28 icon at 15pt semibold, 9pt semibold rounded label, foreground `textSecondary`, vertical padding 4):

| Order | Tab (raw) | Label | Icon (SF Symbol) |
|---|---|---|---|
| 1 | `.media` | "Media" | `photo.on.rectangle` |
| 2 | `.text` | "Text" | `textformat` |
| 3 | `.graphics` | "Graphics" | `square.on.circle` |
| 4 | `.templates` | "Templates" | `square.stack.3d.up` |
| 5 | `.effects` | "Effects" | `wand.and.stars` |
| 6 | `.subtitles` | "Subtitles" | `captions.bubble` |
| 7 | `.audio` | "Audio" | `music.note` |

(There is also `.edit` with icon `scissors` but it is never rendered as a bar item — it represents the no-panel-open state.)

Tapping a tab calls `openTabPanel(tab)`:
1. `tabSheetForceAdd = true`
2. `activeTabSheet = tab` (presents the tab panel sheet)
3. `appState.editorTab = tab`
4. Clears `activeEditingSheet`

Each tab panel is a separate SwiftUI view bound to `OpenReelProject`:
- `.media` → `MediaTabPanel`
- `.text` → `TextTabPanel(mode:)` — mode is `.edit` if a text clip is selected or subtitle-track is being edited and `!tabSheetForceAdd`; else `.add`
- `.graphics` → `GraphicsTabPanel`
- `.templates` → `TemplatesTabPanel`
- `.effects` → `EffectsTabPanel(colorScopes:)`
- `.subtitles` → `SubtitlesTabPanel`
- `.audio` → `AudioTabPanel`

All tab panels are presented as **sheets** with `presentationDetents([.fraction(0.55)])`, `presentationDragIndicator(.visible)`, `presentationBackground(.ultraThinMaterial)`. When dismissed, `editorTab` is reset to `.edit`.

---

## 7. Inspector panels (presentation model)

There is no persistent side panel. Selection-driven inspectors and tab inspectors are **all bottom sheets** on iOS.

### Sheet types

| `@State` driver | Detent | Background |
|---|---|---|
| `isExportSheetPresented` | `.fraction(0.5)` | ultraThinMaterial |
| `showsMediaLibrarySheet` | system default | system |
| `isMediaPickerPresented` | `fullScreenCover` | full screen |
| `showsVolumeControl` | `.fraction(0.5)` | ultraThinMaterial |
| `activeEditingSheet` (12 cases) | `.fraction(0.5)` | ultraThinMaterial |
| `activeTabSheet` | `.fraction(0.55)` | ultraThinMaterial |
| `exportedVideo` | `ShareSheet` | system |
| `completedExportURL` | `.confirmationDialog` | system |
| `pendingTrackDeletion` | `.confirmationDialog` | system |

### Editing sheet sizes (declared, but actual sheet uses one detent `.fraction(0.5)` — see `editingSheetHeight(for:)` line 2886 for the design heights):

| Sheet | Height (pt design intent) |
|---|---|
| volume, speed, pan | 230 |
| fade, trackMix | 360 |
| duration | 250 |
| opacity | 220 |
| crop | 420 |
| keyframe | 440 |
| transition | 500 |
| filters | 286 |
| adjust | 306 |
| blendMode | 480 |

### Lower panel (context tool bar)

`lowerPanel()` (line 2351) is **not** a sheet — it is the bottom-anchored area composed of:

```
VStack(spacing: 0) {
    Divider (1pt, white opacity 0.04)
    contextToolBar  (height 56, only present when lowerPanelContent != nil — animated .move(.top).combined(.opacity), snappy 0.2s)
    tabBar          (height 56)
}
.background(OpenReelTheme.surfaceElevated)
```

`lowerPanelContent` is a `SelectionPanel` enum: `videoEdit` / `imageEdit` / `audioEdit` / `textEdit` / `graphicsEdit`. The bar reacts to selection-change `onChange` handlers.

### Dismissal patterns

- Tab sheets — drag-down or `onBack` callback that calls `dismissLowerPanel()` (resets `lowerPanelContent`, `toolBarLevel`, `editorTab = .edit`, both `activeEditingSheet` and `activeTabSheet` to nil).
- Edit sheets — system drag indicator; setting `activeEditingSheet = nil`.
- Confirmation dialogs — system Cancel/role buttons.

---

## 8. Selection & editing model

### What gets selected

Three independent selection slots on `AppState`:
- `selectedClipID` (and `selectedClipIDs: Set<String>` for multi-select) — video/image/audio clips
- `selectedTextClipID` / `selectedTextClipIDs`
- `selectedGraphicsClipID` / `selectedGraphicsClipIDs`
- Plus: `selectedKeyframeID`, `selectedTransitionID`

Selecting one type clears unrelated panels via the `onChange` chain at the top of `baseEditorView`.

### Tap on a timeline clip

`selectClipForPreview(clip:in:)`:
1. Pause playback.
2. `appState.selectClip(clip)`.
3. Resync playback graph to include the clip.
4. Seek to `clip.startTime` (clamped to project duration).

`handleSelectedClipChange` then sets the `lowerPanelContent`:
- image media → `.imageEdit`
- audio media → `.audioEdit`
- else → `.videoEdit`

…and resets `toolBarLevel = .tools`, clears any editing sheet, sets tab to `.edit`.

### Double-tap

- Video preview layer → reset selected clip's transform.
- Text overlay or text timeline block → opens the text editor (via `presentTextClipEditor`, which selects the text clip, sets `activeTabSheet = .text`, and forces edit mode).

### Long-press

- On a clip block (0.25s) → begins **move drag**. Lifts the block visually (offset), commits on release with a `.medium` haptic.
- On the volume button (0.4s) → opens the volume sheet.
- On the track badge → context menu (Move Up/Down, Select All, Delete Track, plus Track Mix for audio).

### Context tool bar (selection-driven actions, line 2396)

When `lowerPanelContent` is set, a horizontal scrolling tool strip appears above the tab bar:

- A **close/back button** (36×44) — `xmark` when at `.tools` level, `chevron.left` when in a sub-options level. Light haptic on tap.
- Optional multi-selection badge — capsule pill `accent`, "`{n} selected`" 10pt bold rounded white, 8h/4v padding.
- Then either `editActions` (top-level tool strip) or `subOptions(for: toolTitle)` (level 2).

Each `toolStripButton` is 54pt wide, `VStack(spacing: 2)`:
- 30×30 SF Symbol (15pt semibold)
- 8pt semibold rounded label (1 line)
- Foreground:
  - `Delete` → `OpenReelTheme.destructive`
  - Enabled → `textSecondary`
  - Disabled → `textSecondary.opacity(0.35)`
The tool actions per selection type (`editActions` computed property) — symbols here are SF Symbol names:

**Video clip** (`videoEditActions`):
Split (`scissors`), Keyframe (`diamond.fill`), Transition (`rectangle.on.rectangle`), Delete (`trash`), Detach (`link.circle`), Volume (`speaker.wave.2`), Pan (`dial.low`), Fade (`waveform.path.ecg`), Speed (`gauge.with.dots.needle.33percent`), Crop (`crop`), Mask (`lasso`), Blend (`square.on.square`), Effects (`wand.and.stars`), Filters (`camera.filters`), Adjust (`slider.horizontal.3`), Adjustment Layer (`square.3.layers.3d`).

**Image clip** (`imageEditActions`):
Duration (`clock`), Keyframe, Transition, Delete, Crop, Blend, Effects, Filters, Adjust, Adjustment Layer, Opacity (`circle.lefthalf.filled`).

**Audio clip** (`audioEditActions`):
Split, Delete, Volume, Pan, Fade, Speed.

**Text clip** (`textEditActions`):
Edit Text (`textformat.size`), Keyframe, Duration, Opacity, Delete.

**Graphics clip** (`graphicsEditActions`):
Delete only.

#### Sub-options (level 2)

`Adjust` → Brightness, Contrast, Saturation, Temperature, Hue, Sharpen, Vignette.
`Effects` opens the Effects panel, including its on-device Video Tools.
`Keyframe` → Opacity, Position, Scale, Rotation.
`Fade` → Fade In, Fade Out.
`Blend` → Mode.
`Crop` → Free, 16:9, 9:16, 4:3, 1:1.
`Filters` → Cinematic, Vintage, B&W, Cool, Warm.
`Transition` → Type.

Tools route by `handleToolTap`:
- Immediate actions (`Split`, `Delete`, `Detach`) execute right away.
- Single-control tools (`Volume`, `Pan`, `Speed`, `Duration`, `Opacity`, `Edit Text`) directly open their sheet.
- Multi-option tools (`Adjust`, `Effects`, `Keyframe`, `Fade`, `Blend`, `Crop`, `Filters`) set `toolBarLevel = .subOptions(title)`.
- Transition opens the transition sheet after adding/selecting one.

### Ripple delete

Long-press / context-menu on the Delete button shows "Ripple Delete" (destructive) which calls `appState.deleteSelectedClip(ripple: true, …)`. Plain Delete is non-ripple.

### Action enablement (`isEditingActionEnabled`)

- `Delete` → enabled if any selection.
- `Keyframe` → clip or text selected.
- `Transition` → must have an adjacent clip after the selected one.
- `Edit Text` → text clip selected.
- `Duration`/`Opacity` → text or image only.
- `Detach` → `appState.canDetachSelectedClipAudio`.
- `Split`/`Volume`/`Speed`/`Crop`/`Effects`/`Filters`/`Adjust`/`Blend` → clip selected.
- `Pan`/`Fade` → clip with audio (audio media or video with audio tracks).

---

## 9. Keyboard shortcuts (iPad)

**None implemented.** The codebase contains no `.keyboardShortcut`, `.onCommand`, or `UICommand` definitions, and the app is currently iPhone-only (recent commit explicitly switched the target device family). Android port can defer hardware-keyboard support.

---

## 10. Reusable shared components

### From `Shared/Components/EditorPanels/EditorPanelComponents.swift`

#### `EditorPanelContainer<Content>`
Outer wrapper for all sheet/tab panels.

- `VStack(alignment: .leading, spacing: 16)` filling the area.
- Holds a `PanelHeader` then arbitrary content.
- Padding 16. Background `OpenReelTheme.surfaceElevated`.
- API: `title`, `subtitle`, `symbol` (SF Symbol), optional `onBack`, `@ViewBuilder content`.

#### `PanelHeader`
- `HStack(spacing: 12)`:
  - Optional back button — 34×34 circle, `OpenReelTheme.surface`, icon `chevron.left` (15pt bold textPrimary).
  - Symbol tile — 34×34 RoundedRectangle(10) accent fill, white SF Symbol (16pt bold).
  - Title (17pt bold rounded textPrimary) + subtitle (12pt medium rounded textSecondary, 1 line).
  - Trailing `Spacer`.

#### `EditorMenuRow`
Vertical list row with icon tile, title/subtitle and chevron.

- `HStack(spacing: 12)`, `.padding(12)`, RoundedRectangle(14) `surface`, 1pt 6%-white stroke.
- Icon tile 36×36 RoundedRectangle(12) `surfaceElevated`, SF Symbol 16pt bold in `accentColor` (or 35% textSecondary when disabled).
- Two-line title block: 13pt bold rounded + 11pt medium rounded `textSecondary` (2 lines max).
- Disclosure chevron 12pt bold textSecondary on right (toggleable).
- Disabled state dims everything to 35%.

#### `PanelActionTile`
Square tile for grid actions.

- `VStack(alignment: .leading, spacing: 12)`, minHeight 98, padding 12.
- RoundedRectangle(12) `surface`, 1pt 6%-white stroke.
- Icon 18pt semibold accent (top), title (13pt bold rounded, 1 line) + subtitle (11pt medium rounded, 2 lines).

#### `PresetGridCard`
Grid cell with colored icon panel + label/subtitle, supports selection state.

- minHeight 126, padding 10, RoundedRectangle(12).
- Top — 52pt-tall RoundedRectangle(10) filled with `accentColor.opacity(0.12)` (or `.24` selected), centered icon 20pt semibold.
- Below — 12pt bold rounded title + 10pt medium rounded subtitle (2 lines).
- Selected state strokes border with `accent` 2pt; idle 1pt 6%-white.

#### `CompactSliderRow`
- HStack(spacing: 10), 92-wide left label, slider, 52-wide right value text.
- Label: 11pt semibold rounded textSecondary.
- Value: 11pt bold monospaced textSecondary, formatted via `format(value)` (default `"NN%"`).
- Slider tint `accent`.

#### `SwatchButton`
- Circle 34×34 fill from a hex color (or `surface` + `slash.circle` 18pt for hex == "none").
- Selected: 3pt accent stroke; idle: 1pt 12%-white.

`Color.init(hexString:)` extension parses via `OpenReelColorParser.components`.

### From `EditorView.swift` (private helpers used by sheets)

- `sheetHeader(title:value:)` — bold rounded 17pt left + 15pt semibold mono accent right.
- `sliderRow(label:value:range:onChange:)` — 72-wide label, accent slider, 40-wide percent.
- `controlSliderRow(label:value:range:valueText:onChange:)` — same but custom value text.
- `clipPresetButton(label:action:)` — full-width 10v padding, 10-radius `surfaceElevated`, 12pt semibold rounded label.
- `sheetSliderCard(label:value:range:format:onChange:)` — horizontal-scrollable card 210×72, RoundedRectangle(12) `surfaceElevated`, label (12pt bold rounded) + accent value (11pt bold mono) + accent slider.
- `easingMenu(selected:onSelect:)` — 44-tall RoundedRectangle(10) `surfaceElevated`, icon `point.topleft.down.curvedto.point.bottomright.up`, "Easing" label, current value mono, chevron `up.chevron.down`.
- `audioCurveMenu` — variant of easingMenu (options: Linear, Exp, Log, S-Curve, Bezier).
- `RotaryKnob(label:value:range:format:onChange:)` (private struct, line 5338) — 64pt knob with a 4pt circular track, accent arc (135°→405°), 6pt notch dot, centered formatted value (11pt bold mono). Vertical drag sensitivity = `(range / 120)` per pt. `.light` haptic on grab. `format` is `.percentage` / `.decimal` / `.signed`.
- `FilterPresetCard(name:symbol:tintColor:isSelected:action:)` — 64×64 RoundedRectangle(14) card, 18pt symbol + 10pt semibold rounded label. Selected: accent foreground + `accent.opacity(0.1)` fill + 2pt accent stroke. 200ms ease-out animation on selection.

### Timeline-only structs

- `TimelineKeyframeMarker` — described above; 32×32 hit area.
- `TimelineTransitionMarker` — described above.
- `TimelineClipBlock` / `TimelineAudioClipBlock` / `TimelineTextClipBlock` / `TimelineGraphicsClipBlock` — described above.
- `TimelineTriangle` (Shape) — equilateral triangle pointing up.
- `TimelinePolygon(points:)` (Shape) — regular polygon with N vertices.
- `Arc(startDegrees:endDegrees:)` (Shape) — for the rotary knob arc.

---

## 11. Animation, haptic, sound feedback

### Animations

- Lower panel context tool bar appearance: `.snappy(duration: 0.2)` animation keyed on `lowerPanelContent != nil`. Transition: `.move(edge: .top).combined(with: .opacity)`.
- `FilterPresetCard` selection: `.easeOut(duration: 0.2)`.
- Sheet presentations: default SwiftUI sheet animation, with `presentationBackground(.ultraThinMaterial)` for the blurred backdrop.
- Timeline auto-scroll during playback: implicit (driven by `scrollPosition.scrollTo(x:)`).

There are no explicit Lottie / particle effects. The video player content itself animates per frame.

### Haptics (UIKit `UIImpactFeedbackGenerator`)

- `.light` — tool-strip button taps, sub-option button taps, context bar close, every trim handle end, transition marker drag end, rotary knob grab start, text-editor open.
- `.medium` — clip move (long-press drag) end.

No notification or warning haptics are used.

### Sound

No custom sound effects. Only the player audio plays (via AVAudioEngine in `TimelineAudioPreviewEngine`).

---

## 12. Android mapping suggestions

### Layout & navigation

- Implement the editor as a single `Activity` with a Compose `Scaffold` (no nav-host needed inside) — the screen never navigates away; sheets and dialogs handle all secondary UI.
- Lock orientation to portrait in the manifest (`android:screenOrientation="portrait"`).
- Top bar → `Surface` with `RoundedCornerShape(20.dp)` and `Modifier.padding(horizontal = 16.dp)`. Use `MaterialTheme` colors mapped to the OpenReelTheme tokens.
- Sheets → `ModalBottomSheet` with `SheetState` and fixed `skipPartiallyExpanded = false` to mimic `.fraction(0.5)`/`.fraction(0.55)` detents. Use `WindowInsets.safeDrawing` for the root scaffold; sheets can ignore them (`scrim` covers).
- Confirmation dialogs → `AlertDialog` with destructive role on red buttons. Track delete & export complete are the only two.
- Picker / full screen → use a separate `Activity` for `MediaPicker` (Photo Picker API on Android 13+, `ActivityResultContracts.PickMultipleVisualMedia`).

### Preview canvas

- `SurfaceView` or `TextureView` wrapped in `AndroidView`. Pull frames from ExoPlayer's `VideoFrameMetadataListener` + `GLSurfaceView` to mirror the Metal pipeline. Use `RenderEffect` (API 31+) for blur and color effects; for older devices fall back to OpenGL fragment shaders matching `VideoEffectRenderer`.
- Overlays (text, graphics, image) → Compose layers on top of the player view, animated via `Animatable` / `graphicsLayer { translationX, translationY, scaleX, scaleY, rotationZ }` for the same parameters as `OpenReelProject.Transform`.
- Gestures: `Modifier.pointerInput { detectTransformGestures(...) }` covers pinch + rotate + drag in a single recognizer. Commit on `awaitFirstDown … awaitPointerEvent { gesture.changes }` then `.changedToUp` mirrors the `.onEnded`-only commit pattern. Double-tap → `detectTapGestures(onDoubleTap = …)`.

### Timeline

- Use a custom `LazyColumn` for the lanes and a single `HorizontalScrollState` (synchronized between the ruler row and each lane row). Both `LazyColumn` (vertical) and lanes (horizontal) share the same horizontal state so the ruler and tracks scroll together.
- Pinch-to-zoom: `Modifier.pointerInput` → `detectTransformGestures` with only `zoom` consumed → update `pixelsPerSecond` clamped 20..300.
- Clip blocks → `Canvas` or `Box` with `Modifier.drawBehind` for thumbnails. Use `Coil` for `AsyncImage` thumbnails. Filmstrip behaviour mirrors `displayThumbnailURLs` (nearest-neighbor selection).
- Trim handles → `Modifier.draggable` with `Orientation.Horizontal`; update local offset during drag, commit `onDragStopped`.
- Move-on-long-press → `Modifier.combinedClickable(onLongClick = ...)` to enter "move" mode, then `Modifier.draggable`. Add a `HapticFeedbackType.LongPress` on enter and `TextHandleMove` on commit.
- Playhead grab handle → `Box` with `Modifier.pointerInput { awaitEachGesture { ... } }` (start gesture immediately, no minimum distance). Disable horizontal scroll while dragging by toggling a `nestedScrollConnection`.

### Selection model

- `EditorViewModel` (single shared) holds: selectedClipId, selectedTextClipId, selectedGraphicsClipId, multiselect sets, selectedKeyframeId, selectedTransitionId. Use `MutableStateFlow` / Compose `mutableStateOf`. Mirror the iOS `onChange` cascades with `LaunchedEffect`s.
- The 5-way `LowerPanelContent` enum maps to a sealed class. The 12-way `EditingSheet` enum maps to another sealed class. Use `derivedStateOf` to compute `editActions` based on selection.

### Sheets / inspectors

- All editing sheets share a common `BottomSheetContent` composable with: header row (title bold, value mono accent), body slot. Heights from `editingSheetHeight(for:)` map directly to `Modifier.height(…dp)` if you want to mimic per-sheet sizing — or use a uniform 50% detent.
- Tab sheets get 55% detent (`fraction = 0.55f`). Use `accompanist-flowlayout` or `LazyVerticalGrid` inside for grid layouts.

### Theming

- Map `OpenReelTheme` to a Material 3 `ColorScheme` plus app-specific extras (the gradient projectstyles need custom `Brush.linearGradient` constants).
- Fonts: substitute `FontFamily.SansSerif` for SF Rounded; use a custom rounded font like `Inter` or `Manrope` for parity. Monospaced uses `FontFamily.Monospace`.
- Project gradients (emerald / cobalt / amber / coral) — define as constants from the RGB triples in `Theme.swift` lines 43–50.

### Haptics

- Light → `HapticFeedbackType.TextHandleMove`.
- Medium → `HapticFeedbackType.LongPress`.

### Tab bar / icons

Use `Icons.Default` (Material) or import a parallel set; here is a suggested mapping for the bottom tabs:

| iOS SF Symbol | Material Icon (suggested) |
|---|---|
| `photo.on.rectangle` | `PhotoLibrary` |
| `textformat` | `TextFields` |
| `square.on.circle` | `Category` |
| `square.stack.3d.up` | `ViewInAr` / `Layers` |
| `wand.and.stars` | `AutoAwesome` |
| `captions.bubble` | `ClosedCaption` |
| `music.note` | `MusicNote` |
| `scissors` | `ContentCut` |
| `arrow.uturn.backward` / `forward` | `Undo` / `Redo` |
| `square.and.arrow.up.fill` | `IosShare` / `Upload` |
| `chevron.left` | `ChevronLeft` |
| `play.fill` / `pause.fill` | `PlayArrow` / `Pause` |
| `backward.frame.fill` / `forward.frame.fill` | `SkipPrevious` / `SkipNext` |
| `speaker.*` family | `VolumeOff` / `VolumeMute` / `VolumeDown` / `VolumeUp` |

Reuse a single `ToolAction(title, icon)` data class for the tool strip and feed `editActions` to a `LazyRow`.

### Naming parity files

| iOS file | Suggested Android module |
|---|---|
| `EditorView.swift` | `editor/EditorScreen.kt`, `editor/EditorViewModel.kt` (split) |
| `EditorPanelComponents.swift` | `editor/components/Panels.kt` |
| `MetalVideoView.swift` | `editor/preview/VideoSurface.kt` (+ GLSL shaders) |
| `EffectImageView.swift` | `editor/preview/EffectImage.kt` |
| `PlaybackController.swift` | `editor/playback/PlaybackController.kt` |

Mirror the iOS `@Observable` pattern via `StateFlow` + Compose `collectAsStateWithLifecycle`. Keep the engine layer pure (no Android framework deps) so the action history can be reused on JVM tests.
