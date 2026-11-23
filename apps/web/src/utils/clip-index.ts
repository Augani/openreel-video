import type { Clip, Track } from "@openreel/core";

/**
 * Id lookups for code that resolves many clips against one project snapshot (an inspector over a select-all).
 * `tracks.flatMap(...).find(...)` per id is O(clips) each, so 3000 selected clips cost seconds in a render.
 */
export interface ClipIndex {
  readonly clips: ReadonlyMap<string, Clip>;
  readonly tracks: ReadonlyMap<string, Track>;
}

export function buildClipIndex(tracks: readonly Track[]): ClipIndex {
  const clips = new Map<string, Clip>();
  const byId = new Map<string, Track>();
  for (const track of tracks) {
    byId.set(track.id, track);
    for (const clip of track.clips) clips.set(clip.id, clip);
  }
  return { clips, tracks: byId };
}
