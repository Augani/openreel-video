# iOS Trim Flicker + Full-Screen Crop Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two iOS editor improvements from `docs/superpowers/specs/2026-05-28-ios-trim-and-crop-design.md` — fix the horizontal-jitter trim bug across all four timeline clip block types, and replace the slider-based crop sheet with a full-screen direct-manipulation crop editor.

**Architecture:** Workstream 1 is three small, mechanical changes applied to each of the four `Timeline*ClipBlock` structs in `EditorView.swift` plus their call sites — no new files. Workstream 2 introduces a new `Features/Crop/` folder with `CropFrameGeometry.swift` (pure coordinate-math helper, unit-tested) and `CropEditorView.swift` (`fullScreenCover` view); routes the "Crop" tool taps to it; deletes the old `clipCropSheet` body and `EditingSheet.crop` case. A small `AppState` API addition (`setSelectedClipCrop`, `setSelectedClipFlip`) replaces the per-axis `updateSelectedClipCrop` slider API because the new screen produces a geometrically valid `Crop` rect in one shot.

**Tech Stack:** Swift 5.10+, SwiftUI (DragGesture, MagnifyGesture, fullScreenCover, GestureMask), AVFoundation (for the video backdrop snapshot via the existing `MetalVideoSnapshotProvider`), Swift Testing (`import Testing`, `@Test`, `#expect`).

**Test runner:** From the repo root:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 17,OS=26.5" \
  -only-testing:"Openreel VideoTests/<ClassName>" \
  -quiet
```

Replace `<ClassName>` with the test class for the task. Drop `-only-testing:` to run the whole suite. To verify a build without running tests:

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

**Branch:** Already on `feat/ios-app`. Commit per task with the conventional-commit prefix shown in each step.

---

## File Structure

Files this plan creates or modifies, with the responsibility of each:

| File | Purpose | Status |
|---|---|---|
| `Openreel Video/Openreel Video/EditorView.swift` | Trim fix in 4 clip block structs + their call sites; remove `clipCropSheet`, `EditingSheet.crop` and its branches; add `.fullScreenCover` route for the new editor | Modify |
| `Openreel Video/Openreel Video/AppState.swift` | New `setSelectedClipCrop` (full-rect setter, validated) and `setSelectedClipFlip(horizontal:vertical:)` (direct setter, not toggle); delete unused `updateSelectedClipCrop` per-axis method | Modify |
| `Openreel Video/Openreel Video/Features/Crop/CropFrameGeometry.swift` | Pure functions: media-aspect-fit-rect math, preview-rect ↔ normalized `Crop` conversion, aspect-locked corner-drag resolution. No SwiftUI, no AppKit, no MainActor. | **Create** |
| `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift` | The full-screen editor: layout, handles, aspect chips, pan/pinch/flip/reset, Done/Cancel. SwiftUI only. | **Create** |
| `Openreel Video/Openreel VideoTests/CropFrameGeometryTests.swift` | Round-trip unit tests + aspect-lock math tests for the geometry helper | **Create** |

Two new files plus one test file. All other work modifies existing files in place.

---

# Workstream 1 — Trim flicker (Phases 1.1 – 1.5)

Apply identical three-part fix to each of the four clip block structs. Each phase is one struct + its call site so the build stays green after every task. Verification is manual after Phase 1.5.

## Phase 1.1 — `TimelineClipBlock`

### Task 1.1: Fix trim in `TimelineClipBlock` + its call site

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift` (struct at line 5485; call site at line 2656)

- [ ] **Step 1: Change the `onTrim` property type to async**

In `TimelineClipBlock` (line 5485), find the property:

```swift
let onTrim: (AppState.TrimEdge, TimeInterval) -> Void
```

Replace with:

```swift
let onTrim: (AppState.TrimEdge, TimeInterval) async -> Void
```

- [ ] **Step 2: Add `isTrimming` state**

In the same struct's `@State` block (currently at lines 5521–5526), add a new line **after** `@State private var trailingTrimOffset: CGFloat = 0`:

```swift
@State private var isTrimming: Bool = false
```

So the block reads:

```swift
@State private var moveTranslation: CGFloat = 0
@State private var moveVerticalTranslation: CGFloat = 0
@State private var snapEdgeX: CGFloat? = nil
@State private var snapClearTask: Task<Void, Never>? = nil
@State private var leadingTrimOffset: CGFloat = 0
@State private var trailingTrimOffset: CGFloat = 0
@State private var isTrimming: Bool = false
```

- [ ] **Step 3: Anchor leading edge in the `.offset` modifier**

In `TimelineClipBlock.body` (currently line 5631), find:

```swift
.offset(x: moveTranslation, y: moveVerticalTranslation)
```

Replace with:

```swift
.offset(x: moveTranslation + leadingTrimOffset, y: moveVerticalTranslation)
```

- [ ] **Step 4: Suppress move gesture during trim**

In the same body (currently line 5637), find:

```swift
.simultaneousGesture(moveGesture)
```

Replace with:

```swift
.simultaneousGesture(moveGesture, including: isTrimming ? .subviews : .all)
```

- [ ] **Step 5: Rewrite the `.onEnded` of the trim handle's drag gesture**

In `trimHandle(edge:)` (currently line 5644), find the `.onChanged` and `.onEnded` block:

```swift
.gesture(
    DragGesture(minimumDistance: 1)
        .onChanged { value in
            switch edge {
            case .leading:
                leadingTrimOffset = min(value.translation.width, clipWidth - 44)
            case .trailing:
                trailingTrimOffset = max(value.translation.width, -(clipWidth - 44))
            }
        }
        .onEnded { value in
            let delta = value.translation.width / max(pixelsPerSecond, 1)
            leadingTrimOffset = 0
            trailingTrimOffset = 0
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onTrim(edge, delta)
        }
)
```

Replace with:

```swift
.gesture(
    DragGesture(minimumDistance: 1)
        .onChanged { value in
            isTrimming = true
            switch edge {
            case .leading:
                leadingTrimOffset = min(value.translation.width, clipWidth - 44)
            case .trailing:
                trailingTrimOffset = max(value.translation.width, -(clipWidth - 44))
            }
        }
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
)
```

Two differences vs original: `isTrimming = true` at the start of `.onChanged`, and `.onEnded` now wraps in `Task { @MainActor in ... }` so the offset reset and `isTrimming` reset happen **after** `await onTrim` returns (i.e., after the project state has updated and `clipWidth` reflects the new duration).

- [ ] **Step 6: Update the call site to pass an async closure**

In `visualTrackLane` (line 2642), find the `TimelineClipBlock(...)` initializer's `onTrim` argument (currently line 2665):

```swift
onTrim: { edge, delta in
    Task {
        await appState.trimClip(clip.id, edge: edge, by: delta, playbackController: playbackController)
    }
},
```

Replace with:

```swift
onTrim: { edge, delta in
    await appState.trimClip(clip.id, edge: edge, by: delta, playbackController: playbackController)
},
```

The `Task` wrapper goes away because the closure is now async — the trim handle's `.onEnded` owns its own `Task { ... }` so it can sequence the offset reset after the await.

- [ ] **Step 7: Build to verify no compilation regressions**

Run:

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`. The other three clip block types still use the old sync `onTrim`, but they are independent structs with independent properties — this one struct's change does not break them.

- [ ] **Step 8: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "fix(ios): trim flicker in TimelineClipBlock

- Suppress simultaneous move gesture while trim drag is in progress
  (via GestureMask.subviews) to stop mid-drag horizontal jumps.
- Anchor leading edge to the finger by adding leadingTrimOffset to
  the clip's .offset so the left edge moves with the drag instead of
  the right edge collapsing.
- Make onTrim async and reset the trim offsets inside the Task that
  awaits the project-state update, eliminating the one-frame width
  pop on release."
```

## Phase 1.2 — `TimelineAudioClipBlock`

