# Bezier Pen + Animatable Path System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Vertex-preserving path animation, a real pen (click-drag handles) with full on-canvas vertex editing, bezier masks, and keyframed mask-path animation — rotoscoping-capable, shapes + masks on one shared vertex model.

**Architecture:** `MotionShapePathPoint` (x/y + in/out handles, already in motion-shape-path.ts) becomes the single vertex model. Core: fix pathData round-trip fidelity, add `interpolateMotionPathPoints` (equal-count lerp of vertices+handles, resample fallback), add mask `"path"` shape + `pathKeyframes` evaluated with the same interpolator. Web: pen draw/edit interactions in a new `stage-path-editing.ts` helper consumed by StageCanvas, mask drawing via MasksPanel, mask-path timeline lane. Agent: mask-path MCP tools.

**Tech Stack:** TypeScript strict, Canvas2D, React, Vitest + RTL.

## Global Constraints

- Do NOT git commit/add/stash/revert. NO line comments/docstrings. TS strict, NEVER `any`/unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates. TDD per task.
- The plan's file:line anchors are fresh but READ the code before editing.
- Shared vertex model is `MotionShapePathPoint` — do NOT introduce a second path-point type. Path masks use layer-local pixel coordinates; legacy mask shapes (rectangle/ellipse/polygon + normalized bounds) stay untouched.
- All canvas gestures use the existing preview/commit protocol (`updateMotionCompositionPreview` + `commitMotionCompositionGesture` in project-store) — one undo per gesture.
- Keep the web motion suite FULLY green (112/112 incl. scene3d) — no new known-failures.
- Gate per task: core+web+agent `tsc --noEmit --ignoreDeprecations 6.0` → 0; task tests green; `pnpm --filter @openreel/core test:run src/motion` no regressions.

**Execution note (controller):** Wave 1: T1 ∥ T2 ∥ T4. Wave 2: T3 (needs T1+T2) ∥ T5 (needs T4). Wave 3: T6 (needs T3+T5) ∥ T7 (needs T3). T8 gates.

---

### Task 1: pathData fidelity + vertex-preserving interpolation

**Files:**
- Modify: `packages/core/src/motion/motion-shape-path.ts`
- Test: `packages/core/src/motion/motion-shape-path.test.ts` (extend the existing file — find it; if absent create)

**Interfaces — Produces:**
```ts
interpolateMotionPathPoints(
  from: readonly MotionShapePathPoint[],
  to: readonly MotionShapePathPoint[],
  progress: number,
): MotionShapePathPoint[];
```
Equal counts + same closed-ness → per-index lerp of `x/y/inX/inY/outX/outY` (missing handle = vertex position; if BOTH sides lack a handle, output omits it so corners stay corners); else fall back to the existing resample morph. `buildMotionPathData` must emit cubic `C` segments for handled vertices so `parseMotionPathData(buildMotionPathData(pts))` round-trips handles losslessly (read both; fix the builder if it drops curves). Route `morphMotionPathData` (line ~634) and `getMotionShapePathDataAtTime` (~481) through the interpolator.

- [ ] **Step 1: Failing tests** — (a) round-trip: points with handles → pathData → points, handles preserved (±1e-6); (b) equal-count interpolation at t=0.5: vertex and handle midpoints exact; corners (no handles both sides) stay handle-less; (c) mismatched counts falls back (result has resample count, no throw); (d) `getMotionShapePathDataAtTime` between two handled keyframes yields a `C`-containing pathData, not flattened `L`s.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 2: Bezier mask shape

**Files:**
- Modify: `packages/core/src/motion/types.ts` (`MotionMaskShape` ~46, `MotionMask` ~396-431)
- Modify: `packages/core/src/motion/motion-masks.ts` (clip-path construction — read how rectangle/ellipse/polygon build clip regions, ~344-480)
- Modify: `packages/core/src/motion/motion-renderer.ts` (only if mask clipping is applied there — grep `clip(` + mask usage first)
- Test: `packages/core/src/motion/motion-masks.test.ts` (extend existing)

**Interfaces — Produces:** `MotionMaskShape |= "path"`; `MotionMask.pathPoints?: readonly MotionShapePathPoint[]` (layer-local px). A helper `getMotionMaskPathPoints(mask, layer): MotionShapePathPoint[] | undefined` returning the path for `shape === "path"` (validated: ≥3 points). Clip building: for path masks, emit the same bezier draw commands shape paths use (reuse `getMotionPathDrawCommands`, motion-shape-path.ts:381) instead of the polygon `lineTo` walk; feather/expansion/opacity/modes/inverted must keep working unchanged (they operate on the resulting region/alpha, verify by reading).

- [ ] **Step 1: Failing tests** — a `path` mask with a curved triangle: clip commands contain a bezier (spy/inspect the built Path2D or draw-command list); invalid (<3 points) path mask is ignored like other degenerate masks; legacy shapes untouched (existing tests stay green).
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 3: Mask path keyframes (rotoscoping) — after T1 + T2

