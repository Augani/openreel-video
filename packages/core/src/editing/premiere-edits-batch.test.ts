import { describe, expect, it } from "vitest";
import type { Clip, Project } from "../types";
import {
  openTimelineGap,
  openTimelineGaps,
  removeTimelineSpan,
  removeTimelineSpans,
  shiftAfter,
  shiftAfterBatch,
} from "./premiere-edits";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "m", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});

let seed = 3;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

/** A random project: clips on two tracks, text overlays, markers (point and range) and captions. */
function randomProject(): Project {
  const make = (trackId: string, prefix: string) => {
    const clips: Clip[] = [];
    let t = rnd() * 2;
    for (let i = 0; i < 25; i++) {
      const d = 0.5 + rnd() * 3;
      clips.push(clip(`${prefix}${i}`, trackId, t, d));
      t += d + (rnd() < 0.3 ? rnd() : 0);
    }
    return clips;
  };
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    textClips: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, trackId: "v", startTime: i * 7 + 1, duration: 2 })),
    timeline: {
      duration: 100,
      markers: Array.from({ length: 30 }, (_, i) => ({
        id: `m${i}`, time: rnd() * 80, label: "m", color: "#fff", ...(rnd() < 0.3 ? { duration: rnd() * 6 } : {}),
      })),
      subtitles: Array.from({ length: 20 }, (_, i) => {
        const s = rnd() * 80;
        return { id: `s${i}`, text: "alpha beta gamma", startTime: s, endTime: s + 0.3 + rnd() * 2, ...(rnd() < 0.4 ? { words: [{ text: "alpha", startTime: s, endTime: s + 0.2 }, { text: "beta", startTime: s + 0.2, endTime: s + 0.4 }] } : {}) };
      }),
      tracks: [
        { id: "v", name: "V", type: "video", clips: make("v", "v"), transitions: [], locked: false, hidden: false, muted: false, solo: false },
        { id: "a", name: "A", type: "audio", clips: make("a", "a"), transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
    },
  } as unknown as Project;
}
const round = (p: Project) => JSON.stringify(p, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v));
/** Disjoint ranges, ascending. */
function ranges(count: number, minLen: number, maxLen: number) {
  const out: { start: number; end: number }[] = [];
  let t = rnd() * 3;
  for (let i = 0; i < count; i++) {
    const len = minLen + rnd() * (maxLen - minLen);
    out.push({ start: t, end: t + len });
    t += len + 1 + rnd() * 6;
  }
  return out;
}

describe("batched ripple helpers equal the one-at-a-time versions", () => {
  it("shiftAfterBatch == right-to-left shiftAfter", () => {
    for (let round_ = 0; round_ < 100; round_++) {
      const p = randomProject();
      const steps = ranges(1 + Math.floor(rnd() * 6), 0.3, 2).map((r) => ({ from: r.end, delta: (rnd() < 0.5 ? 1 : -1) * Math.min(r.end - r.start, 0.1 + rnd() * 2) }));
      const tracks = rnd() < 0.5 ? ["v"] : ["v", "a"];
      let sequential = p;
      for (const s of [...steps].sort((a, b) => b.from - a.from)) sequential = shiftAfter(sequential, tracks, s.from, s.delta);
      expect(round(shiftAfterBatch(p, tracks, steps))).toEqual(round(sequential));
    }
  });
  it("removeTimelineSpans == right-to-left removeTimelineSpan, with or without captions", () => {
    for (let round_ = 0; round_ < 150; round_++) {
      const p = randomProject();
      const spans = ranges(1 + Math.floor(rnd() * 6), 0.3, 4).map((r) => ({ start: r.start, stop: r.end }));
      const captions = rnd() < 0.5;
      let sequential = p;
      for (const s of [...spans].sort((a, b) => b.start - a.start)) sequential = removeTimelineSpan(sequential, s.start, s.stop, captions);
      expect(round(removeTimelineSpans(p, spans, captions))).toEqual(round(sequential));
    }
  });
  it("openTimelineGaps == right-to-left openTimelineGap, including captions the gap splits", () => {
    for (let round_ = 0; round_ < 150; round_++) {
      const p = randomProject();
      const gaps = ranges(1 + Math.floor(rnd() * 6), 0.3, 3).map((r) => ({ at: r.start, length: r.end - r.start }));
      const captions = rnd() < 0.7;
      let sequential = p;
      for (const g of [...gaps].sort((a, b) => b.at - a.at)) sequential = openTimelineGap(sequential, g.at, g.length, "op", captions);
      expect(round(openTimelineGaps(p, gaps, "op", captions))).toEqual(round(sequential));
    }
  });
});
