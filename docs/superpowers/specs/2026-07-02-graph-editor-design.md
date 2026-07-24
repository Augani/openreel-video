# True Graph Editor — Tangent Handles, Speed Graph, Roving Keyframes — Design

**Date:** 2026-07-02
**Status:** Approved scope (full rock)
**Source:** AE-parity review big rock #3 (docs/reviews/2026-07-01-ae-parity-review.md §4.3)
**Branch:** feat/new-design-update

## Problem

The engine already interpolates per-keyframe cubic bezier handles (`Keyframe.bezierHandles {in,out}` in normalized segment space, honored by `keyframeEngine.applyEasing`, settable via `add_motion_keyframe`), but the GraphEditorPanel can only drag keyframe *points* — choosing "bezier" easing falls back to a fixed curve. There is no speed graph and no roving keyframes. Hand-tuned easing — the reason AE animators open the graph editor — is impossible in the UI.

## Goals

1. **Draggable tangent handles** on the value graph: per segment `kf[i]→kf[i+1]`, render P1 (attached to `kf[i]`) and P2 (attached to `kf[i+1]`), both stored as `kf[i].bezierHandles.in/.out`; dragging either converts the segment to `easing:"bezier"` seeded to approximate its current curve.
2. **Value ↔ Speed graph toggle**: speed = signed derivative of the eased value curve (units/s), sampled per segment; read-only in v1 (editing velocity/influence is a follow-up).
3. **Roving keyframes**: `roving?: boolean` per keyframe — roving keyframes keep their value but their time is recomputed so speed is constant across the span between the nearest non-roving neighbors; first/last keyframes cannot rove. Auto-reapplied on any keyframe mutation of that property.
4. **MCP**: `roving` param on `add_motion_keyframe`; handle semantics documented. (`bezierIn/bezierOut` already exist.)

## Non-Goals

Speed-graph *editing* (velocity/influence drag), box-select/marquee multi-keyframe ops (separate gap), spatial motion-path handles (position is per-channel scalar by design), easing-preset changes.

## Design

### Handle semantics & math (pure module)
`cubicBezier(t, in.x, in.y, out.x, out.y)` maps segment-normalized time→eased fraction; `in` = P1, `out` = P2. New pure module `apps/web/src/motion/graph-editor-curves.ts`:
- `normalizedHandleToGraphPoint` / `graphPointToNormalizedHandle` — map between handle space (x: 0..1 fraction of segment duration, y: 0..1 fraction of Δvalue) and the SVG graph coordinates (which already map time/value to pixels).
- `seedBezierHandlesFromEasing(easing)` — P1=(1/3, f(1/3)), P2=(2/3, f(2/3)) using the segment's current easing function, so converting to bezier approximately preserves the curve.
- `isFlatSegment(v0, v1)` — |Δv| < ε: value output is constant regardless of handles, so handle editing is disabled on flat segments (small hint shown).
- `sampleSegmentSpeed(kf0, kf1, samples)` — numeric derivative of the eased curve (signed, units/s).
- Clamps: handle x ∈ [0,1] (time monotonicity), y ∈ [-1, 2] (allows overshoot/anticipation, bounded for sanity).

### Value-graph handle editing (GraphEditorPanel)
For each bezier segment (and the selected keyframe's adjacent segments), render handle lines + circular grips. Pointer flow: grip drag → `graphPointToNormalizedHandle` → upsert `kf[i]` with `easing:"bezier"` + updated handles. Non-bezier segment: dragging a grip first converts via `seedBezierHandlesFromEasing`. Drags ride the preview/commit gesture protocol — **one undo per drag** (also fix the existing keyframe-point drag if it still commits per move; verify).

### Speed graph
A Value | Speed `SegmentedControl` above the SVG. Speed mode re-renders the polyline from `sampleSegmentSpeed` across all segments with its own y-scale (min/max of sampled speeds, zero-line drawn); keyframe diamonds still shown at their times (drag disabled in speed mode v1); handles hidden.

### Roving keyframes (core)
`Keyframe.roving?: boolean` (types/timeline.ts). New pure `redistributeRovingKeyframeTimes(keyframes)` in motion-keyframes.ts: for each maximal run of roving keyframes between non-roving anchors, recompute times so cumulative |Δvalue| progresses linearly in time (constant speed); zero-total-delta runs distribute uniformly. Applied automatically at the end of `upsertMotionLayerKeyframe` / `moveMotionLayerKeyframe` / `removeMotionLayerKeyframe` / the keyframe transform ops for the affected property. First/last keyframes of a property never rove (setter clears the flag). UI: a "Rove" toggle in the KeyframeRow (disabled for endpoints). MCP: `roving: bool` on `add_motion_keyframe`.

## Testing

Core: redistribution math (3-point run between anchors → constant speed; uniform fallback; endpoints protected; reapplication after move/remove). Pure curves module: mapping round-trips, seeding approximates named easings (sampled error bound), flat detection, speed sampling against an analytic case (linear segment → constant speed; symmetric ease → symmetric speed peak). Web RTL: dragging a grip writes bezier easing + handles through the store; one undo per drag; speed toggle renders; rove toggle sets the flag and times shift. Agent: `roving` accepted + preserved. Gate: tsc 0×3; core motion (494+) / web motion (162+) fully green; agent (387+).
Live visual: drag a handle on a position keyframe → curve visibly bends + overshoot works on the stage; toggle speed graph; rove a middle keyframe and watch its time slide.

## Risks

- **GraphEditorPanel is 2154 lines** — all new math goes in the pure module; the panel gains only rendering + pointer wiring.
- **Handle→engine mismatch**: the engine treats handles as the OUTGOING segment curve of `kf[i]`; the UI must attach P2 visually to `kf[i+1]` while writing to `kf[i]` — mapping tests lock this.
- **Roving interacts with the keyframe ops** (reverse/scale/duplicate/paste from the parity wave) — redistribution must run after those too; audit their call sites.
- Flat segments: handles moot for value output — disabled with a hint rather than pretending.
