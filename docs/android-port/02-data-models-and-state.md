# 02 — Data Models, Project Format, and Persistence

Source of truth for the Android Kotlin port. Every type below is verbatim from the iOS SwiftUI app.

Primary source files:

- `Openreel Video/Openreel Video/Core/Models/OpenReelProject.swift`
- `Openreel Video/Openreel Video/Core/Storage/ProjectStore.swift`
- `Openreel Video/Openreel Video/Core/Timeline/ActionHistory.swift`
- `Openreel Video/Openreel Video/Core/Timeline/TimelineTransitionResolver.swift`
- `Openreel Video/Openreel Video/Core/Timeline/TransitionCatalog.swift`
- `Openreel Video/Openreel Video/AppState.swift`

---

## 1. OpenReelProject schema

### 1.1 Envelope

```swift
struct OpenReelProjectFile: Codable, Equatable {
    static let schemaVersion = "1.1.0"
    var version: String      // schema version (currently "1.1.0")
    var project: OpenReelProject
}
```

The persisted JSON is always wrapped in `OpenReelProjectFile { version, project }`. `version` is required when decoding; absence implies the file is corrupt.

A second envelope exists for template packages:

```swift
struct OpenReelTemplatePackageFile: Codable, Equatable {
    static let schemaVersion = "1.0.0"
    var version: String
    var template: OpenReelProject.TemplatePackage
}
```

### 1.2 OpenReelProject (root)

| Field              | Type                      | Default       | Notes |
|--------------------|---------------------------|---------------|-------|
| `id`               | `String`                  | required      | UUID v4 string |
| `name`             | `String`                  | required      | Display name |
| `createdAt`        | `Int`                     | required      | Unix epoch **milliseconds** |
| `modifiedAt`       | `Int`                     | required      | Unix epoch **milliseconds** |
| `settings`         | `ProjectSettings`         | required      | |
| `exportPreferences`| `ExportPreferences`       | derived from `settings` if missing | added in 1.1 |
| `mediaLibrary`     | `MediaLibrary`            | required      | |
| `timeline`         | `Timeline`                | required      | |
| `textClips`        | `[TextClip]`              | `[]`          | optional in JSON |
| `graphicsClips`    | `[GraphicsClip]`          | `[]`          | optional in JSON |

Custom Codable on the project allows missing `exportPreferences`, `textClips`, and `graphicsClips` (migration path from older 1.0.x files).

### 1.3 ProjectSettings

```swift
struct ProjectSettings: Codable, Equatable {
    var width: Int
    var height: Int
    var frameRate: Double  // hz, normalized to {24, 30, 60}
    var sampleRate: Int    // typically 48000
    var channels: Int      // typically 2
}
```

`NewProjectConfiguration` defaults: `sampleRate = 48_000`, `channels = 2`, `frameRate = 30`, preset = 1080p `1920x1080`. Supported frame rates: `[24, 30, 60]`. Presets: `1080p (1920x1080)`, `Square (1080x1080)`, `Portrait (1080x1920)`, `4K (3840x2160)`.

### 1.4 Export configuration

```swift
struct ExportPreferences: Codable, Equatable {
    var preset: ExportPreset          // default: .youtube
    var resolution: ExportResolution
    var frameRate: Double             // snapped to supported rates
    var format: ExportFormat          // default by preset
    var quality: Double               // clamped to [0.2, 1.0]; default 0.85
}

enum ExportPreset: String, Codable, CaseIterable {
    case youtube, tiktok, instagramSquare, instagramPortrait, twitter, custom
}

struct ExportResolution: Codable, Hashable {
    var width: Int   // min 1
    var height: Int  // min 1
}

struct ExportFormat: Codable, Equatable {
    var container: ExportContainer
    var codec: ExportCodec
    var proResProfile: ProResProfile?   // only set when codec == .proRes
}

enum ExportContainer: String, Codable { case mp4, mov, gif }
enum ExportCodec: String, Codable { case h264, hevc, proRes, gif }
enum ProResProfile: String, Codable { case proxy, lt, standard, hq }
```

Format invariants (enforced in `ExportFormat.init`):

- `codec == .gif` -> `container = .gif`
- `codec == .proRes` -> `container = .mov`, `proResProfile` defaulted to `.standard` if nil
- Otherwise `container` honored, `proResProfile = nil`

Preset → default resolution:

| Preset             | Resolution    | Default codec  |
|--------------------|---------------|----------------|
| youtube            | 1920x1080     | hevc           |
| tiktok             | 1080x1920     | h264           |
| instagramSquare    | 1080x1080     | hevc           |
| instagramPortrait  | 1080x1350     | h264           |
| twitter            | 1920x1080     | h264           |
| custom             | 1920x1080     | hevc           |

### 1.5 Schema version migrations

| From | To    | Migration |
|------|-------|-----------|
| —    | 1.0.0 | initial   |
| 1.0.x| 1.1.0 | `exportPreferences`, `textClips`, `graphicsClips` made optional during decode and default-initialized; `Timeline.beatMarkers`, `Timeline.beatAnalyses` made optional. `Track.audioMix` defaults to `AudioTrackMix()`. `Clip.audioConfiguration` defaults to `AudioConfiguration()`. |

There is no in-place rewrite of files; old documents simply decode with defaults filled in, and the next save writes `version = "1.1.0"`.

---

## 2. Track, Clip, Layer hierarchy

### 2.1 Timeline

```swift
struct Timeline: Codable, Equatable {
    var tracks: [Track]
    var subtitles: [Subtitle]
    var duration: Double                 // seconds; optional, default 0
    var markers: [Marker]
    var beatMarkers: [BeatMarker] = []
    var beatAnalyses: [BeatAnalysis] = []
}
```

`subtitles`, `markers`, `beatMarkers`, `beatAnalyses` are optional in JSON and default to `[]`.

### 2.2 Track

```swift
struct Track: Codable, Identifiable, Equatable {
    var id: String
    var type: TrackType
    var name: String
    var clips: [Clip]
    var transitions: [Transition]
    var locked: Bool      // default false
    var hidden: Bool      // default false
    var muted: Bool       // default false
    var solo: Bool        // default false
    var audioMix: AudioTrackMix = AudioTrackMix()
}

enum TrackType: String, Codable { case video, audio, image, text, graphics }

enum AudioTrackRole: String, Codable, CaseIterable {
    case general, dialogue, music, effects, ambience
}

struct AudioTrackMix: Codable, Equatable {
    var role: AudioTrackRole   // default .general
    var gain: Double           // default 1
    var pan: Double            // default 0 (range [-1, 1])
}
```

There is no z-order field — order in `tracks[]` is the stacking order. `clips` and `transitions` are optional on decode (default `[]`); `locked/hidden/muted/solo/audioMix` are optional with the defaults above.

### 2.3 Clip (media-backed: video, audio, image)

```swift
struct Clip: Codable, Identifiable, Equatable {
    var id: String
    var mediaId: String              // references MediaLibrary.items[].id
    var trackId: String
    var startTime: Double            // seconds on timeline; default 0
    var duration: Double             // seconds; default 0
    var inPoint: Double              // source in-point; default 0
    var outPoint: Double             // source out-point; default == duration
    var effects: [Effect]            // visual/processing effects; default []
    var audioEffects: [Effect]       // audio effects; default []
    var transform: Transform
    var volume: Double               // default 1; clamped [0, 2]
    var keyframes: [Keyframe]        // default []
    var speed: Double?               // optional; default nil; clamped [0.25, 4]
    var reversed: Bool?              // optional
    var audioTrackIndex: Int?        // for multi-track media
    var audioConfiguration: AudioConfiguration = AudioConfiguration()
    var blendMode: BlendMode? = nil
    var blendOpacity: Double? = nil
    var emphasisAnimation: EmphasisAnimation? = nil
    var metadata: ClipMetadata? = nil
}
```

