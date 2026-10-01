# Android Trim + Crop Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Android trim + crop UX to par with the iOS work shipping on the same branch (`feat/ios-app`). See spec at `docs/superpowers/specs/2026-05-28-android-trim-and-crop-parity-design.md`.

**Architecture:** Two workstreams, distinct files, each task = one commit. Workstream A overhauls the trim gestures across `Timeline.kt` and adds two AppState methods. Workstream B extends the existing `CropResizeScreen.kt` with locked-aspect drag math, flip/fit chips, and pinch-with-centroid.

**Tech Stack:** Kotlin, Jetpack Compose (Material 3 + Foundation), `detectDragGestures`, `detectTransformGestures`, `awaitEachGesture`, kotlinx StateFlow for AppState observation.

**Build / test runner:** From `Openreel Video Android/`:

```bash
./gradlew assembleDebug
./gradlew testDebugUnitTest
```

The repo currently builds and ships APKs; the existing test suite must stay green.

**Branch:** Already on `feat/ios-app`. Commit per task with conventional-commit prefix shown in each step.

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt` | Snapshot drag pattern in video/audio/text/graphics/adjustment trim handles; new leading-edge video trim; new audio trim gestures; snap indicator overlay | Modify |
| `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt` | `trimVideoClipStart(trackId, clipId, deltaSeconds)`, `trimAudioClipStart`, `trimAudioClipEnd` | Modify |
| `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt` | `lockedAspect` state + parameter on `resizeCrop`; Flip H/V chips; Fit mode chip row; pinch-to-zoom with centroid math on the backdrop | Modify |

No new files. The work stays in three existing files.

---

# Workstream A — Trim polish

## Task A1: Snapshot drag pattern for video clip trailing trim

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt` (trailing trim handle around line 1019, `ClipBlock` signature where applicable)

- [ ] **Step 1: Locate the video clip block**

```bash
grep -n "private fun VideoClipBlock\|private fun ClipBlock\|fun VideoTrackLane" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt"
```

Find the block that contains the trailing trim handle at line ~1019–1031 (the `Box .align(Alignment.CenterEnd).fillMaxHeight().pointerInput(...) { detectDragGestures { _, dragAmount -> onTrimEnd(...) } }` pattern). Confirm its enclosing composable name.

- [ ] **Step 2: Replace the trailing trim handle's pointerInput with snapshot-based drag**

Find:

```kotlin
Box(
    modifier = Modifier
        .align(Alignment.CenterEnd)
        .fillMaxHeight()
        .pointerInput(clip.id, pixelsPerSecond) {
            detectDragGestures { _, dragAmount ->
                val deltaDp = with(density) { dragAmount.x.toDp().value }
                onTrimEnd(clip, (deltaDp / pixelsPerSecond).toDouble())
            }
        },
) {
    TrimHandle(modifier = Modifier.fillMaxHeight(), color = colors.accent)
}
```

Replace with:

```kotlin
var trailingAccumulatedDp by remember(clip.id, pixelsPerSecond) { mutableFloatStateOf(0f) }
Box(
    modifier = Modifier
        .align(Alignment.CenterEnd)
        .fillMaxHeight()
        .pointerInput(clip.id, pixelsPerSecond) {
            detectDragGestures(
                onDragStart = {
                    trailingAccumulatedDp = 0f
                    onDragInteraction(true)
                },
                onDragEnd = {
                    val deltaSeconds = (trailingAccumulatedDp / pixelsPerSecond).toDouble()
                    if (kotlin.math.abs(deltaSeconds) > 0.001) {
                        onTrimEnd(clip, deltaSeconds)
                    }
                    trailingAccumulatedDp = 0f
                    onDragInteraction(false)
                },
                onDragCancel = {
                    trailingAccumulatedDp = 0f
                    onDragInteraction(false)
                },
            ) { _, dragAmount ->
                val deltaDp = with(density) { dragAmount.x.toDp().value }
                trailingAccumulatedDp += deltaDp
            }
        },
) {
    TrimHandle(modifier = Modifier.fillMaxHeight(), color = colors.accent)
}
```

`trailingAccumulatedDp` lives in the composable's scope (above the `Box`). Its `remember(clip.id, pixelsPerSecond)` key resets when either changes — including after the drag commits and the clip's duration changes.

- [ ] **Step 3: Apply the accumulated delta to the visual width**

Find where the clip block's width is computed. There will be something like:

```kotlin
val widthDp = (clip.duration * pixelsPerSecond).toFloat().coerceAtLeast(32f)
```

Add the in-progress visual width below it:

```kotlin
val widthDp = (clip.duration * pixelsPerSecond).toFloat().coerceAtLeast(32f)
val visualWidthDp = (widthDp + trailingAccumulatedDp).coerceAtLeast(32f)
```

Replace the `Box(modifier = Modifier.width(widthDp.dp)...)` with `.width(visualWidthDp.dp)`. There's typically ONE such width on the outer Box of the clip block; check the surrounding code carefully.

If `widthDp` is used in multiple places (e.g., scissors button positioning, child sizing), only the OUTER clip-frame Box's width should use `visualWidthDp`. Interior elements that calculate positions from the clip duration should still use `widthDp`.