### Task 1.2: Apply the same fix to `TimelineAudioClipBlock` + its call site

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift` (struct at line 5816; call site in the audio track lane builder)

- [ ] **Step 1: Find the audio call site**

Run:

```bash
grep -n "TimelineAudioClipBlock(" "Openreel Video/Openreel Video/EditorView.swift"
```

Expected: one or more line numbers around the audio track lane builder. Note the line numbers — you'll need them for Step 7.

- [ ] **Step 2: Change `onTrim` to async**

In `TimelineAudioClipBlock` (line 5816), find:

```swift
let onTrim: (AppState.TrimEdge, TimeInterval) -> Void
```

Replace with:

```swift
let onTrim: (AppState.TrimEdge, TimeInterval) async -> Void
```

- [ ] **Step 3: Add `isTrimming` state**

In the same struct's `@State` block (line 5828), add after `trailingTrimOffset`:

```swift
@State private var isTrimming: Bool = false
```

- [ ] **Step 4: Anchor leading edge in `.offset`**

Find (line 5871):

```swift
.offset(x: moveTranslation, y: moveVerticalTranslation)
```

Replace with:

```swift
.offset(x: moveTranslation + leadingTrimOffset, y: moveVerticalTranslation)
```

- [ ] **Step 5: Suppress move gesture during trim**

Find (line 5877):

```swift
.simultaneousGesture(moveGesture)
```

Replace with:

```swift
.simultaneousGesture(moveGesture, including: isTrimming ? .subviews : .all)
```

- [ ] **Step 6: Rewrite the trim handle's `.onChanged` and `.onEnded`**

Find the `trimHandle(edge:)` method (line 5880). Replace the existing `.gesture(...)` block with:

```swift
.gesture(
    DragGesture(minimumDistance: 1)
        .onChanged { value in
            isTrimming = true
            switch edge {
            case .leading:
                leadingTrimOffset = min(value.translation.width, clipWidth - 44)
            case .trailing:
                trailingTrimOffset = max(value.translation.width, -(clipWidth - 44))
            }
        }
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
)
```

- [ ] **Step 7: Update the audio call site**

At the line number(s) you found in Step 1, find the `onTrim:` argument:

```swift
onTrim: { edge, delta in
    Task {
        await appState.trimClip(clip.id, edge: edge, by: delta, playbackController: playbackController)
    }
},
```

Replace with:

```swift
onTrim: { edge, delta in
    await appState.trimClip(clip.id, edge: edge, by: delta, playbackController: playbackController)
},
```

- [ ] **Step 8: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 9: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "fix(ios): trim flicker in TimelineAudioClipBlock

Same three-part fix as TimelineClipBlock: gesture-mask move
suppression during trim, leading-edge follow-the-finger, async
onTrim with deferred offset reset."
```

## Phase 1.3 — `TimelineTextClipBlock`

### Task 1.3: Apply the same fix to `TimelineTextClipBlock` + its call site

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift` (struct at line 5986; call site at line 2559)

- [ ] **Step 1: Change `onTrim` to async**

In `TimelineTextClipBlock` (line 5986), find `let onTrim: (AppState.TrimEdge, TimeInterval) -> Void` and replace with:

```swift
let onTrim: (AppState.TrimEdge, TimeInterval) async -> Void
```

- [ ] **Step 2: Add `isTrimming` state**

In the same struct's `@State` block, add after `trailingTrimOffset`:

```swift
@State private var isTrimming: Bool = false
```

- [ ] **Step 3: Anchor leading edge in `.offset`**

Find `.offset(x: moveTranslation, y: moveVerticalTranslation)` in the body. Replace with:

```swift
.offset(x: moveTranslation + leadingTrimOffset, y: moveVerticalTranslation)
```

- [ ] **Step 4: Suppress move gesture during trim**

Find `.simultaneousGesture(moveGesture)` in the body. Replace with:

```swift
.simultaneousGesture(moveGesture, including: isTrimming ? .subviews : .all)
```

- [ ] **Step 5: Rewrite the trim handle's `.onChanged` and `.onEnded`**

Find `trimHandle(edge:)` (line 6102). Replace its `.gesture(...)` block with:

```swift
.gesture(
    DragGesture(minimumDistance: 1)
        .onChanged { value in
            isTrimming = true
            switch edge {
            case .leading:
                leadingTrimOffset = min(value.translation.width, clipWidth - 44)
            case .trailing:
                trailingTrimOffset = max(value.translation.width, -(clipWidth - 44))
            }
        }
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
)
```

- [ ] **Step 6: Update the text call site**

In `visualTrackLane` or its equivalent for text clips (call site at line 2559), find:

```swift
onTrim: { edge, delta in
    Task {
        await appState.trimTextClip(textClip.id, edge: edge, by: delta, playbackController: playbackController)
    }
},
```

(The exact AppState method name may be `trimTextClip` or similar — match the original call and keep the method name; only remove the `Task { ... }` wrapper.)

Replace with the same call but without the Task wrapper:

```swift
onTrim: { edge, delta in
    await appState.trimTextClip(textClip.id, edge: edge, by: delta, playbackController: playbackController)
},
```

If the actual method name differs (e.g. `trimText`), preserve it — only the wrapper changes.

- [ ] **Step 7: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 8: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "fix(ios): trim flicker in TimelineTextClipBlock

Same three-part fix as the video/audio clip blocks."
```

## Phase 1.4 — `TimelineGraphicsClipBlock`

### Task 1.4: Apply the same fix to `TimelineGraphicsClipBlock` + its call site

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift` (struct at line 6193; call site at line 2611)

- [ ] **Step 1: Change `onTrim` to async**

In `TimelineGraphicsClipBlock` (line 6193), find `let onTrim: (AppState.TrimEdge, TimeInterval) -> Void` and replace with:

```swift
let onTrim: (AppState.TrimEdge, TimeInterval) async -> Void
```

- [ ] **Step 2: Add `isTrimming` state**

After `trailingTrimOffset` in the `@State` block, add:

```swift
@State private var isTrimming: Bool = false
```

- [ ] **Step 3: Anchor leading edge in `.offset`**

Find (line 6243):

```swift
.offset(x: moveTranslation, y: moveVerticalTranslation)
```

Replace with:

```swift
.offset(x: moveTranslation + leadingTrimOffset, y: moveVerticalTranslation)
```

- [ ] **Step 4: Suppress move gesture during trim**

Find (line 6249):

```swift
.simultaneousGesture(moveGesture)
```

Replace with:

```swift
.simultaneousGesture(moveGesture, including: isTrimming ? .subviews : .all)
```

- [ ] **Step 5: Rewrite the trim handle's `.onChanged` and `.onEnded`**

Find `trimHandle(edge:)` (line 6269). Replace its `.gesture(...)` block with:

```swift
.gesture(
    DragGesture(minimumDistance: 1)
        .onChanged { value in
            isTrimming = true
            switch edge {
            case .leading:
                leadingTrimOffset = min(value.translation.width, clipWidth - 44)
            case .trailing:
                trailingTrimOffset = max(value.translation.width, -(clipWidth - 44))
            }
        }
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
)
```

- [ ] **Step 6: Update the graphics call site**

At line 2611, find the `TimelineGraphicsClipBlock(...)` `onTrim:` argument and remove the `Task { ... }` wrapper from the body, leaving just `await appState.trim...(...)`. Match the existing AppState method name (likely `trimGraphicsClip`).

- [ ] **Step 7: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 8: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "fix(ios): trim flicker in TimelineGraphicsClipBlock

Same three-part fix as the video/audio/text clip blocks. Completes
the trim flicker fix across all four Timeline*ClipBlock types."
```

## Phase 1.5 — Verify Workstream 1 end-to-end

### Task 1.5: Run tests + manual smoke

- [ ] **Step 1: Run the unit test suite**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 17,OS=26.5" \
  -only-testing:"Openreel VideoTests" \
  -quiet
