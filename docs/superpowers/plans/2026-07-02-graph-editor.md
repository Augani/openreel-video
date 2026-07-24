# True Graph Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Draggable bezier tangent handles on the value graph, a Value↔Speed graph toggle (read-only speed), and roving keyframes — making hand-tuned easing possible in the UI.

**Architecture:** Pure math in a new `apps/web/src/motion/graph-editor-curves.ts` (handle↔graph mapping, easing-seeded conversion, flat detection, speed sampling); GraphEditorPanel gains only rendering + pointer wiring on the preview/commit gesture protocol; core gains `Keyframe.roving` + `redistributeRovingKeyframeTimes` reapplied after every keyframe mutation; MCP gains the `roving` param.

**Tech Stack:** TypeScript strict, SVG, Vitest + RTL.

## Global Constraints

- Do NOT git commit/add/stash/revert. NO line comments/docstrings. TS strict, NEVER `any`/unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates. TDD per task.
- Engine semantics are FIXED and already shipped: `kf[i].bezierHandles {in: P1, out: P2}` drives the OUTGOING segment `kf[i]→kf[i+1]` via `cubicBezier(t, in.x, in.y, out.x, out.y)` (keyframe-engine.ts:239-246); handles are normalized to the segment (x: time fraction 0..1, y: value fraction of Δv). Do NOT change the engine.
- Handle clamps: x ∈ [0,1], y ∈ [-1,2]. Flat segments (|Δv| < 1e-6) disable handle editing with a hint.
- Graph drags = ONE undo per gesture via the preview/commit protocol (`updateMotionCompositionPreview` + `commitMotionCompositionGesture` in project-store).
- All new panel math lives in graph-editor-curves.ts (pure, tested); GraphEditorPanel only renders/wires.
- Keep suites green: core motion 494+, web motion 162+, agent 387+; tsc 0 ×3 (`--ignoreDeprecations 6.0`).

**Execution note (controller):** Wave 1: T1 ∥ T2. Then T3 → T4 → T5 sequential (all GraphEditorPanel) with T6 parallel (registry, after T1). T7 gates.

---

### Task 1: Roving keyframes (core)

**Files:**
- Modify: `packages/core/src/types/timeline.ts` (`Keyframe` gains `readonly roving?: boolean`)
- Modify: `packages/core/src/motion/motion-keyframes.ts`
- Test: `packages/core/src/motion/motion-roving-keyframes.test.ts` (new)

**Interfaces — Produces:**
```ts
redistributeRovingKeyframeTimes(keyframes: readonly Keyframe[]): Keyframe[];   // pure, per-property list sorted by time
setMotionKeyframeRoving<T extends MotionLayer>(layer: T, property: string, keyframeId: string, roving: boolean): T;
```
Semantics: within each maximal run of consecutive `roving` keyframes bounded by non-roving anchors, recompute the roving keyframes' times so cumulative `|Δvalue|` progresses linearly in time between the anchors (constant speed); if the run's total |Δvalue| is ~0, distribute times uniformly. The first and last keyframe of a property NEVER rove — `setMotionKeyframeRoving` clears/rejects the flag for endpoints (no-op with the layer unchanged), and `redistributeRovingKeyframeTimes` ignores a roving flag on endpoints defensively. Integration: call the redistribution for the affected property at the end of `upsertMotionLayerKeyframe`, `moveMotionLayerKeyframe`, `removeMotionLayerKeyframe`, AND the keyframe transform ops (grep `reverseMotionPropertyKeyframes|scaleMotionPropertyKeyframes|duplicateMotionPropertyKeyframes|pasteMotionPropertyKeyframes` — audit each and apply where keyframe times/values change). Values are numeric via the existing keyframe value handling (non-numeric values → treat delta as 0).

- [ ] **Step 1: Failing tests** — (a) anchors at t=0 (v=0) and t=3 (v=300) with roving keyframes at v=100 and v=200 placed at arbitrary times → redistributed to t=1 and t=2 (constant speed 100/s); (b) zero-delta run (all same value) → uniform spacing; (c) endpoint roving flag ignored/cleared; (d) after `moveMotionLayerKeyframe` of an anchor, roving times shift accordingly; (e) `setMotionKeyframeRoving` on an endpoint is a no-op.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 2: Pure curves module (web)