- [ ] **Step 4: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt"
git commit -m "feat(android): snapshot-based drag for video clip trailing trim

Replace per-event onTrimEnd with onDragStart/onDrag/onDragEnd pattern:
accumulate cumulative dp delta locally during the gesture, apply it
to the visual frame width so the user sees the result live, and
commit ONCE on release. Single undo entry per drag instead of 20+."
```

## Task A2: Add leading-edge trim to video clips

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt`
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt`

- [ ] **Step 1: Add `trimVideoClipStart` to AppState**

In `AppState.kt`, find a related method (e.g., `mutateClip` around line 2186 or `trimGraphicsOverlayStart` around line 4573 for a reference). Add a new method near the existing trim methods:

```kotlin
fun trimVideoClipStart(trackId: String, clipId: String, deltaSeconds: Double) {
    mutateClip(trackId, clipId, "Trim Clip Start") { clip ->
        val newStartTime = (clip.startTime + deltaSeconds).coerceAtLeast(0.0)
        val actualDelta = newStartTime - clip.startTime
        val newDuration = (clip.duration - actualDelta).coerceAtLeast(0.05)
        val newInPoint = (clip.inPoint + actualDelta).coerceAtLeast(0.0)
        clip.copy(
            startTime = newStartTime,
            duration = newDuration,
            inPoint = newInPoint,
        )
    }
}
```

This shifts the clip's leading edge right by `deltaSeconds`, advancing `inPoint` so the same source frame appears at the new leading edge. The clip's `outPoint` stays put — we're trimming material off the front.

- [ ] **Step 2: Wire the gesture to the leading TrimHandle in the video clip block**

In `Timeline.kt`, find the current leading handle around line 1018:

```kotlin
TrimHandle(modifier = Modifier.align(Alignment.CenterStart), color = colors.accent)
```

Replace with:

```kotlin
var leadingAccumulatedDp by remember(clip.id, pixelsPerSecond) { mutableFloatStateOf(0f) }
Box(
    modifier = Modifier
        .align(Alignment.CenterStart)
        .fillMaxHeight()
        .pointerInput(clip.id, pixelsPerSecond) {
            detectDragGestures(
                onDragStart = {
                    leadingAccumulatedDp = 0f
                    onDragInteraction(true)
                },
                onDragEnd = {
                    val deltaSeconds = (leadingAccumulatedDp / pixelsPerSecond).toDouble()
                    if (kotlin.math.abs(deltaSeconds) > 0.001) {
                        onTrimStart(clip, deltaSeconds)
                    }
                    leadingAccumulatedDp = 0f
                    onDragInteraction(false)
                },
                onDragCancel = {
                    leadingAccumulatedDp = 0f
                    onDragInteraction(false)
                },
            ) { _, dragAmount ->
                val deltaDp = with(density) { dragAmount.x.toDp().value }
                leadingAccumulatedDp += deltaDp
            }
        },
) {
    TrimHandle(modifier = Modifier.fillMaxHeight(), color = colors.accent)
}
```

You'll need a new `onTrimStart: (Clip, Double) -> Unit` parameter on the video clip block composable. Find its signature (search for `onTrimEnd: (Clip, Double) -> Unit` in the same file) and add `onTrimStart` next to it.

- [ ] **Step 3: Apply accumulated leading-edge offset visually**

The outer Box of the clip block uses `.offset(x = xOffset.dp)` and `.width(visualWidthDp.dp)`. With a leading trim:
- The visible LEFT edge should move right by `leadingAccumulatedDp` (so the user's finger drags the edge).
- The visible RIGHT edge should stay put.

Compute:

```kotlin
val xOffset = (clip.startTime * pixelsPerSecond).toFloat()
val widthDp = (clip.duration * pixelsPerSecond).toFloat().coerceAtLeast(32f)
val visualXOffset = (xOffset + leadingAccumulatedDp).coerceAtLeast(0f)
val visualWidthDp = (widthDp + trailingAccumulatedDp - leadingAccumulatedDp).coerceAtLeast(32f)
```

Use `visualXOffset.dp` and `visualWidthDp.dp` in the outer Box.

- [ ] **Step 4: Pass `onTrimStart` from the parent**

In `VideoTrackLane` (or wherever the video clip block is instantiated), find the `onTrimEnd = { clip, delta -> appState.mutateClip(...) }` block (around line 363). Add a sibling:

```kotlin
onTrimStart = { clip, delta ->
    appState.trimVideoClipStart(videoTrack.id, clip.id, delta)
},
```

- [ ] **Step 5: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt" \
        "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt"
git commit -m "feat(android): leading-edge trim for video clips

New AppState.trimVideoClipStart adjusts startTime + inPoint by the
delta and clamps to non-negative duration. Wire it from a new
Box+pointerInput on the leading TrimHandle, mirroring the trailing
handle's snapshot drag pattern. Leading edge follows the finger
during drag; right edge stays put."
```

## Task A3: Add trim gestures to audio clips

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt` (`AudioTrackLane` around line 1132)
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt`

- [ ] **Step 1: Add audio trim methods to AppState**

In `AppState.kt`, near `trimVideoClipStart`:

```kotlin
fun trimAudioClipStart(trackId: String, clipId: String, deltaSeconds: Double) {
    mutateClip(trackId, clipId, "Trim Audio Start") { clip ->
        val newStartTime = (clip.startTime + deltaSeconds).coerceAtLeast(0.0)
        val actualDelta = newStartTime - clip.startTime
        val newDuration = (clip.duration - actualDelta).coerceAtLeast(0.05)
        val newInPoint = (clip.inPoint + actualDelta).coerceAtLeast(0.0)
        clip.copy(
            startTime = newStartTime,
            duration = newDuration,
            inPoint = newInPoint,
        )
    }
}

fun trimAudioClipEnd(trackId: String, clipId: String, deltaSeconds: Double) {
    mutateClip(trackId, clipId, "Trim Audio End") { clip ->
        val newDuration = (clip.duration + deltaSeconds).coerceAtLeast(0.05)
        val snappedEnd = snapEdit(clip.startTime + newDuration)
        val finalDuration = (snappedEnd - clip.startTime).coerceAtLeast(0.05)
        clip.copy(duration = finalDuration, outPoint = clip.inPoint + finalDuration)
    }
}
```

- [ ] **Step 2: Replace the decorative audio TrimHandle calls with gesture-bearing wrappers**

In `Timeline.kt` line 1193–1195:

```kotlin
if (isSelected) {
    TrimHandle(modifier = Modifier.align(Alignment.CenterStart), color = colors.accent)
    TrimHandle(modifier = Modifier.align(Alignment.CenterEnd), color = colors.accent)
}
```

Replace the entire block with:

```kotlin
if (isSelected) {
    var audioLeadingAccumulatedDp by remember(clip.id, pixelsPerSecond) { mutableFloatStateOf(0f) }
    var audioTrailingAccumulatedDp by remember(clip.id, pixelsPerSecond) { mutableFloatStateOf(0f) }

    Box(
        modifier = Modifier
            .align(Alignment.CenterStart)
            .fillMaxHeight()
            .pointerInput(clip.id, pixelsPerSecond) {
                detectDragGestures(
                    onDragStart = {
                        audioLeadingAccumulatedDp = 0f
                        onDragInteraction(true)
                    },
                    onDragEnd = {
                        val deltaSeconds = (audioLeadingAccumulatedDp / pixelsPerSecond).toDouble()
                        if (kotlin.math.abs(deltaSeconds) > 0.001) {
                            onTrimStart(clip, deltaSeconds)
                        }
                        audioLeadingAccumulatedDp = 0f
                        onDragInteraction(false)
                    },
                    onDragCancel = {
                        audioLeadingAccumulatedDp = 0f
                        onDragInteraction(false)
                    },
                ) { _, dragAmount ->
                    val deltaDp = with(density) { dragAmount.x.toDp().value }
                    audioLeadingAccumulatedDp += deltaDp
                }
            },
    ) {
        TrimHandle(modifier = Modifier.fillMaxHeight(), color = colors.accent)
    }

    Box(
        modifier = Modifier
            .align(Alignment.CenterEnd)
            .fillMaxHeight()
            .pointerInput(clip.id, pixelsPerSecond) {
                detectDragGestures(
                    onDragStart = {
                        audioTrailingAccumulatedDp = 0f
                        onDragInteraction(true)
                    },
                    onDragEnd = {
                        val deltaSeconds = (audioTrailingAccumulatedDp / pixelsPerSecond).toDouble()
                        if (kotlin.math.abs(deltaSeconds) > 0.001) {
                            onTrimEnd(clip, deltaSeconds)
                        }
                        audioTrailingAccumulatedDp = 0f
                        onDragInteraction(false)
                    },
                    onDragCancel = {
                        audioTrailingAccumulatedDp = 0f
                        onDragInteraction(false)
                    },
                ) { _, dragAmount ->
                    val deltaDp = with(density) { dragAmount.x.toDp().value }
                    audioTrailingAccumulatedDp += deltaDp
                }
            },
    ) {
        TrimHandle(modifier = Modifier.fillMaxHeight(), color = colors.accent)
    }
}
```

Also update the outer audio clip Box's `xOffset` and `widthDp` calculations the same way as video clips:

```kotlin
val xOffset = (clip.startTime * pixelsPerSecond).toFloat()
val widthDp = (clip.duration * pixelsPerSecond).toFloat().coerceAtLeast(32f)
val visualXOffset = (xOffset + audioLeadingAccumulatedDp).coerceAtLeast(0f)
val visualWidthDp = (widthDp + audioTrailingAccumulatedDp - audioLeadingAccumulatedDp).coerceAtLeast(32f)
```

Note: the audio accumulator State must be hoisted ABOVE the Box that uses it, so the modifier chain sees the values. Move the `remember` declarations above the outer `Box(modifier = ...)` line.

- [ ] **Step 3: Add `onTrimStart` and `onTrimEnd` parameters to `AudioTrackLane`**

In the `AudioTrackLane` composable's signature (line 1132), add two new optional callbacks:

```kotlin
onTrimStart: (Clip, Double) -> Unit = { _, _ -> },
onTrimEnd: (Clip, Double) -> Unit = { _, _ -> },
```

Default no-ops keep existing call sites compiling.

- [ ] **Step 4: Wire the new callbacks from the parent**