```

Expected: tests pass. The trim math is already covered by existing `appState.trimClip` paths; the fix is gesture-layer-only, so no regressions in unit tests. If any pre-existing test was already failing (see `MOBILE-CODE-REVIEW-2026-05-27.md` reference to 17 failing tests at one point), do not consider those a regression unless their failure mode changed. Note any new failures and stop here.

- [ ] **Step 2: Manual smoke on Simulator**

Launch the app and create a project with at least one clip on each of: a video track, an audio track, a text track, and a graphics track. For each clip type:

1. Drag the **leading** trim handle to the right slowly. Confirm the left edge of the clip follows your finger (does not stay anchored). Confirm no horizontal jumps.
2. Drag the leading handle, pause for 1 second mid-drag without releasing, then continue. Confirm the clip does not suddenly slide horizontally during the pause.
3. Drag the **trailing** trim handle. Confirm trailing edge follows finger. No jumps.
4. Release after trimming. Confirm there's no width pop — the clip transitions smoothly from the dragging width to the final width with no flash to original size.

Record the result of all four clip types in the task notes. If any clip type still flickers, return to that phase and re-inspect.

- [ ] **Step 3: Workstream 1 sign-off**

If all four clip types pass manual smoke, Workstream 1 is complete. No additional commit needed; the fix commits already shipped per-task.

---

# Workstream 2 — Full-screen Crop editor (Phases 2.1 – 2.7)

## Phase 2.1 — Pure geometry helper + tests (TDD)

### Task 2.1: Create `CropFrameGeometry` with unit tests

**Files:**
- Create: `Openreel Video/Openreel Video/Features/Crop/CropFrameGeometry.swift`
- Create: `Openreel Video/Openreel VideoTests/CropFrameGeometryTests.swift`

- [ ] **Step 1: Create the test file with failing tests**

Create `Openreel Video/Openreel VideoTests/CropFrameGeometryTests.swift` with this content:

```swift
import CoreGraphics
import Foundation
import Testing
@testable import Openreel_Video

struct CropFrameGeometryTests {
    @Test func mediaFitRectIsCenteredAndPreservesAspect() {
        let preview = CGSize(width: 400, height: 300)
        let media = CGSize(width: 1920, height: 1080)

        let rect = CropFrameGeometry.mediaFitRect(previewSize: preview, mediaSize: media)

        // 16:9 media in 4:3 preview -> letterboxed top/bottom, full width
        #expect(abs(rect.width - 400) < 1e-6)
        #expect(abs(rect.height - 225) < 1e-6)
        #expect(abs(rect.minX - 0) < 1e-6)
        #expect(abs(rect.minY - 37.5) < 1e-6)
    }

    @Test func mediaFitRectPillarboxesPortraitMediaInLandscapePreview() {
        let preview = CGSize(width: 400, height: 300)
        let media = CGSize(width: 1080, height: 1920)

        let rect = CropFrameGeometry.mediaFitRect(previewSize: preview, mediaSize: media)

        // 9:16 media in 4:3 preview -> pillarboxed, full height
        #expect(abs(rect.height - 300) < 1e-6)
        #expect(abs(rect.width - 168.75) < 1e-6)
    }

    @Test func cropFrameToNormalizedAndBack() {
        let mediaFit = CGRect(x: 0, y: 37.5, width: 400, height: 225)
        let cropFrame = CGRect(x: 100, y: 75, width: 200, height: 150)

        let normalized = CropFrameGeometry.normalizedCrop(cropFrame: cropFrame, mediaFitRect: mediaFit)
        #expect(abs(normalized.x - 0.25) < 1e-6)
        #expect(abs(normalized.y - (37.5 / 225)) < 1e-6)
        #expect(abs(normalized.width - 0.5) < 1e-6)
        #expect(abs(normalized.height - (150 / 225)) < 1e-6)

        let roundtrip = CropFrameGeometry.cropFrame(normalized: normalized, mediaFitRect: mediaFit)
        #expect(abs(roundtrip.minX - cropFrame.minX) < 1e-6)
        #expect(abs(roundtrip.minY - cropFrame.minY) < 1e-6)
        #expect(abs(roundtrip.width - cropFrame.width) < 1e-6)
        #expect(abs(roundtrip.height - cropFrame.height) < 1e-6)
    }

    @Test func resizeWithLockedAspectFromBottomRightKeepsRatio() {
        let original = CGRect(x: 10, y: 10, width: 100, height: 50)
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 200)
        let drag = CGSize(width: 30, height: 80)

        let resized = CropFrameGeometry.resize(
            frame: original,
            handle: .bottomRight,
            drag: drag,
            lockedAspect: 2.0,
            bounds: bounds
        )

