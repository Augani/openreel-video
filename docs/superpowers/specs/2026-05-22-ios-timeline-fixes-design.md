# iOS Timeline Fixes — Design Spec

**Date:** 2026-05-22
**Status:** Approved (pending spec review)
**Scope:** iOS app only (`Openreel Video/Openreel Video/...`). Android parity is **out of scope** for this iteration but should follow once the iOS implementation is settled.

## 1. Problem statement

Users editing on iOS hit five related issues that combine into a "the timeline is hard to use" experience:

1. There is no on-screen zoom control. The pinch gesture works but is undiscoverable and awkward for fine-grained adjustments.
2. **Splitting a clip black-outs the preview.** After any split (or other edit that produces 2+ video sources), the preview goes dark and the user perceives playback as broken.
3. Clip movement is purely horizontal — there is no way to move a clip from one track to another, even between tracks of the same media type.
4. Clips on the same track can overlap freely. This produces silently-corrupt timelines and unintentional blank gaps that users have to clean up manually.
5. Splitting and moving clips feels slower than it should — long-press timing, lack of visual snap feedback, and the round-trip to the toolbar for split combine into friction.

## 2. Goals & non-goals

**Goals**
- Always-visible zoom controller in the timeline header, top-right.
- Preview never goes dark after editing a single clip into multiple clips.
- Drag a clip between tracks of the same media type.
- Same-track overlap is impossible; clips snap to the nearest legal position.
- Visible snap feedback (line + haptic) when clips snap to neighbors.
- Slightly faster clip-lift on long-press; one-tap split from the selected clip.

**Non-goals**
- Cross-type clip moves (video → audio, etc.). Same-type only.
- Ripple-edit / push-neighbors-aside. Snap-to-gap only.
- Multi-clip selection or group-move.
- Android parity in this iteration.
- General performance audit. Only perf wins that fall out naturally from these fixes are in scope.

## 3. User-visible behavior summary

| Interaction | Today | After |
|---|---|---|
| Zoom timeline | Pinch only | Pinch **or** `[− 100% +]` chip; long-press percent for presets |
| Split a clip | Toolbar button at playhead, then preview goes dark | Toolbar button **or** scissors mini-button on selected clip; preview keeps showing the frame at the cut |
| Drag clip horizontally | Long-press 0.25 s, then horizontal drag; clips can overlap | Long-press 0.18 s, then drag; snaps flush to neighbor edges; cannot overlap |
| Drag clip to another track | Not possible | Vertical drag in addition to horizontal; allowed only between same-media-type tracks |
| Snap feedback | Silent | Vertical accent line at snap edge + soft haptic |

## 4. Architecture

Three layers are touched; the changes are coordinated by a single new piece of state-layer logic (the **placement resolver**) that all UI changes call through.

```
┌────────────────────────────────────────────────────────┐
│ EditorView.swift                                       │
│  ┌──────────────────┐   ┌───────────────────────────┐  │
│  │ TimelineZoomChip │   │ Timeline*ClipBlock        │  │
│  │  (new subview)   │   │  - moveGesture (2-D)      │  │
│  └────────┬─────────┘   │  - snap indicator overlay │  │
│           │             │  - scissors mini-button   │  │
│           │             └────────────┬──────────────┘  │
└───────────┼──────────────────────────┼─────────────────┘
            │ writes                   │ calls
            ▼                          ▼
┌────────────────────────────────────────────────────────┐
│ AppState.swift                                         │
│  - timelineZoom  (existing, clamp [20, 300])           │
│  - resolveClipPlacement(...)  (new)                    │
│  - moveClip(..., destinationTrackID:)  (new overload)  │
└─────────────────────────┬──────────────────────────────┘
                          │ via syncPlayback
                          ▼
┌────────────────────────────────────────────────────────┐
│ Playback                                               │
│  PlaybackCompositionBuilder                            │
│   - buildVideoComposition: skip custom compositor      │
│     when no transitions; use layer instructions        │
│  MetalVideoView                                        │
│   - nudgePausedFrame: nudge by 1 frame (not 1/600s)    │
│   - re-trigger nudge when currentItem changes          │
└────────────────────────────────────────────────────────┘
```

### 4.1 Why a placement resolver

Today, three concerns are tangled across `moveClip`, `addClip`, and import paths: frame-snapping, edge-snapping, and (missing) collision avoidance. Three different code paths each implement a partial version. Centralizing in `resolveClipPlacement` gives a single source of truth that:

- Every move/import path can call.
- Is independently unit-testable without spinning up SwiftUI.
- Is the only place collision-avoidance logic lives.

