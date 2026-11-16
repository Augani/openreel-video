/**
 * Fixed-angle multicam audio is DERIVED from the multicam picture clips. This
 * module holds the small, dependency-light part of multicam/source.ts that the
 * action executor needs after every action, undo and redo to keep that audio
 * sample-locked to the picture, so the executor (and therefore the app's
 * entry chunk) does not pull in the whole multicam editing module.
 */
import type { Clip, Track, Transform } from "../types/timeline";
import type { Project } from "../types/project";
import { calculateProjectDuration } from "../timeline/project-duration";
import { SpeedEngine } from "../video/speed-engine";
import type { MulticamAngle, MulticamClipTag, MulticamSource } from "./source";

const EPS = 1e-6;
const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

export function getMulticamSources(project: Pick<Project, "multicamSources">): readonly MulticamSource[] {
  return project.multicamSources ?? [];
}

export function getMulticamSource(project: Pick<Project, "multicamSources">, id: string): MulticamSource | undefined {
  return getMulticamSources(project).find((source) => source.id === id);
}

/** The multicam tag of a clip, or null for ordinary clips. */
export function multicamTag(clip: Pick<Clip, "metadata">): MulticamClipTag | null {
  const tag = clip.metadata?.multicam as Partial<MulticamClipTag> | undefined;
  return tag && typeof tag.sourceId === "string" && typeof tag.angleId === "string"
    ? { sourceId: tag.sourceId, angleId: tag.angleId }
    : null;
}

/** Source id of a fixed-audio clip created by multicam, or null. */
export function multicamAudioTag(clip: Pick<Clip, "metadata">): string | null {
  const id = clip.metadata?.multicamAudio;
  return typeof id === "string" ? id : null;
}

/** The playback-rate fields a derived audio clip must share with its picture clip. */
export interface MulticamRetime {
  readonly speed?: number;
  readonly reversed?: boolean;
  readonly speedKeyframes?: Clip["speedKeyframes"];
  readonly freezeFrames?: Clip["freezeFrames"];
  readonly pitchCorrection?: boolean;
}

type RetimeFields = Pick<Clip, "speed" | "reversed" | "speedKeyframes" | "freezeFrames" | "pitchCorrection">;

/** True when the clip plays at anything other than 1x forward (constant speed, reverse, ramp or freeze). */
export function isMulticamRetimed(clip: Partial<RetimeFields>): boolean {
  return (clip.speed ?? 1) !== 1 || clip.reversed === true || !!clip.speedKeyframes?.length || !!clip.freezeFrames?.length;
}

/** A clip with a speed ramp or freeze frames: its source time is not linear in timeline time. */
export function isMulticamNonlinear(clip: Partial<RetimeFields>): boolean {
  return !!clip.speedKeyframes?.length || !!clip.freezeFrames?.length;
}

/** The retime fields of a picture clip, only the ones that are set. */
export function multicamRetimeOf(clip: Partial<RetimeFields>): MulticamRetime {
  return {
    ...(clip.speed !== undefined && clip.speed !== 1 ? { speed: clip.speed } : {}),
    ...(clip.reversed ? { reversed: true } : {}),
    ...(clip.speedKeyframes?.length ? { speedKeyframes: clip.speedKeyframes } : {}),
    ...(clip.freezeFrames?.length ? { freezeFrames: clip.freezeFrames } : {}),
    ...(isMulticamRetimed(clip) && clip.pitchCorrection !== undefined ? { pitchCorrection: clip.pitchCorrection } : {}),
  };
}

/** Replace a clip's retime fields with exactly `retime` (clearing any it does not carry). */
export function withMulticamRetime(clip: Clip, retime: MulticamRetime): Clip {
  const { speed: _s, reversed: _r, speedKeyframes: _k, freezeFrames: _f, pitchCorrection: _p, ...rest } = clip;
  void _s; void _r; void _k; void _f; void _p;
  return { ...rest, ...retime } as Clip;
}

