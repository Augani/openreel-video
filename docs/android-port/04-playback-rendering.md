# 04 — Playback, Rendering, and Video/Image Effects Pipeline

Authoritative reference for porting Openreel Video's preview-side playback and effects to Android. Source files cross-referenced inline.

---

## 1. AVFoundation Playback Architecture

The iOS pipeline composes three Apple frameworks. Android port must reproduce each layer.

```
PlaybackController (@MainActor, @Observable)
   |
   +-- AVPlayer
   |     +-- AVPlayerItem
   |            +-- AVMutableComposition         (built by PlaybackCompositionBuilder)
   |            +-- AVMutableAudioMix            (volume keyframes / ramps)
   |            +-- AVMutableVideoComposition    (custom compositor: TransitionVideoCompositor)
   |
   +-- TimelineAudioPreviewEngine                (AVAudioEngine, used when descriptor.requiresNativePreview)
   +-- AVPlayerItemVideoOutput  -> MetalVideoView (effects pipeline, color scopes)
```

What's wrapped:

- `AVPlayer` is the master playhead and clock. Owns rate, mute, volume, seeking.
- `AVMutableComposition` is the time-track database (video tracks A/B + N audio tracks).
- `AVMutableAudioMix` carries per-track volume automation (`setVolume(_:at:)` and `setVolumeRamp`).
- `AVMutableVideoComposition` carries instructions per time range; `customVideoCompositorClass = TransitionVideoCompositor` lets Core Image blend two source tracks for transitions.
- `AVPlayerItemVideoOutput` (32BGRA, Metal-compatible) pulls decoded frames; the Metal view runs the effect chain.
- `TimelineAudioPreviewEngine` wraps `AVAudioEngine` for advanced audio cases (pan, advanced effects, ducking) — replaces the AVPlayer audio path by muting AVPlayer.

What's exposed (publicly observable):
- `currentTime: TimeInterval`
- `duration: TimeInterval`
- `isPlaying: Bool`
- `volume: Float` (0–2)
- `frameRate: Double` (default 30)
- `loadedMediaURL: URL?`
- `player: AVPlayer?` (handed to the Metal view)

Internal observers installed on every player swap:
- Periodic time observer at `1/30 s` (timescale 600), updates `currentTime` only when `rate > 0`.
- KVO on `player.rate` → mirrors `isPlaying`.
- KVO on `playerItem.status` → no-op once `.readyToPlay`; used to defer `play()` until the item is ready.
- `AVPlayerItemDidPlayToEndTime` notification → sets `isPlaying=false`, snaps `currentTime=duration`, pauses audio engine.

Single-clip load path: `loadVideo(url:duration:frameRate:)` — builds `AVURLAsset` + `AVPlayerItem` directly, no composition, no video composition.

Multi-clip / timeline path: `loadTimeline(sources:duration:frameRate:transitions:)` — debounced via a `signature` (string concatenation of all source signatures + transitions); if the signature already matches `loadedTimelineSignature`, the swap is skipped. Otherwise it kicks off a `Task` that calls `PlaybackCompositionBuilder.build(...)` off the main actor and installs the resulting `AVPlayerItem` when done.

Audio mode (`applyPlayerAudioMode`): when native audio preview is active, `player.isMuted = true` and `player.volume = 0`; otherwise volume is clamped to `min(volume, 1)`.

Android mapping: ExoPlayer (`androidx.media3.exoplayer.ExoPlayer`) + `MediaSource` for each clip + `ConcatenatingMediaSource2` / `Composition` API (Media3 Transformer) for the editing graph. Use `Player.Listener.onIsPlayingChanged` / `onPlaybackStateChanged` instead of KVO. For frame access use `SurfaceTexture` or Media3's `Effect` pipeline; for transitions use Media3 `Composition` with `OverlayEffect` or fall back to a custom `GlEffect`. Pull frames into an OpenGL ES 3 / Vulkan compute pipeline for effect post-processing.

---

## 2. PlaybackController Public API

(`PlaybackController.swift` lines 268–715)

| Method | Behavior |
|---|---|
| `loadVideo(url: URL?, duration: TimeInterval, frameRate: Double)` | Single-source mode. If `url` already loaded, just refreshes duration/frame rate. Otherwise tears down observers, creates new `AVURLAsset`+`AVPlayerItem`+`AVPlayer`, installs observers. `frameRate` floors to 30 if <=0. Audio engine is reset to empty descriptor. |
| `loadTimeline(sources:duration:frameRate:transitions:)` | Multi-clip mode. Computes signature; skips if same. Asynchronously builds the AVComposition via `PlaybackCompositionBuilder.build`. Preserves `currentTime` across the swap (clamped to new duration). |
| `play()` | If the item isn't `.readyToPlay`, sets `isPlaying = true` and installs a one-shot KVO observer that calls `startPlayback()` once ready. If already at `duration - 0.05`, seeks to zero first (loop on tail). Then starts the audio engine if `usesNativeAudioPreview` and sets `player.rate = 1.0`. |
| `pause()` | Clears any deferred play observer, pauses the audio engine, sets `player.rate = 0`. |
| `togglePlayback()` | Pauses if `player.rate > 0`, plays otherwise. |
| `seek(to time: TimeInterval)` | Clamps to `[0, duration]`, updates `currentTime` synchronously, updates audio-engine playhead. If natively previewing audio while playing, pauses the audio engine, calls `player.seek(toleranceBefore: .zero, toleranceAfter: .zero)`, and on completion restarts the audio engine from the new time. CMTime timescale 600. |
| `step(frames: Int)` | `seek(to: currentTime + frames / frameRate)`. Frame-step uses zero tolerance. |
| `setVolume(_ value: Float)` | Clamps to `[0, 2]`. Audio engine clamps to `[0, 1]`. AVPlayer volume = `min(volume, 1)` when not using native preview. |

There is no explicit `setRate(_:)` — playback rate is locked at 1.0. Frame-step uses seek, not rate scrubbing. There is no looping flag; end-of-clip pauses (`actionAtItemEnd = .pause`) and a subsequent `play()` rewinds.

Android equivalents:
- `loadTimeline` → build a `androidx.media3.transformer.Composition` or feed a `ConcatenatingMediaSource2`. Always preserve playhead across swap.
- `play/pause/seek` → `Player.play()`, `pause()`, `seekTo(positionMs)`. Use `Player.SEEK_PARAMETERS_EXACT` for frame-accurate seeks.
- `step(frames:)` → `seekTo(currentPosition + frames * 1000 / frameRate)`.
- `setVolume` → `Player.setVolume` (0–1) plus a separate gain stage in an `AudioProcessor` for 1–2 range.
- For deferred-play (item not ready yet) listen on `Player.STATE_READY`.

