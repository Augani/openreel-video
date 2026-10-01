# Android Trim + Crop Parity — Design Spec

**Date:** 2026-05-28
**Status:** Pending spec review
**Scope:** Android app only (`Openreel Video Android/...`). iOS counterpart shipped on the same day under `docs/superpowers/specs/2026-05-28-ios-trim-and-crop-design.md`.

## 1. Problem statement

Two related sets of issues bring Android behind the freshly-shipped iOS experience:

1. **Trim quality + feature gaps.** Video clips only support trailing-edge trim (no leading-edge); audio clips have decorative trim handles with no gesture; every drag event mutates the project state, producing a fresh undo entry per frame; there's no snap feedback. The trim drags feel jittery and litter the undo stack.
2. **Crop editor has feature gaps vs iOS.** Android's `CropResizeScreen` is sophisticated (8 handles, aspect-ratio strip, rotation slider, position scrubber, rule-of-thirds grid, outside-dim) — but it's missing four things iOS now has: aspect-ratio LOCK during handle drags (Android only snaps on tap), Flip H / Flip V, Fit mode chips (Contain / Cover / Stretch / None), and pinch-to-zoom with centroid stability on the media backdrop.

## 2. Goals & non-goals

**Goals**

- All trim drags use snapshot-based drag math: capture initial duration on `onDragStart`, accumulate the cumulative delta locally, commit ONCE on `onDragEnd`. Result: a single undo entry per drag, no per-frame state churn.
- Video clips gain a leading-edge trim handle that adjusts `startTime + inPoint` (in addition to the existing trailing handle).
- Audio clips gain both leading + trailing trim gestures (handles are currently decorative).
- Snap-to-neighbor edges produces a visible indicator and a light haptic; matches the iOS pattern.
- `CropResizeScreen` gains aspect-lock-during-drag, Flip H/V row, Fit chips row, and pinch-to-zoom (1x–6x) with centroid stability.
- Android keeps its existing rotation slider and position scrubber — iOS does not have these, and removing them would be a regression for Android users.

**Non-goals**

- Adding rotation or position scrubber to iOS (different spec).
- Refactoring the Android editor screen layout. Touch only the affected components.
- Migrating the existing trim/crop tests or adding new instrumentation tests. The existing test suite stays green; manual smoke covers the gesture changes.
- Cross-platform timeline-correctness work — this is purely a UX polish + feature-parity pass.
- Audio crop or audio waveform editing in this iteration.

## 3. User-visible behavior summary

| Interaction | Today | After |
|---|---|---|
| Drag trailing trim handle on video clip | Mutates clip every frame → 20+ undo entries per drag | Snapshot-based: single undo entry, smooth motion |
| Drag leading edge of video clip | Not possible (no gesture wired) | Drag handle appears at left edge; updates `startTime + inPoint` |
| Drag any trim handle on an audio clip | Visual handle but no response | Functional like video clips: leading + trailing trim with snapshot drag |
| Snap to neighbor edge while trimming | Silent | Vertical accent line at snap edge + soft haptic |
| Tap aspect chip in CropResizeScreen | Snaps crop to that ratio | Same — also locks subsequent handle drags to that ratio (tap "Custom" to unlock) |
| Flip H / Flip V in CropResizeScreen | Not available in this screen | New action chips next to Reset |
| Fit mode (Contain/Cover/Stretch/None) | Not exposed in CropResizeScreen | New chip row above Aspect ratio strip |
| Pinch on the crop preview backdrop | No-op | Zooms backdrop 1x–6x; the pinched point stays under the user's fingers (centroid stable) |
| Rotation slider, position scrubber | Already present | Unchanged |

## 4. Workstream A — Android trim polish

### 4.1 Snapshot-based drag pattern

Today's pattern (every clip type that has trim):

```kotlin
.pointerInput(clip.id, pixelsPerSecond) {
    detectDragGestures { _, dragAmount ->
        val deltaDp = with(density) { dragAmount.x.toDp().value }
        onTrimEnd(clip, (deltaDp / pixelsPerSecond).toDouble())
    }
}
```

`dragAmount` is per-event, so each event calls `onTrimEnd` with a small partial delta. `onTrimEnd` mutates the clip immediately, producing one undo step per event and recomposing on every frame.

After:

```kotlin
.pointerInput(clip.id, pixelsPerSecond) {
    var accumulatedDp = 0f
    detectDragGestures(
        onDragStart = { accumulatedDp = 0f; onTrimDragStart() },
        onDragEnd = {
            val seconds = (accumulatedDp / pixelsPerSecond).toDouble()
            if (kotlin.math.abs(seconds) > 0.001) onTrimEndCommit(clip, seconds)
            onTrimDragEnd()
        },
        onDragCancel = { onTrimDragEnd() },
    ) { _, dragAmount ->
        val deltaDp = with(density) { dragAmount.x.toDp().value }
        accumulatedDp += deltaDp
        onTrimPreview(clip, (accumulatedDp / pixelsPerSecond).toDouble())
    }
}
```

