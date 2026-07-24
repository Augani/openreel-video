# Motion MCP Exposure: Shaders + Scene3D Editing + Fill-Param Keyframing — Design

**Date:** 2026-07-01
**Status:** Design (pending user review)
**Branch:** feat/new-design-update

## Problem

The Figma-gap work added three UI-only motion capabilities with **zero MCP coverage**, so an agent driving the app over the MCP HTTP bridge cannot use them:

- **Shader fills** (liquid-metal / watercolor / gradient-noise) — Plan B. `set_motion_shape_style` only offers `solid|gradient|none`; text only `color|fillGradient`.
- **Shader effects** (dither / gradient-map / pixelate / halftone) — Plan A. `add_motion_effect`'s enum excludes every GPU shader.
- No tool enumerates the shader library, so an agent can't discover valid `shaderId`s or param ranges.

Motion **scene3d** is already largely exposed (`add_motion_3d_scene`, `add_motion_3d_object`, `add_scene_object`, `set_motion_scene3d_lighting`, `animate_scene_camera`, `animate_scene_object`) — but **editing or removing an already-placed object**, and **static-setting the scene3d layer's own camera**, are only reachable by detouring through the `creation_*` tools.

**Param keyframing:** shader **effect** params already keyframe (core property path `effect.<id>.<param>`, drivable today via `add_motion_keyframe`). Shader **fill** params do **not** — fills carry no effect id and there is no fill-shader property path in the keyframe system or the renderer's per-frame evaluation. Adding it is net-new core work.

## Goals

Make all of the above drivable over the MCP, matching Figma Motion's "keyframeable parameterized shaders" headline: create/set shader fills and effects, keyframe their params over time, discover the library, and finish motion-native scene3d object editing.

## Non-Goals

- No GLSL code editor or AI-generated shaders (separate sub-projects 3/4).
- No new shaders beyond the existing 3 fills + 4 effects.
- No changes to the `creation_*` 3D system.
- No rework of the established `set_motion_shape_style` / `add_motion_effect` tools (new dedicated tools instead → lower regression risk; the shader param model — `shaderId` + a numeric `params` bag — differs enough from solid/gradient that folding it in would bloat those handlers).

## Architecture

All new tools are `domain: "motion"` plain-object entries appended to the `TOOLS` array in `packages/agent/src/registry.ts`, following the established scaffold:
`host.requireOpenProject()` → `getMotionComposition(host, compositionId)` → `getMotionLayer(composition, layerId)` → build a **new immutable layer** via core pure-functions → `commitMotionComposition(host, replaceMotionLayer(composition, layerId, nextLayer))` (which reflows auto-layout groups and dispatches the single undoable `host.applyAction` chokepoint). Input is coerced with the existing helpers (`optionalString`, `optionalNumber`, `asRecord`); enums checked against `Set`s; invalid input → `fail(msg, "INVALID_PARAMS")`.

Core exports the tools call (subpath specifiers, matching registry convention):
- `@openreel/core/motion/shaders`: `getMotionShaderFillDefs`, `getMotionShaderEffectDefs`, `getMotionShaderDef`, `defaultMotionShaderParams`, `MotionShaderDef`/`MotionShaderParamDef`.
- `@openreel/core/motion/motion-shape-style`: `createDefaultMotionShaderFill(shaderId)` (shape `FillStyle`), `isShaderFill`.
- `@openreel/core/motion/motion-effects`: `createMotionShaderEffect(shaderId)`, `addMotionLayerEffect`, `updateMotionLayerEffect`.
- `@openreel/core/motion/motion-scene3d`: `MOTION_OBJECT_3D_KINDS`, object/material/transform types.
- `@openreel/core/motion/motion-keyframes`: the animatable-property union + descriptors (extended in Part 4).

## Part 1 — Shader MCP tools

### 1a. `list_motion_shaders` (readOnly)
Enumerate the shader library so an agent can discover valid ids + params before calling the setters.
- Input: none (optionally `category: "fill" | "effect"` to filter).
- Output `data`: `{ fills: ShaderInfo[], effects: ShaderInfo[] }` where `ShaderInfo = { id, name, category, params: { name, label, min, max, default, step, control }[] }`, built from `getMotionShaderFillDefs()` / `getMotionShaderEffectDefs()`.

### 1b. `set_motion_shader_fill`
Set a shape's `style.fill` or a text layer's `style.fillShader` to a procedural shader.
- Input: `compositionId`, `layerId`, `shaderId` (required; must be a **fill** shader), `params?` (partial `Record<string, number>` overrides).
- Validation: `shaderId ∈ getMotionShaderFillDefs()` else `fail`. Clamp each supplied param to its def `[min,max]`; ignore unknown param names; missing params use `defaultMotionShaderParams`.
- Shape layer → `style.fill = { type:"shader", opacity: <existing ?? 1>, shader: { shaderId, params } }` (start from `createDefaultMotionShaderFill(shaderId)`, then overlay clamped params).
- Text layer → `style.fillShader = { shaderId, params }`.
- Reject layer types that are neither shape nor text.
- Commit; return the resolved `{ shaderId, params }`.