**Files:**
- Create: `apps/web/src/motion/graph-editor-curves.ts`
- Test: `apps/web/src/motion/graph-editor-curves.test.ts` (new)

**Interfaces — Produces:**
```ts
interface GraphSegmentFrame { readonly t0: number; readonly t1: number; readonly v0: number; readonly v1: number;
  readonly toX: (time: number) => number; readonly toY: (value: number) => number;
  readonly fromX: (x: number) => number; readonly fromY: (y: number) => number; }
normalizedHandleToGraphPoint(handle: {x:number;y:number}, seg: GraphSegmentFrame): { x: number; y: number };
graphPointToNormalizedHandle(point: {x:number;y:number}, seg: GraphSegmentFrame): { x: number; y: number };  // clamped x[0,1], y[-1,2]
seedBezierHandlesFromEasing(easing: EasingType): { in: {x:number;y:number}; out: {x:number;y:number} };       // P1=(1/3,f(1/3)), P2=(2/3,f(2/3)); resolve f from core EASING_FUNCTIONS with linear fallback
isFlatSegment(v0: number, v1: number): boolean;                                                                // |Δv| < 1e-6
sampleSegmentSpeed(seg: {t0,t1,v0,v1, easing: EasingType, bezierHandles?}, samples: number): Array<{ time: number; speed: number }>;  // signed units/s; evaluate the eased curve exactly as the engine does (reuse/replicate cubicBezier + EASING_FUNCTIONS)
```
`GraphSegmentFrame` wraps the panel's existing time/value→pixel mappers so the module stays presentation-agnostic. Handle mapping: graph point for handle h = (toX(t0 + h.x·(t1−t0)), toY(v0 + h.y·(v1−v0))).

- [ ] **Step 1: Failing tests** — mapping round-trips (point→handle→point identity within ε, incl. clamping cases); seeding: `seedBezierHandlesFromEasing("linear")` ≈ {in:(⅓,⅓), out:(⅔,⅔)}; a seeded "ease-in-out" curve matches the named easing within 0.05 sampled at 10 points; flat detection; speed: linear segment → constant `(v1−v0)/(t1−t0)`; symmetric ease-in-out → symmetric speed with peak mid-segment.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 3: Handle rendering + drag (GraphEditorPanel) — after T2

**Files:**
- Modify: `apps/web/src/motion/components/GraphEditorPanel.tsx` (SVG graph ~858-925; drag plumbing ~440-530)
- Test: `apps/web/src/motion/components/GraphEditorPanel.handles.test.tsx` (new)

