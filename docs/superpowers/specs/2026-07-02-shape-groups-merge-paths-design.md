# Shape Groups + Merge Paths + Missing Operators — Design

**Date:** 2026-07-02
**Status:** Approved scope (full rock)
**Source:** AE-parity review big rock #5 (docs/reviews/2026-07-01-ae-parity-review.md §4.5, shape audit §Shape layers & drawing)
**Branch:** feat/new-design-update

## Problem

One shape = one whole layer: `MotionShapeLayer` (types.ts:729) holds a single `shapeType`, single `style`, single optional `pathData`; the renderer builds ONE ctx path and issues ONE fill + ONE stroke (motion-renderer.ts:1586-1627). There is no intra-layer group with its own transform, no ordered operator stacks (modifiers dedupe by type, motion-shape-modifiers.ts:207-218), no boolean combine of any kind for 2D vector paths (masks fake add/subtract with ctx.clip/compositing), and three standard AE operators (Offset Paths, Pucker & Bloat, Twist) are absent. Compound logo/icon construction — a shape-layer staple — is impossible.

## Goals

1. **Contents tree**: `MotionShapeLayer.contents?: MotionShapeItem[]` — nested groups (each with anchor/position/scale/rotation/opacity transform, ordered stackable operator stack, and a merge mode) containing path items (any 2D shapeType or bezier path, each with an optional style override). Legacy layers (no `contents`) behave byte-identically; a normalizer synthesizes the implicit single item.
2. **Merge Paths**: per-group `mergeMode: "none" | "union" | "subtract" | "intersect" | "exclude"` — the group's child geometries are boolean-combined into one outline (via `polygon-clipping`, already installed in packages/core) which then takes the group's style + operator stack.
3. **New operators**: `offset-paths` (amount px, join miter/round/bevel), `pucker-bloat` (amount −100..100), `twist` (angle deg, center) — implemented as point-array transforms like zig-zag; available in group stacks AND as layer-level modifiers.
4. **Group-aware keyframing**: property IDs `contents.{itemId}.transform.{positionX|positionY|scaleX|scaleY|rotation|opacity}`, `contents.{itemId}.operator.{operatorId}.{param}`, `contents.{itemId}.pathData` resolve through the existing keyframe engine (and therefore expressions + variables).
5. **UI**: PropertiesPanel Contents section — tree of groups/items with add/reorder/rename/visibility, per-group merge-mode select + operator stack editor, per-item style override; a "Group contents" action that materializes a legacy layer's implicit item into a group.
6. **MCP**: `add_motion_shape_group`, `add_motion_shape_to_group`, `update_motion_shape_item`, `remove_motion_shape_item`, `add/update/remove_motion_shape_group_operator`, and `merge_motion_shape_layers` (collapse N shape layers into one grouped layer with a merge mode — the compound-icon workflow). Keyframing goes through the existing `add_motion_keyframe` with the new property IDs (documented in tool descriptions).

## Non-Goals

SVG-import-as-groups (follow-up); per-item on-canvas transform gizmos (selection/editing of items stays in the panel this pass; the layer-level gizmo is unchanged); on-canvas pen editing of path ITEMS (stretch only — layer-level legacy path editing is untouched); multiple fills/strokes per path (one optional style override per item); stroke taper, gradient stops, auto-trace (separate gaps); changing the layer-level `modifiers` dedupe behavior (group stacks are the ordered/stackable surface).

## Design

### 1. Data model (types.ts + new motion-shape-contents.ts)

```ts
type MotionShapeMergeMode = "none" | "union" | "subtract" | "intersect" | "exclude";

interface MotionShapeGroupTransform {
  readonly anchor: MotionVector2;      // group-local px
  readonly position: MotionVector2;    // parent-local px offset
  readonly scale: MotionVector2;       // 1 = 100%
  readonly rotation: number;           // degrees
  readonly opacity: number;            // 0..1, multiplies down the tree
}

interface MotionShapeGroupItem {
  readonly kind: "group";
  readonly id: string;
  readonly name: string;
  readonly transform: MotionShapeGroupTransform;
  readonly items: readonly MotionShapeItem[];
  readonly operators?: readonly MotionShapeOperator[];  // ordered, duplicates allowed
  readonly mergeMode?: MotionShapeMergeMode;            // default "none"
  readonly style?: ShapeStyle;                          // used for merged output / inherited by styleless children
  readonly visible?: boolean;                           // default true
}

interface MotionShapePathItem {
  readonly kind: "path";
  readonly id: string;
  readonly name: string;
  readonly shapeType: ShapeType;       // 2D subset; "path" uses pathData
  readonly width: number;
  readonly height: number;
  readonly position: MotionVector2;    // parent-local px offset of the item's center
  readonly pathData?: string;
  readonly pathClosed?: boolean;
  readonly style?: ShapeStyle;         // override; absent = inherit nearest ancestor group style, else layer style
  readonly visible?: boolean;
}

type MotionShapeItem = MotionShapeGroupItem | MotionShapePathItem;
type MotionShapeOperator = MotionShapeModifier;  // same union, reused; instances carry unique `id`
```