- `onTrimPreview(clip, seconds)` updates LOCAL state — purely visual. No `appState.mutateClip` call.
- `onTrimEndCommit(clip, seconds)` is the existing `onTrimEnd` semantic, called ONCE on release.
- `onTrimDragStart / End` flip an `isDraggingTimelineItem` flag so the parent suppresses unrelated gestures while a trim is in progress (same flag already used by `onDragInteraction`).

The local preview state lives in the clip block. The clip block already gets `clip` re-passed when state mutates; during a drag, parent state is stable (no `mutateClip` calls) so the local `accumulatedDp` is the only thing changing. The block renders its width as `(clip.duration + accumulatedDp/pixelsPerSecond) * pixelsPerSecond`. On release, the commit happens and `accumulatedDp` resets via the `key` change on `pointerInput(clip.id, pixelsPerSecond)`.

### 4.2 Leading-edge trim on video clips

Today's video clip in `Timeline.kt` line 1018 renders the leading `TrimHandle` decoratively. After: wrap it in a `Box` with `.pointerInput { detectDragGestures(...) }` mirroring the trailing handle's wrapper, but emitting `onTrimStart(clip, delta)` (analogous to existing graphics/text overlay `onTrimStart` callbacks).

A new `appState.trimVideoClipStart(trackId, clipId, deltaSeconds)` operation:
- Reduces `clip.startTime` by `delta` while increasing `clip.inPoint` by `delta` (keep source frame the user sees).
- Clamps so `startTime ≥ 0` and `duration ≥ 0.05`.

While the leading handle is dragged, the clip's left edge visually follows the finger via the same snapshot-based pattern: local `accumulatedDp` shifts the visual `xOffset` and shrinks the visual width.

### 4.3 Audio clip trim

`AudioTrackLane` in `Timeline.kt` line 1132 currently has the same `TrimHandle` visuals but no gestures. Wrap each in a Box with the snapshot-drag pattern, emitting `onTrimStart` and `onTrimEnd` callbacks on `AudioTrackLane`.

New `appState.trimAudioClipStart` / `appState.trimAudioClipEnd` operations that mutate the audio clip's start/duration (same shape as video's trim methods).

### 4.4 Snap indicator + haptic

The existing `appState.snapEdit(seconds)` returns a possibly-snapped time. During a trim drag's `onDragEnd` (commit), if the snapped value differs from the proposed value by more than 1ms, we already snap — but the user has no signal.

Add to the snapshot drag's `onDragEnd`:
- After computing `final = appState.snapEdit(...)`, compare against the raw target; if snapped, emit a soft haptic via the existing `rememberHaptics().perform(HapticEvent.Light)`.

A visual snap line (1dp vertical accent strip at the snap x-coordinate) during the drag — show via local state when the in-progress accumulated delta would land within the snap window. This requires calling `snapEdit` continuously during the drag without committing it. Render the indicator as an overlay in the parent track lane.

### 4.5 Text + graphics + adjustment trim

These already have leading + trailing trim via `onTrimStart` / `onTrimEnd`, but they use the same per-event commit pattern. Convert each to snapshot-based drag (steps 4.1) so they get the single-undo-step + snap haptic benefits.

## 5. Workstream B — Crop editor parity

### 5.1 Aspect-ratio LOCK during drag

Today's `CropResizeScreen` lets the user tap "9:16" → crop frame snaps to 9:16 once. Subsequent corner/edge drags use `resizeCrop(...)` which does NOT preserve the ratio.

Add:
- `var lockedAspect by remember(clip.id) { mutableStateOf<Float?>(null) }` next to `draftCrop`.
- When the user taps an aspect option, set `lockedAspect = opt.ratio` (or `null` for Custom). Existing snap math stays.
- `resizeCrop(crop, handle, dx, dy)` (line 555) gains an optional `lockedAspect: Float?` parameter. When non-null:
  - For corner handles: compute the dominant axis (width-driven), set the other axis from `width = height * lockedAspect`, then re-anchor so the opposite corner stays in place.
  - For mid-edge handles: derive the perpendicular axis from the dragged axis to maintain the ratio, centered on the perpendicular midpoint.

Math is the same as iOS's `CropFrameGeometry.resize(..., lockedAspect:)` (the iOS implementation is the reference).

### 5.2 Flip H / Flip V chips

