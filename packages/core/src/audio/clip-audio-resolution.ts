import { resolveClipChannelMap, type ChannelPreset, type ClipChannelMap } from "./channel-map";
import type {
  AutomationPoint,
  Clip,
  Effect,
  Timeline,
  Track,
} from "../types/timeline";

import { applyLiveDuckingToLane } from "./live-ducking";

type TimelineWithTracks = Pick<Timeline, "tracks">;

const LINK_TOLERANCE_SECONDS = 0.01;

const getClipAudioTrackIndex = (clip: Clip): number => {
  const sourceTrackIndex = clip.metadata?.sourceAudioTrackIndex;
  return typeof sourceTrackIndex === "number" &&
    Number.isFinite(sourceTrackIndex)
    ? sourceTrackIndex
    : (clip.audioTrackIndex ?? 0);
};

const isAlignedLinkedClip = (clip: Clip, candidate: Clip): boolean =>
  candidate.id !== clip.id &&
  (candidate.mediaId === clip.mediaId ||
    candidate.metadata?.separatedFromClipId === clip.id ||
    clip.metadata?.separatedFromClipId === candidate.id ||
    candidate.metadata?.separatedFromClipId ===
      (clip.metadata?.splitSourceClipId ?? clip.id) ||
    clip.metadata?.separatedFromClipId ===
      (candidate.metadata?.splitSourceClipId ?? candidate.id)) &&
  getClipAudioTrackIndex(candidate) === getClipAudioTrackIndex(clip) &&
  Math.abs(candidate.startTime - clip.startTime) < LINK_TOLERANCE_SECONDS &&
  Math.abs(candidate.inPoint - clip.inPoint) < LINK_TOLERANCE_SECONDS;

export const getLinkedAudioClips = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Array<{ clip: Clip; track: Track }> => {
  const linkedClips: Array<{ clip: Clip; track: Track }> = [];

  for (const track of timeline.tracks) {
    if (track.id === clip.trackId) {
      continue;
    }

    for (const candidate of track.clips) {
      if (isAlignedLinkedClip(clip, candidate)) {
        linkedClips.push({ clip: candidate, track });
      }
    }
  }

  return linkedClips;
};

export const resolveClipAudioEffects = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Effect[] => {
  const directEffects = clip.audioEffects ?? [];
  if (directEffects.length > 0) {
    return directEffects;
  }

  const linkedClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => (entry.clip.audioEffects ?? []).length > 0,
  );

  return linkedClip?.clip.audioEffects ?? [];
};

/** The clip's stored volume lane (or its linked clip's), without live ducking. */
export const resolveClipBaseVolumeAutomation = (
  clip: Clip,
  timeline: TimelineWithTracks,
): AutomationPoint[] => {
  const directAutomation = clip.automation?.volume ?? [];
  if (directAutomation.length > 0) {
    return directAutomation;
  }

  const linkedClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => (entry.clip.automation?.volume?.length ?? 0) > 0,
  );

  return linkedClip?.clip.automation?.volume ?? [];
};

/** The clip's pan lane (-1 left .. 1 right), or its linked clip's. */
export const resolveClipPanAutomation = (
  clip: Clip,
  timeline: TimelineWithTracks,
): AutomationPoint[] => {
  const direct = clip.automation?.pan ?? [];
  if (direct.length > 0) return direct;
  const linked = getLinkedAudioClips(clip, timeline).find(
    (entry) => (entry.clip.automation?.pan?.length ?? 0) > 0,
  );
  return linked?.clip.automation?.pan ?? [];
};

/** Maintain-audio-pitch flag (default on): the clip's own, else its linked clip's. */
export const resolveClipPitchCorrection = (
  clip: Clip,
  timeline: TimelineWithTracks,
): boolean => {
  if (clip.pitchCorrection !== undefined) return clip.pitchCorrection;
  const linked = getLinkedAudioClips(clip, timeline).find(
    (entry) => entry.clip.pitchCorrection !== undefined,
  );
  return linked?.clip.pitchCorrection ?? true;
};

/**
 * Pan lane and maintain-pitch flag for a clip, with linked-clip fallback. Every preview schedule
 * builder and the export path use this so they cannot drift apart.
 */
export const resolveClipPlaybackAudioParams = (
  clip: Clip,
  timeline: TimelineWithTracks,
  media?: { readonly channelPreset?: ChannelPreset; readonly metadata?: { readonly channels?: number } },
): { panAutomation: AutomationPoint[]; pitchCorrection: boolean; channelMap?: ClipChannelMap } => {
  const channelMap = resolveClipChannelMap(clip, media);
  return {
    panAutomation: resolveClipPanAutomation(clip, timeline),
    pitchCorrection: resolveClipPitchCorrection(clip, timeline),
    ...(channelMap ? { channelMap } : {}),
  };
};

/** The volume lane that is actually heard: the stored lane with live ducking under dialogue applied. */
export const resolveClipVolumeAutomation = (
  clip: Clip,
  timeline: TimelineWithTracks,
): AutomationPoint[] =>
  applyLiveDuckingToLane(
    clip,
    timeline,
    resolveClipBaseVolumeAutomation(clip, timeline),
  );

export const resolveAudibleAudioTarget = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Clip => {
  if (clip.volume > 0) {
    return clip;
  }

  const linkedAudioClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => entry.clip.volume > 0,
  );

  return linkedAudioClip?.clip ?? clip;
};