The minimum clip duration (enforced everywhere): `minimumClipDuration = 0.2` seconds.

### 2.4 Transform / Crop / FitMode

```swift
struct Transform: Codable, Equatable {
    var position: Point           // canvas-space, e.g. (0.5, 0.5) for center
    var scale: Point              // x/y scale, 1 = identity
    var rotation: Double          // radians or degrees per usage site
    var anchor: Point             // anchor point for rotation/scale (0..1 normalized)
    var opacity: Double           // [0, 1]
    var borderRadius: Double?     // px or normalized
    var fitMode: FitMode?         // how source media fits frame
    var crop: Crop?
}

struct Point: Codable, Equatable { var x: Double; var y: Double }
struct Crop:  Codable, Equatable { var x, y, width, height: Double }

enum FitMode: String, Codable { case contain, cover, stretch, none }
```

### 2.5 Blend modes

```swift
enum BlendMode: String, Codable, CaseIterable {
    case normal, multiply, screen, overlay, darken, lighten,
         colorDodge = "color-dodge", colorBurn = "color-burn",
         hardLight = "hard-light", softLight = "soft-light",
         difference, exclusion, hue, saturation, color, luminosity
}
```

Applied per-clip via `Clip.blendMode` and `Clip.blendOpacity` (in addition to `Transform.opacity`). Text clips and graphics clips have the same two fields.

### 2.6 Effects

```swift
struct Effect: Codable, Identifiable, Equatable {
    var id: String
    var type: String                       // engine-specific identifier
    var params: [String: JSONValue]        // arbitrary parameter map
    var enabled: Bool
}
```

`Clip.effects` is the visual stack; `Clip.audioEffects` is the audio stack. Order is render order. Effects can be copied across clips via `AppState.copiedEffectStack: [Effect]`.

### 2.7 Keyframes

```swift
struct Keyframe: Codable, Identifiable, Equatable {
    var id: String
    var time: Double         // seconds, relative to clip start
    var property: String     // e.g. "transform.position", "opacity"
    var value: JSONValue
    var easing: String       // see EasingFunctions catalog
}
```

Both `Clip` and `TextClip` and `GraphicsClip` carry their own `keyframes: [Keyframe]`. `KeyframeEngine.upserting(_:into:clipDuration:)` is the canonical mutation API.

### 2.8 Audio configuration

```swift
enum AudioAutomationCurve: String, Codable {
    case linear, exponential, logarithmic,
         sCurve = "s-curve", bezier
}

struct AudioBezierControlPoints: Codable, Equatable {
    var cp1x, cp1y, cp2x, cp2y: Double
}

struct AudioFade: Codable, Equatable {
    var duration: Double
    var curve: AudioAutomationCurve   // default .linear
    var bezierControlPoints: AudioBezierControlPoints?
}

struct AudioAutomationPoint: Codable, Identifiable, Equatable {
    var id: String
    var time: Double
    var value: Double
    var curve: AudioAutomationCurve   // default .linear
    var bezierControlPoints: AudioBezierControlPoints?
}

struct AudioConfiguration: Codable, Equatable {
    var pan: Double                                // [-1, 1]; default 0
    var fadeIn: AudioFade?
    var fadeOut: AudioFade?
    var volumeAutomation: [AudioAutomationPoint]   // default []
    var linkGroupID: String?                       // links video+detached audio
    var detachedSourceClipID: String?              // back-ref to source clip
}
```

### 2.9 Beats and markers

```swift
struct BeatMarker: Codable, Identifiable, Equatable {
    var id: String
    var time: Double
    var strength: Double
    var index: Int
    var isDownbeat: Bool
    var sourceClipID: String?
}

struct BeatAnalysis: Codable, Equatable {
    var sourceClipID: String
    var bpm: Double
    var confidence: Double
    var analyzedAt: Int      // unix ms
}

struct Marker: Codable, Identifiable, Equatable {
    var id: String
    var time: Double
    var label: String
    var color: String        // hex
}
```

### 2.10 Subtitles

```swift
struct Subtitle: Codable, Identifiable, Equatable {
    var id: String
    var text: String
    var startTime: Double
    var endTime: Double
    var style: SubtitleStyle? = nil
    var words: [SubtitleWord]? = nil
    var animationStyle: CaptionAnimationStyle? = nil
}

struct SubtitleWord: Codable, Equatable {
    var text: String
    var startTime: Double
    var endTime: Double
}

struct SubtitleStyle: Codable, Equatable {
    var fontFamily: String          // default "SF Pro"
    var fontSize: Double            // default 24
    var color: String               // default "#FFFFFF"
    var backgroundColor: String     // default "rgba(0,0,0,0.75)"
    var position: SubtitlePosition  // default .bottom
    var highlightColor: String?
    var upcomingColor: String?
}

enum SubtitlePosition: String, Codable, CaseIterable { case top, center, bottom }

enum CaptionAnimationStyle: String, Codable, CaseIterable {
    case none,
         wordHighlight = "word-highlight",
         wordByWord = "word-by-word",
         karaoke, bounce, typewriter
}
```

### 2.11 Text clips

```swift
struct TextClip: Codable, Identifiable, Equatable {
    var id: String
    var trackId: String
    var startTime: Double
    var duration: Double
    var text: String
    var style: TextStyle
    var transform: Transform
    var animation: TextAnimation?
    var keyframes: [Keyframe]
    var blendOpacity: Double?
    var behindSubject: Bool?                 // SAM-derived render-behind flag
    var metadata: [String: JSONValue]?
    var blendMode: BlendMode? = nil
    var emphasisAnimation: EmphasisAnimation? = nil
}

struct TextStyle: Codable, Equatable {
    var fontFamily: String
    var fontSize: Double
    var fontWeight: TextFontWeight
    var fontStyle: String              // "normal" | "italic"
    var color: String                  // hex
    var backgroundColor: String?
    var strokeColor: String?
    var strokeWidth: Double?
    var shadowColor: String?
    var shadowBlur: Double?
    var shadowOffsetX: Double?
    var shadowOffsetY: Double?
    var textAlign: TextAlign           // left, center, right, justify
    var verticalAlign: TextVerticalAlign  // top, middle, bottom
    var lineHeight: Double
    var letterSpacing: Double
    var textDecoration: String?        // "underline" | "line-through" | nil
}

enum TextFontWeight: Codable, Equatable {
    case numeric(Int)    // 100..900
    case named(String)   // "bold", "regular", etc.
}

enum TextAlign: String, Codable, CaseIterable {
    case left, center, right, justify
}

enum TextVerticalAlign: String, Codable { case top, middle, bottom }

struct TextAnimation: Codable, Equatable {
    var preset: TextAnimationPreset
    var params: [String: JSONValue]
    var inDuration: Double
    var outDuration: Double
    var stagger: Double?
    var unit: TextAnimationUnit?       // character | word | line
}

enum TextAnimationPreset: String, Codable, CaseIterable {
    case none, typewriter,
         wordHighlight = "word-highlight",
         karaoke, fade,
         slideLeft = "slide-left", slideRight = "slide-right",
         slideUp = "slide-up", slideDown = "slide-down",
         scale, blur, bounce, rotate, wave, shake, pop, glitch, split, flip,
         wordByWord = "word-by-word", rainbow
}
```

### 2.12 Graphics clips

