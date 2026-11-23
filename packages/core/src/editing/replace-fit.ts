import type { Clip, Project, Track } from "../types";
import type { MediaItem } from "../types/project";
import { clipFieldsForGroup, resolveSourceChannelGroups } from "../audio/source-channels";
import { getCompoundClipId } from "../timeline/timeline-items";
import { subclipRange } from "../media/bins";
import { diffPlan, planOverwrite, findTopmostVisualClipAt } from "./premiere-edits";
import {
  boundSourceMarks,
  createSourceClip,
  multichannelPlacements,
  sourceDropError,
  type SourceComponent,
  type SourceEditRequest,
} from "./source-edit";
import { findLinkedPartners } from "./split-edit";
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN } from "./speed-limits";
import type { TimelineToolPlan } from "./timeline-tool-edit";

/**
 * Premiere's two remaining Source-monitor edit commands.
 *
 *  - Replace edit swaps the media of ONE timeline clip for the Source monitor's
 *    clip. The timeline clip keeps its position, duration and (optionally) its
 *    effects and keyframes; only the footage under it changes. Nothing moves,
 *    so Sync Lock has nothing to ripple; locked tracks are refused.
 *  - Fit to Fill places the source In/Out range into the sequence In/Out range
 *    and retimes it (speed = source length / sequence length). It is an
 *    overwrite-type edit, so it touches only its destination tracks. Audio
 *    follows the clip speed through the existing pitch-preserving path
 *    (Clip.pitchCorrection defaults to on).
 *
 * Both return one TimelineToolPlan, i.e. one undo step.
 */
const EPS = 1e-6;

/* ------------------------------ Fit to Fill ------------------------------ */

export interface FitToFillRequest
  extends Omit<SourceEditRequest, "mode" | "playhead" | "sequenceIn" | "sequenceOut"> {
  sequenceIn: number;
  sequenceOut: number;
}

export interface ResolvedFitToFill {
  at: number;
  sourceIn: number;
  sourceOut: number;
  /** Timeline length: the whole sequence range. */
  duration: number;
  /** Playback rate applied to the clip (1 = unchanged, 2 = twice as fast). */
  speed: number;
  rule: "fit-to-fill";
}

export interface FitToFillPlan {
  plan: TimelineToolPlan;
  resolved: ResolvedFitToFill;
  clip: Clip;
}

const pct = (speed: number) => `${Math.round(speed * 1000) / 10}%`;

/** The speed Fit to Fill needs, or the reason it cannot be done. */
export function resolveFitToFill(input: {
  mediaDuration: number;
  sourceIn?: number | null;
  sourceOut?: number | null;
  sequenceIn: number;
  sequenceOut: number;
}): ResolvedFitToFill {
  const media = input.mediaDuration > 0 ? input.mediaDuration : 5;
  const has = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (!has(input.sequenceIn) || !has(input.sequenceOut))
    throw new Error("Fit to Fill needs In and Out marks on the timeline.");
  const span = input.sequenceOut - input.sequenceIn;
  if (input.sequenceIn < 0 || span <= EPS)
    throw new Error("The sequence Out must be after the sequence In.");
  const a = has(input.sourceIn) ? Math.max(0, Math.min(media, input.sourceIn)) : 0;
  const b = has(input.sourceOut) ? Math.max(0, Math.min(media, input.sourceOut)) : media;
  if (b - a <= EPS) throw new Error("The source Out must be after the source In.");
  const speed = (b - a) / span;
  if (speed < CLIP_SPEED_MIN - 1e-9 || speed > CLIP_SPEED_MAX + 1e-9)
    throw new Error(
      `Fit to Fill needs ${pct(speed)} speed; clips play between ${pct(CLIP_SPEED_MIN)} and ${pct(CLIP_SPEED_MAX)}. Adjust the source range or the timeline range.`,
    );
  return {
    at: input.sequenceIn,
    sourceIn: a,
    sourceOut: b,
    duration: span,
    speed: Math.abs(speed - 1) < 1e-6 ? 1 : speed,
    rule: "fit-to-fill",
  };
}

