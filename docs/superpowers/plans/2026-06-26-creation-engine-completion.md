# OpenReel Creation Engine — Plan to Completion

**Date:** 2026-06-26
**Status:** Proposed
**Predecessor:** [2026-06-25-agent-native-creation-engine.md](2026-06-25-agent-native-creation-engine.md)
**Goal:** Reach the point where an agent (or human) can build *any* 3D scene / motion and it renders **faithfully in the live viewport** and stays **editable**.

---

## 1. Status: computed but invisible

A full capability audit (kernel → bake → agent-tool → live-render, per node type, file:line verified) found:

- **Kernels: ~85% done.** Geometry, SDF + marching-tetrahedra extraction, cloth/particle/rigid solvers, full FK / linear-blend skinning / two-bone IK / skeletal + procedural clips, PBR material-graph evaluator, and procedural texture + PNG encoder are all **real, tested math** — not stubs.
- **Kernel → render bridge: ~20% done.** Only `deform` and `subdivision` traverse it. Everything else is either not composed into the rendered mesh, has no MCP tool, or has a tool that fakes a primitive-proxy / approximate-keyframe / "for future native baking" preview instead of routing real kernel output to the viewport.

The work to completion is overwhelmingly **plumbing proven kernels into the existing Three.js renderer** — not new math, and **not** a new renderer.

### Two structural chokepoints that strangle everything

1. **`composeModifierNodes`** (`packages/core/src/creation/geometry/bake.ts:283-321`) is a hard-coded `subdivision`/`deform` switch. No other node type can ever bake into `object.mesh`. Its agent-side gate `assetNeedsBakedMesh` (`packages/agent/src/registry.ts:2161-2166`) mirrors the same two-type limit.
2. **The renderer assumes one static mesh per object.** `buildGeometry` renders a single `object.mesh` (overriding the primitive kind, `motion-three-renderer.ts:1085`) plus transform keyframes. There is **no per-frame vertex-animation path**, so no solver/rig output can ever *move*. The only real texture path is `mapAssetId` → composition image asset; procedural texture bakes never reach it.

Closing the bridge = (a) generalize the bake dispatch, (b) add a per-frame baked-mesh animation channel, (c) register procedural bakes as composition image assets for `mapAssetId`.

---

## 2. Phases (ordered by leverage)

Effort key: **S** ≈ ≤1 day · **M** ≈ days · **L** ≈ 1–2 weeks · **XL** ≈ multi-week.

### Phase 0 — Bridge foundations (unblocks everything) — **M**

Build the missing bridge primitives every later phase needs, so the rest is wiring, not architecture.

- **W0.1 — Generalize `composeModifierNodes`** (`bake.ts:283-321`) into an ordered, registry-driven node dispatch (new node type = new case, not a rewrite). Mirror the node-type set into `assetNeedsBakedMesh` (`registry.ts:2161`).
- **W0.2 — Per-frame baked-mesh animation channel** in `motion-three-renderer.ts`. Let an object carry a time-indexed sequence of baked meshes/vertex buffers (reuse `buildBufferGeometryFromMesh`, `:1042`); renderer updates the `BufferGeometry` per frame. Prerequisite for cloth/particle/rigid/skin to render *moving*.
- **W0.3 — Procedural-bake → composition image asset** helper: take `bakeProceduralTexturePng` output (`texture/procedural.ts:194`), register it as a composition image asset, return an id usable as `mapAssetId` (the renderer's only real `.map` path, `motion-renderer.ts:906-964`).

**Acceptance:** a non-deform/subdivision modifier node reaches a `composeModifierNodes` case (test); a 2-frame baked-mesh sequence shows frame 0 ≠ frame 1 in the viewport; a baked PNG round-trips to a `mapAssetId` that `buildMaterial` consumes.
**Dependencies:** none. **Must land first.**

### Phase 1 — Static geometry bridge: boolean / SDF / array / UV — **L**

Make the orphaned, fully-tested SDF/marching island and the static geometry modifiers render live + editable. Highest leverage: math is 100% done, only the wire is missing.

- **W1.1 — SDF/boolean bake branch.** `sdf` + `boolean` cases in `composeModifierNodes`: recipe node → `Sdf` graph (`sdf/sdf.ts:5-45`) → `marchingTetrahedra` (`sdf/marching.ts:47-108`) → `Mesh` → `object.mesh`. `marchingTetrahedra` has **zero non-test consumers** today — this is the wire.
- **W1.2 — Authoring tools:** `add_creation_sdf_shape`, `apply_creation_boolean` (real union/subtract/intersect/smooth-blend), metaball/blob over `smoothUnionSdf`. Retire/redirect the metadata-only `add_creation_cutaway_plane` (`registry.ts:17824`) where it overlaps.
- **W1.3 — Array modifier.** `array` bake case via existing-but-unused `transformMesh`+`mergeMeshes` (`transform.ts:59,92`) + `add_creation_array`. (Scatter already renders real scene-level instances — leave it; array is the mesh-merge complement.)
- **W1.4 — UV node.** Promote `generateBoxUvs` (`uv.ts:7-39`) from a bake flag to a composable `uv` node + `apply_creation_uv` (needed for Phase 4 texture maps).
- **W1.5 — Honest displacement/bevel/decal previews.** Route `apply_creation_displacement`'s scene3d sync through the real bake (today it's a primitive slab, `updateMotionObjectForDisplacement` `registry.ts:2293`). For bevel/decal (no kernel yet), stop the proxy from claiming fidelity until Phase 4/5.

