/**
 * Premiere-style "Synchronize" (timeline) and "Merge Clips" (project panel),
 * lifted out of multicam so any clips can be aligned by their audio.
 *
 * The offset estimator is the multicam one (`findAudioOffset`, GCC-PHAT over a
 * 4 kHz decimated envelope, so a minutes-long recording costs milliseconds).
 * Offsets use the multicam sign convention: `offsets[i]` is the shared time at
 * which media i's time 0 plays when media 0's time 0 plays at shared time 0.
 *
 * Both commands are pure `Project -> Project` functions: the caller commits the
 * result as ONE `project/applyEditSnapshot` step, so undo restores every clip.
 */
import type { Clip, Track, Transform } from "../types/timeline";
import type { MediaItem, Project } from "../types/project";
import { findLinkedPartners } from "../editing/split-edit";
import { makeTrack, replaceTracks } from "./fixed-audio";

export type ClipSyncMode = "audio" | "in-point" | "timecode";
export type ClipSyncResult =
  | { readonly ok: true; readonly project: Project; readonly moved: readonly { readonly clipId: string; readonly delta: number }[]; readonly clipId?: string; readonly audioClipId?: string }
  | { readonly ok: false; readonly message: string };

/** Below this GCC-PHAT confidence the two recordings are treated as unrelated. */
export const MIN_SYNC_CONFIDENCE = 0.5;
export const MERGE_GROUP_KEY = "mergeGroupId";

const EPS = 1e-6;
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
const IDENTITY_TRANSFORM: Transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

/** Why an audio offset is not trustworthy, or null when it is. */
export function audioSyncRejection(confidence: number, minConfidence = MIN_SYNC_CONFIDENCE): string | null {
  return confidence >= minConfidence
    ? null
    : "Could not find a matching sound in these clips. Check that both recorded the same event, or sync by In Point or Timecode instead.";
}

export interface SynchronizeOptions {
  /** Clips to align; the first one stays where it is (the anchor). */
  readonly clipIds: readonly string[];
  readonly mode: ClipSyncMode;
  /** mode "audio": media-0 offset per clip (same order as `clipIds`) and its confidence. */
  readonly offsets?: readonly number[];
  readonly confidence?: readonly number[];
  readonly minConfidence?: number;
}

function locate(project: Project, id: string): { clip: Clip; track: Track } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

/** Timeline time at which the clip's media time 0 would play. */
const originOf = (clip: Clip): number => clip.startTime - clip.inPoint / (clip.speed && clip.speed > 0 ? clip.speed : 1);

export function synchronizeClips(project: Project, options: SynchronizeOptions): ClipSyncResult {
  const ids = [...new Set(options.clipIds)];
  if (ids.length < 2) return fail("Select at least two clips to synchronize.");
  const found = ids.map((id) => locate(project, id));
  if (found.some((f) => !f)) return fail("A selected clip no longer exists.");
  const refs = found as { clip: Clip; track: Track }[];
  if (refs.some((r) => r.track.locked)) return fail("Unlock the tracks of the selected clips first.");
  const anchor = refs[0].clip;

  const desired: number[] = [];
  if (options.mode === "audio") {
    const { offsets, confidence } = options;
    if (!offsets || offsets.length !== ids.length) return fail("Audio analysis did not return an offset for every clip.");
    const origin = originOf(anchor);
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) {
        const rejection = audioSyncRejection(confidence?.[i] ?? 0, options.minConfidence);
        if (rejection) return fail(rejection);
      }
      const clip = refs[i].clip;
      desired.push(origin + offsets[i] + clip.inPoint / (clip.speed && clip.speed > 0 ? clip.speed : 1));
    }
  } else if (options.mode === "in-point") {
    for (let i = 0; i < ids.length; i++) desired.push(anchor.startTime);
  } else {
    const tcOf = (clip: Clip): number | undefined => project.mediaLibrary.items.find((m) => m.id === clip.mediaId)?.metadata.startTimecode;
    const base = tcOf(anchor);
    if (base === undefined) return fail("The first clip has no timecode. Sync by audio or in point instead.");
    for (const { clip } of refs) {
      const tc = tcOf(clip);
      if (tc === undefined) return fail("Every clip needs a timecode to sync by timecode.");
      desired.push(originOf(anchor) + (tc - base) + clip.inPoint / (clip.speed && clip.speed > 0 ? clip.speed : 1));
    }
  }

  // Nothing may land before 0 (linked partners included): move the whole group right by the overshoot.
  const base = new Map<string, number>();
  refs.forEach((r, i) => base.set(r.clip.id, desired[i] - r.clip.startTime));
  for (const r of refs) {
    const delta = base.get(r.clip.id) ?? 0;
    for (const partner of findLinkedPartners(r.clip, project.timeline.tracks)) {
      if (!base.has(partner.clip.id)) base.set(partner.clip.id, delta);
    }
  }
  const clipStart = new Map(project.timeline.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.startTime] as const)));
  let lift = 0;
  for (const [id, delta] of base) lift = Math.max(lift, -((clipStart.get(id) ?? 0) + delta));
  const deltas = new Map<string, number>();
  for (const [id, delta] of base) deltas.set(id, delta + lift);
  const moves = [...deltas].filter(([, delta]) => Math.abs(delta) > EPS);
  if (moves.length === 0) return { ok: true, project, moved: [] };

  const tracks = project.timeline.tracks.map((track) => {
    if (!track.clips.some((c) => deltas.has(c.id))) return track;
    const clips = track.clips
      .map((c) => ((deltas.get(c.id) ?? 0) !== 0 ? { ...c, startTime: Math.max(0, c.startTime + (deltas.get(c.id) ?? 0)) } : c))
      .sort((a, b) => a.startTime - b.startTime);
    return { ...track, clips };
  });
  for (const track of tracks) {
    if (track.locked && track.clips.some((c) => deltas.has(c.id))) return fail("A linked clip is on a locked track. Unlock it first.");
    for (let i = 1; i < track.clips.length; i++) {
      const prev = track.clips[i - 1];
      if ((deltas.has(prev.id) || deltas.has(track.clips[i].id)) && prev.startTime + prev.duration > track.clips[i].startTime + 1e-4) {
        return fail("Synchronizing would overlap clips on a track. Move them to separate tracks first.");
      }
    }
  }
  return { ok: true, project: replaceTracks(project, tracks), moved: moves.map(([clipId, delta]) => ({ clipId, delta })) };
}

