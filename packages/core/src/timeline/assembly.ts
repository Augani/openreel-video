import type { Clip, Track, Transition } from "../types/timeline";
import type { MediaItem, Project } from "../types/project";
import {
  createMediaClip,
  findMainTrack,
  planInsert,
  planOverwrite,
  type ClipPlacement,
  type NewTrackPlacement,
} from "../editing/premiere-edits";
import { subclipRange } from "../media/bins";
import { createSourceClip } from "../editing/source-edit";
import type { TimelineToolItemEdit, TimelineToolPlan } from "../editing/timeline-tool-edit";
import { buildTransitionAtCut, resolveDefaultTransition } from "../video/transition-presets";
import { getDefaultTransitionParams } from "../video/transition-default-params";

/**
 * Automate to Sequence (Premiere): the media selected in the Project panel is laid end to end from the playhead, in
 * selection / name / date order, as ONE insert or overwrite edit, optionally with the project's default video
 * transition between pictures and a matching audio fade between sounds. The result is a single timeline plan, so it
 * is one undo step and previews and exports exactly like clips placed by hand.
 */
export type AssemblyOrder = "selection" | "name" | "date";
export type AssemblyMethod = "insert" | "overwrite";

export interface AssemblyOptions {
  readonly order: AssemblyOrder;
  readonly method: AssemblyMethod;
  /** Where the first clip starts (the playhead), seconds. */
  readonly at: number;
  /** Length of a still image, seconds. */
  readonly stillDuration: number;
  /** Default video transition between adjacent pictures. */
  readonly videoTransition: boolean;
  /** Default audio transition (a fade out / fade in pair) between adjacent sounds. */
  readonly audioTransition: boolean;
  readonly ignoreVideo: boolean;
  readonly ignoreAudio: boolean;
  /** Seconds of empty timeline between consecutive clips (0 = back to back). Transitions are only made where clips touch. */
  readonly gap?: number;
}

export const DEFAULT_ASSEMBLY_OPTIONS: AssemblyOptions = {
  order: "selection",
  method: "insert",
  at: 0,
  stillDuration: 5,
  videoTransition: false,
  audioTransition: false,
  ignoreVideo: false,
  ignoreAudio: false,
  gap: 0,
};

export type AssemblyResult =
  | {
      readonly ok: true;
      readonly plan: TimelineToolPlan;
      /** Ordered media names that were placed. */
      readonly placed: readonly string[];
      /** Media that had nothing to place (ignored streams, placeholders, empty files). */
      readonly skipped: readonly string[];
      readonly start: number;
      readonly end: number;
      readonly videoClipIds: readonly string[];
      readonly audioClipIds: readonly string[];
      readonly transitionCount: number;
    }
  | { readonly ok: false; readonly message: string };

const EPS = 1e-6;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const importDate = (item: MediaItem): number => item.importedAt ?? item.sourceFile?.lastModified ?? 0;

/** The selected media in assembly order. `selectionIds` is the order the user selected them in. */
export function orderAssemblyMedia(items: readonly MediaItem[], selectionIds: readonly string[], order: AssemblyOrder): MediaItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const picked: MediaItem[] = [];
  const seen = new Set<string>();
  selectionIds.forEach((id) => {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      seen.add(id);
      picked.push(item);
    }
  });
  if (order === "selection") return picked;
  const position = new Map(picked.map((item, index) => [item.id, index]));
  const byName = (a: MediaItem, b: MediaItem) => collator.compare(a.name, b.name) || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
  return [...picked].sort(order === "name" ? byName : (a, b) => importDate(a) - importDate(b) || byName(a, b));
}

interface Piece {
  readonly media: MediaItem;
  video?: Clip;
  audio?: Clip;
  readonly offset: number;
  readonly duration: number;
}

const newTrack = (id: string, type: "video" | "audio", name: string): Track => ({
  id,
  type,
  name,
  role: "general",
  mode: "standard",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});

/**
 * Build the plan. Pictures go to the main video track, sounds to the main audio track (a track is created when the
 * project has none of that kind); a video file with sound places its picture and a linked audio clip.
 */