```swift
struct GraphicsClip: Codable, Identifiable, Equatable {
    var id: String
    var trackId: String
    var startTime: Double
    var duration: Double
    var type: GraphicType                    // shape | image | sticker | emoji
    var transform: Transform
    var keyframes: [Keyframe]
    var blendMode: BlendMode?
    var blendOpacity: Double?
    var emphasisAnimation: EmphasisAnimation?
    var shapeType: ShapeType?                // when type == .shape
    var style: ShapeStyle?
    var points: [Point]?                     // for polygon/line
    var asset: GraphicAsset?                 // for image/sticker/emoji
    var metadata: [String: JSONValue]?
}

enum GraphicType: String, Codable, CaseIterable {
    case shape, image, sticker, emoji
}

enum ShapeType: String, Codable, CaseIterable {
    case rectangle, circle, ellipse, triangle, arrow, line, polygon, star
}

struct GraphicAsset: Codable, Equatable {
    var imageURL: String?
    var localFileName: String?
    var emoji: String?
    var symbolName: String?     // SF Symbols / Android equivalent
    var name: String?
    var category: String?
}

struct ShapeStyle: Codable, Equatable {
    var fill: FillStyle
    var stroke: StrokeStyle
    var shadow: ShadowStyle?
    var cornerRadius: Double?
    var points: Int?
    var innerRadius: Double?    // for star
}

struct FillStyle: Codable, Equatable {
    var type: FillKind          // solid | gradient | none
    var color: String?
    var gradient: GradientStyle?
    var opacity: Double
}

enum FillKind: String, Codable { case solid, gradient, none }

struct GradientStyle: Codable, Equatable {
    var type: GradientKind      // linear | radial
    var angle: Double?
    var stops: [GradientStop]
}

enum GradientKind: String, Codable { case linear, radial }
struct GradientStop: Codable, Equatable { var offset: Double; var color: String }

struct StrokeStyle: Codable, Equatable {
    var color: String
    var width: Double
    var opacity: Double
    var dashArray: [Double]?
    var dashOffset: Double?
    var lineCap: StrokeLineCap?     // butt | round | square
    var lineJoin: StrokeLineJoin?   // miter | round | bevel
}

struct ShadowStyle: Codable, Equatable {
    var color: String
    var blur: Double
    var offsetX: Double
    var offsetY: Double
}
```

### 2.13 Emphasis animation (clip-level "wiggle")

```swift
struct EmphasisAnimation: Codable, Equatable {
    var type: EmphasisAnimationType
    var speed: Double
    var intensity: Double
    var loop: Bool
    var focusPoint: Point?
    var zoomScale: Double?
    var holdDuration: Double?
    var startTime: Double?
    var animationDuration: Double?
}

enum EmphasisAnimationType: String, Codable, CaseIterable {
    case none, pulse, shake, bounce, float, spin, flash, heartbeat,
         swing, wobble, jello,
         rubberBand = "rubber-band",
         tada, vibrate, flicker, glow, breathe, wave, tilt,
         zoomPulse = "zoom-pulse",
         focusZoom = "focus-zoom",
         panLeft = "pan-left", panRight = "pan-right",
         panUp = "pan-up", panDown = "pan-down",
         kenBurns = "ken-burns"
}
```

### 2.14 Media library

```swift
struct MediaLibrary: Codable, Equatable { var items: [MediaItem] }

struct MediaItem: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var type: MediaType                      // video | audio | image
    var metadata: MediaMetadata
    var thumbnailUrl: String?                // project-relative path
    var waveformData: [Float]?               // pre-rendered waveform
    var filmstripThumbnails: [FilmstripThumbnail]?
    var isPlaceholder: Bool?
    var originalUrl: String?
    var sourceFile: SourceFile?
    var localFileName: String?               // file in project's media/ dir
    var localAssetIdentifier: String?        // PHAsset identifier (iOS only)
}

struct FilmstripThumbnail: Codable, Equatable { var timestamp: Double; var url: String }

struct SourceFile: Codable, Equatable {
    var name: String
    var size: Int64
    var lastModified: Int64
    var folder: String?
}

enum MediaType: String, Codable { case video, audio, image }

struct MediaMetadata: Codable, Equatable {
    var duration: Double
    var width: Int
    var height: Int
    var frameRate: Double
    var codec: String
    var sampleRate: Int
    var channels: Int
    var fileSize: Int64
    var audioTrackCount: Int?
}
```

### 2.15 Transitions

```swift
struct Transition: Codable, Identifiable, Equatable {
    var id: String
    var clipAId: String
    var clipBId: String
    var type: String                  // see TransitionCatalog.supportedTypes
    var duration: Double
    var params: [String: JSONValue]
}
```

Transitions live on `Track.transitions` and reference two adjacent clips on the same track.

### 2.16 Templates

Template packages let users save a portion of a project (text + graphics + effects) as a reusable, parameterized asset.

```swift
struct TemplateSource: Codable {
    var templateId: String
    var applicationId: String
    var ownerClipId: String
    var ownerTrackId: String?
    var controlValues: [String: JSONValue]?
}

enum TemplateTrackType: String, Codable { case text, graphics }

struct AppliedTemplate: Codable, Identifiable {
    var templateId: String
    var applicationId: String
    var name: String
    var category: String?
    var appliedAt: Int
    var controlValues: [String: JSONValue]?
    var id: String { applicationId }
}

enum TemplateCategory: String, Codable, CaseIterable {
    case cinema, glitch, retro, social, branding, color, overlay,
         textEffects = "text-effects", transitions, custom
}

enum TemplateTargetType: String, Codable, CaseIterable { case video, image }
enum TemplateControlType: String, Codable, CaseIterable {
    case number, color, text, toggle, select
}

struct TemplateControlOption: Codable { var label: String; var value: JSONValue }

struct TemplateControlDefinition: Codable, Identifiable {
    var id: String
    var label: String
    var type: TemplateControlType
    var defaultValue: JSONValue
    var min: Double?
    var max: Double?
    var step: Double?
    var options: [TemplateControlOption]?
}

struct TemplatePayload: Codable {
    var duration: Double
    var textClips: [TextClip]
    var graphicsClips: [GraphicsClip]
    var effects: [Effect]
}

struct TemplatePackageSource: Codable {
    var projectId: String?
    var clipId: String?
    var trackId: String?
    var createdWithVersion: String?
}

struct TemplatePackage: Codable, Identifiable {
    var id: String
    var name: String
    var description: String
    var category: TemplateCategory
    var createdAt: Int
    var modifiedAt: Int
    var tags: [String]
    var supportedTargets: [TemplateTargetType]   // default [.video]
    var controls: [TemplateControlDefinition]
    var defaultValues: [String: JSONValue]
    var previewImageData: Data?                  // PNG/JPEG bytes
    var previewImageMimeType: String?
    var payload: TemplatePayload
    var source: TemplatePackageSource?
}

struct ClipMetadata: Codable, Equatable {
    var templateSource: TemplateSource?
    var appliedTemplates: [AppliedTemplate]?
    var templateManaged: Bool?
    var templateTrackType: TemplateTrackType?
    var userInfo: [String: JSONValue]?
}
```

### 2.17 JSONValue (untyped JSON for params/metadata)

```swift
enum JSONValue: Codable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null
}
```

Used pervasively for `effect.params`, `keyframe.value`, `transition.params`, template control values, and metadata.

---

## 3. ProjectStore — persistence layer

`actor ProjectStore` (Swift actor → serializes file I/O on a private queue).

### 3.1 Directory layout

Base URL: `<ApplicationSupport>/OpenReel/Projects/`. Falls back to `NSTemporaryDirectory()/OpenReel/Projects/` if Application Support is unavailable.

Per project:

```
<base>/
  <projectID>/                          (one folder per project)
    project.json                        (the canonical document; JSON, pretty-printed, sorted keys)
    media/                              (imported media files)
      <safeFileName>.mp4
      <safeFileName>.mp3
      ...
    thumbnails/                         (PNG/JPEG thumbnails)
    effects/
      luts/                             (.cube LUTs, see LUTAsset below)
    cache/
      effects/                          (effect render cache)
      ai/                               (AI analysis cache)
  template-library/                     (shared across projects)
    <templateID>.openreeltemplate       (JSON file, OpenReelTemplatePackageFile)
```

