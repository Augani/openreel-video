import type { Clip, Effect, Timeline } from "../types/timeline";
import { getLinkedAudioClips } from "./clip-audio-resolution";
import { bakeNativePluginAutomation } from "./native-plugin/native-plugin-effect";

type TimelineWithTracks = Pick<Timeline, "tracks">;

/**
 * The audio effect chain a clip plays (its own, else its linked clip's) with hosted-plugin automation baked in. Lives apart
 * from clip-audio-resolution so the edit path, which only needs the volume lanes, does not pull the plugin code into the
 * startup chunk.
 */
export const resolveClipAudioEffects = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Effect[] => {
  const directEffects = clip.audioEffects ?? [];
  if (directEffects.length > 0) {
    // Hosted plugins carry their parameter automation as clip keyframes; bake it here so preview and export see the same lanes.
    return bakeNativePluginAutomation(directEffects, clip);
  }

  const linkedClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => (entry.clip.audioEffects ?? []).length > 0,
  );

  return linkedClip ? bakeNativePluginAutomation(linkedClip.clip.audioEffects, linkedClip.clip) : [];
};
