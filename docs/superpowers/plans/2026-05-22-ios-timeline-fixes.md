# iOS Timeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the iOS-timeline fixes from `docs/superpowers/specs/2026-05-22-ios-timeline-fixes-design.md` — zoom chip, dark-preview-after-split fix, snap-and-no-overlap on same track, cross-track moves between same-type tracks, and a small split/move polish layer.

**Architecture:** A new `resolveClipPlacement` in `AppState` centralizes snap-and-collision logic so every move path uses one source of truth. The dark-preview fix is split between `PlaybackCompositionBuilder` (skip custom compositor when no transitions exist) and `MetalVideoView` (nudge by a full frame, not 1.67 ms). UI changes are wrapped around the existing `TimelineClipBlock` family — the move gesture is extracted into a shared helper that handles 2-D translation.

**Tech Stack:** Swift 5.10+, SwiftUI, AVFoundation (`AVMutableComposition`, `AVMutableVideoComposition`, `AVPlayerItemVideoOutput`), MetalKit, Swift Testing (`import Testing`, `@Test`, `#expect`).

**Test runner:** From the repo root:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/<ClassName>" \
  -quiet
```

Replace `<ClassName>` with the test class for the task. Drop `-only-testing:` to run the whole suite. Each task lists its expected exit state — use that to confirm a task is done.

**Branch:** Already on `feat/ios-app`. Commit per task with the conventional-commit prefix shown in each step.

---

## File Structure

Files this plan creates or modifies, with the responsibility of each:

| File | Purpose | Status |
|---|---|---|
| `Openreel Video/Openreel VideoTests/PlaybackCompositionBuilderTests.swift` | Branch-boundary tests for the custom-compositor branch | **Create** |
| `Openreel Video/Openreel VideoTests/PlacementResolverTests.swift` | Unit tests for `resolveClipPlacement` and `destinationTrack` | **Create** |
| `Openreel Video/Openreel Video/Core/Playback/PlaybackCompositionBuilder.swift` | Add `transitions.isEmpty` branch in `buildVideoComposition`, plus `buildPassthroughInstructions` helper | Modify |
| `Openreel Video/Openreel Video/Features/Preview/MetalVideoView.swift` | Replace nudge magnitude, add `pumpFrameUntilDelivered`, KVO on `currentItem` | Modify |
| `Openreel Video/Openreel Video/AppState.swift` | New `resolveClipPlacement`, `destinationTrack`, `moveClip` overload; existing `moveClip` becomes a thin wrapper | Modify |
| `Openreel Video/Openreel Video/EditorView.swift` | New `TimelineZoomChip` subview; new `makeMoveGesture` helper used by all four `Timeline*ClipBlock` types; snap-edge overlay; scissors mini-button; post-split playhead seek | Modify |

All work stays in two existing test files' directory and three existing source directories. No new module, no Xcode project changes (Swift Testing files auto-discover from the test target's directory, matching the existing `FilterEndToEndTests.swift` pattern).

---

## Phase 1 — Dark preview fix (spec §6)

The most user-visible bug. Ship-able independently.

### Task 1: Backstop tests for the custom-compositor branch boundary

**Files:**
- Create: `Openreel Video/Openreel VideoTests/PlaybackCompositionBuilderTests.swift`

- [ ] **Step 1: Write the failing tests**

Create the file with this content:

```swift
import AVFoundation
import Foundation
import Testing
@testable import Openreel_Video

@MainActor
struct PlaybackCompositionBuilderTests {
    @Test func twoSourcesNoTransitionsDoesNotUseCustomCompositor() async throws {
        let url = try await Self.makeSampleVideoURL()
        defer { try? FileManager.default.removeItem(at: url) }

        let sourceA = makeSource(id: "a", url: url, startTime: 0, duration: 0.5)
        let sourceB = makeSource(id: "b", url: url, startTime: 0.5, duration: 0.5)

        let result = await PlaybackCompositionBuilder.build(
            sources: [sourceA, sourceB],
            transitions: [],
            frameRate: 30
        )

        let composition = try #require(result?.videoComposition)
        #expect(composition.customVideoCompositorClass == nil)
        #expect(composition.instructions.count >= 2)
    }

    @Test func twoSourcesWithTransitionUsesCustomCompositor() async throws {
        let url = try await Self.makeSampleVideoURL()
        defer { try? FileManager.default.removeItem(at: url) }

        let sourceA = makeSource(id: "a", url: url, startTime: 0, duration: 0.5)
        let sourceB = makeSource(id: "b", url: url, startTime: 0.5, duration: 0.5)
        let transition = PlaybackController.TimelineTransition(
            id: "t1",
            clipAId: "a",
            clipBId: "b",
            type: "crossfade",
            duration: 0.2,
            params: [:]
        )

        let result = await PlaybackCompositionBuilder.build(
            sources: [sourceA, sourceB],
            transitions: [transition],
            frameRate: 30
        )

        let composition = try #require(result?.videoComposition)
        #expect(composition.customVideoCompositorClass == TransitionVideoCompositor.self)
    }

    @Test func singleSourceProducesNoVideoComposition() async throws {
        let url = try await Self.makeSampleVideoURL()
        defer { try? FileManager.default.removeItem(at: url) }

        let source = makeSource(id: "only", url: url, startTime: 0, duration: 1)

        let result = await PlaybackCompositionBuilder.build(
            sources: [source],
            transitions: [],
            frameRate: 30
        )

        #expect(result?.videoComposition == nil)
    }

    private func makeSource(
        id: String,
        url: URL,
        startTime: TimeInterval,
        duration: TimeInterval
    ) -> PlaybackController.TimelineSource {
        PlaybackController.TimelineSource(
            id: id,
            url: url,
            kind: .video,
            startTime: startTime,
            duration: duration,
            inPoint: 0,
            outPoint: duration,
            speed: 1,
            volume: 1,
            includesVideo: true,
            includesAudio: false
        )
    }