### 3.2 Encoding settings

```swift
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let decoder = JSONDecoder()
```

No custom date strategy — timestamps are stored as `Int` Unix milliseconds, not ISO strings.

### 3.3 Operations

| Method | Behavior |
|--------|----------|
| `loadProjects() throws -> [OpenReelProject]` | Lists every subdirectory of base, decodes `<id>/project.json`, returns sorted by `modifiedAt` descending. Skips non-directories and missing `project.json`. |
| `loadProject(id:) throws -> OpenReelProject?` | Returns nil if directory or `project.json` missing. |
| `save(project:) throws` | Creates project dirs, encodes envelope, writes `<id>/project.json` atomically (`.atomic`). |
| `deleteProject(id:) throws` | Removes the entire `<id>/` directory. Throws `.projectNotFound` if absent. |
| `projectStorageUsage(for: [String]) throws -> [String: Int64]` | Recursively sums file sizes per project. |
| `loadTemplatePackages() throws` | Loads all `*.openreeltemplate` from `template-library/`, sorted by modifiedAt desc, name asc tiebreak. |
| `loadTemplatePackage(id:)` / `saveTemplatePackage(_:)` / `deleteTemplatePackage(id:)` | CRUD for shared template library. |
| `exportTemplatePackage(id:, to:) throws -> URL` | Writes a template file to a user-supplied destination (adds `.openreeltemplate` if missing). |
| `importTemplatePackage(from:) throws -> TemplatePackage` | Decodes file and saves to template library. |
| `persistMedia(projectID:, sourceURL:, preferredFileName:, thumbnailData:, thumbnailFileName:) throws -> (mediaFileName, thumbnailRelativePath?)` | Copies media into `<id>/media/`, optional thumbnail into `<id>/thumbnails/`. Uses unique-name strategy (`name`, `name-1`, `name-2`...). |
| `persistThumbnail(projectID:, fileName:, data:) throws -> String` | Writes raw thumbnail bytes; returns relative path `thumbnails/<name>`. |
| `persistEffectLUT(projectID:, sourceURL:, preferredFileName:) throws -> LUTAsset` | Copies a `.cube` LUT into `effects/luts/`, computes **SHA-256** checksum, returns `LUTAsset { relativePath, fileName, checksum, byteCount }`. |

### 3.4 Error type

```swift
enum StoreError: LocalizedError {
    case applicationSupportUnavailable
    case projectNotFound
    case templatePackageNotFound
}
```

### 3.5 File-name sanitization

```swift
private func sanitizeFileName(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "/", with: "-")
        .replacingOccurrences(of: ":", with: "-")
}
```

Empty result is replaced with a UUID. Collisions are resolved by appending `-1`, `-2`, etc. before the extension.

### 3.6 Thumbnail generation

`ProjectStore` does **not** generate thumbnails itself — it only persists bytes given to it. Thumbnail generation lives in `MediaImportService` during import and in the editor's preview compositor when individual frames are needed. The on-disk path is `thumbnails/<sanitized-name>.<ext>` and is referenced from `MediaItem.thumbnailUrl` as a project-relative path.

### 3.7 Autosave cadence

There is **no debounced autosave timer**. Instead, every state-mutating method on `AppState` funnels through:

```swift
private func replaceCurrentProject(with project: OpenReelProject, captureHistory: Bool) async {
    if captureHistory, let currentProject {
        history.capture(currentProject)
        undoRedoToken += 1
    }
    replaceProject(project)
    do {
        try await projectStore.save(project: project)
        lastSavedAt = .now
    } catch {
        importErrorMessage = error.localizedDescription
    }
}
```

So: every edit is immediately persisted, and `AppState.lastSavedAt` is updated. The UI surfaces this timestamp. Android should match this “save-on-every-edit” model with a coalescing layer if disk pressure is observed (e.g. debounce 250 ms via `Flow.debounce`), but the iOS app does not coalesce.

---

## 4. ActionHistory — undo / redo

Source: `Core/Timeline/ActionHistory.swift`.

```swift
@MainActor
final class ActionHistory {
    private(set) var undoStack: [OpenReelProject] = []
    private(set) var redoStack: [OpenReelProject] = []
    private let limit: Int           // default 50

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    func clear()
    func capture(_ state: OpenReelProject)
    func undo(current: OpenReelProject) -> OpenReelProject?
    func redo(current: OpenReelProject) -> OpenReelProject?
}
```

Strategy: **whole-project snapshot** — not diff-based. `capture()` pushes the *previous* state onto the undo stack, drops the redo stack, and trims to `limit` entries (default **50**). `undo()` pops the last undo entry and pushes the *current* state onto the redo stack; `redo()` is symmetric.

Because every edit performs a deep copy of `OpenReelProject` (Swift value types), memory pressure is bounded by project size × 50. For Android, see §8 mapping notes — use a Kotlin `data class` tree (immutable, with `copy(...)`) and store full snapshots, or do binary serialization to bound memory.

The `AppState.undoRedoToken: Int` is bumped after every capture/undo/redo so `@Observable` invalidates the UI for the otherwise-non-observed `ActionHistory`.

---

## 5. AppState — global view-model

`@MainActor @Observable final class AppState`. Single source of truth for every editor screen. Holds an `ActionHistory`, a `ProjectStore`, and a `MediaImportService`. Smart-tool services receive local file URLs and run on device.

### 5.1 Nested types

```swift
enum Screen { case home, projects, editor }
enum EditorTab: String, CaseIterable {
    case edit = "Edit", media = "Media", text = "Text", graphics = "Graphics",
         templates = "Templates", effects = "Effects",
         subtitles = "Subtitles", audio = "Audio"
}
enum AspectRatio: String, CaseIterable {
    case landscape = "16:9", portrait = "9:16", square = "1:1",
         vertical = "4:5", standard = "4:3"
    var value: CGFloat { ... }
}
enum ProjectStyle: String, CaseIterable { case emerald, cobalt, amber, coral }
enum TrimEdge { case leading, trailing }
enum AudioFadeEdge { case fadeIn, fadeOut }
```

### 5.2 Observable state — by feature area

(All declared `var` — `@Observable` macro auto-publishes. The Kotlin equivalent is `MutableStateFlow` per field or a single composite `MutableStateFlow<EditorUiState>`.)

**Navigation / shell**
- `activeScreen: Screen = .home`
- `editorTab: EditorTab = .edit`
- `selectedAspectRatio: AspectRatio = .landscape`

**Project list / lifecycle**
- `projects: [OpenReelProject] = []`
- `projectStorageUsageByID: [String: Int64] = [:]`
- `selectedProjectID: String?`
- `isBootstrapping: Bool = false`
- `hasBootstrapped: Bool = false`
- `isShowingNewProjectSheet: Bool = false`
- `newProjectConfiguration: NewProjectConfiguration = NewProjectConfiguration(name: "Project 1")`
- `lastSavedAt: Date?`
- `importErrorMessage: String?`

**Selection (timeline)**
- `selectedClipID: String?`
- `selectedClipIDs: Set<String> = []`
- `selectedTextClipID: String?` (resets `isEditingSubtitleTrack` to false on nil)
- `selectedTextClipIDs: Set<String> = []`
- `selectedGraphicsClipID: String?`
- `selectedGraphicsClipIDs: Set<String> = []`
- `selectedKeyframeID: String?`
- `selectedTransitionID: String?`
- `isEditingSubtitleTrack: Bool = false`

**Media import**
- `isMediaPickerPresented: Bool = false`
- `isImportingMedia: Bool = false`
- `mediaImportStatusText: String = "Importing media"`

**Templates**
- `templateLibrary: [OpenReelProject.TemplatePackage] = []`
- `selectedTemplatePackageID: String?`

**Timeline view**
- `timelineZoom: Double = 48`   (pixels per second)

