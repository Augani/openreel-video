import type { Clip, Track, Transition, TransitionEdge } from "@openreel/core";

export const TRANSITION_ADJACENCY_TOLERANCE = 0.05;

export interface ResolvedTransitionHandle {
  clipA: Clip;
  clipB?: Clip;
  edge?: TransitionEdge;
  centerX: number;
  transition?: Transition;
}

export function resolveTransitionHandles(
  track: Track,
  pixelsPerSecond: number,
): ResolvedTransitionHandle[] {
  const sorted = [...track.clips].sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  );
  const handles: ResolvedTransitionHandle[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const clipA = sorted[i];
    const clipB = sorted[i + 1];
    const gap = Math.abs(clipB.startTime - (clipA.startTime + clipA.duration));
    if (gap > TRANSITION_ADJACENCY_TOLERANCE) continue;

    const transition = track.transitions.find(
      (t) => t.clipAId === clipA.id && t.clipBId === clipB.id,
    );

    handles.push({
      clipA,
      clipB,
      transition,
      centerX: clipB.startTime * pixelsPerSecond,
    });
  }

  for (const transition of track.transitions) {
    if (transition.clipBId) continue;
    const clip = sorted.find((candidate) => candidate.id === transition.clipAId);
    if (!clip) continue;
    const edge = transition.edge ?? "out";
    handles.push({
      clipA: clip,
      edge,
      transition,
      centerX:
        (edge === "in" ? clip.startTime : clip.startTime + clip.duration) *
        pixelsPerSecond,
    });
  }

  return handles.sort((a, b) => a.centerX - b.centerX);
}
