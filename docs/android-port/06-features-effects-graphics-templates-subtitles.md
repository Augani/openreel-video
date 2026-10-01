# Effects, Graphics, Templates & Subtitles — Android Port Spec

Source of truth: `Openreel Video/Features/Effects/*`, `…/Graphics/*`, `…/Templates/*`, `…/Subtitles/*`.

All panels share the same chrome: an `EditorPanelContainer` with title, subtitle, leading symbol, and an optional `onBack`. The body is a vertical `ScrollView` of `EditorMenuRow` items (icon + title + subtitle + chevron). Tapping a row opens a half-height bottom sheet (`presentationDetents([.fraction(0.5)])`, drag indicator, `.ultraThinMaterial` background). Each sheet reuses `EditorPanelContainer` for its own header. Color tokens: `OpenReelTheme.surface` / `surfaceElevated` for backgrounds, `OpenReelTheme.accent` for selection, `OpenReelTheme.destructive` for danger, `OpenReelTheme.textPrimary` / `textSecondary` for typography. Tap haptics use `UIImpactFeedbackGenerator(.light)`.

Android equivalent: a `Scaffold` with a top app bar, a `LazyColumn` of list rows, and a `ModalBottomSheet` at half-screen height (`SheetState` with `partiallyExpanded`) backed by `Surface(tonalElevation = 3.dp)`. Haptics via `HapticFeedbackConstants.CONTEXT_CLICK`.

---

## 1. EFFECTS PANEL (`EffectsTabPanel.swift`)

Title: "Effects". Subtitle: "Video effects, tools, and stack order". Header symbol: `wand.and.stars`.

### 1.1 Empty state

When `appState.selectedClip` is nil OR the selected media type is not video/image, the body renders `emptySelection`:
- Icon `cursorarrow.click.badge.clock` (size 30, semibold, accent color)
- Text: "Select a visual clip to apply looks."
- Vertical padding 32, surface background, corner radius 14.

### 1.2 Top-level row list (when a visual clip is selected)

Each row is an `EditorMenuRow(title, subtitle, symbol)` that opens an `EffectsPanelSheet` via `activeSheet`:

| Row | Symbol | Subtitle | Sheet enum |
|---|---|---|---|
| Selected Effect | `slider.horizontal.3` | dynamic — name of selected stack effect, or "Choose an applied effect to tune its parameters" | `.selectedEffect` (disabled if no selection) |
| Effect Stack | `square.stack.3d.down.right` | "{n} effects and tools applied" | `.stack` |
| Presets | `camera.filters` | "Cinematic looks and reusable grades" | `.presets` |
| Core Controls | `slider.horizontal.3` | "Brightness, saturation, blur, sharpen, grain, and more" | `.coreControls` |
| Color Wheels | `circle.lefthalf.filled` | "Lift, gamma, gain, and offset balance" | `.colorWheels` |
| HSL | `paintpalette` | "Tune hue, saturation, and luminance per color range" | `.hsl` |
| Curves | `waveform.path.ecg` | "Shape luminance and color channels precisely" | `.curves` |
| LUT | `square.3.layers.3d` | "Import a .cube look" (none) / "Manage the applied LUT" | `.lut` |
| Creative Effects | `sparkles` | "Add animated looks and texture treatments" | `.creativeEffects` |
| Video Tools | `scope` | "On-device Vision, Metal, and Core Image tools" | `.videoTools` |
| Scopes | `waveform.path` | "Awaiting frame" / "Waveform and vectorscope" | `.scopes` |
| Reset All | `trash` (destructive tint) | "Remove every effect and tool from the selected clip" | inline action — calls `appState.resetSelectedClipEffects(types: Set(VideoEffectType.allCases))` |

### 1.3 Effect Stack sheet

Toolbar row (horizontal): **Copy** (`doc.on.doc`, bordered accent), **Paste** (`doc.on.clipboard`, disabled until `appState.hasCopiedEffectStack`), **Add** (`plus.circle`, menu listing every `addableEffects` entry — i.e. all `VideoEffectType` cases except `.filterPreset` and `.colorAdjust`), and **Reset All** (right-aligned, destructive text button).

List body:
- Header: "Effect Stack" + "{count} total".
- Empty: "Add effects to build an ordered grade stack for this clip."
- Each effect: row with symbol, name, enabled toggle, drag/reorder, remove. (See `effectRow` not pasted but inferred — provides up/down/remove.)
- Selected-effect tail card: "Selected: {name}" with one universal **Intensity** slider (0…1, default 1) that writes `params["intensity"]`.

Container: padding 14, `OpenReelTheme.surface`, corner radius 14.

### 1.4 Presets sheet

Layout:
1. Horizontal category picker — chips for every `FilterPresetCategory` (`Cinematic`, `Vintage`, `Mood`, `Color`, `Stylized`). Selected chip = filled accent background + black text; unselected = surface background + secondary text.
2. 2-column `LazyVGrid` (spacing 10) of `PresetGridCard`s filtered by selected category. Each card shows symbol, name (`preset.name`), description (`preset.description`), accent color (`Color(hexString: preset.tintHex)`), selected ring when `activePresetName == preset.name`.

Tap → `applyPreset(preset)` (light haptic). Implementation expands `preset.effectStack` (brightness/contrast/saturation/temperature only emitted if they differ from neutral, plus `finishingEffects` per preset id). Each emitted `OpenReelProject.Effect` carries `params["presetID"]` and `params["presetName"]` for round-tripping.

**Full FilterPresetCatalog enumeration** (id, name, category, description, symbol, tintHex, brightness, saturation, contrast, temperature, plus per-id finishing effects):

