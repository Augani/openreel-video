# OpenReel Agent-Native Creation Engine Plan

**Date:** 2026-06-25
**Status:** In progress
**Goal:** Make OpenReel the place where agents and professionals can create detailed, editable 3D assets, scenes, interfaces, product intros, characters, simulations, and motion experiences without relying on random external GLB downloads or external DCC apps for the normal workflow.

## Implementation Progress

- Created `@openreel/creation-schema` as the first shared contract for editable asset recipes, semantic product parts, materials, cameras, lights, callouts, and animation clips.
- Added `createPhoneProductCinematicScene()` as the first executable product cinematic generator. It creates a structured phone scene with semantic parts, procedural/plausible internals, material slots, callouts, camera animation, and exploded-view animation.
- Created `@openreel/creation-agent` with initial agent-facing tools: `create_product_cinematic_scene` and `validate_creation_scene`.
- Wired `create_product_cinematic_scene` into the desktop agent registry so MCP agents can create a renderable Motion Creator composition with a native `scene3d` layer, editable product parts, camera keyframes, and callout text layers.
- Added `@openreel/core/creation` as the first core runtime slice: creation asset recipes, scene graph records, cache refs, deterministic math/RNG helpers, immutable creation operations, validation, summaries, and project serializer normalization for persisted creation state.
- Added undoable core creation actions (`creation/applyOperation`, `creation/replaceState`) and wired the product cinematic MCP flow to persist the generated semantic asset/scene graph into `Project.creation` before creating the Motion composition.
- Added creation inspection/discovery support for agents: creation capabilities in `get_capabilities`, creation counts in `get_editor_state`, and read tools for listing/getting/validating persisted creation assets and scenes.
- Added creation-to-render bindings for Motion `scene3d` layers and a synced transform edit tool (`set_creation_object_transform`) so agents can move semantic product parts while updating the persisted creation scene and the rendered Motion object/keyframes together.
- Added semantic material slots on creation scene objects and a synced material edit tool (`set_creation_object_material`) so agents can restyle product parts while updating the asset recipe material, object material assignment, and bound Motion `scene3d` material together.
- Added a synced creation camera edit tool (`set_creation_camera`) backed by a core `camera/upsert` operation, so agents can adjust persisted camera rigs while updating the bound Motion `scene3d` camera and camera keyframes together.
- Added a synced creation object animation tool (`animate_creation_object`) backed by core `animation/upsert-clip`, so agents can author semantic position/rotation/scale/opacity tracks while replacing the matching bound Motion `scene3d` keyframes.
- Added a generic agent-native 3D scene creation tool (`create_creation_3d_scene`) that converts declarative agent object specs into persisted creation assets, materials, scene objects, cameras, lights, render bindings, and an immediately renderable Motion `scene3d` composition.
- Added a semantic scene append tool (`add_creation_scene_object`) so agents can grow existing creation scenes with new editable assets/objects/materials while extending the bound Motion `scene3d` layer and render binding.
- Added a synced geometry/content edit tool (`set_creation_object_geometry`) so agents can change a semantic object between primitives, GLB/model refs, text3d, size/depth/aspect/corner details, and other shape parameters while dirtying creation caches and updating the bound render object.
- Added a synced semantic removal tool (`remove_creation_scene_object`) that deletes creation objects, optional unused assets, animation tracks, render binding entries, bound `scene3d` objects, and bound object keyframes together.
- Added a synced scene environment/lighting tool (`set_creation_scene_environment`) so agents can change semantic environments, light rigs, ground/background colors, room settings, and realtime `scene3d` lighting together.
- Added optional editor timeline insertion to `create_creation_3d_scene` (`insertIntoEditor`) so agent-created semantic scenes can immediately appear as rendered Motion instances/clips in the main timeline.
- Added a render recovery/sync tool (`sync_creation_scene_to_motion`) so agents can rebuild or refresh a Motion `scene3d` composition/layer from persisted semantic creation assets, objects, cameras, lights, environment, materials, and animation clips when the render binding is missing or stale.
- Added a semantic preview render tool (`render_creation_preview`) so agents can render the bound Motion `scene3d` frame for a persisted creation scene without manually resolving composition/layer ids first.
- Added a dedicated creation capability discovery tool (`get_creation_capabilities`) so agents can inspect supported editable 3D object kinds, asset kinds, material models, environment/light kinds, animation channels, and the recommended create/preview/sync workflow before authoring scenes.
- Added a semantic camera animation tool (`animate_creation_camera`) for editable orbit, dolly, zoom, position, target, FOV, and focus-distance camera clips that sync into native `scene3d` camera keyframes and survive render recovery.
- Added optional editor timeline insertion to `create_product_cinematic_scene` (`insertIntoEditor`) so generated product intros can immediately become rendered Motion instances/clips ready for preview and export.
- Added a product callout extension tool (`add_creation_product_callout`) so agents can add editable text labels to existing semantic product/creation scenes while recording the callout layer in the scene render binding.
- Added a first-pass procedural cloth/flag wave tool (`apply_creation_cloth_wave`) that stores cloth-wave recipe metadata, adds a cloth node, dirties generated caches, persists editable animation tracks, and syncs approximate `scene3d` keyframes until the native cloth solver exists.
- Added semantic material presets (`apply_creation_material_preset`) for product/scene surfaces such as brushed titanium, polished aluminum, ceramic glass, OLED screen, silicon chip, copper trace, matte plastic, rubber gasket, lunar dust, and flag fabric, including procedural texture metadata and render sync.
- Added a semantic exploded-view animation tool (`animate_creation_exploded_view`) so agents can select creation objects by object ids, product part ids, or tags, store per-object exploded-view recipe metadata, dirty generated caches, persist editable position tracks, sync bound `scene3d` keyframes, and recover the rendered motion from semantic state.
- Added a semantic X-ray material tool (`apply_creation_xray_material`) so agents can ghost product shells or selected objects for internal reveals while storing material recipe metadata, dirtying caches, syncing transparent `scene3d` materials, and recovering the look from semantic state.
- Added a compact product-part inspection tool (`inspect_creation_product_parts`) so agents can recover object ids, part ids, material ids, render object ids, cache status, recipe features, and animation clips before making precise product-cinematic edits.
- Added a semantic cutaway plane tool (`add_creation_cutaway_plane`) that appends an editable translucent `scene3d` section plane, stores target part/object normal/offset metadata on the asset recipe for future native clipping, syncs render bindings, and survives scene-to-motion recovery.
- Added a semantic decal tool (`add_creation_decal`) for editable product logos, markings, and surface labels. It creates a plane or text3d render object now, stores decal projection/target metadata on the asset recipe for future texture baking, and survives scene-to-motion recovery.
- Added a semantic surface-detail material tool (`apply_creation_surface_detail`) for scratches, dust, fingerprints, smudges, edge wear, and grime. It records procedural texture metadata on materials/assets, dirties material caches for future baking, syncs realtime roughness/metalness previews, and survives scene-to-motion recovery.
- Added a semantic 3D interface tool (`add_creation_ui_panel`) for editable device screens, dashboards, holographic panels, and spatial UI. It creates a panel plus editable `text3d` child rows, syncs every object into the bound `scene3d` layer, stores UI-panel recipe metadata for future atlas/native UI baking, and survives scene-to-motion recovery.
- Added a semantic scatter/instancing tool (`scatter_creation_objects`) for repeated rocks, screws, windows, debris, fasteners, product details, and environment dressing. It creates editable scene objects from a source asset, syncs the bound `scene3d` instances, stores scatter recipe metadata with deterministic seeds/patterns, and survives scene-to-motion recovery.
- Added a semantic bevel/chamfer tool (`apply_creation_bevel`) for editable hard-surface product edges, device bodies, lens rims, panels, and packaging details. It stores a bevel recipe node, dirties geometry caches, syncs a rounded realtime `scene3d` preview where possible, and survives scene-to-motion recovery.
- Added a semantic procedural displacement tool (`apply_creation_displacement`) for editable moon terrain, craters, ridges, product grooves, fabric wrinkles, panel embossing, and rough environment surfaces. It stores a deform/displacement recipe node, dirties geometry caches, syncs an immediate `scene3d` terrain/relief preview where possible, and survives scene-to-motion recovery.
- Added a semantic product-part tool (`add_creation_product_part`) for quickly building editable product shells, screens, lenses, camera modules, boards, batteries, chips, thermal layers, screws, connectors, gaskets, and decorative details. It creates role-aware scene objects/assets with `product-part` recipe nodes, syncs them into the bound `scene3d` layer, and survives scene-to-motion recovery.
- Added a semantic layered display tool (`add_creation_screen_stack`) for editable product screen assemblies with cover glass, OLED/display, digitizer, backplate, and custom layer overrides. It creates separate screen product-part assets/objects with `array` stack metadata, syncs all layers into the bound `scene3d` layer, exposes layer-key id maps for follow-up edits, and survives scene-to-motion recovery.
- Added a semantic camera-module tool (`add_creation_camera_module`) for editable product camera islands with lens rings, lens glass, sensors, flash, and optional depth sensors. It creates each component as a separate product part with camera-module recipe metadata, syncs every component into the bound `scene3d` layer, exposes component-key id maps for follow-up edits, and survives scene-to-motion recovery.
- Added a semantic product-internals layout tool (`add_creation_product_internals`) for editable logic boards, batteries, chips, connectors, screws, and thermal layers. It creates each internal component as a separate product part with internals recipe metadata, syncs every component into the bound `scene3d` layer, exposes component-key id maps for follow-up edits, and survives scene-to-motion recovery.
- Added a semantic animated light-sweep tool (`add_creation_light_sweep`) for product glints, hero highlights, reveal passes, and final polish. It creates an editable emissive `scene3d` sweep object, stores light-sweep recipe metadata, persists position/opacity animation tracks, syncs Motion keyframes immediately, and survives scene-to-motion recovery.
- Added the first agent-native character tooling (`add_creation_character`) for editable recipe-driven humanoids. It builds a parametric figure (pelvis, torso, neck, head, two arms with forearms and hands, two legs with feet, plus optional helmet, visor, and backpack) as separate semantic objects, attaches `skeleton`/bone metadata per part, supports style presets (stylized, realistic, low-poly, robot, astronaut, mascot), syncs every part into the bound `scene3d` layer, exposes part-key/bone id maps for follow-up edits, and survives scene-to-motion recovery.
- Added a semantic character pose tool (`pose_creation_character`) for editable wave, idle, point, cheer, t-pose, and a-pose gestures. It resolves a character by id (or objectIds/partIds/tags), animates the relevant arm/torso/head parts, stores per-part `ik-control` pose recipe metadata, persists an editable rotation animation clip, syncs bound `scene3d` keyframes, and survives scene-to-motion recovery (directly supporting the astronaut wave eval).
- Added the first agent-native simulation/particle tool (`add_creation_particle_system`) for editable stars, dust, sparks, embers, snow, confetti, and bokeh. It places deterministic seeded instances inside a box or sphere region from one shared particle asset/material, persists optional drift/twinkle animation tracks, stores `scatter`-node particle-system recipe metadata, syncs every particle into the bound `scene3d` layer, and survives scene-to-motion recovery.
- Added a semantic variant duplication tool (`duplicate_creation_object`) that clones one creation object into an independent editable variant with its own asset and material, applies color/metalness/roughness/opacity/emissive overrides plus an offset/position, syncs the variant render object into the bound `scene3d` layer, and survives scene-to-motion recovery. Use it for product color/material variants, A-B comparison shots, character crowd variants, and prop copies.
- Added a deterministic rigid-body drop/settle bake tool (`simulate_creation_rigid_drop`) that drops selected creation objects from a height under gravity with damped bounces, bakes the motion to editable position keyframes, stores a `bake`-node rigid-drop recipe (gravity, bounces, restitution, per-object rest height), syncs the bound `scene3d` keyframes, and survives scene-to-motion recovery. Use it for parts dropping into place, assembly reveals, packaging drops, and terrain-contact settles.
- Added a procedural base-texture tool (`add_creation_procedural_texture`) for editable noise, voronoi, fbm, marble, circuit, fabric-weave, lunar-dust, hex-grid, gradient, and brushed patterns. It records texture recipe metadata plus a texture cache reference on the target materials, dirties generated caches for future native baking, and syncs a realtime base-color/roughness/metalness/emissive preview into the bound `scene3d` render objects (covering circuit-board chips, fabric suits, lunar terrain, and brushed metal).
- Started Phase 1 (procedural geometry MVP) with a deterministic CPU geometry kernel in `@openreel/core/creation/geometry`: a mesh representation (positions/normals/uvs/indices) with bounds/stats/validity helpers, real primitive builders (box, plane, UV sphere, cylinder, cone, torus, icosahedron), a recipe→mesh baker that fills the asset's preview/final mesh cache to `ready` with bounds and vertex/triangle stats (model/text3d stay placeholder until native generators exist), and a minimal valid glTF 2.0 exporter with embedded base64 buffers. This is the CPU reference implementation the plan mandates for deterministic tests/CI; a native C++/WASM kernel can later implement the same interface.
- Wired the geometry kernel to the agent layer with `bake_creation_asset` (the plan's `bake_asset_cache`): it bakes a persisted asset's recipe into a real mesh, updates the asset's mesh cache to ready with bounds and vertex/triangle stats, and can return a glTF 2.0 export, resolvable by assetId or by an objectId/partId in a scene.
- Extended the geometry kernel with mesh transform (Euler-rotation/scale/translate), mesh merge, and a whole-scene baker (`bakeCreationSceneMesh`) that composes every object's procedural recipe with its transform into one merged mesh plus per-object and scene-level poly/bounds stats, and exposed it to agents via the read-only `export_creation_scene_gltf` tool that returns a real glTF 2.0 export of a finished creation scene (composing primitives + transforms).
- Added mesh repair/optimization utilities to the kernel (§13.2 robustness): `weldVertices` (lossless dedup or position-weld with smooth normals), area-weighted `recomputeNormals`, and `optimizeMesh` reporting before/after vertex counts; wired an opt-in `weld`/`smoothNormals` path through the asset baker and the `bake_creation_asset` tool (e.g. welding a baked box from 24 to 8 vertices).
- Added profile geometry to the kernel (§7.3): `extrudeProfile` (2D polygon → capped solid with side walls and winding-aware normals) and `revolveProfile` (profile lathe around the Y axis with arc support), and routed the asset baker to build real meshes from `profile`/`revolve` recipe-node parameters.
- Added GLB (binary glTF) export (`meshToGlb`/`meshToGlbBase64`) completing the §5.4 glTF + GLB interchange path, and exposed a `format: "gltf" | "glb"` choice on both `bake_creation_asset` and `export_creation_scene_gltf` (GLB returned as base64 with a single binary buffer chunk).
- Added triangle subdivision to the kernel (§7.1/§8.3 `apply_subdivision`): `subdivideMesh` splits each face into four with interpolated normals/UVs and shared edge midpoints, wired as an opt-in `subdivisions` bake option exposed on `bake_creation_asset`.
- Added real beveled/chamfered boxes to the kernel (§7.1 — "Accurate bevels on phone bodies"): `buildRoundedBox` generates inset faces plus 12 edge-bevel quads and 8 corner triangles with correct per-facet normals, and the baker now routes `rounded-box`/`phone` recipe kinds (driven by `cornerRadius`) to it so device bodies and product shells bake with credible hard-surface edges instead of plain boxes.
- Added UV generation to the kernel (§7.1/§8.3 `generate_uvs`): `generateBoxUvs` assigns triplanar box-projected, unit-wrapped UVs from each vertex's dominant-axis normal, wired as an opt-in `boxUvs` bake option on `bake_creation_asset` for texture-ready exports.
- Added curve sweep to the kernel (§7.3 — cables, wires, seams, rails): `buildTube` and `sweepProfileAlongPath` sweep a circular or arbitrary 2D profile along a 3D polyline using a stable parallel-transport frame (no twist), and the baker routes `tube`/`sweep` recipe kinds (driven by a `path` parameter) to them.
- Added a constrained hard-surface plane slice to the kernel (§7.4 cross-sections): `sliceMeshByPlane` clips a mesh to a half-space, splitting straddling triangles with interpolated position/normal/UV — a predictable, numerically-safe operation for cutaways without full CSG.
- Started Phase 3 (material/texture engine) with a deterministic CPU texture generator (`@openreel/core/creation/texture`): `proceduralField`/`bakeProceduralTexture` produce noise, voronoi, fbm, marble, circuit, fabric-weave, lunar-dust, hex-grid, gradient, brushed, and checker fields blended between two colors, plus a dependency-free valid PNG encoder (`encodePng`, stored-deflate with CRC32/Adler32) and `bakeProceduralTexturePng` returning a real PNG data URI (§7.10/§7.11 texture baking).
- Wired texture baking to the agent layer with `bake_creation_texture` (the plan's `bake_material_maps`): it bakes a material's procedural-texture recipe into a real image, records a `ready` texture-atlas cache, drives the realtime base color from the bake's average color, syncs the bound `scene3d` material, and can return a PNG data URI.
- Started Phase 4 (rigging/animation solver, §7.7) with a deterministic CPU skeleton + linear-blend-skinning module (`@openreel/core/creation/rig`): a row-major 4×4 matrix library (`composeTRS`/`multiplyMat4`/`invertMat4`/`transformPoint`), a bone hierarchy with FK world-matrix and inverse-bind computation (`computeBoneWorldMatrices`, `computeInverseBindMatrices`, pose overrides by bone name), and `skinMesh` applying weighted bone matrices to a baked mesh — verified by a 2-bone chain that bends a strip mesh with correct pivot behavior.
- Added skeletal animation evaluation to the rig (§7.7 "Animation clips"/"Keyframe baking"): `SkeletalClip`/`BoneTrack` keyframe tracks, `evaluatePose` (per-channel position/rotation/scale interpolation with range clamping), and `sampleSkeletalAnimation` (bake a clip to per-frame poses) — completing a usable skeleton → posed clip → skinning pipeline.
- Started Phase 5 (simulation engine, §7.8) with a deterministic CPU mass-spring cloth solver (`@openreel/core/creation/sim`): `createClothGrid` builds a pinned particle grid with structural/shear/optional bend springs in the XY (flag) or XZ (hanging) plane, `stepCloth`/`simulateCloth` integrate with Verlet plus constraint relaxation under gravity and wind, and `clothToMesh` triangulates the simulated state with recomputed normals — verified by an inextensible flag holding its pins, a horizontal cloth drooping under gravity, wind bending the free edge along Z, and springs staying within tolerance (the Ghana-flag cloth case).
- Started Phase 6 (realtime/preview renderer, §7.12) with a deterministic CPU software rasterizer (`@openreel/core/creation/render`): `renderMeshToImage` builds look-at/perspective matrices, projects and z-buffers triangles, and Lambert-shades them from a directional light into an RGBA framebuffer; `renderMeshToPng` encodes the frame to a PNG data URI. Exposed to agents via the read-only `render_creation_scene_image` tool, which bakes the scene mesh and renders it through the scene camera — a headless CPU preview/visual-regression path independent of the WebGPU/scene3d renderer.
- Added the Phase 6 WebGPU renderer (§7.12 "WebGPU renderer"): `renderMeshWebGpu` ships real WGSL vertex/fragment shaders (`CREATION_WGSL`) and a full WebGPU pipeline (interleaved vertex/index/uniform buffers, depth-tested render-to-texture, `copyTextureToBuffer` readback) behind a self-contained WebGPU type surface so it typechecks in every consumer, plus `renderMeshAuto`, which uses WebGPU when `navigator.gpu` is present and **falls back to the CPU rasterizer** otherwise. Wired into `render_creation_scene_image` as `mode: "auto"` (reports the chosen `backend`); the feature-detect + CPU-fallback path is unit-tested headlessly, and the WGSL/pipeline is ready to run on a WebGPU-enabled desktop/browser.
- Started Phase 7 (final render backend, §7.12) with a deterministic CPU ray tracer: `rayTraceMeshToImage` casts primary camera rays, intersects triangles with Möller–Trumbore, shades with interpolated normals, and casts hard shadow rays toward the light; `rayTraceMeshToPng` encodes the result. Wired into `render_creation_scene_image` via `mode: "raytrace"` with a `shadows` toggle (verified by a box casting a hard shadow onto a ground plane).
- Added SDF/volume modeling (§7.2) in `@openreel/core/creation/sdf`: signed-distance primitives (`sphereSdf`/`boxSdf`) and CSG-style operations (`unionSdf`/`intersectSdf`/`subtractSdf`/`smoothUnionSdf`/`translateSdf`), plus a table-free `marchingTetrahedra` extractor that samples an SDF over a grid and emits a closed, recomputed-normal mesh — giving robust procedural booleans/blends (carve a hole, smooth-union blobs) without fragile mesh CSG, verified by extracting a sphere on its iso radius.
- Advanced Phase 8 (agent-native review tools, §9.5 Agent Review Panel) with two read tools: `critique_creation_scene` analyzes a scene and returns severity-graded issues plus suggested next tools (empty scene, missing asset/material, missing/partial render binding, no camera/lights, unbaked dirty mesh caches, orphaned animation tracks), and `get_creation_history` surfaces the persisted creation operation history (type/source/label/target ids) for review panels and audit/undo planning.
- Started Phase 9 (professional editing UI, §9.5 Agent Review Panel) in `apps/web` with a `reviewCreationState` pure analyzer (mirroring the agent critique: per-scene ok flag, severity-graded issues, asset/scene counts) and a presentational `CreationReviewPanel` React component (reads `project.creation` from the project store, renders per-scene cards with object/camera/animation counts and issue badges) — typechecked against the real store/types and unit-tested.
- Deepened Phase 5 (simulation, §7.9) with a deterministic CPU rigid-body solver in `@openreel/core/creation/sim`: semi-implicit integration with ground-plane collision, restitution + friction, sleeping, and optional impulse-based sphere-sphere collisions (`stepRigidBodies`/`simulateRigidBodies`), plus `bakeRigidBodyTracks` for keyframe baking — verified by a sphere bouncing and settling on the ground, energy loss per bounce, pair separation, and per-frame track baking.
- Added a CPU particle simulator to Phase 5 (§7.8) in `@openreel/core/creation/sim`: seeded deterministic emission in a spread cone (`spawnParticles`), velocity integration with gravity/drag/wind and lifetime retirement (`stepParticles`/`simulateParticles`/`aliveCount`) — verified by deterministic spawning, gravity rise-and-fall, lifetime retirement, and wind drift.
- Deepened the rigging solver (§7.7 IK/blending) with an analytic two-bone IK solver (`solveTwoBoneIk`: law-of-cosines elbow placement with pole-hint bend plane and reachability clamping — directly supporting "astronaut hand grips the flag pole") and pose composition utilities (`blendPoses` for clip blending, `additivePose` for additive layering) — verified by straight/bent reach preserving bone lengths, out-of-reach detection, and 50% pose blends.
- Added procedural animation generators (§7.7 "Procedural wave/idle/walk") in the rig: `proceduralWaveClip` (raise + oscillate arm/forearm), `proceduralIdleClip` (spine/head sway), and `proceduralWalkClip` (alternating thigh/shin/arm swing) that emit ready-to-evaluate `SkeletalClip`s for the skeleton→pose→skin pipeline — verified by track contents and opposite-phase leg swing.
- Added a material graph evaluator (§7.10, §12.1 "Material graph evaluation") in `@openreel/core/creation/material`: a DAG of `color`/`scalar`/`mix`/`multiply` nodes resolving to a final `output` PBR descriptor (baseColor/metallic/roughness/emissive) with memoized, cycle-safe evaluation and param fallbacks — verified by color mixing (red+blue→purple), output-param fallback, and scalar multiply with a cyclic node tolerated.
- Wired the new CPU references into agent-facing compute tools (§8): `solve_creation_ik` (two-bone IK elbow/reachability), `evaluate_creation_material_graph` (resolve a node graph to PBR), and `simulate_creation_cloth` (run the mass-spring solver and report mesh stats) — so agents can drive the rig, material, and simulation engines directly, verified end-to-end through the executor harness.
- Added the first Motion Creator-native creation workspace tab: professionals can now inspect persisted agent-created creation scenes inside Motion Creator, see render-binding health (ready/partial/missing/stale), object/material/cache issue summaries, and jump directly to the bound `scene3d` render composition/layer for preview and editing.
- Scaffolded Phase 0 (engine foundation, §16) with two real packages: `@openreel/creation-core` (the native C++20 engine) ships a stable C ABI header (`creation_core.h`), a matching C++ implementation, and a CMake build for both native (shared library) and WASM (emscripten) targets; `@openreel/creation-bindings` is the TypeScript Node-addon/WASM bridge that loads the native module through that ABI and **falls back to the CPU reference** (`@openreel/core/creation`) when no native build is present. The bridge + fallback is fully buildable and unit-tested now (CPU fallback parity, native-injection routing, preferCpu override).
- Compiled and verified the native core for real: `@openreel/creation-core` builds with CMake + clang++ into `libcreation_core.dylib`, and a native parity test (`creation_core_test`, run via `ctest` / `pnpm --filter @openreel/creation-core test:native`) passes — confirming the C ABI produces results matching the CPU reference (2×2×2 box → 24 vertices, 12 triangles, bounds [-1,1]³).
- Built and loaded a real Node N-API addon for the native bridge: `@openreel/creation-bindings/native` compiles the C ABI into `creation_core_addon.node` via node-gyp, and `loadNativeAddon()` loads it at runtime; a binding test loads the actual compiled addon and asserts it matches the CPU reference, so `loadCreationBackend({ autoNative: true })` returns a working `native` backend. This lands the Phase 0 "Node addon bridge" deliverable as a genuinely compiled-and-loaded addon (not a stub), with the CMake WASM target configured for the emscripten path when that toolchain is present.
- Landed the Phase 0 "WASM bridge proof of concept" as an actually-executing module: `@openreel/creation-bindings/src/wasm.ts` embeds a real, dependency-free WebAssembly module (assembled from `wasm/creation_core.wat`) that `instantiateCreationWasm()` runs via `WebAssembly.instantiate`, and `loadWasmBackend()` wraps its `box_vertex_count` export into a `wasm` backend — verified by a test that instantiates the module, calls into it (returns 24), and asserts CPU-reference parity. The full WASM build still comes from `@openreel/creation-core` via emscripten; this proof of concept runs without any external toolchain.
- Added golden geometry tests (vertex/triangle counts, bounds, mesh validity, transform/merge, whole-scene bake, weld/normal optimization, bake cache status, glTF structure) and agent bake/export tests, plus workspace typecheck coverage for the new creation foundation.

## 1. Vision

OpenReel should become an agent-native creation engine. Agents should be able to describe intent at a high level, but the result must remain editable by humans and agents. A product intro should not be a baked video. It should be a scene graph, asset recipes, materials, cameras, lights, rigs, animations, constraints, and timeline clips that OpenReel can inspect, modify, render, and export.

Example target workflow:

```text
create_product("phone", style: "titanium pro phone")
build_product_detail(["camera island", "display stack", "logic board", "battery", "cooling layer"])
animate_exploded_view(axis: "z", stagger: 0.12)
add_callouts(["A-series chip", "camera sensor", "battery", "thermal frame"])
camera_orbit(duration: 4.0, macro_lens: true)
render_preview(time: 2.5)
insert_motion_into_editor()
```

The professional user can then open the product, adjust a lens bevel, change the camera path, swap a material, edit an exploded-view distance, or replace generated internals with real CAD/reference data.

## 2. Core Principles

1. **Everything editable.** Generated assets are procedural recipes plus baked caches, not opaque meshes only.
2. **Agents speak intent, engine stores structure.** MCP tools expose product, character, material, layout, rigging, and camera concepts.
3. **No random-asset dependency.** Online GLBs can still be imported, but the primary path is internal procedural generation and user-provided references.
4. **Use performance-native cores.** C++ handles geometry, simulation, rigging, import/export, and rendering kernels. TypeScript handles app UI, MCP orchestration, state, and timeline tools.
5. **Realtime first, high quality second.** Artists and agents iterate in a realtime viewport, then OpenReel can render higher-quality frames with a path tracer when needed.
6. **Human and agent parity.** Every agent operation should map to a visible editor concept and be adjustable in the UI.
7. **Deterministic asset recipes.** Re-running the same recipe with the same inputs should produce the same asset unless randomness is explicitly seeded.
8. **Graceful levels of detail.** Preview meshes, final meshes, collision meshes, and render meshes can differ, but all derive from one asset recipe.
9. **Physical plausibility without false claims.** For branded products or internals, OpenReel can create plausible visuals from references. Exact internals require user-provided CAD, teardown references, or approved specs.

## 3. Product Scope

OpenReel should eventually create and edit:

- Product cinematics: phones, headphones, cars, watches, laptops, packaging, cosmetics, appliances.
- Exploded views: product layers, internals, callouts, cross sections, ghosted shells, zoom-throughs.
- Characters: humans, mascots, astronauts, robots, stylized figures, hands, faces, clothing, props.
- Environments: moon terrain, showrooms, abstract stages, city blocks, rooms, tabletop scenes.
- Motion graphics: 2D and 3D titles, lower thirds, diagrams, charts, UI scenes.
- 3D interfaces: dashboards, app screens, holographic panels, device screens, spatial UI.
- Simulations: cloth flags, particles, rigid-body product breakups, cables, soft secondary motion.
- Materials: glass, metal, fabric, plastic, ceramic, screens, emissive UI, dust, scratches, fingerprints.
- Cameras: macro product lenses, orbit rigs, dolly zooms, turntables, handheld drift, focus pulls.

## 4. High-Level Architecture

```text
OpenReel App
  React/Electron UI
  Motion Creator UI
  Timeline and inspector
  MCP agent bridge

OpenReel Creation Runtime
  Scene graph
  Asset recipe graph
  Animation graph
  Material graph
  Timeline bindings

Native Engine Core (C++)
  Geometry kernel
  Mesh processing
  Procedural asset builders
  Rigging and animation solver
  Simulation kernels
  Import/export
  Realtime render backend
  Path-trace/final render backend

Bindings
  C ABI
  Node native addon for desktop
  WASM/WebGPU build for browser-safe preview
  Worker process API for heavy jobs

Storage
  .openreel project
  asset recipes
  baked mesh caches
  texture caches
  animation clips
  render previews
```

## 5. Recommended Technology Choices

### 5.1 Native Core

Use **C++20 or C++23** as the primary native engine language.

Reasons:

- Strongest ecosystem for geometry, rendering, animation, GPU interop, and import/export.
- Easier integration with mesh libraries, physics libraries, USD/glTF pipelines, and render backends.
- Can expose a stable C ABI to TypeScript/Electron and future language bindings.

Rust can still be useful for safe worker services and asset indexing, but C++ should be the core engine language.

### 5.2 UI and Agent Layer

Use **TypeScript + React + Electron** for:

- Motion Creator editor UI.
- Inspector panels.
- Node graph editor.
- Timeline.
- MCP tools.
- Project persistence.
- Agent orchestration.

### 5.3 GPU and Rendering

Use:

- **WebGPU** for browser/desktop realtime viewport where possible.
- **Native GPU backend** later for full desktop performance.
- **CPU fallback** for deterministic tests and CI.
- Optional standalone path tracer later for final cinematic rendering.

### 5.4 Interchange

Use:

- **OpenReel Asset Recipe** as the internal editable source of truth.
- **glTF/GLB** for web/runtime exchange.
- **USD** later for high-end scene interchange and product pipelines.
- **OBJ/STL/FBX import** as compatibility only, not as the internal format.

## 6. Internal Data Model

### 6.1 Project

The project stores:

- Timeline tracks and clips.
- Motion compositions.
- Asset library.
- Scene instances.
- Materials.
- Textures.
- Cameras and lights.
- Render settings.
- Agent operation history.

### 6.2 Asset Recipe

An asset recipe is a non-destructive graph:

```ts
type AssetRecipe = {
  id: string;
  kind: "product" | "character" | "environment" | "prop" | "ui" | "custom";
  parameters: Record<string, unknown>;
  nodes: RecipeNode[];
  outputs: AssetOutput[];
  dependencies: AssetDependency[];
  bakedCaches: AssetCacheRef[];
};
```

Recipe nodes include:

- Primitive mesh.
- Curve.
- Text.
- SDF volume.
- Boolean.
- Bevel.
- Subdivision.
- Array.
- Scatter.
- Deform.
- Cloth patch.
- Skeleton.
- IK control.
- Material assignment.
- UV unwrap.
- Decal.
- Bake.

### 6.3 Scene Graph

The scene graph stores:

- Transform hierarchy.
- Object instances.
- Product parts.
- Bones.
- Cameras.
- Lights.
- Constraints.
- Animation tracks.
- Simulation tracks.
- Visibility and render layers.

### 6.4 Asset Caches

Heavy generated results are cached:

- Preview mesh.
- Final mesh.
- Collision mesh.
- UVs.
- Texture atlases.
- Baked normals.
- Baked animation clips.
- Render thumbnails.

Caches can be regenerated from recipes.

## 7. Native Engine Modules

### 7.1 Geometry Kernel

Responsibilities:

- Mesh representation.
- Half-edge or winged-edge topology.
- Vertex attributes.
- Normals, tangents, bitangents.
- UV generation.
- Bevels.
- Extrusions.
- Revolves.
- Sweeps.
- Lofting.
- Subdivision surfaces.
- Decimation.
- Remeshing.
- Mesh repair.
- Surface sampling.
- Bounding volumes.

Needed for product intros:

- Accurate bevels on phone bodies.
- Lens rings.
- Ports.
- Buttons.
- Display glass layers.
- Internal boards and chips.
- Screws and connectors.

### 7.2 SDF and Volume Modeling

Signed distance fields enable robust procedural forms:

- Smooth unions.
- Cutaways.
- Organic props.
- Terrain.
- Rocks.
- Dust.
- Soft product cushions.
- Stylized characters.

Pipeline:

1. Build SDF graph.
2. Evaluate adaptive volume.
3. Extract mesh with marching cubes or dual contouring.
4. Retopologize or decimate.
5. Bake normals/detail.

### 7.3 Curve and Surface System

Needed for:

- Cables.
- Wires.
- UI ribbons.
- Product seams.
- Camera rails.
- Motion paths.
- Callout lines.
- Typography extrusion.

Features:

- Bezier/NURBS curves.
- Sweep profile.
- Thickness.
- Taper.
- Twist.
- Trim.
- Path constraints.

### 7.4 Boolean and CAD-Lite System

Needed for hard-surface assets:

- Device ports.
- Buttons.
- Speaker holes.
- Camera cutouts.
- Cross sections.
- Exploded shells.

OpenReel does not need full SolidWorks-level CAD in v1, but it needs predictable hard-surface operations.

### 7.5 Product Part System

Products need semantic parts:

```ts
type ProductPart = {
  id: string;
  name: string;
  role: "shell" | "screen" | "lens" | "board" | "battery" | "chip" | "screw" | "connector" | "decorative";
  materialId: string;
  transform: Transform3D;
  explodedTransform?: Transform3D;
  calloutAnchor?: Vec3;
};
```

This enables:

- Exploded views.
- Part labels.
- Highlight sweeps.
- Ghosted shells.
- X-ray reveal.
- Focus-isolate animations.

### 7.6 Character System

Needed features:

- Parametric humanoid base mesh.
- Body proportions.
- Skeleton templates.
- Skin weights.
- Clothing layers.
- Gloves/boots/helmets.
- Accessories.
- Hand poses.
- Face/helmet variants.
- Style presets: realistic, stylized, low-poly, toy, clay, technical.

Characters should be recipe-driven:

```text
humanoid
  proportions: astronaut bulky suit
  helmet: reflective visor
  gloves: EVA
  boots: moon
  backpack: life-support
  rig: humanoid_ik
  animation: wave_right_hand
```

### 7.7 Rigging and Animation Solver

Needed features:

- Skeleton hierarchy.
- FK.
- IK.
- Constraints.
- Look-at.
- Pole targets.
- Retargeting.
- Pose library.
- Animation clip blending.
- Additive animation.
- Procedural walk/idle/wave.
- Keyframe baking.
- Motion paths.

For the astronaut:

- Feet snap to moon terrain.
- One hand grips the flag pole.
- Other arm waves.
- Head tracks camera.
- Body has subtle idle motion.

### 7.8 Cloth and Soft Simulation

Needed for:

- Flags.
- Capes.
- Clothing secondary motion.
- Product fabric.
- Packaging ribbons.

Phases:

1. Simple procedural cloth waves.
2. GPU cloth preview.
3. Cached simulation.
4. Collision-aware cloth.

The Ghana flag should be one cloth surface, attached to a pole, with wind or hand-driven motion.

### 7.9 Physics and Constraints

Needed for:

- Product part breakup.
- Exploded views.
- Object placement.
- Terrain contact.
- Rigid-body drops.
- Magnetic/snap layouts.

Features:

- Rigid bodies.
- Collision shapes.
- Springs.
- Constraints.
- Contact snapping.
- Gravity presets.
- Bake to keyframes.

### 7.10 Materials and Textures

Material graph features:

- PBR base color.
- Metallic.
- Roughness.
- Normal.
- Clearcoat.
- Transmission.
- Subsurface.
- Emission.
- Anisotropy.
- Procedural noise.
- Scratches.
- Dust.
- Fingerprints.
- Edge wear.
- Decals.
- Texture baking.

Product presets:

- Brushed titanium.
- Polished aluminum.
- Ceramic glass.
- OLED screen.
- Matte plastic.
- Rubber gasket.
- Copper trace.
- Silicon chip.

### 7.11 Texture Generation

Internal procedural texture system:

- Noise.
- Voronoi.
- Musgrave-style fractals.
- Pattern generators.
- Circuit board traces.
- Fabric weave.
- Lunar dust.
- Scratches.
- Smudges.
- Micro bumps.
- Decal placement.

Optional later:

- Local AI texture generation.
- Image-to-material.
- Reference-guided material matching.

### 7.12 Renderer

Realtime viewport:

- PBR.
- Shadows.
- Reflection probes.
- Screen-space reflections.
- Ambient occlusion.
- Bloom.
- Depth of field.
- Motion blur preview.
- Outline overlays.
- Selection/manipulators.

Final renderer:

- Path tracing.
- Progressive preview.
- Denoising.
- Depth of field.
- Motion blur.
- Transparent/glass materials.
- Render passes.
- AOVs.

Cycles standalone can be an optional future backend, but OpenReel should own the scene format and rendering orchestration.

## 8. Agent MCP Tool Families

### 8.1 Capability and Inspection Tools

- `get_creation_capabilities`
- `list_asset_generators`
- `inspect_asset_recipe`
- `inspect_scene_graph`
- `inspect_product_parts`
- `inspect_character_rig`
- `render_creation_preview`
- `validate_scene`

### 8.2 Asset Creation Tools

- `create_asset_recipe`
- `create_product_asset`
- `create_character_asset`
- `create_environment_asset`
- `create_prop_asset`
- `create_ui_3d_asset`
- `add_creation_ui_panel`
- `duplicate_asset_variant`
- `bake_asset_cache`

### 8.3 Geometry Tools

- `add_primitive`
- `add_curve`
- `add_sdf_shape`
- `apply_boolean`
- `apply_bevel`
- `apply_creation_bevel`
- `apply_subdivision`
- `apply_creation_displacement`
- `extrude_shape`
- `revolve_profile`
- `sweep_profile_along_curve`
- `scatter_objects`
- `scatter_creation_objects`
- `generate_uvs`
- `repair_mesh`
- `optimize_mesh`

### 8.4 Product Tools

- `create_product_body`
- `add_product_part`
- `add_creation_product_part`
- `add_screen_stack`
- `add_creation_screen_stack`
- `add_camera_module`
- `add_creation_camera_module`
- `add_internal_board`
- `add_creation_product_internals`
- `add_battery_pack`
- `add_chip`
- `add_connector`
- `add_screws`
- `set_exploded_view`
- `animate_exploded_view`
- `add_product_callout`
- `add_cutaway_plane`
- `add_device_ui_panel`
- `set_xray_material`

### 8.5 Character Tools

- `create_humanoid`
- `set_character_proportions`
- `add_character_clothing`
- `add_helmet`
- `add_gloves`
- `add_boots`
- `create_skeleton`
- `bind_skin`
- `set_hand_pose`
- `set_ik_target`
- `apply_pose`
- `apply_animation_clip`
- `blend_animation_clip`
- `bake_character_animation`

### 8.6 Material Tools

- `create_material`
- `set_material_pbr`
- `add_procedural_texture`
- `add_decal`
- `add_edge_wear`
- `add_dust`
- `bake_material_maps`
- `assign_material`

### 8.7 Scene and Camera Tools

- `create_3d_scene`
- `add_scene_object`
- `set_camera_rig`
- `animate_camera_orbit`
- `animate_camera_dolly`
- `set_focus_target`
- `add_light_rig`
- `set_environment`
- `set_render_style`
- `add_creation_light_sweep`

### 8.8 Simulation Tools

- `create_cloth_surface`
- `pin_cloth_points`
- `simulate_cloth`
- `create_rigid_body`
- `simulate_rigid_bodies`
- `bake_simulation`
- `create_particle_system`

### 8.9 Timeline Tools

- `insert_asset_scene_into_motion`
- `bind_asset_parameter_to_timeline`
- `set_asset_keyframe`
- `set_scene_keyframes`
- `bake_scene_to_motion_clip`

## 9. Human UI Surfaces

### 9.1 Creation Workbench

New workspace in Motion Creator:

- Scene viewport.
- Asset hierarchy.
- Recipe node graph.
- Inspector.
- Material editor.
- Timeline.
- Preview render panel.
- Agent action history.

### 9.2 Product Editor

Specialized controls:

- Part list.
- Exploded-view sliders.
- Cutaway planes.
- Callout anchors.
- Material slots.
- Screen content editor.
- Internal detail presets.

### 9.3 Character Editor

Specialized controls:

- Skeleton tree.
- IK handles.
- Pose library.
- Animation clips.
- Clothing/accessory layers.
- Weight visualization.
- Foot contact controls.

### 9.4 Material Editor

Node-based plus simplified controls:

- PBR sliders.
- Procedural texture nodes.
- Decal layers.
- Material presets.
- Texture bake preview.

### 9.5 Agent Review Panel

Agents should show:

- Operations performed.
- Generated asset recipe.
- Warnings.
- Visual preview frames.
- Suggested next edits.
- Editable parameters.

## 10. Product Intro Example

For a phone launch animation:

1. Generate phone shell.
2. Generate screen stack.
3. Generate camera module.
4. Generate internals as semantic parts.
5. Assign titanium/glass/silicon/copper materials.
6. Create exploded-view transforms.
7. Animate assembly/disassembly.
8. Add macro camera orbit.
9. Add callouts.
10. Add screen UI.
11. Add light sweep.
12. Render preview.
13. Allow user or agent to revise exact dimensions/materials/labels.

Important: if the user says "iPhone 17 Pro" and supplies references, OpenReel can make a high-fidelity product visualization from those references. If exact undisclosed internals are not provided, OpenReel should create plausible abstract internals and label them accordingly.

## 11. Implementation Phases

### Phase 0: Engine Foundation

Deliverables:

- Native engine package scaffold.
- C ABI boundary.
- Node addon bridge.
- WASM bridge proof of concept.
- Scene graph schema.
- Asset recipe schema.
- Cache format.
- Basic logging/profiling.

Approximate code size: 15k to 30k LOC.

### Phase 1: Procedural Geometry MVP

Deliverables:

- Mesh core.
- Primitives.
- Curves.
- Extrude/revolve/sweep.
- Bevels.
- Basic booleans.
- UV generation.
- glTF/GLB export.
- Preview integration in Motion Creator.
- MCP tools for primitive/product part creation.

Approximate code size: 30k to 60k LOC.

### Phase 2: Product Asset Engine

Deliverables:

- Product part system.
- Phone/watch/laptop/headphones generators.
- Semantic exploded views.
- Callout anchors.
- Screen material and UI planes.
- Product material presets.
- Timeline bindings for part transforms.
- Product intro templates.

Approximate code size: 40k to 80k LOC.

### Phase 3: Material and Texture Engine

Deliverables:

- Material graph.
- Procedural textures.
- Decals.
- Scratch/dust/fingerprint generators.
- Texture bake pipeline.
- Material inspector.
- MCP material tools.

Approximate code size: 40k to 90k LOC.

### Phase 4: Character and Rigging Engine

Deliverables:

- Parametric humanoid.
- Skeleton templates.
- Skinning.
- IK/FK.
- Pose library.
- Animation clips.
- Procedural wave/idle/walk.
- Clothing/accessory generator.
- Character inspector.
- MCP character tools.

Approximate code size: 80k to 180k LOC.

### Phase 5: Simulation Engine

Deliverables:

- Cloth flags.
- Rigid body constraints.
- Particle systems.
- Baking simulation to keyframes.
- Collision previews.
- Terrain contact.

Approximate code size: 50k to 120k LOC.

### Phase 6: Realtime Renderer Upgrade

Deliverables:

- WebGPU renderer.
- PBR material support.
- Shadows.
- Reflection probes.
- Selection/manipulators.
- DOF/motion blur preview.
- Render layers.
- Performance telemetry.

Approximate code size: 60k to 150k LOC.

### Phase 7: Final Render Backend

Deliverables:

- Progressive path tracer or Cycles standalone integration.
- Render queue.
- Denoising.
- Render passes.
- EXR/PNG/ProRes export path.
- Frame caching.

Approximate code size: 40k to 120k LOC if integrating a renderer, much more if building a full path tracer from scratch.

### Phase 8: Agent-Native Creation Tools

Deliverables:

- Full MCP tool families.
- Tool validation.
- Multi-step planning.
- Auto-preview loops.
- Visual diff checks.
- Scene critique tools.
- Asset recipe repair.
- Agent operation history.

Approximate code size: 30k to 80k LOC.

### Phase 9: Professional Editing Polish

Deliverables:

- Workbench UI.
- Node graph UI.
- Product editor.
- Character editor.
- Material editor.
- Timeline polish.
- Preset browser.
- Asset library.
- Keyboard shortcuts.

Approximate code size: 80k to 200k LOC.

## 12. Testing Strategy

### 12.1 Unit Tests

- Geometry operations.
- Mesh validity.
- UV generation.
- Material graph evaluation.
- Animation interpolation.
- IK solver.
- Asset recipe serialization.

### 12.2 Golden Asset Tests

Generate known assets and compare:

- Vertex counts.
- Bounds.
- Materials.
- Hierarchy.
- Preview images.
- Render hashes with tolerances.

### 12.3 Visual Regression Tests

Automated previews:

- Product body.
- Exploded view.
- Character wave.
- Cloth flag.
- Moon terrain.
- UI panels.
- Camera orbit.

### 12.4 Agent Evals

Prompts:

- "Create a phone product intro with exploded internals."
- "Create an astronaut waving while holding a Ghana flag."
- "Create a 3D dashboard interface around a device."
- "Create a luxury watch macro shot with gears exposed."

Each eval checks:

- Scene exists.
- Assets are editable.
- Motion exists.
- Render is nonblank.
- Requested details are present.
- No static character when animation requested.

### 12.5 Performance Tests

- Asset generation time.
- Viewport frame rate.
- Memory usage.
- Render time.
- Cache hit rate.
- Large scene load/save time.

## 13. Risks

### 13.1 Scope Explosion

This is a full DCC/product-rendering engine. It must be phased.

Mitigation:

- Start with product/hard-surface assets.
- Keep character rigging to templates first.
- Use generated recipes instead of freeform modeling at first.

### 13.2 Geometry Robustness

Booleans, bevels, and UVs can be fragile.

Mitigation:

- Build strong mesh validation.
- Keep operations constrained.
- Use recipe repair tools.
- Add golden tests early.

### 13.3 Agent Overreach

Agents may request impossible exactness.

Mitigation:

- Tools return warnings.
- Require references for exact branded products.
- Distinguish plausible generated internals from verified internals.

### 13.4 Performance

Detailed assets can crush the viewport.

Mitigation:

- LODs.
- Mesh caches.
- Background baking.
- GPU instancing.
- Streaming asset loading.

### 13.5 Rebuilding Too Much

Recreating all of Blender is unrealistic.

Mitigation:

- Build the OpenReel workflow and asset recipe engine first.
- Use focused native libraries where useful.
- Treat external DCC apps as optional import/export paths, not core UX dependencies.

## 14. Build-vs-Buy Stance

OpenReel should own:

- Asset recipes.
- Agent tools.
- Scene graph.
- Timeline integration.
- Product generator.
- Character templates.
- UI.
- Preview/render orchestration.

OpenReel can use libraries for:

- Mesh simplification.
- Image codecs.
- glTF/USD import/export.
- GPU abstraction.
- Physics kernels.
- Denoising.

OpenReel should not depend on:

- Random asset downloads.
- Manual Blender UI steps.
- Cloud-only rigging services.
- Opaque generated videos.

## 15. First Practical Milestone

Build a **Product Cinematic MVP** before full character rigging.

Why:

- Hard-surface product generation is more deterministic than humans.
- It directly supports high-value product intros.
- It proves procedural assets, exploded views, materials, cameras, and agent tools.
- It creates the engine foundation needed for characters later.

Milestone target:

```text
Agent prompt:
"Create a cinematic phone intro. Show the phone rotating, then split it into
screen, frame, battery, chip, camera, and back plate. Add labels and a final
hero shot."
```

Acceptance:

- OpenReel creates an editable product asset.
- Product has semantic parts.
- Exploded-view animation exists.
- Materials look credible.
- Camera animation exists.
- Labels/callouts exist.
- Preview renders in Motion Creator.
- Timeline can export it.
- User can adjust parts, materials, labels, and camera.

## 16. Codebase Shape

Proposed packages:

```text
packages/creation-core/          C++ source, C ABI, tests
packages/creation-bindings/      Node addon and WASM bindings
packages/creation-schema/        TypeScript schemas and recipe types
packages/creation-agent/         MCP tool definitions and handlers
apps/web/src/creation/           Workbench UI
apps/web/src/motion/             Timeline/render integration
apps/desktop/src/main/creation/  Native worker orchestration
```

Native layout:

```text
packages/creation-core/src/
  geometry/
  sdf/
  curves/
  materials/
  products/
  characters/
  rigging/
  animation/
  simulation/
  renderer/
  import_export/
  cache/
  api/
```

## 17. Long-Term Outcome

OpenReel becomes an agent-native DCC for motion creation:

- Agents can create anything from structured intent.
- Professionals can edit every generated result.
- Product videos, UI demos, technical explainers, animated characters, and cinematic scenes are all first-class.
- Blender is no longer required for the normal workflow.
- External assets become optional accelerators, not the foundation.