**Undo / clipboard**
- `undoRedoToken: Int = 0`
- `copiedEffectStack: [OpenReelProject.Effect] = []`

**Local operations**
- `localOperationStatusText: String?`
- Feature-specific running/progress state exists only for active on-device work.

**Non-observed dependencies** (`@ObservationIgnored`)
- `projectStore: ProjectStore`
- `mediaImportService: MediaImportService`
- `history = ActionHistory()` (limit 50)
- `minimumClipDuration: TimeInterval = 0.2`
- `subtitleManagedMetadataKey = "subtitleManaged"`
- `subtitleCueIDMetadataKey = "subtitleCueID"`
- `subtitleSourceMetadataValue = "timeline-subtitle"`

### 5.3 Computed views

- `currentProject: OpenReelProject?` — returns the project with `selectedProjectID` (or first).
- `currentProjectDuration: TimeInterval`
- `totalProjectStorageUsage: Int64`
- `canUndo: Bool`, `canRedo: Bool` (touches `undoRedoToken` to participate in observation)
- `hasCopiedEffectStack: Bool`
- `selectedTemplatePackage: TemplatePackage?`
- `canSaveCurrentTemplatePackage: Bool`
- `selectedClip: Clip?`, `selectedMediaItem: MediaItem?`
- `selectedTextClip: TextClip?`, `selectedGraphicsClip: GraphicsClip?`
- `selectedKeyframe: Keyframe?`, `selectedTransition: Transition?`
- `selectedTrack: Track?`
- `canDetachSelectedClipAudio: Bool`
- `playbackReloadToken: String` (composite ID for forcing playback reload)
- `hasMultiSelection: Bool`

### 5.4 Public API — method signatures (purpose in line-comments)

Methods take an optional `PlaybackController?` so they can resync playback after each mutation. All mutating methods end up calling `replaceCurrentProject(with:captureHistory:)`, which persists to disk and (optionally) pushes a snapshot to `ActionHistory`.

#### Project lifecycle
```swift
func bootstrap() async                                     // loads projects + templates
func showHome()
func showProjects()
func openProject(_ project: OpenReelProject)
func closeEditor()
func presentNewProjectSheet()
func dismissNewProjectSheet()
func createProject() async                                  // from newProjectConfiguration
func quickCreateProject(preset: NewProjectConfiguration.Preset,
                        frameRate: Double, name: String) async
func refreshProjectStorageUsage() async
func projectStorageUsage(for project: OpenReelProject) -> Int64
func deleteProject(_ project: OpenReelProject) async
```

#### Media library
```swift
func presentMediaPicker()
func dismissMediaPicker()
func importMedia(_ assets: [ImportedMediaAsset],
                 playbackController: PlaybackController) async
func importMediaToLibrary(_ assets: [ImportedMediaAsset]) async -> [MediaItem]
func usedProjectMediaIDs(in project: OpenReelProject? = nil) -> Set<String>
func availableProjectMedia(in project: OpenReelProject? = nil) -> [MediaItem]
func mediaItem(for mediaID: String, in project: OpenReelProject? = nil) -> MediaItem?
func mediaURL(for mediaItem: MediaItem, in project: OpenReelProject? = nil) -> URL?
func projectDirectoryURL(for project: OpenReelProject? = nil) -> URL?
func thumbnailURL(for relativePath: String?, in project: OpenReelProject? = nil) -> URL?
```

#### Selection
```swift
func selectClip(_ clip: Clip)
func selectTextClip(_ textClip: TextClip)
func selectAllClipsOnTrack(_ trackID: String)
func applyEffectToSelectedClips(_ effect: Effect,
                                playbackController: PlaybackController?) async
func applyStyleToSelectedTextClips(_ style: TextStyle,
                                   playbackController: PlaybackController?) async
func clearMultiSelection()
func selectSubtitleTrackForEditing(_ textClip: TextClip)
func selectGraphicsClip(_ graphicsClip: GraphicsClip)
func selectKeyframe(_ keyframeID: String)
func selectTransition(_ transitionID: String)
```

#### Keyframes
```swift
func addSelectedKeyframe(property: String, value: JSONValue?, easing: String,
                         playbackController: PlaybackController?) async
func updateSelectedKeyframe(time: Double?, value: JSONValue?, easing: String?,
                            playbackController: PlaybackController?) async
func removeSelectedKeyframe(playbackController: PlaybackController? = nil) async
```

#### Transitions
```swift
func addTransition(clipID: String? = nil, type: String, duration: TimeInterval,
                   params: [String: JSONValue] = [:],
                   playbackController: PlaybackController? = nil) async
func updateSelectedTransition(type: String? = nil, duration: TimeInterval? = nil,
                              params: [String: JSONValue]? = nil,
                              playbackController: PlaybackController? = nil) async
func removeSelectedTransition(playbackController: PlaybackController? = nil) async
```

#### Clips (media)
```swift
func splitSelectedClip(at playheadTime: TimeInterval,
                       playbackController: PlaybackController? = nil) async
func detachSelectedClipAudio(playbackController: PlaybackController? = nil) async
func deleteSelectedClip(ripple: Bool = false,
                        playbackController: PlaybackController? = nil) async
func trimClip(_ clipID: String, edge: TrimEdge, by delta: TimeInterval,
              playbackController: PlaybackController? = nil) async
func moveClip(_ clipID: String, by delta: TimeInterval,
              playbackController: PlaybackController? = nil) async
func addMediaItemToTimeline(_ mediaItem: MediaItem,
                            at startTime: TimeInterval? = nil,
                            playbackController: PlaybackController? = nil) async
func updateSelectedClipSpeed(_ speed: Double, playbackController: PlaybackController? = nil) async
func updateSelectedImageClipDuration(_ duration: TimeInterval, playbackController: PlaybackController? = nil) async
func updateSelectedClipTransform(...) async
func updateSelectedClipCrop(...) async
func resetSelectedClipCrop(playbackController: PlaybackController? = nil) async
func resetSelectedClipTransform(playbackController: PlaybackController? = nil) async
func updateClipBlendMode(clipID: String, blendMode: BlendMode,
                         playbackController: PlaybackController? = nil) async
func updateClipBlendOpacity(clipID: String, opacity: Double,
                            playbackController: PlaybackController? = nil) async
```

#### Tracks
```swift
func addVideoTrack() async
func addAudioTrack() async
func addTextTrack() async
func addGraphicsTrack() async
func deleteTrack(_ trackID: String, playbackController: PlaybackController? = nil) async
func moveTrack(_ trackID: String, direction: TrackMoveDirection,
               playbackController: PlaybackController? = nil) async
func updateTrackAudioMix(trackID: String, role: AudioTrackRole?, gain: Double?, pan: Double?,
                        playbackController: PlaybackController? = nil) async
```

#### Text clips
```swift
func addTextClip(from preset: TextPreset, at startTime: TimeInterval? = nil,
                 playbackController: PlaybackController? = nil) async
func updateSelectedTextClipText(_ text: String,
                                playbackController: PlaybackController? = nil) async
func updateSelectedTextClipStyle(...) async                  // font, color, alignment, etc.
func updateSelectedTextClipTransform(...) async
func updateSelectedTextClipDuration(_ duration: TimeInterval,
                                    playbackController: PlaybackController? = nil) async
func updateSelectedTextClipAnimation(_ animation: TextAnimation?,
                                     playbackController: PlaybackController? = nil) async
func moveTextClip(_ id: String, by delta: TimeInterval,
                  playbackController: PlaybackController? = nil) async
func trimTextClip(_ id: String, edge: TrimEdge, by delta: TimeInterval,
                  playbackController: PlaybackController? = nil) async
func deleteSelectedTextClip(playbackController: PlaybackController? = nil) async
```