| id | name | category | description | symbol | tintHex | bright | sat | contr | temp | extra finishing effects |
|---|---|---|---|---|---|---|---|---|---|---|
| cinematic-teal-orange | Teal & Orange | Cinematic | Hollywood contrast | film | #38BDF8 | 0 | 1.10 | 1.15 | -0.08 | vignette amount 0.25, midpoint 0.5, roundness 0.5, feather 0.8 |
| cinematic-noir | Film Noir | Cinematic | Black and punchy | circle.lefthalf.filled | #E5E7EB | -0.05 | 0 | 1.40 | 0 | vignette amount 0.4 mid 0.4 round 0.5 feather 0.6; grain amount 0.15 size 1.5 rough 0.5 colored false |
| cinematic-blockbuster | Blockbuster | Cinematic | Bold studio look | sparkles.tv | #F97316 | 0.05 | 1.15 | 1.20 | 0.05 | sharpen amount 0.3 radius 1 threshold 10 |
| vintage-70s | 70s Retro | Vintage | Warm faded stock | camera | #F59E0B | 0.05 | 0.85 | 0.90 | 0.20 | grain amount 0.2 size 2 rough 0.6 colored true |
| vintage-polaroid | Polaroid | Vintage | Instant photo lift | photo | #FBBF24 | 0.04 | 0.90 | 1.10 | 0.08 | vignette amount 0.3 mid 0.5 round 0.3 feather 0.85 |
| vintage-vhs | VHS | Vintage | Tape-era color | videocam | #A78BFA | -0.02 | 0.80 | 1.15 | -0.04 | blur radius 0.5 type gaussian; grain amount 0.25 size 2.5 rough 0.7 colored true |
| vintage-sepia | Sepia | Vintage | Classic warm tone | sun.dust | #D97706 | 0.10 | 0.30 | 1.05 | 0.28 | — |
| mood-dreamy | Dreamy | Mood | Soft atmosphere | cloud | #F9A8D4 | 0.10 | 0.85 | 0.90 | 0.04 | blur radius 1 type gaussian |
| mood-moody | Moody | Mood | Dark and dense | moon | #64748B | -0.15 | 0.75 | 1.25 | -0.06 | vignette amount 0.35 mid 0.4 round 0.5 feather 0.7 |
| mood-golden-hour | Golden Hour | Mood | Sunset warmth | sun.max | #FBBF24 | 0.10 | 1.20 | 1.05 | 0.24 | — |
| mood-cold | Cold Blue | Mood | Icy balance | snowflake | #67E8F9 | 0.05 | 0.90 | 1.10 | -0.24 | — |
| color-vibrant | Vibrant | Color | Saturated color | paintpalette | #4ADE80 | 0.05 | 1.40 | 1.15 | 0 | — |
| color-muted | Muted | Color | Soft palette | drop | #93C5FD | 0.05 | 0.60 | 0.95 | 0.02 | — |
| color-bw-classic | B&W Classic | Color | Timeless mono | circle.righthalf.filled | #F8FAFC | 0 | 0 | 1.10 | 0 | — |
| color-bw-high-contrast | B&W High | Color | Dramatic mono | circle.lefthalf.filled | #CBD5E1 | -0.05 | 0 | 1.50 | 0 | — |
| stylized-cyberpunk | Cyberpunk | Stylized | Neon contrast | bolt | #C084FC | 0 | 1.30 | 1.30 | -0.12 | vignette amount 0.3 mid 0.45 round 0.5 feather 0.75; chromaticAberration amount 2.5 |
| stylized-comic | Comic Book | Stylized | Graphic punch | burst | #FDE047 | 0.02 | 1.40 | 1.50 | 0.02 | sharpen amount 0.5 radius 1.5 threshold 5 |
| stylized-soft-glow | Soft Glow | Stylized | Gentle bright wash | sparkles | #FDA4AF | 0.15 | 0.90 | 0.85 | 0.08 | — |
| cinematic-documentary | Documentary | Cinematic | Balanced factual tone | camera.aperture | #D1D5DB | 0.03 | 0.92 | 1.08 | -0.01 | — |
| stylized-prism | Prism | Stylized | Split-channel edge glow | triangle.lefthalf.filled | #7DD3FC | 0.04 | 1.18 | 1.12 | -0.03 | chromaticAberration amount 4 |

`presetEffectTypes` (the set of effect types treated as "preset territory" when round-tripping/clearing): `brightness, contrast, saturation, temperature, blur, sharpen, vignette, grain, chromaticAberration, filterPreset, colorAdjust`.

### 1.5 Core Controls sheet

`CompactSliderRow` list inside a surface card:

| Label | Effect type written | Param key | Range | Default | Format |
|---|---|---|---|---|---|
| Brightness | brightness | value | -0.5…0.5 | 0 | signedPercent |
| Contrast | contrast | value | 0.5…2 | 1 | "%.2f" |
| Saturation | saturation | value | 0…2 | 1 | signedPercent |
| Temperature | temperature | value | -1…1 | 0 | signedPercent |
| Hue | hue | rotation | -180…180 | 0 | "%.0f°" |
| Blur | blur | radius | 0…8 | 0.5 | "%.1f" |
| Sharpen | sharpen | amount | 0…1.5 | 0.3 | "%.2f" |
| Vignette | vignette | amount | 0…1 | 0.25 | signedPercent |
| Grain | grain | amount | 0…0.6 | 0.15 | signedPercent |
| Prism | chromaticAberration | amount | 0…8 | 0 | "%.1f" |

Slider edits call `upsertEffectValue` / `upsertEffectParams` which `mergeSelectedClipEffect` and replay through `playbackController`.

### 1.6 Color Wheels sheet

Header "Color Wheels" + "Reset" button (restores `VideoEffectType.colorWheels.defaultParams`). For each `WheelTone` (`.lift`, `.gamma`, `.gain`, `.offset`):
- Section title (`tone.title`)
- `ColorWheelPad` — circular pad letting the user drag an RGB offset. Reads `tone.key` param as `{red, green, blue}` JSON object, writes back via `EffectParameterCodec.colorObject(red, green, blue)`.
- `CompactSliderRow` for the tone's scalar amount (`tone.amountTitle`, key `tone.amountKey`, range `tone.amountRange`, default `tone.defaultAmount`, format `tone.format`).

The four wheels map 1:1 to ASC CDL primary/log/gain/offset on Android — use a custom Canvas with a hue/sat wheel and a separate brightness slider per tone.

### 1.7 HSL sheet

Header "HSL" + Reset. Horizontal channel picker for 8 `HSLChannel` cases (Red, Orange, Yellow, Green, Cyan/Aqua, Blue, Purple, Magenta — `selectedHSLChannel.index` 0…7). Selected chip background = `channel.color`.

Three sliders editing arrays of 8 values stored in `params["hue" | "saturation" | "luminance"]`:

| Slider | Range | Format |
|---|---|---|
| Hue | -180…180 | "%.0f°" |
| Saturation | -1…1 | signedPercent |
| Lightness | -1…1 | signedPercent |

Writes update the array at `selectedHSLChannel.index` and resave via `updateHSLArray`.

### 1.8 Curves sheet

Header "Curves" + Reset (replaces the selected channel array with `EffectParameterCodec.defaultCurvePoints`). Channel picker for `CurveChannel` cases (`rgb`, `red`, `green`, `blue`, `luma` — each with its own color). Body is `CurveEditor`: 256-step spline editor that reads `EffectParameterCodec.curvePoints(from:, key:)` and writes `EffectParameterCodec.curveArray(nextPoints)`. Editor is touch-draggable with anchor points.

### 1.9 LUT sheet

If no LUT effect on the clip → CTA "Import a .cube file to apply a show LUT and blend it per clip." + "Import .cube" button (right-aligned, accent). Opens a `fileImporter` for `.cube` UTType. On success calls `appState.importSelectedClipLUT(sourceURL:)`.

