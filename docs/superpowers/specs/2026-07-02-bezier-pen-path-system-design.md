# Bezier Pen + Animatable Path System — Design

**Date:** 2026-07-02
**Status:** Approved scope (full editing + animated masks)
**Source:** AE-parity review big rock #1 (docs/reviews/2026-07-01-ae-parity-review.md §4.1)
**Branch:** feat/new-design-update

## Problem

The three defects that block rotoscoping and organic mask/shape work:
1. **Path animation flattens.** Shape path keyframes exist, but interpolation (`morphMotionPathData`, motion-shape-path.ts:634) resamples both paths to N positions and lerps `{x,y}` only — bezier handles are discarded, so any animated path degrades to a polyline.
2. **The pen can't pull handles.** `MotionShapePathPoint` already models `inX/inY/outX/outY`, and per-point setters exist (`setMotionShapePathPointHandle` etc.), but the StageCanvas pen places corner points only; there is no on-canvas vertex/handle editing at all.
3. **Masks have no bezier.** `MotionMaskShape` is `rectangle | ellipse | polygon` with straight-line `points: MotionVector2[]` (normalized to a bounds rect); mask keyframes animate bounds/feather only — mask shape animation is impossible.

## Goals

One shared vertex model (`MotionShapePathPoint`) powering: a real pen (click-drag pulls handles), full on-canvas vertex editing, vertex-preserving path interpolation, bezier masks, and keyframed mask-path animation — i.e. rotoscoping-capable masks and clean path morphs for shapes.

## Non-Goals

Per-vertex feather, rotobezier auto-smoothing, path shape operators beyond what exists (offset/pucker/merge are a separate rock), text-on-path, auto-trace.

## Design

### 1. Vertex-preserving path interpolation (core fix)
New `interpolateMotionPathPoints(from, to, t): MotionShapePathPoint[]` in motion-shape-path.ts:
- **Equal vertex counts** (and matching closed-ness): lerp `x/y` AND `in/out` handles per index — a missing handle is treated as coincident with its vertex, so corner↔smooth morphs work.
- **Mismatched counts:** fall back to the existing resample morph (documented limitation, same as AE's pairing requirement).
`morphMotionPathData` and `getMotionShapePathDataAtTime` route through it. **Serialization fidelity:** path keyframes store `pathData` strings — `buildMotionPathData`/`parseMotionPathData` must round-trip cubic segments (`C`) losslessly so handles survive keyframe storage; verify and fix if the builder emits only `L` commands.

### 2. Bezier masks
- `MotionMaskShape` gains `"path"`. `MotionMask` gains `pathPoints?: readonly MotionShapePathPoint[]` in **layer-local pixel coordinates** (same space as shape paths, so all editing/interpolation code is shared; the normalized `bounds` rect stays for the legacy shapes and is derived/ignored for path masks).
- Mask clipping renders the bezier via the same draw-command code shape paths use; feather/expansion/opacity/modes/inverted all keep working (the clip path source changes, nothing else).

### 3. Mask path animation (rotoscoping)
- Mirror the shape approach: `MotionMask.pathKeyframes?: Keyframe[]` whose values are `pathData` snapshots; evaluated with `interpolateMotionPathPoints` at render time.
- Animatable property id `mask.<id>.path` — recognized by `isMotionAnimatableProperty`, shown as a keyframe lane in the timeline (diamonds only; no numeric curve, like AE's Mask Path), toggleable from MasksPanel (stopwatch) and `add_motion_keyframe`-style flows where a path snapshot at the playhead is captured.

### 4. Pen + vertex editing (StageCanvas)
- **Draw:** click = corner vertex; **click-drag = smooth vertex with symmetric handles** (drag distance/direction sets `out`, mirrored `in`); click first vertex or Enter closes; Escape cancels. Works on shape layers and — when initiated from MasksPanel "Draw mask" (or with a mask selected) — draws a `path` mask on the selected layer.
- **Edit:** selecting a path shape/mask shows vertices + handles overlay. Drag vertex moves it (handles follow); drag handle adjusts (Alt breaks symmetry → independent handles); double-click or Alt-click a vertex toggles corner↔smooth; pen-click on a segment inserts a vertex (using existing `insertMotionShapePathPoint` math); Delete removes selected vertex (min 3 for closed, 2 for open).
- All gestures use the sprint's preview/commit protocol (one undo per gesture). While editing an animated path with the stopwatch on, edits write a path keyframe at the playhead (AE behavior).

### 5. MCP
Extend/add motion tools: `set_motion_mask_path` (pathPoints or pathData), `add_motion_mask` accepts `shape:"path"`, mask-path keyframe support (capture at time), and verify the existing shape-path tools expose handles. Params validated like the existing scaffolds.

## Testing

Core: pathData C-segment round-trip preserves handles; equal-count interpolation preserves handles (t=0.5 midpoint handle assertions); mismatch falls back to resample; mask `path` clip integrates with feather/modes/inverted; mask path keyframes evaluate per-frame (t0 vs t1 distinct). Web (RTL where feasible): pen click-drag produces a smooth vertex with symmetric handles in the draft; vertex drag/insert/delete/convert mutate the layer; mask draw creates a path mask; one gesture = one undo. Gate: core/web/agent tsc 0; full motion suites green (web now fully green — keep it).

## Risks

- **pathData fidelity** is the keystone — if the serializer drops handles, everything above silently flattens; T1 verifies round-trip first.
- **Coordinate spaces:** path masks use layer-local coords while legacy masks are normalized; conversion seams live only in mask rendering/UI, never in the shared path math.
- **StageCanvas is already huge** — pen/edit logic should land in an extracted helper module (`stage-path-editing.ts`) to keep the component manageable.