**Implementation:** Read the existing graph rendering (buildGraph/buildEasedGraphPath, keyframe diamond drag). For every segment whose `kf[i].easing === "bezier"` AND for the segments adjacent to the selected keyframe (any easing), render: a line from the kf[i] point to the P1 grip, a line from the kf[i+1] point to the P2 grip, and circular grips (~5px, `pointer-events` enabled, distinct fill; match the panel's existing SVG styling). Grip pointerdown starts a drag: convert pointer→graph coords (existing svg rect math)→`graphPointToNormalizedHandle`; if the segment isn't bezier yet, first seed via `seedBezierHandlesFromEasing(currentEasing)`; write `kf[i]` with `easing:"bezier"` + updated `bezierHandles` through the store. **Gesture protocol:** during drag use preview updates; single durable commit on pointerup. ALSO verify the existing keyframe-POINT drag: if it commits per pointermove (undo flood), route it through the same protocol (the sprint fixed StageCanvas/MotionTimeline but possibly not this panel). Flat segments: no grips; render a small muted hint dot + tooltip-ish title "Flat segment — handles have no effect". Keyframes without a next keyframe render no outgoing handles.

- [ ] **Step 1: Failing RTL test** — render the panel with a 2-keyframe bezier property: grips render (query by data-testid or role); simulating a grip drag writes `easing:"bezier"` + changed `bezierHandles` on kf[0] via the store; a drag on a non-bezier segment seeds handles approximating the prior easing; one drag → exactly one undo entry (drive the store like motion-drag-undo.test.ts).
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0; web motion suite fully green.** No commit.

---

### Task 4: Speed graph toggle — after T3 (same file)

**Files:**
- Modify: `apps/web/src/motion/components/GraphEditorPanel.tsx`
- Test: extend `GraphEditorPanel.handles.test.tsx`

**Implementation:** A `SegmentedControl` (Value | Speed) above the SVG (match panel control styling). Speed mode: build the polyline from `sampleSegmentSpeed` over all segments (16+ samples each); y-scale from sampled min/max (pad 10%, always include 0; draw a dashed zero-line); keyframe diamonds drawn at their times on the curve but drag-disabled; handles hidden; the value readout/right-hand fields keep working. Toggle state is panel-local.

- [ ] **Step 1: Failing RTL test** — toggling to Speed renders the speed polyline (testid) and hides grips; toggling back restores. **Step 2-5:** fail → implement → pass → web tsc 0.** No commit.

---

### Task 5: Roving UI — after T4 (same file), needs T1

**Files:**
- Modify: `apps/web/src/motion/components/GraphEditorPanel.tsx` (KeyframeRow ~1700-1800)
- Test: extend `GraphEditorPanel.handles.test.tsx`

**Implementation:** KeyframeRow gains a "Rove" toggle (SwitchInput, disabled for the property's first/last keyframe with a title explaining why) calling `setMotionKeyframeRoving` through the store; the row's time input becomes read-only while roving (time is derived). Graph renders roving keyframes with a distinct diamond style (e.g. hollow).

- [ ] **Step 1: Failing RTL test** — toggling Rove on a middle keyframe sets `roving:true` and its time shifts to the constant-speed position; endpoint toggle disabled. **Step 2-5:** fail → implement → pass → web tsc 0; full web motion suite green.** No commit.

---

### Task 6: MCP — after T1 (parallel with T3-T5)

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.roving.test.ts` (new)

**Implementation:** `add_motion_keyframe` gains `roving: bool` (validated boolean; applied via `setMotionKeyframeRoving` after the upsert — endpoint no-op semantics preserved; description explains roving + that endpoint keyframes cannot rove and that times are auto-derived). Update `transform_motion_keyframes`/`copy/paste` descriptions to note roving times re-derive after ops (behavior comes from T1's integration). Verify `add_motion_keyframe`'s existing bezier docs mention the handle semantics (P1/P2 outgoing-segment, x time-fraction / y value-fraction, y may exceed [0,1] for overshoot) — update if thin.

- [ ] **Step 1: Failing test** — add 4 keyframes, set roving on a middle one via the tool → stored `roving:true` + time re-derived; endpoint roving request → no-op (flag absent); invalid non-boolean → ignored or INVALID_PARAMS per optional-param convention. **Step 2-5:** fail → implement → pass → agent tsc 0 + agent suite.** No commit.

---

### Task 7: Integration verification + live visual

- [ ] **Step 1:** tsc 0 ×3. **Step 2:** core motion (494+), web motion (162+ FULLY green), agent (387+) all pass.
- [ ] **Step 3:** Live (dev server, Playwright): keyframe a property (e.g. Accent Bar position.x 0→400), drag the outgoing handle up past y=1 → the stage shows overshoot past the target; toggle Speed → speed curve renders; rove a middle keyframe → its diamond slides to the constant-speed time. Screenshots; 0 console errors. If the app can't launch, unit coverage stands; mark manual.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** handles→T2+T3, speed→T2+T4, roving→T1+T5+T6, verify→T7. ✓
- **Placeholders:** exact interfaces, semantics, seeds, clamps, and test assertions throughout. ✓
- **Type consistency:** `redistributeRovingKeyframeTimes`/`setMotionKeyframeRoving` (T1) used by T5/T6; `GraphSegmentFrame`/`graphPointToNormalizedHandle`/`seedBezierHandlesFromEasing`/`sampleSegmentSpeed` (T2) used by T3/T4. ✓
- **Ordering:** T1∥T2 → T3→T4→T5 (shared panel) ∥ T6 → T7. ✓