#### Audio
```swift
func updateSelectedClipVolume(_ volume: Double, playbackController: PlaybackController? = nil) async
func updateSelectedClipPan(_ pan: Double, playbackController: PlaybackController? = nil) async
func updateSelectedClipFade(edge: AudioFadeEdge, duration: TimeInterval,
                            curve: AudioAutomationCurve = .linear,
                            bezierControlPoints: AudioBezierControlPoints? = nil,
                            playbackController: PlaybackController? = nil) async
```

#### Effects (clip-level)
```swift
func upsertSelectedClipEffect(type: String, params: [String: JSONValue],
                              playbackController: PlaybackController? = nil) async
func upsertSelectedClipAudioEffect(type: String, params: [String: JSONValue],
                                   playbackController: PlaybackController? = nil) async
func appendSelectedClipEffect(type: String, params: [String: JSONValue],
                              playbackController: PlaybackController? = nil) async
func updateSelectedClipEffect(id effectID: String, params: [String: JSONValue]? = nil,
                              enabled: Bool? = nil,
                              playbackController: PlaybackController? = nil) async
func updateSelectedClipAudioEffect(id effectID: String, ...) async
func toggleSelectedClipEffect(id: String, isEnabled: Bool,
                              playbackController: PlaybackController? = nil) async
func toggleSelectedClipAudioEffect(id: String, isEnabled: Bool, ...) async
func removeSelectedClipEffect(id: String, playbackController: PlaybackController? = nil) async
func removeSelectedClipAudioEffect(id: String, ...) async
func removeSelectedClipEffect(type: String, ...) async      // remove all of type
func removeSelectedClipAudioEffect(type: String, ...) async
func reorderSelectedClipEffect(id: String, to: Int, ...) async
func resetSelectedClipEffects(types: Set<String>, ...) async
func copySelectedClipEffectStack() -> [Effect]
func copySelectedClipEffectsToClipboard()
func pasteEffectStack(_ effects: [Effect], replaceExisting: Bool,
                      playbackController: PlaybackController? = nil) async
func pasteCopiedEffectStack(replaceExisting: Bool = false,
                            playbackController: PlaybackController? = nil) async
func applySelectedClipEffectStack(...) async
func importSelectedClipLUT(sourceURL: URL, name: String,
                           playbackController: PlaybackController? = nil) async
func mergeSelectedClipEffect(...) async                      // for stack-merge UI
```

#### Graphics
```swift
func addGraphicsClip(from preset: ShapePreset, at startTime: TimeInterval? = nil,
                    playbackController: PlaybackController? = nil) async
func addStickerClip(from preset: StickerPreset, at startTime: TimeInterval? = nil,
                    playbackController: PlaybackController? = nil) async
func addGraphicsImageClip(mediaItem: MediaItem, at startTime: TimeInterval? = nil,
                          duration: TimeInterval? = nil,
                          playbackController: PlaybackController? = nil) async
func updateSelectedGraphicsClipTransform(...) async
func moveGraphicsClip(_ id: String, by delta: TimeInterval,
                      playbackController: PlaybackController? = nil) async
func trimGraphicsClip(_ id: String, edge: TrimEdge, by delta: TimeInterval,
                      playbackController: PlaybackController? = nil) async
func deleteSelectedGraphicsClip(playbackController: PlaybackController? = nil) async
func updateGraphicsClipFill(clipID: String, fillType: FillKind, color: String?,
                            playbackController: PlaybackController? = nil) async
func updateGraphicsClipStroke(clipID: String, width: Double?, color: String?,
                              playbackController: PlaybackController? = nil) async
func updateGraphicsClipBlendMode(clipID: String, blendMode: BlendMode,
                                 playbackController: PlaybackController? = nil) async
func updateGraphicsClipOpacity(clipID: String, opacity: Double,
                               playbackController: PlaybackController? = nil) async
func updateGraphicsClipEmphasis(clipID: String, type: EmphasisAnimationType,
                                playbackController: PlaybackController? = nil) async
```

#### Subtitles
```swift
func importSubtitles(from url: URL, animationStyle: CaptionAnimationStyle,
                     position: SubtitlePosition,
                     playbackController: PlaybackController? = nil) async
func subtitleTextClips(in project: OpenReelProject? = nil) -> [TextClip]
func subtitleTrackStyle(in project: OpenReelProject? = nil) -> SubtitleStyle?
func ensureSubtitleTextClips(playbackController: PlaybackController? = nil) async
func clearSubtitles(playbackController: PlaybackController? = nil) async
func updateSubtitleAnimationStyle(_ style: CaptionAnimationStyle, ...) async
func updateSubtitlePosition(_ position: SubtitlePosition, ...) async
func updateSubtitleTrackStyle(...) async
func updateSubtitleCueText(id: String, text: String, ...) async
```

#### Templates
```swift
func refreshTemplateLibrary() async
func saveCurrentProjectAsTemplatePackage(name: String, description: String,
                                         category: TemplateCategory,
                                         tags: [String]) async
func importTemplatePackage(from sourceURL: URL) async -> TemplatePackage?
func exportTemplatePackage(id: String) async -> URL?
func deleteTemplatePackage(id: String) async
func applyTemplatePackage(_ template: TemplatePackage, controlValues: [String: JSONValue],
                          playbackController: PlaybackController? = nil) async
```

#### On-device smart tools
```swift
func generateOnDeviceCaptions(playbackController: PlaybackController?) async
func generateShorts(...) async
```

Segmentation, tracking, background effects, captions, and highlight analysis
operate on project-local media. There is no generic remote-job method or
result-manifest ingestion path.

#### Undo / Redo / Export
```swift
func undo(playbackController: PlaybackController) async
func redo(playbackController: PlaybackController) async
func advanceAspectRatio()
func updateExportPreferences(preset: ExportPreset? = nil,
                             resolution: ExportResolution? = nil,
                             frameRate: Double? = nil,
                             format: ExportFormat? = nil,
                             quality: Double? = nil) async
func applyExportConfigurationToProject(_ preferences: ExportPreferences,
                                       playbackController: PlaybackController? = nil) async
func applyExportPresetToProject(_ preset: ExportPreset,
                                playbackController: PlaybackController? = nil) async
```

#### Style / Playback helpers
```swift
func style(for project: OpenReelProject) -> ProjectStyle
func primaryVisualClip(in project: OpenReelProject? = nil) -> Clip?
func selectedVisualClip(in project: OpenReelProject? = nil) -> Clip?
func clips(for trackType: TrackType, in project: OpenReelProject? = nil) -> [Clip]
func syncPlayback(with playbackController: PlaybackController)
func timelinePlaybackTransitions(in project: OpenReelProject? = nil) -> [PlaybackController.TimelineTransition]
func timelinePlaybackSources(in project: OpenReelProject? = nil) -> [PlaybackController.TimelineSource]
func dismissError()
func snapToGridTime(_ time: TimeInterval, in project: OpenReelProject) -> (time: TimeInterval, didSnap: Bool)
```

### 5.5 Mutation pipeline

Every method ultimately:

1. Reads `currentProject` (returns early if nil).
2. Locates the affected item (clip / track / transition) via `clipLocation(...)`.
3. Builds a mutated `OpenReelProject` value.
4. Updates `modifiedAt = Int(Date().timeIntervalSince1970 * 1000)`.
5. Calls `replaceCurrentProject(with:captureHistory:)` which:
   - pushes prior project to `ActionHistory.undoStack`,
   - writes the new `project.json` atomically via `ProjectStore.save`,
   - sets `lastSavedAt = .now`,
   - bumps `undoRedoToken`.
6. Calls `playbackController?.applyTimelineEdit(...)` to live-rebuild the playback graph.

---

## 6. Transition system

### 6.1 Catalog

`TransitionCatalog.supportedTypes` (string identifiers):

```
crossfade, dipToBlack, dipToWhite, wipe, slide, zoom, push,
blurDissolve, iris, spin, glitch, pixelate, lumaFade
```

