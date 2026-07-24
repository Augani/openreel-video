# Expression Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** AE-grade expression rigging: multi-line expressions, `valueAtTime`, cycle-guarded cross-layer references (`thisComp.layer()`/`thisLayer`), keyframe introspection (`key/numKeys/nearestKey`), `effect(name)(param)`, Slider/Checkbox/Angle expression-control effects, visible errors, and a link-picker pick-whip.

**Architecture:** Upgrade `motion-expressions.ts` in three layers (extensible scope + dual-compile → evaluation context + self API → cross-layer + cycle guard), thread `{composition, layer}` context through every evaluation call site, add no-render control effect types, surface errors via a transient registry consumed by the GraphEditorPanel editor, and expose MCP tools.

**Tech Stack:** TypeScript strict, Vitest + RTL.

## Global Constraints

- Do NOT git commit/add/stash/revert. NO line comments/docstrings. TS strict, NEVER `any`/unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates. TDD per task.
- The no-expression fast path must stay allocation-free: bail out before any context/guard setup when the property has no enabled expression (preserve the existing early return).
- Context-dependent globals (`thisComp`, `thisLayer`, `key`, `effect`, `valueAtTime`) THROW descriptive errors when `context` is absent — never silently return 0.
- Cycle guard is mandatory before cross-layer evaluation lands: visited set keyed `layerId:property`, depth cap 8, per-top-level-evaluation memo. A hard A↔B cycle test must pass without hanging.
- Expression errors are recorded in the transient registry AND the value falls back to base — playback never throws.
- Audit ALL `evaluateMotionPropertyValueAtTime` call sites repo-wide (grep) when threading context; where a composition isn't available, leave the call unchanged.
- Keep the web motion suite FULLY green (152 baseline). Gate per task: core+web+agent `tsc --noEmit --ignoreDeprecations 6.0` → 0; task tests green; `pnpm --filter @openreel/core test:run src/motion` no regressions.

**Execution note (controller):** T1 → T2 → T3 sequential (same core file). Then T4 (core effects) ∥ T5 (web editor). Then T6 (EffectsPanel) ∥ T7 (MCP). T8 gates.

---

### Task 1: Extensible scope + multi-line dual-compile + error registry

**Files:**
- Modify: `packages/core/src/motion/motion-expressions.ts`
- Test: `packages/core/src/motion/motion-expressions.test.ts` (extend existing; create if absent)

**Interfaces — Produces:**
```ts
const MOTION_EXPRESSION_SCOPE_KEYS: readonly string[];   // single source for Function params + call args
getMotionExpressionError(expressionId: string): string | null;   // transient registry (module Map)
```
Refactor `compileMotionExpression` to build `new Function(...MOTION_EXPRESSION_SCOPE_KEYS, body)` and the evaluator call from the same key list (scope stays an object; args mapped by key). **Dual-compile:** try `"use strict"; return (${code});`; on SyntaxError try `"use strict"; ${code}` (body form — user writes `return`). Cache the compiled result per code string as today (a body-form success caches too). On evaluation throw: record `String(error.message)` in the registry keyed by the expression's id, return the fallback; on success clear the entry. Existing presets and tests must pass unchanged.

