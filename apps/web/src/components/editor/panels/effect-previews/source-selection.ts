import type { Clip, MediaItem, Track } from "@openreel/core";

/** Length of the footage window each card loops on hover, in source seconds. */
export const PREVIEW_WINDOW_SECONDS = 2;
/** Frames per second of the preview window (24 frames per 2 s window). */
export const PREVIEW_FPS = 12;
/** The playhead must move this far (source seconds) inside the same clip before the window is re-decoded. */
export const PREVIEW_RETARGET_DISTANCE = 0.5;
/** Trailing debounce after the last playhead / selection change before the source is re-evaluated. */
export const PREVIEW_RETARGET_DEBOUNCE_MS = 300;

export type PreviewSourceOrigin = "selected" | "playhead" | "nearest";

/**
 * The incoming shot of a transition card: the first frame of the next clip on the timeline. Absent when the
 * project has a single visual clip; the card then blends towards the bundled sample scene, which always
 * differs from the user's footage (two moments of one talking-head clip would make every wipe look alike).
 */
export interface PreviewPartner {
  readonly mediaId: string;
  readonly mediaType: "video" | "image";
  /** Source time of the incoming frame, seconds. */
  readonly time: number;
  /**
   * Source seconds of the incoming clip that play after `time` while a card loops on hover (at most the 2 s
   * window, less when the clip is shorter; 0 for a still). The incoming shot moves like the outgoing one.
   */
  readonly seconds: number;
}

/** The footage the Effects cards render: one clip, one window of its source media. */
export interface PreviewSource {
  readonly clipId: string;
  readonly mediaId: string;
  readonly mediaType: "video" | "image";
  readonly origin: PreviewSourceOrigin;
  /** Source time of the frame under the playhead (the poster). */
  readonly posterSourceTime: number;
  /** Source time of the first frame of the window. */
  readonly windowStart: number;
  /** Source seconds the window spans (2 s, less when the clip is shorter). */
  readonly windowSeconds: number;
  readonly partner?: PreviewPartner | null;
}

export interface SourceSelectionInput {
  readonly tracks: readonly Track[];
  readonly media: readonly MediaItem[];
  readonly selectedClipIds: readonly string[];
  /** Timeline seconds. */
  readonly playhead: number;
  readonly windowSeconds?: number;
}

const isVisualMedia = (item: MediaItem | undefined): item is MediaItem =>
  !!item && (item.type === "video" || item.type === "image");

const isVisualTrack = (track: Track): boolean =>
  !track.hidden && track.type !== "audio" && track.type !== "text" && track.type !== "graphics";

const clipEnd = (clip: Clip): number => clip.startTime + clip.duration;

const containsTime = (clip: Clip, time: number): boolean =>
  time >= clip.startTime && time < clipEnd(clip);

/**
 * Source seconds a clip reaches `timelineTime` into itself. Speed scales the
 * source consumed per timeline second; ramps and reverse are ignored on
 * purpose: the card previews the footage forward, the exact program frame is
 * not needed to judge an effect.
 */
export function clipSourceTime(clip: Clip, timelineTime: number): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const local = Math.min(Math.max(timelineTime - clip.startTime, 0), clip.duration);
  return clip.inPoint + local * speed;
}

/** Source-time end of the part of a clip that is on the timeline. */
export function clipSourceEnd(clip: Clip): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  return Math.max(clip.inPoint + clip.duration * speed, clip.inPoint);
}

interface Candidate {
  readonly clip: Clip;
  readonly media: MediaItem;
  readonly trackIndex: number;
}

/**
 * Picks the footage to preview effects on:
 *  1. the selected video/image clip when the playhead is inside it,
 *  2. else the topmost visible video clip under the playhead (lowest track index
 *     is on top in OpenReel), then topmost image clip,
 *  3. else the visual clip nearest to the playhead (frame clamped to the clip),
 *  4. else null: the caller falls back to the bundled sample scene.
 */
export function selectPreviewSource(input: SourceSelectionInput): PreviewSource | null {
  const { tracks, media, selectedClipIds, playhead } = input;
  const windowSeconds = input.windowSeconds ?? PREVIEW_WINDOW_SECONDS;
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const candidates: Candidate[] = [];
  tracks.forEach((track, trackIndex) => {
    if (!isVisualTrack(track)) return;
    for (const clip of track.clips) {
      const item = mediaById.get(clip.mediaId);
      if (isVisualMedia(item) && !item.isPlaceholder) candidates.push({ clip, media: item, trackIndex });
    }
  });
  if (candidates.length === 0) return null;

  const rank = (candidate: Candidate) => (candidate.media.type === "video" ? 0 : 1);
  const byTopmost = (a: Candidate, b: Candidate) =>
    rank(a) - rank(b) || a.trackIndex - b.trackIndex || a.clip.startTime - b.clip.startTime;

  let chosen: Candidate | undefined;
  let origin: PreviewSourceOrigin = "playhead";
  const selected = new Set(selectedClipIds);
  chosen = candidates
    .filter((candidate) => selected.has(candidate.clip.id) && containsTime(candidate.clip, playhead))
    .sort(byTopmost)[0];
  if (chosen) origin = "selected";
  if (!chosen) {
    chosen = candidates.filter((candidate) => containsTime(candidate.clip, playhead)).sort(byTopmost)[0];
  }
  if (!chosen) {
    const distance = (candidate: Candidate) =>
      playhead < candidate.clip.startTime
        ? candidate.clip.startTime - playhead
        : playhead - clipEnd(candidate.clip);
    chosen = [...candidates].sort(
      (a, b) => rank(a) - rank(b) || distance(a) - distance(b) || byTopmost(a, b),
    )[0];
    origin = "nearest";
  }
  if (!chosen) return null;
  const source = buildSource(chosen.clip, chosen.media, playhead, windowSeconds, origin);
  const partner = pickPartner(chosen, candidates);
  return partner ? { ...source, partner } : source;
}