**Acceptance:** `apply_creation_boolean(box, sphere, "subtract")` renders the carved mesh live and re-bakes on operand edit; an SDF metaball blob renders; array of N → one merged mesh. `grep` shows `marchingTetrahedra` has a non-test consumer.
**Dependencies:** Phase 0 (W0.1).
**Note:** real **bevel/chamfer** needs a new edge-bevel kernel (none exists; `apply_creation_bevel` is a box→rounded-box fake) — defer the real kernel to Phase 4/5.

### Phase 2 — Simulation into the viewport (cloth / particle / rigid) — **L**

Make the three real solvers drive live motion instead of being discarded or shadowed by approximations.

- **W2.1 — Cloth.** `simulate_creation_cloth` (`registry.ts:9230`) already runs `simulateCloth`+`clothToMesh` then **throws the mesh away and returns only stats**. Rewire (or new `bake_creation_cloth`) to bake the per-frame mesh sequence into the W0.2 channel. Retire the placeholder `apply_creation_cloth_wave` (`registry.ts:12638`) or make it a thin wrapper over the real solver.
- **W2.2 — Particles.** `add_creation_particle_system` (`registry.ts:16731`) renders real instances but animates with 2-keyframe drift + sin twinkle; `simulateParticles` is **never imported by the agent package**. Drive instance transforms from baked solver output.
- **W2.3 — Rigid bodies.** `simulate_creation_rigid_drop` (`registry.ts:17394`) uses a closed-form single-axis bounce. The kernel already ships `bakeRigidBodyTracks` (`sim/rigidbody.ts:167-195`) in the exact keyframe format — swap it in for real inter-body collision/friction/sleep. **Lowest-effort high-fidelity win.**

**Acceptance:** cloth drapes/wrinkles per solver (not a rotating flag) with pins holding; particles follow gravity/drag/wind; two dropped bodies collide (impossible today). All re-simulatable on edit.
**Dependencies:** Phase 0 (W0.2) for cloth; W2.2/W2.3 can partly proceed in parallel.

### Phase 3 — Skinned, articulated characters — **XL**

Recipe characters render as a true articulated/skinned mesh, not N static primitives driven by per-object rotation keyframes. Deepest gap, only XL bridge.

- **W3.1 — Skeleton + skin bake path.** `skin`/`skeleton` case in `composeModifierNodes`: `computeBoneWorldMatrices` (`rig/skeleton.ts:26`) → `skinMesh` (`rig/skin.ts:34-92`) → baked per-pose `object.mesh` via W0.2. (Real `THREE.SkinnedMesh`+`Bone` is the later optimization; baked-mesh path reuses the existing bridge with lower renderer risk.)
- **W3.2 — Drive poses from kernel clips.** Replace `pose_creation_character`'s local reimplementation (`registry.ts:4490-4610`) with real `evaluatePose`/`sampleSkeletalAnimation` (`rig/animation.ts:22-67`) over `proceduralWaveClip/IdleClip/WalkClip` (all currently zero-consumer dead code). Adds **walk** for free.
- **W3.3 — IK authoring.** `solve_creation_ik` (`registry.ts:9177`) already calls real `solveTwoBoneIk` but is read-only. Add `set_creation_ik_target` that feeds the solution into the FK chain/pose.
- **W3.4 — Pose blending.** Wire `blendPoses`/`additivePose` (`rig/animation.ts:78-129`) into a blend tool.