const retimeKey = (retime: MulticamRetime): string => JSON.stringify(retime);

/** Source-time (within the clip's own media) shown at timeline `time`, honouring speed, reverse, ramps and freezes. */
export function multicamClipSourceTime(clip: Pick<Clip, "id" | "inPoint" | "outPoint" | "startTime" | "duration"> & Partial<RetimeFields>, time: number): number {
  const local = Math.max(0, Math.min(clip.duration, time - clip.startTime));
  if (!isMulticamRetimed(clip)) return clip.inPoint + local;
  const span = clip.outPoint - clip.inPoint;
  const engine = new SpeedEngine();
  engine.setClipSpeed(clip.id, Math.abs(clip.speed ?? 1), span);
  engine.setReverse(clip.id, clip.reversed === true || (clip.speed ?? 1) < 0, span);
  for (const key of clip.speedKeyframes ?? []) engine.addSpeedKeyframe(clip.id, key.time, key.speed, key.easing);
  for (const freeze of clip.freezeFrames ?? []) engine.createFreezeFrame(clip.id, freeze.sourceTime, freeze.startTime, freeze.duration);
  return clip.inPoint + engine.getSourceTimeAtPlaybackTime(clip.id, local);
}

export interface MulticamClipRef {
  readonly clip: Clip;
  readonly track: Track;
  readonly source: MulticamSource;
  readonly angle: MulticamAngle;
}

/** Every tagged video clip of the live timeline, in timeline order. */
export function listMulticamClips(project: Project, sourceId?: string): MulticamClipRef[] {
  const out: MulticamClipRef[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const tag = multicamTag(clip);
      if (!tag || (sourceId && tag.sourceId !== sourceId)) continue;
      const source = getMulticamSource(project, tag.sourceId);
      const angle = source?.angles.find((a) => a.id === tag.angleId);
      if (source && angle) out.push({ clip, track, source, angle });
    }
  }
  return out.sort((a, b) => a.clip.startTime - b.clip.startTime);
}

/** Shared time shown by a multicam clip at timeline time `time` (speed, reverse and ramps included). */
export function sharedTimeAt(
  clip: Pick<Clip, "inPoint" | "startTime"> & Partial<Pick<Clip, "id" | "outPoint" | "duration"> & RetimeFields>,
  angle: Pick<MulticamAngle, "offset">,
  time: number,
): number {
  if (!isMulticamRetimed(clip) || clip.outPoint === undefined || clip.duration === undefined) return clip.inPoint + (time - clip.startTime) + angle.offset;
  return multicamClipSourceTime({ ...clip, id: clip.id ?? "multicam", outPoint: clip.outPoint, duration: clip.duration }, time) + angle.offset;
}

export function replaceTracks(project: Project, tracks: Track[]): Project {
  const next: Project = { ...project, timeline: { ...project.timeline, tracks } };
  return { ...next, timeline: { ...next.timeline, duration: Math.max(project.timeline.duration, calculateProjectDuration(next)) } };
}

export function mapClips(project: Project, fn: (clip: Clip, track: Track) => Clip): Project {
  let changed = false;
  const tracks = project.timeline.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      const next = fn(clip, track);
      if (next !== clip) trackChanged = true;
      return next;
    });
    if (!trackChanged) return track;
    changed = true;
    return { ...track, clips };
  });
  return changed ? replaceTracks(project, tracks) : project;
}

