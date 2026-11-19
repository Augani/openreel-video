import { subclipRange } from "../media/bins";
import type { Clip, Project, Track } from "../types";
import type { MediaItem } from "../types/project";
import { canTargetTrack, type TargetMediaKind } from "./track-targeting";
import {
  createMediaClip,
  planInsert,
  planOverwrite,
  type ClipPlacement,
  type NewTrackPlacement,
} from "./premiere-edits";
import type { TimelineToolPlan } from "./timeline-tool-edit";

/**
 * Source-monitor edits: Insert / Overwrite of a marked source range, with
 * Premiere's three-point editing rules.
 *
 * An edit has four marks: source In/Out and sequence In/Out. Any three fix it;
 * the playhead stands in for a missing sequence In. Implemented cases (a
 * missing source In/Out defaults to the start/end of the media):
 *
 *  1. "source-range-at-playhead"  - source In+Out, no sequence marks: place the
 *     range at the playhead (the classic two-point edit).
 *  2. "source-range-at-sequence-in" - source In+Out + sequence In: the range
 *     starts at the sequence In.
 *  3. "source-range-ends-at-sequence-out" - source In+Out + sequence Out: the
 *     range is back-timed so it ENDS at the sequence Out.
 *  4. "fit-source-in" - source In (Out unmarked) + sequence In+Out: the source
 *     Out is derived from the sequence length (Fit by sequence range).
 *  5. "fit-source-out" - source Out (In unmarked) + sequence In+Out: the source
 *     In is derived, back-timed so the clip ends at the sequence Out.
 *  6. "fit-media" - no source marks + sequence In+Out: from the media start.
 *  7. "four-point" - all four marks: the SOURCE range wins and is placed at the
 *     sequence In (Premiere's "Ignore Sequence Out Point"); no speed change.
 *
 * If the source runs out before the sequence range is filled, the clip is
 * shorter than the range (never padded or retimed).
 */
const EPS = 1e-6;

export type ThreePointRule =
  | "source-range-at-playhead"
  | "source-range-at-sequence-in"
  | "source-range-ends-at-sequence-out"
  | "fit-source-in"
  | "fit-source-out"
  | "fit-media"
  | "four-point";

export interface ThreePointInput {
  mediaDuration: number;
  sourceIn?: number | null;
  sourceOut?: number | null;
  playhead: number;
  sequenceIn?: number | null;
  sequenceOut?: number | null;
}

export interface ResolvedSourceEdit {
  /** Timeline time the clip starts at. */
  at: number;
  sourceIn: number;
  sourceOut: number;
  duration: number;
  rule: ThreePointRule;
}

const has = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function resolveThreePointEdit(input: ThreePointInput): ResolvedSourceEdit {
  const media = input.mediaDuration > 0 ? input.mediaDuration : 5;
  const clamp = (v: number) => Math.max(0, Math.min(media, v));
  const sIn = has(input.sourceIn) ? clamp(input.sourceIn) : null;
  const sOut = has(input.sourceOut) ? clamp(input.sourceOut) : null;
  if (sIn !== null && sOut !== null && sOut - sIn <= EPS)
    throw new Error("The source Out must be after the source In.");
  const qIn = has(input.sequenceIn) ? Math.max(0, input.sequenceIn) : null;
  const qOut = has(input.sequenceOut) ? Math.max(0, input.sequenceOut) : null;
  if (qIn !== null && qOut !== null && qOut - qIn <= EPS)
    throw new Error("The sequence Out must be after the sequence In.");
  const finish = (
    at: number,
    a: number,
    b: number,
    rule: ThreePointRule,
  ): ResolvedSourceEdit => {
    if (b - a <= EPS) throw new Error("The source range has no duration.");
    return { at: Math.max(0, at), sourceIn: a, sourceOut: b, duration: b - a, rule };
  };

  if (qIn !== null && qOut !== null) {
    const span = qOut - qIn;
    if (sIn !== null && sOut !== null)
      return finish(qIn, sIn, sOut, "four-point");
    if (sIn !== null)
      return finish(qIn, sIn, Math.min(media, sIn + span), "fit-source-in");
    if (sOut !== null) {
      const a = Math.max(0, sOut - span);
      return finish(qOut - (sOut - a), a, sOut, "fit-source-out");
    }
    return finish(qIn, 0, Math.min(media, span), "fit-media");
  }

  const a = sIn ?? 0;
  const b = sOut ?? media;
  const length = b - a;
  if (qIn !== null) return finish(qIn, a, b, "source-range-at-sequence-in");
  if (qOut !== null) {
    const start = qOut - length;
    // Not enough room before 0: trim the head of the range instead.
    if (start < 0) return finish(0, a - start, b, "source-range-ends-at-sequence-out");
    return finish(start, a, b, "source-range-ends-at-sequence-out");
  }
  return finish(input.playhead, a, b, "source-range-at-playhead");
}

/** Which streams of the source a placement carries. */
export type SourceComponent = "both" | "video" | "audio";

/** The track kind a source placement needs: video-only/both land on visual
 * tracks, audio media and audio-only on audio tracks. */
