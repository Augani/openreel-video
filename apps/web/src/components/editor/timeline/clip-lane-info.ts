import type { Clip, Track } from "@openreel/core";
import { findLinkedPartners, splitEditOffsets } from "@openreel/core";
import { getLinkedAudioClips } from "@openreel/core/audio/clip-audio-resolution";
import { getTrackBadge } from "./track-badge";

/**
 * Everything a ClipComponent renders that depends on OTHER clips or tracks
 * (linked audio, J/L-cut offsets, neighbour transitions, the lane badge).
 *
 * The lane computes this once per commit and hands each clip a primitive-only
 * object whose identity is preserved when nothing changed, so committing one
 * clip move re-renders that clip (and the clips whose derived info changed)
 * instead of every mounted clip receiving a new `tracks` array.
 */
export interface ClipLaneInfo {
  hasDetachedAudio: boolean;
  splitOffset: { start: number; end: number; partnerId: string } | null;
  leadingTransitionBadge: boolean;
  trailingTransitionBadge: boolean;
  trackBadge: string | undefined;
}

export interface LaneInfoInput {
  track: Track;
  allTracks: readonly Track[];
  frameRate: number;
  /** Media type of the clip ("video" | "audio" | "image" ...), after the audio-lane override. */
  mediaTypeOf: (clip: Clip) => string | undefined;
}

export function sameLaneInfo(a: ClipLaneInfo, b: ClipLaneInfo): boolean {
  return (
    a.hasDetachedAudio === b.hasDetachedAudio &&
    a.leadingTransitionBadge === b.leadingTransitionBadge &&
    a.trailingTransitionBadge === b.trailingTransitionBadge &&
    a.trackBadge === b.trackBadge &&
    (a.splitOffset === b.splitOffset ||
      (a.splitOffset !== null &&
        b.splitOffset !== null &&
        a.splitOffset.start === b.splitOffset.start &&
        a.splitOffset.end === b.splitOffset.end &&
        a.splitOffset.partnerId === b.splitOffset.partnerId))
  );
}

/** Previous-neighbour index of a lane, built once per `track.clips` array (a sort of the whole lane). */
const previousClipIndex = new WeakMap<readonly Clip[], Map<string, Clip | undefined>>();
function previousClipsOf(trackClips: readonly Clip[]): Map<string, Clip | undefined> {
  let index = previousClipIndex.get(trackClips);
  if (!index) {
    const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    index = new Map();
    sorted.forEach((clip, i) => index!.set(clip.id, i > 0 ? sorted[i - 1] : undefined));
    previousClipIndex.set(trackClips, index);
  }
  return index;
}

/** Info for every clip of `clips` (a lane's clips, usually the visible ones). */
export function computeLaneInfos(
  clips: readonly Clip[],
  { track, allTracks, frameRate, mediaTypeOf }: LaneInfoInput,
  previous?: ReadonlyMap<string, ClipLaneInfo>,
): Map<string, ClipLaneInfo> {
  const result = new Map<string, ClipLaneInfo>();
  const trackBadge = getTrackBadge(allTracks, track.id);
  const prevOf = previousClipsOf(track.clips);

  for (const clip of clips) {
    const mediaType = mediaTypeOf(clip);
    const isVideo = mediaType === "video";
    const isAudio = mediaType === "audio";

    const hasDetachedAudio =
      (isVideo &&
        getLinkedAudioClips(clip, { tracks: allTracks as Track[] }).some(
          ({ clip: linked, track: linkedTrack }) =>
            linkedTrack.type === "audio" || typeof linked.metadata?.separatedFromClipId === "string",
        )) ||
      (isVideo && findLinkedPartners(clip, allTracks).some(({ track: linkedTrack }) => linkedTrack.type === "audio"));

    const splitOffset = isAudio ? splitEditOffsets(clip, allTracks, frameRate) : null;

    let leadingTransitionBadge = false;
    let trailingTransitionBadge = false;
    if (!isAudio) {
      trailingTransitionBadge = track.transitions.some(
        (transition) =>
          transition.clipAId === clip.id && !transition.clipBId && (transition.edge ?? "out") === "out",
      );
      if (
        track.transitions.some(
          (transition) =>
            transition.clipAId === clip.id && !transition.clipBId && (transition.edge ?? "out") === "in",
        )
      ) {
        leadingTransitionBadge = true;
      } else {
        const prev = prevOf.get(clip.id);
        if (prev) {
          leadingTransitionBadge =
            Math.abs(clip.startTime - (prev.startTime + prev.duration)) < 0.05 ||
            track.transitions.some(
              (transition) => transition.clipBId === clip.id && transition.clipAId === prev.id,
            );
        }
      }
    }

    const next: ClipLaneInfo = {
      hasDetachedAudio,
      splitOffset,
      leadingTransitionBadge,
      trailingTransitionBadge,
      trackBadge,
    };
    const old = previous?.get(clip.id);
    result.set(clip.id, old && sameLaneInfo(old, next) ? old : next);
  }
  return result;
}