        let ratio = resized.width / resized.height
        #expect(abs(ratio - 2.0) < 1e-6)
        #expect(resized.minX == original.minX)
        #expect(resized.minY == original.minY)
        #expect(resized.maxX <= bounds.maxX)
        #expect(resized.maxY <= bounds.maxY)
    }

    @Test func resizeFromTopLeftMovesOriginButKeepsOppositeCorner() {
        let original = CGRect(x: 50, y: 50, width: 100, height: 100)
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 200)
        let drag = CGSize(width: 20, height: 20)

        let resized = CropFrameGeometry.resize(
            frame: original,
            handle: .topLeft,
            drag: drag,
            lockedAspect: nil,
            bounds: bounds
        )

        #expect(resized.maxX == original.maxX)
        #expect(resized.maxY == original.maxY)
        #expect(resized.width == 80)
        #expect(resized.height == 80)
    }

    @Test func snapToAspectCentersWithinFrame() {
        let frame = CGRect(x: 0, y: 0, width: 200, height: 200)
        let bounds = CGRect(x: 0, y: 0, width: 400, height: 400)

        let snapped = CropFrameGeometry.snapToAspect(
            frame: frame,
            aspect: 16.0 / 9.0,
            bounds: bounds
        )

        let ratio = snapped.width / snapped.height
        #expect(abs(ratio - 16.0 / 9.0) < 1e-6)
        let originalCenterX = frame.midX
        let originalCenterY = frame.midY
        #expect(abs(snapped.midX - originalCenterX) < 1e-6)
        #expect(abs(snapped.midY - originalCenterY) < 1e-6)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail with "no such type"**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 17,OS=26.5" \
  -only-testing:"Openreel VideoTests/CropFrameGeometryTests" \
  -quiet
```

Expected: build fails with errors like `cannot find 'CropFrameGeometry' in scope` and `cannot find type 'CropFrameGeometry.Handle' in scope`. This confirms the test target is wired up and the helper does not exist yet.

- [ ] **Step 3: Create the helper directory + file**

Create the directory:

```bash
mkdir -p "Openreel Video/Openreel Video/Features/Crop"
```

Create `Openreel Video/Openreel Video/Features/Crop/CropFrameGeometry.swift` with this content:

```swift
import CoreGraphics
import Foundation

enum CropFrameGeometry {
    enum Handle {
        case topLeft, topRight, bottomLeft, bottomRight
        case top, bottom, left, right
    }

    struct NormalizedCrop: Equatable {
        var x: Double
        var y: Double
        var width: Double
        var height: Double
    }

    static func mediaFitRect(previewSize: CGSize, mediaSize: CGSize) -> CGRect {
        guard mediaSize.width > 0, mediaSize.height > 0,
              previewSize.width > 0, previewSize.height > 0 else {
            return .zero
        }

        let mediaAspect = mediaSize.width / mediaSize.height
        let previewAspect = previewSize.width / previewSize.height

        if mediaAspect > previewAspect {
            let height = previewSize.width / mediaAspect
            let y = (previewSize.height - height) / 2
            return CGRect(x: 0, y: y, width: previewSize.width, height: height)
        } else {
            let width = previewSize.height * mediaAspect
            let x = (previewSize.width - width) / 2
            return CGRect(x: x, y: 0, width: width, height: previewSize.height)
        }
    }

    static func normalizedCrop(cropFrame: CGRect, mediaFitRect: CGRect) -> NormalizedCrop {
        guard mediaFitRect.width > 0, mediaFitRect.height > 0 else {
            return NormalizedCrop(x: 0, y: 0, width: 1, height: 1)
        }

        let x = (cropFrame.minX - mediaFitRect.minX) / mediaFitRect.width
        let y = (cropFrame.minY - mediaFitRect.minY) / mediaFitRect.height
        let width = cropFrame.width / mediaFitRect.width
        let height = cropFrame.height / mediaFitRect.height

        return NormalizedCrop(
            x: Double(max(0, min(1, x))),
            y: Double(max(0, min(1, y))),
            width: Double(max(0, min(1, width))),
            height: Double(max(0, min(1, height)))
        )
    }

    static func cropFrame(normalized: NormalizedCrop, mediaFitRect: CGRect) -> CGRect {
        let x = mediaFitRect.minX + CGFloat(normalized.x) * mediaFitRect.width
        let y = mediaFitRect.minY + CGFloat(normalized.y) * mediaFitRect.height
        let width = CGFloat(normalized.width) * mediaFitRect.width
        let height = CGFloat(normalized.height) * mediaFitRect.height
        return CGRect(x: x, y: y, width: width, height: height)
    }

    static func resize(
        frame: CGRect,
        handle: Handle,
        drag: CGSize,
        lockedAspect: CGFloat?,
        bounds: CGRect
    ) -> CGRect {
        let minSize: CGFloat = 40

        var newFrame = frame
        switch handle {
        case .topLeft:
            newFrame.origin.x += drag.width
            newFrame.origin.y += drag.height
            newFrame.size.width -= drag.width
            newFrame.size.height -= drag.height
        case .topRight:
            newFrame.origin.y += drag.height
            newFrame.size.width += drag.width
            newFrame.size.height -= drag.height
        case .bottomLeft:
            newFrame.origin.x += drag.width
            newFrame.size.width -= drag.width
            newFrame.size.height += drag.height
        case .bottomRight:
            newFrame.size.width += drag.width
            newFrame.size.height += drag.height
        case .top:
            newFrame.origin.y += drag.height
            newFrame.size.height -= drag.height
        case .bottom:
            newFrame.size.height += drag.height
        case .left:
            newFrame.origin.x += drag.width
            newFrame.size.width -= drag.width
        case .right:
            newFrame.size.width += drag.width
        }

        newFrame.size.width = max(newFrame.size.width, minSize)
        newFrame.size.height = max(newFrame.size.height, minSize)

        if let aspect = lockedAspect {
            switch handle {
            case .topLeft, .topRight, .bottomLeft, .bottomRight:
                // Use width as dominant axis for corner drags
                newFrame.size.height = newFrame.size.width / aspect
                if newFrame.size.height < minSize {
                    newFrame.size.height = minSize
                    newFrame.size.width = minSize * aspect
                }
                // Anchor adjustments to keep opposite corner stable
                switch handle {
                case .topLeft:
                    newFrame.origin.x = frame.maxX - newFrame.size.width
                    newFrame.origin.y = frame.maxY - newFrame.size.height
                case .topRight:
                    newFrame.origin.y = frame.maxY - newFrame.size.height
                case .bottomLeft:
                    newFrame.origin.x = frame.maxX - newFrame.size.width
                default:
                    break
                }
            case .top, .bottom:
                newFrame.size.width = newFrame.size.height * aspect
                newFrame.origin.x = frame.midX - newFrame.size.width / 2
            case .left, .right:
                newFrame.size.height = newFrame.size.width / aspect
                newFrame.origin.y = frame.midY - newFrame.size.height / 2
            }
        }

        return clamped(newFrame, to: bounds)
    }

    static func snapToAspect(frame: CGRect, aspect: CGFloat, bounds: CGRect) -> CGRect {
        let center = CGPoint(x: frame.midX, y: frame.midY)
        var width = frame.width
        var height = width / aspect
        if height > frame.height {
            height = frame.height
            width = height * aspect
        }

        var newFrame = CGRect(
            x: center.x - width / 2,
            y: center.y - height / 2,
            width: width,
            height: height
        )
        return clamped(newFrame, to: bounds)
    }

    static func translate(frame: CGRect, by delta: CGSize, bounds: CGRect) -> CGRect {
        let proposed = frame.offsetBy(dx: delta.width, dy: delta.height)
        return clamped(proposed, to: bounds)
    }

    private static func clamped(_ frame: CGRect, to bounds: CGRect) -> CGRect {
        var clamped = frame
        clamped.size.width = min(clamped.size.width, bounds.width)
        clamped.size.height = min(clamped.size.height, bounds.height)
        if clamped.minX < bounds.minX { clamped.origin.x = bounds.minX }
        if clamped.minY < bounds.minY { clamped.origin.y = bounds.minY }
        if clamped.maxX > bounds.maxX { clamped.origin.x = bounds.maxX - clamped.size.width }
        if clamped.maxY > bounds.maxY { clamped.origin.y = bounds.maxY - clamped.size.height }
        return clamped
    }
}
```

- [ ] **Step 4: Add the new files to the Xcode project**

The project uses Xcode's file references. Add both files via the Xcode project:

1. Open `Openreel Video.xcodeproj` in Xcode.
2. Right-click the `Openreel Video/Openreel Video` group → New Group → name it `Features` if not present, then inside `Features` create `Crop`.
3. Drag `CropFrameGeometry.swift` into the `Crop` group. Make sure the **Openreel Video** target is checked.
4. Drag `CropFrameGeometryTests.swift` into the `Openreel VideoTests` group. Make sure the **Openreel VideoTests** target is checked.
5. Save the project (`⌘S`).

If you'd rather edit `project.pbxproj` directly, locate the existing entry for `FilterRendererTests.swift` (or any test in `Openreel VideoTests/`) and clone its `PBXBuildFile` / `PBXFileReference` / membership lines for `CropFrameGeometryTests.swift`; similarly clone an entry like `Features/Effects/EffectsTabPanel.swift` for the helper file under a new `Features/Crop/` group.

- [ ] **Step 5: Run tests to verify they pass**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 17,OS=26.5" \
  -only-testing:"Openreel VideoTests/CropFrameGeometryTests" \
  -quiet
```

Expected: `Test Suite 'CropFrameGeometryTests' passed`. All 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/Crop/CropFrameGeometry.swift" \
        "Openreel Video/Openreel VideoTests/CropFrameGeometryTests.swift" \
        "Openreel Video/Openreel Video.xcodeproj"
git commit -m "feat(ios): CropFrameGeometry helper for the crop editor

Pure functions only: media-aspect fit, preview-rect <-> normalized
crop conversion, locked-aspect resize from 8 handle positions,
aspect snap-to-center, translation with bounds clamp. 6 round-trip
and constraint tests."
```

## Phase 2.2 — AppState API for full-rect crop and direct flip set

### Task 2.2: Add `setSelectedClipCrop` and `setSelectedClipFlip`; delete `updateSelectedClipCrop`

**Files:**
- Modify: `Openreel Video/Openreel Video/AppState.swift`

- [ ] **Step 1: Replace `updateSelectedClipCrop` with `setSelectedClipCrop`**

In `AppState.swift`, find `updateSelectedClipCrop` (line 2333). Replace the entire method body (lines 2333–2360) with:

```swift
func setSelectedClipCrop(
    _ crop: OpenReelProject.Crop?,
    playbackController: PlaybackController? = nil
) async {
    guard var project = currentProject,
          let location = selectedClipLocation(in: project)
    else {
        return
    }

    let validated = crop.map { Self.validatedCrop($0) }
    let primaryID = project.timeline.tracks[location.trackIndex].clips[location.clipIndex].id
    for target in selectedClipTargets(in: project) {
        project.timeline.tracks[target.trackIndex].clips[target.clipIndex].transform.crop = validated
    }
    normalizeTimeline(&project)
    await commitEditedProject(project, selectedClipID: primaryID, playbackController: playbackController)
}

private static func validatedCrop(_ crop: OpenReelProject.Crop) -> OpenReelProject.Crop {
    let minSize = 0.05
    let width = max(min(crop.width, 1), minSize)
    let height = max(min(crop.height, 1), minSize)
    let x = max(0, min(crop.x, 1 - width))
    let y = max(0, min(crop.y, 1 - height))
    return OpenReelProject.Crop(x: x, y: y, width: width, height: height)
}
```

The old per-axis `updateSelectedClipCrop` is gone (only the slider sheet called it; that sheet is deleted in Phase 2.6). The new method takes the full `Crop` in one shot and enforces geometric constraints (`x + width ≤ 1`, `y + height ≤ 1`, dimensions ≥ `minSize = 0.05`). Passing `nil` clears the crop.

- [ ] **Step 2: Add `setSelectedClipFlip`**

Right after the existing `toggleSelectedClipFlip` method (line 1685), add this new method:

```swift
func setSelectedClipFlip(
    horizontal: Bool? = nil,
    vertical: Bool? = nil,
    playbackController: PlaybackController? = nil
) async {
    guard var project = currentProject,
          let location = selectedClipLocation(in: project)
    else {
        return
    }

    var transform = project.timeline.tracks[location.trackIndex].clips[location.clipIndex].transform
    if let horizontal {
        transform.flipHorizontal = horizontal
    }
    if let vertical {
        transform.flipVertical = vertical
    }
    project.timeline.tracks[location.trackIndex].clips[location.clipIndex].transform = transform
    let clipID = project.timeline.tracks[location.trackIndex].clips[location.clipIndex].id
    normalizeTimeline(&project)
    await commitEditedProject(project, selectedClipID: clipID, playbackController: playbackController)
}
```

This sets the flip values directly rather than toggling. The existing `toggleSelectedClipFlip` stays (the slider sheet's Flip H / Flip V preset buttons call it).

- [ ] **Step 3: Build to confirm no callers were left dangling**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: build fails with `cannot find 'updateSelectedClipCrop' in scope` at the four call sites inside `clipCropSheet` (around lines 4470–4479). This is **expected** — those callers are deleted in Phase 2.6 together with the rest of the slider sheet. To keep the build green until then, temporarily leave the old method present alongside the new one:

In `AppState.swift`, instead of replacing `updateSelectedClipCrop` (Step 1), **add** `setSelectedClipCrop` and `validatedCrop` as new methods directly below `updateSelectedClipCrop`. Leave the old method intact. Phase 2.6 deletes both the callers and the old method.

Re-run the build:

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video/Openreel Video/AppState.swift"
git commit -m "feat(ios): AppState setSelectedClipCrop + setSelectedClipFlip

setSelectedClipCrop accepts a full Crop rect (or nil to clear) and
validates geometric constraints in one shot — needed by the new
full-screen crop editor which produces a valid rect from direct
manipulation rather than per-axis sliders.

setSelectedClipFlip sets horizontal/vertical directly instead of
toggling, so the crop editor can persist its local flip state on
Done without round-tripping through toggle math.

The old per-axis updateSelectedClipCrop and the toggle-based
toggleSelectedClipFlip stay for now; they're called only by the
slider sheet which is removed in a later commit."
```

## Phase 2.3 — `CropEditorView` shell with header + dismiss

### Task 2.3: Create the `CropEditorView` scaffolding (no interactions yet)

**Files:**
- Create: `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift`

- [ ] **Step 1: Create the file**

Create `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift` with this content:

```swift
import SwiftUI

struct CropEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @Environment(PlaybackController.self) private var playbackController

    let clipID: String

    @State private var cropFrame: CGRect = .zero
    @State private var initialCropFrame: CGRect = .zero
    @State private var mediaFitRect: CGRect = .zero
    @State private var lockedAspect: CGFloat? = nil
    @State private var flipH: Bool = false
    @State private var flipV: Bool = false
    @State private var initialFlipH: Bool = false
    @State private var initialFlipV: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            topBar
            previewArea
            controlsArea
        }
        .background(Color.black.ignoresSafeArea())
        .onAppear { loadInitialState() }
    }

    private var topBar: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .foregroundStyle(.white)

            Spacer()

            Text("Crop")
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)

            Spacer()

            Button("Done") { apply(); dismiss() }
                .foregroundStyle(OpenReelTheme.accent)
                .fontWeight(.semibold)
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    private var previewArea: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black

                if let image = backdropImage {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(x: flipH ? -1 : 1, y: flipV ? -1 : 1)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .onAppear {
                let media = mediaPixelSize ?? CGSize(width: 16, height: 9)
                mediaFitRect = CropFrameGeometry.mediaFitRect(
                    previewSize: proxy.size,
                    mediaSize: media
                )
                if cropFrame == .zero {
                    cropFrame = CropFrameGeometry.cropFrame(
                        normalized: initialNormalized,
                        mediaFitRect: mediaFitRect
                    )
                    initialCropFrame = cropFrame
                }
            }
        }
        .clipped()
    }

    private var controlsArea: some View {
        VStack(spacing: 16) {
            aspectChips
            actionRow
        }
        .padding(.vertical, 20)
        .padding(.horizontal, 16)
        .background(Color(white: 0.05).ignoresSafeArea(edges: .bottom))
    }

    private var aspectChips: some View {
        Text("Aspect chips placeholder")
            .foregroundStyle(.white.opacity(0.4))
            .font(.system(size: 12, weight: .medium))
            .frame(maxWidth: .infinity)
    }

    private var actionRow: some View {
        HStack(spacing: 32) {
            Button {
                flipH.toggle()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "arrow.left.and.right.righttriangle.left.righttriangle.right")
                    Text("Flip H").font(.system(size: 11))
                }
                .foregroundStyle(.white)
            }

            Button {
                flipV.toggle()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "arrow.up.and.down.righttriangle.up.righttriangle.down")
                    Text("Flip V").font(.system(size: 11))
                }
                .foregroundStyle(.white)
            }

            Button {
                reset()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "arrow.counterclockwise")
                    Text("Reset").font(.system(size: 11))
                }
                .foregroundStyle(.white)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var clip: OpenReelProject.Clip? {
        appState.currentProject?.allClips.first(where: { $0.id == clipID })
    }

    private var mediaItem: OpenReelProject.MediaItem? {
        guard let clip,
              let project = appState.currentProject else { return nil }
        return appState.mediaItem(for: clip.mediaId, in: project)
    }

    private var mediaPixelSize: CGSize? {
        guard let m = mediaItem,
              m.metadata.width > 0,
              m.metadata.height > 0 else { return nil }
        return CGSize(width: m.metadata.width, height: m.metadata.height)
    }

    private var initialNormalized: CropFrameGeometry.NormalizedCrop {
        if let crop = clip?.transform.crop {
            return CropFrameGeometry.NormalizedCrop(
                x: crop.x, y: crop.y, width: crop.width, height: crop.height
            )
        }
        return CropFrameGeometry.NormalizedCrop(x: 0, y: 0, width: 1, height: 1)
    }

    private var backdropImage: UIImage? {
        // Replaced in Phase 2.7 with the real video-snapshot / photo loader.
        return nil
    }

    private func loadInitialState() {
        flipH = clip?.transform.flipHorizontal ?? false
        flipV = clip?.transform.flipVertical ?? false
        initialFlipH = flipH
        initialFlipV = flipV
    }

    private func reset() {
        cropFrame = mediaFitRect
        lockedAspect = nil
        flipH = false
        flipV = false
    }

    private func apply() {
        let normalized = CropFrameGeometry.normalizedCrop(
            cropFrame: cropFrame,
            mediaFitRect: mediaFitRect
        )
        Task {
            await appState.setSelectedClipCrop(
                OpenReelProject.Crop(
                    x: normalized.x,
                    y: normalized.y,
                    width: normalized.width,
                    height: normalized.height
                ),
                playbackController: playbackController
            )

            if flipH != initialFlipH || flipV != initialFlipV {
                await appState.setSelectedClipFlip(
                    horizontal: flipH != initialFlipH ? flipH : nil,
                    vertical: flipV != initialFlipV ? flipV : nil,
                    playbackController: playbackController
                )
            }
        }
    }
}
```

- [ ] **Step 2: Add to the Xcode project**

Add the new file to the **Openreel Video** target via Xcode (same approach as Task 2.1 Step 4 — drag into the `Crop` group). Save the project.

- [ ] **Step 3: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`. The view compiles even though it's not yet presented anywhere.

- [ ] **Step 4: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift" \
        "Openreel Video/Openreel Video.xcodeproj"
git commit -m "feat(ios): CropEditorView shell with header + flip + reset

Layout, state, and the Cancel/Done flow plus Flip H/V/Reset buttons.
No drag handles yet, no aspect chips, no media backdrop. Phases
2.4 - 2.7 fill those in. Not yet routed from EditorView."
```

## Phase 2.4 — Aspect chips + draggable crop frame

### Task 2.4: Add aspect chips and the 8-handle crop frame overlay

**Files:**
- Modify: `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift`

- [ ] **Step 1: Replace the `aspectChips` placeholder**

In `CropEditorView.swift`, replace the body of `aspectChips`:

```swift
private var aspectChips: some View {
    Text("Aspect chips placeholder")
        .foregroundStyle(.white.opacity(0.4))
        .font(.system(size: 12, weight: .medium))
        .frame(maxWidth: .infinity)
}
```

with:

```swift
private var aspectChips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
            ForEach(Self.aspectOptions, id: \.label) { option in
                aspectChip(label: option.label, ratio: option.ratio)
            }
        }
        .padding(.horizontal, 4)
    }
}

private static let aspectOptions: [(label: String, ratio: CGFloat?)] = [
    ("Free", nil),
    ("1:1", 1.0),
    ("9:16", 9.0 / 16.0),
    ("16:9", 16.0 / 9.0),
    ("4:5", 4.0 / 5.0),
    ("4:3", 4.0 / 3.0),
    ("3:4", 3.0 / 4.0)
]

private func aspectChip(label: String, ratio: CGFloat?) -> some View {
    let isSelected = (ratio == lockedAspect) || (ratio == nil && lockedAspect == nil)
    return Button {
        applyAspect(ratio: ratio)
    } label: {
        Text(label)
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundStyle(isSelected ? .black : .white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(isSelected ? OpenReelTheme.accent : Color.white.opacity(0.08))
            )
    }
    .buttonStyle(.plain)
}

private func applyAspect(ratio: CGFloat?) {
    lockedAspect = ratio
    if let ratio {
        withAnimation(.easeInOut(duration: 0.18)) {
            cropFrame = CropFrameGeometry.snapToAspect(
                frame: cropFrame,
                aspect: ratio,
                bounds: mediaFitRect
            )
        }
    }
}
```

- [ ] **Step 2: Add the crop-frame overlay inside `previewArea`**

Replace the entire `previewArea` body:

```swift
private var previewArea: some View {
    GeometryReader { proxy in
        ZStack {
            Color.black

            if let image = backdropImage {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(x: flipH ? -1 : 1, y: flipV ? -1 : 1)
            }
        }
        .frame(width: proxy.size.width, height: proxy.size.height)
        .onAppear {
            ...
        }
    }
    .clipped()
}
```

with this expanded version that adds the crop frame and 8 handles:

```swift
private var previewArea: some View {
    GeometryReader { proxy in
        ZStack {
            Color.black

            if let image = backdropImage {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(x: flipH ? -1 : 1, y: flipV ? -1 : 1)
            }

            if mediaFitRect != .zero {
                cropFrameOverlay
            }
        }
        .frame(width: proxy.size.width, height: proxy.size.height)
        .onAppear {
            let media = mediaPixelSize ?? CGSize(width: 16, height: 9)
            mediaFitRect = CropFrameGeometry.mediaFitRect(
                previewSize: proxy.size,
                mediaSize: media
            )
            cropFrame = CropFrameGeometry.cropFrame(
                normalized: initialNormalized,
                mediaFitRect: mediaFitRect
            )
            initialCropFrame = cropFrame
        }
    }
    .clipped()
}

private var cropFrameOverlay: some View {
    ZStack(alignment: .topLeading) {
        // Dim outside the crop frame
        Rectangle()
            .fill(Color.black.opacity(0.55))
            .mask(
                cropFrameMask
            )
            .allowsHitTesting(false)

        // Crop frame border + grid
        Rectangle()
            .stroke(Color.white, lineWidth: 1.5)
            .frame(width: cropFrame.width, height: cropFrame.height)
            .offset(x: cropFrame.minX, y: cropFrame.minY)
            .allowsHitTesting(false)

        thirdsGrid
            .frame(width: cropFrame.width, height: cropFrame.height)
            .offset(x: cropFrame.minX, y: cropFrame.minY)
            .allowsHitTesting(false)

        // 4 corner + 4 edge handles
        ForEach(Self.allHandles, id: \.self) { handle in
            handleView(for: handle)
        }
    }
}

private static let allHandles: [CropFrameGeometry.Handle] = [
    .topLeft, .topRight, .bottomLeft, .bottomRight,
    .top, .bottom, .left, .right
]

private var cropFrameMask: some View {
    GeometryReader { proxy in
        Path { path in
            path.addRect(CGRect(origin: .zero, size: proxy.size))
            path.addRect(cropFrame)
        }
        .fill(style: FillStyle(eoFill: true))
    }
}

private var thirdsGrid: some View {
    GeometryReader { proxy in
        let w = proxy.size.width
        let h = proxy.size.height
        Path { path in
            path.move(to: CGPoint(x: w / 3, y: 0))
            path.addLine(to: CGPoint(x: w / 3, y: h))
            path.move(to: CGPoint(x: 2 * w / 3, y: 0))
            path.addLine(to: CGPoint(x: 2 * w / 3, y: h))
            path.move(to: CGPoint(x: 0, y: h / 3))
            path.addLine(to: CGPoint(x: w, y: h / 3))
            path.move(to: CGPoint(x: 0, y: 2 * h / 3))
            path.addLine(to: CGPoint(x: w, y: 2 * h / 3))
        }
        .stroke(Color.white.opacity(0.3), lineWidth: 0.5)
    }
}

private func handleView(for handle: CropFrameGeometry.Handle) -> some View {
    let position = handlePosition(handle)
    let isCorner: Bool = switch handle {
    case .topLeft, .topRight, .bottomLeft, .bottomRight: true
    default: false
    }

    return ZStack {
        if isCorner {
            Circle()
                .fill(Color.white)
                .frame(width: 14, height: 14)
                .overlay(Circle().stroke(Color.black.opacity(0.3), lineWidth: 0.5))
        } else {
            Capsule()
                .fill(Color.white)
                .frame(
                    width: handle == .left || handle == .right ? 4 : 24,
                    height: handle == .left || handle == .right ? 24 : 4
                )
        }
    }
    .frame(width: 44, height: 44)
    .contentShape(Rectangle())
    .position(position)
    .gesture(
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                cropFrame = CropFrameGeometry.resize(
                    frame: initialCropFrame,
                    handle: handle,
                    drag: value.translation,
                    lockedAspect: lockedAspect,
                    bounds: mediaFitRect
                )
            }
            .onEnded { _ in
                initialCropFrame = cropFrame
            }
    )
}

private func handlePosition(_ handle: CropFrameGeometry.Handle) -> CGPoint {
    switch handle {
    case .topLeft: return CGPoint(x: cropFrame.minX, y: cropFrame.minY)
    case .topRight: return CGPoint(x: cropFrame.maxX, y: cropFrame.minY)
    case .bottomLeft: return CGPoint(x: cropFrame.minX, y: cropFrame.maxY)
    case .bottomRight: return CGPoint(x: cropFrame.maxX, y: cropFrame.maxY)
    case .top: return CGPoint(x: cropFrame.midX, y: cropFrame.minY)
    case .bottom: return CGPoint(x: cropFrame.midX, y: cropFrame.maxY)
    case .left: return CGPoint(x: cropFrame.minX, y: cropFrame.midY)
    case .right: return CGPoint(x: cropFrame.maxX, y: cropFrame.midY)
    }
}
```

Add `import UIKit` at the top of the file (after `import SwiftUI`) — `UIImage` requires it on iOS targets that don't already pull it in transitively.

`CropFrameGeometry.Handle` already conforms to nothing useful for `ForEach` — make the enum `Hashable` by adding `: Hashable` to its declaration in `CropFrameGeometry.swift`:

In `Openreel Video/Openreel Video/Features/Crop/CropFrameGeometry.swift`, find:

```swift
enum Handle {
    case topLeft, topRight, bottomLeft, bottomRight
    case top, bottom, left, right
}
```

Replace with:

```swift
enum Handle: Hashable {
    case topLeft, topRight, bottomLeft, bottomRight
    case top, bottom, left, right
}
```

- [ ] **Step 3: Update `reset()` to also clear `initialCropFrame`**

In `CropEditorView`, find `reset()`:

```swift
private func reset() {
    cropFrame = mediaFitRect
    lockedAspect = nil
    flipH = false
    flipV = false
}
```

Replace with:

```swift
private func reset() {
    cropFrame = mediaFitRect
    initialCropFrame = mediaFitRect
    lockedAspect = nil
    flipH = false
    flipV = false
}
```

- [ ] **Step 4: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift" \
        "Openreel Video/Openreel Video/Features/Crop/CropFrameGeometry.swift"
git commit -m "feat(ios): crop editor aspect chips + 8 draggable handles

7 aspect chips (Free / 1:1 / 9:16 / 16:9 / 4:5 / 4:3 / 3:4) with
snap-to-aspect on tap. 4 corner + 4 edge handles with 44pt hit
areas, locked-aspect math via CropFrameGeometry.resize. Outside-
crop dimming and a rule-of-thirds grid for composition feedback."
```

## Phase 2.5 — Pan + pinch on the crop frame

### Task 2.5: Pan inside the crop frame and pinch on the media

**Files:**
- Modify: `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift`

- [ ] **Step 1: Add pan gesture inside the crop frame**

In `cropFrameOverlay`, after the `thirdsGrid` overlay and before the `ForEach(Self.allHandles)`, insert a pannable transparent rectangle that sits **inside** the crop frame:

```swift
// Pannable area inside the crop frame (drag anywhere inside to move it)
Rectangle()
    .fill(Color.clear)
    .contentShape(Rectangle())
    .frame(width: cropFrame.width, height: cropFrame.height)
    .offset(x: cropFrame.minX, y: cropFrame.minY)
    .gesture(
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                cropFrame = CropFrameGeometry.translate(
                    frame: initialCropFrame,
                    by: value.translation,
                    bounds: mediaFitRect
                )
            }
            .onEnded { _ in
                initialCropFrame = cropFrame
            }
    )
