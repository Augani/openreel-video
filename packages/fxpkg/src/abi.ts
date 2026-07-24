/**
 * ABI registry (STUDIO_PLAN §8). The ABI defines the host-provided uniforms,
 * the resource caps, and — together with the node library — which node
 * operations the compiler may emit for a given version.
 *
 * Minor versions (1.x) are backward-compatible; older consumers must accept
 * newer minor versions if they don't use new features. Unknown nodes are
 * rejected at load time, not as runtime errors.
 */
import type { AbiVersion, ResourceCaps } from "./types";

export const ABI_VERSIONS: AbiVersion[] = ["1.0", "1.1", "1.2"];

export const CURRENT_ABI: AbiVersion = "1.2";

/** Host-provided uniforms available to every graph (STUDIO_PLAN §8, §11). */
export const HOST_UNIFORMS = [
  { id: "u_source", kind: "texture", desc: "input frame texture" },
  { id: "u_samp", kind: "sampler", desc: "linear sampler" },
  { id: "u_resolution", kind: "vec2", desc: "output resolution in px" },
  { id: "u_time", kind: "float", desc: "global time in seconds" },
  { id: "u_frame", kind: "int", desc: "frame index" },
] as const;

/** Resource caps per ABI version (STUDIO_PLAN §19.1, §20.4, §21.2). */
export const ABI_CAPS: Record<AbiVersion, ResourceCaps> = {
  "1.0": {
    maxParticles: 2048,
    maxParticleSystems: 4,
    maxTotalParticles: 8192,
    maxHistoryDepth: 0,
    maxMeshes: 0,
    maxMeshTris: 0,
    maxResolution: [3840, 2160],
  },
  "1.1": {
    maxParticles: 2048,
    maxParticleSystems: 4,
    maxTotalParticles: 8192,
    maxHistoryDepth: 16,
    maxMeshes: 0,
    maxMeshTris: 0,
    maxResolution: [3840, 2160],
  },
  "1.2": {
    maxParticles: 2048,
    maxParticleSystems: 4,
    maxTotalParticles: 8192,
    maxHistoryDepth: 16,
    maxMeshes: 4,
    maxMeshTris: 50000,
    maxResolution: [3840, 2160],
  },
};

export function abiIndex(v: AbiVersion): number {
  return ABI_VERSIONS.indexOf(v);
}

/** True when `have` satisfies `need` (same major, minor >=). */
export function abiAtLeast(have: AbiVersion, need: AbiVersion): boolean {
  const [hMaj, hMin] = have.split(".").map(Number);
  const [nMaj, nMin] = need.split(".").map(Number);
  if (hMaj !== nMaj) return false;
  return hMin >= nMin;
}

export function capsFor(v: AbiVersion): ResourceCaps {
  return ABI_CAPS[v];
}
