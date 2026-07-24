# Timeline Transition Management (Web / Desktop) — Design

Date: 2026-06-13
Status: Approved (pending spec review)
Scope: `apps/web` (shared React code, so the Electron desktop build is covered automatically)

## Problem

Web and desktop users cannot see, edit, or remove a transition once it is applied.

User report:
> When I apply a crossfade transition it seems to land on one clip or the other
> (left or right), visually. And then I don't find a way to actually get back into
> the transition properties or see it applied to the clip. When I playback I can
> see that a crossfade is applied, but I do not see how to manage it or remove it.
> Most editors place the transition between the two clips and you can click on a
> transition to manage the properties or remove it.

## Diagnosis

The data model and render pipeline are already correct and already match the
mobile apps. The problem is purely a missing timeline UI.

- A `Transition` is a separate record stored on the track, referencing the two
  clips it sits between (`clipAId` = outgoing/left, `clipBId` = incoming/right).
  It is not stored on a single clip.
  - `packages/core/src/types/timeline.ts:214` (`Transition`), `:37` (`Track.transitions`)
- Crossfade already overlaps and blends both clips at the cut (outgoing fades out,
  incoming fades in on top), identical to mobile's `TransitionCompositor`.
  - `packages/core/src/video/transition-engine.ts:274` (`renderCrossfade`)
  - Transition window is centered on the cut: `cut ± duration/2`
    (`packages/core/src/video/video-engine.ts:1515`).
- Clip durations are never changed by applying a transition. Same on web and mobile.

Why it "lands on one side": the only way to add a transition on web is to drag a
card onto a clip's left or right half (`ClipComponent.computeTransitionEdge`,
`apps/web/src/components/editor/timeline/ClipComponent.tsx:189`). There is no
marker drawn on the timeline, so an applied transition is invisible and is only
editable by selecting a clip and opening the Inspector's Animate tab
(`ClipTransitionSection` → `TransitionInspector`).

## Reference: mobile pattern to mirror

Both mobile apps draw a chip on the cut, straddling both clips, centered at
`x = clipB.startTime * pixelsPerSecond`, floated above both clips.

- Android (the pattern we mirror): `Openreel Video Android/.../ui/editor/Timeline.kt:1143`
  renders a chip per adjacent touching pair; tap opens `TransitionSheet`; a
  "Remove Transition" button removes it.
- iOS: `EditorView.swift:2769` draws a labeled pill whose width reflects duration,
  tap selects + opens a sheet, supports drag-to-resize.

Mobile data model is identical to web (`clipAId`/`clipBId`/`type`/`duration`/`params`,
stored on the track, pure render-time blend centered on the cut).

## Decisions (confirmed with user)

1. Edit surface: reuse the existing right-side Inspector (`TransitionInspector`),
   not a new popover. Clicking a chip selects the transition; the Inspector shows
   its editor.
2. Add affordance: chip appears only at cuts that already have a transition
   (management-focused, no always-on `+`). Adding stays via the existing
   drag-a-card-onto-a-clip flow.
3. Chip styling: compact Android-style icon chip with a tooltip
   (`"<Type> · <duration>s"`). Not the iOS duration-width pill.
4. No render or data-model changes. No drag-the-chip-to-resize in v1
   (duration is edited via the Inspector slider).

## Design

### 1. Transition chip component

New file `apps/web/src/components/editor/timeline/TransitionHandle.tsx`, exported
from `timeline/index.ts`.

- Rendered inside `TrackLane.tsx` after the clip loop (mirrors Android's
  `VideoTrackLane`). `TrackLane` already has `track.transitions`, `track.clips`,
  and `pixelsPerSecond`.
- Position: center `x = clipB.startTime * pixelsPerSecond` within the lane, where
  `clipB` is the `clipBId` clip. Visible chip ~22px; invisible hit area ~44px
  centered on the seam. Vertically centered in the lane.
- Stacking: `z-index` above the clip body and the trim handles (trim handles are
  `z-20`, so chip is `z-30`). `onClick`/`onMouseDown` call `stopPropagation` so it
  never selects or trims the clip underneath.
- Render guard: draw a chip for a transition only when both referenced clips exist
  on the track and are adjacent: `|clipA.end − clipB.start| ≤ 0.05s`. Stale
  transitions (clips moved apart, or a referenced clip deleted) do not draw.

### 2. Chip appearance & states

- Default (transition exists): filled accent chip with a transition glyph
  (overlapping-rectangles / diamond icon from lucide). Tooltip
  `"<Type label> · <duration>s"`.
- Selected: highlighted ring / brighter accent.
- Hover: subtle scale/brightness, cursor pointer.
- No empty `+` chip.

### 3. Selection → Inspector

- Add `"transition"` to `SelectionType` in `apps/web/src/stores/ui-store.ts:14`.
- Chip click → `useUIStore.getState().select({ type: "transition", id, trackId })`.
- `apps/web/src/components/editor/InspectorPanel.tsx`: derive `selectedTransition`
  from `selectedItems` (mirror the existing `subtitle` derivation at
  `InspectorPanel.tsx:128`). Resolve `clipA`/`clipB` from the owning track by
  `clipAId`/`clipBId`. Render the existing `TransitionInspector` standalone:
  ```tsx
  <TransitionInspector
    clipA={clipA}
    clipB={clipB}
    transition={transition}
    onTransitionUpdate={updateClipTransition}
    onTransitionRemove={() => { removeClipTransition(...); clearSelection(); }}
  />
  ```
  `TransitionInspector` already accepts exactly `clipA`, `clipB`, `transition`,
  `onTransitionCreate`, `onTransitionUpdate`, `onTransitionRemove`
  (`inspector/TransitionInspector.tsx`, used today by `ClipTransitionSection.tsx:1303`).
  No new editor UI.

### 4. Remove

- Inspector Remove button (existing) → `removeClipTransition` then clear selection.
- Delete / Backspace while a transition chip is selected → same removal, consistent
  with clip deletion. Wire in the keyboard-shortcuts service (or the selection
  delete handler) to branch on the selected item type.

### 5. Wiring

- `Timeline.tsx`: pass a new `onSelectTransition` handler down to `TrackLane`
  (alongside the existing `onSelectClip`), wired to `useUIStore.select(...)`.
- `TrackLane.tsx`: accept `onSelectTransition`, compute and render `TransitionHandle`s.

## Non-goals (v1)

- No change to crossfade / transition render or the overlap-blend math.
- No always-on `+` add chip at empty cuts.
- No drag-the-chip-to-resize-duration on the timeline (Inspector slider only).
- No new transition types.

These are all straightforward follow-ups if wanted later.

## Files touched

- New: `apps/web/src/components/editor/timeline/TransitionHandle.tsx`
- New export: `apps/web/src/components/editor/timeline/index.ts`
- `apps/web/src/components/editor/timeline/TrackLane.tsx`
- `apps/web/src/components/editor/Timeline.tsx`
- `apps/web/src/stores/ui-store.ts`
- `apps/web/src/components/editor/InspectorPanel.tsx`
- Keyboard delete handler (service that owns selection deletion)

## Testing

- Unit: chip center-x from `clipB.startTime * pixelsPerSecond`; render guard for
  non-adjacent and missing-clip cases.
- Component: chip renders only where a transition exists; click selects it and the
  Inspector shows `TransitionInspector`; Inspector Remove and Delete key both
  remove it and clear selection.
- Manual: apply a crossfade via drag, confirm the chip appears straddling the cut,
  click it, change type/duration, remove it; verify on the desktop build.