`directions = ["left", "right", "up", "down"]`.

`displayName(for:params:)` maps each type to a UI label (e.g. `wipe` + direction → `"Wipe Left"`). `crossfade` displays as `"Dissolve"`.

### 6.2 Default params per type

| Type           | Default `params`                                                                                  |
|----------------|---------------------------------------------------------------------------------------------------|
| crossfade      | `{ curve: "smoothstep" }`                                                                         |
| dipToBlack     | `{ holdDuration: 0.1, curve: "smoothstep" }`                                                      |
| dipToWhite     | `{ holdDuration: 0.1, curve: "smoothstep" }`                                                      |
| wipe           | `{ direction: "left", softness: 0, curve: "smoothstep" }`                                         |
| slide          | `{ direction: "left", pushOut: false, curve: "easeOutCubic" }`                                    |
| zoom           | `{ scale: 2, center: { x: 0.5, y: 0.5 }, curve: "easeInOutCubic" }`                               |
| push           | `{ direction: "left", curve: "easeOutCubic" }`                                                    |
| blurDissolve   | `{ maxRadius: 20, curve: "smoothstep" }`                                                          |
| iris           | `{ center: { x: 0.5, y: 0.5 }, softness: 0.02, curve: "easeInOutCubic" }`                         |
| spin           | `{ rotations: 1, curve: "easeInOutCubic" }`                                                       |
| glitch         | `{ intensity: 0.5, slices: 8, curve: "linear" }`                                                  |
| pixelate       | `{ maxBlockSize: 40, curve: "easeInOutCubic" }`                                                   |
| lumaFade       | `{ invert: false, softness: 0.3, curve: "smoothstep" }`                                           |

### 6.3 Param sanitization (`sanitizedParams`)

- Unknown direction → `"left"`.
- `softness` clamped to `[0, 1]`.
- `holdDuration` clamped to `[0, 1]`.
- `scale` clamped to `[1.01, 6]`.
- `maxRadius` clamped to `[1, 100]`.
- `rotations` clamped to `[0.25, 4]`.
- `intensity` clamped to `[0.1, 1]`.
- `slices` clamped to `[2, 20]`.
- `maxBlockSize` clamped to `[4, 100]`.
- `curve` is rewritten via `EasingFunctions.sanitizedEasing(_:)`.

### 6.4 Validation (`TimelineTransitionEngine`)

```swift
static let minimumDuration: TimeInterval = 0.1
static let maximumDuration: TimeInterval = 5
static let adjacencyTolerance: TimeInterval = 0.001
```

`validate(clipA:clipB:duration:)`:

1. Both clips must share `trackId`.
2. They must be adjacent: `abs((clipA.startTime + clipA.duration) - clipB.startTime) <= 0.001`.
3. `duration` is clamped to `[minimumDuration, min(maximumDuration, max(min(clipA.duration, clipB.duration) * 0.5, minimumDuration))]`.

`transition(clipA:clipB:type:duration:params:id:)` constructs an `OpenReelProject.Transition` with sanitized type/params, or returns nil if validation fails.

`sanitizedTransitions(for: track)` rebuilds the entire transition list filtering invalid pairs and de-duping by `clipA|clipB`. Sorted by `clipA.startTime`, then by `transition.id`.

### 6.5 Runtime resolution

`TimelineTransitionResolver.activeVisualTransition(in: project, at: time)` walks all visible video/image tracks (respecting `solo` and `hidden`), finds the active transition window at `time`, and returns:

```swift
struct ActiveTimelineTransition: Equatable {
    var transition: OpenReelProject.Transition
    var outgoingClip: OpenReelProject.Clip
    var incomingClip: OpenReelProject.Clip
    var startTime: TimeInterval       // boundary − duration/2
    var endTime: TimeInterval         // boundary + duration/2
    var progress: Double              // (time − startTime) / duration, clamped [0,1]
    var boundaryTime: TimeInterval    // outgoingClip.startTime + outgoingClip.duration
}
```

The transition window is **centered on the clip boundary** — half the duration sits on each clip. Ordering is `startTime` ascending, then `transition.id` ascending as a stable tiebreak.

---

## 7. JSON examples

### 7.1 Project document (envelope)

```json
{
  "version": "1.1.0",
  "project": {
    "id": "B5C7C5A1-1F8B-4B6A-A4F0-2A4D6C1F0E22",
    "name": "Project 1",
    "createdAt": 1716100000000,
    "modifiedAt": 1716100012345,
    "settings": {
      "width": 1920,
      "height": 1080,
      "frameRate": 30,
      "sampleRate": 48000,
      "channels": 2
    },
    "exportPreferences": {
      "preset": "youtube",
      "resolution": { "width": 1920, "height": 1080 },
      "frameRate": 30,
      "format": { "container": "mp4", "codec": "hevc" },
      "quality": 0.85
    },
    "mediaLibrary": {
      "items": [
        {
          "id": "f4f0aabc-...",
          "name": "IMG_5532.mov",
          "type": "video",
          "metadata": {
            "duration": 12.3,
            "width": 1920,
            "height": 1080,
            "frameRate": 29.97,
            "codec": "hevc",
            "sampleRate": 48000,
            "channels": 2,
            "fileSize": 11_234_567,
            "audioTrackCount": 1
          },
          "thumbnailUrl": "thumbnails/f4f0aabc.jpg",
          "localFileName": "IMG_5532.mov"
        }
      ]
    },
    "timeline": {
      "tracks": [
        {
          "id": "track-video-1",
          "type": "video",
          "name": "Video 1",
          "clips": [/* see 7.2 */],
          "transitions": [
            {
              "id": "t-1",
              "clipAId": "clip-1",
              "clipBId": "clip-2",
              "type": "crossfade",
              "duration": 0.5,
              "params": { "curve": "smoothstep" }
            }
          ],
          "locked": false,
          "hidden": false,
          "muted": false,
          "solo": false,
          "audioMix": { "role": "general", "gain": 1, "pan": 0 }
        }
      ],
      "subtitles": [],
      "duration": 0,
      "markers": [],
      "beatMarkers": [],
      "beatAnalyses": []
    },
    "textClips": [/* see 7.3 */],
    "graphicsClips": []
  }
}
```

### 7.2 Sample clip

```json
{
  "id": "clip-1",
  "mediaId": "f4f0aabc-...",
  "trackId": "track-video-1",
  "startTime": 0,
  "duration": 5.0,
  "inPoint": 0,
  "outPoint": 5.0,
  "effects": [
    { "id": "fx-1", "type": "brightness", "params": { "amount": { "$type": "number", "value": 0.2 } }, "enabled": true }
  ],
  "audioEffects": [],
  "transform": {
    "position": { "x": 0.5, "y": 0.5 },
    "scale":    { "x": 1.0, "y": 1.0 },
    "rotation": 0,
    "anchor":   { "x": 0.5, "y": 0.5 },
    "opacity": 1.0,
    "fitMode": "cover"
  },
  "volume": 1,
  "keyframes": [],
  "audioConfiguration": {
    "pan": 0,
    "volumeAutomation": []
  }
}
```

(Note: `Effect.params` and `Keyframe.value` are `JSONValue`-encoded — `JSONValue` encodes as native JSON, not tagged, so a `number(0.2)` value serialises simply as `0.2`. The `$type` wrapper above is illustrative only.)

### 7.3 Sample text clip