If a LUT is applied → shows:
- Reference name (`reference.name`)
- "{size}x{size}x{size} cube" (e.g. 33x33x33)
- Intensity slider 0…1, default `reference.intensity`, writes `params["intensity"]`.
- "Replace" button (re-opens importer) and **Remove LUT** destructive button.

### 1.10 Creative Effects sheet

Horizontal scroll of `effectChoiceCard` (132×184) for each type in `creativeEffects`:
`[disintegrate, dissolve, bloom, motionBlur, pixelate, chromaticAberration, grain, vignette, blur, sharpen]`.

Card UI: symbol tile, title, subtitle, "Add" / "Added" label. Tap calls `applyEffectChoice` — if effect already exists, just selects it; otherwise upserts with default params.

Subtitles per effect (for both cards and Inspector copy):
- disintegrate — "Particle-style breakup"
- dissolve — "Fade the clip layer"
- bloom — "Soft glow highlights"
- motionBlur — "Directional streak blur"
- pixelate — "Blocky digital texture"
- chromaticAberration — "RGB edge split"
- grain — "Film texture"
- vignette — "Darkened edges"
- blur — "Soft focus"
- sharpen — "Crisp detail"

### 1.11 Video Tools sheet

Same horizontal-scroll card layout for `videoTools`:
`[backgroundRemoval, subjectBlur, subjectGlow, faceBeauty, motionTrack, faceTrack, objectTrack, bodyPose, autoReframe, stabilize]`.

Subtitles:
- stabilize — "Subject-aware smoothing"
- backgroundRemoval — "Vision subject cutout"
- subjectBlur — "Blur tracked subject masks"
- subjectGlow — "Glow tracked subject masks"
- faceBeauty — "Smooth and brighten faces"
- motionTrack — "Tracking setup for clip attachments"
- faceTrack — "Face anchor detection"
- objectTrack — "Object anchor detection"
- bodyPose — "Body pose analysis"
- autoReframe — "Subject-aware crop path"

### 1.12 Selected-effect parameter controls

Resolved by `parameterControls(for:)`. For each `VideoEffectType` the editor renders a stack of `CompactSliderRow`s with these defaults:

| VideoEffectType | Slider label | Param key | Default | Range | Format |
|---|---|---|---|---|---|
| disintegrate | Amount | amount | 0.35 | 0…1 | signedPercent |
| dissolve | Fade | amount | 0.25 | 0…1 | signedPercent |
| bloom | Glow | amount | 0.65 | 0…2 | "%.2f" |
| bloom | Radius | radius | 12 | 0…60 | "%.0f" |
| motionBlur | Blur | radius | 8 | 0…60 | "%.0f" |
| motionBlur | Angle | angle | 0 | -180…180 | "%.0f°" |
| pixelate | Block | scale | 18 | 1…80 | "%.0f" |
| chromaticAberration | Split | amount | 3 | 0…20 | "%.1f" |
| grain | Amount | amount | 0.15 | 0…0.6 | signedPercent |
| vignette | Amount | amount | 0.25 | 0…1 | signedPercent |
| blur | Radius | radius | 0.5 | 0…8 | "%.1f" |
| sharpen | Amount | amount | 0.3 | 0…1.5 | "%.2f" |
| stabilize | Strength | strength | 0.5 | 0…1 | signedPercent |
| stabilize | Crop | crop | 0.06 | 0…0.18 | signedPercent |
| motionTrack | Confidence | confidence | 0.7 | 0…1 | signedPercent |
| motionTrack | Smooth | smoothing | 0.35 | 0…1 | signedPercent |
| backgroundRemoval | Strength | strength | 1 | 0…1 | signedPercent |
| backgroundRemoval | Blur | blurRadius | 24 | 0…80 | "%.0f" |
| backgroundRemoval | Feather | feather | 4 | 0…32 | "%.0f" |
| backgroundRemoval | Edge | edgeExpansion | 0 | -12…12 | "%.0f" |
| subjectBlur | Radius | radius | 16 | 0…80 | "%.0f" |
| subjectBlur | Feather | feather | 4 | 0…32 | "%.0f" |
| subjectGlow | Glow | amount | 0.65 | 0…2 | "%.2f" |
| subjectGlow | Radius | radius | 18 | 0…80 | "%.0f" |
| subjectGlow | Feather | feather | 6 | 0…32 | "%.0f" |
| faceBeauty | Smooth | smoothing | 0.35 | 0…1 | signedPercent |
| faceBeauty | Bright | brighten | 0.08 | 0…1 | signedPercent |
| faceBeauty | Warmth | warmth | 0.04 | -1…1 | signedPercent |
| faceBeauty | Detail | sharpen | 0.18 | 0…1 | signedPercent |
| faceBeauty | Feather | feather | 14 | 0…48 | "%.0f" |
| faceTrack | Confidence/Smooth | confidence/smoothing | 0.6 / 0.35 | 0…1 | signedPercent |
| objectTrack | Confidence/Smooth | confidence/smoothing | 0.65 / 0.35 | 0…1 | signedPercent |
| bodyPose | Confidence/Smooth | confidence/smoothing | 0.55 / 0.4 | 0…1 | signedPercent |
| autoReframe | Padding | padding | 0.12 | 0…0.4 | signedPercent |
| autoReframe | Smooth | smoothing | 0.5 | 0…1 | signedPercent |
| autoReframe | Confidence | confidence | 0.65 | 0…1 | signedPercent |

### 1.13 Scopes sheet

Two `ScopePlotCard`s rendered from `ColorScopesSnapshot`:
- **Waveform** — `colorScopes.waveform` points, accent color, grid on.
- **Vectorscope** — `colorScopes.vectorscope` points, blue accent (`Color(red: 0.38, green: 0.76, blue: 1)`), grid off.

Header shows "Live" if data available, "Awaiting frame" otherwise. Android: use a custom `Canvas` plotting normalized 0…1 points from RenderEffect output (or shader-sampled histograms).

### 1.14 On-device tool execution

Video Tools are local effect-stack entries. iOS builds masks and tracking frame
context with Vision and renders with Core Image/Metal. Android uses ML Kit
tracking and its local effects pipeline. Track Subject, Auto Reframe, and
Stabilize create editor keyframes from local detections. There is no separate
analysis sheet, job identifier, progress polling, or cancel endpoint.

### 1.15 Blend Mode panel (`BlendModePanel.swift`)

Used from the Text/Graphics inspector when surfacing a clip's blend properties. Layout: header "Blend Mode" + current label, **Opacity** slider 0…1 default 1 (writes `clip.blendOpacity`), then a 3-column `LazyVGrid` of blend mode buttons. Selected = `accent.opacity(0.2)` fill + 2px accent border; unselected = `surfaceElevated` + 1px white-6%.

