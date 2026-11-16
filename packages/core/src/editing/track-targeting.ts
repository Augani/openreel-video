import type { Project, Track } from "../types";

export type TargetMediaKind = "video" | "audio" | "image";

export interface TrackTargetingInput {
  mediaKind: TargetMediaKind;
  /** The user's explicit source-patch target for this kind (Premiere's V1/A1). */
  targetTrackId?: string | null;
  /** The track of the current timeline selection, if any. */
  selectedTrackId?: string | null;
  /** Tracks whose target toggle is on (Premiere's V1/A1 targeting), any order. */
  targetedTrackIds?: readonly string[];
}

export type TrackChoice =
  | { kind: "existing"; track: Track }
  | { kind: "create"; trackType: TargetMediaKind };

/** Track types that can hold a media kind, best first. Images prefer image
 * tracks but sit happily on video tracks, as in Premiere. */
function acceptedTypes(kind: TargetMediaKind): Track["type"][] {
  if (kind === "audio") return ["audio"];
  if (kind === "image") return ["image", "video"];
  return ["video"];
}

/** Whether a track can currently receive media of this kind. */
export function canTargetTrack(
  track: Track | undefined,
  kind: TargetMediaKind,
): track is Track {
  return !!track && !track.locked && acceptedTypes(kind).includes(track.type);
}

/**
 * The main track of a kind: the base track the sequence is built on. Video
 * stacks upward (index 0 is the front-most layer), so the main video track is
 * the bottom-most one, preferring a track named "Main". Audio prefers the
 * dialogue track, then the first audio track.
 */
export function findMainTrack(
  project: Project,
  kind: TargetMediaKind,
): Track | null {
  for (const type of acceptedTypes(kind)) {
    const ofType = project.timeline.tracks.filter((track) => track.type === type);
    // A locked track explicitly named Main/V1/A1 is not silently replaced by an
    // overlay lane: the caller reports that the main track is unavailable.
    const named = ofType.find((track) =>
      /^(main|v1|a1)$/i.test(track.name.trim()),
    );
    if (named?.locked) return null;
    const candidates = ofType.filter((track) => !track.locked);
    if (!candidates.length) continue;
    if (kind === "audio")
      return (
        candidates.find((track) => track.role === "dialogue") ?? candidates[0]
      );
    return (
      candidates.find((track) => track.name.toLowerCase() === "main") ??
      candidates[candidates.length - 1]
    );
  }
  return null;
}

/** Premiere-style source patching: the explicit patch, else the first targeted
 * track that can take the media (timeline order), else the selected track,
 * else the main track; a new track when none can take the media. */
export function chooseTrackForMedia(
  project: Project,
  input: TrackTargetingInput,
): TrackChoice {
  const byId = (id?: string | null) =>
    id ? project.timeline.tracks.find((track) => track.id === id) : undefined;
  const explicit = byId(input.targetTrackId);
  if (canTargetTrack(explicit, input.mediaKind))
    return { kind: "existing", track: explicit };
  const targeted = input.targetedTrackIds?.length
    ? project.timeline.tracks.find(
        (track) =>
          input.targetedTrackIds!.includes(track.id) &&
          canTargetTrack(track, input.mediaKind),
      )
    : undefined;
  if (targeted) return { kind: "existing", track: targeted };
  const selected = byId(input.selectedTrackId);
  if (canTargetTrack(selected, input.mediaKind))
    return { kind: "existing", track: selected };
  const main = findMainTrack(project, input.mediaKind);
  if (main) return { kind: "existing", track: main };
  return { kind: "create", trackType: input.mediaKind };
}

/** A new empty standard track for a placement that found no suitable one.
 * Visual tracks go above the first audio track; audio tracks go last. */
export function createEmptyTrack(
  project: Project,
  trackType: TargetMediaKind,
  id: string,
): { track: Track; index: number } {
  const tracks = project.timeline.tracks;
  const label =
    trackType === "audio" ? "Audio" : trackType === "image" ? "Image" : "Video";
  const firstAudio = tracks.findIndex((track) => track.type === "audio");
  const index =
    trackType === "audio" || firstAudio === -1 ? tracks.length : firstAudio;
  return {
    index,
    track: {
      id,
      type: trackType,
      mode: "standard",
      role: "general",
      name: `${label} ${tracks.filter((t) => t.type === trackType).length + 1}`,
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    },
  };
}

/** Source patch: which timeline track receives each source component. */
export interface SourcePatch {
  video?: string | null;
  audio?: string | null;
}

export interface SourceTrackResolution {
  /** Where the picture (or the whole clip when not split) goes. */
  primary: TrackChoice;
  /** Set when the source's video and audio go to different tracks. */
  audio?: TrackChoice;
}

/**
 * Resolve the destination tracks for a source monitor edit. A video source
 * with sound whose audio is patched to an audio track yields two destinations
 * (picture and sound); everything else yields one, chosen by
 * chooseTrackForMedia (patch, then targeted track, selection, main track).
 */
export function resolveSourceTracks(
  project: Project,
  input: {
    mediaType: "video" | "audio" | "image";
    hasAudio?: boolean;
    component?: "both" | "video" | "audio";
    patch?: SourcePatch;
    targetedTrackIds?: readonly string[];
    selectedTrackId?: string | null;
  },
): SourceTrackResolution {
  const component = input.component ?? "both";
  const patch = input.patch ?? {};
  const common = {
    targetedTrackIds: input.targetedTrackIds,
    selectedTrackId: input.selectedTrackId,
  };
  const audioKind =
    input.mediaType === "audio" ||
    (input.mediaType === "video" && component === "audio");
  if (audioKind)
    return {
      primary: chooseTrackForMedia(project, {
        ...common,
        mediaKind: "audio",
        targetTrackId: patch.audio,
      }),
    };
  const mediaKind: TargetMediaKind =
    input.mediaType === "image" ? "image" : "video";
  const primary = chooseTrackForMedia(project, {
    ...common,
    mediaKind,
    targetTrackId: patch.video,
  });
  const audioTrack = patch.audio
    ? project.timeline.tracks.find((track) => track.id === patch.audio)
    : undefined;
  if (
    input.mediaType === "video" &&
    component === "both" &&
    input.hasAudio !== false &&
    canTargetTrack(audioTrack, "audio")
  )
    return { primary, audio: { kind: "existing", track: audioTrack } };
  return { primary };
}