**Files:**
- Modify: `packages/core/src/motion/types.ts` (`MotionMask.pathKeyframes?: readonly Keyframe[]`)
- Modify: `packages/core/src/motion/motion-masks.ts` (evaluation + upsert/remove helpers)
- Modify: `packages/core/src/motion/motion-keyframes.ts` (property recognition + descriptor)
- Test: `packages/core/src/motion/motion-mask-path-keyframes.test.ts` (new)

**Interfaces — Produces:**
```ts
upsertMotionMaskPathKeyframe<T extends MotionLayer>(layer: T, maskId: string, time: number, pathData?: string): T;
removeMotionMaskPathKeyframe<T extends MotionLayer>(layer: T, maskId: string, keyframeId: string): T;
getMotionMaskPathPointsAtTime(mask: MotionMask, localTime: number): MotionShapePathPoint[] | undefined;
```
Keyframe values are `pathData` snapshots (mirror `upsertMotionShapePathKeyframe`, motion-shape-path.ts:444 — copy its snap-tolerance/id semantics). Evaluation: ≤1 keyframe → static `pathPoints`; else bracket keyframes, apply the keyframe's easing to progress, `interpolateMotionPathPoints` (T1). Wherever mask clipping resolves points (T2's `getMotionMaskPathPoints`), thread `localTime` and use the animated path. Property id: `mask.${id}.path` — add recognition to `isMotionAnimatableProperty` and a descriptor (group "Mask", label "Mask Path") so a timeline lane can render diamonds; the property is NON-numeric: `getMotionLayerPropertyValueAtTime` must not attempt numeric evaluation for it (guard: return 0) — the lane is diamonds-only like AE.

- [ ] **Step 1: Failing tests** — two path keyframes (t=0 square-ish, t=1 with pulled handles): at t=0.5 points are midway AND handles interpolated; easing respected (t=0.5 with ease-out ≠ linear midpoint); `isMotionAnimatableProperty("mask.abc.path")` true; upsert-at-same-time replaces not duplicates.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 4: Pen draw — click-drag pulls handles

**Files:**
- Create: `apps/web/src/motion/stage-path-editing.ts` (pure gesture math — testable)
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (pen draft handling, `penDraftPointsRef` ~230-240 + the pen pointer handlers)
- Test: `apps/web/src/motion/stage-path-editing.test.ts` (new)

**Interfaces — Produces (pure functions in stage-path-editing.ts):**
```ts
penAddCorner(points: readonly MotionShapePathPoint[], p: MotionVector2): MotionShapePathPoint[];
penDragHandles(points: readonly MotionShapePathPoint[], drag: { anchor: MotionVector2; current: MotionVector2 }): MotionShapePathPoint[];
// last vertex becomes smooth: out = current, in = mirror of current about anchor
penShouldClose(points: readonly MotionShapePathPoint[], p: MotionVector2, tolerancePx: number): boolean;
```
StageCanvas: pointerdown with the pen adds a corner at the point; if the pointer moves >3px while down, continuously replace the last vertex's handles via `penDragHandles` (live preview); pointerup finalizes the vertex. Click within tolerance of the first vertex (or Enter) closes; Escape cancels the draft. Existing draft state/refs are reused; the commit path (existing pen finalize → shape layer with `pathData`) now serializes handles (works because T1 fixed the builder — but T4 must NOT depend on T1 landing: `buildMotionPathData` is only called at finalize; if T1 hasn't landed in your worktree, still write handles into the draft points and call the existing builder as-is).

- [ ] **Step 1: Failing unit tests (pure)** — `penDragHandles` yields symmetric in/out mirrored about the anchor; `penAddCorner` appends a handle-less vertex; `penShouldClose` true within tolerance of first point, false otherwise and for <3 points.
- [ ] **Step 2: Run → fail. Step 3: Implement (pure module first, then wire StageCanvas). Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 5: Vertex/handle edit mode — after T4 (shares StageCanvas + helper)

**Files:**
- Modify: `apps/web/src/motion/stage-path-editing.ts` (edit-gesture pure functions)
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (overlay + pointer routing)
- Test: extend `apps/web/src/motion/stage-path-editing.test.ts`

**Interfaces — Produces (pure):**
```ts
hitTestPath(points, p, tolerancePx): { kind: "vertex" | "in" | "out" | "segment"; index: number; t?: number } | null;
moveVertex(points, index, delta): MotionShapePathPoint[];            // handles translate with the vertex
moveHandle(points, index, which: "in" | "out", p, symmetric: boolean): MotionShapePathPoint[];
toggleVertexSmooth(points, index): MotionShapePathPoint[];           // corner→smooth (auto handles ⅓ toward neighbors) / smooth→corner (drop handles)
```
StageCanvas: when the selected layer is a `path` shape (and, after T6, a path mask) and the tool is pen or select, render a vertex/handle overlay (small squares for vertices, circles + lines for handles — follow the existing selection-overlay drawing style); route pointer events by `hitTestPath`: drag vertex → `moveVertex`, drag handle → `moveHandle` (Alt = asymmetric), pen-click on segment → insert via existing `insertMotionShapePathPoint` (motion-shape-path.ts:598), Delete key removes the selected vertex via `removeMotionShapePathPoint` (guard min 3 closed / 2 open), double-click or Alt-click vertex → `toggleVertexSmooth`. Every gesture: preview during, single commit on release. If the layer has path keyframes and edits happen with the playhead between keys, write a path keyframe at the playhead (use `upsertMotionShapePathKeyframe`).