**Full blend-mode list** (mode enum value, label, description). The iOS engine routes each through Core Image (`CIBlendMode*`) or shader equivalents — math given for Android Compose `BlendMode` / PorterDuff parity:

| OpenReelProject.BlendMode | Label | Description | iOS CIBlendMode | Android Compose `BlendMode` | Math (S=source, D=dest) |
|---|---|---|---|---|---|
| normal | Normal | Default layer stacking | (alpha-over default) | `BlendMode.SrcOver` | S over D |
| multiply | Multiply | Darkens by multiplying colors | `CIMultiplyBlendMode` | `BlendMode.Multiply` | S × D |
| screen | Screen | Lightens by inverting and multiplying | `CIScreenBlendMode` | `BlendMode.Screen` | 1 − (1−S)(1−D) |
| overlay | Overlay | Combines multiply and screen | `CIOverlayBlendMode` | `BlendMode.Overlay` | D<0.5 ? 2SD : 1−2(1−S)(1−D) |
| darken | Darken | Keeps darker pixels | `CIDarkenBlendMode` | `BlendMode.Darken` | min(S,D) |
| lighten | Lighten | Keeps lighter pixels | `CILightenBlendMode` | `BlendMode.Lighten` | max(S,D) |
| colorDodge | Color Dodge | Brightens highlights | `CIColorDodgeBlendMode` | `BlendMode.ColorDodge` | D / (1−S) |
| colorBurn | Color Burn | Deepens shadows | `CIColorBurnBlendMode` | `BlendMode.ColorBurn` | 1 − (1−D)/S |
| hardLight | Hard Light | Intense overlay | `CIHardLightBlendMode` | `BlendMode.Hardlight` | S<0.5 ? 2SD : 1−2(1−S)(1−D) |
| softLight | Soft Light | Gentle dodge/burn | `CISoftLightBlendMode` | `BlendMode.Softlight` | Photoshop soft-light formula |
| difference | Difference | Inverts where layers overlap | `CIDifferenceBlendMode` | `BlendMode.Difference` | |S − D| |
| exclusion | Exclusion | Softer difference | `CIExclusionBlendMode` | `BlendMode.Exclusion` | S + D − 2SD |
| hue | Hue | Applies hue only | `CIHueBlendMode` | `BlendMode.Hue` | HSL: H_S, S_D, L_D |
| saturation | Saturation | Applies saturation only | `CISaturationBlendMode` | `BlendMode.Saturation` | HSL: H_D, S_S, L_D |
| color | Color | Applies hue + saturation | `CIColorBlendMode` | `BlendMode.Color` | HSL: H_S, S_S, L_D |
| luminosity | Luminosity | Applies brightness only | `CILuminosityBlendMode` | `BlendMode.Luminosity` | HSL: H_D, S_D, L_S |

`darken`/`lighten` are not surfaced in the Graphics panel's reduced list (see 2.4) but are valid for any `BlendModePanel` usage.

---

## 2. GRAPHICS PANEL (`GraphicsTabPanel.swift`)

Title: "Graphics". Subtitle: "Shapes, stickers, and overlays". Header symbol: `square.on.circle`.

### 2.1 Top-level rows

Always-visible:
- **Shapes** (`square.on.circle`) — "Place a new shape at the playhead" → sheet `.shapes`.
- **Stickers** (`face.smiling`) — "Add an emoji or sticker overlay" → sheet `.stickers`.

If `appState.selectedGraphicsClip == nil`: a centered `helperCard` precedes the menu: icon `sparkles.square.filled.on.square`, title "No graphic selected", message "Choose a graphic on the timeline to edit fill, stroke, blend, size, opacity, and animation."

If a graphics clip is selected: the helper card is replaced by the `graphicsMenu`:

| Row | Symbol | Subtitle | Sheet | Notes |
|---|---|---|---|---|
| Fill (only if `clip.type == .shape` and style != nil) | `paintpalette.fill` | "No fill applied" or "Choose a fill color" | `.fill` | |
| Stroke (same gating) | `pencil.line` | "Width {clip.style.stroke.width %.1f}" | `.stroke` | |
| Blend Mode | `square.on.square` | `(clip.blendMode ?? .normal).rawValue.capitalized` | `.blend` | |
| Size | `arrow.up.left.and.arrow.down.right` | "%.2fx" of avg(scale.x, scale.y) | `.size` | |
| Opacity | `circle.lefthalf.filled` | "{int(blendOpacity*100)}%" | `.opacity` | |
| Animation | `sparkles` | `clip.emphasisAnimation?.type.rawValue.capitalized ?? "None"` | `.animation` | |
| Delete Graphic | `trash` (destructive) | "Remove the selected graphic from the timeline" | inline | `appState.deleteSelectedGraphicsClip` |

### 2.2 Shapes sheet (`ShapePresetCatalog.shapes`)

2-column `LazyVGrid` (spacing 10). Each card (118×170) renders the SF Symbol then the name. Tap = light haptic + `appState.addGraphicsClip(from: preset, at: playbackController.currentTime)`.

**Color swatch palette** used everywhere: `["#4ADE80", "#FFFFFF", "#FDE047", "#38BDF8", "#F472B6", "#FB7185", "#A855F7", "#111827"]`.

**Full ShapePresetCatalog.shapes enumeration**:

| id | name | subtitle | symbol | shapeType | duration | style | transform |
|---|---|---|---|---|---|---|---|
| rectangle-solid | Rectangle | Solid filled rectangle | `rectangle.fill` | rectangle | 4 s | solid #4ADE80, cornerRadius 8 | centered, scale 0.40×0.25 |
| circle-solid | Circle | Solid filled circle | `circle.fill` | circle | 4 s | solid #38BDF8 | centered, scale 0.30×0.30 |
| ellipse-outline | Ellipse | Stroked ellipse outline | `oval` | ellipse | 4 s | stroke #4ADE80 width 3, no fill, line round-cap/round-join | centered, scale 0.45×0.28 |
| triangle-solid | Triangle | Equilateral triangle | `triangle.fill` | triangle | 4 s | solid #FDE047 | centered, scale 0.30×0.30 |
| arrow-right | Arrow | Directional arrow pointer | `arrowshape.right.fill` | arrow | 3 s | solid #4ADE80 | centered, scale 0.35×0.20 |
| line-horizontal | Line | Horizontal divider line | `minus` | line | 4 s | stroke #FFFFFF width 3 round caps | centered, scale 0.60×0.01 |
| polygon-hexagon | Polygon | Six-sided polygon | `hexagon.fill` | polygon | 4 s | fill #A855F7, points=6 | centered, scale 0.30×0.30 |
| star-five | Star | Five-pointed star | `star.fill` | star | 4 s | fill #FDE047, shadow rgba(253,224,71,0.4) blur 6 offset (0,2), points=5, innerRadius 0.4 | centered, scale 0.30×0.30 |

