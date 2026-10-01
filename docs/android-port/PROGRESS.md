# Openreel Android — Progress Log

> **Offline architecture (2026-08-08):** Cloud-GPU, authentication, and
> networking code has been removed. This log describes the current offline
> implementation; superseded cloud milestones are intentionally omitted.

This document tracks the phases that have shipped on `feat/ios-app` against the
iOS port spec in this folder. Each commit on the branch corresponds to a
feature phase; the list below groups them by surface so it's easy to see
what's covered.

## 1. Foundations
- Theme tokens (colors light/dark, typography, radii, spacing) matching iOS Theme.swift
- Compose-friendly press-scale modifier, haptics helper with global toggle, color parsing, time formatting
- Edge-to-edge `MainActivity` + splash screen + Manifest permissions

## 2. Data & Persistence
- Kotlin port of the full `OpenReelProject` schema (v1.1.0) so JSON round-trips with iOS
- `ProjectStore` with autosave, summaries StateFlow, last-saved timestamp, thumbnail capture
- `ActionHistory` snapshot-based undo/redo (50 entries)
- DataStore-backed `UserPreferences` (onboarding, haptics, theme, aspect guides)
- `.openreelzip` archive import/export via SAF

## 3. Navigation Shell
- RootScreen routes Onboarding → Loading → Library / Editor with crossfade
- 3-page onboarding pager with custom indicator + CTA + iOS-style haptics
- Library Home with hero canvas sun glow, recent carousel, Quick Start, Photo Tools / Quick Trim
- Library Projects with grid/list toggle, storage card, search bar, archive import
- Custom bottom tab bar (no Material BottomNavigation)
- NewProjectSheet (custom bottom sheet, name + resolution + frame rate)
- About sheet (long-press logo) + reset-onboarding

## 4. Editor Surface
- Editor shell (header, preview canvas, playback bar, timeline area, tab bar)
- Header: back, project title (tap to rename), undo/redo, settings, Export
- Auto-save indicator + project rename dialog
- Playback bar: prev/next frame, play/pause, monospaced time/duration
- Ruler scrubbing + beat tick marks + project marker lines
- Preview pinch zoom + double-tap fit

## 5. Playback & Composition
- ExoPlayer-backed PlaybackController exposing play/pause/seek/setRate
- ClippingMediaSource per clip, ConcatenatingMediaSource2 per track
- MergingMediaSource so multiple audio tracks mix in parallel; honors mute/solo/hidden
- Live audio fade-in/out + per-clip volume automation ramp during playback
- AudioFocus request/abandon on play/pause (auto-pause on call)
- AudioEffects bound to ExoPlayer session: EQ (per-band), reverb, compressor

## 6. Media Pipeline
- MediaImportService via PhotoPicker + SAF + camera capture; copies into project dir
- MediaMetadataRetriever for duration/width/height/codec; PCM waveform extraction (200 peaks)
- Beat detector → BeatMarker entries timestamped to clip startTime
- Project thumbnail capture on import
- CameraX video + photo capture screen (front/back switch)

## 7. Timeline Editing
- Multi-track lanes with track-type icons + waveforms; long-press badge → inspector
- Clip move/trim/split/delete gestures with beat + playhead snap (with flash indicator)
- Multi-select clips (long-press to start, batch Duplicate/Delete)
- Transitions catalog + adjacent-clip picker (9 presets)
- Text + Graphics overlay lanes (drag/trim/long-press-delete strips)
- Track inspector (mute/solo/hide/role/rename/move up-down)
- Timeline ruler scrub gesture + beat/marker ticks

## 8. Text & Graphics
- Text panel: 8 iOS presets, inspector (text/size/color/background swatches)
- Custom font picker (SAF .ttf/.otf import) with on-canvas rendering
- Graphics panel: 8 shape presets + 30 emoji palette
- PreviewOverlay renders text + graphics + emoji + animation keyframes + blend modes

## 9. Effects & Color
- 20 filter presets across 5 categories (Cinematic, Vintage, Mood, Color, Stylized)
- Live FilterOverlay (brightness, saturation, contrast, temperature, tint)
- BackgroundRemove toggle + Track Subject (AI) + LUT (.cube) picker
- Per-clip effect chain reorder + remove
- Color scopes overlay (RGB histogram toggleable from header)