    private static func makeSampleVideoURL() async throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("\(UUID().uuidString).mov")

        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 32,
            AVVideoHeightKey: 32
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                kCVPixelBufferWidthKey as String: 32,
                kCVPixelBufferHeightKey as String: 32
            ]
        )
        guard writer.canAdd(input) else {
            throw NSError(domain: "PlaybackCompositionBuilderTests", code: -1)
        }
        writer.add(input)
        guard writer.startWriting() else {
            throw writer.error ?? NSError(domain: "PlaybackCompositionBuilderTests", code: -2)
        }
        writer.startSession(atSourceTime: .zero)

        var pixelBuffer: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, 32, 32, kCVPixelFormatType_32ARGB, nil, &pixelBuffer)
        guard let buffer = pixelBuffer else {
            throw NSError(domain: "PlaybackCompositionBuilderTests", code: -3)
        }
        CVPixelBufferLockBaseAddress(buffer, [])
        if let base = CVPixelBufferGetBaseAddress(buffer) {
            memset(base, 0xFF, CVPixelBufferGetDataSize(buffer))
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])

        let frameCount = 30
        for frameIndex in 0..<frameCount {
            while !input.isReadyForMoreMediaData {
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            let time = CMTime(value: CMTimeValue(frameIndex), timescale: 30)
            _ = adaptor.append(buffer, withPresentationTime: time)
        }

        input.markAsFinished()
        await writer.finishWriting()
        return url
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail in the expected way**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlaybackCompositionBuilderTests" \
  -quiet
```

Expected: `twoSourcesNoTransitionsDoesNotUseCustomCompositor` FAILS (current code sets `customVideoCompositorClass = TransitionVideoCompositor.self` even with zero transitions). The other two tests should PASS.

- [ ] **Step 3: Commit**

```bash
git add "Openreel Video/Openreel VideoTests/PlaybackCompositionBuilderTests.swift"
git commit -m "test(ios): branch-boundary tests for PlaybackCompositionBuilder"
```

---

### Task 2: Skip custom compositor when no transitions exist (B1)

**Files:**
- Modify: `Openreel Video/Openreel Video/Core/Playback/PlaybackCompositionBuilder.swift`

- [ ] **Step 1: Read the existing `buildVideoComposition` function to understand its current shape**

Read `Core/Playback/PlaybackCompositionBuilder.swift` lines 655-717. Notice that `CompositorPassthroughInstruction` is custom-compositor-only — when we skip the custom class we must replace those instructions with stock `AVMutableVideoCompositionInstruction` + `AVMutableVideoCompositionLayerInstruction` pairs.

- [ ] **Step 2: Replace `buildVideoComposition` with the branched version**

Open the file and replace lines 655-717 (the entire `buildVideoComposition` function) with:

```swift
    private static func buildVideoComposition(
        composition: AVMutableComposition,
        transitions: [PlaybackController.TimelineTransition],
        sources: [PlaybackController.TimelineSource],
        clipTrackMap: [String: CMPersistentTrackID],
        renderSize: CGSize?,
        frameRate: Double
    ) -> AVMutableVideoComposition? {
        guard let sourceRenderSize = renderSize,
              sourceRenderSize.width > 0,
              sourceRenderSize.height > 0,
              sources.count >= 2
        else {
            return nil
        }

        let resolvedRenderSize = previewRenderSize(for: sourceRenderSize)
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(frameRate.rounded(), 1)))

        if transitions.isEmpty {
            let instructions = buildPassthroughLayerInstructions(
                composition: composition,
                sources: sources,
                clipTrackMap: clipTrackMap,
                renderSize: resolvedRenderSize
            )
            guard !instructions.isEmpty else { return nil }

            let videoComposition = AVMutableVideoComposition()
            videoComposition.instructions = instructions
            videoComposition.renderSize = resolvedRenderSize
            videoComposition.frameDuration = frameDuration
            return videoComposition
        }

        let transitionLookup = buildTransitionLookup(transitions: transitions, sources: sources)
        var segments = buildTimeSegments(sources: sources, transitionLookup: transitionLookup, clipTrackMap: clipTrackMap)
        segments.sort { $0.timeRange.start < $1.timeRange.start }

        var instructions: [AVVideoCompositionInstructionProtocol] = []
        for segment in segments {
            switch segment.kind {
            case .passthrough(let trackID):
                let instruction = CompositorPassthroughInstruction(
                    timeRange: segment.timeRange,
                    sourceTrackID: trackID
                )
                instructions.append(instruction)
            case .transition(let outgoingTrackID, let incomingTrackID, let transitionData):
                let instruction = TransitionInstruction(
                    timeRange: segment.timeRange,
                    outgoingTrackID: outgoingTrackID,
                    incomingTrackID: incomingTrackID,
                    transitionType: transitionData.type,
                    transitionParams: transitionData.params,
                    renderSize: resolvedRenderSize
                )
                instructions.append(instruction)
            }
        }

        guard !instructions.isEmpty else { return nil }

        let videoComposition = AVMutableVideoComposition()
        videoComposition.instructions = instructions
        videoComposition.renderSize = resolvedRenderSize
        videoComposition.frameDuration = frameDuration
        videoComposition.customVideoCompositorClass = TransitionVideoCompositor.self
        return videoComposition
    }

    private static func buildPassthroughLayerInstructions(
        composition: AVMutableComposition,
        sources: [PlaybackController.TimelineSource],
        clipTrackMap: [String: CMPersistentTrackID],
        renderSize: CGSize
    ) -> [AVMutableVideoCompositionInstruction] {
        let videoTracks = composition.tracks(withMediaType: .video)
        guard !videoTracks.isEmpty else { return [] }
        let tracksByID = Dictionary(uniqueKeysWithValues: videoTracks.map { ($0.trackID, $0) })

        var instructions: [AVMutableVideoCompositionInstruction] = []
        for source in sources {
            guard let trackID = clipTrackMap[source.id],
                  let activeTrack = tracksByID[trackID]
            else { continue }

            let startTime = CMTime(seconds: max(source.startTime, 0), preferredTimescale: 600)
            let duration = CMTime(seconds: max(source.duration, 0), preferredTimescale: 600)
            guard duration.seconds > 0 else { continue }

            let timeRange = CMTimeRange(start: startTime, duration: duration)
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = timeRange

            var layerInstructions: [AVVideoCompositionLayerInstruction] = []
            for track in videoTracks {
                let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
                if track.trackID == activeTrack.trackID {
                    layer.setOpacity(1.0, at: timeRange.start)
                    let transform = aspectFitTransform(
                        sourceTransform: activeTrack.preferredTransform,
                        sourceNaturalSize: activeTrack.naturalSize,
                        renderSize: renderSize
                    )
                    layer.setTransform(transform, at: timeRange.start)
                } else {
                    layer.setOpacity(0.0, at: timeRange.start)
                }
                layerInstructions.append(layer)
            }

            instruction.layerInstructions = layerInstructions
            instructions.append(instruction)
        }

        instructions.sort { $0.timeRange.start < $1.timeRange.start }
        return instructions
    }

    private static func aspectFitTransform(
        sourceTransform: CGAffineTransform,
        sourceNaturalSize: CGSize,
        renderSize: CGSize
    ) -> CGAffineTransform {
        let orientedSize = CGRect(origin: .zero, size: sourceNaturalSize)
            .applying(sourceTransform)
            .standardized
            .size
        let width = abs(orientedSize.width)
        let height = abs(orientedSize.height)
        guard width > 0, height > 0, renderSize.width > 0, renderSize.height > 0 else {
            return sourceTransform
        }

        let scaleX = renderSize.width / width
        let scaleY = renderSize.height / height
        let scale = min(scaleX, scaleY)
        let scaledWidth = width * scale
        let scaledHeight = height * scale
        let offsetX = (renderSize.width - scaledWidth) / 2
        let offsetY = (renderSize.height - scaledHeight) / 2

        return sourceTransform
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: offsetX, y: offsetY))
    }
```

The function header (`private static func buildVideoComposition`) is unchanged so the existing caller `let videoComposition = buildVideoComposition(...)` at line ~603 keeps working.

- [ ] **Step 3: Run the tests to verify they all pass**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlaybackCompositionBuilderTests" \
  -quiet
```

Expected: all three tests PASS.

- [ ] **Step 4: Build the app to confirm no compile regressions elsewhere**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/Core/Playback/PlaybackCompositionBuilder.swift"
git commit -m "fix(ios): skip custom compositor when no transitions

Two video sources with no transitions previously forced the path
through TransitionVideoCompositor, which silently delivered black
frames when AVPlayer was not actively requesting renders. Use
standard layer instructions for the passthrough case so AVPlayer's
built-in compositor handles rendering directly."
```

---

### Task 3: Reliable paused-frame nudge (B2)

**Files:**
- Modify: `Openreel Video/Openreel Video/Features/Preview/MetalVideoView.swift`

- [ ] **Step 1: Replace `forceCompositorRefresh`**

Open `Features/Preview/MetalVideoView.swift`. Find `forceCompositorRefresh` (lines 226-238) and replace it with:

```swift
    private func forceCompositorRefresh(on item: AVPlayerItem) {
        guard let player = currentPlayer, player.currentItem === item else { return }
        let resolvedFrameRate = max(frameRate, 1)
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(resolvedFrameRate.rounded()))
        let currentTime = player.currentTime()
        let nudgedTime = CMTimeAdd(currentTime, frameDuration)

        player.seek(to: nudgedTime, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] _ in
            Task { @MainActor [weak self, weak player] in
                guard let self, let player else { return }
                player.seek(to: currentTime, toleranceBefore: .zero, toleranceAfter: .zero)
                self.pumpFrameUntilDelivered(remainingAttempts: 3)
            }
        }
    }

    private func pumpFrameUntilDelivered(remainingAttempts: Int) {
        metalView.draw()
        guard remainingAttempts > 0, lastFrame == nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.033) { [weak self] in
            guard let self else { return }
            self.pumpFrameUntilDelivered(remainingAttempts: remainingAttempts - 1)
        }
    }