Default `Transform`: `position (0.5, 0.5)`, `anchor (0.5, 0.5)`, `rotation 0`, `opacity 1`, `fitMode .contain`, no `borderRadius` / `crop`.

### 2.3 Stickers sheet (`ShapePresetCatalog.stickers`)

Same grid format but the card renders the `emoji` glyph at size 28 instead of an SF Symbol. Tap = `appState.addStickerClip(from: preset, at: currentTime)`.

`cornerTransform(x:y:)` template: scale `0.15×0.15` at the given normalized corner, with default anchor/rotation/opacity as above.

| id | name | emoji | category | duration | position (x,y) | emphasis |
|---|---|---|---|---|---|---|
| fire | Fire | 🔥 | Reactions | 3 s | (0.82, 0.18) | bounce |
| heart | Heart | ❤️ | Reactions | 3 s | (0.82, 0.18) | pulse |
| star-eyes | Star Eyes | 🤩 | Reactions | 3 s | (0.82, 0.18) | bounce |
| thumbs-up | Thumbs Up | 👍 | Reactions | 3 s | (0.82, 0.18) | bounce |
| lightning | Lightning | ⚡ | Effects | 2 s | (0.50, 0.30) | flash |
| sparkles | Sparkles | ✨ | Effects | 3 s | (0.50, 0.30) | pulse |
| party | Party | 🎉 | Celebrations | 3 s | (0.50, 0.30) | bounce |
| rocket | Rocket | 🚀 | Actions | 3 s | (0.50, 0.30) | float |
| check | Checkmark | ✅ | Status | 3 s | (0.82, 0.18) | bounce |
| arrow-down | Arrow Down | ⬇️ | Arrows | 3 s | (0.50, 0.72) | bounce |
| question | Question | ❓ | Status | 3 s | (0.82, 0.18) | shake |
| eyes | Eyes | 👀 | Reactions | 3 s | (0.50, 0.30) | shake |

Emphasis animation prototypes used above:
- bounce — `(speed 1.2, intensity 0.6, loop true)`
- pulse — `(speed 1.0, intensity 0.5, loop true)`
- float — `(speed 0.8, intensity 0.4, loop true)`
- flash — `(speed 1.5, intensity 0.8, loop false)`
- shake — `(speed 1.5, intensity 0.4, loop false)`

All emphasis animations have `focusPoint = zoomScale = holdDuration = startTime = animationDuration = nil`.

### 2.4 Fill sheet

Inside a `sheetContainer("Fill", "Choose the graphic fill", "paintpalette.fill")`: section header "Fill", then a horizontal `ScrollView` of swatch buttons. The first swatch is `SwatchButton(hex: "none")` (writes `fillType: .none, color: nil`); the rest iterate `ShapePresetCatalog.colorSwatches` (writes `.solid` with the hex). Selected state when `style.fill.color == hex && style.fill.type == .solid`.

### 2.5 Stroke sheet

Section header "Stroke" + `CompactSliderRow("Width", style.stroke.width, range 0…10, format "%.1f")` writing `appState.updateGraphicsClipStroke(clipID:, width:, color: nil)`. Below: horizontal swatch row (same palette) — selecting one sets color and bumps width to `max(style.stroke.width, 2)`.

### 2.6 Blend Mode sheet (Graphics)

Same `sheetContainer` pattern. Body: horizontal pill row (`Capsule()` background, 10×7 padding). The Graphics blend list is a reduced 9-option subset:
`[Normal, Multiply, Screen, Overlay, Soft Light, Difference, Exclusion, Dodge (= colorDodge), Burn (= colorBurn)]`.

Selection writes via `appState.updateGraphicsClipBlendMode(clipID:, blendMode:)`.

### 2.7 Size sheet

`CompactSliderRow(label: "Size", value: uniformScale, range 0.02…2, format "%.2fx")`. Uniform scale = `(scale.x + scale.y) / 2`. Updating writes `Point(x: newScale, y: newScale)` to the clip transform — i.e. graphics scale isotropically here even though the model supports separate axes.

### 2.8 Opacity sheet

`CompactSliderRow(label: "Opacity", value: blendOpacity ?? 1, range 0…1)` → `updateGraphicsClipOpacity`.

### 2.9 Animation sheet

Horizontal pill row of `EmphasisAnimationType` options, written via `updateGraphicsClipEmphasis`. Full list (label = type capitalized):
`[None, Pulse, Bounce, Float, Shake, Spin, Flash, Glow, Breathe]`. Selection swaps `clip.emphasisAnimation.type` only — speed/intensity/loop are not exposed in this sheet (use the catalog defaults or text-clip equivalents).

### 2.10 Android mapping (Graphics)

- Build shapes with `Canvas` / `androidx.compose.foundation.Canvas`. `rectangle` → `drawRoundRect`; `circle/ellipse` → `drawOval`; `triangle/arrow/polygon/star` → custom `Path` (compute regular polygon vertices from `points`, star uses alternating outer/`innerRadius`).
- Stickers → emoji rendered as `Text(emoji, fontSize = size)`.
- Blend modes → use `Modifier.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }` plus `drawWithContent { drawContent(blendMode = …) }`, mapping via the table in §1.15.
- Emphasis animations → `Modifier.graphicsLayer` driven by `rememberInfiniteTransition` or `Animatable` (pulse/breathe = scale 1↔1+intensity; bounce = vertical translation; spin = rotation; flash = alpha; shake = horizontal translation; glow = drop-shadow alpha).

---

## 3. TEMPLATES PANEL (`TemplatesTabPanel.swift` + `BuiltInTemplateCatalog.swift` + `TemplatePreviewView.swift`)

A template is `OpenReelProject.TemplatePackage` — a reusable bundle of:
- `payload.duration` (seconds)
- `payload.textClips: [TextClip]`
- `payload.graphicsClips: [GraphicsClip]`
- `payload.effects: [Effect]`
- `controls: [TemplateControlDefinition]` (typed user-editable parameters, e.g. title text / size)
- `defaultValues: [String: JSONValue]`
- `supportedTargets: [.video | .image]`
- `category: TemplateCategory` (`cinema, glitch, social, retro, branding, color, overlay`)
- `tags: [String]`
- `createdAt`, `modifiedAt` (epoch ms)

Applying a template injects its `textClips` and `graphicsClips` at the current playhead and (if present) appends its `effects` onto the selected visual clip's stack.

