# Expose the 3D Scene Authoring Engine (v1)

**Date:** 2026-06-30
**Status:** Design approved (brainstorming) — ready for implementation plan
**Branch context:** `feat/new-design-update` (motion editor)

## Goal

OpenReel's Motion app already contains a full volumetric 3D engine (Three.js
`motion-three-renderer.ts`: 14 primitive kinds, GLB import, extruded 3D text,
full PBR materials, cinematic cameras, EEVEE-class post-FX) — but **only the
agent can create or edit 3D**. There is no "3D" entry in the tool rail and the
inspector only exposes lighting. This work makes that engine **user-clickable**.

Strategic note: Figma's Config 2026 "3D" is z-axis *transforms* only (no
volumetric geometry, still preview/waitlist). Exposing our real 3D engine is a
capability Figma does not have.

## Scope (v1)

- **Inspector-driven** editing. No in-viewport orbit/gizmo yet.
- **Multi-object scene per layer.** A `scene3d` layer is a 3D world holding
  several objects that share one camera + lighting (real shadows/occlusion).
- **In:** create a 3D scene from the tool rail; add/remove/select/edit objects
  (primitive kind + per-kind size, GLB model URL, 3D text); per-object full PBR
  material; per-object 3D transform; scene camera (FOV/distance/position/target);
  existing Lighting & Environment.
- **Out (explicit):** viewport orbit/transform-gizmo; the procedural geometry
  kernel (extrude/revolve/sweep/boolean) as a shape source — v1 is primitives +
  GLB + 3D text; per-object timeline keyframes (scene + camera keyframes only).

## Data model (no schema change)

The types already exist in `packages/core/src/motion/types.ts`:

- `MotionScene3DLayer` (l.757): legacy single-`object` mode **and** scene mode
  via `objects?: readonly MotionSceneObject3D[]` (presence switches to scene
  mode) + `camera?: MotionScene3DCamera`, `lighting?`, `room?`.
- `MotionSceneObject3D`: `kind`, `size`, material, and `position`/`rotation`
  (Euler °) / `scale` (`MotionSceneVector3`).
- `MotionMaterial3D` (l.170): `kind` (physical/basic), `color`, `metalness`,
  `roughness`, `emissive`/`emissiveIntensity`, `opacity`, `transmission`, `ior`,
  `clearcoat`, plus map asset ids (map/normal/roughness/metalness).
- `MOTION_OBJECT_3D_KINDS` exported from `motion-scene3d.ts` (l.13) — the kind
  picker source.

**v1 always uses scene mode** (`objects[]` + `camera`) so there is one editing
model, avoiding the legacy `object` vs `objects[]` duality.

## Components & changes

### 1. Create path
- `apps/web/src/motion/motion-layer-factory.ts`: add `"scene3d"` to
  `CreatableMotionLayerType` (l.11) and a branch in `createMotionLayerOfType`
  (l.30) that produces a **scene-mode** layer (one starter primitive in
  `objects[]`, a default `camera`, studio environment). Reuse / extend core's
  `createMotionScene3DLayer` (`packages/core/src/motion/motion-scene3d.ts:54`);
  if that factory emits legacy single-object mode, add a thin scene-mode helper
  (e.g. `createMotionScene3DSceneLayer`) so the renderer's scene path is used.
- `apps/web/src/motion/components/MotionToolRail.tsx`: add a **"3D Scene"** entry
  to `ADD_MENU` (l.56) wired to `createMotionLayerOfType("scene3d")`.

### 2. Inspector — new accordion sections in PropertiesPanel scene3d branch
File: `apps/web/src/motion/components/PropertiesPanel.tsx` (scene3d branch
~l.1094, currently lighting-only). Add, in order:
- **Objects** — list of `objects[]` (type icon + name); click selects the active
  object; `+` adds a primitive (menu over `MOTION_OBJECT_3D_KINDS` + GLB import +
  3D text); remove / reorder.
- **Geometry** *(active object)* — kind picker + per-kind size params; model URL
  (`model`); text content (`text3d`).
- **Material** *(active object)* — full PBR set from `MotionMaterial3D`.
- **Transform** *(active object)* — position / rotation / scale (reuse the
  Transform-tab `AxisPill` style).
- **Camera** — FOV, distance/position, target (`MotionScene3DCamera`).
- **Lighting & Environment** — existing, kept.

Built with existing motion controls (`Section`, `SelectControl`, `AxisPill`,
`ColorInput`, `Slider`, native selects). Material/Camera/Transform controls
authored as standalone components so they **can** later be shared with
`CreationWorkspacePanel`'s ObjectEditor (reference: `CreationWorkspacePanel.tsx`
ObjectEditor ~l.912, Material group ~l.1002) — no refactor of that panel in v1.

### 3. State
- Motion store: add `selectedScene3DObjectId: string | null` + setter, plus
  object CRUD on the active `scene3d` layer (add / remove / reorder / update an
  object in `objects[]`) routed through the existing layer-update path
  (`upsertMotionComposition` / the `patchLayer` helper) so every edit is
  **undoable + auto-saved**. Active-object selection resets when the selected
  layer changes or the object is removed.

### 4. Animation
The scene animates via its layer's timeline keyframes (whole-scene) and the
existing camera-property keyframes. **Per-object keyframing is a follow-up.**

## Approach decision
Chosen **A — fresh inspector sections** (over reusing CreationWorkspacePanel's
recipe-coupled editors, or a full unify-now refactor). Material/Camera/Transform
built shareable for a later unify pass.

## Testing
- Factory: `createMotionLayerOfType("scene3d")` returns a renderable scene-mode
  layer with a default object + camera (unit test).
- Store: object add/remove/reorder/update mutates `objects[]` immutably and is
  undoable (unit test).
- Inspector: scene3d branch renders Objects/Geometry/Material/Transform/Camera;
  changing kind/material/transform patches the layer (RTL test).
- Visual: create a 3D scene from the tool rail, add a second object, edit
  material/transform/camera; verify it renders in the viewport in both light and
  dark themes; tsc + eslint clean.

## Risks
- **Legacy vs scene mode duality.** Ensure UI-created layers use scene mode and
  the renderer's scene path; confirm `createMotionScene3DLayer` output or add a
  scene-mode helper.
- **Active-object lifecycle.** Selection must stay valid across layer change /
  object removal / undo.
- **Per-kind geometry params.** Each `MOTION_OBJECT_3D_KIND` exposes different
  size fields; the Geometry section must switch controls by kind without
  breaking unknown/legacy kinds.