```

- [ ] **Step 2: Add KVO on `currentItem` so item swaps re-trigger the nudge**

In the same file, find the private property block near the top of `VideoPlayerUIView` (~line 44-56). Add this property next to `itemReadyObserver`:

```swift
    private var currentItemObserver: NSKeyValueObservation?
```

Then update `setPlayer(_:)` (lines 98-106) to install/tear down the observer:

```swift
    func setPlayer(_ player: AVPlayer?) {
        guard currentPlayer !== player else { return }
        detachVideoOutput()
        currentItemObserver?.invalidate()
        currentItemObserver = nil
        currentPlayer = player
        lastFrame = nil
        resetAIContext()
        installVideoOutput()
        if let player {
            currentItemObserver = player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.detachVideoOutput()
                    self.lastFrame = nil
                    self.installVideoOutput()
                    self.metalView.draw()
                }
            }
        }
        metalView.draw()
    }
```

- [ ] **Step 3: Build to confirm no regressions**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Run the full test suite to confirm nothing else regressed**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: all tests PASS.

- [ ] **Step 5: Manual smoke test the original bug**

Launch the iOS app in the simulator, open a project with a single video clip, hit the toolbar Split button, then press Play. Expected: video plays, preview shows frames (not black). If you observe black frames anywhere in this flow, stop and re-read Section 6 of the spec — the fix is incomplete.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/Features/Preview/MetalVideoView.swift"
git commit -m "fix(ios): nudge paused frame by one full frame, not 1.67ms

The previous nudge of CMTime(value: 1, timescale: 600) was smaller
than one frame at 30fps; with toleranceBefore/After: .zero AVPlayer
rounded back to the same frame and never re-invoked the compositor.
Nudge by an actual frame, retry up to 3x100ms if no buffer lands,
and re-install the video output if the AVPlayer's currentItem
changes underneath us."
```

---

## Phase 2 — Zoom controller (spec §5)

Small, low-risk, immediately visible win.