export function planFitToFill(project: Project, request: FitToFillRequest): FitToFillPlan {
  if (request.media.type === "image")
    throw new Error("Fit to Fill needs video or audio; a still has no speed to change.");
  const marks = boundSourceMarks(request.media, request.sourceIn, request.sourceOut);
  const resolved = resolveFitToFill({
    mediaDuration: request.media.metadata.duration,
    sourceIn: marks.sourceIn,
    sourceOut: marks.sourceOut,
    sequenceIn: request.sequenceIn,
    sequenceOut: request.sequenceOut,
  });
  const range = { inPoint: resolved.sourceIn, outPoint: resolved.sourceOut };
  const retime = (clip: Clip): Clip => ({
    ...clip,
    duration: resolved.duration,
    ...(resolved.speed !== 1 ? { speed: resolved.speed } : {}),
  });
  if (request.audioChannels?.length) {
    // A source whose audio expands to several channel-group clips: picture plus one retimed sound clip per patched group.
    const { placements, picture, sounds, newTracks } = multichannelPlacements(request, range, request.component ?? "both", retime);
    const plan = planOverwrite(project, resolved.at, placements, request.operationId, newTracks.length ? newTracks : undefined);
    const first = (picture ?? sounds[0]) as Clip;
    return { plan: { ...plan, label: "Fit to Fill" }, resolved, clip: { ...first, startTime: resolved.at } };
  }
  const split =
    request.audioPatch !== undefined &&
    (request.component ?? "both") === "both" &&
    request.media.type === "video" &&
    request.media.metadata.hasAudio !== false;
  const clip = retime(
    createSourceClip(
      request.media,
      request.trackId,
      request.clipId,
      range,
      split ? "video" : request.component,
    ),
  );
  const placements = [{ trackId: request.trackId, clip }];
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
      clip: retime({
        ...sound,
        metadata: { ...sound.metadata, separatedFromClipId: request.clipId },
      }),
    });
  }
  const newTracks = [request.newTrack, split ? request.audioPatch?.newTrack : undefined].filter(
    (track): track is NonNullable<typeof track> => track !== undefined,
  );
  const plan = planOverwrite(
    project,
    resolved.at,
    placements,
    request.operationId,
    newTracks.length ? newTracks : undefined,
  );
  return { plan: { ...plan, label: "Fit to Fill" }, resolved, clip: { ...clip, startTime: resolved.at } };
}

/* ------------------------------ Replace edit ----------------------------- */

/** Which source frame lines up with which timeline frame:
 *  - "playhead": the Source monitor's current frame sits under the timeline
 *    playhead (Premiere's Replace from Source Monitor);
 *  - "in": the source In (media start when unmarked) sits at the clip's first
 *    frame (Premiere's Replace using the In point). */
export type ReplaceAlignment = "playhead" | "in";

export interface ReplaceEditRequest {
  clipId: string;
  media: MediaItem;
  alignment: ReplaceAlignment;
  /** Timeline playhead, for the "playhead" alignment. */
  playhead: number;
  /** Source monitor position, for the "playhead" alignment. */
  sourcePosition: number;
  sourceIn?: number | null;
  /** Keep the clip's effects, keyframes, transform, audio settings, fades,
   * blend and colour. Off resets them to a fresh clip's defaults. */
  keepAttributes: boolean;
  component?: SourceComponent;
}

export interface ResolvedReplace {
  clipId: string;
  /** Linked clips (e.g. the audio of a video clip) replaced together. */
  linkedClipIds: string[];
  at: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  alignment: ReplaceAlignment;
  /** True when "playhead" fell back to the In point because the playhead is
   * outside the clip. */
  fellBackToIn: boolean;
}

export interface ReplaceEditPlan {
  plan: TimelineToolPlan;
  resolved: ResolvedReplace;
}

/** Fields that describe how the OLD footage plays and cannot carry over. */
const FOOTAGE_BOUND_KEYS = [
  "speed",
  "reversed",
  "smoothSlowMo",
  "timeInterpolation",
  "interpolationQuality",
  "speedKeyframes",
  "freezeFrames",
  "stabilization",
  "audioTrackIndex",
  "pitchCorrection",
] as const satisfies readonly (keyof Clip)[];

