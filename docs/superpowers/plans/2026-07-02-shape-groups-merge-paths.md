# Shape Groups + Merge Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (workflow-orchestrated). Spec: docs/superpowers/specs/2026-07-02-shape-groups-merge-paths-design.md — read it first; it is the authority on semantics.

**Goal:** Intra-layer shape groups with per-group transforms + ordered operator stacks, Merge Paths booleans, and the Offset Paths / Pucker & Bloat / Twist operators — across core, renderer, UI, and MCP.

**Architecture:** Optional `contents` tree on `MotionShapeLayer` normalized by a pure helper module; a boolean module wrapping `polygon-clipping` (ALREADY INSTALLED in packages/core — do not reinstall); recursive renderer branch that bakes transforms into points when merging; flat keyframe property IDs with a `contents.` grammar; a new ShapeContentsSection UI component; seven new registry tools.

**Tech stack:** TypeScript strict, Vitest, RTL, polygon-clipping@0.15.7, Canvas2D.

## Global Constraints

- Do NOT git commit/add/stash/revert. NO line comments/docstrings. TS strict — never `any`, unsafe casts, or non-null assertions. Validate inputs, guard nulls, fail fast, immutable updates only.
- TDD per task: failing test → run → implement → green.
- **Legacy byte-identity:** a shape layer WITHOUT `contents` must take the existing render/keyframe/tool paths untouched. The existing suites are the regression net.
- `polygon-clipping` may be imported ONLY in `packages/core/src/motion/motion-shape-boolean.ts`.
- Contents tree: depth cap 8; unique item ids per layer (collision = throw); group `opacity` multiplies down the tree; `visible: false` skips render but keeps data.
- Merge semantics: union = all children; subtract = first minus rest (document order); intersect = intersection of all; exclude = left-fold symmetric difference. <2 visible child geometries → merge is a no-op passthrough.
- Fill rule for merged output: `"evenodd"`.
- UI gestures route through the preview/commit protocol (`updateMotionCompositionPreview` + `commitMotionCompositionGesture`) — one undo per gesture; discrete edits commit once.
- Typecheck: plain `pnpm exec tsc --noEmit` per package (do NOT pass `--ignoreDeprecations` on the CLI). Suites stay FULLY green: core motion 504+, web motion 247+, agent 409+.
- Keyframe property grammar (exact): `contents.{itemId}.transform.positionX|positionY|scaleX|scaleY|rotation|opacity`, `contents.{itemId}.pathData`, `contents.{itemId}.operator.{operatorId}.{param}`.

---

### Task 1: Data model + contents helpers

**Files:** Modify `packages/core/src/motion/types.ts`; Create `packages/core/src/motion/motion-shape-contents.ts`, `packages/core/src/motion/motion-shape-contents.test.ts`; export from the package index if motion modules are re-exported there (check `packages/core/src/index.ts` / `motion/index.ts` pattern and follow it).

Add to types.ts exactly the interfaces from spec §Design.1 (`MotionShapeMergeMode`, `MotionShapeGroupTransform`, `MotionShapeGroupItem`, `MotionShapePathItem`, `MotionShapeItem`), plus `contents?: readonly MotionShapeItem[]` on `MotionShapeLayer` and the three new modifier union members `MotionOffsetPathsModifier {id,type:"offset-paths",enabled,amount:number,lineJoin:"miter"|"round"|"bevel"}`, `MotionPuckerBloatModifier {id,type:"pucker-bloat",enabled,amount:number}` (−100..100), `MotionTwistModifier {id,type:"twist",enabled,angle:number,center:MotionVector2}` — extend `MOTION_SHAPE_MODIFIER_TYPES` and the `MotionShapeModifier` union.