**Acceptance:** a posed character bends at real joints with skin deforming across the joint (not each primitive spinning about its own origin); walk cycle plays; IK reach moves hand + bends elbow.
**Dependencies:** Phase 0 (W0.2); benefits from Phase 1 dispatch generalization.

### Phase 4 — Material & texture fidelity — **L**

Real procedural maps (base color / normal / roughness) and richer materials reach Three, not just averaged flat color + scalar PBR.

- **W4.1 — Texture maps to viewport.** Via W0.3, register `bake_creation_texture` / `add_creation_procedural_texture` PNGs as composition image assets and set `mapAssetId`. Today `bake_creation_texture` (`registry.ts:10911`) returns the PNG only as a response `dataUri` and writes just `averageColor`; `add_creation_procedural_texture` never even calls the generator. **Cluster's key gap.**
- **W4.2 — Extend material model.** Add normal/roughness/metalness *map* slots + `transmission`/`clearcoat`/`edgeGlow` to `MotionMaterial3D` (`types.ts:150-161`); widen `motionMaterialForCreation` (`registry.ts:1357-1370`); upgrade `buildMaterial` (`motion-three-renderer.ts:840-861`) to `MeshPhysicalMaterial` where transmission is needed. Makes `apply_creation_xray_material` real glass.
- **W4.3 — Apply material-graph + surface-detail output.** Route the real `evaluate_creation_material_graph` (`registry.ts:9217`, read-only today) onto the object material; generate real scratch/dust/edge-wear *maps* from `apply_creation_surface_detail` (`registry.ts:10171`, scalar-nudge + metadata only today).

**Acceptance:** marble/circuit/brushed textures show actual surface pattern; x-ray shows transmission; surface-detail scratches visible as a map.
**Dependencies:** Phase 0 (W0.3); UV node from Phase 1 (W1.4) for correct projection.

### Phase 5 — Authoring UI surfaces — **XL (split, incremental)**

Human-editable surfaces for the now-renderable capabilities. Deprioritized vs bridge work because agents can already author via MCP; this is for human editing/parity.

- **W5.1 — Recipe node-graph editor (XL).** None exists (`GraphEditorPanel.tsx` is a keyframe/timing editor). Build a node-canvas over the 18-node IR (drag/connect/edit-params/live-rebake).
- **W5.2 — Character editor (XL).** Replace the read-only flat bone-chip list with a hierarchical skeleton tree + in-viewport IK handles + pose library. Depends on Phase 3.
- **W5.3 — Product editor (XL).** Exploded-view sliders / cutaway plane / callout authoring (zero presence today).

**Acceptance:** human builds a boolean+texture object via the graph and sees it live; poses a character via skeleton tree/IK; drives an exploded view via a slider.
**Dependencies:** Phases 1–4.

### Phase 6 — Native C++/WASM port (determinism/perf) — **XL, last**

Port proven TS kernels behind the existing `loadCreationBackend` fallback chain. Explicitly **not urgent** — a determinism/perf play, ported from a working reference, not a rewrite.

- **W6.1 — Wire the orphaned backend.** `loadCreationBackend` (`creation-bindings/index.ts:81`) is built + tested but **nothing imports it**. Add one consumption point in the bake path so the CPU fallback runs in production first (no behavior change), proving the seam.
- **W6.2 — Port kernels in leverage order** (geometry → sdf/marching → sim → rig) behind new `orc_*` ABI entries, each with a golden parity test vs the TS reference. Today only `orc_bake_box` exists and returns constants (24 verts/12 tris), not a mesh. Replace the cosmetic 1-constant `.wat` with the real emscripten build and have `wasm.ts` call `orc_bake_box`.