In the `AudioTrackLane` call site (around line 379), add:

```kotlin
onTrimStart = { clip, delta ->
    appState.trimAudioClipStart(audioTrack.id, clip.id, delta)
},
onTrimEnd = { clip, delta ->
    appState.trimAudioClipEnd(audioTrack.id, clip.id, delta)
},
```

- [ ] **Step 5: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt" \
        "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/state/AppState.kt"
git commit -m "feat(android): trim handles for audio clips

Audio clips had decorative TrimHandle composables with no
gestures. Wire both edges with the same snapshot drag pattern as
video clips. New AppState.trimAudioClipStart adjusts
startTime + inPoint; trimAudioClipEnd resizes duration with snap."
```

## Task A4: Convert text + graphics + adjustment trim to snapshot drag

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt`

- [ ] **Step 1: Find each of the three lane composables**

```bash
grep -n "private fun TextLane\|private fun GraphicsLane\|private fun AdjustmentLane" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt"
```

You should see three matches. Note their line numbers.

- [ ] **Step 2: Convert each lane's leading + trailing trim to snapshot drag**

For EACH of the three lanes (TextLane, GraphicsLane, AdjustmentLane):
- Find the leading trim handle's `pointerInput { detectDragGestures { _, dragAmount -> onTrimStart(...) } }` and replace with the snapshot pattern (accumulate locally, commit on release).
- Same for the trailing trim handle's `onTrimEnd` block.
- Hoist the accumulator `remember` State above the Box that needs it.
- Update the outer clip Box's `xOffset` / `widthDp` to use `visualXOffset` / `visualWidthDp` based on the accumulators.

The mechanical pattern is identical to Task A1 (trailing) and Task A2 (leading) for video clips. Use those as the reference. Each lane composable typically takes `onTrimStart: (String, Double) -> Unit` / `onTrimEnd: (String, Double) -> Unit` callbacks where the `String` is the clip ID — preserve those.

- [ ] **Step 3: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt"
git commit -m "feat(android): snapshot drag for text/graphics/adjustment trim

Convert the per-event commit pattern in TextLane, GraphicsLane, and
AdjustmentLane to accumulate locally and commit once on release.
Single undo entry per drag, smooth visual feedback during the gesture.
Completes Workstream A — all trim drags across all clip types now
use the snapshot pattern."
```

## Task A5: Snap indicator + haptic

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt`

- [ ] **Step 1: Add light haptic on snap during commit**

In each of the 5 commit paths added in Tasks A1–A4 (video trailing, video leading, audio leading, audio trailing, text/graphics/adjustment), find the `onDragEnd` block where the commit happens. Add a haptic when the snapped result differs noticeably from the proposed result.

The video trailing handle's `onTrimEnd` is the cleanest illustration. In `VideoTrackLane`'s call site, the existing block already runs `snapEdit`:

```kotlin
onTrimEnd = { clip, delta ->
    appState.mutateClip(videoTrack.id, clip.id, "Trim Clip") {
        val newDuration = (it.duration + delta).coerceAtLeast(0.05)
        val snappedEnd = appState.snapEdit(it.startTime + newDuration)
        val finalDuration = (snappedEnd - it.startTime).coerceAtLeast(0.05)
        it.copy(duration = finalDuration, outPoint = it.inPoint + finalDuration)
    }
},
```

Change to:

```kotlin
onTrimEnd = { clip, delta ->
    val proposedEnd = clip.startTime + clip.duration + delta
    val snappedEnd = appState.snapEdit(proposedEnd)
    if (kotlin.math.abs(snappedEnd - proposedEnd) > 0.001) {
        haptics.perform(HapticEvent.Light)
    }
    appState.mutateClip(videoTrack.id, clip.id, "Trim Clip") {
        val newDuration = (it.duration + delta).coerceAtLeast(0.05)
        val finalDuration = (snappedEnd - it.startTime).coerceAtLeast(0.05)
        it.copy(duration = finalDuration, outPoint = it.inPoint + finalDuration)
    }
},
```

Use the existing `haptics` (`val haptics = rememberHaptics()` is already in scope in the editor screen). Apply the same pattern at every other trim commit site:
- `trimVideoClipStart` call site
- `trimAudioClipStart` and `trimAudioClipEnd` call sites
- `trimGraphicsOverlayStart` and `trimGraphicsOverlayEnd` call sites
- `trimAdjustmentLayer(..., fromEnd = true/false)` call sites
- `resizeTextOverlay` paths

Define a small helper at the top of `EditorScreen.kt` (or as a Composable extension) to keep the boilerplate down:

```kotlin
private fun emitSnapHapticIfSnapped(haptics: AppHaptics, raw: Double, snapped: Double) {
    if (kotlin.math.abs(snapped - raw) > 0.001) {
        haptics.perform(HapticEvent.Light)
    }
}
```

- [ ] **Step 2: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/Timeline.kt" \
        "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/EditorScreen.kt"
git commit -m "feat(android): snap haptic on trim release