---

## 3. PlaybackCompositionBuilder

(`PlaybackCompositionBuilder.swift` lines 515–873)

Inputs: `[TimelineSource]`, optional `TimelineAudioDescriptor`, `[TimelineTransition]`, `frameRate`.
Output: `Result { composition, audioMix, videoComposition? }`.

### Video Track Layout (A/B Rule)
1. Filter sources where `includesVideo == true`, sort by `startTime` ascending.
2. Always add exactly **two** video tracks (call them A and B).
3. Iterate sorted sources; assign track by index parity (`insertCount % 2`): clip 0 → A, clip 1 → B, clip 2 → A, etc. This ensures any neighbour pair (and therefore any transition) reads from different tracks, which the custom video compositor requires (it needs both outgoing and incoming pixel buffers simultaneously).
4. `clipTrackMap: [String: CMPersistentTrackID]` records which physical track holds each clip ID.

For each video source:
- Load `AVURLAsset` → first video track.
- `sourceTimeRange(for:asset:)` computes the readable range: `start = clamp(inPoint, 0, assetDuration)`, `duration = clamp(max(outPoint-inPoint, source.duration * speed), source.duration, availableDuration)`.
- Insert into track at `CMTime(seconds: startTime, timescale: 600)`.
- Carry the asset's `preferredTransform` (rotation/mirror) onto the composition track.
- If `sourceDuration != playbackDuration` (i.e. speed != 1), call `scaleTimeRange(_:toDuration:)` for time-stretch.
- Capture `renderSize` from the first inserted track (with `preferredTransform` applied via `applying(_:)` and `standardized`).

### Audio Tracks
For each segment in `TimelineAudioDescriptor.segments`:
- For each `AVAssetTrack` of `.audio` media type, add a new mutable audio track (one composition track per source audio track).
- Insert time range, scale if speed != 1.
- Build `AVMutableAudioMixInputParameters(track:)` and pump in the segment's pre-computed volume keyframes (see §3.3) — either as discrete `setVolume(at:)` points or as `setVolumeRamp(from:to:timeRange:)` between consecutive keyframes whose volumes differ.

### AudioMix Volume Keyframes
`TimelineAudioDescriptor.volumeKeyframes(for:audioEffects:allSources:)` precomputes a piecewise sample plan based on:
- Base volume `clamp(source.volume * source.trackGain, 0, 2)`
- Fade-in / fade-out with curve `{linear|exponential|logarithmic|sCurve|bezier}` (subdivided at 6 internal samples for non-linear curves).
- Volume automation segments (per-source `volumeAutomation: [AudioAutomationPoint]`).
- Ducking ranges: if effect `.ducking(config)` is present and another source with `trackRole == config.triggerRole` overlaps, attack/hold/release windows are applied with S-curve. `duckedMultiplier = 1 - config.reduction`.

Curve formulas (`curveValue(progress:curve:bezierControlPoints:)`):
- `linear`: `t`
- `exponential`: `pow(t, 2.2)`
- `logarithmic`: `log10(9t + 1)`
- `sCurve`: `t*t*(3 - 2t)` (smoothstep)
- `bezier`: cubic bezier evaluation, 14 bisection iterations to invert x→t.

Volume-keyframe simplification: a 3-tap pass drops any sample equal (within ε=0.0001) to both neighbours.

### Video Composition (only if transitions exist)
Build only when: at least one transition exists, a render size was captured, and `sources.count >= 2`. Otherwise the `videoComposition` is nil and the player just shows track A/B directly.

Render size is downsampled to `1280` on the longest side for preview.

Frame duration: `CMTime(1, max(round(frameRate), 1))`.

Time segments are built as follows:
1. For every transition, compute boundary = `outgoing.startTime + outgoing.duration`, `transStart = max(boundary - duration/2, 0)`, `transEnd = boundary + duration/2`. Emit a `.transition(outgoingTrackID, incomingTrackID, params)` segment covering that range.
2. For every video source, compute its full range; subtract every transition range from it (`subtract(_:from:)`), emit remaining sub-ranges as `.passthrough(trackID)`.
3. Sort all segments by `timeRange.start`.

Two instruction classes implement `AVVideoCompositionInstructionProtocol`:
- `CompositorPassthroughInstruction` — single source track, `containsTweening = false`, `requiredSourceTrackIDs = [sourceTrackID]`.
- `TransitionInstruction` — two sources, `containsTweening = true`, carries `transitionType`, `transitionParams`, `renderSize`.

### TransitionVideoCompositor
Conforms to `AVVideoCompositing`:
- `sourcePixelBufferAttributes` / `requiredPixelBufferAttributesForRenderContext` = `32BGRA`.
- Renders on a single serial `DispatchQueue` (QoS userInteractive), software-rendered=false `CIContext`.
- Passthrough path: return `sourceFrame(byTrackID:)` directly (or a black frame fallback).
- Transition path: `aspectFit` (uniform scale + center offset) both outgoing and incoming `CIImage`s to `renderSize`, computes progress = `elapsed / duration` clamped to [0,1], delegates to `TransitionCompositor.apply(...)`, renders to a fresh output `CVPixelBuffer` via `CIContext.render(_:to:bounds:colorSpace:)` with `CGColorSpaceCreateDeviceRGB()`.

Android mapping:
- Use Media3 Transformer's `Composition` for sequencing, or build a `MediaCodec` decode → `SurfaceTexture` → GLES render loop.
- Two-track A/B parity rule is mandatory for any cross-fade implementation. Implement equivalent of `subtract(_:from:)` to slice passthrough ranges around transition ranges.
- Volume keyframes → `Renderer` `AudioProcessor` chain that reads a precomputed envelope, OR Media3's `Effects.audioProcessors` with a custom volume-shaping `AudioProcessor`.
- For per-clip transforms (rotation), apply the source's display transform via OpenGL matrix.

---

## 4. VideoEffectTypes Catalog

(`VideoEffectTypes.swift`) — exhaustive list. Every parameter ranges and default below. `intensity` parameter is universal: it controls the dissolve blend between original and effected (0 = original, 1 = full effect). Each effect's renderer applies the effect at full strength, then `VideoEffectRenderer.blend(original:effected:intensity:)` dissolves between them.

Effect type strings are the enum `rawValue`s (camelCase).