## 5. Section A — Zoom controller

### 5.1 UI

A new private subview `TimelineZoomChip` rendered in the timeline header overlay, anchored top-right with `padding(.trailing, 12)` and `padding(.top, 6)`. The chip is a `Capsule()` background containing a single `HStack(spacing: 8)`:

```
┌──────────────────────┐
│  −   100%   +        │
└──────────────────────┘
```

Each element is a `Button(action:)` with `buttonStyle(.plain)`. Hit targets are 36 × 36 pt.

### 5.2 Behavior

| Action | Effect |
|---|---|
| Tap `−` | `appState.timelineZoom = max(20, appState.timelineZoom / 1.5)` |
| Tap `+` | `appState.timelineZoom = min(300, appState.timelineZoom * 1.5)` |
| Tap label | `appState.timelineZoom = 48` (= 100 %) |
| Long-press label | Open a `Menu` with `25%, 50%, 100%, 200%, 400%, Fit` |
| Pinch (existing) | Unchanged, same `[20, 300]` clamp |

`Fit` computes `appState.timelineZoom = max(20, min(300, trackAreaWidth / max(project.timeline.duration, 1)))`.

The displayed percentage is `Int(round(appState.timelineZoom / 48 * 100))`.

### 5.3 Animation

Chip step changes are wrapped in `withAnimation(.spring(response: 0.25, dampingFraction: 0.85))` so the timeline glides between discrete zoom levels. Pinch is left raw (no animation wrapper) to keep the gesture's continuous feel.

### 5.4 Files touched

- `EditorView.swift`: new `TimelineZoomChip` private struct; chip is inserted into the `timeline(for:)` view's `overlay(alignment: .topTrailing) { ... }`.

## 6. Section B — Fix dark preview after split

### 6.1 Root cause

After a split, the project goes from 1 → 2+ video sources. `PlaybackCompositionBuilder.build`:

1. Always creates two video tracks (`trackA`, `trackB`).
2. Inserts clips alternating: clip[0] → A, clip[1] → B, clip[2] → A, ...
3. When `sources.count >= 2`, calls `buildVideoComposition` which sets `customVideoCompositorClass = TransitionVideoCompositor.self`.

`AVPlayer` then routes all rendering through the custom compositor. The compositor only produces output when AVPlayer requests a render. On install, `MetalVideoView.nudgePausedFrame` tries to force a render by `seek(by: CMTime(value: 1, timescale: 600))` with `tolerance: .zero` — i.e., **~1.67 ms**, smaller than one frame at 30 fps (~33 ms). With zero tolerance AVPlayer rounds to the same frame, the compositor is not re-invoked, `AVPlayerItemVideoOutput.copyPixelBuffer` returns nil, `lastFrame` stays nil, Metal clears to black.

Secondary issue: the custom compositor is also used when there are zero transitions, adding a code path with no benefit for the common case.

### 6.2 Fix B1 — Skip custom compositor when there are no transitions

In `PlaybackCompositionBuilder.buildVideoComposition`:

```swift
// Pseudocode of the new branch
if transitions.isEmpty {
    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = buildPassthroughInstructions(
        sources: sources,
        clipTrackMap: clipTrackMap,
        videoTracks: videoTracks
    )
    videoComposition.renderSize = resolvedRenderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(frameRate.rounded(), 1)))
    // Note: no customVideoCompositorClass — AVPlayer's built-in compositor handles passthrough
    return videoComposition
}
// existing custom-compositor path for the transitions != [] case
```

`buildPassthroughInstructions(...)` produces one `AVMutableVideoCompositionInstruction` per time segment with two `AVMutableVideoCompositionLayerInstruction`s (one per video track), where the active track has `setOpacity(1, at: segment.start)` and the inactive track has `setOpacity(0, at: segment.start)`.