```

Place it **before** the handles `ForEach` so the handles get drawn on top and remain hit-testable. `.contentShape(Rectangle())` makes the clear rectangle hit-test as a solid rectangle.

- [ ] **Step 2: Add pinch-to-zoom for the media**

Add new state at the top of `CropEditorView` (next to the existing `@State` declarations):

```swift
@State private var mediaScale: CGFloat = 1.0
@State private var pinchStartScale: CGFloat = 1.0
```

In `previewArea`, change the `.scaleEffect(x: flipH ? -1 : 1, y: flipV ? -1 : 1)` line on the image to also apply `mediaScale`:

```swift
Image(uiImage: image)
    .resizable()
    .aspectRatio(contentMode: .fit)
    .scaleEffect(
        x: (flipH ? -1 : 1) * mediaScale,
        y: (flipV ? -1 : 1) * mediaScale
    )
```

Add a pinch gesture to the preview ZStack. After the existing `.frame(width: proxy.size.width, height: proxy.size.height)` line inside `previewArea`'s `GeometryReader`, add:

```swift
.gesture(
    MagnifyGesture()
        .onChanged { value in
            mediaScale = min(max(pinchStartScale * value.magnification, 1.0), 6.0)
        }
        .onEnded { _ in
            pinchStartScale = mediaScale
        }
)
```

- [ ] **Step 3: Update `reset()` to also restore zoom**

In `reset()`:

```swift
private func reset() {
    cropFrame = mediaFitRect
    initialCropFrame = mediaFitRect
    lockedAspect = nil
    flipH = false
    flipV = false
    mediaScale = 1.0
    pinchStartScale = 1.0
}
```

- [ ] **Step 4: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift"
git commit -m "feat(ios): pan + pinch in crop editor

Drag inside the crop frame to move it (clamped to media bounds).
MagnifyGesture on the preview area zooms the media backdrop from
1x to 6x; the crop frame stays in screen coords so the user can
crop into details."
```