Fire a light haptic on the trim commit when snapEdit moved the
target by more than 1ms. Matches the iOS snap-feedback pattern.
A visible snap indicator overlay during the drag is left as a
follow-up (would require continuous snapEdit polling)."
```

## Task A6: Workstream A verification

**Files:** none (verification only).

- [ ] **Step 1: Run the unit test suite**

```bash
cd "Openreel Video Android"
./gradlew testDebugUnitTest
```

Expected: same pass/fail state as before Workstream A — no regressions.

- [ ] **Step 2: Smoke checklist for the user**

Print the manual smoke checklist for trim:
- For each clip type (video, audio, text, graphics, adjustment) × each edge (leading, trailing):
  - Drag slowly — visual updates smoothly during the drag, no per-frame state churn.
  - Drag and release — single undo step lands in history.
  - Drag near a neighbor's edge — feel a light haptic when snap engages.

---

# Workstream B — Crop editor parity

## Task B1: Aspect-lock during handle drag

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt`

- [ ] **Step 1: Add `lockedAspect` state to `CropResizeScreen`**

Find the existing `var draftCrop by remember(clip.id) { mutableStateOf(...) }` line (around line 107). Below it, add:

```kotlin
var lockedAspect by remember(clip.id) { mutableStateOf<Float?>(null) }
```

- [ ] **Step 2: Update aspect chip taps to set the lock**

In the `AspectRatioOption` row (around line 229–246), modify:

```kotlin
AspectRatioOption(
    ratio = null,
    label = "Custom",
    selected = false,
    onClick = {
        draftCrop = Crop(0.0, 0.0, 1.0, 1.0)
    },
)
ASPECT_OPTIONS.forEach { opt ->
    AspectRatioOption(
        ratio = opt.ratio,
        label = opt.label,
        selected = aspectRatioMatches(draftCrop, opt.ratio),
        onClick = {
            draftCrop = cropForAspect(opt.ratio)
        },
    )
}
```

To:

```kotlin
AspectRatioOption(
    ratio = null,
    label = "Custom",
    selected = lockedAspect == null,
    onClick = {
        lockedAspect = null
    },
)
ASPECT_OPTIONS.forEach { opt ->
    AspectRatioOption(
        ratio = opt.ratio,
        label = opt.label,
        selected = lockedAspect == opt.ratio,
        onClick = {
            lockedAspect = opt.ratio
            draftCrop = snapCropToAspect(draftCrop, opt.ratio)
        },
    )
}
```

The "Custom" chip clears the lock. Aspect chips set the lock AND immediately re-snap the current draftCrop to that ratio.

- [ ] **Step 3: Add `snapCropToAspect` helper**

Near the existing `cropForAspect` helper, add:

```kotlin
private fun snapCropToAspect(crop: Crop, aspect: Float): Crop {
    val centerX = crop.x + crop.width / 2.0
    val centerY = crop.y + crop.height / 2.0
    var width = crop.width
    var height = (width / aspect).coerceIn(0.10, 1.0)
    if (height > crop.height) {
        height = crop.height
        width = (height * aspect).coerceIn(0.10, 1.0)
    }
    val newX = (centerX - width / 2.0).coerceIn(0.0, 1.0 - width)
    val newY = (centerY - height / 2.0).coerceIn(0.0, 1.0 - height)
    return Crop(newX, newY, width, height)
}
```

- [ ] **Step 4: Pass `lockedAspect` into `CropOverlay` and `resizeCrop`**

Change the `CropOverlay` signature (line 364) to accept `lockedAspect: Float?`:

```kotlin
@Composable
private fun CropOverlay(
    crop: Crop,
    lockedAspect: Float?,
    onCropChange: (Crop) -> Unit,
) {
```

Pass it from `CropPreview`:

```kotlin
CropOverlay(crop = crop, lockedAspect = lockedAspect, onCropChange = onCropChange)
```

And `CropPreview` itself accepts a `lockedAspect` param, passed from `CropResizeScreen`'s body.

Inside `CropOverlay`'s `onDrag`, modify the resize call:

```kotlin
val next = activeDrag?.let { handle ->
    resizeCrop(gestureCrop, handle, deltaX, deltaY, lockedAspect)
} ?: moveCrop(gestureCrop, deltaX, deltaY)
```

- [ ] **Step 5: Update `resizeCrop` to respect lockedAspect**

Change the signature:

```kotlin
private fun resizeCrop(crop: Crop, handle: ResizeHandle, dx: Double, dy: Double, lockedAspect: Float? = null): Crop {
```

When `lockedAspect != null`, derive the perpendicular axis from the dragged axis to preserve the ratio. Add at the END of `resizeCrop`, before the `return`:

```kotlin
val ratioApplied = if (lockedAspect != null) {
    val aspect = lockedAspect.toDouble()
    when (handle) {
        ResizeHandle.TopLeft, ResizeHandle.TopRight, ResizeHandle.BottomLeft, ResizeHandle.BottomRight -> {
            // Width-driven; recompute height, anchor opposite corner
            val newWidth = updated.width
            val newHeight = (newWidth / aspect).coerceAtLeast(0.10)
            when (handle) {
                ResizeHandle.TopLeft -> updated.copy(
                    y = (crop.y + crop.height - newHeight).coerceAtLeast(0.0),
                    height = newHeight.coerceAtMost(crop.y + crop.height),
                )
                ResizeHandle.TopRight -> updated.copy(
                    y = (crop.y + crop.height - newHeight).coerceAtLeast(0.0),
                    height = newHeight.coerceAtMost(crop.y + crop.height),
                )
                ResizeHandle.BottomLeft -> updated.copy(
                    height = newHeight.coerceAtMost(1.0 - updated.y),
                )
                ResizeHandle.BottomRight -> updated.copy(
                    height = newHeight.coerceAtMost(1.0 - updated.y),
                )
                else -> updated
            }
        }
        ResizeHandle.Top, ResizeHandle.Bottom -> {
            val newHeight = updated.height
            val newWidth = (newHeight * aspect).coerceAtLeast(0.10)
            val centerX = crop.x + crop.width / 2.0
            updated.copy(
                x = (centerX - newWidth / 2.0).coerceIn(0.0, 1.0 - newWidth),
                width = newWidth.coerceAtMost(1.0),
            )
        }
        ResizeHandle.Left, ResizeHandle.Right -> {
            val newWidth = updated.width
            val newHeight = (newWidth / aspect).coerceAtLeast(0.10)
            val centerY = crop.y + crop.height / 2.0
            updated.copy(
                y = (centerY - newHeight / 2.0).coerceIn(0.0, 1.0 - newHeight),
                height = newHeight.coerceAtMost(1.0),
            )
        }
    }
} else {
    updated
}
return ratioApplied
```

Replace the final `return updated` with `return ratioApplied`.

- [ ] **Step 6: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt"
git commit -m "feat(android): aspect-lock during crop handle drag

Tapping an aspect chip now snaps AND locks subsequent handle drags
to that ratio. Tap Custom to unlock. resizeCrop gains an optional
lockedAspect parameter that constrains the perpendicular axis based
on the handle type. Matches the iOS CropFrameGeometry.resize math."
```

## Task B2: Flip H / Flip V chips

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt`

- [ ] **Step 1: Add flip draft state**

After `draftCrop`, add:

```kotlin
var draftFlipH by remember(clip.id) { mutableStateOf(clip.transform.flipHorizontal) }
var draftFlipV by remember(clip.id) { mutableStateOf(clip.transform.flipVertical) }
```

(`clip.transform.flipHorizontal` and `flipVertical` are existing `Boolean` fields on the Android model — verify with `grep -n "flipHorizontal\|flipVertical" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/model"`.)

- [ ] **Step 2: Apply flip to the preview backdrop**

In the `CropPreview`'s inner rotation Box (around line 322-327), the existing code is:

```kotlin
Box(
    modifier = Modifier
        .fillMaxSize()
        .graphicsLayer { rotationZ = rotationDeg },
) {
```

Extend with flip:

```kotlin
Box(
    modifier = Modifier
        .fillMaxSize()
        .graphicsLayer {
            rotationZ = rotationDeg
            scaleX = if (flipH) -1f else 1f
            scaleY = if (flipV) -1f else 1f
        },
) {
```

Pass `flipH: Boolean` and `flipV: Boolean` from `CropPreview`'s callers (default `false` if existing call sites don't yet pass them — but in `CropResizeScreen` they come from `draftFlipH/V`).

- [ ] **Step 3: Add the Flip chips row to the body**

Find the existing "Aspect ratio" Text label and the chips row (around line 220-247). Above the "Aspect ratio" label, add:

```kotlin
Text(
    text = "Flip",
    style = OpenReelTypographyAccess.subcaption.copy(fontWeight = FontWeight.Bold),
    color = colors.textPrimary,
)
Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    FlipChip(label = "Flip H", active = draftFlipH) { draftFlipH = !draftFlipH }
    FlipChip(label = "Flip V", active = draftFlipV) { draftFlipV = !draftFlipV }
}
```

And add the `FlipChip` composable near `AspectRatioOption`:

```kotlin
@Composable
private fun FlipChip(label: String, active: Boolean, onClick: () -> Unit) {
    val colors = OpenReelTheme.colors
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (active) colors.accent else colors.surface)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = OpenReelTypographyAccess.tiny.copy(fontWeight = FontWeight.Bold, fontSize = 12.sp),
            color = if (active) Color.Black else colors.textPrimary,
        )
    }
}
```

If `FlipChip` already exists elsewhere in this file or another shared component file (likely from `ClipInspectorSheet.kt`), reuse the existing one and just adapt the call site.

- [ ] **Step 4: Persist on Apply**

Find the `CropTopBar(onApply = { ... })` block (around line 138-145):

```kotlin
onApply = {
    appState.mutateClip(trackId, clip.id, "Crop") {
        it.copy(transform = it.transform.copy(crop = cropOrNull(draftCrop), rotation = draftRotation.toDouble()))
    }
    onDismiss()
},
```

Extend the transform update to include flip:

```kotlin
onApply = {
    appState.mutateClip(trackId, clip.id, "Crop") {
        it.copy(
            transform = it.transform.copy(
                crop = cropOrNull(draftCrop),
                rotation = draftRotation.toDouble(),
                flipHorizontal = draftFlipH,
                flipVertical = draftFlipV,
            ),
        )
    }
    onDismiss()
},
```

- [ ] **Step 5: Reset clears flips**

Find the Reset button onClick (around line 255-258):