### Task 4: Add `TimelineZoomChip` in the top-right of the timeline

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift`

- [ ] **Step 1: Read the current `timeline(for:)` body to find the insertion point**

Read `EditorView.swift` lines 1805-1918. The `timeline(for:)` function ends with `.overlay(alignment: .top) { ... }` (the 1 pt divider line). We will add a sibling overlay at `.topTrailing`.

- [ ] **Step 2: Add the `TimelineZoomChip` private struct**

Locate the bottom of the `EditorView` extension that holds the `timeline(for:)` function (just before the next `private struct` definition — search for `private struct TimelineClipBlock` to find the boundary, ~line 4616). Immediately *before* `private struct TimelineClipBlock: View {`, insert:

```swift
private struct TimelineZoomChip: View {
    @Binding var zoom: Double
    let fitZoom: () -> Double

    private let minZoom: Double = 20
    private let maxZoom: Double = 300
    private let defaultZoom: Double = 48
    private let stepFactor: Double = 1.5

    private static let presets: [(label: String, value: Double?)] = [
        ("25%", 12),
        ("50%", 24),
        ("100%", 48),
        ("200%", 96),
        ("400%", 192),
        ("Fit", nil)
    ]

    var body: some View {
        HStack(spacing: 6) {
            Button {
                step(direction: -1)
            } label: {
                Image(systemName: "minus")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Zoom out")

            Menu {
                ForEach(Array(Self.presets.enumerated()), id: \.offset) { _, preset in
                    Button(preset.label) {
                        applyPreset(preset.value)
                    }
                }
            } label: {
                Text(percentLabel)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(minWidth: 44)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .simultaneousGesture(
                TapGesture().onEnded {
                    applyPreset(defaultZoom)
                }
            )
            .accessibilityLabel("Zoom presets, current \(percentLabel)")

            Button {
                step(direction: 1)
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Zoom in")
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(OpenReelTheme.surfaceElevated, in: Capsule())
        .overlay(
            Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var percentLabel: String {
        "\(Int((zoom / defaultZoom * 100).rounded()))%"
    }

    private func step(direction: Int) {
        let factor = direction > 0 ? stepFactor : 1.0 / stepFactor
        withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
            zoom = min(max(zoom * factor, minZoom), maxZoom)
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func applyPreset(_ value: Double?) {
        let target = value ?? fitZoom()
        withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
            zoom = min(max(target, minZoom), maxZoom)
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}
```

- [ ] **Step 3: Wire the chip into `timeline(for:)`**

In `timeline(for:)` (around line 1911-1917), find the existing `.overlay(alignment: .top)` modifier:

```swift
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.04))
                .frame(height: 1)
        }
    }
```

Add a sibling overlay directly above it (so it comes *before* `.overlay(alignment: .top)`):

```swift
        .overlay(alignment: .topTrailing) {
            TimelineZoomChip(
                zoom: Binding(
                    get: { appState.timelineZoom },
                    set: { appState.timelineZoom = $0 }
                ),
                fitZoom: {
                    let duration = max(project.timeline.duration, 1)
                    let badgeWidth = 48.0
                    let badgeGap = 10.0
                    let horizontalPadding = 24.0
                    let availableWidth = proxy.size.width - badgeWidth - badgeGap - horizontalPadding
                    return max(20, min(300, availableWidth / duration))
                }
            )
            .padding(.trailing, 12)
            .padding(.top, 6)
        }
```

`proxy` and `project` are both in scope inside the `GeometryReader { proxy in ... }` body of `timeline(for:)`.

- [ ] **Step 4: Build**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Manual UI check**

Launch the simulator. Open any project. Confirm:
- The chip appears in the top-right of the timeline.
- `−` reduces zoom, `+` increases it; both clamped at `20`/`300`.
- Tapping the percent label resets to 100% (48 px/sec).
- Long-pressing the percent label opens a `Menu` with the six presets.
- "Fit" makes the entire timeline duration just fit the visible width.
- Pinch still works on the timeline body.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "feat(ios): timeline zoom chip in top-right"
```

---

## Phase 3 — Placement resolver (spec §7, state-layer only)

Pure logic. Test-driven. No UI changes here.

### Task 5: Test `resolveClipPlacement` — no-conflict and basic snap

**Files:**
- Create: `Openreel Video/Openreel VideoTests/PlacementResolverTests.swift`

- [ ] **Step 1: Write the initial failing tests**

Create the file with this content:

```swift
import Foundation
import Testing
@testable import Openreel_Video

@MainActor
struct PlacementResolverTests {
    @Test func emptyDestinationTrackReturnsFrameSnappedProposed() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "T1", clips: [
                .init(id: "moving", start: 0, duration: 2)
            ])
        ])

        let resolution = harness.appState.resolveClipPlacement(
            clipID: "moving",
            proposedStart: 3.0,
            destinationTrackID: "T1",
            in: project
        )

        #expect(resolution?.start == 3.0)
        #expect(resolution?.trackID == "T1")
        #expect(resolution?.didSnap == false)
    }

    @Test func snapsToNeighborTrailingEdgeWhenWithinThreshold() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "T1", clips: [
                .init(id: "moving", start: 5, duration: 2),
                .init(id: "left", start: 0, duration: 2)
            ])
        ])

        let resolution = harness.appState.resolveClipPlacement(
            clipID: "moving",
            proposedStart: 2.05,
            destinationTrackID: "T1",
            in: project
        )

        #expect(resolution?.start == 2.0)
        #expect(resolution?.didSnap == true)
    }

    @Test func unknownClipReturnsNil() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "T1", clips: [])
        ])

        let resolution = harness.appState.resolveClipPlacement(
            clipID: "ghost",
            proposedStart: 0,
            destinationTrackID: "T1",
            in: project
        )

        #expect(resolution == nil)
    }
}

// MARK: - Test harness

@MainActor
private struct Harness {
    let appState: AppState

    init() {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("PlacementResolverTests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.appState = AppState(
            projectStore: ProjectStore(baseURL: directory),
            mediaImportService: MediaImportService()
        )
    }

    enum TrackBuilder {
        case video(id: String, clips: [ClipFixture])
        case audio(id: String, clips: [ClipFixture])

        var trackID: String {
            switch self {
            case .video(let id, _), .audio(let id, _): return id
            }
        }
    }

    struct ClipFixture {
        let id: String
        let start: TimeInterval
        let duration: TimeInterval
    }

    func makeProject(tracks: [TrackBuilder]) -> OpenReelProject {
        var project = OpenReelProject.blank(
            configuration: NewProjectConfiguration(
                name: "PlacementResolverTests",
                preset: NewProjectConfiguration.presets[0],
                frameRate: 30
            )
        )
        project.timeline.tracks.removeAll()
        for trackBuilder in tracks {
            let type: OpenReelProject.TrackType
            let clips: [ClipFixture]
            switch trackBuilder {
            case .video(_, let c): type = .video; clips = c
            case .audio(_, let c): type = .audio; clips = c
            }
            let track = OpenReelProject.Track(
                id: trackBuilder.trackID,
                type: type,
                name: trackBuilder.trackID,
                clips: clips.map { fixture in
                    OpenReelProject.Clip(
                        id: fixture.id,
                        mediaId: "media-\(fixture.id)",
                        trackId: trackBuilder.trackID,
                        startTime: fixture.start,
                        duration: fixture.duration,
                        inPoint: 0,
                        outPoint: fixture.duration,
                        effects: [],
                        audioEffects: [],
                        transform: OpenReelProject.Transform(
                            position: OpenReelProject.Point(x: 0.5, y: 0.5),
                            scale: OpenReelProject.Point(x: 1, y: 1),
                            rotation: 0,
                            anchor: OpenReelProject.Point(x: 0.5, y: 0.5),
                            opacity: 1,
                            borderRadius: nil,
                            fitMode: .contain,
                            crop: nil
                        ),
                        volume: 1,
                        keyframes: [],
                        speed: 1,
                        reversed: false,
                        audioTrackIndex: nil
                    )
                },
                transitions: [],
                locked: false,
                hidden: false,
                muted: false,
                solo: false
            )
            project.timeline.tracks.append(track)
        }
        return project
    }
}
```

The explicit `Transform(position:scale:rotation:anchor:opacity:borderRadius:fitMode:crop:)` initializer mirrors the pattern used in `Openreel_VideoTests.swift` around line 3014; `audioConfiguration` is omitted so the synthesized memberwise initializer fills in `AudioConfiguration()`.

- [ ] **Step 2: Run the tests — they will fail to compile (no `resolveClipPlacement` exists yet)**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlacementResolverTests" \
  -quiet
```

Expected: compile error "value of type 'AppState' has no member 'resolveClipPlacement'". This is the failing-test state for Task 6.

- [ ] **Step 3: Commit the failing tests**

```bash
git add "Openreel Video/Openreel VideoTests/PlacementResolverTests.swift"
git commit -m "test(ios): failing tests for placement resolver — no conflict, snap-to-edge, unknown clip"
```

---

### Task 6: Implement `resolveClipPlacement` for the no-conflict + edge-snap cases

**Files:**
- Modify: `Openreel Video/Openreel Video/AppState.swift`

- [ ] **Step 1: Add the resolution struct and the method**

Open `AppState.swift`. Find the end of the `AppState` class (look for the closing `}` of the class — search for `private extension Collection` near line 5256 and add code immediately before that closing brace of `AppState`, around line 5253).

Add this inside the `AppState` class (so it has access to private helpers):

```swift
    struct PlacementResolution: Equatable {
        let start: TimeInterval
        let trackID: String
        let didSnap: Bool
    }

    func resolveClipPlacement(
        clipID: String,
        proposedStart: TimeInterval,
        destinationTrackID: String,
        in project: OpenReelProject
    ) -> PlacementResolution? {
        guard let movingClip = project.allClips.first(where: { $0.id == clipID }) else {
            return nil
        }
        let duration = movingClip.duration
        let frameRate = max(project.settings.frameRate, 1)
        let frameDuration = 1.0 / frameRate

        let clampedProposed = max(proposedStart, 0)
        let frameSnapped = (clampedProposed / frameDuration).rounded() * frameDuration

        let snapEdges = collectSnapEdges(in: project, excludingClipID: clipID)
        let snapThreshold = max(0.05, 8.0 / max(timelineZoom, 1))

        var edgeSnappedStart = frameSnapped
        var didEdgeSnap = false
        for edge in snapEdges {
            if abs(edge - frameSnapped) < snapThreshold {
                edgeSnappedStart = edge
                didEdgeSnap = true
                break
            }
            if abs(edge - (frameSnapped + duration)) < snapThreshold {
                edgeSnappedStart = max(0, edge - duration)
                didEdgeSnap = true
                break
            }
        }

        guard let destinationTrack = project.timeline.tracks.first(where: { $0.id == destinationTrackID }) else {
            return nil
        }
        let neighbors = destinationTrack.clips
            .filter { $0.id != clipID }
            .map { (start: $0.startTime, end: $0.startTime + $0.duration) }
            .sorted { $0.start < $1.start }

        if rangesAreFree(start: edgeSnappedStart, duration: duration, neighbors: neighbors) {
            return PlacementResolution(start: edgeSnappedStart, trackID: destinationTrackID, didSnap: didEdgeSnap)
        }

        var candidates: Set<Double> = [0]
        for neighbor in neighbors {
            candidates.insert(neighbor.end)
            candidates.insert(max(0, neighbor.start - duration))
        }
        let validCandidates = candidates
            .filter { rangesAreFree(start: $0, duration: duration, neighbors: neighbors) }
            .sorted { abs($0 - edgeSnappedStart) < abs($1 - edgeSnappedStart) }

        guard let chosen = validCandidates.first else {
            return nil
        }

        return PlacementResolution(start: chosen, trackID: destinationTrackID, didSnap: true)
    }

    private func rangesAreFree(
        start: TimeInterval,
        duration: TimeInterval,
        neighbors: [(start: TimeInterval, end: TimeInterval)]
    ) -> Bool {
        let candidateEnd = start + duration
        for neighbor in neighbors {
            if start < neighbor.end - 0.0001 && candidateEnd > neighbor.start + 0.0001 {
                return false
            }
        }
        return true
    }

    private func collectSnapEdges(
        in project: OpenReelProject,
        excludingClipID: String
    ) -> [TimeInterval] {
        var edges: Set<Double> = [0]
        for track in project.timeline.tracks {
            for clip in track.clips where clip.id != excludingClipID {
                edges.insert(clip.startTime)
                edges.insert(clip.startTime + clip.duration)
            }
        }
        for textClip in project.textClips {
            edges.insert(textClip.startTime)
            edges.insert(textClip.startTime + textClip.duration)
        }
        for graphicsClip in project.graphicsClips {
            edges.insert(graphicsClip.startTime)
            edges.insert(graphicsClip.startTime + graphicsClip.duration)
        }
        for marker in project.timeline.markers {
            edges.insert(marker.time)
        }
        return edges.sorted()
    }
```

- [ ] **Step 2: Run the tests**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlacementResolverTests" \
  -quiet
```

Expected: all three tests PASS. If the `OpenReelProject.Transform.identity` / `AudioConfiguration()` symbols don't compile, look up the actual initializers in `Core/Models/OpenReelProject.swift` and fix the test fixture's clip construction; the resolver itself does not depend on those values.

- [ ] **Step 3: Commit**

```bash
git add "Openreel Video/Openreel Video/AppState.swift"
git commit -m "feat(ios): add resolveClipPlacement for snap + collision

Centralizes frame-snap, edge-snap, and same-track overlap avoidance
into a single resolver. Move and import paths will route through
this in subsequent commits."
```

---

### Task 7: Add collision tests (overlap, sandwiched, no-room)

**Files:**
- Modify: `Openreel Video/Openreel VideoTests/PlacementResolverTests.swift`

- [ ] **Step 1: Append three more failing tests to the existing file**

Add these methods inside the `PlacementResolverTests` struct, just before the closing `}` of the struct:

```swift
    @Test func overlapWithLeftNeighborSnapsToTrailingEdge() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "T1", clips: [
                .init(id: "moving", start: 10, duration: 3),
                .init(id: "left", start: 0, duration: 4)
            ])
        ])

        let resolution = harness.appState.resolveClipPlacement(
            clipID: "moving",
            proposedStart: 2,
            destinationTrackID: "T1",
            in: project
        )

        #expect(resolution?.start == 4.0)
        #expect(resolution?.didSnap == true)
    }

    @Test func overlapBetweenTwoNeighborsWithEnoughRoomTakesGap() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "T1", clips: [
                .init(id: "moving", start: 20, duration: 2),
                .init(id: "left", start: 0, duration: 3),
                .init(id: "right", start: 8, duration: 3)
            ])
        ])

        let resolution = harness.appState.resolveClipPlacement(
            clipID: "moving",
            proposedStart: 4,
            destinationTrackID: "T1",
            in: project
        )

        #expect(resolution?.start == 3.0)
        #expect(resolution?.didSnap == true)
    }

    @Test func noRoomAnywhereReturnsNil() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "T1", clips: [
                .init(id: "moving", start: 0, duration: 5),
                .init(id: "a", start: 0, duration: 2),
                .init(id: "b", start: 2, duration: 2),
                .init(id: "c", start: 4, duration: 2),
                .init(id: "d", start: 6, duration: 2)
            ])
        ])

        let resolution = harness.appState.resolveClipPlacement(
            clipID: "moving",
            proposedStart: 1,
            destinationTrackID: "T1",
            in: project
        )

        #expect(resolution == nil)
    }
```

- [ ] **Step 2: Run the tests**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlacementResolverTests" \
  -quiet
```

Expected: all six tests PASS. They should — the resolver was already written to handle these cases.

- [ ] **Step 3: Commit**

```bash
git add "Openreel Video/Openreel VideoTests/PlacementResolverTests.swift"
git commit -m "test(ios): collision-resolution tests for placement resolver"
```

---

### Task 8: `destinationTrack` helper for cross-track resolution

**Files:**
- Modify: `Openreel Video/Openreel Video/AppState.swift`
- Modify: `Openreel Video/Openreel VideoTests/PlacementResolverTests.swift`

- [ ] **Step 1: Add failing tests for `destinationTrack`**

Append inside `PlacementResolverTests`:

```swift
    @Test func destinationTrackClampsCrossTypeToSource() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "V1", clips: [
                .init(id: "moving", start: 0, duration: 2)
            ]),
            .audio(id: "A1", clips: [])
        ])

        let destination = harness.appState.destinationTrack(
            forClipID: "moving",
            trackDelta: 1,
            in: project
        )

        #expect(destination == "V1")
    }

    @Test func destinationTrackPicksAdjacentSameTypeTrack() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "V1", clips: [
                .init(id: "moving", start: 0, duration: 2)
            ]),
            .video(id: "V2", clips: [])
        ])

        let destination = harness.appState.destinationTrack(
            forClipID: "moving",
            trackDelta: 1,
            in: project
        )

        #expect(destination == "V2")
    }

    @Test func destinationTrackClampsOutOfRangeDelta() {
        let harness = Harness()
        let project = harness.makeProject(tracks: [
            .video(id: "V1", clips: [
                .init(id: "moving", start: 0, duration: 2)
            ]),
            .video(id: "V2", clips: [])
        ])

        let destinationDown = harness.appState.destinationTrack(
            forClipID: "moving",
            trackDelta: 99,
            in: project
        )
        let destinationUp = harness.appState.destinationTrack(
            forClipID: "moving",
            trackDelta: -99,
            in: project
        )

        #expect(destinationDown == "V2")
        #expect(destinationUp == "V1")
    }