## Phase 2.6 — Route from `EditorView`, delete old slider sheet

### Task 2.6: Present `CropEditorView` from `EditorView` and remove `clipCropSheet`

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift`
- Modify: `Openreel Video/Openreel Video/AppState.swift` (delete the now-unused `updateSelectedClipCrop`)

- [ ] **Step 1: Add the `fullScreenCover` state to `EditorView`**

In `EditorView.swift`, find an existing `@State` declaration near the top of the struct (around line 10). Add a new state below the existing `activeEditingSheet`:

```swift
@State private var presentedCropEditor: PresentedCropEditor?
```

In the same struct's nested type section (around line 242 where `ExportedVideo` is declared), add:

```swift
private struct PresentedCropEditor: Identifiable {
    let id = UUID()
    let clipID: String
}
```

- [ ] **Step 2: Attach the `.fullScreenCover` modifier**

In `EditorView.body`, find the existing `.sheet(item: $activeEditingSheet)` at line 388. Right after that modifier (on the next line), add:

```swift
.fullScreenCover(item: $presentedCropEditor) { presented in
    CropEditorView(clipID: presented.clipID)
        .environment(appState)
        .environment(playbackController)
}
```

- [ ] **Step 3: Reroute both "Crop" tool taps to the new editor**

In `EditorView.swift`, find line 3417–3418:

```swift
case "Crop":
    activeEditingSheet = .crop