export function planAutomateToSequence(
  project: Project,
  media: readonly MediaItem[],
  options: AssemblyOptions,
  makeId: () => string = () => crypto.randomUUID(),
): AssemblyResult {
  if (!media.length) return { ok: false, message: "Select media in the Project panel first." };
  if (options.ignoreVideo && options.ignoreAudio) return { ok: false, message: "Ignore Audio and Ignore Video together leave nothing to place." };
  if (!(options.stillDuration > 0)) return { ok: false, message: "The still clip duration must be longer than zero." };
  const gap = Math.max(0, options.gap ?? 0);
  const at = Math.max(0, options.at);

  const videoTracks = project.timeline.tracks.filter((track) => track.type === "video");
  const audioTracks = project.timeline.tracks.filter((track) => track.type === "audio");
  const videoTrack = findMainTrack(project, "video");
  const audioTrack = findMainTrack(project, "audio");
  const newTracks: NewTrackPlacement[] = [];
  let videoTrackId = videoTrack?.id;
  let audioTrackId = audioTrack?.id;
  const needVideo = media.some((item) => item.type !== "audio") && !options.ignoreVideo;
  const needAudio = media.some((item) => item.type !== "image") && !options.ignoreAudio;
  if (needVideo && !videoTrackId) {
    if (videoTracks.length) return { ok: false, message: "Unlock a video track to place the clips on." };
    videoTrackId = `track-${makeId()}`;
    newTracks.push({ track: newTrack(videoTrackId, "video", "Video 1"), index: 0 });
  }
  if (needAudio && !audioTrackId) {
    if (audioTracks.length) return { ok: false, message: "Unlock an audio track to place the clips on." };
    audioTrackId = `track-${makeId()}`;
    newTracks.push({ track: newTrack(audioTrackId, "audio", "Audio 1") });
  }

  const pieces: Piece[] = [];
  const skipped: string[] = [];
  let cursor = 0;
  for (const item of media) {
    if (item.isPlaceholder) {
      skipped.push(item.name);
      continue;
    }
    const isImage = item.type === "image";
    const source = isImage ? { ...item, metadata: { ...item.metadata, duration: options.stillDuration } } : item;
    const wantsVideo = item.type !== "audio" && !options.ignoreVideo;
    const hasSound = item.type === "audio" || (item.type === "video" && item.metadata.hasAudio !== false);
    const wantsAudio = hasSound && !options.ignoreAudio;
    if ((!wantsVideo && !wantsAudio) || (isImage ? false : !(item.metadata.duration > 0))) {
      skipped.push(item.name);
      continue;
    }
    let video: Clip | undefined;
    let audio: Clip | undefined;
    try {
      if (wantsVideo && videoTrackId) {
        const id = makeId();
        const base = createSourceClip(source, videoTrackId, id, rangeOf(source), item.type === "video" && (wantsAudio || options.ignoreAudio) ? "video" : "both");
        video = base;
      }
      if (wantsAudio && audioTrackId) {
        const id = makeId();
        const base = item.type === "audio" ? createMediaClip(source, audioTrackId, id, rangeOf(source)) : createSourceClip(source, audioTrackId, id, rangeOf(source), "audio");
        audio = video ? { ...base, metadata: { ...base.metadata, separatedFromClipId: video.id } } : base;
      }
    } catch {
      skipped.push(item.name);
      continue;
    }
    const duration = (video ?? audio)?.duration ?? 0;
    if (!(duration > EPS)) {
      skipped.push(item.name);
      continue;
    }
    pieces.push({ media: item, video, audio, offset: cursor, duration });
    cursor += duration + gap;
  }
  if (!pieces.length) return { ok: false, message: "Nothing to place: every selected item was skipped." };

  // Audio fades at adjacent cuts: the default transition's length split over both sides of the cut.
  const fallback = resolveDefaultTransition(project);
  const touching = (a: Piece, b: Piece) => gap <= EPS && Math.abs(a.offset + a.duration - b.offset) <= EPS;
  if (options.audioTransition) {
    for (let index = 0; index < pieces.length - 1; index++) {
      const a = pieces[index];
      const b = pieces[index + 1];
      if (!a.audio || !b.audio || !touching(a, b)) continue;
      const length = Math.min(fallback.duration / 2, a.audio.duration / 2, b.audio.duration / 2);
      if (!(length > EPS)) continue;
      a.audio = { ...a.audio, fade: { fadeIn: a.audio.fade?.fadeIn ?? 0, fadeOut: length } };
      b.audio = { ...b.audio, fade: { fadeIn: length, fadeOut: b.audio.fade?.fadeOut ?? 0 } };
    }
  }

  const placements: ClipPlacement[] = [];
  for (const piece of pieces) {
    if (piece.video) placements.push({ trackId: piece.video.trackId, clip: piece.video, offset: piece.offset });
    if (piece.audio) placements.push({ trackId: piece.audio.trackId, clip: piece.audio, offset: piece.offset });
  }
  let plan: TimelineToolPlan;
  try {
    const build = options.method === "insert" ? planInsert : planOverwrite;
    plan = build(project, at, placements, makeId(), newTracks.length ? newTracks : undefined);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The edit failed." };
  }

  const transitions: Transition[] = [];
  if (options.videoTransition) {
    const params = { ...getDefaultTransitionParams(fallback.type), ...fallback.params };
    for (let index = 0; index < pieces.length - 1; index++) {
      const a = pieces[index].video;
      const b = pieces[index + 1].video;
      if (!a || !b || !touching(pieces[index], pieces[index + 1])) continue;
      transitions.push(buildTransitionAtCut({ type: fallback.type, duration: fallback.duration, params }, a, b, `transition-${makeId()}`));
    }
  }
  const baseCount = new Map(project.timeline.tracks.map((track) => [track.id, track.transitions.length]));
  const transitionEdits: TimelineToolItemEdit[] = transitions.map((transition, index) => {
    const trackId = pieces.find((piece) => piece.video?.id === transition.clipAId)?.video?.trackId ?? videoTrackId ?? "";
    return { kind: "transition", id: transition.id, trackId, index: (baseCount.get(trackId) ?? 0) + index, before: null, after: transition };
  });

  const last = pieces[pieces.length - 1];
  return {
    ok: true,
    plan: { ...plan, label: "Automate to Sequence", edits: [...plan.edits, ...transitionEdits] },
    placed: pieces.map((piece) => piece.media.name),
    skipped,
    start: at,
    end: at + last.offset + last.duration,
    videoClipIds: pieces.flatMap((piece) => (piece.video ? [piece.video.id] : [])),
    audioClipIds: pieces.flatMap((piece) => (piece.audio ? [piece.audio.id] : [])),
    transitionCount: transitions.length,
  };
}

function rangeOf(item: MediaItem): { inPoint: number; outPoint: number } {
  // A subclip places its own window of the file; anything else its whole length.
  const window = subclipRange(item);
  return window ? { inPoint: window.start, outPoint: window.end } : { inPoint: 0, outPoint: item.metadata.duration > 0 ? item.metadata.duration : 5 };
}