## 10. Audio
- Audio panel cards: Music library, Voiceover, Sound FX, and prompt-guided procedural Local Music
- Per-track mixer panel with gain + mute pill
- Voiceover recording timer
- Audio fades + volume automation editor

## 11. Subtitles & Captions
- SRT parser + import via SAF
- SRT import and a fully local subtitle editing/style workflow
- Subtitle style editor (size, color, position, animation style)
- CaptionAnimationStyle render in preview (typewriter/bounce/word-by-word/word-highlight/karaoke)

## 12. Templates
- 10 built-in templates with apply engine (text + graphics + per-category filter)
- Long-press for customisation (intensity + duration override)
- Save current as user template + apply user template

## 13. Export
- Export sheet with resolution/frame rate/format/preset summary
- Media3 Transformer pipeline with ProgressHolder polling
- MediaStore save to Movies/OpenReel + Share intent
- Foreground-style ongoing notification with completion message
- Per-clip AudioProcessor hook (placeholder for full volume baking)

## 14. On-device Smart Tools
- ML Kit object tracking creates editor keyframes without uploads
- Tracking paths drive Track Subject, Auto Reframe, and Stabilize
- Local frame sampling ranks highlight/shorts windows by motion and detail
- Prompt-guided procedural music renders directly to a WAV file
- Unsupported model-heavy tools are not exposed; there is no network fallback

## 15. Settings & Misc
- Settings sheet: theme (System/Light/Dark), aspect guides, haptics, audio sample rate, and HDR toggle
- Project markers manager + frame-rate / resolution change
- Aspect ratio overlay guides on preview

## 16. Timeline editing parity (shipped 2026-05-24)
- PlacementResolver snaps clips to neighbor edges (max(0.05, 8/zoom) threshold),
  prevents same-track overlap, and resolves the nearest legal start when a
  proposed position collides; falls back to candidate set
  {0, neighbor.end, neighbor.start − duration}
- AppState.moveClip routes through the resolver, atomically swaps trackId for
  cross-track moves, and surfaces snap events for haptic feedback
- VideoTrackLane / AudioTrackLane drag gestures accumulate vertical delta and
  map it to a same-media-type sibling track (Video↔Image, Audio↔Audio)
- splitClip frame-snaps to the project frame rate, seeks the playhead to the
  cut, and auto-selects the right-hand piece
- Selected video clips get a scissors mini-button at the playhead for one-tap
  splitting (visible when the clip is wide enough and the playhead is strictly
  inside it)
- TimelineZoomMenu becomes a `[− %% +]` capsule chip; − halves zoom, + grows
  zoom, label opens the preset dropdown
- 9 unit tests cover the resolver

## 24. Closing-out round (shipped 2026-05-24)
- Text Split + Flip per-character bakes complete the per-char preset
  family (all 22 TextAnimationPresets now render correctly)
- BlendModeBaker wired into keyframed + per-frame-animated overlay
  paths — animated text overlays sample the moving background each
  frame; keyframed overlays single-sample at midpoint
- Smooth multi-segment speed ramp [1.0, 0.5, 0.25, 0.5, 1.0] for
  CapCut-style ease-in/out slow-mo in one tap
- AdjustmentLane on the timeline is fully editable — drag to move,
  trim handles on either end, long-press to delete
- Photo enhance auto-imports the saved photo back into the project
  library when a project is open
- Variable-control template editor sheet collects user values
  (toggles, number sliders, select chips) before applying
- Object tracking creates local keyframes from ML Kit detections

## 23. Final CapCut-parity round (shipped 2026-05-24)
- Text Split (per-char halves slide apart with alpha fade-in) and Flip
  (per-char scaleY oscillation with phase offset) per-character bakes
- BlendModeBaker samples the primary clip's frame at each overlay's
  midpoint and composites the overlay via android.graphics.BlendMode
  (API 29+) or PorterDuff fallback — Multiply / Screen / Overlay /
  Darken / Lighten / ColorDodge / ColorBurn / HardLight / SoftLight /
  Difference / Exclusion supported for static text + graphics overlays