```

- [ ] **Step 2: Verify they fail to compile**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlacementResolverTests" \
  -quiet
```

Expected: compile error "value of type 'AppState' has no member 'destinationTrack'".

- [ ] **Step 3: Add `destinationTrack` to `AppState`**

Inside the `AppState` class, just after `resolveClipPlacement`, add:

```swift
    func destinationTrack(
        forClipID clipID: String,
        trackDelta: Int,
        in project: OpenReelProject
    ) -> String? {
        guard let movingClip = project.allClips.first(where: { $0.id == clipID }),
              let sourceTrack = project.timeline.tracks.first(where: { $0.id == movingClip.trackId })
        else {
            return nil
        }
        let candidates = project.timeline.tracks
            .filter { $0.type == sourceTrack.type }
        guard let sourceIndex = candidates.firstIndex(where: { $0.id == sourceTrack.id }) else {
            return movingClip.trackId
        }
        let targetIndex = max(0, min(candidates.count - 1, sourceIndex + trackDelta))
        return candidates[targetIndex].id
    }
```

- [ ] **Step 4: Run the tests**

Run:

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -only-testing:"Openreel VideoTests/PlacementResolverTests" \
  -quiet
```

Expected: all nine tests PASS.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/AppState.swift" "Openreel Video/Openreel VideoTests/PlacementResolverTests.swift"
git commit -m "feat(ios): destinationTrack helper for cross-track moves"
```

---

## Phase 4 — Wire resolver into existing move (spec §7, UI half)

### Task 9: Route the existing `moveClip` through the resolver

**Files:**
- Modify: `Openreel Video/Openreel Video/AppState.swift`

- [ ] **Step 1: Add the new overload, refactor the existing `moveClip` to delegate**

Open `AppState.swift`. Find `moveClip(_ clipID: String, by delta: TimeInterval, playbackController: PlaybackController? = nil)` (line 1005). Replace its entire body (lines 1005-1049) with:

```swift
    func moveClip(_ clipID: String, by delta: TimeInterval, playbackController: PlaybackController? = nil) async {
        guard let project = currentProject,
              let clip = project.allClips.first(where: { $0.id == clipID })
        else {
            return
        }
        await moveClip(
            clipID,
            by: delta,
            destinationTrackID: clip.trackId,
            playbackController: playbackController
        )
    }

    func moveClip(
        _ clipID: String,
        by delta: TimeInterval,
        destinationTrackID: String,
        playbackController: PlaybackController? = nil
    ) async {
        guard var project = currentProject,
              let movingClip = project.allClips.first(where: { $0.id == clipID }),
              let sourceLocation = clipLocation(for: clipID, in: project)
        else {
            return
        }

        let proposedStart = max(0, movingClip.startTime + delta)
        guard let resolution = resolveClipPlacement(
            clipID: clipID,
            proposedStart: proposedStart,
            destinationTrackID: destinationTrackID,
            in: project
        ) else {
            return
        }

        let actualDelta = resolution.start - movingClip.startTime
        let movingToSameTrack = movingClip.trackId == resolution.trackID

        if abs(actualDelta) < 0.001, movingToSameTrack {
            return
        }

        let linkedLocations = linkedClipLocations(for: movingClip, in: project)
        var linkedUpdates: [(location: ClipLocation, clip: OpenReelProject.Clip)] = []

        for linkedLocation in linkedLocations {
            let linkedClip = project.timeline.tracks[linkedLocation.trackIndex].clips[linkedLocation.clipIndex]
            guard let linkedResolution = resolveClipPlacement(
                clipID: linkedClip.id,
                proposedStart: linkedClip.startTime + actualDelta,
                destinationTrackID: linkedClip.trackId,
                in: project
            ) else {
                return
            }
            let expected = linkedClip.startTime + actualDelta
            guard abs(linkedResolution.start - expected) < 0.001 else {
                return
            }
            var updatedLinked = linkedClip
            updatedLinked.startTime = max(0, linkedResolution.start)
            linkedUpdates.append((linkedLocation, updatedLinked))
        }

        var updatedClip = movingClip
        updatedClip.startTime = max(0, resolution.start)
        updatedClip.trackId = resolution.trackID

        if movingToSameTrack {
            project.timeline.tracks[sourceLocation.trackIndex].clips[sourceLocation.clipIndex] = updatedClip
        } else {
            project.timeline.tracks[sourceLocation.trackIndex].clips.remove(at: sourceLocation.clipIndex)
            guard let destinationIndex = project.timeline.tracks.firstIndex(where: { $0.id == resolution.trackID }) else {
                return
            }
            project.timeline.tracks[destinationIndex].clips.append(updatedClip)
        }

        for update in linkedUpdates {
            project.timeline.tracks[update.location.trackIndex].clips[update.location.clipIndex] = update.clip
        }

        normalizeTimeline(&project)
        await commitEditedProject(project, selectedClipID: clipID, playbackController: playbackController)
    }
```

- [ ] **Step 2: Build to confirm no compile regressions**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Run the full test suite**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: all tests PASS. Existing `moveClip` callers continue to work because the old signature is preserved as a wrapper that uses the clip's current `trackId`.

- [ ] **Step 4: Manual UI check — same-track no-overlap**

Launch the simulator. Open a project with two video clips on the same track. Long-press and drag the second clip leftward toward (and into) the first one. Expected: the dragged clip snaps to a position flush against the first clip's trailing edge; it does not overlap.

- [ ] **Step 5: Commit**

```bash
git add "Openreel Video/Openreel Video/AppState.swift"
git commit -m "feat(ios): route moveClip through resolveClipPlacement

Same-track overlap is now impossible — moves snap to the nearest
free position. Linked-audio siblings must mirror the video move
exactly or the entire move aborts."
```

---

### Task 10: Snap-edge visual indicator + haptic on `TimelineClipBlock`

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift`

- [ ] **Step 1: Add the snap-edge state and overlay to `TimelineClipBlock`**

In `EditorView.swift`, find `private struct TimelineClipBlock: View` (line 4616). Locate its existing `@State private var moveTranslation: CGFloat = 0` (line 4649). Add directly after it:

```swift
    @State private var snapEdgeX: CGFloat? = nil
    @State private var snapClearTask: Task<Void, Never>? = nil
```

Find the `body: some View { ZStack(alignment: .leading) { ... } }` (line 4653). Inside the existing chain of `.overlay { ... }` modifiers (around line 4710), insert a new overlay *after* the keyframe lane overlay:

```swift
        .overlay(alignment: .leading) {
            if let snapEdgeX {
                Rectangle()
                    .fill(OpenReelTheme.accent)
                    .frame(width: 1, height: 62)
                    .offset(x: snapEdgeX - moveTranslation, y: -4)
                    .opacity(0.9)
                    .animation(.easeOut(duration: 0.15), value: snapEdgeX)
                    .allowsHitTesting(false)
            }
        }
```

- [ ] **Step 2: Add helper that triggers the snap pulse**

Inside `TimelineClipBlock` (just after the existing `private var moveGesture: some Gesture { ... }` block ends, around line 4771), add:

```swift
    private func flashSnapEdge(at edgeX: CGFloat) {
        if snapEdgeX != edgeX {
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        }
        snapClearTask?.cancel()
        snapEdgeX = edgeX
        snapClearTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard !Task.isCancelled else { return }
            snapEdgeX = nil
        }
    }
```

`@State` properties on a SwiftUI `View` struct can be assigned from `@MainActor`-isolated closures because the property wrapper's setter is `nonmutating`. The cancellation token guarantees only the most recent flash decides when to clear.

- [ ] **Step 3: Wire the flash into the move gesture's onChanged path**

Replace `moveGesture` (lines 4751-4771) with:

```swift
    private var moveGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.18)
            .sequenced(before: DragGesture(minimumDistance: 1))
            .onChanged { value in
                switch value {
                case .second(true, let drag?):
                    moveTranslation = drag.translation.width
                    detectSnapDuringDrag(translation: drag.translation)
                default:
                    break
                }
            }
            .onEnded { value in
                defer {
                    moveTranslation = 0
                    snapEdgeX = nil
                    snapClearTask?.cancel()
                }
                guard case .second(true, let drag?) = value else { return }

                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                onMove(drag.translation.width / max(pixelsPerSecond, 1))
            }
    }

    private func detectSnapDuringDrag(translation: CGSize) {
        let project = appState.currentProject
        guard let project else { return }
        let proposedStart = max(0, clip.startTime + translation.width / max(pixelsPerSecond, 1))
        guard let resolution = appState.resolveClipPlacement(
            clipID: clip.id,
            proposedStart: proposedStart,
            destinationTrackID: clip.trackId,
            in: project
        ) else {
            return
        }
        if resolution.didSnap {
            let edgePx = (resolution.start - clip.startTime) * pixelsPerSecond
            flashSnapEdge(at: edgePx)
        } else if snapEdgeX != nil {
            snapClearTask?.cancel()
            snapEdgeX = nil
        }
    }
```

- [ ] **Step 4: Build**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Manual UI check**

Launch the simulator. Open a project with two clips on the same track. Long-press the second clip and drag it slowly toward the first. Expected: a 1 pt accent vertical line briefly appears at the snap edge each time the drag enters snap range; a soft haptic fires; line fades after 200 ms.

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "feat(ios): snap-edge visual + haptic on clip drag"
```

---

## Phase 5 — Cross-track gesture (spec §8)

### Task 11: Extend `TimelineClipBlock` move gesture to 2-D and wire to cross-track move

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift`

- [ ] **Step 1: Change the block's `onMove` callback to receive 2-D translation**

In `TimelineClipBlock`, find `let onMove: (TimeInterval) -> Void` (line 4628). Replace it with:

```swift
    let onMove: (_ timeDelta: TimeInterval, _ trackDelta: Int) -> Void
    let laneHeight: CGFloat
    let trackRowSpacing: CGFloat