| Effect | Param | Range | Default | Notes |
|---|---|---|---|---|
| `brightness` | `value` | −1 … 1 (CIColorControls) | 0 | additive |
| `brightness` | `intensity` | 0 … 1 | 1 | |
| `contrast` | `value` | 0.25 … 4 (CI) | 1 | multiplicative |
| `contrast` | `intensity` | 0 … 1 | 1 | |
| `saturation` | `value` | 0 … 2 | 1 | |
| `saturation` | `intensity` | 0 … 1 | 1 | |
| `temperature` | `value` | −1 … 1 | 0 | mapped onto R/G/B/Bias matrix (see §5) |
| `temperature` | `intensity` | 0 … 1 | 1 | |
| `hue` | `rotation` | degrees (no clamp; converted to radians) | 0 | |
| `hue` | `intensity` | 0 … 1 | 1 | |
| `blur` | `radius` | ≥ 0, default 0.5 | 0.5 | CIGaussianBlur |
| `blur` | `type` | "gaussian" | "gaussian" | currently unused branch |
| `blur` | `intensity` | 0 … 1 | 1 | |
| `sharpen` | `amount` | ≥ 0 | 0.3 | CISharpenLuminance |
| `sharpen` | `radius` | unused in renderer | 1 | |
| `sharpen` | `threshold` | unused | 10 | |
| `sharpen` | `intensity` | 0 … 1 | 1 | |
| `vignette` | `amount` | ≥ 0 | 0.25 | scaled by 0.9 (custom) or 2.2 (CIVignette fallback) |
| `vignette` | `midpoint` | 0.05 … 1 | 0.5 | radius = `min(w,h) * midpoint` |
| `vignette` | `roundness` | unused | 0.5 | |
| `vignette` | `feather` | unused | 0.8 | |
| `vignette` | `intensity` | 0 … 1 | 1 | |
| `grain` | `amount` | 0 … 1 | 0.15 | |
| `grain` | `size` | unused | 1.5 | |
| `grain` | `roughness` | unused | 0.5 | |
| `grain` | `colored` | unused | false | |
| `grain` | `intensity` | 0 … 1 | 1 | |
| `chromaticAberration` | `amount` | 0 … 20 | 3 | passed to kernel scaled by 0.8 |
| `chromaticAberration` | `intensity` | 0 … 1 | 1 | |
| `bloom` | `radius` | 0 … 60 | 12 | CIBloom |
| `bloom` | `amount` | 0 … 2 | 0.65 | CIBloom intensity |
| `bloom` | `intensity` | 0 … 1 | 1 | |
| `pixelate` | `scale` | 1 … 80 | 18 | CIPixellate |
| `pixelate` | `intensity` | 0 … 1 | 1 | |
| `motionBlur` | `radius` | 0 … 60 | 8 | CIMotionBlur |
| `motionBlur` | `angle` | degrees → radians | 0 | |
| `motionBlur` | `intensity` | 0 … 1 | 1 | |
| `dissolve` | `amount` | 0 … 1 | 0.25 | alpha multiplier `1-amount` |
| `dissolve` | `intensity` | 0 … 1 | 1 | |
| `disintegrate` | `amount` | 0 … 1 | 0.35 | CIDisintegrateWithMaskTransition |
| `disintegrate` | `shadow` | 0 … 1 | 0.2 | scaled by 18 for shadowRadius |
| `disintegrate` | `intensity` | 0 … 1 | 1 | |
| `stabilize` | `strength` | 0 … 1 | 0.5 | |
| `stabilize` | `crop` | 0 … 0.18 | 0.06 | scale = `1 + crop*strength` |
| `stabilize` | `target` | "subject" | "subject" | |
| `stabilize` | `confidence` | 0 … 1 | 0.55 | tracking conf threshold |
| `stabilize` | `smoothing` | 0 … 1 | 0.5 | |
| `stabilize` | `quality` | "balanced"/"fast"/"high" | "balanced" | |
| `stabilize` | `intensity` | 0 … 1 | 1 | |
| `motionTrack` | `mode` | "subject" | "subject" | renderer pass-through (visual no-op; emits tracking path metadata) |
| `motionTrack` | `confidence` | 0 … 1 | 0.7 | |
| `motionTrack` | `smoothing` | 0 … 1 | 0.35 | |
| `motionTrack` | `quality` | string | "balanced" | |
| `motionTrack` | `intensity` | 0 … 1 | 1 | |
| `backgroundRemoval` | — | see `BackgroundRemovalSettings.effectParams` | (settings default) | AI mask via Vision; applied through `AIMaskCompositor.applyBackgroundRemoval` |
| `subjectBlur` | `radius` | ≥ 0 | 16 | gaussian on background, keyed by AI mask |
| `subjectBlur` | `feather` | ≥ 0 | 4 | mask edge feather |
| `subjectBlur` | `quality` | string | "balanced" | |
| `subjectBlur` | `intensity` | 0 … 1 | 1 | |
| `subjectGlow` | `radius` | ≥ 0 | 18 | |
| `subjectGlow` | `amount` | ≥ 0 | 0.65 | |
| `subjectGlow` | `feather` | ≥ 0 | 6 | |
| `subjectGlow` | `quality` | string | "balanced" | |
| `subjectGlow` | `intensity` | 0 … 1 | 1 | |
| `faceBeauty` | — | see `FaceBeautySettings.effectParams`: `intensity`, `smoothing`, `sharpen`, `brighten`, `warmth`, `feather` | settings default | CINoiseReduction + ColorControls + temperature; masked to tracked face rect when available |
| `faceTrack` | `target`/`confidence`/`smoothing`/`quality`/`intensity` | strings/0–1 | "face"/0.6/0.35/"balanced"/1 | pass-through visual |
| `objectTrack` | (same shape) | | "object"/0.65/0.35/"balanced"/1 | pass-through |
| `bodyPose` | (same shape) | | "body"/0.55/0.4/"balanced"/1 | pass-through |
| `autoReframe` | `target` | "subject" | "subject" | crops & rescales to keep tracked box in frame |
| `autoReframe` | `padding` | 0 … some | 0.12 | padded box = `box * (1 + padding*2)` |
| `autoReframe` | `smoothing` | 0 … 1 | 0.5 | |
| `autoReframe` | `confidence` | 0 … 1 | 0.65 | minimum tracking conf |
| `autoReframe` | `quality` | string | "balanced" | |
| `autoReframe` | `intensity` | 0 … 1 | 1 | |
| `colorWheels` | `shadows`/`midtones`/`highlights` | object `{r,g,b}` each clamped −1 … 1 | `{0,0,0}` | applied as R/G/B bias |
| `colorWheels` | `shadowsLift` | −1 … 1 | 0 | bias 0.08 |
| `colorWheels` | `midtonesGamma` | 0.2 … 3 | 1 | CIGammaAdjust |
| `colorWheels` | `highlightsGain` | 0 … 3 | 1 | RGB vector scale |
| `colorWheels` | `intensity` | 0 … 1 | 1 | |
| `curves` | `rgb`,`red`,`green`,`blue` | arrays of `{x,y}` each in 0…1 | `[{0,0},{1,1}]` | baked into 32³ color cube |
| `curves` | `intensity` | 0 … 1 | 1 | |
| `hsl` | `hue` | length-8 array; each ∈ −180…180 (degrees) | [0]*8 | 8 hue bands of 45° each |
| `hsl` | `saturation` | length-8; each ∈ −1…1 | [0]*8 | |
| `hsl` | `luminance` | length-8; each ∈ −1…1 (scaled ×0.5 inside renderer) | [0]*8 | |
| `hsl` | `intensity` | 0 … 1 | 1 | |
| `lut` | `name` | string | "None" | |
| `lut` | `path` | string, project-relative | "" | |
| `lut` | `size` | int (LUT 3D size) | 0 | |
| `lut` | `domainMin` | array[3] −1000…1000 | [0,0,0] | |
| `lut` | `domainMax` | array[3] −1000…1000 | [1,1,1] | |
| `lut` | `checksum` | string | "" | used as cache key |
| `lut` | `intensity` | 0 … 1 | 1 | |
| `filterPreset` | `name` | string | "Custom" | legacy; reapplies contrast/saturation/temperature |
| `filterPreset` | `contrast`/`saturation`/`temperature` | as above | inherited | |
| `colorAdjust` | `name`,`brightness`,`contrast`,`saturation`,`temperature`,`beauty` | see Brightness/Contrast/Sat/Temp + `beauty` 0…1 | "Custom"/0/1/1/0/0 | legacy combined preset |
| `colorAdjust` | `intensity` | 0 … 1 | 1 | |