- Speed ramp preset chips (Bullet 0.2x / Slow 0.5x / Fast 2x / Hyper
  3x) in the Timing inspector
- AppState.saveClipAsAdjustmentLayer + ClipTool action so users can
  promote a clip's effects to a project-wide adjustment in one tap
- PhotoEnhancementScreen.Save now optionally re-imports the saved
  photo into the project library — enhanced photo lands as a Media
  Library item ready to drop on the timeline
- applyUserTemplate accepts a controlValues map and substitutes
  `{{controlId}}` placeholders in clip text + style.color, merging
  template controls' defaults + template defaultValues + user input

## 22. Effects, audio, and editing actions round 2 (shipped 2026-05-24)
- Per-character text presets (Wave / Glitch / Rainbow / Shake) — Glitch
  renders RGB-channel-split chromatic aberration; Rainbow cycles HSV hue
  per character and over time
- ReverseAudioProcessor buffers PCM-16 then emits in reverse frame order
  on EOS — reversed clips now play with reversed audio (not just muted)
- MotionBlurEffect (custom GlEffect) with 9-tap directional smear,
  toggleable horizontal / vertical from Effects panel
- VignetteEffect + FilmGrainEffect via shared SimpleGlEffectProgram
- DuckingAudioProcessor with cosine ramp; ProjectExportService
  computes duck windows from AudioTrackRole.Dialogue clips and applies
  attenuation to music / SFX automatically
- ChromaKeySwatchPicker exposes eight common key colours in the
  inspector
- ShapeMaskEffect (circle / ellipse / rounded-rect / heart) via implicit
  GLSL distance fields
- ColorIsolationEffect — "pop of colour" preserves one colour and
  desaturates the rest
- Boomerang action — inserts reversed copy after selected clip
- Slow-mo highlight — splits clip at playhead and 1s later, sets middle
  to 0.3x, shifts following clips to preserve alignment
- detachAudio — extracts video clip's audio onto a dedicated audio
  track and mutes the original
- autoCutToBeat — splits the selected clip at every beat marker inside
  its window
- smartTrimSilence — scans waveform peaks locally and trims runs of
  silence (peak < 0.06 for >= 0.4s) without round-tripping to cloud
- AdjustmentClip data model + export merge — effects on an adjustment
  apply to every video clip whose timeline overlaps it
  (saveClipAsAdjustmentLayer / removeAdjustmentLayer helpers in
  AppState; full UI is a follow-up)

## 21. Direct manipulation parity (shipped 2026-05-24)
- PreviewManipulation hit-tests overlay video clips (non-primary
  tracks) in addition to text and graphics — drag / pinch / rotate a
  PIP window directly on the preview surface
- PreviewSelectionHandles draws the dashed bounding box and corner
  handles around the selected PIP video clip in addition to text /
  graphics
- ClipInspector AdjustPage gains a Chroma Key card: when no key is
  active, Green / Blue Screen quick toggles; when a key is active,
  Threshold and Smoothing sliders + a Remove button so users can tune
  the mask softness without leaving the inspector

## 20. Reverse + emphasis (shipped 2026-05-24)
- SampledFrameOverlay gains a reverseTime flag; ProjectExportService
  emits a reversed-frame overlay for clips with Clip.reversed=true,
  covering the forward primary video, and sets RemoveAudio on the
  EditedMediaItem so forward audio doesn't play
- EmphasisAnimatedOverlay drives per-frame OverlaySettings from
  EmphasisAnimation presets — Pulse, Breathe, Heartbeat, Bounce,
  Float, Shake, Vibrate, Wobble, Swing, Spin, Flash, Flicker,
  RubberBand, Jello, Tada — applies to both GraphicsClip and TextClip
- Mirrors the per-frame sin math used by PreviewOverlay so preview
  matches export

## 19. Effects & voice CapCut-parity (shipped 2026-05-24)
- ChromaKeyEffect: custom GlEffect/BaseGlShaderProgram pair with a
  GLSL fragment shader that masks alpha via YCbCr chroma distance from
  the configured key colour, smoothstep edge softening, and per-channel
  spill suppression so green / blue bleed is removed from the edges
