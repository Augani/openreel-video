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

/** Where one audio channel group (A1..An of the source patch) goes. */
export interface AudioChannelDestination {
  /** 0-based index of the group in the source's channel layout (A1 = 0). */
  channel: number;
  choice: TrackChoice;
}

export interface MultichannelPatch extends SourcePatch {
  /** Track patched to each audio channel group; entry 0 mirrors `audio`. Absent / null = automatic. */
  channels?: readonly (string | null | undefined)[];
  /** Channel groups whose patch indicator is switched off: nothing is placed for them. */
  disabledChannels?: readonly boolean[];
}

export interface MultichannelSourceResolution {
  /** The picture (video and image sources, component both / video). */
  primary?: TrackChoice;
  /** One destination per enabled audio channel, in channel order. Never two on the same track. */
  audio: AudioChannelDestination[];
}

/**
 * Premiere's multichannel source patching. Each audio channel group of the source is patched to an audio track or
 * switched off. A patched group goes to its track (a track patched twice goes to the first group only); the others
 * cascade: group 0 follows targeting (targeted track, selected track, main track) and every later group takes the next
 * free unlocked audio track below the previous group's, then any free one, then a new audio track.
 * A group with no free track gets `{ kind: "create" }`; the caller creates those tracks one after another.
 *
 * `freeRange` makes the placement non-destructive (Add to timeline, a drop from the Project panel): a track that already
 * holds a clip inside the range is treated as taken, so the picture and every group land on free tracks or on new ones.
 */
export function resolveMultichannelSourceTracks(
  project: Project,
  input: {
    mediaType: "video" | "audio" | "image";
    component?: "both" | "video" | "audio";
    groupCount: number;
    patch?: MultichannelPatch;
    targetedTrackIds?: readonly string[];
    selectedTrackId?: string | null;
    freeRange?: { start: number; end: number };
  },
): MultichannelSourceResolution {
  const component = input.component ?? "both";
  const patch = input.patch ?? {};
  const common = { targetedTrackIds: input.targetedTrackIds, selectedTrackId: input.selectedTrackId };
  const wantsPicture = input.mediaType !== "audio" && component !== "audio";
  const wantsSound = input.mediaType === "audio" || (input.mediaType === "video" && component !== "video");
  const out: MultichannelSourceResolution = { audio: [] };
  const range = input.freeRange;
  const occupied = (track: Track): boolean =>
    !!range && track.clips.some((clip) => clip.startTime < range.end - 1e-6 && clip.startTime + clip.duration > range.start + 1e-6);
  if (wantsPicture) {
    const mediaKind = input.mediaType === "image" ? "image" : "video";
    const picture = chooseTrackForMedia(project, { ...common, mediaKind, targetTrackId: patch.video });
    out.primary = picture.kind === "existing" && occupied(picture.track) ? { kind: "create", trackType: mediaKind } : picture;
  }
  if (!wantsSound || input.groupCount <= 0) return out;

  const explicit = (channel: number): string | null | undefined => (channel === 0 ? (patch.channels?.[0] ?? patch.audio) : patch.channels?.[channel]);
  const enabled = (channel: number) => !(patch.disabledChannels?.[channel] === true);
  const tracks = project.timeline.tracks;
  const used = new Set<string>();
  const chosen = new Map<number, TrackChoice>();

  for (let channel = 0; channel < input.groupCount; channel++) {
    if (!enabled(channel)) continue;
    const track = tracks.find((candidate) => candidate.id === explicit(channel));
    if (canTargetTrack(track, "audio") && !used.has(track.id) && !occupied(track)) {
      used.add(track.id);
      chosen.set(channel, { kind: "existing", track });
    }
  }

  const audioTracks = tracks.filter((track) => track.type === "audio");
  const free = (track: Track) => canTargetTrack(track, "audio") && !used.has(track.id) && !occupied(track);
  let previous: Track | undefined;
  for (let channel = 0; channel < input.groupCount; channel++) {
    if (!enabled(channel)) continue;
    let choice = chosen.get(channel);
    if (!choice) {
      let track: Track | undefined;
      if (previous === undefined && channel === 0) {
        const first = chooseTrackForMedia(project, { ...common, mediaKind: "audio" });
        if (first.kind === "existing" && free(first.track)) track = first.track;
      } else if (previous) {
        const after = audioTracks.findIndex((candidate) => candidate.id === previous!.id);
        track = audioTracks.slice(after + 1).find(free);
      }
      track ??= audioTracks.find(free);
      if (track) choice = { kind: "existing", track };
      else {
        choice = { kind: "create", trackType: "audio" };
      }
      if (choice.kind === "existing") used.add(choice.track.id);
    }
    if (choice.kind === "existing") previous = choice.track;
    out.audio.push({ channel, choice });
  }
  return out;
}
