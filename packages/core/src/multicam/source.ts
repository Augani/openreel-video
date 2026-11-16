/**
 * Premiere-style multi-camera editing.
 *
 * MODEL
 * -----
 * A `MulticamSource` (stored on `project.multicamSources`) is a set of 2 to 9
 * synchronised camera angles. Each angle is a media item plus an `offset`: the
 * shared-timeline time at which that media's own time 0 plays. A sound heard at
 * media time `m` is therefore at shared time `m + offset`, on every angle.
 *
 * A multicam clip is an ordinary video clip of ONE angle's media, tagged with
 * `metadata.multicam = { sourceId, angleId }`. Its shared time at the clip's
 * start is `clip.inPoint + angle.offset`, which is all that is needed to move
 * the clip to another angle (`switchMulticamAngle`) or to cut it
 * (`recordMulticamCuts`). Because the cut is plain clips, sync lock, nests,
 * the export queue, smart render and the render cache all see exactly what
 * they always saw: a source segment (smart render may stream-copy it only when
 * its existing grid test proves the frames identical), and an angle switch
 * changes `mediaId`/`inPoint`, which is what the render cache keys on.
 *
 * Editing never adds or removes time (overwrite semantics), so it needs no
 * sync-lock planner. Every function is pure and returns a new Project; the
 * caller commits the result as ONE undo step (`project/applyEditSnapshot`).
 */
import type { Clip, Track, Transform } from "../types/timeline";
import type { Project } from "../types/project";
import { resolveTimelinePlacement } from "../timeline/timeline-placement";
import { splitAt } from "../editing/premiere-edits";
import {
  fixedAudioClipFromRun,
  fixedAudioRuns,
  isMulticamNonlinear,
  type MulticamClipRef,
  getMulticamSource,
  getMulticamSources,
  listMulticamClips,
  makeTrack,
  mapClips,
  multicamAudioTag,
  multicamTag,
  replaceTracks,
  sharedTimeAt,
} from "./fixed-audio";

export {
  fixedAudioClipFromRun,
  fixedAudioClipId,
  fixedAudioRuns,
  getMulticamSource,
  getMulticamSources,
  listMulticamClips,
  multicamAudioTag,
  isMulticamNonlinear,
  isMulticamRetimed,
  multicamClipSourceTime,
  multicamRetimeOf,
  multicamTag,
  reconcileMulticamAudio,
  sharedTimeAt,
  type FixedAudioRun,
  type MulticamRetime,
  type MulticamClipRef,
} from "./fixed-audio";

export const MAX_MULTICAM_ANGLES = 9;
export const MULTICAM_ANGLE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#94a3b8",
] as const;

export type MulticamSyncMethod = "audio" | "timecode" | "in-points" | "markers" | "manual";

export interface MulticamAngle {
  readonly id: string;
  readonly name: string;
  readonly mediaId: string;
  /** Shared-timeline time at which this media's time 0 plays (seconds). */
  readonly offset: number;
  /** Media duration (seconds). */
  readonly duration: number;
  readonly color: string;
}

export type MulticamAudioMode =
  | { readonly mode: "follow" }
  | { readonly mode: "fixed"; readonly angleId: string };

export interface MulticamSource {
  readonly id: string;
  readonly name: string;
  readonly angles: readonly MulticamAngle[];
  readonly syncMethod: MulticamSyncMethod;
  /** 0..1 per angle id for audio sync; absent for other methods. */
  readonly confidence?: Readonly<Record<string, number>>;
  readonly audio: MulticamAudioMode;
  readonly createdAt: number;
}

export interface MulticamClipTag {
  readonly sourceId: string;
  readonly angleId: string;
}

const EPS = 1e-6;
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

/** The multicam clip that is on screen at `time` (topmost video track wins). */
export function multicamClipAtTime(project: Project, time: number): (MulticamClipRef & { sharedTime: number }) | null {
  const refs = listMulticamClips(project).filter(
    (ref) => time >= ref.clip.startTime - EPS && time < ref.clip.startTime + ref.clip.duration - EPS,
  );
  if (refs.length === 0) return null;
  const trackOrder = new Map(project.timeline.tracks.map((track, index) => [track.id, index]));
  refs.sort((a, b) => (trackOrder.get(a.track.id) ?? 0) - (trackOrder.get(b.track.id) ?? 0));
  const ref = refs[0];
  return { ...ref, sharedTime: sharedTimeAt(ref.clip, ref.angle, time) };
}