```

- [ ] **Step 2: Update the caller in `visualTrackLane(for:track:contentWidth:)`**

Find the `TimelineClipBlock(...)` construction inside `visualTrackLane(...)` (line 2080-2105). Update the `onMove:` argument and add the new params. Replace lines 2080-2105 with:

```swift
                ForEach(visualClips) { clip in
                    TimelineClipBlock(
                        project: project,
                        clip: clip,
                        pixelsPerSecond: appState.timelineZoom,
                        isSelected: appState.selectedClipID == clip.id,
                        selectedKeyframeID: appState.selectedKeyframeID,
                        onSelect: {
                            playbackController.pause()
                            appState.selectClip(clip)
                            playbackController.seek(to: min(max(clip.startTime, 0), appState.currentProject?.timeline.duration ?? clip.startTime))
                            appState.editorTab = .edit
                        },
                        onTrim: { edge, delta in
                            Task {
                                await appState.trimClip(clip.id, edge: edge, by: delta, playbackController: playbackController)
                            }
                        },
                        onMove: { timeDelta, trackDelta in
                            Task {
                                let destinationTrackID: String
                                if trackDelta == 0 {
                                    destinationTrackID = clip.trackId
                                } else if let resolved = appState.destinationTrack(forClipID: clip.id, trackDelta: trackDelta, in: project) {
                                    destinationTrackID = resolved
                                } else {
                                    destinationTrackID = clip.trackId
                                }
                                await appState.moveClip(
                                    clip.id,
                                    by: timeDelta,
                                    destinationTrackID: destinationTrackID,
                                    playbackController: playbackController
                                )
                            }
                        },
                        onKeyframeSelect: { keyframeID in
                            appState.selectKeyframe(keyframeID)
                            appState.editorTab = .edit
                            lowerPanelContent = nil
                            activeEditingSheet = .keyframe
                        },
                        laneHeight: timelineLaneHeight(for: track),
                        trackRowSpacing: 8
                    )
                    .offset(x: clip.startTime * appState.timelineZoom)
                    .onTapGesture {
                        selectClipForPreview(clip, in: project)
                    }
                }
```

- [ ] **Step 3: Update `moveGesture` to also compute `trackDelta` from vertical translation**

Replace `moveGesture` (just authored in Task 10) with:

```swift
    private var moveGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.18)
            .sequenced(before: DragGesture(minimumDistance: 1))
            .onChanged { value in
                switch value {
                case .second(true, let drag?):
                    moveTranslation = drag.translation.width
                    moveVerticalTranslation = drag.translation.height
                    detectSnapDuringDrag(translation: drag.translation)
                default:
                    break
                }
            }
            .onEnded { value in
                defer {
                    moveTranslation = 0
                    moveVerticalTranslation = 0
                    snapEdgeX = nil
                    snapClearTask?.cancel()
                }
                guard case .second(true, let drag?) = value else { return }

                let timeDelta = drag.translation.width / max(pixelsPerSecond, 1)
                let trackDelta = Int(round(drag.translation.height / max(laneHeight + trackRowSpacing, 1)))
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                onMove(timeDelta, trackDelta)
            }
    }
```

Add the new `@State` (next to `moveTranslation`, ~line 4649):

```swift
    @State private var moveVerticalTranslation: CGFloat = 0
```

- [ ] **Step 4: Apply the live vertical offset and "lifted" affordance**

Find the `.offset(x: moveTranslation)` line (line 4715) and replace it with:

```swift
        .offset(x: moveTranslation, y: moveVerticalTranslation)
        .scaleEffect(moveVerticalTranslation == 0 && moveTranslation == 0 ? 1.0 : 1.04)
        .shadow(color: .black.opacity(moveVerticalTranslation == 0 && moveTranslation == 0 ? 0 : 0.35), radius: 12)
        .zIndex(moveTranslation == 0 && moveVerticalTranslation == 0 ? 0 : 10)
```

- [ ] **Step 5: Build**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Manual UI check — cross-track move**

Launch the simulator. Open a project, add a second video track via the `+` menu, then long-press a clip on track 1 and drag it down onto track 2. Expected: clip lifts (scale + shadow), follows finger between rows, on release lands on track 2. Drag it back up — returns to track 1. Drag a video clip downward toward an audio track — clip does *not* switch to the audio track (clamps to source).

- [ ] **Step 7: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "feat(ios): cross-track moves for video clips (same-type only)"
```

---

### Task 12: Mirror cross-track move into the other three block types

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift`

Mirror Task 11's changes into `TimelineAudioClipBlock`, `TimelineTextClipBlock`, and `TimelineGraphicsClipBlock`. Each block has the same shape — `moveGesture`, `moveTranslation`, `onMove` callback. The text/graphics blocks deliberately stay restricted to text/graphics tracks via `destinationTrack` (which already filters by `track.type`).

- [ ] **Step 1: Update `TimelineAudioClipBlock` (line 4863)**

Add the same three properties (`moveVerticalTranslation`, `laneHeight`, `trackRowSpacing`), update `onMove` signature to `(TimeInterval, Int)`, and copy the same `moveGesture` and `.offset/.scaleEffect/.shadow/.zIndex` block from Task 11. The body around line 4886 (`.frame(width: liveClipWidth, height: 46, alignment: .leading)`) anchors the change — apply the same modifiers there.

- [ ] **Step 2: Update the audio caller**

In `audioTrackLane(track:contentWidth:)` (line 2154), replace the `TimelineAudioClipBlock(...)` construction at line 2168 with:

```swift
                    TimelineAudioClipBlock(
                        clip: clip,
                        pixelsPerSecond: appState.timelineZoom,
                        isSelected: appState.selectedClipID == clip.id,
                        onSelect: {
                            playbackController.pause()
                            appState.selectClip(clip)
                            playbackController.seek(to: min(max(clip.startTime, 0), appState.currentProject?.timeline.duration ?? clip.startTime))
                            appState.editorTab = .edit
                        },
                        onTrim: { edge, delta in
                            Task {
                                await appState.trimClip(clip.id, edge: edge, by: delta, playbackController: playbackController)
                            }
                        },
                        onMove: { timeDelta, trackDelta in
                            Task {
                                let project = appState.currentProject
                                let destinationTrackID: String
                                if trackDelta == 0 || project == nil {
                                    destinationTrackID = clip.trackId
                                } else if let resolved = appState.destinationTrack(forClipID: clip.id, trackDelta: trackDelta, in: project!) {
                                    destinationTrackID = resolved
                                } else {
                                    destinationTrackID = clip.trackId
                                }
                                await appState.moveClip(
                                    clip.id,
                                    by: timeDelta,
                                    destinationTrackID: destinationTrackID,
                                    playbackController: playbackController
                                )
                            }
                        },
                        laneHeight: timelineLaneHeight(for: track),
                        trackRowSpacing: 8
                    )
                    .offset(x: clip.startTime * appState.timelineZoom)
```

- [ ] **Step 3: Update `TimelineTextClipBlock` (line 4980) — gesture parity only**

For text clips, this iteration adopts the same gesture surface (faster long-press, 2-D translation, lifted-state visuals) but keeps moves single-track. Change `TimelineTextClipBlock`'s `onMove` declaration from `(TimeInterval) -> Void` to `(_ timeDelta: TimeInterval, _ trackDelta: Int) -> Void`. Add the `laneHeight`/`trackRowSpacing` properties. Copy the same `moveGesture` and `.offset/.scaleEffect/.shadow/.zIndex` modifiers from Task 11.

In the gesture's `onEnded`, ignore `trackDelta` for text — the spec defers cross-track text moves. Pass it through unused:

```swift
                onMove(timeDelta, trackDelta)