```kotlin
.clickable {
    draftCrop = Crop(0.0, 0.0, 1.0, 1.0)
    draftRotation = 0f
}
```

Extend:

```kotlin
.clickable {
    draftCrop = Crop(0.0, 0.0, 1.0, 1.0)
    draftRotation = 0f
    draftFlipH = false
    draftFlipV = false
}
```

- [ ] **Step 6: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt"
git commit -m "feat(android): Flip H/V chips in CropResizeScreen

New Flip section above Aspect ratio with two toggle chips.
Initialized from clip.transform.flip* and persisted on Apply via
the existing mutateClip path. Reset clears flips. Preview mirror is
applied via graphicsLayer.scaleX/Y on the existing rotation Box."
```

## Task B3: Fit mode chips

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt`

- [ ] **Step 1: Add fitMode draft state**

After the flip state:

```kotlin
var draftFitMode by remember(clip.id) {
    mutableStateOf(clip.transform.fitMode ?: com.pythonxi.openreelvideo.core.model.FitMode.Contain)
}
```

- [ ] **Step 2: Add the Fit chip row**

Above the Flip section (added in Task B2), add:

```kotlin
Text(
    text = "Fit",
    style = OpenReelTypographyAccess.subcaption.copy(fontWeight = FontWeight.Bold),
    color = colors.textPrimary,
)
Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    FitChip("Contain", draftFitMode == com.pythonxi.openreelvideo.core.model.FitMode.Contain) {
        draftFitMode = com.pythonxi.openreelvideo.core.model.FitMode.Contain
    }
    FitChip("Cover", draftFitMode == com.pythonxi.openreelvideo.core.model.FitMode.Cover) {
        draftFitMode = com.pythonxi.openreelvideo.core.model.FitMode.Cover
    }
    FitChip("Stretch", draftFitMode == com.pythonxi.openreelvideo.core.model.FitMode.Stretch) {
        draftFitMode = com.pythonxi.openreelvideo.core.model.FitMode.Stretch
    }
    FitChip("None", draftFitMode == com.pythonxi.openreelvideo.core.model.FitMode.None) {
        draftFitMode = com.pythonxi.openreelvideo.core.model.FitMode.None
    }
}
```

And add a `FitChip` composable identical in shape to `FlipChip`:

```kotlin
@Composable
private fun FitChip(label: String, active: Boolean, onClick: () -> Unit) {
    val colors = OpenReelTheme.colors
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (active) colors.accent else colors.surface)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = OpenReelTypographyAccess.tiny.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp),
            color = if (active) Color.Black else colors.textPrimary,
        )
    }
}
```

If the `FitMode` enum cases differ from `Contain`/`Cover`/`Stretch`/`None` (e.g., they might be `CONTAIN` / `COVER` / etc.), check the model file:

```bash
grep -n "enum class FitMode\|case fitMode\|Contain\|Cover\|Stretch" "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/core/model"
```

Adjust the references to the actual enum cases.

- [ ] **Step 3: Persist on Apply**

Extend the `onApply` transform copy to include `fitMode = draftFitMode`:

```kotlin
onApply = {
    appState.mutateClip(trackId, clip.id, "Crop") {
        it.copy(
            transform = it.transform.copy(
                crop = cropOrNull(draftCrop),
                rotation = draftRotation.toDouble(),
                flipHorizontal = draftFlipH,
                flipVertical = draftFlipV,
                fitMode = draftFitMode,
            ),
        )
    }
    onDismiss()
},
```

- [ ] **Step 4: Reset clears fitMode**

Extend the Reset onClick:

```kotlin
.clickable {
    draftCrop = Crop(0.0, 0.0, 1.0, 1.0)
    draftRotation = 0f
    draftFlipH = false
    draftFlipV = false
    draftFitMode = com.pythonxi.openreelvideo.core.model.FitMode.Contain
}
```

- [ ] **Step 5: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt"
git commit -m "feat(android): Fit mode chips in CropResizeScreen