```

Replace with:

```swift
case "Crop":
    if let clipID = appState.selectedClipID {
        activeEditingSheet = nil
        presentedCropEditor = PresentedCropEditor(clipID: clipID)
    }
```

Find the second occurrence at line 3597–3598:

```swift
case "Crop":
    activeEditingSheet = .crop
```

Replace with the same block:

```swift
case "Crop":
    if let clipID = appState.selectedClipID {
        activeEditingSheet = nil
        presentedCropEditor = PresentedCropEditor(clipID: clipID)
    }
```

- [ ] **Step 4: Remove `EditingSheet.crop` case + its branches**

In the `EditingSheet` enum (line 223), remove the `case crop` line:

```swift
private enum EditingSheet: String, Identifiable {
    case volume
    case pan
    case fade
    case speed
    case crop          // <-- delete this line
    case filters
    ...
}
```

In `editingSheetHeight(for:)` (line 3658), remove the `.crop` case (line 3672–3673):

```swift
case .crop:
    return 420
```

In `editingSheet(_:)` (line 3687), remove the `.crop` case (lines 3698–3699):

```swift
case .crop:
    clipCropSheet
```

- [ ] **Step 5: Delete the `clipCropSheet` body**

In `EditorView.swift`, find `clipCropSheet` (line 4445) and delete the entire computed property body — from `private var clipCropSheet: some View {` through its closing `}` (lines 4445–4495).

- [ ] **Step 6: Delete the unused `updateSelectedClipCrop`**

In `AppState.swift`, delete the entire `updateSelectedClipCrop` method (lines 2333–2360 of the original file — its line number may have shifted after Phase 2.2). After deletion, the only callers were the slider rows you just removed, so no other call sites should reference it.

- [ ] **Step 7: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`. If you see `cannot find 'updateSelectedClipCrop'` or `cannot find 'clipCropSheet'`, search for the remaining references and remove them.