function findClipIn(project: Project, clipId: string): { clip: Clip; track: Track } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

const lengthOf = (media: Pick<MediaItem, "metadata">) =>
  media.metadata.duration > 0 ? media.metadata.duration : 5;

/** The component a replacement clip carries: a video-only/audio-only clip stays
 * that way; a video source on an audio track is sound only. */
function componentFor(old: Clip, track: Track, media: MediaItem, requested?: SourceComponent): SourceComponent {
  const kept = old.metadata?.sourceMonitorComponent;
  if (media.type === "video" && (kept === "video" || kept === "audio")) return kept;
  if (media.type === "video" && track.type === "audio") return "audio";
  return requested ?? "both";
}

/**
 * Which clip a Replace edit acts on: the selected media clip, else the topmost
 * clip under the playhead (on the targeted tracks when any are targeted; audio
 * sources look at audio tracks). Returns null when nothing qualifies.
 */
export function findReplaceTarget(
  project: Project,
  options: {
    media: Pick<MediaItem, "type">;
    selectedClipIds: readonly string[];
    playhead: number;
    targetedTrackIds?: readonly string[];
  },
): Clip | null {
  for (let i = options.selectedClipIds.length - 1; i >= 0; i--) {
    const found = findClipIn(project, options.selectedClipIds[i]);
    if (found) return found.clip;
  }
  if (options.media.type === "audio") {
    const only = options.targetedTrackIds?.length ? new Set(options.targetedTrackIds) : null;
    for (const track of project.timeline.tracks) {
      if (track.type !== "audio" || track.hidden || (only && !only.has(track.id))) continue;
      const clip = track.clips.find(
        (c) => c.startTime <= options.playhead + EPS && options.playhead < c.startTime + c.duration - EPS,
      );
      if (clip) return clip;
    }
    return null;
  }
  const visualTargets = (options.targetedTrackIds ?? []).filter((id) => {
    const type = project.timeline.tracks.find((t) => t.id === id)?.type;
    return type === "video" || type === "image";
  });
  return findTopmostVisualClipAt(project, options.playhead, visualTargets);
}