`MotionShapeModifier` union gains `offset-paths` / `pucker-bloat` / `twist` members (with `id`, `type`, `enabled`, params). Existing 5 modifier interfaces already carry `id` — verify and reuse.

`motion-shape-contents.ts` (new, pure): `getMotionShapeContents(layer)` → normalized `readonly MotionShapeItem[]` (synthesizes the implicit item `{kind:"path", id:"__root", …from layer fields}` when `contents` is absent); `hasExplicitShapeContents(layer)`; item CRUD helpers `addShapeItem/updateShapeItem/removeShapeItem/moveShapeItem(layer, parentGroupId|null, …)` returning new layers (immutable); `findShapeItem(contents, id)`; `materializeShapeContents(layer)` ("Group contents": wraps the implicit item in a group); ID generation with collision checks; depth cap 8, fail fast on cycles/duplicate ids.

### 2. Boolean engine (new motion-shape-boolean.ts)

Pure wrapper over `polygon-clipping` — the ONLY file that imports the dep:
`mergeMotionShapeRings(ringSets: ReadonlyArray<ReadonlyArray<ReadonlyArray<MotionVector2>>>, mode): MotionVector2[][][]` — each input is one child geometry's rings (flattened polygons, possibly multiple rings). union = union of all; subtract = first minus rest; intersect = intersection of all; exclude = symmetric difference applied left-fold. Guard: <2 inputs returns input unchanged; empty rings filtered; non-finite coords throw. Output: MultiPolygon rings ready for even-odd fill.
Bezier flattening: reuse the existing sampling in `buildMotionShapePolyline`/`getMotionPathDrawCommands` — a helper `flattenShapeItemToRings(item, samplesPerCurve)` lives beside the merge fn (default samples consistent with CURVE_SAMPLES=16; scale by curve length is out of scope).

### 3. Operators (motion-shape-modifiers.ts)

- `applyMotionOffsetPathsToPoints(points, amount, join)` — displace each vertex along its outward normal (average of adjacent edge normals, miter-limited; round/bevel approximated by extra points at corners past the miter limit); self-intersection cleanup = `union` of the result with itself via the boolean module when `amount > 0` deforms; closed paths only (open paths pass through unchanged).
- `applyMotionPuckerBloatToPoints(points, amount, center)` — lerp each vertex toward (pucker, amount<0) or away from (bloat, amount>0) the centroid, magnitude |amount|/100.
- `applyMotionTwistToPoints(points, angleDeg, center)` — rotate each vertex around center by `angle * (1 - distance/maxDistance)` (AE twists more at the center).
- `applyMotionShapeOperatorStack(points[][], operators, time, layer)` — ordered left-to-right application over ring sets; trim + repeater participate via the existing `getTrimmedMotionPathPoints` / `getMotionRepeaterCopies` semantics (repeater at stack level multiplies ring sets with per-copy transforms baked into points). Existing keyframe evaluation (`evaluateMotionShapeModifiersAtTime`) is generalized to evaluate an arbitrary operator list.
- The three new operators are also registered as layer-level modifier types (dedupe rule untouched) so legacy layers get them too: extend `MOTION_SHAPE_MODIFIER_TYPES`, `createMotionShapeModifier`, keyframe property descriptors.

### 4. Renderer (motion-renderer.ts)

`renderShape` branches: `hasExplicitShapeContents(layer)` → `renderShapeContents`, else the existing single-shape path (byte-identical legacy behavior). `renderShapeContents` walks the tree in order:
- **Group, mergeMode "none"**: ctx.save → translate(position+anchor math)/rotate/scale → opacity multiplies a running alpha → render children recursively → restore. Operator stack with geometry-affecting ops forces the baked-geometry path (below) for that subtree.
- **Group, mergeMode ≠ "none" (or geometry operators present)**: collect child geometries as rings with all descendant transforms BAKED into points (helper `collectShapeItemRings(item, time, inheritedMatrix)`), merge via the boolean module, apply the operator stack, then fill/stroke ONCE with the group's effective style (even-odd fill rule).
- **Path item**: resolve style (own → nearest ancestor group → layer), build path (reuse `buildShapePath` internals refactored to accept an item-shaped input), fill+stroke.
- Group transform keyframes/item pathData keyframes are resolved at collect time via the keyframe engine (Design §5). Preview and export share this code automatically (same renderer).