- [ ] **Step 8: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift" \
        "Openreel Video/Openreel Video/AppState.swift"
git commit -m "feat(ios): route Crop tool to full-screen CropEditorView

Both Crop tool tap paths now present CropEditorView as a
.fullScreenCover. Deleted: the EditingSheet.crop case, the
clipCropSheet slider body, and the per-axis updateSelectedClipCrop
AppState method (only the deleted sliders called it)."
```

## Phase 2.7 — Wire up the media backdrop

### Task 2.7: Load real photo / video-frame backdrop into `CropEditorView`

**Files:**
- Modify: `Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift`

- [ ] **Step 1: Replace `backdropImage` with real loading**

In `CropEditorView`, find:

```swift
private var backdropImage: UIImage? {
    // Replaced in Phase 2.7 with the real video-snapshot / photo loader.
    return nil
}
```

Replace with:

```swift
@State private var backdrop: UIImage? = nil

private var backdropImage: UIImage? { backdrop }

private func loadBackdrop() {
    guard let clip,
          let project = appState.currentProject,
          let media = appState.mediaItem(for: clip.mediaId, in: project),
          let url = appState.mediaURL(for: media, in: project) else {
        backdrop = nil
        return
    }

    switch media.type {
    case .image:
        backdrop = UIImage(contentsOfFile: url.path)
    case .video:
        if let snapshot = MetalVideoSnapshotProvider.snapshot {
            let ciContext = CIContext()
            if let cgImage = ciContext.createCGImage(snapshot, from: snapshot.extent) {
                backdrop = UIImage(cgImage: cgImage)
                return
            }
        }
        Task { @MainActor in
            backdrop = await loadFirstFrame(from: url)
        }
    case .audio:
        backdrop = nil
    }
}

private func loadFirstFrame(from url: URL) async -> UIImage? {
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    let time = CMTime(seconds: max(playbackController.currentTime, 0), preferredTimescale: 600)
    return await withCheckedContinuation { continuation in
        generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { _, cgImage, _, _, _ in
            if let cgImage {
                continuation.resume(returning: UIImage(cgImage: cgImage))
            } else {
                continuation.resume(returning: nil)
            }
        }
    }
}
```

- [ ] **Step 2: Add `import AVFoundation` and `import CoreImage` at the top of the file**

The top of `CropEditorView.swift` should now have:

```swift
import AVFoundation
import CoreImage
import SwiftUI
import UIKit
```

- [ ] **Step 3: Invoke `loadBackdrop()` on appear**

Find the `.onAppear { loadInitialState() }` modifier on the outer `VStack`. Change it to:

```swift
.onAppear {
    loadInitialState()
    loadBackdrop()
}
```

- [ ] **Step 4: Build**

```bash
xcodebuild -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "generic/platform=iOS Simulator" \
  -quiet build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/Crop/CropEditorView.swift"
git commit -m "feat(ios): load media backdrop in CropEditorView

Photos load directly via UIImage(contentsOfFile:). Videos prefer
MetalVideoSnapshotProvider.snapshot (already in memory from the
preview); fall back to AVAssetImageGenerator at the current
playhead time."
```

## Phase 2.8 — End-to-end verification

### Task 2.8: Full suite + manual smoke

- [ ] **Step 1: Run the full test suite**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 17,OS=26.5" \
  -only-testing:"Openreel VideoTests" \
  -quiet
```

Expected: `CropFrameGeometryTests` (6 tests) green. Pre-existing test failures from `MOBILE-CODE-REVIEW-2026-05-27.md` are not regressions caused by this work; only flag new failures.

- [ ] **Step 2: Manual smoke — photo crop**

1. Launch the app in Simulator (iPhone 17, iOS 26.5).
2. Create a project, import a still photo, drop it on the timeline.
3. Tap the photo clip, then tap the "Crop" tool.
4. Verify the full-screen editor opens with the photo visible.
5. Drag corner handles — crop frame resizes from the corner.
6. Drag inside the frame — frame pans within the photo bounds.
7. Pinch on the photo — photo zooms 1x to 6x.
8. Tap "1:1" — crop frame snaps to a square centered on its current position.
9. Tap "16:9", then drag a corner — confirm the aspect ratio is preserved.
10. Tap "Free" — confirm subsequent drags don't preserve ratio.
11. Tap "Flip H" — photo mirrors horizontally.
12. Tap "Reset" — full-frame crop, no flip, 1x zoom.
13. Tap "Done" — return to editor. Verify the timeline preview shows the cropped photo.
14. Re-open Crop on the same clip — verify the previous crop state is restored.

- [ ] **Step 3: Manual smoke — video crop**

1. Import a video, drop it on the timeline.
2. Seek to a recognizable frame on the timeline.
3. Tap the clip, tap "Crop".
4. Verify the backdrop shows the frame near the current playhead (not necessarily exact — AVAssetImageGenerator returns the closest keyframe).
5. Same gesture checks as photo (corners, edges, pan, pinch, aspect snap, flip, reset).
6. Tap "Done". Verify the timeline preview reflects the crop.

- [ ] **Step 4: Workstream 2 sign-off**

If both photo and video paths pass, Workstream 2 is complete. Push the branch:

```bash
git push -u origin feat/ios-app
```

(Or your branch name if it differs.)

- [ ] **Step 5: Final commit (if any cleanup found during smoke)**

If smoke testing revealed any small leftover issue (e.g., a haptic missing, an off-by-one in the crop reset), fix it and commit:

```bash
git add <files>
git commit -m "fix(ios): <whatever-the-fix-was> in CropEditorView"
```

Otherwise nothing more is needed — the per-task commits already shipped everything.

---

## Self-review

Run through the spec one more time and check the plan covers it:

- **Workstream 1, change 1** (suppress moveGesture during trim): Tasks 1.1–1.4 Steps 4 / 5 ✓
- **Workstream 1, change 2** (leading edge follows finger): Tasks 1.1–1.4 Step 3 ✓
- **Workstream 1, change 3** (async onTrim, no release pop): Tasks 1.1–1.4 Steps 1, 5, 6 ✓
- **Workstream 1, all 4 clip block types**: Tasks 1.1–1.4 ✓
- **Workstream 2, new file `CropEditorView.swift`**: Tasks 2.3, 2.4, 2.5, 2.7 ✓
- **Workstream 2, new file `CropFrameGeometry.swift` + tests**: Task 2.1 ✓
- **Workstream 2, fullScreenCover route**: Task 2.6 Step 2 ✓
- **Workstream 2, 8 handles, aspect chips, pan, pinch, flip, reset, Cancel/Done**: Tasks 2.3, 2.4, 2.5 ✓
- **Workstream 2, video backdrop via MetalVideoSnapshotProvider with AVAssetImageGenerator fallback**: Task 2.7 ✓
- **Workstream 2, photo backdrop via UIImage(contentsOfFile:)**: Task 2.7 ✓
- **Workstream 2, delete `clipCropSheet`, `EditingSheet.crop`, `updateSelectedClipCrop`**: Task 2.6 ✓
- **Workstream 2, reuse existing `OpenReelProject.Crop` model unchanged**: ✓ (no model task — by design)
- **Workstream 2, opacity + Fit mode stay in their existing tool paths**: ✓ (Crop editor never references them)

No gaps. Ship it.