The `Effect` struct (`OpenReelProject.Effect`) is the persisted shape: `{ id, type, enabled: Bool, params: [String: JSONValue] }`.

---

## 5. CIFilter / Metal Kernel Mappings

(`VideoEffectRenderer.swift`)

| Effect | Underlying API | Notes |
|---|---|---|
| `brightness`,`contrast`,`saturation` | `CIColorControls` (`inputBrightness`/`inputContrast`/`inputSaturation`) | Single instance per effect (one channel at a time). |
| `temperature` | `CIColorMatrix` | Hand-built matrix: warm = max(t,0), cool = max(-t,0). R = `1 + warm*0.10 - cool*0.10`, G = `1 - warm*0.03 - cool*0.02`, B = `1 - warm*0.16 + cool*0.12`. Bias = `(warm*0.015, 0, cool*0.015, 0)`. |
| `hue` | `CIHueAdjust` (`inputAngle = rotation * π/180`) | |
| `blur` | `CIGaussianBlur` (cropped back to extent) | |
| `sharpen` | `CISharpenLuminance` | |
| `vignette` | Custom Metal kernel `openreelVignette` (preferred) with `amount*0.9` and `radius = min(w,h)*midpoint`; fallback `CIVignette` with `inputIntensity = amount*2.2`. | |
| `grain` | Custom Metal kernel `openreelGrain`; fallback = `CIRandomGenerator` + `CIColorMatrix` + `CISoftLightBlendMode`. Seed = `timelineTime * 24`. | |
| `bloom` | `CIBloom` | |
| `pixelate` | `CIPixellate` centered on image midpoint | |
| `motionBlur` | `CIMotionBlur` | |
| `dissolve` | `CIColorMatrix` with `inputAVector = (0,0,0, 1-amount)` | global alpha |
| `disintegrate` | `CIDisintegrateWithMaskTransition` (target = transparent, mask = jittered noise) | |
| `chromaticAberration` | Custom Metal kernel `openreelChromaticAberration` (preferred); fallback = 3 channel-isolated `CIColorMatrix` + translated copies + `CIAdditionCompositing`. | |
| `colorWheels` | `CIColorMatrix` (lift/gain/bias) + `CIGammaAdjust` | |
| `curves` | `CIColorCubeWithColorSpace` baked from `EffectCurvePoint` arrays (32³) | linear interpolation between sorted curve points |
| `hsl` | `CIColorCubeWithColorSpace` baked via HSL conversion (32³) | 8-band hue selection by `floor(hue*360/45)` |
| `lut` | `CIColorCubeWithColorSpace` from parsed `.cube` file; cached by `path|checksum` | `CGColorSpaceCreateDeviceRGB()` |
| `stabilize` | Affine transform (uniform scale around image center) + optional XY translation based on tracking box | not Vision-stabilized; this is the *post-tracking* render pass |
| `autoReframe` | `cropped(to:)` + scale-up affine transform | crop rect computed from tracking box and image aspect |
| `subjectBlur`/`subjectGlow`/`backgroundRemoval` | `AIMaskCompositor.apply*` (consumes Vision segmentation mask supplied by `FrameEffectContext`) | |
| `faceBeauty` | `CINoiseReduction` + `CIColorControls` + temperature + `CISharpenLuminance`; mask blend via `CIBlendWithMask` with a feathered rectangular mask of the tracked face box | |
| `motionTrack`,`faceTrack`,`objectTrack`,`bodyPose` | returns `image` unchanged | These effects only **emit** tracking metadata. Use the resulting `TrackingPath` in dependent effects (stabilize, autoReframe, faceBeauty). |
| `dissolve` (effect, not transition) | alpha matrix | |
| `filterPreset` | `CIColorControls` + temperature | legacy |
| `colorAdjust` | `CIColorControls` + temperature + optional `CINoiseReduction` for `beauty` | legacy |

Final intensity blend: `original.applyingFilter("CIDissolveTransition", inputTargetImage = effected, inputTime = clamp(intensity, 0, 1))`.

Android mapping per effect type:
- `CIColorControls`/`CIColorMatrix`/`CIHueAdjust` → fragment shader with uniforms (or Media3 `RgbFilter`, `RgbMatrix`, `HslAdjustment`).
- `CIGaussianBlur` → two-pass separable Gaussian shader; or `RenderEffect.createBlurEffect` on API 31+.
- `CIBloom` → high-pass + Gaussian + additive blend.
- `CISharpenLuminance` → unsharp mask (`luma - blur(luma)` added back).
- `CIPixellate` → quantize UV to block grid in shader.
- `CIMotionBlur` → directional blur shader (sample N taps along angle).
- `CIVignette` → radial falloff multiplied with RGB (port the Metal `openreelVignette` kernel below).
- `CIRandomGenerator`+`CISoftLightBlendMode` (grain fallback) → port the Metal `openreelGrain` kernel directly.
- `CIDisintegrateWithMaskTransition` → there is no direct Android equivalent; reproduce as alpha-keyed dissolve using a tiled noise texture and a shadow offset.
- `CIColorCubeWithColorSpace` (32³, RGBA float) → use an OpenGL 3D texture (`GL_TEXTURE_3D`) with `RGBA32F` data and trilinear sampling, OR Media3's `SingleColorLut` / `Hdr10ToHdr10PlusEffect`-style lookup, OR androidx `androidx.media3.effect.SingleColorLut` (when 1D) — for 3D use `androidx.media3.effect.GlEffect` with a custom `GlShaderProgram`.