```

Update the caller in `textTrackLane(...)` at line 1986 to provide the new params and to ignore `trackDelta`:

```swift
                        onMove: { timeDelta, _ in
                            Task {
                                await appState.moveTextClip(textClip.id, by: timeDelta, playbackController: playbackController)
                            }
                        },
                        laneHeight: timelineLaneHeight(for: track),
                        trackRowSpacing: 8
```

- [ ] **Step 4: Update `TimelineGraphicsClipBlock` (line 5186) — same pattern as text**

Same change as Step 3, but the existing AppState method is `moveGraphicsClip(_:by:playbackController:)`. Update the caller in `graphicsTrackLane(...)` (around line 2036) the same way: pass `onMove: { timeDelta, _ in ... await appState.moveGraphicsClip(graphicsClip.id, by: timeDelta, playbackController: playbackController) }` plus `laneHeight`/`trackRowSpacing`.

- [ ] **Step 5: Build**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Run the full test suite**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "feat(ios): cross-track moves for audio, gesture parity for text/graphics

Audio clips can now move between audio tracks. Text and graphics
blocks reuse the 2-D gesture for lifted-state visuals and faster
long-press, but their vertical translation is ignored at commit
time (the spec scopes cross-track text/graphics out for now)."
```

---

## Phase 6 — Polish (spec §9)

### Task 13: Scissors mini-button + post-split playhead seek

**Files:**
- Modify: `Openreel Video/Openreel Video/EditorView.swift`
- Modify: `Openreel Video/Openreel Video/AppState.swift`

- [ ] **Step 1: Modify `splitSelectedClip` to return the split time**

In `AppState.swift`, find `splitSelectedClip(at:playbackController:)` (line 820). Change its signature to return the split time:

```swift
    @discardableResult
    func splitSelectedClip(at playheadTime: TimeInterval, playbackController: PlaybackController? = nil) async -> TimeInterval? {
```

At the end of the function (just before the existing closing `}` at line 886), replace `await commitEditedProject(project, selectedClipID: splitResult.right.id, playbackController: playbackController)` with:

```swift
        await commitEditedProject(project, selectedClipID: splitResult.right.id, playbackController: playbackController)
        playbackController?.seek(to: splitTime)
        return splitTime
```

Inside the existing `guard splitTime > clipStart, splitTime < clipEnd else { return }` (line 831), change `return` to `return nil`. Similarly, change every other early-return inside `splitSelectedClip` to `return nil`. Final `return` line above stays the explicit `return splitTime`.

- [ ] **Step 2: Add the scissors mini-button to `TimelineClipBlock`**

`PlaybackController` is provided to `EditorView` via `@Environment(PlaybackController.self) private var playbackController` (EditorView.swift line 6) but is **not** on `AppState`. Inject it into `TimelineClipBlock` via the SwiftUI environment so the block doesn't need a new constructor parameter.

In `TimelineClipBlock`, find `@Environment(AppState.self) private var appState` (line 4617) and add immediately after it:

```swift
    @Environment(PlaybackController.self) private var playbackController
```

Inside the existing chain of `.overlay { ... }` modifiers in `body` (around line 4710), add:

```swift
        .overlay(alignment: .topTrailing) {
            if shouldShowScissors {
                Button {
                    let playheadTime = playbackController.currentTime
                    Task {
                        await appState.splitSelectedClip(at: playheadTime, playbackController: playbackController)
                    }
                } label: {
                    Image(systemName: "scissors")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(OpenReelTheme.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .offset(x: -6, y: -18)
                .accessibilityLabel("Split at playhead")
            }
        }
```

Just below the property declarations (~line 4651, after `@State private var trailingTrimOffset`), add the visibility computed property:

```swift
    private var shouldShowScissors: Bool {
        guard isSelected else { return false }
        guard clipWidth > 80 else { return false }
        let playheadTime = playbackController.currentTime
        return playheadTime > clip.startTime + 0.001
            && playheadTime < clip.startTime + clip.duration - 0.001
    }
```

Because `PlaybackController` is an `@Observable`, `playbackController.currentTime` participates in SwiftUI's dependency tracking — the button will appear and disappear as the playhead scrubs in and out of the selected clip without any manual invalidation.

- [ ] **Step 3: Build**

Run:

```bash
xcodebuild build \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Run the full test suite**

```bash
xcodebuild test \
  -project "Openreel Video/Openreel Video.xcodeproj" \
  -scheme "Openreel Video" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  -quiet
```

Expected: all tests PASS.

- [ ] **Step 5: Manual UI check**

Launch the simulator. Open a project, add a video, scrub the playhead to ~1 s, select the clip. Expected: a small scissor button appears on the upper-right of the clip. Tap it. Expected: clip splits at the playhead, playhead now sits exactly at the split point, the right-half clip becomes selected, preview shows a frame (Phase 1 already proved this).

- [ ] **Step 6: Commit**

```bash
git add "Openreel Video/Openreel Video/AppState.swift" "Openreel Video/Openreel Video/EditorView.swift"
git commit -m "feat(ios): scissors mini-button + post-split playhead seek"
```

---

## Self-Review

After completing all tasks, verify against the spec:

**Spec coverage check:**
- §5 Zoom controller → Task 4
- §6.2 Skip custom compositor → Task 2
- §6.3 Reliable nudge → Task 3
- §7 Placement resolver → Tasks 5-8
- §7.4 Snap visuals + haptic → Task 10
- §8 Cross-track movement (video, audio) → Tasks 11-12
- §9.1 Long-press to 0.18 s → Task 11 (gesture rewrite)
- §9.2 Lifted-state visuals → Task 11
- §9.3 Scissors mini-button → Task 13
- §9.4 Post-split playhead seek → Task 13
- §12.1 Composition tests → Task 1
- §12.1 Placement resolver tests → Tasks 5, 7, 8

**Known gaps explicitly accepted by this plan:**
- §8 cross-track movement for *text* and *graphics* clips. Task 12 Step 3-4 documents this — those types require their own `moveClip`-equivalent overloads on `AppState` which are out of scope for the current spec.
- §13's "no room" red-tint visual indicator on the linked audio block — folded into the snap-edge overlay; the *absence* of snap (and the snap-back on drag end) is the user-visible signal. Acceptable.

**Type consistency:**
- `PlacementResolution` (Task 6) is used in Tasks 7, 9, 10. Same fields throughout.
- `resolveClipPlacement(clipID:proposedStart:destinationTrackID:in:)` signature is identical at every call site.
- `destinationTrack(forClipID:trackDelta:in:)` signature is identical at every call site.
- `onMove: (TimeInterval, Int) -> Void` signature is consistent across `TimelineClipBlock` and `TimelineAudioClipBlock`. Text/graphics blocks adopt the same signature in Task 12 (with cross-track wiring deferred).

---

## Final Manual Acceptance Checklist

Before opening the PR, run through this list against a real device or simulator:

1. Add one video → split at playhead → press play. Video plays, no dark preview.
2. Add two videos → drag the second toward the first; the proposed range overlaps the first. The clip snaps flush against the first clip's trailing edge.
3. With two video tracks, drag a clip from track 1 down to track 2. Clip moves between tracks. Drag back up — returns to track 1.
4. Drag a video clip onto an audio track. No track switch occurs.
5. Pinch to zoom in → chip reads correct percentage. Tap chip's `100%` → returns to default. Long-press `100%` → preset menu opens. `Fit` makes the timeline span the visible width.
6. With a clip selected and playhead inside it, the scissors mini-button is visible. Tap it. Clip splits at playhead, right-half is selected, playhead sits on the cut, preview shows the post-split frame.
7. After many edits, the editor remains responsive (no obvious jank introduced).