```json
{
  "id": "text-1",
  "trackId": "track-text-1",
  "startTime": 1.0,
  "duration": 3.0,
  "text": "Hello, world",
  "style": {
    "fontFamily": "SF Pro Display",
    "fontSize": 96,
    "fontWeight": 700,
    "fontStyle": "normal",
    "color": "#FFFFFF",
    "backgroundColor": null,
    "strokeColor": "#000000",
    "strokeWidth": 2,
    "shadowColor": "#000000",
    "shadowBlur": 6,
    "shadowOffsetX": 0,
    "shadowOffsetY": 4,
    "textAlign": "center",
    "verticalAlign": "middle",
    "lineHeight": 1.1,
    "letterSpacing": 0
  },
  "transform": {
    "position": { "x": 0.5, "y": 0.8 },
    "scale":    { "x": 1, "y": 1 },
    "rotation": 0,
    "anchor":   { "x": 0.5, "y": 0.5 },
    "opacity": 1
  },
  "animation": {
    "preset": "slide-up",
    "params": {},
    "inDuration": 0.3,
    "outDuration": 0.3,
    "stagger": 0.04,
    "unit": "word"
  },
  "keyframes": []
}
```

`fontWeight` may also be `"bold"`, `"regular"`, etc. (the `TextFontWeight` enum is single-value Codable, accepts both `Int` and `String`).

---

## 8. Android mapping suggestions

### 8.1 Project document

- Mirror the entire schema as `@Serializable` Kotlin `data class`es (kotlinx.serialization).  Use the same JSON wire format and `version = "1.1.0"`.
- `JSONValue` → `kotlinx.serialization.json.JsonElement` (`JsonPrimitive`, `JsonObject`, `JsonArray`, `JsonNull`) — a 1:1 fit.
- Make all `?: emptyList()` / nullable fields explicit with `@Serializable` defaults so old documents continue to decode (matches the iOS `decodeIfPresent` pattern). Example:

```kotlin
@Serializable
data class OpenReelProjectFile(
    val version: String = "1.1.0",
    val project: OpenReelProject,
)

@Serializable
data class Track(
    val id: String,
    val type: TrackType,
    val name: String,
    val clips: List<Clip> = emptyList(),
    val transitions: List<Transition> = emptyList(),
    val locked: Boolean = false,
    val hidden: Boolean = false,
    val muted: Boolean = false,
    val solo: Boolean = false,
    val audioMix: AudioTrackMix = AudioTrackMix(),
)
```

- Use the same `Json { prettyPrint = true; encodeDefaults = true; ignoreUnknownKeys = true }` configuration.

### 8.2 Persistence

- Replace `Application Support` with `Context.filesDir/OpenReel/Projects/<projectID>/`. Same `project.json` + `media/` + `thumbnails/` + `effects/luts/` + local render-cache layout.
- File writes: write to a temp file, then `Files.move(..., ATOMIC_MOVE)` — that mirrors iOS `.atomic`.
- Filename safety: replicate `sanitizeFileName` (trim, replace `/` and `:` with `-`, fallback to `UUID.randomUUID()`).
- LUT integrity: SHA-256 via `MessageDigest.getInstance("SHA-256")` → hex string, matches `LUTAsset.checksum`.
- **Do not use Room for project documents.** The model is a single JSON blob that the editor mutates in-memory; a relational schema would force normalization that the editor doesn't want. Use DataStore (Proto or Preferences) only for app-wide settings such as theme and last-opened project ID.
- If you want a list view backed by a DB, mirror only the metadata (`id`, `name`, `createdAt`, `modifiedAt`, storage bytes, thumbnail path) in Room and keep `project.json` as the source of truth on disk.

### 8.3 State management

- `AppState` → a single `EditorViewModel` (or top-level `OpenReelStateHolder`) holding `MutableStateFlow<EditorUiState>`.
- Field-level reactivity (à la `@Observable`) is best achieved by splitting state into multiple `StateFlow`s grouped by feature area (selection, project, media import, local operations, UI), and composing via `combine { ... }` for screens that need cross-cuts.
- Methods become `suspend fun`s. Replace the `playbackController:` trailing argument with a single injected `PlaybackController` (ExoPlayer wrapper) so callers don't pass it.
- Funnel every mutator through one helper:

```kotlin
private suspend fun replaceCurrentProject(
    new: OpenReelProject,
    captureHistory: Boolean,
) {
    if (captureHistory) currentProject.value?.let { actionHistory.capture(it) }
    _currentProject.value = new
    runCatching { projectStore.save(new) }
        .onSuccess { _lastSavedAt.value = Clock.System.now() }
        .onFailure { _importError.value = it.message }
    undoRedoToken.value += 1
}
```

### 8.4 Undo/redo

- `ActionHistory` is trivially portable — an `ArrayDeque<OpenReelProject>` with `limit = 50` on each stack. Because Kotlin `data class` has structural copies, snapshots are cheap and identity-correct.

### 8.5 Parcelize / Serialization

- All data classes that may cross a process boundary (e.g. shared via `SavedStateHandle` with the system process) should be `@Parcelize` *in addition to* `@Serializable`. In practice only top-level identifiers (`projectId: String`, `clipId: String`) need to traverse `Bundle`s; the full project tree should live in a single in-memory state holder.

### 8.6 Mapping table

| iOS                              | Kotlin / Android                                            |
|----------------------------------|-------------------------------------------------------------|
| `@Observable` / `@MainActor`     | `ViewModel` + `StateFlow`/`MutableStateFlow` on `Main`      |
| `Codable`                        | `kotlinx.serialization @Serializable`                       |
| `JSONValue`                      | `JsonElement`                                               |
| `actor ProjectStore`             | `class ProjectStore` running on `Dispatchers.IO`            |
| `Application Support` URL        | `context.filesDir`                                          |
| `JSONEncoder(.prettyPrinted, .sortedKeys)` | `Json { prettyPrint = true; useArrayPolymorphism = false }` plus a custom sorted-key serializer if exact byte-equality across platforms is required |
| `try data.write(to: url, .atomic)` | write to `.tmp` then `Files.move(..., StandardCopyOption.ATOMIC_MOVE)` |
| `SHA256.hash(data:)`             | `MessageDigest.getInstance("SHA-256")`                      |
| `UUID().uuidString`              | `java.util.UUID.randomUUID().toString()`                    |
| `Date().timeIntervalSince1970 * 1000` (Int ms) | `System.currentTimeMillis()` (Long)              |
| Swift value-type `copy on write` | Kotlin `data class .copy(...)`                              |
| `ActionHistory` (in-memory stack)| `class ActionHistory` with `ArrayDeque`, limit 50           |
| `ImportedMediaAsset` (sandbox URL + metadata) | Android `Uri` + `MediaMetadataRetriever` results |
| `PHAsset.localIdentifier`        | `MediaStore` `content://media/external/.../id` URI string   |

### 8.7 Things to *not* port

- iOS-only `PHAsset.localAssetIdentifier` should still round-trip in `MediaItem.localAssetIdentifier`; Android can leave it null and use its local `originalUrl`. Keep the field for schema compatibility.
- `symbolName: String?` on `GraphicAsset` references SF Symbols. Android needs a parallel `iconName: String?` mapped to Material Symbols, but **keep `symbolName` in the schema** so projects are round-trippable.
- `proResProfile` is irrelevant on Android (no ProRes encoder). Decode it but ignore — never set it on save unless the project came from iOS.

---

## Appendix A — JSON field naming conventions

- Numeric times are seconds (`Double`) **except** `createdAt`, `modifiedAt`, `appliedAt`, `analyzedAt`, `SourceFile.lastModified` which are **milliseconds since 1970** (`Int` / `Int64`).
- Hex colors are `"#RRGGBB"` or `"#RRGGBBAA"` strings; some defaults (e.g. subtitle background) use `rgba(...)` CSS notation. Both must round-trip.
- Normalized coordinates (anchor, position, gradient `offset`, `softness`, etc.) live in `[0, 1]` unless otherwise documented.
- Enum raw values are `camelCase` for simple words, `"kebab-case"` for compound words (e.g. `"hard-light"`, `"word-highlight"`, `"rubber-band"`, `"focus-zoom"`). Match these strings exactly in the Kotlin enums via `@SerialName`.