### 3.1 Top-level rows

| Row | Symbol | Subtitle behavior | Enabled when | Action |
|---|---|---|---|---|
| Save Current | `square.and.arrow.down` | `captureCountLabel` (e.g. "2 text · 1 graphics · 3 effects") or "Add overlays or select a styled clip" | `appState.canSaveCurrentTemplatePackage` | Opens "Save Template" alert with `TextField` (default `"{projectName} Template"`) + Cancel/Save. Save → `appState.saveCurrentProjectAsTemplatePackage(name:)`. |
| Import | `square.and.arrow.down.on.square` | "Bring in .openreeltemplate packs" | always | `fileImporter` for UTType `openreeltemplate` (or `data` fallback). On success → `appState.importTemplatePackage(from: url)`. |
| Apply | `sparkles.rectangle.stack` | selected template name or "Choose a template below" | `canApplySelectedTemplate` | `applySelectedTemplate()` |
| Export | `square.and.arrow.up` | selected template name or "Select a template to share" | template selected | exports via `appState.exportTemplatePackage(id:)` and presents iOS `ShareSheet` |
| Current Capture | `tray.full` | `captureCountLabel` | always | sheet `.capture` |
| Selected Template | `square.stack.3d.up` | `selectedTemplatePackage.name` or "Choose a template from the library" | template selected | sheet `.selectedTemplate` |
| Template Library | `books.vertical` | "Browse {n} reusable templates" | always | sheet `.library` |

`captureCountLabel` is built from non-zero counts joined by " · " — text count, graphics count, selected-clip effect count. If everything is zero: "Nothing selected".

`canApply(template)` returns true when there is a current project AND (template has any text/graphics OR there is a selected clip to host its effects).

### 3.2 Current Capture sheet

Surface card with title + `captureCountLabel` aligned right (accent monospaced). Description text:
- if `selectedClipEffectCount > 0` and a media item is selected: "Saving now will capture every text and graphics overlay in this project plus the effect stack from {name}."
- else: "Saving now captures every text and graphics overlay in this project. Select a visual clip first if you also want to include its effects."

Horizontal stat chips: `Text {n}`, `Graphics {n}`, `Effects {n}`, plus the selected media name (secondary tint).

### 3.3 Library sheet

Header "Template Library" + count. Empty state: icon `square.stack.3d.up.slash`, "Save a project look or import a package to build your reusable template library."

When populated: 2-column `LazyVGrid` (spacing 10) of `templateCard`s — accent-tinted symbol tile, checkmark when selected, name, multi-line subtitle (`{counts} · {targetLabel}`). Tap = select. Context menu items: **Apply** (disabled per `canApply`), **Share**, **Delete** (destructive).

`symbol(for: template)` chooses the tile icon by priority: graphics → `square.stack.3d.up`; else text → `textformat`; else effects → `wand.and.stars`; else `square.stack.3d.up`.

`targetLabel(for:)` joins `supportedTargets.rawValue` with " + " or returns "Any target".

### 3.4 Selected Template sheet

Header (large symbol tile + name + description ("Custom template package" fallback)), `TemplatePreviewView` (16:9, 140pt high — see §3.6), then horizontal stat chips and a button row:
- **Apply at Playhead** (`sparkles.rectangle.stack`, borderedProminent accent, disabled if `!canApplySelectedTemplate`).
- **Share** (`square.and.arrow.up`, bordered accent).
- Right-aligned **Delete** (destructive bordered).

### 3.5 Built-in template catalog (`BuiltInTemplateCatalog.packages`)

Eight curated packages. All `createdAt` and `modifiedAt` are set at load time to `Int(Date().timeIntervalSince1970 * 1000)`. Shared text-style template (`makeStyle`): font/size/weight/color/optional background; `shadow=true` adds shadowColor `rgba(0,0,0,0.6)`, blur 12, offset (0,4); `lineHeight 1.2`, `verticalAlign .middle`, `fontStyle "normal"`. Shared transform (`makeTransform`): position `(x, y)` (x default 0.5), scale (default 1×1), anchor `(0.5,0.5)`, rotation 0, opacity 1, fitMode `.contain`. Shared animation (`makeAnimation`): unit `.character`, configurable preset/params/inDuration/outDuration/stagger.

#### 3.5.1 Cinema Opener (`builtin-cinema-opener`)

- category `.cinema`, tags `["title","cinematic","dramatic"]`, supports `[.video]`
- controls: `title-text` (text, default "YOUR TITLE"); `title-size` (number, default 72, min 32, max 120, step 2)
- defaultValues: `{title-text: "YOUR TITLE", title-size: 72}`
- payload duration 5 s
- text clip `cinema-title`: text "YOUR TITLE", start 0.5, dur 4, SF Pro Display 72 heavy white, center, shadow, letterSpacing 8, position y=0.48; animation `.fade {fadeOpacity: {start:0,end:1}}`, in 0.8 / out 0.6 / stagger 0.04.
- effects: `vignette {intensity 0.55, radius 0.7}`.

#### 3.5.2 Glitch Title (`builtin-glitch-title`)

- category `.glitch`, tags `["glitch","digital","modern"]`, supports `[.video, .image]`, no controls.
- duration 4 s.
- text clip `glitch-title`: text "GLITCH", start 0.2, dur 3.5, Menlo 64 bold color #4ADE80, center, shadow, letterSpacing 4, stroke #00E676 width 1, position y=0.45; animation `.glitch {glitchIntensity: 0.7}`, in 0.3 / out 0.2 / stagger 0.01.
- effects: `chromaticAberration {intensity 0.4, offset 3}`.

#### 3.5.3 Social Callout (`builtin-social-callout`)

- category `.social`, tags `["social","callout","bubble"]`, supports `[.video, .image]`, no controls.
- duration 4 s.
- text clip `social-callout-text`: text "Follow for more!", start 0.3, dur 3.4, SF Pro Display 36 bold color #111827 on background #4ADE80, center, no shadow, position y=0.72; animation `.pop {popOvershoot: 1.3}`, in 0.4 / out 0.3 / stagger 0.02.
- graphics clip `social-arrow`: shape `.arrow` solid #4ADE80, transform (0.5, 0.82, scale 0.3×0.3), bounce emphasis (speed 1.5, intensity 0.6, loop true), start 0.5, dur 3.

#### 3.5.4 Retro VHS (`builtin-retro-vhs`)

- category `.retro`, tags `["retro","vhs","90s","vintage"]`, supports `[.video]`, no controls.
- duration 6 s.
- text clip `vhs-date`: "REC ● 06.18.1994", start 0, dur 6, Menlo 22 regular white, left aligned, letterSpacing 2, position (0.18, 0.88), blendOpacity 0.85, no animation.
- effects: `filmGrain {intensity 0.6, size 1.2}`, `scanLines {opacity 0.25, count 120}`, `colorAdjust {saturation 0.7, temperature -15}`.

