import type { MediaItem } from "../../types/project";
import type { Marker, Track } from "../../types/timeline";
import { secondsToFrames, type FrameRate } from "../timecode";

/** Structural, frame-quantized view of a timeline for equality assertions. */
export interface Layout {
  tracks: {
    type: string;
    clips: {
      media: string;
      start: number;
      end: number;
      inFrame: number;
      outFrame: number;
      speed: number;
      reversed: boolean;
      opacity: number;
      volume: number;
    }[];
    transitions: { type: string; durationFrames: number; aEnd: number; bStart: number }[];
  }[];
  markers: { frame: number; label: string }[];
}

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function layoutOf(
  tracks: readonly Track[],
  markers: readonly Marker[],
  mediaItems: readonly MediaItem[],
  rate: FrameRate,
): Layout {
  const name = (id: string): string => mediaItems.find((m) => m.id === id)?.name ?? id;
  const f = (s: number): number => secondsToFrames(s, rate);
  return {
    tracks: tracks.map((t) => ({
      type: t.type,
      clips: [...t.clips]
        .sort((a, b) => a.startTime - b.startTime)
        .map((c) => ({
          media: name(c.mediaId),
          start: f(c.startTime),
          end: f(c.startTime + c.duration),
          inFrame: f(c.inPoint),
          outFrame: f(c.outPoint),
          speed: r4(Math.abs(c.speed ?? 1)),
          reversed: c.reversed === true || (c.speed ?? 1) < 0,
          opacity: r4(c.transform.opacity),
          volume: r4(c.volume),
        })),
      transitions: t.transitions.map((tr) => {
        const a = t.clips.find((c) => c.id === tr.clipAId)!;
        const b = t.clips.find((c) => c.id === tr.clipBId)!;
        return {
          type: tr.type,
          durationFrames: f(tr.duration),
          aEnd: f(a.startTime + a.duration),
          bStart: f(b.startTime),
        };
      }),
    })),
    markers: markers.map((m) => ({ frame: f(m.time), label: m.label })).sort((a, b) => a.frame - b.frame),
  };
}