/** The clip a cut from `chosen` would go to: next on its track, else the previous one, else any other visual clip. */
function pickPartner(chosen: Candidate, candidates: readonly Candidate[]): PreviewPartner | null {
  const others = candidates.filter((candidate) => candidate.clip.id !== chosen.clip.id);
  if (others.length === 0) return null;
  const sameTrack = others.filter((candidate) => candidate.trackIndex === chosen.trackIndex);
  const after = (list: readonly Candidate[]) =>
    list.filter((c) => c.clip.startTime >= chosen.clip.startTime).sort((a, b) => a.clip.startTime - b.clip.startTime)[0];
  const before = (list: readonly Candidate[]) =>
    list.filter((c) => c.clip.startTime < chosen.clip.startTime).sort((a, b) => b.clip.startTime - a.clip.startTime)[0];
  // Prefer a different shot over a split of the same media, then the cut neighbour.
  const differing = (list: readonly Candidate[]) => list.filter((c) => c.media.id !== chosen.media.id);
  const next =
    after(differing(sameTrack)) ?? before(differing(sameTrack)) ?? after(differing(others)) ?? before(differing(others)) ??
    after(sameTrack) ?? before(sameTrack) ?? after(others) ?? before(others);
  if (!next) return null;
  const image = next.media.type === "image";
  const start = next.clip.inPoint;
  return {
    mediaId: next.media.id,
    mediaType: image ? "image" : "video",
    time: image ? 0 : start,
    seconds: image ? 0 : Math.max(0, Math.min(PREVIEW_WINDOW_SECONDS, clipSourceEnd(next.clip) - start)),
  };
}

function buildSource(
  clip: Clip,
  media: MediaItem,
  playhead: number,
  windowSeconds: number,
  origin: PreviewSourceOrigin,
): PreviewSource {
  const mediaType: "video" | "image" = media.type === "image" ? "image" : "video";
  const start = clip.inPoint;
  const end = clipSourceEnd(clip);
  const poster = Math.min(Math.max(clipSourceTime(clip, playhead), start), Math.max(start, end));
  if (mediaType === "image") {
    return { clipId: clip.id, mediaId: media.id, mediaType, origin, posterSourceTime: 0, windowStart: 0, windowSeconds: 0 };
  }
  const span = Math.max(0, Math.min(windowSeconds, end - start));
  // playhead .. playhead + 2 s, slid back when the clip ends sooner so the loop is always a full window.
  const windowStart = Math.max(start, Math.min(poster, end - span));
  return { clipId: clip.id, mediaId: media.id, mediaType, origin, posterSourceTime: poster, windowStart, windowSeconds: span };
}

/** Source timestamps of the window frames (one for stills and zero-length windows). */
export function buildWindowTimes(source: PreviewSource, fps: number = PREVIEW_FPS): number[] {
  if (source.mediaType === "image" || source.windowSeconds <= 0) return [source.windowStart];
  const count = Math.max(1, Math.round(source.windowSeconds * fps));
  const step = 1 / fps;
  // Stay strictly inside the window so the last frame never asks past the clip's out point.
  const last = source.windowStart + source.windowSeconds - 1e-3;
  return Array.from({ length: count }, (_, index) => Math.min(source.windowStart + index * step, last));
}

/** Index of the window frame nearest the poster time. */
export function posterFrameIndex(source: PreviewSource, times: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < times.length; index++) {
    if (Math.abs(times[index] - source.posterSourceTime) < Math.abs(times[best] - source.posterSourceTime)) best = index;
  }
  return best;
}

/** Identity of a source for caching: media + clip + window start (ms). */
export function previewSourceKey(source: PreviewSource | null): string {
  if (!source) return "sample";
  const partner = source.partner ? `>${source.partner.mediaId}@${Math.round(source.partner.time * 1000)}` : "";
  return `${source.mediaId}:${source.clipId}:${Math.round(source.windowStart * 1000)}${partner}`;
}

/**
 * Whether the existing window can keep serving the cards. A different clip or
 * media always retargets; within the same clip the playhead has to travel
 * PREVIEW_RETARGET_DISTANCE source seconds away from the current poster.
 */
export function isSameSource(previous: PreviewSource | null, next: PreviewSource | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  if (previous.clipId !== next.clipId || previous.mediaId !== next.mediaId || previous.mediaType !== next.mediaType) {
    return false;
  }
  const a = previous.partner;
  const b = next.partner;
  if ((a?.mediaId ?? null) !== (b?.mediaId ?? null) || Math.round((a?.time ?? 0) * 1000) !== Math.round((b?.time ?? 0) * 1000)) {
    return false;
  }
  if (next.mediaType === "image") return true;
  return Math.abs(previous.posterSourceTime - next.posterSourceTime) < PREVIEW_RETARGET_DISTANCE;
}