export function planReplaceEdit(project: Project, request: ReplaceEditRequest): ReplaceEditPlan {
  const found = findClipIn(project, request.clipId);
  if (!found) throw new Error("Select the timeline clip to replace first.");
  const { clip: target, track } = found;
  if (getCompoundClipId(target)) throw new Error("Nested sequences cannot be replaced with a source clip.");
  const media = request.media;
  const duration = target.duration;
  const imageSource = media.type === "image";
  const window = boundSourceMarks(media, request.sourceIn, null);
  const total = lengthOf(media);

  let sourceIn: number;
  let fellBackToIn = false;
  const inside =
    request.playhead >= target.startTime - EPS && request.playhead < target.startTime + duration - EPS;
  if (imageSource) {
    sourceIn = 0;
  } else if (request.alignment === "playhead" && inside) {
    sourceIn = request.sourcePosition - Math.max(0, request.playhead - target.startTime);
  } else {
    fellBackToIn = request.alignment === "playhead";
    sourceIn = window.sourceIn ?? 0;
  }
  if (sourceIn < -EPS)
    throw new Error("Not enough source before the aligned frame. Move the Source playhead later or use the In point.");
  sourceIn = Math.max(0, sourceIn);
  const sourceOut = imageSource ? duration : sourceIn + duration;
  if (!imageSource && sourceOut > total + 1e-4)
    throw new Error(
      `The source has ${Math.max(0, total - sourceIn).toFixed(2)}s from that point; the clip is ${duration.toFixed(2)}s. Choose an earlier In or Source playhead.`,
    );
  const locked = media.subclip?.restrictTrims ? subclipRange(media) : null;
  if (locked && !imageSource && (sourceIn < locked.start - EPS || sourceOut > locked.end + EPS))
    throw new Error("This subclip is restricted; the replacement would play outside its In/Out.");

  const replaceOne = (old: Clip, oldTrack: Track): Clip => {
    if (oldTrack.locked) throw new Error("Unlock the target track before editing.");
    const component = componentFor(old, oldTrack, media, request.component);
    const refusal = sourceDropError(oldTrack, media, component);
    if (refusal) throw new Error(refusal);
    const range = { inPoint: sourceIn, outPoint: Math.min(sourceOut, total) };
    const fresh = imageSource
      ? createSourceClip(media, oldTrack.id, old.id, { inPoint: 0, outPoint: Math.min(total, duration) }, component)
      : createSourceClip(media, oldTrack.id, old.id, range, component);
    const link = old.metadata?.separatedFromClipId;
    const sizing = { startTime: old.startTime, duration: old.duration, inPoint: sourceIn, outPoint: sourceOut };
    // Multichannel source patching: a sound clip keeps its slot (A1..An) in the new source's channel layout, so replacing the
    // A2 clip of one multichannel file with another plays the new file's second group. The old clip's channel map and stream
    // described the OLD footage and never carry over.
    const groups = !imageSource && component !== "video" ? resolveSourceChannelGroups(media) : [];
    const slot = typeof old.metadata?.sourceChannelGroup === "number" ? old.metadata.sourceChannelGroup : 0;
    const group = groups.length > 1 ? groups[Math.min(Math.max(0, Math.floor(slot)), groups.length - 1)] : undefined;
    const patched = group ? { ...clipFieldsForGroup(group, media) } : {};
    const slotMetadata = group ? { sourceChannelGroup: groups.indexOf(group) } : {};
    if (!request.keepAttributes) {
      return {
        ...fresh,
        ...sizing,
        ...patched,
        ...(old.label !== undefined ? { label: old.label } : {}),
        metadata: {
          ...fresh.metadata,
          ...slotMetadata,
          ...(typeof link === "string" ? { separatedFromClipId: link } : {}),
        },
      };
    }
    const kept: Record<string, unknown> = { ...old };
    for (const key of FOOTAGE_BOUND_KEYS) delete kept[key];
    delete kept.channelMap;
    const keptMetadata = { ...old.metadata };
    delete keptMetadata.sourceMonitorComponent;
    delete keptMetadata.sourceChannelGroup;
    return {
      ...(kept as unknown as Clip),
      ...sizing,
      ...patched,
      mediaId: media.id,
      metadata: { ...keptMetadata, ...slotMetadata, ...(fresh.metadata?.sourceMonitorComponent ? { sourceMonitorComponent: fresh.metadata.sourceMonitorComponent } : {}) },
      // A component change (video-only to audio-only) still mutes or hides.
      ...(component === "video" ? { volume: 0 } : {}),
      ...(component === "audio" ? { transform: { ...old.transform, opacity: 0 } } : {}),
    };
  };

  const replaced = new Map<string, Clip>();
  replaced.set(target.id, replaceOne(target, track));
  const linkedClipIds: string[] = [];
  if (media.type !== "image" && media.metadata.hasAudio !== false) {
    for (const partner of findLinkedPartners(target, project.timeline.tracks)) {
      const sameSpan =
        Math.abs(partner.clip.startTime - target.startTime) < EPS &&
        Math.abs(partner.clip.duration - target.duration) < EPS;
      if (!sameSpan || partner.clip.mediaId !== target.mediaId) continue;
      replaced.set(partner.clip.id, replaceOne(partner.clip, partner.track));
      linkedClipIds.push(partner.clip.id);
    }
  }

  const work: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t) =>
        t.clips.some((c) => replaced.has(c.id))
          ? { ...t, clips: t.clips.map((c) => replaced.get(c.id) ?? c) }
          : t,
      ),
    },
  };
  return {
    plan: diffPlan(project, work, "Replace"),
    resolved: {
      clipId: target.id,
      linkedClipIds,
      at: target.startTime,
      duration,
      sourceIn,
      sourceOut,
      alignment: request.alignment,
      fellBackToIn,
    },
  };
}
