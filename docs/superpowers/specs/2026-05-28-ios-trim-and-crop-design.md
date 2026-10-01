# iOS Timeline Trim Flicker + Full-Screen Crop Editor — Design Spec

**Date:** 2026-05-28
**Status:** Pending spec review
**Scope:** iOS app only (`Openreel Video/Openreel Video/...`). Android parity is out of scope for this iteration.

## 1. Problem statement

Two unrelated but co-located issues degrade the iOS editing experience:

1. **Timeline trim handles flicker/jump horizontally during drag.** When the user drags either edge of a clip on the timeline to adjust duration, the clip visibly jitters or jumps sideways. This happens for video, audio, text, and graphics clips — all four block types share the same broken gesture stack.
2. **Photo cropping uses a weak slider-based bottom sheet.** Tapping the "Crop" tool opens `clipCropSheet` (a 420 pt sheet with Left/Top/Width/Height sliders). Sliders are the wrong control for spatial cropping — users can't see the result interactively and have no direct manipulation. This affects both photo and video cropping today; the user asked specifically for a screen-based experience.

## 2. Goals & non-goals

**Goals**

- Trim drag on every timeline clip type tracks the user's finger smoothly with no horizontal jitter, no mid-drag jumps, and no one-frame pop on release.
- The leading trim handle visually follows the finger (clip's left edge moves with the drag), matching iMovie / Final Cut / CapCut conventions.
- A new full-screen Crop editor is the entry point for the "Crop" tool, for both photos and videos.
- The Crop editor supports direct manipulation: draggable corner + edge handles, pan inside the frame, pinch to zoom, aspect-ratio presets, flip H/V, reset.
- Existing crop data model (`OpenReelProject.Crop` — normalized 0..1 coordinates) is reused unchanged.

**Non-goals**

- Rotation. No rotate-by-degrees control, no 90° quick rotation buttons. (Can be added later; explicitly out of scope here.)
- AI auto-reframe. The "Auto reframe" tool already exists separately and is not folded in.
- Per-frame scrubbing inside the Crop editor for videos. The editor uses the current playhead frame as the backdrop; users scrub from the timeline.
- A trim "mode" with enlarged handles or a source-frame scrubber. Trim stays as inline edge drag; only the flicker bugs are fixed.
- Android parity. iOS only this iteration.
- Refactoring `EditorView.swift` (6600 lines). Touch only the affected sections.

## 3. User-visible behavior summary

| Interaction | Today | After |
|---|---|---|
| Drag right edge of clip | Jitters; sometimes whole clip pops sideways if finger pauses | Smooth; trailing edge follows finger; no pop on release |
| Drag left edge of clip | Left edge stays put; clip shrinks from the right; reads as broken | Left edge follows finger; trailing edge stays put |
| Release after trim | Brief flash to original width before snapping to new width | Single frame: new width is shown immediately |
| Tap "Crop" tool | 420 pt bottom sheet with 4 sliders + Fit/Flip/Opacity | Full-screen editor with live preview, drag handles, aspect presets, flip, reset |
| Crop a photo | Same sheet as video (sliders) | Same full-screen editor as video |
| Adjust opacity / fit mode | In the crop sheet | Stays in the existing transform UI path (see §5.2) — not folded into the new Crop screen |

## 4. Workstream 1 — Timeline trim flicker fix

### 4.1 Root causes (verified by reading `EditorView.swift`)

The same three problems exist in all four clip-block structs: `TimelineClipBlock` (line 5485), `TimelineAudioClipBlock` (5816), `TimelineTextClipBlock` (5986), `TimelineGraphicsClipBlock` (6193).

**Cause A — `simultaneousGesture(moveGesture)` fires alongside the trim handle's drag.** The move gesture is `LongPressGesture(minimumDuration: 0.18).sequenced(before: DragGesture(minimumDistance: 1))`. While the trim handle has its own `DragGesture(minimumDistance: 1)` and starts immediately, if the user's finger pauses for 0.18 s mid-trim, the long press completes, the sequenced drag activates, `moveTranslation` starts updating, and the entire clip body is offset by `.offset(x: moveTranslation, ...)`. The visible result is a sudden horizontal jump.

**Cause B — Leading edge is anchored.** `liveClipWidth = clipWidth + trailingTrimOffset − leadingTrimOffset` shrinks the frame width during a leading trim, but there's no corresponding `.offset(x: leadingTrimOffset)` on the clip body. The clip is positioned in the parent via `.offset(x: clip.startTime * pixelsPerSecond)`, which doesn't move during drag. Net result: the left edge stays glued in place, and the clip shrinks from the right while the user is dragging the left handle. The user perceives this as the handle not tracking their finger.

**Cause C — One-frame pop on release.** `.onEnded` resets `leadingTrimOffset = 0` and `trailingTrimOffset = 0` synchronously, then fires `onTrim(edge, delta)` which schedules an async `Task` that calls `appState.trimClip(...)`. For one render frame, `liveClipWidth` is back to the original `clipWidth` (offsets are zero, duration hasn't updated yet). Then the project state catches up and the clip jumps to the new width.

### 4.2 Changes (apply identically to all four clip block types)

1. **Add `@State private var isTrimming: Bool = false`** alongside the existing `leadingTrimOffset` / `trailingTrimOffset` state.

2. **Suppress move gesture while trimming.** Change `.simultaneousGesture(moveGesture)` to `.gesture(moveGesture, including: isTrimming ? .subviews : .all)`. The `GestureMask.subviews` value means the gesture is active only on subviews of the body's gesture target, which effectively disables the move gesture on the clip body itself. Set `isTrimming = true` in the trim handle's `.onChanged` and `isTrimming = false` at the end of the trim flow (see step 4 below).

3. **Leading edge tracks finger.** Add `leadingTrimOffset` into the existing `.offset(...)` on the clip body:

   ```swift
   .offset(
       x: moveTranslation + leadingTrimOffset,
       y: moveVerticalTranslation
   )
   ```

   During a leading trim, `moveTranslation` is 0 (suppressed by step 2) and `leadingTrimOffset > 0`, so the clip visually slides right by `leadingTrimOffset` while its width shrinks by the same amount. Net effect: left edge follows the finger; right edge is stationary. During a trailing trim or a move, `leadingTrimOffset` stays 0 and behavior is unchanged.

4. **Eliminate the release pop.** Change the `onTrim` callback type from `(AppState.TrimEdge, TimeInterval) -> Void` to `(AppState.TrimEdge, TimeInterval) async -> Void`. In the trim handle's `.onEnded`:

   ```swift
   .onEnded { value in
       let delta = value.translation.width / max(pixelsPerSecond, 1)
       UIImpactFeedbackGenerator(style: .light).impactOccurred()
       Task { @MainActor in
           await onTrim(edge, delta)
           leadingTrimOffset = 0
           trailingTrimOffset = 0
           isTrimming = false
       }
   }
   ```

   The state update (clip.duration) completes before the offsets reset, so both happen in the same render pass — no pop. Update the four call sites in `visualTrackLane` and the audio/text/graphics equivalents to make the closure async (no other changes needed since they already wrap in `Task`).

### 4.3 What stays the same

- Min-drag-distance of 1 pt on the trim DragGesture.
- The `clipWidth − 44` clamp on `leadingTrimOffset` / `trailingTrimOffset`.
- The `UIImpactFeedbackGenerator(style: .light)` haptic on release.
- The scissors mini-button, the snap edge indicator, the move gesture itself.

### 4.4 Files touched

- `Openreel Video/Openreel Video/EditorView.swift` — four clip block structs (~25 lines changed across all four), and the four call sites in `visualTrackLane`-equivalents (closure becomes async).

No model, AppState, or storage changes.

## 5. Workstream 2 — Full-screen Crop editor

### 5.1 New view: `CropEditorView`

**Location:** `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift` (new folder, new file).

**Presentation:** Bound to a new `@State private var presentedCropEditor: PresentedCropEditor?` in `EditorView`, shown via `.fullScreenCover(item: $presentedCropEditor)`. Use `.fullScreenCover` (not `.sheet`) so the editor truly fills the screen — spatial cropping needs the room.

**Routing:** In `handleToolTap` (line 3369), the existing `case "Crop"` branches that currently set `activeEditingSheet = .crop` are changed to set `presentedCropEditor = PresentedCropEditor(clipID: selectedClipID)`. The `EditingSheet.crop` enum case and its `clipCropSheet` body (`EditorView.swift` lines 4445–4495 plus the `case .crop` branches in `editingSheet` and `editingSheetHeight`) are removed.

**Layout:**

```
┌──────────────────────────────────────────────┐
│ Cancel              Crop              Done    │  56 pt top bar
├──────────────────────────────────────────────┤
│                                              │
│        ┌──────────────────────────┐          │
│        │    ●──────●──────●       │          │  preview area
│        │    │              │      │          │  (flex, dark backdrop)
│        │    ●  live media  ●      │          │  crop frame + 8 handles
│        │    │              │      │          │
│        │    ●──────●──────●       │          │
│        └──────────────────────────┘          │
│                                              │
├──────────────────────────────────────────────┤
│  [Free] [1:1] [9:16] [16:9] [4:5] [4:3]      │  scrollable aspect chips
│                                              │
│  ↔ Flip H    ↕ Flip V         ↺ Reset        │  action row
└──────────────────────────────────────────────┘
```

**Aspect chip presets (final list):** Free, 1:1, 9:16, 16:9, 4:5, 4:3, 3:4. Locking an aspect snaps the current crop frame to that ratio centered on its current center, and constrains all subsequent handle drags to that ratio. Tapping `Free` unlocks.

**State (all `@State` local to `CropEditorView`):**

- `cropFrame: CGRect` — current frame in preview-view coords
- `lockedAspect: CGFloat?` — `nil` = Free, else width/height ratio
- `mediaScale: CGFloat` — 1.0 default; pinch updates this within `[1.0, 6.0]`
- `mediaOffset: CGSize` — pan applied to the media (for zoom)
- `flipH: Bool`, `flipV: Bool` — initialized from `clip.transform`

**Initialization:**

- Read `clip.transform.crop` (normalized) and convert to a `CGRect` in preview-view coords, given the media's aspect ratio and the available preview area.
- Read `clip.transform.flipHorizontal` / `flipVertical` into the flip state.

**Interactions:**

| Gesture | Effect |
|---|---|
| Drag a corner handle | Resize from that corner; if `lockedAspect != nil`, constrain to ratio (the moving edge picks the dominant axis) |
| Drag an edge midpoint handle | Resize one dimension (or both, if aspect-locked) |
| Drag inside the crop frame | Pan the frame within the media bounds; clamp to media edges |
| Pinch on media area | Scale `mediaScale` between 1.0 and 6.0; updates `mediaOffset` to keep the pinch centroid stable |
| Tap aspect chip | Animate `cropFrame` to the target ratio centered on its current center; set `lockedAspect` |
| Tap Flip H / Flip V | Toggle `flipH` / `flipV`; preview updates immediately |
| Tap Reset | `cropFrame` = full media bounds; `lockedAspect = nil`; `mediaScale = 1.0`; `mediaOffset = .zero`; `flipH = flipV = false` |
| Tap Cancel | Dismiss without applying |
| Tap Done | Convert `cropFrame` back to normalized coords and apply (see §5.4) |

**Handle hit area:** 44×44 pt invisible hit shape behind each 16×16 pt visible dot (corner handles) or 28×8 pt visible pill (edge handles). Same expanded-hit-area pattern as today's trim handle.

### 5.2 Backdrop for video vs photo

- **Photo:** Render the underlying `UIImage` from the clip's media URL via `AsyncImage` (or `Image(uiImage:)` if already loaded).
- **Video:** Render the frame at `playbackController.currentTime`. Reuse `MetalVideoSnapshotProvider.snapshot` (already exists per the FilterPicker integration at line 4506). The backdrop is a still image, not a live video — no playback in this screen.

The flip transform is applied to the backdrop only as a CSS-style visual flip (`.scaleEffect(x: flipH ? -1 : 1, y: flipV ? -1 : 1)`); the crop frame stays in screen orientation.

### 5.3 What this screen does **not** handle

- **Opacity** — stays in the existing transform UI (`clipOpacitySheet` is the current path; unchanged here).
- **Fit mode (Contain / Cover / Stretch / None)** — keep as is. Fit mode is a render-time setting that interacts with the canvas aspect ratio, not the spatial crop region. Adding it would muddy the Crop screen. The user can change Fit mode from the existing tool path.

This is a deliberate scope choice: the new screen does **spatial cropping + flip**, not "everything in the old sheet."

### 5.4 Data flow on Done

```
cropFrame (preview-view coords)
   │
   ▼ convert via media→preview transform
normalized Crop(x, y, width, height) ∈ [0,1]
   │
   ▼ call existing AppState API
appState.updateSelectedClipCrop(x:, y:, width:, height:)
   │
   ▼ if flips changed
appState.toggleSelectedClipFlip(horizontal: …)  / (vertical: …)
   │
   ▼
dismiss
```

`updateSelectedClipCrop` already exists in `AppState.swift` (it's what the current sliders call). No API changes.

### 5.5 What's reused, what's deleted

**Reused unchanged:**

- `OpenReelProject.Crop` model (normalized 0..1 coords).
- `appState.updateSelectedClipCrop(x:y:width:height:)`.
- `appState.toggleSelectedClipFlip(horizontal:)`.
- `appState.resetSelectedClipCrop`.
- `MetalVideoSnapshotProvider.snapshot` for the video backdrop.

**Deleted:**

- `clipCropSheet` body (EditorView.swift lines 4445–4495, ~50 LOC).
- `EditingSheet.crop` case + its branches in `editingSheet(_:)` and `editingSheetHeight(for:)`.

### 5.6 Files touched

- **New:** `Features/Crop/CropEditorView.swift` (estimated 450–550 LOC including the crop-frame gesture math).
- **New:** `Features/Crop/CropFrameGeometry.swift` — pure helper for converting between preview-view CGRect ↔ normalized Crop, plus aspect-locked corner-drag math. Pure functions; trivially unit-testable.
- **Modified:** `EditorView.swift` — remove the old sheet, add the `.fullScreenCover` route, update `handleToolTap` and the equivalent for the photo path.
- **Modified:** `EditorView.swift` `EditingSheet` enum — remove `.crop`.

No AppState changes, no model changes, no storage changes.

## 6. Testing

**Workstream 1 (trim flicker):**

- Manual: drag left handle right slowly, then pause for 1 s mid-drag, then continue. Clip must not jump. Repeat with right handle. Repeat for audio, text, graphics clips.
- Manual: drag left handle and watch the leading edge — it should track the finger to the pixel.
- Manual: release after trim — no width pop, single visible frame transitions to final width.
- Unit (optional, low value): the trim math itself is already covered by `appState.trimClip` tests; the changes don't touch that code path.

**Workstream 2 (crop editor):**

- Unit: `CropFrameGeometry` — round-trip a CGRect through normalize → denormalize and assert equality at 1e-6 tolerance. Aspect-lock math: drag corner with locked aspect produces a frame whose width/height ratio matches `lockedAspect`.
- Manual: open Crop for a photo, drag corners and edges, switch aspect presets, flip, reset, Done. Verify the saved crop renders correctly on the timeline preview and in export.
- Manual: open Crop for a video at a specific playhead time. Backdrop must show the frame at that time, not the first frame.
- Manual: cancel without applying — clip's transform must be unchanged.
- UI smoke: existing iOS UI smoke test stays green (launch + open Crop is enough; full interaction not required in smoke).

## 7. Open questions

None.

## 8. Implementation order

1. **Workstream 1 first** — small, safe, immediately improves a daily-friction interaction.
2. **Workstream 2 second** — larger surface, new file, but isolated and independent of Workstream 1.

These ship as separate PRs.
