# Expression Engine (AE-grade rigging) — Design

**Date:** 2026-07-02
**Status:** Approved scope (full rigging v1)
**Source:** AE-parity review big rock #2 (docs/reviews/2026-07-01-ae-parity-review.md §4.2)
**Branch:** feat/new-design-update

## Problem

Expressions today (packages/core/src/motion/motion-expressions.ts): a single-line JS expression per property compiled via `new Function` with 9 fixed positional globals (`value/time/wiggle/loopOut/linear/ease/clamp/random/Math`), scalar returns only, silently falling back to the base value on any error, and **no composition/layer context in evaluation** — so no cross-layer references, no `valueAtTime`, no keyframe introspection, no expression controls, no error visibility. Any rig that reads another layer, another time, or a control effect is impossible.

## Goals (v1)

1. **Language/engine:** multi-line bodies; extensible scope; `valueAtTime(t)`; `thisLayer`/`thisComp.layer(...)` cross-layer references (cycle-guarded); `key(n)/numKeys/nearestKey(t)`; `effect(name)(param)`.
2. **Expression controls:** Slider / Checkbox / Angle control effects (no render, keyframeable params) referenced from expressions.
3. **Error surfacing:** per-expression error state visible in the UI (red badge + message), never silently swallowed.
4. **Link picker ("pick-whip"):** insert a cross-layer/property reference from dropdowns; drag-whip is a stretch goal, not required.
5. **MCP:** expression tools accept the new language; a tool adds control effects.

## Non-Goals

Full AE API surface (no `wiggle` phase params overhaul, no `marker`s, no text sourceText expressions, no `toComp/fromComp` space conversions); array-valued returns (our property model is per-channel scalars — an expression on `transform.position.x` returns a number; documented AE-diff); color/point controls (non-scalar; later); drag pick-whip (stretch only); expression editor syntax highlighting.

## Design

### 1. Compilation (extensible scope + multi-line)
Replace the 9 positional args with a canonical `MOTION_EXPRESSION_SCOPE_KEYS: readonly string[]` driving both `new Function(...keys, body)` and the call args — adding a global becomes a one-list change. **Dual-compile:** first try `"use strict"; return (${code});` (existing single-expression path, keeps all presets working); on SyntaxError compile `"use strict"; ${code}` as a body (multi-line, user writes `return`). Cache both forms as today (keyed by code).

### 2. Evaluation context
`EvaluateMotionPropertyOptions` gains optional `context?: { composition: MotionComposition; layer: MotionLayer }`. All call sites that have a composition in hand (renderer transform/effect/style evaluation, graph editor, timeline value readouts) thread it; sites without it keep working — context-dependent globals throw a descriptive error ("thisComp requires composition context") that surfaces like any expression error. Audit ALL `evaluateMotionPropertyValueAtTime` callers (grep whole repo) and thread where possible.

### 3. Expression API (new scope globals)
All cycle-guarded (shared evaluation guard: visited set of `layerId:property`, depth cap 8, per-evaluation memo map):
- `valueAtTime(t)` — this property's **pre-expression** value (keyframes/base) at time `t`. Not re-running the own expression avoids self-recursion; documented AE-diff.
- `thisLayer` — `{ index, name, value(propertyId), valueAtTime(propertyId, t) }`; `value` = pre-expression for own properties.
- `thisComp` — `{ layer(nameOrIndex), numLayers, duration, width, height, frameRate }`. `layer(...)` returns a handle like `thisLayer`; **other** layers' `value/valueAtTime` evaluate fully (their keyframes + their expressions) under the shared guard — on a cycle, the guarded property yields its pre-expression value.
- `key(n)` (1-based) → `{ index, time, value }` for this property; `numKeys`; `nearestKey(t)` → same shape. Missing keyframe → throws a descriptive error (surfaced, not swallowed).
- `effect(name)` → `(paramName) => number`: the named effect's numeric param value at eval time (keyframed via the existing `effect.<id>.<param>` path), matched by effect name on this layer. Works for any effect, including the new controls.

### 4. Expression-control effects
New `MotionEffectType` values: `slider-control` (param `value`, unbounded float, default 0), `checkbox-control` (param `value`, 0|1, default 0), `angle-control` (param `value`, degrees, unbounded, default 0). They render nothing: excluded from every render/buffered-effect classifier; they exist to hold keyframeable params referenced by `effect("My Slider")("value")`. EffectsPanel gains an "Expression controls" group; effects are nameable (reuse existing effect rename if present, else the effect's `name` field is set at add time "Slider Control", "Slider Control 2", …).

### 5. Error surfacing
Evaluation records errors in a transient module-level registry: `getMotionExpressionError(expressionId): string | null` (set on throw with the message, cleared on success; never persisted). The value still falls back to base (playback never breaks). UI: the expression editor (GraphEditorPanel's Expression section) shows a red badge + the message under the field; property rows with a failing expression show a warning dot. The existing per-expression `enabled` toggle remains the kill-switch.

### 6. Link picker
In the expression editor: "Insert reference" — two selects (layer, then that layer's animatable property from its descriptors) + insert, producing `thisComp.layer("Name").value("transform.position.x")` (or `thisLayer.value(...)` for the same layer) at the cursor/end. Layer names are escaped. Drag pick-whip: stretch, only if trivially attachable to the existing drag infra.

### 7. MCP
Existing expression tools (`add/update/remove/toggle_motion_expression` family — verify names in registry) get updated descriptions documenting the new API; add `add_motion_expression_control` (`compositionId, layerId, controlType: slider|checkbox|angle, name?, value?`) returning the `effectId`/name for reference in expressions. `list_motion_animatable_properties` already surfaces effect params (controls' params ride along automatically).

## Testing

Core: multi-line dual-compile (expression + body forms, cache both); scope-key extensibility; `valueAtTime` pre-expression semantics; `thisComp.layer().value()` full evaluation incl. the other layer's expression; cycle A↔B yields pre-expression values without hanging (and records an error breadcrumb); depth cap; `key/numKeys/nearestKey` incl. missing-key error; `effect(name)(param)` with keyframed control; context-less evaluation of context-dependent globals surfaces an error; control effects render nothing and are excluded from buffered classifiers. Web: error badge renders on a bad expression and clears on fix; link picker inserts the right reference; controls appear in EffectsPanel and their params keyframe. Agent: control tool + expression tools round-trip. Gate: tsc 0 ×3; core motion suite; web motion suite FULLY green (152 baseline); agent suite. Live visual: layer B follows layer A via picker-inserted reference with offset; a slider control drives opacity; a broken expression shows the red badge; scrub proves it.

## Risks

- **Hot-path cost:** context objects + guard allocation per evaluation. Mitigate: allocate the guard/memo once per top-level evaluate call, lazy-create handles, and keep the no-expression fast path allocation-free (check `expressions` emptiness before any setup — existing behavior).
- **Cycles/recursion:** the shared guard + depth cap is mandatory before cross-layer lands; tests must include a hard A↔B cycle.
- **Call-site audit:** context threading touches the renderer's hottest functions — audit every caller (grep), thread composition where available, never change behavior when `context` is absent.
- **`new Function` safety:** unchanged threat model from today (user's own project, same as AI shaders).