export interface MergeClipsOptions {
  readonly videoMediaId: string;
  readonly audioMediaId: string;
  /** Media-0 offset of the audio relative to the video (multicam convention), from `findAudioOffset`. */
  readonly offsetSeconds: number;
  readonly confidence: number;
  /** Silence the camera's own audio (default true). */
  readonly muteCameraAudio?: boolean;
  /** Timeline time of the video's first frame. */
  readonly startTime: number;
  readonly minConfidence?: number;
}

const mediaDuration = (item: MediaItem): number => item.metadata.duration;

const hasUnlockedTrack = (project: Project, type: Track["type"]): Track | undefined =>
  project.timeline.tracks.find((t) => t.type === type && !t.locked);

/**
 * Merge Clips: place the video and the separately recorded audio on the
 * timeline, aligned by `offsetSeconds`, as a linked pair (shared `mergeGroupId`).
 */
export function mergeClips(input: Project, options: MergeClipsOptions): ClipSyncResult {
  const video = input.mediaLibrary.items.find((m) => m.id === options.videoMediaId);
  const audio = input.mediaLibrary.items.find((m) => m.id === options.audioMediaId);
  if (!video || video.type !== "video") return fail("Pick one video clip to merge.");
  if (!audio || audio.type !== "audio") return fail("Pick one audio clip to merge with it.");
  const rejection = audioSyncRejection(options.confidence, options.minConfidence);
  if (rejection) return fail(rejection);
  if (!Number.isFinite(options.startTime) || !Number.isFinite(options.offsetSeconds)) return fail("The offset is not a number.");

  const vDur = mediaDuration(video);
  const aDur = mediaDuration(audio);
  const offset = options.offsetSeconds;
  // Audio plays from video time `max(offset, 0)`, starting `max(-offset, 0)` into the audio file.
  const audioDelay = Math.max(offset, 0);
  const audioIn = Math.max(-offset, 0);
  const audioDuration = Math.min(aDur - audioIn, vDur - audioDelay);
  if (!(audioDuration > 0.05)) return fail("The video and the audio do not overlap once aligned.");
  const start = Math.max(0, options.startTime);

  let tracks: Track[] = [...input.timeline.tracks];
  let videoTrack = hasUnlockedTrack(input, "video");
  if (!videoTrack) {
    videoTrack = makeTrack(newId("track"), "video", "Video 1");
    tracks = [videoTrack, ...tracks];
  }
  let audioTrack = tracks.find((t) => t.type === "audio" && !t.locked && !t.clips.some((c) => c.startTime < start + audioDelay + audioDuration && c.startTime + c.duration > start + audioDelay));
  if (!audioTrack) {
    audioTrack = makeTrack(newId("track"), "audio", `Audio ${tracks.filter((t) => t.type === "audio").length + 1}`);
    tracks = [...tracks, audioTrack];
  }
  const overlaps = (track: Track, from: number, to: number): boolean => track.clips.some((c) => c.startTime < to - EPS && c.startTime + c.duration > from + EPS);
  if (overlaps(videoTrack, start, start + vDur)) {
    const free = tracks.find((t) => t.type === "video" && !t.locked && !overlaps(t, start, start + vDur));
    if (free) videoTrack = free;
    else {
      videoTrack = makeTrack(newId("track"), "video", `Video ${tracks.filter((t) => t.type === "video").length + 1}`);
      tracks = [videoTrack, ...tracks];
    }
  }

  const group = newId("merge");
  const videoClip: Clip = {
    id: newId("clip"),
    mediaId: video.id,
    trackId: videoTrack.id,
    startTime: start,
    duration: vDur,
    inPoint: 0,
    outPoint: vDur,
    effects: [],
    audioEffects: [],
    transform: IDENTITY_TRANSFORM,
    volume: options.muteCameraAudio === false ? 1 : 0,
    keyframes: [],
    metadata: { [MERGE_GROUP_KEY]: group },
  };
  const audioClip: Clip = {
    id: newId("clip"),
    mediaId: audio.id,
    trackId: audioTrack.id,
    startTime: start + audioDelay,
    duration: audioDuration,
    inPoint: audioIn,
    outPoint: audioIn + audioDuration,
    effects: [],
    audioEffects: [],
    transform: IDENTITY_TRANSFORM,
    volume: 1,
    keyframes: [],
    metadata: { [MERGE_GROUP_KEY]: group, separatedFromClipId: videoClip.id },
  };
  const withClip = (id: string, clip: Clip): void => {
    tracks = tracks.map((t) => (t.id === id ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.startTime - b.startTime) } : t));
  };
  withClip(videoTrack.id, videoClip);
  withClip(audioTrack.id, audioClip);
  return { ok: true, project: replaceTracks(input, tracks), moved: [], clipId: videoClip.id, audioClipId: audioClip.id };
}