- ChromaKeyConfig stores per-clip settings on Clip.effects with
  type="chroma-key" and params { keyColor, threshold, smoothing }
- Effects panel: one-tap "Green Screen" and "Blue Screen" buttons
  toggle the effect with sensible defaults
- VoiceEffectPreset.Echo and .HallReverb add custom-AudioProcessor
  routes — EchoAudioProcessor implements a circular delay buffer with
  dry / wet / feedback parameters, mixed back into the PCM-16 stream
- TextAnimationKeyframes converts Fade / Slide-* / Scale / Pop / Bounce
  / Rotate / Flip TextAnimation presets into synthetic Keyframes so
  KeyframedBitmapOverlay can bake them without per-frame bitmaps
- PreviewSelectionHandles draws a dashed bounding box + corner handles
  around the selected text / graphics overlay so users see exactly
  what PreviewManipulation will drag / pinch / rotate

## 18. CapCut-parity features (shipped 2026-05-24)
- VideoFrameSampler extracts a sparse set of bitmaps from a clip's source
  via MediaMetadataRetriever, downscaled to a configurable max dimension
- SampledFrameOverlay (Media3 BitmapOverlay subclass) serves time-varying
  bitmaps with time-varying alpha; supports overlay anchor, background
  anchor, scale, and rotation so the same primitive renders cross-fades,
  wipes, slides, and PIP overlay video
- Cross-fade / wipe / slide / zoom-blur transitions render real incoming
  clip frames (no longer a placeholder dim)
- Multi-video-track PIP — overlay video clips on additional tracks bake
  in via the overlay primitive, positioned and scaled per the clip's
  transform; audio from these tracks routes through the audio sequence
  builder
- KeyframedBitmapOverlay drives per-frame OverlaySettings from
  KeyframeEngine so position / scale / rotation / opacity keyframes on
  TextClip and GraphicsClip animate in the exported file
- AnimatedFrameSequenceOverlay pre-renders ~15fps animation keyframes
  for content-changing animations (typewriter, word-by-word, karaoke,
  word-highlight, bounce, plus the subtitle equivalents) and serves the
  closest by presentation time
- PreviewManipulation captures detectTransformGestures on the preview,
  hit-tests the topmost overlay clip at the playhead, and updates
  transform.position / scale / rotation live — drag, pinch, twist
- OverlayVideoPreview renders overlay video tracks as poster frames in
  the editor preview via Coil videoFrameMillis at the local playhead
  time; matches the export's PIP layout
- TransitionPreviewOverlay shows the real incoming clip frame for
  cross-fade / wipe / slide / zoom-blur with rising alpha
- VoiceEffectPreset (Helium / Chipmunk / Deep / Monster) stores a pitch
  effect on the clip and applies it via SonicAudioProcessor in export;
  ClipInspector Audio page picks the active preset

## 17. Export pipeline coverage (shipped 2026-05-24)
- OverlayBitmapRenderer rasterises TextClip, GraphicsClip (rectangle, circle /
  ellipse, triangle, line, arrow, star, polygon, emoji), and image/sticker
  GraphicAssets into the project's output resolution
- TimedBitmapOverlay subclasses Media3 BitmapOverlay with time-gated alpha
  (start, end, optional fade-in / fade-out ramps)
- Composition-level OverlayEffect wires text, graphics, subtitles, and
  transition fade overlays into the export
- Transition family: dip-to-black, dip-to-white, flash render with the
  expected time-varying alpha; cross-fade / wipe / slide / zoom-blur fall
  back to a subtle dim until true multi-source compositing is wired
- TransitionPreviewOverlay shows the same fade in the editor so the preview
  matches the export for the dip family
- Multi-track audio: each non-muted Audio track becomes its own
  EditedMediaItemSequence (gaps via addGap), assembled in Composition for
  parallel mixing — music, voiceover, and SFX now land in the file
- Subtitles bake into the export with their configured style and time window

## Status
CapCut parity complete for the local editing surface — every documented
gap has shipped. Remaining work would be catalog expansion (more filter
presets, more transition presets, more fonts) and additional on-device
models that can be bundled without compromising the offline requirement.