motion-shape-contents.ts (pure, no React/store imports): `getMotionShapeContents(layer)` (synthesizes `{kind:"path", id:"__root", name: layer.name, shapeType, width, height, position:{x:0,y:0}, pathData, pathClosed, style: undefined}` when `contents` absent — style resolution falls back to layer style downstream), `hasExplicitShapeContents`, `findShapeItem(contents,id)`, `collectShapeItemIds`, `addShapeItem(layer,parentGroupId|null,item)`, `updateShapeItem(layer,id,patch)` (discriminated — cannot change `kind`), `removeShapeItem`, `moveShapeItem(layer,id,direction:"up"|"down")` (within its parent), `materializeShapeContents(layer)` (wraps implicit item in a group named "Group 1", default transform anchor/position 0, scale 1, rotation 0, opacity 1), `createShapeGroupItem(name)/createShapePathItem(init)` with id generation. Depth >8 or duplicate id on insert → throw. All returns are new objects; inputs never mutated.

**Tests (≥12):** legacy synthesis; explicit passthrough; add-to-root/add-to-nested-group; update patch immutability (original untouched); kind-change rejected; remove prunes nested; move up/down + boundary no-op; depth-cap throw at 9; duplicate-id throw; materialize wraps + preserves geometry fields; findShapeItem nested hit/miss.

**Produces for later tasks:** the exact type names + helper signatures above.

### Task 2: Boolean module

**Files:** Create `packages/core/src/motion/motion-shape-boolean.ts`, `packages/core/src/motion/motion-shape-boolean.test.ts`.

`mergeMotionShapeRings(ringSets: ReadonlyArray<ReadonlyArray<ReadonlyArray<MotionVector2>>>, mode: MotionShapeMergeMode): MotionVector2[][][]` per spec §Design.2 (import type from types.ts; polygon-clipping Pair = [number,number] — convert both ways, close rings if the lib returns unclosed). "none" or <2 non-empty inputs → filtered passthrough. Non-finite coordinate → throw. Wrap the lib call in try/catch → rethrow a typed `MotionShapeBooleanError` with the mode.
`flattenPathPointsToRing(points: readonly MotionShapePathPoint[], closed: boolean, samplesPerCurve=16): MotionVector2[]` — line segments pass through; cubic segments (out/in handles) sampled uniformly; open paths return the polyline (caller decides whether it participates in merge — open paths are EXCLUDED from merges by the renderer).

**Tests (≥10, real polygon-clipping):** two overlapping rects union → single ring 8 vertices (assert set of corner coords); subtract → L-shape; full-containment subtract → ring + hole (2 rings); intersect of disjoint → empty; exclude of identical → empty; three-input union; "none" passthrough; single-input passthrough; NaN throws; flatten: cubic circle-approx ring has 4*16 points and max radial error <1% of radius.

### Task 3: Operators + stack application

**Files:** Modify `packages/core/src/motion/motion-shape-modifiers.ts`, `packages/core/src/motion/motion-shape-modifiers.test.ts` (extend existing test file).

Implement per spec §Design.3: `applyMotionOffsetPathsToPoints` (closed rings only — open input returned unchanged; outward normal = average of adjacent edge normals normalized, vertices displaced by amount; miter limit 4 → past it, corner splits into two points (bevel); join "round" approximates with one midpoint; negative amount = inset; after displacement, if amount ≠ 0 run `mergeMotionShapeRings([[ring]], "union")` self-union cleanup and take the largest-area output ring set), `applyMotionPuckerBloatToPoints` (centroid = vertex mean; each vertex lerped by amount/100 toward (negative) / away from (positive) centroid), `applyMotionTwistToPoints` (maxDist = max vertex distance from center, rotate each vertex by `angleDeg * (1 - dist/maxDist)` around center; maxDist 0 → unchanged). `createMotionShapeModifier` gains the three types with defaults (offset amount 10 join miter; pucker-bloat amount 0; twist angle 0 center layer-center — accept center param). Keyframable params registered in `getMotionShapeModifierKeyframeProperty` + evaluation in `evaluateMotionShapeModifiersAtTime` (amount / amount / angle).
`applyMotionShapeOperatorStack(ringSets: MotionVector2[][][], operators: readonly MotionShapeModifier[], evaluatedParams)` — ordered left-to-right; zig-zag/round-corners/wiggle/offset/pucker/twist map per-ring; trim uses `getTrimmedMotionPathPoints` per ring; repeater expands ringSets via `getMotionRepeaterCopies` transforms baked into points. Wire the three new types into the existing layer-level pipeline (`buildMotionShapePolyline` order: after wiggle, order offset → pucker-bloat → twist) so legacy layers can use them too.