/** Shared-time range in which every angle has footage. */
export function multicamCommonRange(source: Pick<MulticamSource, "angles">): { start: number; end: number } | null {
  if (source.angles.length === 0) return null;
  const start = Math.max(...source.angles.map((a) => a.offset));
  const end = Math.min(...source.angles.map((a) => a.offset + a.duration));
  return end - start > EPS ? { start, end } : null;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface AngleSyncInput {
  readonly mediaId: string;
  /** Audio correlation: offset of this angle relative to the first angle (see audio-sync.ts). */
  readonly audioOffset?: number;
  /** Start timecode of the media in seconds (a time of day, e.g. 01:00:00:00 = 3600). */
  readonly timecode?: number;
  /** In point in the angle's own media time (clip in point, or a marked In). */
  readonly inPoint?: number;
  /** A marker time in the angle's own media time. */
  readonly marker?: number;
}

export type AngleOffsetResult =
  | { readonly ok: true; readonly offsets: number[] }
  | { readonly ok: false; readonly message: string };

/**
 * Offsets (shared time of each media's time 0) for `method`, normalised so the
 * earliest angle starts at 0. Angle 0 is the reference.
 */
export function computeAngleOffsets(method: MulticamSyncMethod, inputs: readonly AngleSyncInput[]): AngleOffsetResult {
  if (inputs.length === 0) return { ok: false, message: "Choose at least two angles." };
  const raw: number[] = [];
  const need = (value: number | undefined, what: string, index: number): number => {
    if (value === undefined || !Number.isFinite(value)) throw new Error(`Angle ${index + 1} has no ${what}.`);
    return value;
  };
  try {
    inputs.forEach((input, index) => {
      switch (method) {
        case "audio":
          raw.push(index === 0 ? 0 : need(input.audioOffset, "audio offset (analyse the audio first)", index));
          break;
        case "timecode":
          raw.push(need(input.timecode, "start timecode", index) - need(inputs[0].timecode, "start timecode", 0));
          break;
        case "in-points":
          raw.push(need(inputs[0].inPoint, "in point", 0) - need(input.inPoint, "in point", index));
          break;
        case "markers":
          raw.push(need(inputs[0].marker, "marker", 0) - need(input.marker, "marker", index));
          break;
        case "manual":
          raw.push(input.audioOffset ?? 0);
          break;
      }
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not sync the angles." };
  }
  const min = Math.min(...raw);
  return { ok: true, offsets: raw.map((value) => value - min) };
}

// ---------------------------------------------------------------------------
// Creating a source
// ---------------------------------------------------------------------------

export interface NewMulticamAngle {
  readonly mediaId: string;
  readonly name?: string;
  /** Offset on the shared timeline (use `computeAngleOffsets`). */
  readonly offset: number;
}

export interface CreateMulticamSourceOptions {
  readonly name?: string;
  readonly angles: readonly NewMulticamAngle[];
  readonly syncMethod: MulticamSyncMethod;
  readonly confidence?: readonly number[];
  /**
   * Audio mode of the new source. Angle ids do not exist yet at creation, so a
   * fixed audio angle is named by its media id.
   */
  readonly audio?: { readonly mode: "follow" } | { readonly mode: "fixed"; readonly mediaId: string };
}

export type MulticamEditResult =
  | { readonly ok: true; readonly project: Project; readonly sourceId?: string; readonly clipId?: string; readonly trackId?: string }
  | { readonly ok: false; readonly message: string };

export function createMulticamSource(project: Project, options: CreateMulticamSourceOptions): MulticamEditResult {
  if (options.angles.length < 2) return fail("A multi-camera source needs at least two angles.");
  if (options.angles.length > MAX_MULTICAM_ANGLES) return fail(`A multi-camera source supports at most ${MAX_MULTICAM_ANGLES} angles (one per number key).`);
  const seen = new Set<string>();
  const angles: MulticamAngle[] = [];
  for (const [index, entry] of options.angles.entries()) {
    const media = project.mediaLibrary.items.find((item) => item.id === entry.mediaId);
    if (!media) return fail(`Angle ${index + 1}: its media is missing.`);
    if (media.type !== "video") return fail(`Angle ${index + 1} (${media.name}) is not a video clip.`);
    if (seen.has(media.id)) return fail(`${media.name} is used for two angles.`);
    if (!Number.isFinite(entry.offset)) return fail(`Angle ${index + 1} has an invalid sync offset.`);
    if (!(media.metadata.duration > 0)) return fail(`${media.name} has no known duration.`);
    seen.add(media.id);
    angles.push({
      id: newId("angle"),
      name: entry.name?.trim() || media.name.replace(/\.[^.]+$/, ""),
      mediaId: media.id,
      offset: entry.offset,
      duration: media.metadata.duration,
      color: MULTICAM_ANGLE_COLORS[index % MULTICAM_ANGLE_COLORS.length],
    });
  }
  if (!multicamCommonRange({ angles })) return fail("The synced angles do not overlap in time.");
  const sources = getMulticamSources(project);
  const name = options.name?.trim() || `Multicam ${sources.length + 1}`;
  const requested = options.audio;
  const audio: MulticamAudioMode =
    requested?.mode === "fixed"
      ? { mode: "fixed", angleId: (angles.find((a) => a.mediaId === requested.mediaId) ?? angles[0]).id }
      : { mode: "follow" };
  const confidence = options.confidence
    ? Object.fromEntries(angles.map((angle, i) => [angle.id, options.confidence?.[i] ?? 0]))
    : undefined;
  const source: MulticamSource = {
    id: newId("mcsrc"),
    name,
    angles,
    syncMethod: options.syncMethod,
    ...(confidence ? { confidence } : {}),
    audio,
    createdAt: Date.now(),
  };
  return { ok: true, project: { ...project, multicamSources: [...sources, source] }, sourceId: source.id };
}

/** Replace the stored offsets of a source (manual nudge / re-sync). */
export function setMulticamAngleOffsets(project: Project, sourceId: string, offsets: Readonly<Record<string, number>>): MulticamEditResult {
  const source = getMulticamSource(project, sourceId);
  if (!source) return fail("That multi-camera source no longer exists.");
  if (listMulticamClips(project, sourceId).length > 0) return fail("Flatten or delete the clips that use this source before changing its sync.");
  const angles = source.angles.map((a) => (offsets[a.id] !== undefined ? { ...a, offset: offsets[a.id] } : a));
  if (!multicamCommonRange({ angles })) return fail("The synced angles do not overlap in time.");
  return { ok: true, project: { ...project, multicamSources: getMulticamSources(project).map((s) => (s.id === sourceId ? { ...s, angles } : s)) } };
}

// ---------------------------------------------------------------------------
// Clip construction
// ---------------------------------------------------------------------------

const snap = (value: number, fps: number): number => Math.round(value * fps) / fps;

export interface InsertMulticamOptions {
  readonly sourceId: string;
  readonly startTime: number;
  /** First angle shown; default the source's first angle. */
  readonly angleId?: string;
  /** Preferred video track; a free track is used (or created) when it is busy. */
  readonly trackId?: string;
  /** Shared-time range to place; default the whole common range. */
  readonly sharedStart?: number;
  readonly sharedEnd?: number;
}

/**
 * Place the source on a video track as one multicam clip (angle `angleId`).
 * Overwrite semantics on a free track: no time is added or removed anywhere.
 */
export function insertMulticamClip(input: Project, options: InsertMulticamOptions): MulticamEditResult {
  const source = getMulticamSource(input, options.sourceId);
  if (!source) return fail("That multi-camera source no longer exists.");
  const range = multicamCommonRange(source);
  if (!range) return fail("The synced angles do not overlap in time.");
  const angle = options.angleId ? source.angles.find((a) => a.id === options.angleId) : source.angles[0];
  if (!angle) return fail("That angle is not part of the source.");
  const fps = input.settings.frameRate > 0 ? input.settings.frameRate : 30;
  const a = Math.max(range.start, options.sharedStart ?? range.start);
  const b = Math.min(range.end, options.sharedEnd ?? range.end);
  const duration = Math.floor((b - a) * fps + 1e-6) / fps;
  if (!(duration > 0)) return fail("There is no footage shared by every angle in that range.");
  if (!Number.isFinite(options.startTime)) return fail("The start time is not a number.");
  const startTime = Math.max(0, snap(options.startTime, fps));

  const tracks = input.timeline.tracks;
  const preferred =
    (options.trackId && tracks.find((t) => t.id === options.trackId)) ||
    tracks.find((t) => t.type === "video" && !t.locked) ||
    null;
  let project = input;
  let trackId: string;
  if (!preferred) {
    trackId = newId("track");
    project = replaceTracks(project, [makeTrack(trackId, "video", "Video 1"), ...tracks]);
  } else {
    const placement = resolveTimelinePlacement(project, {
      targetTrackId: preferred.id,
      startTime,
      duration,
      policy: "stack-above",
    });
    if (!placement.ok) return fail(placement.reason === "track-locked" ? "Unlock the target track first." : "No track is free for the multicam clip.");
    trackId = placement.trackId;
    if (placement.createdTrack) {
      const created = makeTrack(placement.trackId, "video", `Multicam ${tracks.filter((t) => t.type === "video").length + 1}`);
      const next = [...tracks];
      next.splice(placement.createdTrack.position, 0, created);
      project = replaceTracks(project, next);
    }
  }
  const inPoint = a - angle.offset;
  const clip: Clip = {
    id: newId("clip"),
    mediaId: angle.mediaId,
    trackId,
    startTime,
    duration,
    inPoint,
    outPoint: inPoint + duration,
    effects: [],
    audioEffects: [],
    transform: IDENTITY_TRANSFORM,
    volume: 1,
    keyframes: [],
    metadata: { multicam: { sourceId: source.id, angleId: angle.id } },
  };
  project = replaceTracks(
    project,
    project.timeline.tracks.map((track) => (track.id === trackId ? { ...track, clips: [...track.clips, clip].sort((x, y) => x.startTime - y.startTime) } : track)),
  );
  if (source.audio.mode === "fixed") project = rebuildMulticamAudio(project, source.id, source.audio);
  return { ok: true, project, clipId: clip.id, trackId };
}

// ---------------------------------------------------------------------------
// Angle switching and recording
// ---------------------------------------------------------------------------

function retarget(clip: Clip, source: MulticamSource, from: MulticamAngle, to: MulticamAngle): Clip | string {
  // Speed, reverse and ramps play a fixed span of source footage (outPoint - inPoint), so an
  // angle switch moves that whole span by the offset difference and keeps every retime field.
  const span = clip.outPoint - clip.inPoint;
  const inPoint = clip.inPoint + from.offset - to.offset;
  if (inPoint < -EPS || inPoint + span > to.duration + EPS) {
    return `${to.name} has no footage for this part of the shot.`;
  }
  const safeIn = Math.max(0, inPoint);
  return {
    ...clip,
    mediaId: to.mediaId,
    inPoint: safeIn,
    outPoint: safeIn + span,
    metadata: { ...clip.metadata, multicam: { sourceId: source.id, angleId: to.id } },
  };
}

/** Move one or more multicam clips to another angle, keeping every frame in sync. */
export function switchMulticamAngle(input: Project, clipIds: readonly string[], angleId: string): MulticamEditResult {
  if (clipIds.length === 0) return fail("Select a multicam clip.");
  const ids = new Set(clipIds);
  const known = new Set(input.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  if ([...ids].some((id) => !known.has(id))) return fail("A selected clip is no longer on the timeline.");
  let error: string | null = null;
  const project = mapClips(input, (clip, track) => {
    if (!ids.has(clip.id) || error) return clip;
    const tag = multicamTag(clip);
    if (!tag) {
      error = "That clip is not a multicam clip.";
      return clip;
    }
    if (track.locked) {
      error = "Unlock the track before switching its angle.";
      return clip;
    }
    const source = getMulticamSource(input, tag.sourceId);
    const from = source?.angles.find((a) => a.id === tag.angleId);
    const to = source?.angles.find((a) => a.id === angleId);
    if (!source || !from) {
      error = "The multicam source of this clip no longer exists.";
      return clip;
    }
    if (!to) {
      error = "That angle is not part of the clip's multicam source.";
      return clip;
    }
    if (to.id === from.id) return clip;
    const moved = retarget(clip, source, from, to);
    if (typeof moved === "string") {
      error = moved;
      return clip;
    }
    return moved;
  });
  if (error) return fail(error);
  return { ok: true, project };
}

export interface MulticamCut {
  /** Timeline time the angle starts (seconds). */
  readonly time: number;
  readonly angleId: string;
}

export interface RecordCutsOptions {
  readonly cuts: readonly MulticamCut[];
  /** Timeline time the recording pass ended; the last cut runs until here. */
  readonly endTime: number;
  readonly sourceId?: string;
}

/**
 * Apply one live-recording pass: each cut switches the multicam clips under it
 * to its angle until the next cut (or `endTime`). Splits happen only where a
 * cut lands inside a clip. One call is one undo step.
 */
export function recordMulticamCuts(input: Project, options: RecordCutsOptions): MulticamEditResult {
  const fps = input.settings.frameRate > 0 ? input.settings.frameRate : 30;
  if (!Number.isFinite(options.endTime) || options.cuts.some((cut) => !Number.isFinite(cut.time))) return fail("Every cut time and the end time must be finite numbers.");
  const cuts = [...options.cuts].sort((x, y) => x.time - y.time).map((cut) => ({ ...cut, time: Math.max(0, snap(cut.time, fps)) }));
  if (cuts.length === 0) return fail("No cuts were recorded.");
  const endTime = snap(options.endTime, fps);
  if (!(endTime > cuts[0].time)) return fail("The recording pass is too short to cut.");
  const refs = listMulticamClips(input, options.sourceId);
  if (refs.length === 0) return fail("Place a multicam clip on the timeline before recording cuts.");
  if (refs.some((ref) => ref.track.locked)) return fail("Unlock the multicam track before recording.");
  const trackIds = [...new Set(refs.map((ref) => ref.track.id))];
  if (refs.some((ref) => isMulticamNonlinear(ref.clip) && [...cuts.map((cut) => cut.time), endTime].some((time) => time > ref.clip.startTime + EPS && time < ref.clip.startTime + ref.clip.duration - EPS)))
    return fail("A cut can't land inside a multicam clip with a speed ramp or freeze frame. Cut first, then add the ramp, or switch the whole clip's angle.");

  const intervals = cuts
    .map((cut, index) => ({ angleId: cut.angleId, a: cut.time, b: Math.min(endTime, cuts[index + 1]?.time ?? endTime) }))
    .filter((x) => x.b - x.a > EPS);
  if (intervals.length === 0) return fail("The recorded cuts are all on the same frame.");
  let work = input;
  const counter = { n: 0 };
  const opId = `mcrec-${crypto.randomUUID()}`;
  const boundaries = [...new Set(intervals.flatMap((interval) => [interval.a, interval.b]))].sort((x, y) => x - y);
  for (const time of boundaries) work = splitAt(work, trackIds, time, opId, counter);

  let touched = 0;
  for (const interval of intervals) {
    const ids = listMulticamClips(work, options.sourceId)
      .filter((ref) => ref.clip.startTime >= interval.a - EPS && ref.clip.startTime + ref.clip.duration <= interval.b + EPS)
      .map((ref) => ref.clip.id);
    if (ids.length === 0) continue;
    const result = switchMulticamAngle(work, ids, interval.angleId);
    if (!result.ok) return result;
    work = result.project;
    touched += ids.length;
  }
  if (touched === 0) return fail("The recorded cuts do not overlap any multicam clip.");
  for (const id of new Set(listMulticamClips(work, options.sourceId).map((ref) => ref.source.id))) {
    const source = getMulticamSource(work, id);
    if (source?.audio.mode === "fixed") work = rebuildMulticamAudio(work, id, source.audio);
  }
  return { ok: true, project: work };
}

// ---------------------------------------------------------------------------
// Audio mode
// ---------------------------------------------------------------------------

function mapTracks(project: Project, fn: (track: Track) => Track): Project {
  let changed = false;
  const tracks = project.timeline.tracks.map((track) => {
    const next = fn(track);
    if (next !== track) changed = true;
    return next;
  });
  return changed ? { ...project, timeline: { ...project.timeline, tracks } } : project;
}

/**
 * Apply an audio mode to a source's clips. "follow": every multicam clip plays
 * its own angle's audio. "fixed": one angle supplies the sound for the whole
 * cut on a dedicated audio track and the video clips are silenced.
 */
export function rebuildMulticamAudio(input: Project, sourceId: string, mode: MulticamAudioMode): Project {
  const source = getMulticamSource(input, sourceId);
  if (!source) return input;
  // Drop the fixed-audio clips this source created earlier.
  let project = mapTracks(input, (track) => {
    const clips = track.clips.filter((clip) => multicamAudioTag(clip) !== sourceId);
    return clips.length === track.clips.length ? track : { ...track, clips };
  });
  const refs = listMulticamClips(project, sourceId);
  const fixedAngle = mode.mode === "fixed" ? source.angles.find((a) => a.id === mode.angleId) : undefined;
  const volume = fixedAngle ? 0 : 1;
  project = mapClips(project, (clip) => (multicamTag(clip)?.sourceId === sourceId && clip.volume !== volume ? { ...clip, volume } : clip));
  if (fixedAngle && refs.length > 0) {
    const audioTrackId = project.timeline.tracks.find((t) => t.type === "audio" && t.name === "Multicam Audio")?.id ?? newId("track");
    const clips: Clip[] = fixedAudioRuns(refs, fixedAngle).map((run, index) => fixedAudioClipFromRun(run, fixedAngle, audioTrackId, sourceId, index));
    if (clips.length > 0) {
      const existing = project.timeline.tracks.find((t) => t.id === audioTrackId);
      project = replaceTracks(
        project,
        existing
          ? project.timeline.tracks.map((t) => (t.id === audioTrackId ? { ...t, clips: [...t.clips, ...clips] } : t))
          : [...project.timeline.tracks, { ...makeTrack(audioTrackId, "audio", "Multicam Audio"), clips }],
      );
    }
  }
  return { ...project, multicamSources: getMulticamSources(project).map((s) => (s.id === sourceId ? { ...s, audio: mode } : s)) };
}

export function setMulticamAudioMode(project: Project, sourceId: string, mode: MulticamAudioMode): MulticamEditResult {
  const source = getMulticamSource(project, sourceId);
  if (!source) return fail("That multi-camera source no longer exists.");
  if (mode.mode === "fixed" && !source.angles.some((a) => a.id === mode.angleId)) return fail("Choose one of the source's angles for the audio.");
  if (project.timeline.tracks.some((t) => t.locked && t.clips.some((c) => multicamTag(c)?.sourceId === sourceId || multicamAudioTag(c) === sourceId)))
    return fail("Unlock the multicam tracks first.");
  return { ok: true, project: rebuildMulticamAudio(project, sourceId, mode) };
}

// ---------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------

function stripTags(clip: Clip): Clip {
  const { multicam: _tag, multicamAudio: _audio, ...rest } = (clip.metadata ?? {}) as Record<string, unknown>;
  void _tag;
  void _audio;
  return { ...clip, metadata: Object.keys(rest).length ? rest : undefined };
}

/**
 * Flatten multicam clips to their active angle: the clips stay exactly as they
 * are (same frames, same audio) and lose the multicam tag, so they are plain
 * clips of that angle's media. With `clipIds` only those clips are flattened;
 * otherwise every multicam clip of `sourceId` (or of every source).
 */
export function flattenMulticam(input: Project, options: { clipIds?: readonly string[]; sourceId?: string } = {}): MulticamEditResult {
  const ids = options.clipIds ? new Set(options.clipIds) : null;
  const flattened = new Set<string>();
  let locked = false;
  let project = mapClips(input, (clip, track) => {
    const tag = multicamTag(clip);
    if (!tag) return clip;
    if (options.sourceId && tag.sourceId !== options.sourceId) return clip;
    if (ids && !ids.has(clip.id)) return clip;
    if (track.locked) {
      locked = true;
      return clip;
    }
    flattened.add(tag.sourceId);
    return stripTags(clip);
  });
  if (locked) return fail("Unlock the multicam track before flattening.");
  if (flattened.size === 0) return fail("There are no multicam clips to flatten.");
  // Fixed-audio clips of a source with no multicam video left become plain clips too.
  const remaining = new Set(listMulticamClips(project).map((ref) => ref.source.id));
  project = mapClips(project, (clip) => {
    const audioOf = multicamAudioTag(clip);
    return audioOf && flattened.has(audioOf) && !remaining.has(audioOf) ? stripTags(clip) : clip;
  });
  return { ok: true, project };
}

/** Remove a source that no timeline clip uses any more. */
export function deleteMulticamSource(project: Project, sourceId: string): MulticamEditResult {
  if (!getMulticamSource(project, sourceId)) return fail("That multi-camera source no longer exists.");
  const used = project.timeline.tracks.some((t) => t.clips.some((c) => multicamTag(c)?.sourceId === sourceId));
  if (used) return fail("Flatten the clips that use this source first.");
  const rest = getMulticamSources(project).filter((s) => s.id !== sourceId);
  const { multicamSources: _old, ...without } = project;
  void _old;
  return { ok: true, project: rest.length ? { ...project, multicamSources: rest } : (without as Project) };
}