`OpenReelProject.Transform` already has `flipHorizontal: Boolean` and `flipVertical: Boolean` (per Android's existing model). Add two `@Composable` action chips to the body of `CropResizeScreen`, between the Aspect ratio section and the Reset button. Tapping toggles a local `draftFlipH` / `draftFlipV`. On Apply (the existing `onApply` callback), if changed, persist via `appState.mutateClip(...) { it.copy(transform = it.transform.copy(flipHorizontal = draftFlipH, flipVertical = draftFlipV)) }`.

The flip transform is applied to the `CropPreview`'s backdrop via `Modifier.graphicsLayer { scaleX = if (draftFlipH) -1f else 1f; scaleY = if (draftFlipV) -1f else 1f }` on the existing backdrop Box.

### 5.3 Fit mode chips

`OpenReelProject.Transform.fitMode: FitMode?` already exists. Add a chip row above the Aspect ratio strip: four chips for Contain / Cover / Stretch / None. Local `draftFitMode` initialized from `clip.transform.fitMode ?: FitMode.Contain`. On Apply, if changed, persist via `appState.mutateClip(...) { it.copy(transform = it.transform.copy(fitMode = draftFitMode)) }`.

Reset clears `draftFitMode = FitMode.Contain` (matches iOS default behavior).

### 5.4 Pinch-to-zoom with centroid

`CropPreview`'s backdrop (the `AndroidView`/`AsyncImage` inside the rotated `graphicsLayer` Box) gains a pinch gesture using Compose's `Modifier.pointerInput { detectTransformGestures { centroid, pan, zoom, rotation -> ... } }` — but we ignore `rotation` and `pan` and use `centroid` + `zoom`.

Local state:
- `var mediaScale by remember(clip.id) { mutableFloatStateOf(1f) }`
- `var mediaOffset by remember(clip.id) { mutableStateOf(Offset.Zero) }`
- `var pinchStartScale by remember(clip.id) { mutableFloatStateOf(1f) }`
- `var pinchStartOffset by remember(clip.id) { mutableStateOf(Offset.Zero) }`
- `var pinchStartCentroid by remember(clip.id) { mutableStateOf<Offset?>(null) }`

On gesture begin (first `detectTransformGestures` callback after a lift): capture pinchStartScale = mediaScale, pinchStartOffset = mediaOffset, pinchStartCentroid = centroid.

Each frame:
- `newScale = (pinchStartScale * accumulatedZoomFromStart).coerceIn(1f, 6f)`
- `dV = pinchStartCentroid - viewCenter`
- `m = newScale / pinchStartScale`
- `mediaOffset = dV * (1 - m) + pinchStartOffset * m`

Apply both: `Modifier.graphicsLayer { scaleX = ... * mediaScale; scaleY = ... * mediaScale; translationX = mediaOffset.x; translationY = mediaOffset.y }` on the backdrop only.

Reset also resets `mediaScale = 1f` and `mediaOffset = Offset.Zero`.

NOTE: `detectTransformGestures` doesn't give us a clean "gesture start" signal — we synthesize one by detecting that `pinchStartCentroid` is null and the user just started pinching (zoom != 1f or pan != Offset.Zero). On `onTouchEvent` lift / `awaitEachGesture` completion the centroid is cleared. Simpler alternative: use `awaitEachGesture { awaitFirstDown(); ...loop detectTransformGestures inline... }` to scope the gesture explicitly. Both work; pick whichever is cleaner to wire.

## 6. Testing

**Trim:**
- Manual: each clip type × each edge (leading + trailing) × confirm: smooth follow-the-finger, single undo entry per drag, snap haptic on neighbor edges, visible snap line.
- No new unit tests; the AppState mutation paths (`mutateClip`, `trimGraphicsOverlay*`, `resizeTextOverlay`, the new `trimVideoClipStart`, `trimAudioClipStart/End`) are simple wrappers around existing patterns.

**Crop:**
- Manual: open Crop for a photo + a video. Tap each aspect chip → frame snaps. Drag handles after locking → ratio preserved. Tap Flip H / Flip V → backdrop mirrors. Tap each Fit chip → state updates. Pinch on backdrop → zooms 1x–6x, pinch point stays anchored. Reset → all draft state restores to defaults; backdrop back to 1x, no flip, no fit.
- No new unit tests; the locked-aspect math mirrors iOS `CropFrameGeometry.resize(..., lockedAspect:)` which is unit-tested on iOS. Port to Android only if instrumented coverage gains warrant it (not in this iteration).

**Build:** `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` must stay green.

## 7. Open questions

None — the iOS spec resolves the design decisions; this is translation.

## 8. Implementation order

1. **Workstream A first (trim polish)** — 5 tasks. Each task adds the snapshot drag pattern to one clip type (video trailing first to establish the pattern, then video leading, audio, then text/graphics/adjustment polish). Snap indicator + haptic last.
2. **Workstream B second (crop parity)** — 4 tasks: aspect-lock, flip, fit, pinch.

Each ships as a separate commit. Manual smoke after each workstream.