- [ ] **Step 1: Failing unit tests (pure)** — hitTest picks the nearest vertex within tolerance and reports handles distinctly; `moveVertex` translates handles with the vertex; `moveHandle` symmetric mirrors, asymmetric doesn't; `toggleVertexSmooth` round-trips corner↔smooth.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0; full web motion suite stays green.** No commit.

---

### Task 6: Mask drawing/editing + timeline lane — after T3 + T5

**Files:**
- Modify: `apps/web/src/motion/components/MasksPanel.tsx` ("Draw mask" entry, path-mask row, stopwatch)
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (mask-draw mode: pen draft targets a mask; edit overlay reads/writes `mask.pathPoints`)
- Modify: `apps/web/src/motion/components/MotionTimeline.tsx` (a `mask.<id>.path` diamonds lane when the mask has pathKeyframes)
- Test: `apps/web/src/motion/components/MasksPanel.path.test.tsx` (new)

**Implementation:** MasksPanel gains "Draw mask (pen)" — arms a mask-draw mode in the store; the pen draft (T4) finalizes into `addMotionLayerMask`-style creation with `shape:"path"` + the drawn `pathPoints` (layer-local coords — convert from stage coords the same way shape-path drafting does; read the existing pen finalize). Selecting a path mask shows the T5 edit overlay operating on `mask.pathPoints` (or, when animated, on the evaluated points at the playhead, writing a keyframe via `upsertMotionMaskPathKeyframe` when the stopwatch is on). MasksPanel path-mask rows get a stopwatch toggle (creates/removes the t=playhead path keyframe) mirroring how other mask properties expose keyframing. MotionTimeline: when `mask.pathKeyframes` is non-empty, render a "Mask Path" lane with draggable diamonds (reuse the existing keyframe-lane machinery; the property is non-numeric so no graph curve).

- [ ] **Step 1: Failing RTL test** — arm draw-mask, simulate a finalized draft → layer gains a mask with `shape:"path"` and ≥3 pathPoints; stopwatch on a path mask at t=1 adds a `pathKeyframes` entry; the timeline shows a Mask Path lane with a diamond.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0; full web motion suite green.** No commit.

---

### Task 7: MCP tools — after T3

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.mask-path.test.ts` (new)

**Implementation:** Following the motion-tool scaffold: (a) extend the existing mask-creation tool (`add_motion_mask`, ~23354) to accept `shape:"path"` + `pathPoints` (validate ≥3 finite points); (b) `set_motion_mask_path` — replace a mask's pathPoints (same validation), NOT_FOUND on bad ids; (c) `add_motion_mask_path_keyframe` — `compositionId, layerId, maskId, time, pathPoints?` (defaults to current path) → `upsertMotionMaskPathKeyframe`; returns keyframe id; (d) verify the shape-path tools already accept handle coordinates (`inX/outX...`) — extend their param parsing if they strip handles. Descriptions must state coordinates are layer-local pixels.

- [ ] **Step 1: Failing tests** — create a path mask via the tool → stored `shape:"path"` with points; `set_motion_mask_path` replaces; keyframe tool adds a `pathKeyframes` entry; <3 points / non-finite → `INVALID_PARAMS`.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: agent tsc 0 + agent tests.** No commit.

---

### Task 8: Integration verification + live visual

- [ ] **Step 1:** core+web+agent tsc → 0. **Step 2:** full core motion suite; `apps/web && npx vitest run src/motion` — FULLY green (112+ incl. scene3d, no new failures); agent vitest green.
- [ ] **Step 3:** Live (dev server, Playwright): draw a curved path with click-drag (assert the stored pathData contains `C`), pull a handle in edit mode, draw a path mask over a shape and keyframe it at t=0/t=1 with different shapes, scrub → the mask visibly morphs with curves (screenshot at t=0.5). If the app can't launch, unit coverage stands; mark live check manual.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** §1→T1, §2→T2, §3→T3, §4 draw→T4 / edit→T5, masks UI+lane→T6, §5→T7, testing→T8. ✓
- **Placeholders:** every task has exact interfaces, behaviors, and test assertions; implementers verify anchors in code. ✓
- **Type consistency:** `interpolateMotionPathPoints` (T1) consumed by T3; `MotionMask.pathPoints`/`pathKeyframes` + `getMotionMaskPathPointsAtTime`/`upsertMotionMaskPathKeyframe` (T2/T3) consumed by T6/T7; `stage-path-editing.ts` pure API (T4/T5) consumed by StageCanvas + T6; single vertex model `MotionShapePathPoint` throughout. ✓
- **Ordering:** T1∥T2∥T4 → T3∥T5 → T6∥T7 → T8. StageCanvas serialized (T4→T5→T6); motion-masks serialized (T2→T3→T6 via waves). ✓