export function makeTrack(id: string, type: Track["type"], name: string): Track {
  return { id, type, name, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

/**
 * Derived audio clips get deterministic ids (source + position in the cut), so
 * the same picture always derives the same clips and undo/redo restores them
 * exactly instead of minting new ids on every re-derivation.
 */
export const fixedAudioClipId = (sourceId: string, index: number): string => `mcaudio_${sourceId}_${index}`;

export interface FixedAudioRun {
  readonly start: number;
  readonly duration: number;
  readonly inPoint: number;
  readonly outPoint: number;
  /** Speed / reverse / ramp fields shared with the picture; empty for 1x forward. */
  readonly retime: MulticamRetime;
}

interface RawRun {
  start: number;
  end: number;
  /** Shared-time range of source footage the run plays (low..high, direction-independent). */
  sharedLow: number;
  sharedHigh: number;
  retime: MulticamRetime;
  key: string;
  nonlinear: boolean;
}

/**
 * The fixed-angle audio a source's video clips imply: one run per stretch of
 * video that is contiguous BOTH on the timeline and in shared time (a moved,
 * slipped or re-trimmed clip breaks shared-time continuity and so starts a new
 * run), clamped to the footage the audio angle has. Derived purely from the
 * video clips, which is what keeps the sound sample-locked to them.
 *
 * Retimed pictures keep their rate on the audio: constant speed and reverse
 * merge across cuts when the two pieces continue each other in source time in
 * the playback direction; ramped / frozen clips stay one-to-one with their
 * picture (a ramp is relative to its own clip) and are dropped, not guessed,
 * where the audio angle lacks footage.
 */
export function fixedAudioRuns(refs: readonly MulticamClipRef[], fixedAngle: MulticamAngle): FixedAudioRun[] {
  const raw: RawRun[] = [];
  for (const ref of [...refs].sort((a, b) => a.clip.startTime - b.clip.startTime)) {
    const clip = ref.clip;
    const retime = multicamRetimeOf(clip);
    const nonlinear = isMulticamNonlinear(clip);
    const rate = Math.max(1e-9, Math.abs(clip.speed ?? 1));
    const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
    let start = clip.startTime;
    const end = start + clip.duration;
    let sharedLow = clip.inPoint + ref.angle.offset;
    let sharedHigh = clip.outPoint + ref.angle.offset;
    const last = raw[raw.length - 1];
    // Overlapping video on a higher track: the earlier run keeps the overlap.
    if (last && start < last.end && !nonlinear) {
      const trimmed = Math.min(end, last.end) - start;
      start += trimmed;
      if (reversed) sharedHigh -= trimmed * rate;
      else sharedLow += trimmed * rate;
    }
    if (end - start <= EPS) continue;
    const key = retimeKey(retime);
    const continuous =
      last &&
      !last.nonlinear &&
      !nonlinear &&
      last.key === key &&
      Math.abs(start - last.end) <= EPS &&
      (reversed ? Math.abs(sharedHigh - last.sharedLow) <= EPS : Math.abs(sharedLow - last.sharedHigh) <= EPS);
    if (continuous) {
      last.end = end;
      if (reversed) last.sharedLow = sharedLow;
      else last.sharedHigh = sharedHigh;
    } else raw.push({ start, end, sharedLow, sharedHigh, retime, key, nonlinear });
  }
  const runs: FixedAudioRun[] = [];
  for (const run of raw) {
    const mediaLow = run.sharedLow - fixedAngle.offset;
    const mediaHigh = run.sharedHigh - fixedAngle.offset;
    const lostLow = Math.max(0, -mediaLow);
    const lostHigh = Math.max(0, mediaHigh - fixedAngle.duration);
    if (run.nonlinear && (lostLow > EPS || lostHigh > EPS)) continue;
    const rate = Math.abs(run.retime.speed ?? 1);
    const reversed = run.retime.reversed === true;
    const lead = (reversed ? lostHigh : lostLow) / rate;
    const tail = (reversed ? lostLow : lostHigh) / rate;
    const start = run.start + lead;
    const duration = run.end - tail - start;
    const inPoint = Math.max(0, mediaLow);
    const outPoint = Math.min(fixedAngle.duration, mediaHigh);
    if (duration > EPS && outPoint - inPoint > EPS) runs.push({ start, duration, inPoint, outPoint, retime: run.retime });
  }
  return runs;
}

/** The audio clip a run derives (a fresh clip, or `prior` updated in place so it keeps its id, effects and volume). */
export function fixedAudioClipFromRun(
  run: FixedAudioRun,
  fixedAngle: MulticamAngle,
  trackId: string,
  sourceId: string,
  index: number,
  prior?: Clip,
): Clip {
  const base: Clip = prior ?? {
    id: fixedAudioClipId(sourceId, index),
    mediaId: fixedAngle.mediaId,
    trackId,
    startTime: 0,
    duration: 0,
    inPoint: 0,
    outPoint: 0,
    effects: [],
    audioEffects: [],
    transform: IDENTITY_TRANSFORM,
    volume: 1,
    keyframes: [],
    metadata: { multicamAudio: sourceId },
  };
  return withMulticamRetime(
    { ...base, mediaId: fixedAngle.mediaId, trackId, startTime: run.start, duration: run.duration, inPoint: run.inPoint, outPoint: run.outPoint },
    run.retime,
  );
}

/**
 * Re-derive every fixed-audio source's audio clips from the video clips as
 * they are NOW. Called after every action (and undo/redo) so audio follows a
 * moved/trimmed/slipped/split/shifted video clip. Existing audio clips are
 * reused in order, keeping their ids, effects and volume. Returns the same
 * project object when nothing needs to change.
 */
export function reconcileMulticamAudio(input: Project): Project {
  const sources = getMulticamSources(input).filter((s) => s.audio.mode === "fixed");
  if (sources.length === 0) return input;
  let project = input;
  for (const source of sources) {
    const mode = source.audio;
    const fixedAngle = mode.mode === "fixed" ? source.angles.find((a) => a.id === mode.angleId) : undefined;
    if (!fixedAngle) continue;
    const refs = listMulticamClips(project, source.id);
    const existing = project.timeline.tracks
      .flatMap((t) => t.clips.filter((c) => multicamAudioTag(c) === source.id))
      .sort((a, b) => a.startTime - b.startTime);
    if (refs.length === 0 && existing.length === 0) continue;
    const runs = fixedAudioRuns(refs, fixedAngle);
    const unchanged =
      existing.length === runs.length &&
      existing.every((c, i) => {
        const r = runs[i]!;
        return (
          c.mediaId === fixedAngle.mediaId &&
          Math.abs(c.startTime - r.start) <= 1e-9 &&
          Math.abs(c.duration - r.duration) <= 1e-9 &&
          Math.abs(c.inPoint - r.inPoint) <= 1e-9 &&
          Math.abs(c.outPoint - r.outPoint) <= 1e-9 &&
          retimeKey(multicamRetimeOf(c)) === retimeKey(r.retime)
        );
      });
    const silenced = refs.every((ref) => ref.clip.volume === 0);
    if (unchanged && silenced) continue;
    if (!silenced) {
      const ids = new Set(refs.map((ref) => ref.clip.id));
      project = mapClips(project, (clip) => (ids.has(clip.id) && clip.volume !== 0 ? { ...clip, volume: 0 } : clip));
    }
    if (unchanged) continue;
    const audioTrackId =
      existing[0]?.trackId ?? project.timeline.tracks.find((t) => t.type === "audio" && t.name === "Multicam Audio")?.id ?? newId("track");
    const made: Clip[] = runs.map((run, i) => fixedAudioClipFromRun(run, fixedAngle, audioTrackId, source.id, i, existing[i]));
    const dropIds = new Set(existing.map((c) => c.id));
    let tracks = project.timeline.tracks.map((t) => {
      const kept = t.clips.filter((c) => !dropIds.has(c.id));
      return kept.length === t.clips.length ? t : { ...t, clips: kept };
    });
    if (made.length > 0) {
      if (tracks.some((t) => t.id === audioTrackId)) {
        tracks = tracks.map((t) => (t.id === audioTrackId ? { ...t, clips: [...t.clips, ...made].sort((x, y) => x.startTime - y.startTime) } : t));
      } else {
        tracks = [...tracks, { ...makeTrack(audioTrackId, "audio", "Multicam Audio"), clips: made }];
      }
    }
    project = replaceTracks(project, tracks);
  }
  return project;
}
