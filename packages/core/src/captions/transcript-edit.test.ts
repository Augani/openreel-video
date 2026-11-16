import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { Subtitle } from "../types/timeline";
import { applyTimelineToolEdits, invertTimelineToolEdits } from "../editing/timeline-tool-edit";
import { planTranscriptCut } from "./transcript-edit";
import { buildTranscript, findFillerWords, findPauses, wordRange } from "./transcript";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  metadata?: Record<string, unknown>,
): Clip => ({
  id,
  mediaId: "media",
  trackId,
  startTime,
  duration,
  inPoint: startTime,
  outPoint: startTime + duration,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
  ...(metadata ? { metadata } : {}),
});
const track = (id: string, type: Track["type"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id,
  name: id,
  type,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...extra,
});

const cue = (id: string, spec: Array<[string, number, number]>, speaker?: string): Subtitle => ({
  id,
  text: spec.map((w) => w[0]).join(" "),
  startTime: spec[0][1],
  endTime: spec[spec.length - 1][2],
  words: spec.map(([text, startTime, endTime]) => ({ text, startTime, endTime })),
  ...(speaker ? { speaker } : {}),
});

const SUBS: Subtitle[] = [
  cue("c1", [["Hello", 0.5, 0.9], ["there.", 0.9, 1.4]], "Ann"),
  cue("c2", [["Um,", 2.0, 2.3], ["this", 2.5, 2.8], ["is", 2.8, 3.0], ["like", 3.0, 3.2], ["great.", 3.2, 3.8]], "Ann"),
  cue("c3", [["Thanks", 5.0, 5.5], ["all.", 5.5, 6.0]], "Bob"),
];

function project(audioTrack: Partial<Track> = {}): Project {
  return {
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 8,
      markers: [],
      subtitles: SUBS,
      tracks: [
        track("v1", "video", [clip("v", "v1", 0, 8)]),
        track("a1", "audio", [clip("a", "a1", 0, 8, { separatedFromClipId: "v" })], audioTrack),
      ],
    },
    textClips: [],
  } as unknown as Project;
}

const shape = (p: Project, id: string) =>
  p.timeline.tracks
    .find((t) => t.id === id)!
    .clips.map((c) => [c.startTime, c.duration].map((n) => Math.round(n * 1000) / 1000))
    .sort((x, y) => x[0] - y[0]);

describe("planTranscriptCut", () => {
  it("ripple-cuts a sentence from linked picture and sound as one plan; captions follow", () => {
    const p = project();
    const t = buildTranscript(p.timeline.subtitles);
    const range = wordRange(t, 3, 6); // "this is like great."
    expect(range).toEqual({ start: 2.5, end: 3.8 });
    const plan = planTranscriptCut(p, [range], "op");
    const after = applyTimelineToolEdits(p, plan.edits);
    expect(shape(after, "v1")).toEqual([[0, 2.5], [2.5, 4.2]]);
    expect(shape(after, "a1")).toEqual(shape(after, "v1"));
    const c3 = after.timeline.subtitles.find((s) => s.id === "c3")!;
    expect(c3.startTime).toBeCloseTo(3.7, 6);
    expect(c3.words![0].startTime).toBeCloseTo(3.7, 6);
    const c2 = after.timeline.subtitles.find((s) => s.id === "c2")!;
    expect(c2.words!.map((w) => w.text)).toEqual(["Um,"]);
    expect(c2.text).toBe("Um,");
    const back = applyTimelineToolEdits(after, invertTimelineToolEdits(plan.edits));
    expect(shape(back, "v1")).toEqual(shape(p, "v1"));
    expect(back.timeline.subtitles).toEqual(p.timeline.subtitles);
  });

  it("cuts several ranges at once; later ones do not shift the earlier", () => {
    const p = project();
    const plan = planTranscriptCut(p, [{ start: 5, end: 5.5 }, { start: 0.5, end: 0.9 }], "op");
    const after = applyTimelineToolEdits(p, plan.edits);
    expect(shape(after, "v1")).toEqual([[0, 0.5], [0.5, 4.1], [4.6, 2.5]]);
    expect(shape(after, "a1")).toEqual(shape(after, "v1"));
  });

  it("refuses when a linked partner would be left behind", () => {
    expect(() => planTranscriptCut(project({ syncLock: false }), [{ start: 1, end: 2 }], "op")).toThrow(
      /not sync-locked/,
    );
    expect(() => planTranscriptCut(project({ locked: true }), [{ start: 1, end: 2 }], "op")).toThrow(/locked/);
  });

  it("rejects an empty cut", () => {
    expect(() => planTranscriptCut(project(), [], "op")).toThrow(/nothing to cut/);
  });
});

describe("transcript analysis", () => {
  const t = buildTranscript(SUBS);

  it("splits sentences on punctuation and speaker", () => {
    expect(t.sentences.map((s) => [s.wordStart, s.wordEnd, s.speaker])).toEqual([
      [0, 2, "Ann"],
      [2, 7, "Ann"],
      [7, 9, "Bob"],
    ]);
  });

  it("finds filler words with exact ranges", () => {
    expect(findFillerWords(t.words).map((f) => [f.text, f.start, f.end])).toEqual([
      ["Um,", 2.0, 2.3],
      ["like", 3.0, 3.2],
    ]);
  });

  it("finds pauses over a threshold and keeps breathing room", () => {
    const pauses = findPauses(t.words, 0.5, { keep: 0.2 });
    expect(pauses.map((p) => [p.afterWord, Math.round(p.gap * 100) / 100])).toEqual([
      [1, 0.6],
      [6, 1.2],
    ]);
    expect(pauses[0].cut.start).toBeCloseTo(1.5, 9);
    expect(pauses[0].cut.end).toBeCloseTo(1.9, 9);
  });

  it("estimates word times for untimed cues", () => {
    const est = buildTranscript([{ id: "x", text: "aa bbbb", startTime: 0, endTime: 3 }]);
    expect(est.words.every((w) => w.estimated)).toBe(true);
    expect(est.words[0].start).toBe(0);
    expect(est.words[1].end).toBe(3);
  });
});