---

## 6. CustomEffectKernels (Metal)

(`CustomEffectKernels.swift`) — three stitchable Metal kernels compiled at runtime via `CIKernel.kernels(withMetalString:)`. Each `apply` returns nil if the library failed to load, in which case the renderer falls back to a CIFilter equivalent.

### `openreelGrain(sample_t image, float amount, float seed, destination dest) -> float4`
- `dc = dest.coord()`
- `monoNoise = (random(dc, seed) - 0.5) * amount * 0.22`
- `blueNoise = (random(dc.yx, seed + 3.1) - 0.5) * amount * 0.08`
- Output RGB clamped to `[0,1]`: `image.rgb + (monoNoise, monoNoise*0.9, monoNoise + blueNoise)`.
- Random function: `fract(sin(dot(coord + float2(seed, seed*1.618), float2(12.9898, 78.233))) * 43758.5453)` — classic hash.

### `openreelVignette(sample_t image, float amount, float radius, float2 center, destination dest) -> float4`
- `distance = distance(dc, center)`
- `edge = smoothstep(radius * 0.55, radius, distance)`
- `mul = 1 - edge*amount`
- Returns `(image.rgb * mul, image.a)`.

### `openreelChromaticAberration(sampler image, float amount, float2 center, destination dest) -> float4`
- `delta = dc - center`
- `direction = normalize(delta)` (or zero at center)
- `offset = direction * amount`
- Sample: `red = sample(dc + offset)`, `green = sample(dc)`, `blue = sample(dc - offset)`.
- Output `float4(red.r, green.g, blue.b, green.a)`.
- ROI callback insets by `-amount` on both axes (so OpenGL/Vulkan port needs equivalent texture-coordinate padding).

Android port: reimplement each as a GLES 3 fragment shader; the math is platform-agnostic. The hash function works identically in GLSL (use `fract`/`sin`/`dot`). For chromatic aberration, set texture wrap to `GL_CLAMP_TO_EDGE`.

---

## 7. TransitionCompositor

(`TransitionCompositor.swift`)

Public entry: `apply(outgoing:incoming:transition:progress:) -> CIImage`. Progress comes from `TransitionVideoCompositor.transitionProgress(at:in:)` = `(time - timeRange.start) / timeRange.duration`, clamped to [0,1].

Easing: `EasingFunctions.value(for: params["curve"] ?? "linear", progress:)` — the curve string is passed through; concrete curves are defined in `EasingFunctions` (see misc-effects doc for the catalog). Both raw and eased progress are clamped to [0,1].

Type dispatch (`TransitionCatalog.sanitizedType(...)`). Each implementation:

| Type | Math / Behavior | Parameters (defaults) |
|---|---|---|
| `crossfade` | `incoming.alpha = p` over `outgoing.alpha = 1-p`, composited. | — |
| `dipToBlack` | 3-phase: fade `outgoing → black` over `1/(2+hold)`, hold black for `hold/(2+hold)`, fade `black → incoming` over the rest. | `holdDuration: 0.1` |
| `dipToWhite` | Same as dipToBlack but with white. | `holdDuration: 0.1` |
| `wipe` | Reveal incoming inside a rectangular sub-region growing from one edge. | `direction: "left"|"right"|"up"|"down"` (default `"left"`) |
| `slide` | Translate incoming in from a direction; if `pushOut`, outgoing slides out the opposite way. | `direction`, `pushOut: false` |
| `push` | Same as `slide` with `pushOut: true`. | `direction` |
| `zoom` | Outgoing scales from 1 to `scale` with alpha 1→0; incoming scales from `1/scale` to 1 with alpha 0→1. Both around `center`. | `scale: 2` (clamped 1.01–6), `center: {x:0.5, y:0.5}` |
| `blurDissolve` | Both layers gaussian-blurred with sigma `maxRadius * sin(progress*π) * (1-progress)*2` (outgoing) and `* progress*2` (incoming), cross-faded. | `maxRadius: 20` |
| `iris` | CIRadialGradient mask: `currentRadius = diagonal/2 * progress`, inner = `currentRadius - softness*diagonal/2`. CIBlendWithMask of incoming over outgoing. | `center: {0.5,0.5}`, `softness: 0.02` |
| `spin` | Two-phase: out spins by `progress*rotations*2π` with scale `1 - 0.3*sin(progress*π)`, alpha `1-progress*2`; after midpoint, in spins from `-(1-progress)*rotations*2π` to 0 with `(progress-0.5)*2` alpha. | `rotations: 1` |
| `glitch` | Slice screen into `slices` horizontal bands, each translated by `sin(seed*13.7)*cos(seed*5.3) * w*intensity*0.3 * sin(crossProgress*π)`. Source = outgoing for `p<0.5`, incoming for `p>=0.5`. Mid-range (`0.3<p<0.7`) adds RGB-split overlay using three `CIColorMatrix` channel isolations translated by `±maxOffset*0.3*sin(p*2π)`. | `intensity: 0.5`, `slices: 8` |
| `pixelate` | `pixelSize = maxBlockSize * sin(p*π)`. `p<0.5`: pixellate outgoing. Else: pixellate incoming. | `maxBlockSize: 40` |
| `lumaFade` | Convert outgoing to mono via `CIPhotoEffectMono`. Build a luminance ramp: `rampVector = (-low/range, 1/range, 0, 0)` where `low = p-softness`, `high = p+softness`, `range = high-low`. CIBlendWithMask incoming over outgoing using ramped (and optionally inverted) mono mask. | `invert: false`, `softness: 0.3` |
| (default) | falls back to `crossfade` | — |

Duration handling: transition extent in the composition timeline is `[boundary - duration/2, boundary + duration/2]` where `boundary = outgoing.startTime + outgoing.duration`. Practically, transitions consume half their length from each adjoining clip.