**Acceptance:** a kernel runs natively/WASM in production via the fallback chain with tol-bounded parity vs TS; CPU remains the guaranteed fallback.
**Dependencies:** all bridge phases (port what's shipping, not moving targets).

---

## 3. Definition of done (whole engine)

- [ ] Every node type in the 18-node IR either bakes into `object.mesh` / instances **or** is explicitly documented non-geometric — no silent drops in `composeModifierNodes`.
- [ ] `assetNeedsBakedMesh` triggers for every geometry-affecting node type (not just deform/subdivision).
- [ ] Boolean/SDF: agent can union/subtract/intersect/smooth-blend, renders live, re-bakes on edit; `marchingTetrahedra` has production consumers.
- [ ] Array renders as merged geometry; scatter remains scene-level instances.
- [ ] Cloth/particle/rigid drive **live motion from real solver output**; no "approximate … until a full solver" placeholder remains in the authoring path.
- [ ] Characters render as articulated/skinned meshes that deform at joints; walk/idle/wave/pose + IK all drive the real rig; no per-object-rotation-on-primitives path remains.
- [ ] Procedural texture maps (baseColor/normal/roughness) + transmission materials reach Three via `mapAssetId` / extended `MotionMaterial3D`.
- [ ] Live viewport supports per-frame baked-mesh/vertex animation (not just static mesh + transform keyframes).
- [ ] Grep of tool descriptions/handlers for "future", "approximate", "until", "preview-only" returns only honestly-labeled WIP — nothing in the default authoring path.
- [ ] (Later) Node-graph, character, and product editors exist for humans.
- [ ] (Later) Native/WASM backend wired into production via the fallback chain with golden parity tests; CPU remains the guaranteed fallback.

---

## 4. Highest-leverage next task

**Phase 0 / W0.1 + W0.2** — generalize `composeModifierNodes` into a node-type dispatch and add the per-frame baked-mesh animation channel.

Nearly every "computed but invisible" capability dies at these same two chokepoints. Both are individually **M**, unblock Phases 1–4, and are pure plumbing against already-proven kernels. Concretely, **start with the boolean bake case** wiring the tested-but-zero-consumer `marchingTetrahedra` (`sdf/marching.ts:47-108`) to `object.mesh` — the most striking dead-code-with-passing-tests gap and the fastest end-to-end proof that the generalized dispatch reaches the live viewport.

---

## Progress

### Slice 1 — SDF / boolean (Phase 0 W0.1 + Phase 1 W1.1/W1.2) — LANDED 2026-06-26

The first bridge increment: the orphaned, fully-tested SDF kernel now renders live + is editable.

- `sdf/graph.ts` (new): `buildSdfGraph`/`bakeSdfGraph` resolve `sdf`+`boolean` recipe nodes (sphere/box primitives, offset, union/subtract/intersect/smooth-union) to one field + AABB, marched to a mesh. `marchingTetrahedra` now has a production consumer.
- `bake.ts`: `bakeRecipeMesh` routes SDF/boolean assets through marching as base geometry; output is **welded** and **empty-result-guarded**; the subdivision modifier is now **triangle-budget bounded** (was unbounded).
- `registry.ts`: `assetNeedsBakedMesh` gates on an actual `sdf` node; new **`apply_creation_boolean`** MCP tool (subtract/union/intersect/smooth-union with sphere/box tool, chainable multi-cutout, editable recipe nodes, baked live). Reports `approximatedBodyObjectIds` honestly.
- Tests: 5 graph-resolver + 4 bake-integration (core) + 3 end-to-end (agent: carve, multi-cutout chain + same-key re-apply, approximation reporting).
- Adversarial review (15 findings). **Fixed:** both ship-blockers (keyless cutout collision; same-key re-apply chain-revert) + weld, subdivision budget, empty-mesh guard, gate tightening, honest approximation reporting.

**Deferred follow-ups (tracked, non-blocking):**
- Disconnected multi-root SDF graph drops all but one root — lands with metaballs/multi-blob authoring (`buildSdfGraph` should union remaining roots).
- Boolean input → non-sdf node: distinguish "input not found" from "found but non-SDF" instead of silently dropping (`graph.ts resolveNode`).
- Synchronous marching has no time budget — N CSG objects jank the sync path; move off-hot-path / cancellable / hash-skip unchanged graphs.
- Generic full re-sync returns the existing object verbatim, so an edited SDF asset isn't re-baked outside the boolean tool (`motionObjectFromCreationAsset` mesh invalidation by generator hash).
- `set_creation_object_geometry` size/kind edits are overridden by the persisted SDF graph (update the `sdfbody` node on geometry edits, or document boolean as terminal).
- Add real cylinder/rounded-box SDF primitives so those bodies aren't approximated as a box; smooth-union AABB padding could be tighter (`~k*0.25`).

### Slice 2 — Rigid-body physics into the viewport (Phase 2 W2.3 + new W2.x) — LANDED 2026-06-26

Wired the real rigid-body solver into the agent layer (the audit's "lowest-effort high-fidelity win").

- Extracted `commitCreationRigidBake` (shared bake→clip→sync) and refactored `simulate_creation_rigid_drop` onto it (its *reveal* semantics — parts return to authored positions — are unchanged; test still green).
- New **`simulate_creation_rigid_bodies`** MCP tool: drops + settles selected objects on a shared ground plane with **real inter-body collision / friction / restitution / sleep** via `bakeRigidBodyTracks` → editable position keyframes (distinct from the drop reveal). Honest about its v1 sphere-collision model.
- Kernel fixes (from review, benefit every sim consumer): `resolvePairCollision` returns a contact flag so non-contacting bodies still **sleep** (was: collision mode defeated sleep entirely); exactly-coincident bodies now **separate deterministically** instead of falling through each other. Sphere radius derived from the asset's geometry size × scale (was: scale only). `simDuration` clamped (keyframe-bloat guard).
- Tests: drop unchanged + new collision test (two overlapping balls separate to non-interpenetrating distance) + 2 kernel tests (distant-bodies-sleep-under-collision, coincident-separation).

**Deferred follow-up:** rigid bodies are point spheres → no tumble/rotation keyframes (position-only); an early-stop-when-all-resting pass in `bakeRigidBodyTracks` would further bound keyframe count.

### Slice 3 — Per-frame mesh animation channel + cloth (Phase 0 W0.2 + Phase 2 W2.1) — LANDED 2026-06-26

The keystone: solvers/rigs can now render **moving** geometry (not just static mesh + transform keyframes). Same channel Phase 3 (skinned characters) will use.

- `MotionObject3D.meshFrames` (shared topology + per-frame vertex positions). The renderer samples the frame for the current time at the single multi-object injection point (`sampleMotionObjectMeshFrame`), reusing the existing dispose-and-rebuild path (verified leak-free — `disposeSceneEntry` frees geometry before each rebuild). `MotionObjectMeshData.preScaled` skips per-mesh normalize so deforming frames don't jitter.
- New **`bake_creation_cloth`** MCP tool: real mass-spring (Verlet) cloth solver → per-frame deforming mesh that plays keyframe-free in the viewport (flags/capes/banners/drapes). Pin/plane/wind/gravity editable; stores a `cloth` recipe node.
- Review fixes (11 findings, no blockers): **#7** preserve `meshFrames` on non-geometry edits (was silently destroying baked cloth); **#6** store the *effective* fps (was tagging 24 but baking 20 → ~20% too fast); **#8** frame×vertex float budget (bounds persisted size); **#9** clear stale static `mesh` when writing `meshFrames`.
- Tests: 4 core sampler tests + end-to-end cloth (frames differ over time, billows in z under wind, survives an opacity edit).

**Deferred follow-ups:** per-frame geometry rebuild churn → in-place position-attribute fast path (perf); CPU/offline + thumbnail fallback renders the static plane (teach `bakeCreationSceneMesh` the `cloth` node, or require WebGL); `meshFrames` persists to IndexedDB (bounded by #8, but strip + rebake-on-load from the recipe is the durable fix — same gap as static meshes); single-object scene3d path doesn't sample frames (latent); pin-anchor contract (cloth sags off-center); cloth normals recomputed per frame.

### Slice 4 — Skinned, smoothly-deforming limbs (Phase 3 W3.1) — LANDED 2026-06-26

First real skinning into the viewport, reusing the Slice-3 `meshFrames` channel — the deformation primitive characters need.

- `rig/limb.ts` (new): `buildSkinnedLimb` (tube + bone chain + per-vertex linear-blend weights by length) and `limbWavePose` (traveling-wave curl). Wires the previously zero-consumer rig kernel (`skinMesh`, `computeBoneWorldMatrices`, `createSkinBinding`) to real output.
- New **`bake_creation_skinned_limb`** MCP tool: turns a selected object into a skinned limb that **bends smoothly at every joint** (vs rigid primitive parts that pivot about their own origin), `skinMesh` baked per frame into a seamlessly-looping `meshFrames`. For tentacles/tails/cables/snakes/robot-arm segments.
- Tests: 4 core (valid limb, identity rest pose, **tip deflects >0.3 while base <0.05** = smooth bend, traveling wave varies) + end-to-end agent (limb deforms over time, x-range >0.2).
- Review: focused adversarial pass, **0 findings — ships clean** (weights normalized, no NaN/zero-sum, bone order valid, seamless loop verified, deterministic, frame-budget bounded).

**Toward full characters (follow-up):** a humanoid needs a merged base mesh + skeleton template + auto-skin-weights at joints; this slice proves the smooth-skinning→`meshFrames` pipeline that a humanoid auto-rig will reuse. `pose_creation_character` should be migrated onto real `evaluatePose`/`sampleSkeletalAnimation` + skinning next.

### Slice 5 — Skinned humanoid character (Phase 3 W3.1 capstone) — LANDED 2026-06-26

A full skinned humanoid that waves — the character payoff of the skinning→`meshFrames` pipeline.

- `rig/humanoid.ts` (new): `buildSkinnedHumanoid` — a 17-bone humanoid (pelvis/spine/chest/neck/head, 2 arms, 2 legs) built as a tree of skinned segment-tubes merged into ONE mesh, each tube weighted between its two joint bones by axis projection (smooth shoulders/elbows/hips/knees). `humanoidWavePose` raises + waves the right arm with idle sway.
- New **`bake_creation_humanoid`** MCP tool: turns a selected object into a skinned waving character (linear-blend skinning baked per frame into a seamless `meshFrames`) — vs the legacy `add_creation_character` separate rigid primitive parts.
- Tests: 4 core (valid merged mesh, identity rest pose, **wave raises the right-arm vertices**, forearm oscillates) + end-to-end agent (tall figure with arm span, frames deform over time, skeleton node).
- Review: focused adversarial pass — **ships clean**, 1 low cosmetic finding (loop-seam in the spine sway) fixed by phase-locking the sway to the tuned wave speed.

**Toward production characters (follow-up):** parametric proportions/style presets, hands/feet/clothing, walk/idle/point clips (wire real `proceduralWalkClip`/`evaluatePose`), IK foot/hand targets, and migrating `add_creation_character`/`pose_creation_character` onto this skinned pipeline.

### Slice 6 — Particle systems (Phase 2 W2.2) — LANDED 2026-06-26

Completes the simulation trio (cloth · rigid · particles), all real-solver-driven into the viewport.

- New **`bake_creation_particles`** MCP tool: a deterministic Euler particle BURST (stars/sparks/embers/confetti/dust/snow/debris) under gravity/drag/wind/lifetime, baked into the `meshFrames` channel as an animated **octahedron point-cloud** (fixed topology; dead particles collapse to a zero-area = invisible point). Drives the real `spawnParticles`/`stepParticles` solver (previously never imported by the agent).
- Test: end-to-end agent — the burst **expands over time** (last-frame extent > 3× first-frame, > 1 world unit), `bake` recipe node with `euler-particles` solver.
- Review: focused adversarial pass — **ships clean**, 0 new findings (per-frame vertex count constant = `N*6`, degenerate dead octahedra harmless, frame-budget bounded, deterministic).

**Follow-up:** particles are fixed-orientation octahedra (no camera-facing billboards); continuous emitters (vs single burst) and per-particle color/fade are future polish.

### Slice 7 — Array modifier (Phase 1 W1.3) — LANDED 2026-06-26

- `composeModifierNodes` gains an `array` case: repeats the current mesh into an offset row/grid (`transformMesh`+`mergeMeshes`), default offset = one mesh-width along X, bounded by a 12k-triangle budget.
- New **`apply_creation_array`** MCP tool: repeats a selected object into a baked array of copies (fences/railings/teeth/fins/columns/slats/keys/grids), synced into the viewport; `assetNeedsBakedMesh` gates on `array` so it survives re-sync.
- Tests: 2 core (4 copies = 4× verts at correct spacing; budget caps a count-64 array) + end-to-end agent (baked mesh spans the copies, `array` recipe node). Verified via tests + typecheck (mirrors reviewed SDF-dispatch + boolean-tool patterns).

Phase 1 geometry bridge is now: boolean ✓, SDF ✓, array ✓ (UV deferred to Phase 4 where texture maps make it useful).

### Slice 8 — Procedural texture maps (Phase 4 W4.1) — LANDED 2026-06-26

The materials cluster's key gap: procedural textures now show as real surface patterns, not a flat averaged color.

- `motionMaterialForCreation` now forwards `mapAssetId` from the creation material's parameters (so a baked map survives re-sync).
- New **`apply_creation_texture_map`** MCP tool: bakes `bakeProceduralTexturePng` (noise/voronoi/fbm/marble/circuit/fabric-weave/lunar-dust/hex-grid/gradient/brushed/checker) → registers it as a **composition image asset** (data-URI `url`, resolved by the existing `resolveImageAsset` path) → sets the bound object's `material.mapAssetId` + base color, and stores `mapAssetId` on the creation material for persistence. The pattern renders via the renderer's existing `mapAssetId`→texture resolution.
- Test: end-to-end agent — image asset added with a `data:image/png;base64,` url, render-object `mapAssetId` set, **and the map survives `sync_creation_scene_to_motion`** (the funnel forward).
- Review: focused adversarial pass — **ships clean**, 4 low findings, 2 fixed (textureSize over-report vs the baker's 512 cap; re-sync drop when an object's materialId falls back to `materials[0]`).

**Follow-up (W4.2/W4.3):** normal/roughness maps (only base-color map today), `MeshPhysicalMaterial` transmission/clearcoat, routing `evaluate_creation_material_graph` + `apply_creation_surface_detail` to real maps, and GC of orphaned texture assets when patterns change.

### Slice 9 — Humanoid animation variety (Phase 3 polish) — LANDED 2026-06-26

- `rig/humanoid.ts` gains `humanoidWalkPose` (alternating thigh/shin/arm swing + bob), `humanoidIdlePose` (sway/breathe), `humanoidPointPose` (raise+extend right arm), and a `humanoidAnimationPose(animation, ...)` dispatcher.
- `bake_creation_humanoid` gains an `animation` arg (wave | walk | idle | point), threaded into the per-frame bake + recipe metadata.
- Tests: 2 core (dispatch distinct poses + fallback; **walk deforms the legs** in z when skinned) + agent metadata assertion. Verified via tests + typecheck (low-risk extension of the reviewed humanoid skinning).

---

## Appendix A — Capability status matrix (audit, file:line verified)

Legend: kernel = CPU math implemented · compose = baked into rendered mesh · live = real output in viewport (`yes`/`approx`/`no`).

| Cluster | Capability | kernel | compose | live | tool (fidelity) |
|---|---|---|---|---|---|
| geometry | deform (displacement) | done | yes | yes | apply_creation_displacement (real) |
| geometry | subdivision | done | yes | approx | none |
| geometry | boolean (CSG) | done | no | no | none |
| geometry | bevel/chamfer | **missing** | no | approx | apply_creation_bevel (fake) |
| geometry | array/instance | partial | no | no | none |
| geometry | scatter | done | yes | yes | scatter_creation_objects (real, scene-level) |
| geometry | decal | **missing** | no | approx | add_creation_decal (metadata) |
| geometry | uv | partial | no | no | none |
| sdf | primitives/transforms/union/intersect/subtract/smoothUnion/marching | done | no | no | none (orphaned, tested) |
| sim | cloth (Verlet mass-spring) | done | no | no | simulate_creation_cloth (real solver, stats-only) |
| sim | particles | done | no | approx | add_creation_particle_system (approx) |
| sim | rigid-body | done | no | approx | simulate_creation_rigid_drop (analytic, not real solver) |
| rig | skeleton FK / skinning / clips / IK / pose-blend | done | no | no | mostly none; solve_creation_ik (read-only) |
| rig | character renders skinned | partial | no | approx | add_creation_character (static primitive parts) |
| material | PBR graph eval | done | n/a | no | evaluate_creation_material_graph (read-only) |
| material | presets (scalar PBR) | done | n/a | yes | apply_creation_material_preset (real, scalar only) |
| material | procedural texture maps | done | no | no | bake_creation_texture (PNG returned, not applied) |
| material | surface detail (scratches/dust) | partial | n/a | approx | apply_creation_surface_detail (scalar+metadata) |
| native | C++ core | partial (orc_bake_box constant) | n/a | no | none |
| native | bindings + WASM + routing | done/partial | n/a | no | orphaned (no production consumer) |
| ui | viewport / hierarchy / inspector / preview / review panel | done | — | yes | exist |
| ui | node-graph editor / character editor / product editor | **missing** | — | no | — |

## Appendix B — Method

Generated from an 8-way parallel capability audit (one agent per cluster, read-only, structured output, file:line citations) plus a synthesis pass, run 2026-06-26. Constraints fixed before synthesis: keep Three.js as renderer; TS kernels are the proven reference; native port is a later determinism/perf play; "completion" = any motion renders faithfully + stays editable.
