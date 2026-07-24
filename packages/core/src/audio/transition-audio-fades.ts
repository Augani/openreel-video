import type { Track } from "../types/timeline";

export interface TransitionAudioFades {
  readonly fadeIn: number;
  readonly fadeOut: number;
}

export function getTrackTransitionAudioFades(
  track: Pick<Track, "transitions">,
  clipId: string,
): TransitionAudioFades {
  let fadeIn = 0;
  let fadeOut = 0;
  for (const transition of track.transitions) {
    if (transition.params.audioFade !== true) continue;
    const duration = Math.max(0, transition.duration);
    if (transition.clipBId) {
      const sideDuration = duration / 2;
      if (transition.clipAId === clipId) fadeOut = Math.max(fadeOut, sideDuration);
      if (transition.clipBId === clipId) fadeIn = Math.max(fadeIn, sideDuration);
      continue;
    }
    if (transition.clipAId !== clipId) continue;
    if (transition.edge === "in") fadeIn = Math.max(fadeIn, duration);
    else fadeOut = Math.max(fadeOut, duration);
  }
  return { fadeIn, fadeOut };
}