New Fit section above Flip with four chips (Contain / Cover /
Stretch / None). Initialized from clip.transform.fitMode and
persisted via the existing mutateClip Apply path. Reset returns
to Contain (default)."
```

## Task B4: Pinch-to-zoom with centroid

**Files:**
- Modify: `Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt`

- [ ] **Step 1: Add zoom state**

After the fit state:

```kotlin
var mediaScale by remember(clip.id) { mutableFloatStateOf(1f) }
var mediaOffset by remember(clip.id) { mutableStateOf(Offset.Zero) }
```

- [ ] **Step 2: Wire pinch on `CropPreview`'s backdrop**

In `CropPreview`'s outer Box (line 302–360), the rotation `Box(modifier = Modifier.fillMaxSize().graphicsLayer { ... })` wraps the backdrop. Add the pinch gesture to that Box's modifier chain, AND extend `graphicsLayer` to apply both scale + offset:

```kotlin
Box(
    modifier = Modifier
        .fillMaxSize()
        .pointerInput(crop) {
            var pinchStartScale = 1f
            var pinchStartOffset = Offset.Zero
            var pinchStartCentroid: Offset? = null
            var viewSize: androidx.compose.ui.geometry.Size = androidx.compose.ui.geometry.Size.Zero

            awaitEachGesture {
                pinchStartCentroid = null
                awaitFirstDown(requireUnconsumed = false)
                do {
                    val event = awaitPointerEvent()
                    if (event.changes.size >= 2) {
                        val zoom = event.calculateZoom()
                        val centroid = event.calculateCentroid()
                        if (pinchStartCentroid == null) {
                            pinchStartScale = mediaScale
                            pinchStartOffset = mediaOffset
                            pinchStartCentroid = centroid
                        }
                        val newScale = (pinchStartScale * zoom).coerceIn(1f, 6f)
                        val center = Offset(viewSize.width / 2f, viewSize.height / 2f)
                        val startCentroid = pinchStartCentroid ?: centroid
                        val dV = Offset(startCentroid.x - center.x, startCentroid.y - center.y)
                        val m = newScale / pinchStartScale
                        mediaScale = newScale
                        mediaOffset = Offset(
                            dV.x * (1 - m) + pinchStartOffset.x * m,
                            dV.y * (1 - m) + pinchStartOffset.y * m,
                        )
                        event.changes.forEach { it.consume() }
                    } else {
                        pinchStartCentroid = null
                    }
                } while (event.changes.any { it.pressed })
            }
        }
        .onSizeChanged { viewSize = androidx.compose.ui.geometry.Size(it.width.toFloat(), it.height.toFloat()) }
        .graphicsLayer {
            rotationZ = rotationDeg
            scaleX = (if (flipH) -1f else 1f) * mediaScale
            scaleY = (if (flipV) -1f else 1f) * mediaScale
            translationX = mediaOffset.x
            translationY = mediaOffset.y
        },
) {
    // ... existing video / image / black backdrop content
}
```

`viewSize` is a `MutableState<Size>` declared with `var viewSize by remember { mutableStateOf(androidx.compose.ui.geometry.Size.Zero) }` outside the lambda — hoist it appropriately.

Compose imports needed:
```kotlin
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateZoom
```

`onSizeChanged` is already imported.

- [ ] **Step 3: Reset clears zoom**

Extend the Reset onClick:

```kotlin
.clickable {
    draftCrop = Crop(0.0, 0.0, 1.0, 1.0)
    draftRotation = 0f
    draftFlipH = false
    draftFlipV = false
    draftFitMode = com.pythonxi.openreelvideo.core.model.FitMode.Contain
    mediaScale = 1f
    mediaOffset = Offset.Zero
}
```

- [ ] **Step 4: Pass `mediaScale` / `mediaOffset` / `flipH` / `flipV` into `CropPreview`**

`CropPreview`'s signature is at line 292. It currently takes `controller, mediaPath, isVideo, aspectRatio, crop, rotationDeg, onCropChange`. Add `flipH: Boolean`, `flipV: Boolean`, `mediaScale: Float`, `mediaOffset: Offset` parameters. Pass them from `CropResizeScreen`'s body at line 156–164.

- [ ] **Step 5: Build**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video Android/app/src/main/java/com/pythonxi/openreelvideo/ui/editor/CropResizeScreen.kt"
git commit -m "feat(android): pinch-to-zoom with centroid in CropResizeScreen

Two-finger pinch on the crop preview backdrop now zooms 1x to 6x
with the pinch point staying anchored under the user's fingers.
Math matches iOS:
  O = dV * (1 - m) + O0 * m
where dV = pinchStartCentroid - viewCenter, m = currentScale /
startScale. Reset clears scale + offset."
```

## Task B5: Workstream B verification

- [ ] **Step 1: Build + unit tests**

```bash
cd "Openreel Video Android"
./gradlew assembleDebug
./gradlew testDebugUnitTest
```

Expected: BUILD SUCCESSFUL + tests in same state as before Workstream B.

- [ ] **Step 2: Smoke checklist for the user**

For each photo + video clip:
- Open Crop tool → CropResizeScreen opens.
- Tap each aspect chip → frame snaps AND locks subsequent handle drags.
- Tap Custom → lock clears.
- Tap Flip H / Flip V → backdrop mirrors.
- Tap each Fit chip → state updates.
- Pinch on backdrop → zooms 1x to 6x with centroid stability.
- Reset → all draft state restores to defaults.
- Apply → mutations persist; reopen Crop shows the saved state.

---

## Self-review checklist

- All 5 trim tasks (A1–A5) touch only `Timeline.kt`, `AppState.kt`, `EditorScreen.kt` (the latter only for haptic helpers).
- All 4 crop tasks (B1–B4) touch only `CropResizeScreen.kt`.
- New AppState methods (`trimVideoClipStart`, `trimAudioClipStart`, `trimAudioClipEnd`) follow the existing `mutateClip` pattern.
- The locked-aspect math in `resizeCrop` mirrors the iOS `CropFrameGeometry.resize(..., lockedAspect:)` from `Features/Crop/CropFrameGeometry.swift`.
- Pinch centroid math is `O = dV * (1 - m) + O0 * m` — same as iOS `CropEditorView`'s MagnifyGesture handler.
- No new files; no test files; no `project.pbxproj`-equivalent edits (Android uses gradle, no project-file surgery needed).
- Each commit is independent and the build stays green after every commit.
