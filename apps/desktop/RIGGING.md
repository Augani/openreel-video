# Motion Creator rigging pipeline

OpenReel needs a real DCC-backed pipeline for high quality 3D character work.
Static GLB placement is enough for props and environments, but a waving
astronaut, walk cycle, hand pose, or camera-aware character performance needs
armatures, animation clips, inverse kinematics, and retargeting.

## Current implementation

- Desktop main process probes Blender as the rigging backend.
- Probe order is environment override, bundled resource, then common system
  installs.
- Renderer exposes `window.openreel.rigging.probeBackend()`.
- Agents can call the read-only MCP tool `probe_rigging_backend`.
- Agents can call the read-only MCP tool `inspect_3d_model` to report GLB/glTF
  meshes, materials, textures, animation clips, armature/bones, bounds,
  warnings, and suggested next tools before editing or rigging a model.
- Agents can call the MCP tool `rig_humanoid_model` to run Blender headlessly,
  import a GLB/glTF model, preserve or create a humanoid armature scaffold,
  attempt automatic mesh weights, and export a rigged GLB.
- Motion Creator can play GLB/glTF animation clips on `scene3d` model objects
  via the MCP `set_model_animation` tool and the `MotionObject3D.animation`
  timeline binding.
- Animated/skinned model instances are cloned with independent skeleton state.
- Packaged builds have a stable optional resource slot at
  `resources/rigging/blender/<platform>-<arch>/`.

## Backend contract

Blender is the first backend because it can run headlessly, execute Python jobs,
import/export GLB/glTF, create or edit armatures, bake animations, and perform
cleanup without forcing the user into a manual Blender session.

Backend jobs should be deterministic files-in/files-out tasks:

1. Import the source GLB/glTF into a temporary Blender scene.
2. Normalize units, transforms, pivots, materials, and texture paths.
3. Inspect meshes, skeletons, bones, vertex groups, and animation clips.
4. Create or repair an armature when the asset has no usable rig.
5. Retarget motion clips onto the armature.
6. Bake IK/procedural edits into animation clips.
7. Export a runtime-ready GLB.
8. Validate the exported GLB before Motion Creator imports it.

## MCP tools still needed

- `retarget_animation_clip`: apply a source motion clip to a target rig.
- `set_bone_pose`: keyframe direct bone transforms for short edits.
- `set_ik_target`: keyframe hands, feet, head, and look-at controls.
- `optimize_3d_model`: prune, dedupe, compress, and resize textures.
- `export_rigged_model`: persist the final GLB as a reusable project asset.

## Runtime work still needed

- Blendable multi-clip animation layers and cross-fades.
- Inspector UI for model hierarchy, animation clips, bones, IK handles, and
  material slots.
- Render tests that compare first/middle/last animation frames and reject static
  character output when animation was requested.

## Practical artist flow

Agents and professionals should be able to import a character, inspect whether
it is rigged, rig it if needed, apply a waving/idle/walk/performance clip, then
edit camera and lighting directly in Motion Creator. Blender handles the heavy
asset surgery; Motion Creator owns scene layout, timing, preview, and export.