Helper geometry:
- `centerPoint(from:in:)` reads normalized `{x,y}` ∈ [0,1], maps to extent.
- `opacity(_:alpha:)` is an alpha-only `CIColorMatrix`.
- `scaleImage(_:scale:center:)` is affine `translate(c) · scale · translate(-c)`.

Android mapping: each transition is a small fragment shader. Slide/push/wipe are texture-coordinate gates. Iris is a smoothstep-based mask. Glitch needs a noise hash and band-row sampling. Pixelate uses `floor(uv * blocks) / blocks`. lumaFade extracts luma `dot(rgb, vec3(0.2126, 0.7152, 0.0722))` then ramps via `smoothstep(low, high, luma)`. Spin needs vertex-shader rotation, or premultiplied matrix in a fullscreen tri.

---

## 8. ColorScopesEngine

(`ColorScopesEngine.swift`)

Purpose: produce a `ColorScopesSnapshot { waveform: [ColorScopePoint], vectorscope: [ColorScopePoint] }` for overlay UI.

Inputs:
- `snapshot(cgImage:targetWidth:targetHeight:maximumSamples:)` — draws CGImage into a fixed 160×90 RGBA8 bitmap (DeviceRGB), interpolation `.low`, then iterates pixels.
- `snapshot(pixels:width:height:maximumSamples:)` — direct pixel-array path.

Sampling: stride = `max(1, sqrt(width*height / maximumSamples))` (default `maximumSamples = 1400`). Pixels with `alpha == 0` skipped.

Per pixel:
- `red, green, blue = byte / 255`
- `luma = 0.2126R + 0.7152G + 0.0722B` (BT.709)
- `chromaBlue = (B - luma) * 0.565`
- `chromaRed = (R - luma) * 0.713`

Outputs:
- Waveform point: `(x / (w-1), 1 - clamp(luma, 0, 1))` — x is pixel column normalized, y inverted so brightness goes up.
- Vectorscope point: `(0.5 + chromaBlue, 0.5 - chromaRed)` clamped to [0,1].

The Metal preview view calls `snapshot(cgImage:)` every 8 frames (`frameCounter % 8 == 0`) and dispatches to main via the `scopesUpdate` callback. The still-image renderer calls it once after each render.

No histogram is computed — Openreel currently only has waveform + vectorscope. (RGB histograms can be added by binning luma & per-channel values into 256 buckets.)

Android mapping: identical math; downsample frame to 160×90 via OpenGL FBO or `Bitmap.createScaledBitmap`, read back via `glReadPixels` (or `PixelCopy.request` for a Surface), compute on a worker thread. Use BT.709 coefficients verbatim.

---

## 9. CubeLUTParser

(`CubeLUTParser.swift`)

Format support: Adobe `.cube` 3D LUT text files (UTF-8).

Grammar accepted:
- Lines starting with `#` or blank are skipped.
- `TITLE "..."` — optional, quotes stripped.
- `LUT_3D_SIZE N` — required. N must be in `2...128`.
- `DOMAIN_MIN r g b` — optional, default `[0,0,0]`.
- `DOMAIN_MAX r g b` — optional, default `[1,1,1]`.
- `LUT_1D_*` and any other `LUT_*` directive → throws `unsupportedDimension`.
- Otherwise: 3 space/tab-separated floats per sample, each in `[0,1]`.

Sample ordering follows the standard cube convention: red varies fastest, then green, then blue:
```
for blueIndex in 0..<N:
  for greenIndex in 0..<N:
    for redIndex in 0..<N:
      append sample
```
Total samples must equal `N^3` or `invalidSampleCount` is thrown.

Output: `CubeLUT { title, size, domainMin, domainMax, samples: [Sample{r,g,b}] }`.

### Color Grading Pipeline (LUT application)
1. `applyLUT` reads `EffectLUTReference` from params (`name`, `path`, `size`, `domainMin`, `domainMax`, `checksum`, `intensity`).
2. Cache key = `"\(path)|\(checksum)"`. Cube data is cached as `(dimension: Int, data: Data)` in `VideoEffectRenderer.cubeCache` under an `NSLock`.
3. Load file from `projectDirectoryURL.appendingPathComponent(reference.path)`, parse via `CubeLUTParser.parse(data:)`.
4. Convert samples to `Data` of float-quads (RGBA, alpha = 1): little-endian Float32 stream.
5. Apply via `CIColorCubeWithColorSpace` with `inputCubeDimension`, `inputCubeData`, `inputColorSpace = CGColorSpaceCreateDeviceRGB()`.
6. Wrap the resulting image into the global `intensity` dissolve like every other effect.