### 1c. `add_motion_shader_effect`
Add a GPU shader effect to any visual layer.
- Input: `compositionId`, `layerId`, `shaderId` (required; must be an **effect** shader), `params?`.
- Validation: `shaderId ∈ getMotionShaderEffectDefs()`. Build via `createMotionShaderEffect(shaderId)`, overlay clamped params, `addMotionLayerEffect(layer, effect)`, commit.
- Return the new `effectId` (so the agent can immediately keyframe it via `add_motion_keyframe` with `effect.<effectId>.<param>`).
- Removal / enable-disable / one-shot param edits reuse the existing generic `remove_motion_effect` / `toggle_motion_effect` / `update_motion_effect` (all keyed by `effectId`). Part 3 verifies `update_motion_effect` accepts shader param names; if it validates against a fixed enum, extend it to accept any name present in the shader def.

## Part 2 — Motion-native scene3d editing

Mirror the `Scene3DInspector` pattern (immutable `layer.objects[]` map-replace + commit) — no `creation_*` detour.

### 2a. `set_motion_scene_object`
Edit an existing object in a multi-object scene3d layer.
- Input: `compositionId`, `layerId`, `objectId`, and any of `transform?` ({position/rotation/scale x,y,z}), `material?` ({color, metalness, roughness, emissive, opacity, mapAssetId}), `geometry?` ({kind, size, depth, cornerRadius}).
- Merge onto the target object immutably (only supplied fields change); validate `kind ∈ MOTION_OBJECT_3D_KINDS` when present; clamp numeric material fields to valid ranges.
- `fail` if the layer isn't scene3d or the objectId isn't found.

### 2b. `remove_motion_scene_object`
Remove an object by id from a scene3d layer's `objects[]`. Guard: refuse to remove the last remaining object (a scene3d layer needs ≥1), returning `fail` with guidance to remove the layer instead.

### 2c. `set_motion_scene_camera`
Static-set the scene3d layer's own `camera` (`position`, `target`, `fov`) without keyframing (complements the existing keyframed `animate_scene_camera`).

## Part 3 — Shader effect param keyframing (verify + document)

Already reachable: `add_motion_keyframe` accepts `property = "effect.<effectId>.<param>"` because `MotionEffectProperty = effect.${string}.${string}` is in the animatable union and `isMotionAnimatableProperty` matches it; Plan A made the descriptors shader-aware. Work here is confirmation, not new surface:
- Add a test proving `add_motion_keyframe` sets a keyframe on a shader effect param and the renderer samples it at time.
- Ensure `list_motion_animatable_properties` (referenced by `add_motion_keyframe`'s description) surfaces a shader effect's params for the layer.
- If `update_motion_effect` rejects shader param names, widen it (see 1c).

## Part 4 — Shader fill param keyframing (net-new core)

Enable per-frame animation of shader **fill** params, then it becomes drivable through the existing `add_motion_keyframe` automatically.

**Property-path scheme** (added to `MotionAnimatableProperty` in `motion-keyframes.ts`):
- Shape: `shape.fill.shader.<paramName>` (e.g. `shape.fill.shader.scale`)
- Text: `text.fillShader.<paramName>` (e.g. `text.fillShader.contrast`)
New type `MotionShaderFillProperty = \`shape.fill.shader.${string}\` | \`text.fillShader.${string}\``, unioned in and recognized by `isMotionAnimatableProperty`.

**Descriptors:** a resolver (mirroring the effect version) that, for a layer with a shader fill, returns each param's `{ label, min, max, step, default }` from `getMotionShaderDef(shaderId)` so the graph editor / timeline / `add_motion_keyframe` value-clamp work.

**Renderer evaluation (the core change):** where `createMotionShaderFillPattern` currently reads the static `shader.params`, compute an **effective params** object at `localTime`: for each param, if the layer has keyframes on the matching property path, sample via `evaluateMotionPropertyValueAtTime`; else fall back to the static param (then def default). Feed effective params to the GL render. The frame cache key must be built from the **evaluated** params (it already includes exact `localTime`, so animated fills stay correct and cache within a frame).

**Preview parity:** unchanged — `layerHasMotionShaderFill` already forces renderer-backed preview; keyframed params ride the same path.

**Inspector parity (light):** MCP-first; a keyframe stopwatch in `ShaderFillControls` is optional polish, not required for this spec (note as follow-up if deferred).

## Testing

- Registry unit tests (Vitest) per new tool using the test host: happy path + invalid `shaderId` + wrong layer type + param clamping + not-found ids. Mirror existing `add_motion_effect` / `add_scene_object` tests.
- Core: fill-shader property parse/descriptor tests; a renderer/keyframe test that a keyframed `shape.fill.shader.scale` yields different effective params at t=0 vs t=1.
- Gate: core + web tsc (`--ignoreDeprecations 6.0`), `pnpm --filter @openreel/core test:run src/motion`, and the agent package test suite.

## Risks

- **Registry is 26k lines / heavily pattern-bound.** Mitigate by copying the exact verbatim scaffold from `add_motion_effect` (23199) and `add_scene_object` (25585); keep each tool self-contained.
- **Fill-keyframe evaluation on the hot render path.** The per-frame param sampling runs inside the fill paint; keep it O(params) and only when the layer actually has fill-shader keyframes (guard on presence) so non-animated fills pay nothing. Reuse the frame cache.
- **`update_motion_effect` enum.** If it hard-validates param names it will silently reject shader params — Part 3 must check and widen.

## Rollout

Uncommitted on `feat/new-design-update` with the rest of the Figma-gap work (commit only when the user asks). Sub-project 3 (shader text) and 4 (AI shaders) remain future work.
