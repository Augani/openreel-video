/**
 * The skinned-rig, particle and rigid-body solvers behind the creation bake tools, loaded on first use (dynamic import from
 * registry.ts) so they stay out of the agent chunk.
 */
export {
  buildSkinnedLimb,
  limbWavePose,
  buildSkinnedHumanoid,
  humanoidAnimationPose,
  skinMesh,
  spawnParticles,
  stepParticles,
  makeRigidBody,
  bakeRigidBodyTracks,
} from "@openreel/core/creation/index";