Note: the iOS code does **not** apply `domainMin`/`domainMax` remapping itself (it relies on CIColorCubeWithColorSpace's default [0,1] domain). If your LUT has a non-default domain, you must pre-remap input colors yourself.

Android mapping:
- Parse `.cube` with the same grammar (any Kotlin parser will do).
- Upload as `GL_TEXTURE_3D`, `internalformat = GL_RGB16F` or `GL_RGBA16F`, with `GL_LINEAR` mag/min filter, `GL_CLAMP_TO_EDGE` wraps on all three axes.
- In fragment shader: `outColor.rgb = texture(uLut, inColor.rgb).rgb;` with a tiny half-texel inset (`(0.5 + idx) / N`) to avoid edge bleed.
- Cache parsed LUTs by `(path, checksum)` like iOS.
- Libraries: roll your own (the parser is ~150 lines); alternatively `com.gpuimage:gpuimage-library` has 3D LUT support, or use Media3's effect API to wrap a custom `GlShaderProgram`.

---

## 10. EffectParameterCodec

(`EffectParameterCodec.swift`) — JSON ↔ runtime helpers.

Types:
- `EffectCurvePoint { x, y: Double }` — both clamped to [0,1].
- `EffectLUTReference { name, path, size, domainMin, domainMax, checksum, intensity, byteCount }`.

Defaults:
- `defaultCurvePoints` = `[{0,0}, {1,1}]` (identity).
- `defaultDomainMin` = `[0,0,0]`, `defaultDomainMax` = `[1,1,1]`.

Encoding helpers (used when building `defaultParams` or persisting):
- `number(value, lowerBound, upperBound)` — clamp and wrap as `.number`.
- `numberArray(values, count, fallback, lower, upper)` — pad/truncate to fixed length, clamp each.
- `colorObject(r,g,b)` — `{"r": …, "g": …, "b": …}`, each clamped −1 … 1.
- `pointObject(EffectCurvePoint)` — `{"x": …, "y": …}`.
- `curveArray([Point])` — array of point objects, defaulting to identity.
- `curvesParams(rgb,red,green,blue)` — full curves payload.
- `hslParams(hue,saturation,luminance)` — three length-8 arrays. Hue clamped −180 … 180; sat/lum clamped −1 … 1.
- `lutParams(reference:)` — full LUT payload with `byteCount` becoming `.null` if absent.

Decoding helpers:
- `curvePoints(from:params, key:)` — extracts an array of `{x,y}` objects; clamps each to [0,1]; falls back to identity if missing/empty; **always returned sorted by `x`**.
- `lutReference(from:)` — requires `name`, `path`, `checksum`, `size > 1`. Intensity clamped 0…1.

`JSONValue` extensions: `boolValue`, `objectValue`, `arrayValue`, `doubleArrayValue(count:)` (returns nil if length mismatch).

Persistence contract: the renderer reads these via `effect.params["…"]?.doubleValue` etc. All effect params should round-trip through JSON exactly; Android port must serialize numeric arrays as JSON arrays, not delimited strings.

---

## 11. StillImageEffectRenderer

(`StillImageEffectRenderer.swift`, `EffectImageView.swift`)

Image-vs-video differences:

| Concern | Video (MetalVideoView) | Image (StillImageEffectRenderer + EffectImageView) |
|---|---|---|
| Source | `AVPlayerItemVideoOutput` → `CVPixelBuffer` → `CIImage` | `CIImage(contentsOf:)`, falling back to `UIImage` → `CGImage` → `CIImage` |
| Render trigger | MTKView delegate `draw(in:)` ~30 fps | `.task(id: renderKey)` — runs once per parameter change |
| Effect chain | Same `VideoEffectRenderer.render(_:effects:projectDirectoryURL:timelineTime:effectContext:)` | Same renderer, but `timelineTime = 0` and no `effectContext` (AI not run on stills). |
| AI context | Background `MediaAnalysisService` task per frame | Not applied (stills don't request `FrameEffectContext`). |
| Color scopes | Sampled every 8th frame from the rendered CIImage | Sampled once after each render via `ColorScopesEngine.snapshot(cgImage:)` |
| Output | Drawn directly to MTLDrawable texture | `CIContext.createCGImage` → `UIImage` → SwiftUI `Image.scaledToFit()` |
| Color space | `CGColorSpaceCreateDeviceRGB()` | `CGColorSpaceCreateDeviceRGB()` (same) |
| Cache key | derived from clip+frameIndex+effects | `renderKey = imageURL.path | projectDir | sortedEffectsSignature` (recomputes whenever any param changes) |

EffectImageView signature builder: `id#type#enabled#sortedKey=value,sortedKey=value`.

`StillImageEffectRenderer.render` constructs a fresh `CIContext` (Metal-backed if available, else CPU) per call — there is no global cache. Returned tuple includes both the rendered `UIImage?` and a `ColorScopesSnapshot` for the scopes overlay.

Android mapping:
- Decode source via `BitmapFactory.decodeFile` or `ImageDecoder`.
- Run the same effect pipeline as video (the GLES context can render to an offscreen FBO, then `glReadPixels` into a `Bitmap`).
- Skip AI-frame-context effects (background removal, subject blur, face beauty) on stills only if you intentionally want video-only AI; otherwise replicate with `androidx.camera.mlkit` segmentation on the still bitmap.
- Use `Image.asImageBitmap()` if rendering through Compose.

---

## 12. MetalVideoView

(`MetalVideoView.swift`)

Surface:
- `MTKView` with `device = MTLCreateSystemDefaultDevice()`, `colorPixelFormat = .bgra8Unorm`, `clearColor = (0,0,0,1)`, `framebufferOnly = false` (required because we render via `CIContext.render(_:to:)`), `enableSetNeedsDisplay = false`, `isPaused = false`, `preferredFramesPerSecond = 30`.
- Backed by a single `MTLCommandQueue` per view.
- `CIContext(mtlDevice:)` shared with the `VideoEffectRenderer`.
- Color space: `CGColorSpaceCreateDeviceRGB()` for both render and scopes.
- HDR: not handled. Pixel buffer attributes request `kCVPixelFormatType_32BGRA` + `kCVPixelBufferMetalCompatibilityKey: true`. HDR10/HLG sources would be tone-mapped to SDR by the BGRA conversion AVPlayerItemVideoOutput performs. There's no PQ or HLG-aware path.

Frame pump:
1. `installVideoOutput()` attaches an `AVPlayerItemVideoOutput` to the current item.
2. `currentFrame()` chooses the time: if paused, use `player.currentTime()`; else `videoOutput.itemTime(forHostTime: CACurrentMediaTime())`. If a new pixel buffer is available, copy it into `lastFrame`. If `lastFrame` is nil, force a copy regardless.
3. `draw(in:)` runs the effect renderer, applies aspect-fit scale/translate to the drawable's bounds (`aspectFitImage(_:in:)`), renders via `CIContext.render(_:to: drawable.texture, commandBuffer:, bounds:, colorSpace:)`, presents the drawable.

Aspect-fit: uniform scale by `min(bounds.w/extent.w, bounds.h/extent.h)`, centered with letterboxing, composited over a black background sized to bounds. Always crops to bounds before presenting.

AI context cache (for background removal, subject blur/glow, face beauty, etc.):
- Cache key = `clipID|mediaID|frameIndex|descriptorSignature` where `frameIndex = round(sourceTime * frameRate)`.
- `aiContextTask` is a `Task(priority: .utility)` that calls `AIFrameContextBuilder.frameContext(...)` with the current `CVPixelBuffer`.
- On completion (on main actor), if the pending key still matches, store the context and call `metalView.draw()` again to repaint with masks/tracking applied.
- `setPlayer`, `setClip`, `setEffects` all `resetAIContext()` to drop stale results.

Scopes update: every 8 frames (`frameCounter % 8 == 0`) creates a `CGImage` from the rendered `CIImage` (format `.RGBA8`) and dispatches `ColorScopesEngine.snapshot(cgImage:)` result to the callback on main.

Android mapping:
- `SurfaceView` or `TextureView` backed by an `EGLContext`/`GLES30`.
- Pull frames via `MediaCodec` + `SurfaceTexture.updateTexImage()` (`SurfaceTexture.OnFrameAvailableListener`), or for Media3 use a `VideoFrameProcessor`.
- Apply effect chain in a single FBO ping-pong, then blit aspect-fit to default framebuffer.
- For HDR support on Android, request `ColorSpace.Named.BT2020_HLG` and use `HardwareBuffer` + `ImageReader` with `HardwareBuffer.YCBCR_P010`; pipe through `androidx.media3.effect.HdrToSdr*` or custom tone-mapping. Out of scope for v1 — match iOS by forcing SDR sRGB.

---

## 13. Android Mapping Summary

### Player Stack
- **AVPlayer → ExoPlayer** (`androidx.media3.exoplayer.ExoPlayer`).
- **AVMutableComposition → `androidx.media3.transformer.Composition`** or hand-rolled `ConcatenatingMediaSource2`. Two-track parity rule for transitions must be implemented (`EditedMediaItemSequence` × 2 if using Transformer/Composition).
- **AVMutableAudioMix → `AudioProcessor` chain** with sample-accurate envelope; or per-`EditedMediaItem` `AudioEffectsProvider`.
- **AVMutableVideoComposition + custom compositor → `androidx.media3.effect.GlEffect`** chain (overlay/transition shaders), or process the dual-track output with a `OverlaySettings`/`OverlayEffect` per time range.

### Display
- **MTKView + CIContext → `androidx.media3.ui.PlayerView` with `SurfaceView`** (preview), plus a sibling `GLSurfaceView` that consumes `SurfaceTexture` for effect post-processing. Or use Media3's `VideoFrameProcessor` (single-pipe).

### Effect Implementation
- All `CIFilter`-based effects can be ported as GLES 3.0 fragment shaders. The shader math is in §5 and §7 above.
- LUTs: `GL_TEXTURE_3D` + `GL_LINEAR` (see §9). Libraries: avoid; the parser is trivial and 3D textures are well-supported on API 21+.
- Custom Metal kernels (grain, vignette, chromatic aberration): direct GLSL port — code in §6, math is unchanged.
- AI-driven effects (`backgroundRemoval`, `subjectBlur`, `subjectGlow`, `faceBeauty`, tracking-based effects): use ML Kit (`com.google.mlkit:segmentation-selfie`, `com.google.mlkit:face-detection`) or MediaPipe. Wrap in the same per-frame cache pattern (debounced by `frameIndex`).

### Per-Effect Library/Approach Choice

| Effect | Suggested Android implementation |
|---|---|
| brightness, contrast, saturation | Media3 `RgbAdjustment` / `RgbMatrix` / `HslAdjustment`, or single uniform fragment shader |
| temperature | Custom shader with the hand-tuned R/G/B/Bias matrix from §5 |
| hue | `HslAdjustment` (hueAdjustmentDegrees) |
| blur (gaussian) | Two-pass separable shader; `RenderEffect.createBlurEffect` for static cases |
| sharpen | Unsharp mask shader |
| vignette | Port `openreelVignette` GLSL |
| grain | Port `openreelGrain` GLSL (identical hash function) |
| chromaticAberration | Port `openreelChromaticAberration` GLSL |
| bloom | Threshold + Gaussian + additive blend in a 2-pass `GlEffect` |
| pixelate | UV quantize shader |
| motionBlur | Directional blur shader (N taps) |
| dissolve | Alpha multiply in shader |
| disintegrate | Noise-keyed alpha threshold + shadow; custom shader |
| stabilize | Affine on GLES vertex; tracking via `MotionDataSource` or precomputed paths |
| motionTrack/faceTrack/objectTrack/bodyPose | ML Kit feature detectors, exported as `TrackingPath` (no visual effect) |
| backgroundRemoval | ML Kit Selfie Segmentation |
| subjectBlur / subjectGlow | Segmentation mask + Gaussian blur composited |
| faceBeauty | ML Kit face detection + denoise + soft sharpen + temperature; mask blend by face bbox |
| autoReframe | Tracking + crop matrix on draw |
| colorWheels | Custom shader: lift+gamma+gain |
| curves | Bake to 3D texture (32³) the same way iOS does — port the cube data writer |
| hsl | Bake to 3D texture using identical HSL/RGB conversion |
| lut | `GL_TEXTURE_3D` with trilinear sampling, cached by `(path,checksum)` |
| filterPreset / colorAdjust (legacy) | Compound shader = contrast+sat+temperature(+beauty for colorAdjust) |
| chromaticAberration | (see above) |
| Transitions: crossfade, dipToBlack/White, wipe, slide, push, zoom, blurDissolve, iris, spin, glitch, pixelate, lumaFade | Per-transition fragment shader; dispatcher mirrors `TransitionCatalog.sanitizedType`. |

### LUT Libraries (Android)
- Roll-your-own with `GLES30.glTexImage3D` — recommended; it's <100 lines and matches iOS exactly.
- `jp.co.cyberagent.android:gpuimage:2.x` has `GPUImage3DLookupFilter` (1D atlas LUT; less precise than 3D texture).
- Avoid bitmap-strip "HALD" LUTs unless you also support them in iOS (Openreel does not).

### Color Space
- Match iOS exactly: linearize sRGB → operate → encode back to sRGB. Use `GL_FRAMEBUFFER_SRGB` extension or do gamma manually with `pow(rgb, 2.2)` / `pow(rgb, 1/2.2)`.
- BT.709 luma coefficients (0.2126, 0.7152, 0.0722) are non-negotiable for scopes and luma-keyed transitions.
- HDR is unsupported on iOS today; do not introduce it on Android without parity work.

### Frame Pump Timing
- Match iOS's behavior: scopes recomputed every 8 frames; AI context debounced per `frameIndex = round(sourceTime * frameRate)`. Use Kotlin coroutines with `Dispatchers.Default` (utility-priority equivalent) and cancel on parameter changes.

### Project Directory Resolution
- iOS resolves LUT paths against `projectDirectoryURL`. Android must mirror this: resolve `effect.params["path"]` against the project's app-private storage directory (not the LUT's absolute path).

---

### File Index
- `Openreel Video/Openreel Video/Core/Playback/PlaybackController.swift`
- `Openreel Video/Openreel Video/Core/Playback/PlaybackCompositionBuilder.swift`
- `Openreel Video/Openreel Video/Core/Rendering/VideoEffectRenderer.swift`
- `Openreel Video/Openreel Video/Core/Rendering/CustomEffectKernels.swift`
- `Openreel Video/Openreel Video/Core/Rendering/StillImageEffectRenderer.swift`
- `Openreel Video/Openreel Video/Core/Rendering/TransitionCompositor.swift`
- `Openreel Video/Openreel Video/Core/Rendering/ColorScopesEngine.swift`
- `Openreel Video/Openreel Video/Core/Effects/CubeLUTParser.swift`
- `Openreel Video/Openreel Video/Core/Effects/EffectParameterCodec.swift`
- `Openreel Video/Openreel Video/Core/Effects/VideoEffectTypes.swift`
- `Openreel Video/Openreel Video/Features/Preview/MetalVideoView.swift`
- `Openreel Video/Openreel Video/Features/Preview/EffectImageView.swift`