**Tests (≥10):** offset square +10 → corners at ±(w/2+10) within miter tolerance; offset −10 insets; open path unchanged; pucker 100 collapses toward centroid (radius halved at 50); bloat symmetric; twist 90° moves center-adjacent vertices more than rim vertices (assert monotonic falloff); twist maxDist 0 no-op; stack order matters (offset→twist ≠ twist→offset on a square, assert differing outputs); repeater in stack triples ring count; trim in stack shortens ring.

### Task 4: Renderer

**Files:** Modify `packages/core/src/motion/motion-renderer.ts`; Create `packages/core/src/motion/motion-renderer-contents.test.ts`.

Per spec §Design.4. Extract a `collectShapeItemRings(item, time, layer, parentMatrix, parentOpacity)` helper (pure math where feasible — can live in motion-shape-contents.ts or a sibling; it resolves keyframed group transforms/item pathData at `time` via Task 5's resolvers, bakes 2×3 affine matrices into points, returns `{rings, style, opacity}[]` leaf entries). `renderShapeContents` walks: merge-or-geometry-operator groups → collect → merge → operator stack → single evenodd fill + stroke with group effective style×opacity; plain groups → ctx.save/transform/recurse/restore; path items → resolve inherited style → existing single-shape draw internals (refactor `buildShapePath` minimally to accept item fields — the legacy call site passes the layer fields and MUST remain behaviorally identical). Open paths (pathClosed false) are skipped from merge collection and rendered individually. Boolean failure (`MotionShapeBooleanError`) → render children unmerged (graceful).
Testing uses a stub ctx (record method calls) — the repo already has renderer tests to copy the harness pattern from (grep `motion-renderer` tests; if none render via OffscreenCanvas in jsdom, assert via the exported pure helpers + a minimal ctx recorder object typed structurally).

**Tests (≥8):** legacy layer (no contents) → ctx call sequence identical to a pre-change golden (capture by running the OLD path logic expectation: exactly one fill + one stroke, same transform calls); contents with one plain group + two items → two fills; mergeMode union → ONE fill with "evenodd"; group opacity 0.5 halves ctx.globalAlpha at leaf; visible:false item skipped; nested group transforms compose (point baked = matrix math expected); merge failure falls back to unmerged children; open path excluded from merge but still stroked.

### Task 5: Keyframe addressing

**Files:** Modify `packages/core/src/motion/motion-keyframes.ts`, `packages/core/src/motion/motion-keyframes.test.ts` (extend).

`parseContentsPropertyId(propertyId)` → `{itemId, channel: {type:"transform",field}|{type:"pathData"}|{type:"operator",operatorId,param}} | null` per the exact grammar in Global Constraints. Resolution: `resolveShapeContentsAtTime(layer, time)` → contents tree with keyframed group-transform channels, item pathData (via `morphMotionPathData`), and operator params substituted (used by Task 4's collector). Register descriptors: `getMotionLayerContentsPropertyDescriptors(layer)` returning label ("Circle 2 › Position X"), propertyId, currentValue — follow the pattern of the existing shape-modifier descriptor fn (motion-timeline consumption comes free if the existing descriptor aggregation picks it up — find where `getMotionLayerShapeModifierPropertyDescriptors` is aggregated and add this alongside). Numeric channels interpolate through the standard engine (easing/bezier/expressions untouched — they key off Keyframe records in `layer.keyframes` exactly like `shape.width` does today).

**Tests (≥8):** parser accepts all three channel forms + rejects malformed (missing itemId, unknown field, trailing garbage); positionX keyframes at t=0/1 resolve midpoint at t=0.5 with linear easing; rotation + opacity channels; pathData morph resolves intermediate point count; operator param (twist angle) resolves; descriptors enumerate one entry per animatable channel of a 2-item tree; legacy layer (no contents) returns empty descriptors and null parses unchanged.

### Task 6: UI — ShapeContentsSection

**Files:** Create `apps/web/src/motion/components/ShapeContentsSection.tsx`, `apps/web/src/motion/components/ShapeContentsSection.test.tsx`; Modify `apps/web/src/motion/components/PropertiesPanel.tsx` (mount the section for shape layers — a few lines only).

Per spec §Design.6. The section receives the selected layer + composition and mutates via the SAME store path PropertiesPanel already uses for shape edits (locate its existing update dispatch — likely `updateMotionLayer`/`upsertMotionComposition` through project-store — and reuse it; wrap continuous number-field scrubs in the preview/commit gesture protocol, single commits otherwise). Tree rows: indent 12px/depth, chevron toggles group expansion (local state), eye toggles `visible`, double-click renames (input commit on Enter/blur). Selection state local to the section. Detail panel below the tree for the selected item per spec (group: 6 transform number fields + merge-mode `<select aria-label="Merge mode">` + operator stack rows with type label, enable checkbox, up/down/remove, param number fields; path item: shapeType select limited to 2D types, width/height/position fields, style override: "Inherit" toggle + the existing fill/stroke color inputs pattern). Toolbar buttons: "Add group", "Add shape", "Group contents" (only when `!hasExplicitShapeContents`), disabled states per selection. Keyframe diamonds are OUT of scope for the section (values are keyframable via MCP/timeline; adding diamonds here is stretch).

**Tests (≥8, RTL):** renders legacy layer with "Group contents" CTA; materialize click creates group (store asserted); add group/add shape append to store; rename commits once; merge-mode select writes mergeMode; operator add (twist) appears in store with defaults; reorder buttons call move; visibility eye toggles; one undo entry per discrete edit (assert via store history length if accessible, else via single dispatch spy).

### Task 7: MCP tools

**Files:** Modify `packages/agent/src/registry.ts`; Create `packages/agent/src/registry.shape-contents.test.ts`. (host.ts NOT needed — tools go through the existing composition-update host methods the shape tools already use.)

Seven tools per spec §Design.7, domain "motion" (match existing shape tools' domain): `add_motion_shape_group {compositionId, layerId, parentGroupId?, name?, mergeMode?}` → `{groupId}`; `add_motion_shape_to_group {compositionId, layerId, parentGroupId?, shapeType, width?, height?, position?, pathData?, pathClosed?, style?, name?}` → `{itemId}`; `update_motion_shape_item {…, itemId, patch: {name?, visible?, transform?, mergeMode?, style?, width?, height?, position?, pathData?}}` (kind-guard: transform/mergeMode only on groups); `remove_motion_shape_item`; `move_motion_shape_item {…, itemId, direction}`; `add_motion_shape_group_operator {…, groupId, operatorType, params?}` → `{operatorId}` (ordered append, duplicates allowed); `update_motion_shape_group_operator` / `remove_motion_shape_group_operator` (fold update+remove into two tools — total is eight if split; keep eight). Plus `merge_motion_shape_layers {compositionId, layerIds[≥2], mode, name?}` → creates the grouped layer (bake each source layer's transform into its path item geometry — reuse core helpers; document that text/image layers are rejected), removes sources, returns `{layerId, groupId}`. Validation errors use the registry's existing error-result convention (grep an existing tool's INVALID/NOT_FOUND shape and match it exactly). Every tool description documents the `contents.*` keyframe grammar one-liner.

**Tests (≥14):** happy path per tool; layer-type guard; missing comp/layer/group/item NOT_FOUND; kind-guard violation; merge_motion_shape_layers: 2 rect layers → one layer with group of 2 items + sources gone + geometry offsets baked (assert item positions differ per source layer position); invalid mode rejected; keyframe on `contents.{id}.transform.rotation` via existing add_motion_keyframe succeeds against the new layer.

### Task 8 (gate): full verification

Run and report verbatim: `pnpm --filter @openreel/core test:run src/motion` (504+ pass, plus all new); `cd apps/web && pnpm exec vitest run src/motion` (247+ FULLY green); `pnpm --filter @openreel/agent test:run` (409+); `pnpm exec tsc --noEmit` in packages/core, apps/web, packages/agent (0 each).

**Execution note (controller):** waves [T1 ∥ T2] → [T3 ∥ T5] → T4 → [T6 ∥ T7] → T8. T3 imports T2's union for offset cleanup; T4 consumes T1+T2+T3+T5; T6/T7 touch disjoint packages.