- [ ] **Step 1: Failing tests** — (a) multi-line body: `"const a = value * 2;\nreturn a + 1;"` evaluates (value=3 → 7); (b) single-expression path still works (`"value + 1"`); (c) a throwing expression (`"undefinedFn()"`) returns the fallback AND `getMotionExpressionError(id)` contains "undefinedFn"; a subsequent successful evaluation clears it; (d) adding a scope key to the canonical list makes it available (test via an existing global's presence, e.g. `clamp`).
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 2: Evaluation context + self API + call-site threading

**Files:**
- Modify: `packages/core/src/motion/motion-expressions.ts`
- Modify: every caller with a composition in hand — grep `evaluateMotionPropertyValueAtTime` repo-wide; known: `packages/core/src/motion/motion-renderer.ts`, `packages/core/src/motion/motion-keyframes.ts` (`getMotionLayerPropertyValueAtTime` ~974), `apps/web` graph/timeline readouts
- Test: extend `motion-expressions.test.ts`

**Interfaces — Produces:**
```ts
interface MotionExpressionContext { readonly composition: MotionComposition; readonly layer: MotionLayer; }
// EvaluateMotionPropertyOptions gains: readonly context?: MotionExpressionContext;
```
New scope globals (added to the canonical key list): `valueAtTime(t)` — this property's pre-expression value at `t` (evaluate keyframes/base only, never the own expression); `thisLayer` — lazily built `{ index, name, value(propertyId), valueAtTime(propertyId, t) }` where `value` = that property's **pre-expression** value on the own layer; `key(n)` (1-based → `{index,time,value}`, throws "key(n): property has only N keyframes" when out of range), `numKeys`, `nearestKey(t)`. All throw a descriptive error without `context` (the throw routes through Task 1's registry). Threading: pass `context: { composition, layer }` at every call site that has both (renderer evaluation entry points; `getMotionLayerPropertyValueAtTime` gains an optional trailing `composition?` param it forwards). Guard/memo scaffolding: create a per-top-level-evaluation state object `{ visited: Set<string>, depth: number, memo: Map<string, number> }` lazily ONLY when an enabled expression exists; thread it internally (Task 3 consumes it for cross-layer).

- [ ] **Step 1: Failing tests** — `valueAtTime(0)` on a keyframed property returns the t=0 keyframe value while the expression offsets the current value; `thisLayer.index`/`name` correct; `key(1).value`/`numKeys`/`nearestKey` match the keyframes; `key(99)` records a descriptive registry error and falls back; context-less evaluation of `"thisComp.numLayers"` records "requires composition context" and falls back.
- [ ] **Step 2: Run → fail. Step 3: Implement + thread call sites (list every touched site in your report). Step 4: pass. Step 5: core+web tsc 0; full motion suite.** No commit.

---

### Task 3: Cross-layer references + cycle guard + `effect()`

**Files:**
- Modify: `packages/core/src/motion/motion-expressions.ts`
- Test: extend `motion-expressions.test.ts`

**Interfaces — Produces (scope globals):** `thisComp` — `{ layer(nameOrIndex), numLayers, duration, width, height, frameRate }`; `layer(...)` accepts a name (exact match) or 1-based index, throws descriptively when not found; returns a handle `{ index, name, value(propertyId), valueAtTime(propertyId, t) }` whose `value/valueAtTime` for OTHER layers evaluate FULLY (their keyframes + their enabled expressions) through `evaluateMotionPropertyValueAtTime` with the SAME guard state: before evaluating `layerId:property`, if it's in `visited` or `depth >= 8`, return that property's pre-expression value (and record a "cycle detected" breadcrumb in the registry for the guarded expression); memoize results per top-level evaluation. `effect(name)` — finds the named enabled effect on `context.layer`, returns `(paramName: string) => number` reading the param via the existing keyframed path (`getMotionEffectParameterValueAtTime`, keyframes on `effect.<id>.<param>`); unknown effect/param throws descriptively.

- [ ] **Step 1: Failing tests** — (a) layer B's expression `thisComp.layer("A").value("transform.position.x") + 100` tracks A incl. A's own expression; (b) hard cycle: A.x references B.x and B.x references A.x — both evaluate to pre-expression values, no hang, registry holds a cycle breadcrumb; (c) depth chain of 10 layers caps at 8 without hanging; (d) `effect("Wobble")("radius")` returns the keyframed param value at eval time; unknown name → registry error + fallback; (e) `thisComp.layer(2)` index lookup works.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 4: Expression-control effects — after T3

**Files:**
- Modify: `packages/core/src/motion/types.ts` (`MotionEffectType` union + effect interfaces)
- Modify: `packages/core/src/motion/motion-effects.ts` (create/defaults/descriptors)
- Modify: `packages/core/src/motion/motion-renderer.ts` (exclude controls from every render/apply path — audit `getEnabledMotionEffects` consumers and the buffered classifiers `layerNeedsBufferedEffects`/CSS-filter path)
- Test: `packages/core/src/motion/motion-expression-controls.test.ts` (new)

**Interfaces — Produces:** `MotionEffectType |= "slider-control" | "checkbox-control" | "angle-control"`. Each is a `MotionEffect` with params: slider `value` (finite float, default 0, no clamp), checkbox `value` (0|1, default 0, setter clamps to {0,1}), angle `value` (degrees float, default 0). `createMotionEffect` supports the three (names default "Slider Control"/"Checkbox Control"/"Angle Control"); parameter get/set/descriptors flow through the existing effect-param machinery so keyframing + `effect(name)("value")` (T3) work unchanged. Renderer: a shared `isMotionExpressionControlEffect(effect)` predicate excludes them from CSS-filter building, pixel/buffered application, and any effect-render classifier — a layer whose only effects are controls renders exactly as if it had none.

- [ ] **Step 1: Failing tests** — create each control; params get/set/clamp (checkbox 0|1); keyframe `effect.<id>.value` evaluates at time; a layer with only a slider control is NOT classified as needing buffered effects and produces no CSS filter; T3's `effect("Slider Control")("value")` reads it.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 5: Error surfacing + multi-line editor + link picker — after T3 (parallel with T4)

**Files:**
- Modify: `apps/web/src/motion/components/GraphEditorPanel.tsx` (the Expression section)
- Test: `apps/web/src/motion/components/GraphEditorPanel.expression.test.tsx` (new)

**Implementation:** Read the existing Expression section first (editor field, enable toggle, preset picker). (1) Swap the input to a multi-line `textarea` (monospace, ~4 rows, keeps the existing write path). (2) After edits/playhead changes, read `getMotionExpressionError(expression.id)`; when non-null render a red badge + the message text under the editor (role="alert"); clears when null. Poll-free: read on render (the panel re-renders on scrub/edit; acceptable v1). (3) "Insert reference" row: layer select (composition layers by name) + property select (that layer's animatable descriptors — reuse `getGraphEditorAvailableProperties`-style sources) + Insert button appending `thisComp.layer("<escaped name>").value("<propertyId>")` (same layer → `thisLayer.value("<propertyId>")`) to the expression text via the existing update path. Escape quotes/backslashes in layer names.

- [ ] **Step 1: Failing RTL tests** — a bad expression (evaluate once via the store/eval helper to populate the registry) renders the alert with the message; fixing it clears the alert; the picker inserts `thisComp.layer("B").value("transform.opacity")` for another layer and `thisLayer.value(...)` for the same layer.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0; full web motion suite stays fully green.** No commit.

---

### Task 6: EffectsPanel controls group — after T4 (parallel with T7)

**Files:**
- Modify: `apps/web/src/motion/components/EffectsPanel.tsx`
- Test: extend `apps/web/src/motion/components/EffectsPanel.shader.test.tsx` pattern in a new `EffectsPanel.controls.test.tsx`

**Implementation:** Add an "Expression controls" group (mirroring the Shaders gallery pattern): three add-buttons (Slider/Checkbox/Angle control) using `createMotionEffect` + `addMotionLayerEffect`; auto-suffix duplicate names ("Slider Control 2"). Control rows reuse the existing effect param controls (numeric input; checkbox renders as a Switch writing 0/1) + the existing rename/remove/toggle affordances if present. Show the effect's name prominently (it's the expression reference key) with a small "use: effect(\"<name>\")(\"value\")" hint line (plain text).

- [ ] **Step 1: Failing RTL test** — clicking "Add Slider control" adds a `slider-control` effect to the selected layer; its value edits persist; a second add gets a suffixed name.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 7: MCP tools — after T4 (parallel with T6)

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.expression.test.ts` (new)

**Implementation:** (1) Locate the existing expression tools (grep `motion_expression` in registry.ts) and update their descriptions to document the new API (multi-line, valueAtTime, thisComp.layer().value(), key/numKeys/nearestKey, effect(name)(param), cycle-guard semantics) — descriptions only unless validation rejects multi-line strings (fix if so). (2) New tool `add_motion_expression_control`: `compositionId, layerId, controlType (slider|checkbox|angle), name?, value?` → creates the control effect (validated type; name defaults per T4; value applied via the param setter), returns `{ effectId, name }`. (3) Confirm `list_motion_animatable_properties` surfaces the control's `effect.<id>.value` param (it should via existing effect descriptors — assert it).

- [ ] **Step 1: Failing tests** — add a slider control via the tool → effect exists with name + value; expression referencing it via `effect(name)("value")` evaluates through the core engine (drive `evaluateMotionPropertyValueAtTime` directly with context); invalid controlType → `INVALID_PARAMS`; the animatable-properties listing includes the control param.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: agent tsc 0 + agent tests.** No commit.

---

### Task 8: Integration verification + live visual

- [ ] **Step 1:** core+web+agent tsc → 0. **Step 2:** full core motion suite; web motion suite FULLY green (152 baseline + new); agent suite green.
- [ ] **Step 3:** Live (dev server, Playwright): rig layer B to follow layer A (`thisComp.layer("A").value(...) + offset` inserted via the picker), scrub — B tracks A; add a Slider control and drive opacity via `effect("Slider Control")("value")`, change the slider, see it; type a broken expression, see the red badge + message, fix it, badge clears. Screenshot each. If the app can't launch, unit coverage stands; mark manual.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** §1→T1, §2/§3(self)→T2, §3(cross+effect)→T3, §4→T4, §5+§6→T5, §4 UI→T6, §7→T7, verify→T8. ✓
- **Placeholders:** every task carries exact interfaces, semantics (pre-expression vs full evaluation, guard rules), and concrete test assertions. ✓
- **Type consistency:** `MOTION_EXPRESSION_SCOPE_KEYS`, `getMotionExpressionError`, `MotionExpressionContext`, guard `{visited,depth,memo}`, `isMotionExpressionControlEffect`, control type names (`slider-control|checkbox-control|angle-control`), `add_motion_expression_control` consistent across tasks. ✓
- **Ordering:** T1→T2→T3 (same file); T4∥T5 after T3; T6∥T7 after T4; T8 gates. ✓