The active layer's transform is set via `setTransform(_:at:)` to a `CGAffineTransform` that (a) orients the source frame using the asset track's `preferredTransform`, then (b) aspect-fits the result into `renderSize` — i.e., the same fit math currently in `TransitionVideoCompositor.fitTransform`, lifted into a `CGAffineTransform`. The inactive layer gets `.identity` (it's at opacity 0, the transform is irrelevant but must not be missing). The composition's per-track `preferredTransform` (set on the composition track at insert time) is still set as before, so seeking is correct even before the first layer instruction's time.

This is the change that eliminates the dark-preview symptom for the overwhelming majority of edits, because the most common case after splitting a single clip is exactly this: 2+ video sources, 0 transitions.

### 6.3 Fix B2 — Reliable paused-frame nudge

In `MetalVideoView.forceCompositorRefresh`:

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

Three attempts × 33 ms = ~100 ms upper bound. Cheap on idle, decisive when the compositor is slow to warm up.

Additionally, in `setPlayer` add a KVO subscription on `player.currentItem` and call `installVideoOutput()` again on change. This defends against any future code path that swaps the AVPlayerItem inside the same AVPlayer instance.

### 6.4 Files touched

- `Core/Playback/PlaybackCompositionBuilder.swift`: branch in `buildVideoComposition`, new helper `buildPassthroughInstructions(...)`.
- `Features/Preview/MetalVideoView.swift`: `forceCompositorRefresh`, new `pumpFrameUntilDelivered`, KVO on `currentItem`.

## 7. Section C — Placement resolver: snap + no overlap

### 7.1 API

```swift
extension AppState {
    struct PlacementResolution {
        let start: TimeInterval
        let trackID: String
        let didSnap: Bool
    }

    func resolveClipPlacement(
        clipID: String,
        proposedStart: TimeInterval,
        destinationTrackID: String,
        in project: OpenReelProject
    ) -> PlacementResolution?
}
```

Returns `nil` only when the destination has zero room (clip duration > any gap on that track). Callers fall back to the source position on `nil`.

### 7.2 Algorithm

1. Look up the moving clip's `duration`. If not found → return `nil`.
2. Compute `frameSnapped = snappedTimelineTime(proposedStart, frameRate: ...)`.
3. **Edge snap**: collect snap edges (clip starts/ends on **all** tracks, plus text/graphics edges, plus `0`). Threshold = `max(0.05, 8 / max(timelineZoom, 1))` — so snap is generous when zoomed out, precise when zoomed in. If any edge is within threshold of `frameSnapped` *or* `frameSnapped + duration`, snap to it.
4. **Collision resolution** on `destinationTrackID` only (exclude the moving clip itself):
   - Build a sorted list `neighbors = [(start, end)]` of every other clip on the destination track, sorted by `start`.
   - If `[start, start + duration]` does not overlap any neighbor → return `(start, destinationTrackID, didSnap = edge-snap-fired)`.
   - Otherwise, build candidate positions = the set `{ 0 } ∪ { n.end for n in neighbors } ∪ { n.start − duration for n in neighbors }`, dropping any candidate where `candidate < 0` or `candidate + duration` overlaps any neighbor (computed once against the sorted list — `O(N log N)`).
   - Sort candidates by `|candidate − frameSnappedProposedStart|` ascending. Take the first.
   - If the candidate set is empty → return `nil` (no gap on the destination is large enough for this clip's duration).
   - `didSnap = true` in this branch by definition.

Candidates are derived once from the static neighbor list, so the iteration cap mentioned in earlier drafts is unnecessary — there is no loop. Complexity is `O(N log N)` in clips on the destination track.

### 7.3 Linked-audio coupling

The existing `linkedClipLocations(for:in:)` returns the linked audio sibling for a video clip. When the user moves a video clip:

1. Resolve placement for the video clip → `videoResolution`. If `nil` → abort, snap back.
2. Compute `actualDelta = videoResolution.start − originalVideoStart`.
3. For each linked sibling, call the resolver with:
   - `proposedStart = sibling.startTime + actualDelta`
   - `destinationTrackID = sibling.trackId` (linked audio stays on its current audio track; the user is moving the video, not the audio)
4. If any sibling resolution returns `nil` or returns a `start` different from `sibling.startTime + actualDelta`, **abort the entire move** — restore the original project state, no clips moved, no haptic.
5. Otherwise commit all moves in one `commitEditedProject(...)` call so the change is a single undo step.

The "or returns a different start" check is the key: we never silently let the linked audio land somewhere other than the exact mirror of the video move. Audio either moves in lockstep with video, or no one moves.

### 7.4 Visual feedback

`TimelineClipBlock` (and the three sibling block types) gain `@State private var snapEdgeX: CGFloat? = nil`. When the live drag passes through a snap-edge proximity, `snapEdgeX` is set to that edge's pixel x for 200 ms (cleared by a `DispatchWorkItem` cancellation token). Render:

```swift
.overlay(alignment: .leading) {
    if let snapEdgeX {
        Rectangle()
            .fill(OpenReelTheme.accent)
            .frame(width: 1, height: laneHeight + 8)
            .offset(x: snapEdgeX - currentLeadingOffset)
            .opacity(0.9)
            .animation(.easeOut(duration: 0.15), value: snapEdgeX)
    }
}
```

A `UIImpactFeedbackGenerator(style: .soft)` fires on the rising edge of `snapEdgeX != nil`.

### 7.5 Files touched

- `AppState.swift`: new `PlacementResolution`, `resolveClipPlacement`, modified `moveClip(...)` to call it.
- `EditorView.swift`: per-block `snapEdgeX` overlay; haptic on snap.

## 8. Section D — Cross-track movement

### 8.1 Gesture extension

The shared move-gesture helper is extracted from the four block types:

```swift
@MainActor
private func makeMoveGesture(
    pixelsPerSecond: Double,
    laneHeight: CGFloat,
    rowSpacing: CGFloat,
    onTranslate: @escaping (CGSize) -> Void,
    onCommit: @escaping (TimeInterval, Int) -> Void
) -> some Gesture {
    LongPressGesture(minimumDuration: 0.18)
        .sequenced(before: DragGesture(minimumDistance: 1))
        .onChanged { value in
            if case .second(true, let drag?) = value {
                onTranslate(drag.translation)
            }
        }
        .onEnded { value in
            guard case .second(true, let drag?) = value else { return }
            let timeDelta = drag.translation.width / max(pixelsPerSecond, 1)
            let trackDelta = Int(round(drag.translation.height / (laneHeight + rowSpacing)))
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onCommit(timeDelta, trackDelta)
        }
}
```

Each block type's `moveGesture` becomes a thin wrapper that supplies its own `pixelsPerSecond`/`laneHeight` and routes `(timeDelta, trackDelta)` to a corresponding AppState method.

### 8.2 Destination resolution

Caller computes the destination track:

```swift
func destinationTrack(
    for clip: OpenReelProject.Clip,
    trackDelta: Int,
    in project: OpenReelProject
) -> String? {
    guard let sourceTrack = project.timeline.tracks.first(where: { $0.id == clip.trackId }) else { return nil }
    let candidates = project.timeline.tracks
        .filter { $0.type == sourceTrack.type }
        .sorted { sortIndex(for: $0, in: project) < sortIndex(for: $1, in: project) }
    guard let sourceIndex = candidates.firstIndex(where: { $0.id == sourceTrack.id }) else { return nil }
    let targetIndex = max(0, min(candidates.count - 1, sourceIndex + trackDelta))
    return candidates[targetIndex].id
}
```

Same-type only. Cross-type drags are silently clamped to the source track (no track switch), so the move degrades to a horizontal move.

### 8.3 Live drag visuals

During an active drag:
- The clip block applies `offset(x: dragWidth, y: dragHeight)` so the user sees the clip follow their finger between rows.
- `.zIndex(isDragging ? 10 : 0)` so the dragged clip renders above siblings.
- `.scaleEffect(isDragging ? 1.04 : 1.0)` plus a `shadow(radius: isDragging ? 12 : 0)` for a clear "lifted" affordance.
- On commit, `offset` resets to `0` in the same animation transaction that commits the new project state, so the clip slides into its resolved position rather than teleporting.

### 8.4 Files touched

- `EditorView.swift`: extract `makeMoveGesture`; apply in all 4 block types; live drag visuals.
- `AppState.swift`: `moveClip(clipID:, by:, destinationTrackID:)` overload that calls `resolveClipPlacement`; helper `destinationTrack(...)`.

## 9. Section E — Easier split & move polish

These are intentionally small, ride on top of the above sections, and can be removed without breaking anything else:

1. **Long-press activation 0.25 s → 0.18 s** — already in Section D's gesture helper.
2. **Lifted-state visuals** — `scaleEffect(1.04)` + shadow during drag (Section D.3).
3. **Scissors mini-button on selected clip**: render a small button above the clip block when **all three** of these hold:
   - the clip is selected (`isSelected == true`),
   - the rendered clip width is > 80 pt (avoids visual clutter on tiny clips at low zoom),
   - the current `playbackController.currentTime` falls strictly inside `(clip.startTime, clip.startTime + clip.duration)` (so the split would actually do something — matches the precondition in `splitSelectedClip`).
   Tapping it calls the same `splitSelectedClip(at: playbackController.currentTime, ...)` path the toolbar uses. Hit target 32 × 32 pt, accent color.
4. **Post-split playhead seek**: after `splitSelectedClip` commits, seek the playhead to the split point so it sits right at the cut. Implementation: pass the resolved `splitTime` back out of `splitSelectedClip` and have the caller (or a small AppState helper) call `playbackController.seek(to: splitTime)`.

## 10. Data model changes

**None.** All five sections operate on the existing `OpenReelProject` schema. No new fields on `Clip`, `Track`, `Transition`, or `TimelineSettings`. No migration concerns.

## 11. Backwards compatibility

- Existing projects open and play identically.
- The custom-compositor path is preserved for projects with transitions, so transition rendering is unchanged.
- `appState.timelineZoom` is unchanged; chip and pinch are coordinated views on the same value.
- `moveClip(clipID:by:playbackController:)` (the existing single-argument form) is preserved as a thin wrapper that calls the new overload with `destinationTrackID = clip's current trackId`.

## 12. Testing

### 12.1 Unit tests (Swift Testing, `Openreel VideoTests`)

`PlaybackCompositionBuilderTests`:
- 2 sources, 0 transitions → returned `videoComposition` has `customVideoCompositorClass == nil`.
- 2 sources, 1 transition → returned `videoComposition` has `customVideoCompositorClass == TransitionVideoCompositor.self`.
- 1 source → no `videoComposition` returned (unchanged behavior).

`PlacementResolverTests`:
- No conflict on destination track → returns `proposedStart` (frame-snapped).
- Single neighbor to the left → snaps to its end when proposed range overlaps.
- Single neighbor to the right → snaps to `neighbor.start - duration`.
- Sandwiched (no room between two neighbors) → returns `nil`.
- Wrong-type destination track → caller never calls resolver with it; not a resolver concern, covered by destinationTrack unit test.
- Edge-snap kicks in within threshold; not beyond it.

`DestinationTrackTests`:
- Cross-type clamps to source track.
- Out-of-range delta clamps to first/last same-type track.

### 12.2 Manual test plan (in PR body)

1. Add one video → split at playhead → press play. **Expect:** video plays, no dark preview.
2. Add two videos → drag the second next to the first → release with proposed range overlapping. **Expect:** snaps flush against the first clip's trailing edge.
3. With two video tracks, drag a clip from track 1 down to track 2. **Expect:** clip moves between tracks. Drag it back up. **Expect:** returns to track 1.
4. Try to drag a video clip onto an audio track. **Expect:** no track switch occurs (clamps to source).
5. Pinch to zoom in → chip reads correct percentage. Tap chip's `100%` → returns to default. Long-press `100%` → preset menu opens.
6. Add many clips → confirm scroll + zoom remain smooth.

## 13. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| The "skip custom compositor" branch in B1 changes how transitions interact with passthrough segments | Low — branch is only taken when `transitions.isEmpty` | Backstop unit test asserts the branch boundary |
| Cross-track drag accidentally fires on small finger jitter | Medium — users may drag horizontally and pick up tiny vertical noise | `trackDelta` uses `round(dy / (laneHeight + spacing))` — needs ≥ half a row of vertical motion to register as a row change |
| Placement resolver loops indefinitely | Low | 8-iteration cap; falls through to `nil` (caller snaps back to source) |
| Linked audio refuses moves a user expected to work | Medium | Snap-back visual is clear; resolver returns `didSnap=false` and we render a brief "no room" indicator (sub-200 ms red tint on the linked audio block) |
| Scissors mini-button overlaps trim handles on narrow clips | Low | Only shown when clip width > 80 pt (Section E.3) |

## 14. Out of scope, but called out

- **Performance audit** of the editor as a whole. `EditorView.swift` (5538 lines) and `AppState.swift` (5260 lines) would both benefit from decomposition, and the AsyncImage-per-thumbnail pattern is a likely hotspot when zoomed in. These are tracked separately.
- **Android parity** for these features. Once the iOS implementation is stable, the Android Compose timeline should follow the same UX (chip, snap, cross-track move, no overlap). See `Openreel Video Android/.../ui/editor/Timeline.kt`.
- **Multi-clip selection and group-drag.** Useful follow-up but not part of this iteration.
- **Ripple-edit mode.** Considered and rejected in favor of snap-to-gap; can be re-added behind a toggle later if users ask for it.

## 15. Implementation order (recommended for the plan)

1. **B1 + B2 first** — preview fix is the most user-visible. Standalone, doesn't depend on resolver work. Shipping this alone would already improve the app.
2. **Zoom chip (Section A)** — tiny, low-risk, gives users instant visible feedback that we're shipping fixes.
3. **Placement resolver + tests (Section C, state layer only)** — fully unit-testable without UI.
4. **Snap visuals + same-track collision wired up via resolver** — Section C UI half.
5. **Cross-track gesture extension (Section D)** — depends on resolver.
6. **Polish (Section E)** — last, since it's lightest-touch.

Each step can ship independently; the plan should treat them as separate commits.