#### 3.5.5 Brand Lower Third (`builtin-branding-lower-third`)

- category `.branding`, tags `["branding","lower-third","professional"]`, supports `[.video]`
- controls: `name` (text, "Jane Smith"), `role` (text, "Creative Director")
- defaultValues `{name: "Jane Smith", role: "Creative Director"}`
- duration 5 s.
- text clip `brand-name`: "Jane Smith", start 0.3, dur 4.2, SF Pro Display 38 bold white, left, shadow, letterSpacing 1, position (0.28, 0.78); animation `.slideRight {slideDistance: 0.15}`, in 0.45 / out 0.3 / stagger 0.03.
- text clip `brand-role`: "Creative Director", start 0.6, dur 3.9, SF Pro Display 22 medium #4ADE80, left, no shadow, letterSpacing 2, position (0.28, 0.84); animation `.slideRight {slideDistance: 0.15}`, in 0.5 / out 0.25 / stagger 0.02.
- graphics clip `brand-accent-bar`: shape `.rectangle` fill #4ADE80 cornerRadius 4, transform (0.14, 0.81, scale 0.04×0.12), no emphasis, start 0.2, dur 4.5.

#### 3.5.6 Color Wash (`builtin-color-wash`)

- category `.color`, tags `["color","overlay","warm"]`, supports `[.video, .image]`
- controls: `warmth` (number, default 20, min -50, max 50, step 5)
- duration 0 (effect-only — applied directly to the host clip).
- effects: `colorAdjust {temperature 20, saturation 1.15, contrast 1.05}`, `filmGrain {intensity 0.2, size 0.8}`.

#### 3.5.7 Minimal Caption (`builtin-minimal-caption`)

- category `.social`, tags `["caption","minimal","clean"]`, supports `[.video, .image]`, no controls.
- duration 5 s.
- text clip `minimal-text`: "Your caption here", start 0, dur 5, SF Pro Display 28 semibold white on background `rgba(0,0,0,0.65)`, center, no shadow, position y=0.85; animation `.fade {}`, in 0.3 / out 0.3 / stagger 0.

#### 3.5.8 Dynamic Zoom (`builtin-dynamic-zoom`)

- category `.overlay`, tags `["zoom","dynamic","attention"]`, supports `[.video]`, no controls.
- duration 3 s.
- text clip `zoom-text`: "LOOK HERE", start 0.3, dur 2.4, SF Pro Display 48 heavy white, center, shadow, letterSpacing 3, stroke #4ADE80 width 2, position y=0.5; animation `.pop {popOvershoot: 1.4}`, in 0.25 / out 0.2 / stagger 0.01.
- graphics clip `zoom-circle`: shape `.circle`, fill none, stroke #4ADE80 width 4 round caps, shadow rgba(74,222,128,0.5) blur 8, transform (0.5, 0.5, scale 0.6×0.6), blendOpacity 0.7, pulse emphasis (speed 2, intensity 0.4, loop true), start 0.1, dur 2.6.

### 3.6 TemplatePreviewView

Static-with-subtle-loop preview used inside the Selected Template sheet. Background black, corner radius 10, hairline overlay. An `animationPhase` (0 → 1, eased, repeating, auto-reverse, 2 s) drives opacity 0.6 → 1.0 and a small scale 1.0 → 1.03 (1.06 for emphasis-animated graphics).

Rendering rules:
- Graphics are drawn first (z-order: graphics under text).
- Emoji stickers → `Text(emoji)` sized to `min(boxW, boxH) * 0.7`.
- Shape preview: `circle/ellipse` → `Ellipse().fill(...).overlay(strokeBorder)`; `triangle` → custom `Triangle` shape; `star` → `Image(systemName: "star.fill").resizable()`; `arrow` → `Image(systemName: "arrowshape.right.fill")`; default → `RoundedRectangle(cornerRadius: style.cornerRadius ?? 4)`.
- Fill color: solid → `Color(hexString:)`; else fallback `OpenReelTheme.accent`. Stroke uses `style.stroke.color` / `width`.
- Text preview: `Text(textClip.text)` at `min(style.fontSize * 0.4, height * 0.3)`, weight via `fontWeight()` mapping (named weights and numeric ranges 800/700/600/500 → heavy/bold/semibold/medium, else regular), padded 6×3, with a `backgroundForText` that maps `rgba(...)` to `Color.black.opacity(0.5)` and hex strings via `Color(hexString:)`.
- If a template has only effects (no text, no graphics): renders the `effectsOnlyPreview` — `wand.and.stars` icon + "{n} effect[s]" caption.

### 3.7 Android mapping (Templates)

- Persist as the same JSON shape (`TemplatePackage`) inside Room or a JSON file; expose `.openreeltemplate` MIME so Storage Access Framework can import/export.
- Preview screen → custom `Composable` driven by `rememberInfiniteTransition`, mirroring the iOS logic 1:1 (z-order graphics under text).
- Apply flow → service that copies `payload.textClips`/`graphicsClips` into the project at `playhead` (offset their `startTime` by the playhead time) and appends `payload.effects` onto the host clip stack.

---

## 4. SUBTITLES PANEL (`SubtitlesTabPanel.swift` + `SRTParser.swift`)

Title: "Subtitles". Subtitle: "Import captions and set animation style". Header symbol: `captions.bubble`.

### 4.1 Row list

| Row | Symbol | Subtitle | Enabled | Action |
|---|---|---|---|---|
| Import SRT / VTT | doc.text | Bring captions into the project or current cue count | always | opens the local file importer |
| Auto Captions (Offline), iOS | waveform.badge.mic | Uses the installed on-device speech model, or explains that none is installed | local model available, visual clip selected, not already running | runs OnDeviceCaptionService on the local clip |
| Edit Transcript | text.word.spacing | Edit text to cut video, remove filler and silences | subtitles exist | opens the local transcript editor |
| Add Captions to Timeline / Edit Caption Track | text.badge.plus / captions.bubble.fill | Creates or opens timeline text clips | subtitles exist | materializes cues and opens the Text tab |
| Track Style | paintpalette | Animation and position for all captions | subtitles exist | opens style sheet |
| Caption Presets | wand.and.stars | One-tap styled looks | subtitles exist | opens presets sheet |
| Subtitle Cues | text.quote | Reviews current cues | subtitles exist | opens cue list |
| Clear All | trash | Removes every cue | subtitles exist | calls clearSubtitles |

Android ships SRT/VTT import and full local subtitle editing. Automatic Android
transcription stays hidden until a speech model is bundled and validated.