export function sourceTargetKind(
  media: Pick<MediaItem, "type">,
  component: SourceComponent = "both",
): TargetMediaKind {
  if (media.type === "audio" || (media.type === "video" && component === "audio"))
    return "audio";
  return media.type === "image" ? "image" : "video";
}

/** Why a source range cannot be placed on this track, or null when it can.
 * Text/graphics lanes, locked tracks and the wrong stream kind are refused. */
export function sourceDropError(
  track: Track | undefined,
  media: Pick<MediaItem, "type">,
  component: SourceComponent = "both",
): string | null {
  if (!track) return "Drop onto a timeline track.";
  if (track.locked) return "Unlock the target track before editing.";
  const kind = sourceTargetKind(media, component);
  if (canTargetTrack(track, kind)) return null;
  return kind === "audio"
    ? "Audio can only be placed on an audio track."
    : "Video and images can only be placed on a video track.";
}

export interface SourceEditRequest {
  mode: "insert" | "overwrite";
  media: MediaItem;
  /** Track the clip lands on (video track for both/video, audio track for audio). */
  trackId: string;
  clipId: string;
  operationId: string;
  sourceIn?: number | null;
  sourceOut?: number | null;
  playhead: number;
  sequenceIn?: number | null;
  sequenceOut?: number | null;
  component?: SourceComponent;
  newTrack?: NewTrackPlacement;
  /**
   * Source patching: when a video source with audio is patched to a video track
   * AND an audio track, the edit places two linked clips, the picture on
   * `trackId` and the sound here. Only honoured for component "both".
   */
  audioPatch?: { trackId: string; clipId: string; newTrack?: NewTrackPlacement };
}

export interface SourceEditPlan {
  plan: TimelineToolPlan;
  resolved: ResolvedSourceEdit;
  clip: Clip;
}

/** The clip for a source range, narrowed to one stream when asked: video-only
 * mutes the clip; audio-only (a video source on an audio track) is invisible. */
export function createSourceClip(
  media: MediaItem,
  trackId: string,
  id: string,
  range: { inPoint: number; outPoint: number },
  component: SourceComponent = "both",
): Clip {
  const base = createMediaClip(media, trackId, id, range);
  if (component === "both" || media.type !== "video") return base;
  const metadata = { ...base.metadata, sourceMonitorComponent: component };
  return component === "video"
    ? { ...base, volume: 0, metadata }
    : { ...base, transform: { ...base.transform, opacity: 0 }, metadata };
}

/** The source marks an edit works from: a subclip places its own window when
 * the Source monitor has no marks, and a restricted subclip never places
 * outside it. */
export function boundSourceMarks(
  media: MediaItem,
  sourceIn?: number | null,
  sourceOut?: number | null,
): { sourceIn: number | undefined; sourceOut: number | undefined } {
  const window = subclipRange(media);
  const restricted = media.subclip?.restrictTrims ? window : null;
  const bound = (value: number | null | undefined, fallback: number | undefined) => {
    const v = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return v !== undefined && restricted ? Math.min(restricted.end, Math.max(restricted.start, v)) : v;
  };
  return { sourceIn: bound(sourceIn, window?.start), sourceOut: bound(sourceOut, window?.end) };
}

export function planSourceEdit(
  project: Project,
  request: SourceEditRequest,
): SourceEditPlan {
  const marks = boundSourceMarks(request.media, request.sourceIn, request.sourceOut);
  const resolved = resolveThreePointEdit({
    mediaDuration: request.media.metadata.duration,
    sourceIn: marks.sourceIn,
    sourceOut: marks.sourceOut,
    playhead: request.playhead,
    sequenceIn: request.sequenceIn,
    sequenceOut: request.sequenceOut,
  });
  const split =
    request.audioPatch !== undefined &&
    (request.component ?? "both") === "both" &&
    request.media.type === "video" &&
    request.media.metadata.hasAudio !== false;
  const range = { inPoint: resolved.sourceIn, outPoint: resolved.sourceOut };
  const clip = createSourceClip(
    request.media,
    request.trackId,
    request.clipId,
    range,
    split ? "video" : request.component,
  );
  const placements: ClipPlacement[] = [{ trackId: request.trackId, clip }];
  if (split && request.audioPatch) {
    const sound = createSourceClip(
      request.media,
      request.audioPatch.trackId,
      request.audioPatch.clipId,
      range,
      "audio",
    );
    placements.push({
      trackId: request.audioPatch.trackId,
      clip: {
        ...sound,
        metadata: { ...sound.metadata, separatedFromClipId: request.clipId },
      },
    });
  }
  const newTracks = [request.newTrack, split ? request.audioPatch?.newTrack : undefined].filter(
    (track): track is NewTrackPlacement => track !== undefined,
  );
  const build = request.mode === "insert" ? planInsert : planOverwrite;
  const plan = build(
    project,
    resolved.at,
    placements,
    request.operationId,
    newTracks.length ? newTracks : undefined,
  );
  return { plan, resolved, clip: { ...clip, startTime: resolved.at } };
}
