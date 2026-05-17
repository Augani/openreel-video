import type { AutomationPoint, Clip, Effect, Timeline, Track } from "../types/timeline";

type TimelineWithTracks = Pick<Timeline, "tracks">;

const LINK_TOLERANCE_SECONDS = 0.01;

const getClipAudioTrackIndex = (clip: Clip): number => clip.audioTrackIndex ?? 0;

const isAlignedLinkedClip = (clip: Clip, candidate: Clip): boolean =>
  candidate.id !== clip.id &&
  candidate.mediaId === clip.mediaId &&
  getClipAudioTrackIndex(candidate) === getClipAudioTrackIndex(clip) &&
  Math.abs(candidate.startTime - clip.startTime) < LINK_TOLERANCE_SECONDS &&
  Math.abs(candidate.inPoint - clip.inPoint) < LINK_TOLERANCE_SECONDS;

const getTrackTypePriority = (
  currentTrackType: Track["type"] | undefined,
  candidateTrackType: Track["type"],
): number => {
  if (currentTrackType === "audio") {
    if (candidateTrackType === "video") return 0;
    if (candidateTrackType === "image") return 1;
  }

  if (candidateTrackType === "audio") return 0;
  if (candidateTrackType === "video") return 1;
  if (candidateTrackType === "image") return 2;

  return 3;
};

export const findClipTrack = (
  timeline: TimelineWithTracks,
  clipId: string,
): { clip: Clip; track: Track } | null => {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return { clip, track };
    }
  }

  return null;
};

export const getLinkedAudioClips = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Array<{ clip: Clip; track: Track }> => {
  const currentTrack = timeline.tracks.find((track) => track.id === clip.trackId);
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

  return linkedClips.sort(
    (left, right) =>
      getTrackTypePriority(currentTrack?.type, left.track.type) -
      getTrackTypePriority(currentTrack?.type, right.track.type),
  );
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

export const resolveClipVolumeAutomation = (
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

export const resolveAudibleAudioTarget = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Clip => {
  if (clip.volume > 0) {
    return clip;
  }

  const linkedAudioClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => entry.track.type === "audio" && entry.clip.volume > 0,
  );

  return linkedAudioClip?.clip ?? clip;
};