### 4.2 Track Style sheet

Two sections:

**Caption Style** — horizontal scroll of 6 chips (72×56, icon + label, accent-tinted when selected with 2px accent border):

| `CaptionAnimationStyle` | Label | Symbol |
|---|---|---|
| .none | None | `text.alignleft` |
| .wordHighlight | Highlight | `highlighter` |
| .wordByWord | Word Pop | `text.word.spacing` |
| .karaoke | Karaoke | `music.mic` |
| .bounce | Bounce | `arrow.up.and.down` |
| .typewriter | Typewriter | `keyboard` |

Selecting writes immediately via `appState.updateSubtitleAnimationStyle(option.style)` (if cues exist).

**Position** — 3-up `HStack` of full-width buttons for `OpenReelProject.SubtitlePosition.allCases` (`top`, `middle`, `bottom`). Label = `.rawValue.capitalized`. Selected = `accent.opacity(0.18)` background. Writes via `appState.updateSubtitlePosition(position)`.

On first appearance (`task(id: subtitleSettingsSignature)`), `selectedAnimationStyle` and `selectedPosition` are seeded from the first subtitle (`animationStyle ?? .none`, `style?.position ?? .bottom`).

### 4.3 Subtitle Cues sheet

`VStack` listing the first 20 cues. Each row is a button (seeks playback to the cue):
- Left: start timestamp formatted `%02d:%02d:%02d` where the third group is `frames = (fractional * 30)` — i.e. MM:SS:FF at 30fps.
- Center: `subtitle.text` (max 2 lines).
- Right: duration "%.1fs".
- Padding 12×10, surface background, corner radius 10.

If more than 20 cues exist: trailing "+ {n - 20} more" centered label.

### 4.4 SRT / VTT parsing (`SRTParser.swift`)

`SRTParser.parse(content)` (SRT):
1. Normalize `\r\n` → `\n`, split by blank lines (`\n\n`).
2. Each block must have ≥ 3 lines; line 1 = integer index, line 2 = "HH:MM:SS,mmm --> HH:MM:SS,mmm" (commas accepted), lines 3+ = text.
3. Text is joined with `\n`, trimmed, and HTML-like tags `<[^>]+>` stripped via regex.
4. Empty-text blocks are skipped.
5. Returns array sorted by `startTime` ascending.

`SRTParser.parseVTT(content)` (WebVTT):
1. Normalize `\r\n` → `\n`, drop everything up to and including the first `WEBVTT` line.
2. Split remaining content by blank lines.
3. Cue id (optional) on line 0 if it does not contain `-->`; time line at index 0 or 1.
4. Time line: same parse, allows extra cue-settings after the end time (uses the first space-separated token).
5. Strip inline HTML/VTT tags via the same regex; skip empty text; auto-increment index.
6. Sorted ascending by start time.

`parseTimestamp`:
- Replaces `,` with `.` (SRT uses comma decimal).
- Splits on `:` — must yield exactly 3 parts (H, M, S.fff).
- Returns `h*3600 + m*60 + s` as `TimeInterval`, else `nil`.

`SRTParser.toSubtitles(parsed, style, animationStyle)`:
- Wraps each `ParsedSubtitle` as `OpenReelProject.Subtitle(id: UUID, text, startTime, endTime, style, words: nil, animationStyle)`.
- `words` is always nil from SRT/VTT; on-device transcription may supply per-word timing.

### 4.5 Per-line vs global formatting

- All `style` properties (font, color, background, alignment, **position**) and the animation style are **global** to the track — the panel only exposes track-wide controls and writes them across every cue.
- Per-cue editing happens via the "Add Captions to Timeline / Edit Caption Track" button: it materializes each cue as a `TextClip` (via `appState.ensureSubtitleTextClips`) and hands the user off to the Text editor tab (`appState.editorTab = .text`) — which has full per-line styling, animation, and timing control.
- Word-level timing (`subtitle.words`) is consumed by the karaoke/wordHighlight/wordByWord animation modes when available.

### 4.6 On-device caption integration

On iOS, OnDeviceCaptionService accepts a project-local media URL. The action is
available only when Speech reports supportsOnDeviceRecognition, and its request
sets requiresOnDeviceRecognition. Timed words are grouped into subtitle cues,
then the existing timeline mapper and style flow are reused. Failure never
falls back to a network recognizer.

### 4.7 Loading / empty / error states

- Empty: row subtitles read "Bring captions into the project" / "No cues available yet"; Track Style and Cues rows are disabled until cues exist.
- Loading: the iOS offline-caption row shows “Creating Captions…” and is disabled until the local recognizer finishes.
- Error: parser failures leave the cue list empty; caption-service errors are surfaced through local operation status.

### 4.8 Android mapping (Subtitles)

- Use SAF (`ACTION_OPEN_DOCUMENT`) with MIME filter `application/x-subrip`, `text/vtt`, `text/plain`.
- Parser: keep a 1:1 Kotlin port of `SRTParser` (regex `Regex("<[^>]+>")`, splitting on `"\n\n"`). For richer WebVTT (cue-settings, styles, regions), consider `org.mozilla:rhino`-free libs like `subtitleConvert` or jsoup-free `webvtt-parser`. Default to the simple port for parity with iOS behavior.
- ExoPlayer/Media3 already ships `SubtitleParser` for SRT and WebVTT via `androidx.media3:media3-extractor`. For rendering use a custom `SubtitleView` so the global style controls map cleanly.
- Animation styles → Compose `AnimatedContent` per cue. Karaoke/wordHighlight use word-level timestamps when a local source provides them.
- Persist `position` (`top/middle/bottom`) as a constraint on the caption Y anchor (0.1, 0.5, 0.9) and let the Text editor override per cue if the user promotes it to a real TextClip.

---

## 5. Cross-panel Android implementation checklist

- `EditorMenuRow` → `ListItem` with leading icon, headline + supporting text, trailing chevron, ripple. Disabled state dims content and skips ripple.
- `CompactSliderRow` → `Slider` with label + formatted value text aligned on a single row.
- `LazyVGrid(columns: 2)` with spacing 10 → `LazyVerticalGrid(GridCells.Fixed(2), Arrangement.spacedBy(10.dp))`.
- Sheet container → `ModalBottomSheet(skipPartiallyExpanded = false)` with the same internal layout (header card + scrollable body).
- File importers → `rememberLauncherForActivityResult(OpenDocument())`.
- Light haptic → `LocalHapticFeedback.current.performHapticFeedback(HapticFeedbackType.TextHandleMove)`.
- All effect/preset/template enums stored as JSON strings should keep the exact iOS rawValue strings (`teal-orange` etc.) so packages move between platforms unchanged.
