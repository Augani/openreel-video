import type { Track } from "@openreel/core";

/** Decorations already have 120px overscan; move their window in 96px steps. */
export const phoneDecorationScroll = (scroll: number) => Math.floor(scroll / 96) * 96;

export function phoneTrackLayout(track: Pick<Track, "type" | "name">, scale = 1) {
  const base = track.type === "text" ? { lane: 22, row: 26 }
    : track.type === "graphics" || track.name.toLowerCase() === "b-roll" ? { lane: 22, row: 28 }
    : track.type === "audio" ? { lane: 32, row: 38 } : { lane: 60, row: 68 };
  return { lane: Math.round(base.lane * scale), row: Math.round(base.row * scale) };
}

export function phoneKeyframesHeight(track: Track): number {
  return track.clips.reduce((height, clip) => clip.keyframes?.length
    ? height + new Set(clip.keyframes.map(keyframe => keyframe.property)).size * 24 + 1
    : height, 0);
}
