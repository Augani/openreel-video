# Motion Creator → Figma-style authoring + After-Effects choreography

Goal: make the Motion Creator a place where a designer can **build a UI from
scratch** (Figma-style: draw, group, nest, single-out, animate the group) and
apply **AE-style choreography** (lift a button into 3D, morph between views,
click-then-disintegrate). The data model already supports most of this (rich
shape primitives + fills/gradients/strokes, real parent/child hierarchy with
transform inheritance, groups, precomps, particles, per-layer 3D transforms);
the gap is the designer-facing tooling. See the 2026-06-26 capability audit.

## Progress (2026-06-26) — ROADMAP COMPLETE (incl. F5)
All slices landed this session (each build→test→commit, plus adversarial
review+fix passes): **F1** shape-draw tools, **F2** group/ungroup (Cmd+G), **F3**
collapsible nested layer tree, **F4** on-canvas fill/stroke style bar, **F5**
auto-layout + components/instances, **A1** Lift-to-3D + Flip-In-3D + Click-Press
presets, **A2** Disintegrate, **A3** Morph (crossfade + transform tween,
motion-morph.ts), **A4** animated cursor click (motion-cursor.ts). Suites green
(core 341 motion, web 65 motion).

**F5 (landed):**
- F5.1 group auto-layout — `setMotionGroupAutoLayout`/`reflowMotionGroupAutoLayout`/
  `reflowMotionAutoLayoutGroups` (motion-ui-builder.ts). A `group.autoLayout`
  ({direction,gap,align}) packs children into a centered parent-local stack.
  Reflow is centralized in `project-store.upsertMotionComposition` so EVERY write
  path reflows. Locked + position-keyframed children opt out of the flow; nested
  groups measured by real recursive content extent (not the 16×16 placeholder)
  and reflowed inner-first; no-op short-circuit avoids reallocation when stable.
- F5.2 component instances + per-instance overrides — `MotionCompositionLayer.overrides`
  (Record<childId,{text?,color?}>) applied to a patched clone in the renderer
  (`applyMotionInstanceOverrides`); `addMotionComponentInstance` duplicates a precomp
  (keeps parentId, registers in parent group children); PropertiesPanel PrecompSection
  has the per-child override editor (gradient-aware swatch; text color override drops
  the master gradient so the solid color wins).

## Track F — Figma authoring

- **F1 — Shape draw tools. ✅ LANDED** (commit on feat/motion-creator). Rectangle +
  Ellipse tools on the stage rail; click-drag rubber-bands a live preview and
  creates a shape layer at the drag bounds (plain click = default 200×200).
  `createMotionLayerOfType` now takes shapeType/width/height. (Next: Line tool;
  shift-constrain to square/circle; alt-from-center.)
- **F2 — One-click Group (Cmd+G / Cmd+Shift+G ungroup).** Add `groupMotionLayers`
  (core motion-hierarchy): wrap a selection in a `group` layer, reparent the
  members, preserve stage position. Wire a LayerPanel action + keyboard. Today
  only Precompose / Null-controller exist.
- **F3 — Nested layers tree.** LayerPanel is a flat AE table (indentation + Parent
  dropdown); the expand chevron shows keyframe rows, not children. Make groups
  render collapsible children (a real tree) so structure reads like Figma/AE.
- **F4 — On-canvas style editing.** Fill/gradient swatch + stroke + corner-radius
  handles on the selected shape (model already supports all of it; only side
  panels expose it today).
- **F5 — Auto-layout + components/instances. ✅ LANDED** (F5.1 reflowing stacks,
  F5.2 component instances with per-instance text/color overrides). See the F5
  detail under Progress above.

## Track A — After-Effects choreography presets

- **A1 — "Lift to 3D".** One action: give the selected layer a 3D rotation/tilt +
  ensure a camera, keyframed so it lifts off the plane. (`motionLayerMayUse3D`
  + camera already exist.)
- **A2 — Disintegrate.** Spawn a particle burst matched to the layer's bounds/
  color and fade the layer out (particle layer exists).
- **A3 — Morph between views.** Precomp crossfade / shape-path morph between two
  states (e.g. button → next screen).
- **A4 — Triggered choreography.** Mouse-cursor layer + click pulse that fires a
  preset (zoom-in, then A2). Mostly preset wiring on existing pieces.

## Convention
Each slice = build → adversarial-review (workflow) → fix → commit, with a unit
test where the logic is testable. Reuse existing helpers (motion-hierarchy,
motion-animation-presets, particle layer, MotionCamera) — this is wiring +
authoring UX on top of a model that already supports it, not new architecture.
