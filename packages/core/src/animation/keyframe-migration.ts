import type { Keyframe } from "../types/timeline";
import type { Project } from "../types/project";

/**
 * Projects saved before the keyframe graph editor store plain named easings. Two of them have an
 * exact cubic-Bezier equivalent, so the graph can show and edit them as real handles without changing a
 * single evaluated value:
 *
 *   ease-in   y = t^2            = cubic-bezier(1/3, 0,   2/3, 1/3)
 *   ease-out  y = 1 - (1-t)^2    = cubic-bezier(1/3, 2/3, 2/3, 1)
 *
 * (a quadratic Bezier elevated to a cubic). `linear` and `hold` are already exact and stay as they are.
 * `ease-in-out` is two quadratics joined at the middle and cannot be one cubic, so it keeps its named
 * easing (and therefore its exact legacy curve); it is only approximated when the user opens its handles.
 * Every other named easing is left alone for the same reason.
 */
const EXACT_HANDLES: Partial<Record<Keyframe["easing"], NonNullable<Keyframe["bezierHandles"]>>> = {
  "ease-in": { in: { x: 1 / 3, y: 0 }, out: { x: 2 / 3, y: 1 / 3 } },
  "ease-out": { in: { x: 1 / 3, y: 2 / 3 }, out: { x: 2 / 3, y: 1 } },
};

export function migrateLegacyKeyframeEasings(keyframes: readonly Keyframe[]): Keyframe[] {
  let changed = false;
  const next = keyframes.map((key) => {
    const handles = EXACT_HANDLES[key.easing];
    if (!handles || key.bezierHandles) return key;
    changed = true;
    return { ...key, easing: "bezier" as const, bezierHandles: handles };
  });
  return changed ? next : (keyframes as Keyframe[]);
}

type Owner = { readonly keyframes?: Keyframe[] };
function migrateOwners<T extends Owner>(owners: readonly T[]): readonly T[] {
  let changed = false;
  const next = owners.map((owner) => {
    if (!Array.isArray(owner.keyframes) || owner.keyframes.length === 0) return owner;
    const keyframes = migrateLegacyKeyframeEasings(owner.keyframes);
    if (keyframes === owner.keyframes) return owner;
    changed = true;
    return { ...owner, keyframes };
  });
  return changed ? next : owners;
}

/** Load-time migration for the timeline and every stored sequence. Idempotent. */
export function normalizeProjectKeyframeEasings(project: Project): Project {
  if (!Array.isArray(project.timeline?.tracks)) return project;
  const normalizeTimeline = <T extends { readonly tracks: Project["timeline"]["tracks"] }>(timeline: T): T => {
    const tracks = timeline.tracks.map((track) => {
      const clips = migrateOwners(track.clips ?? []);
      return clips === track.clips ? track : { ...track, clips: clips as typeof track.clips };
    });
    return tracks.some((track, index) => track !== timeline.tracks[index]) ? { ...timeline, tracks } : timeline;
  };
  const timeline = normalizeTimeline(project.timeline);
  let sequencesChanged = false;
  const sequences = Array.isArray(project.sequences)
    ? project.sequences.map((sequence) => {
        if (!Array.isArray(sequence.timeline?.tracks)) return sequence;
        const next = normalizeTimeline(sequence.timeline);
        if (next === sequence.timeline) return sequence;
        sequencesChanged = true;
        return { ...sequence, timeline: next };
      })
    : project.sequences;
  if (timeline === project.timeline && !sequencesChanged) return project;
  return { ...project, timeline, ...(sequencesChanged ? { sequences } : {}) };
}