### 5. Keyframing (motion-keyframes.ts)

Property-ID grammar: `contents.{itemId}.transform.positionX` etc. (six transform channels), `contents.{itemId}.pathData` (string morph, reuses `morphMotionPathData`), `contents.{itemId}.operator.{operatorId}.{param}`. Add a parser `parseContentsPropertyId(propertyId)` and resolution hooks where flat shape properties resolve today; enumerate descriptors for the timeline (`getMotionLayerContentsPropertyDescriptors(layer)`) so lanes appear like any property. Expressions and variable bindings work unchanged because these are ordinary keyframe property IDs on the layer.

### 6. UI (PropertiesPanel.tsx + motion-store)

Contents section (shape layers only): tree rows (indent per depth, chevron for groups) with name (rename inline), visibility eye, kind icon; row select drives a detail sub-panel: group → transform fields + merge-mode select + operator stack list (add from all 8 types, reorder up/down, remove, enable toggle, param fields with keyframe diamonds); path item → shapeType/width/height/position + style-override editor (reuse existing fill/stroke controls) or "inherit" state. Toolbar: Add Group, Add Shape (into selected group or root), "Group contents" for legacy layers, Delete, Move Up/Down. All mutations go through store methods that wrap the pure motion-shape-contents helpers and route through the preview/commit gesture protocol where continuous (drag/number-scrub) and single-commit otherwise.

### 7. MCP (registry.ts)

Tools as in Goals §6. Validation: layer must be shape type; parent group must exist; merge mode enum; operator type enum; params match operator schema; ids returned on create. `merge_motion_shape_layers` takes `layerIds[]` + `mode` + optional `name`: converts each source layer's geometry into path items (baking layer transforms), builds one grouped layer with mergeMode, removes the source layers (single undoable batch via existing host update path), returns the new layer id. All tool descriptions document the `contents.*` keyframe property grammar. `add_motion_keyframe` accepts the new IDs by delegating to the same property-resolution used by the engine.

## Testing

Core: boolean module (union/subtract/intersect/exclude on rects/circles incl. hole outcomes and degenerate inputs); contents normalization + immutable CRUD (depth cap, id collisions, legacy synthesis); new operator math (offset outward normals, pucker/bloat centroid lerp, twist falloff — analytic cases); operator stack ordering (twist∘offset ≠ offset∘twist); group transform baking (rotation+anchor round-trip); keyframed group transform + item pathData resolution at time. Web: PropertiesPanel contents tree RTL (add group, reorder, merge-mode select writes store, one undo per gesture); renderer draw-command smoke (merged group produces single fill call — spy on ctx). Agent: every new tool (happy path + validation failures + graceful when comp/layer/group missing); merge_motion_shape_layers round-trip (sources removed, geometry preserved). Gates: tsc 0×3; core motion 504+ / web motion 247+ / agent 409+ FULLY green.
Live visual: build a compound icon (circle ∪ offset squares, star subtracted) live on the stage; per-group repeater; animate a twist angle and a group position; verify legacy single-shape layers render unchanged (before/after screenshot of an existing template).

## Risks

- **Boolean output is polygonal** (beziers flattened at CURVE_SAMPLES density) — acceptable: merge feeds fill/stroke; sampling density matches what the polyline builder already ships. Documented, not hidden.
- **Coordinate spaces**: merge requires baking group/item transforms into points while non-merge rendering uses ctx transforms — the collect helper is the single source of truth and is property-tested (bake(render) ≡ ctx-transform(render) on sample geometry).
- **PropertiesPanel is 4787 lines** — the tree UI goes in a new `ShapeContentsSection.tsx` component; the panel only mounts it.
- **Legacy byte-identity**: `contents === undefined` must hit the existing code path untouched — regression-tested with renderer spies and the existing 504-test suite.
- **polygon-clipping robustness**: known-good martinez implementation; guard NaN/∞ inputs before the call; catch and fail the merge gracefully (render children unmerged + one console-free error surface) rather than crashing the renderer.
