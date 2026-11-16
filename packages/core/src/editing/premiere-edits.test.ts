import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import {
  clipSourceTimeAt,
  createMediaClip,
  findTopmostVisualClipAt,
  planAddEditToAllTracks,
  planExtract,
  planInsert,
  planLift,
  planOverwrite,
} from "./premiere-edits";
import {
  chooseTrackForMedia,
  createEmptyTrack,
  findMainTrack,
} from "./track-targeting";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  validateTimelineToolEdits,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

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
  inPoint = 0,
): Clip => ({
  id,
  mediaId: "media",
  trackId,
  startTime,
  duration,
  inPoint,
  outPoint: inPoint + duration,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});
const track = (
  id: string,
  type: Track["type"],
  clips: Clip[],
  locked = false,
): Track => ({
  id,
  name: id,
  type,
  clips,
  transitions: [],
  locked,
  hidden: false,
  muted: false,
  solo: false,
});

function fixture(): Project {
  const v1 = track("v1", "video", [
    clip("a", "v1", 0, 4),
    clip("b", "v1", 4, 4, 10),
  ]);
  const a1 = track("a1", "audio", [clip("c", "a1", 0, 8)]);
  const locked = track("lk", "video", [clip("l", "lk", 0, 8)], true);
  return {
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: {
      items: [
        {
          id: "media",
          name: "Media.mp4",
          type: "video",
          fileHandle: null,
          blob: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 60,
            width: 640,
            height: 360,
            frameRate: 30,
            sampleRate: 48000,
            channels: 2,
            codec: "h264",
            fileSize: 1,
          },
        },
      ],
    },
    timeline: {
      duration: 8,
      markers: [],
      subtitles: [],
      tracks: [
        {
          ...v1,
          transitions: [
            {
              id: "t",
              clipAId: "a",
              clipBId: "b",
              type: "crossfade",
              duration: 0.5,
              params: {},
            },
          ],
        },
        a1,
        locked,
      ],
    },
  } as unknown as Project;
}

function run(project: Project, plan: TimelineToolPlan) {
  validateTimelineToolEdits(project, plan.edits);
  return applyTimelineToolEdits(project, plan.edits);
}
function spans(project: Project, trackId: string) {
  const t = project.timeline.tracks.find((x) => x.id === trackId)!;
  return [...t.clips]
    .sort((x, y) => x.startTime - y.startTime)
    .map((c) => [
      +c.startTime.toFixed(6),
      +(c.startTime + c.duration).toFixed(6),
      +c.inPoint.toFixed(6),
    ]);
}
function undo(project: Project, plan: TimelineToolPlan) {
  const after = run(project, plan);
  const back = invertTimelineToolEdits(plan.edits);
  validateTimelineToolEdits(after, back);
  return applyTimelineToolEdits(after, back);
}
// Undo restores content; array order of re-inserted clips is normalised.
function normal(p: Project) {
  return JSON.stringify({
    tracks: p.timeline.tracks.map((t) => ({
      id: t.id,
      clips: [...t.clips].sort((a, b) => a.id.localeCompare(b.id)),
      transitions: t.transitions,
    })),
  });
}

describe("premiere edit commands", () => {
  it("adds an edit on every unlocked track and skips locked ones", () => {
    const p = fixture();
    const plan = planAddEditToAllTracks(p, 2, "op");
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([
      [0, 2, 0],
      [2, 4, 2],
      [4, 8, 10],
    ]);
    expect(spans(next, "a1")).toEqual([
      [0, 2, 0],
      [2, 8, 2],
    ]);
    expect(spans(next, "lk")).toEqual([[0, 8, 0]]);
    expect(normal(undo(p, plan))).toBe(normal(p));
  });

  it("keeps the crossfade attached to a real clip after add edit", () => {
    const p = fixture();
    const next = run(p, planAddEditToAllTracks(p, 3, "op"));
    const v1 = next.timeline.tracks[0];
    expect(v1.transitions).toHaveLength(1);
    const ids = v1.clips.map((c) => c.id);
    expect(ids).toContain(v1.transitions[0].clipAId);
    expect(ids).toContain(v1.transitions[0].clipBId);
  });

  it("lifts a range leaving a gap with source-preserving fragments", () => {
    const p = fixture();
    const plan = planLift(p, { start: 2, end: 6 }, "op");
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([
      [0, 2, 0],
      [6, 8, 12],
    ]);
    expect(spans(next, "a1")).toEqual([
      [0, 2, 0],
      [6, 8, 6],
    ]);
    expect(spans(next, "lk")).toEqual([[0, 8, 0]]);
    expect(next.timeline.tracks[0].transitions).toHaveLength(0);
    expect(normal(undo(p, plan))).toBe(normal(p));
  });

  it("extracts a range closing the gap on unlocked tracks", () => {
    const p = fixture();
    const plan = planExtract(p, { start: 2, end: 6 }, "op");
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([
      [0, 2, 0],
      [2, 4, 12],
    ]);
    expect(spans(next, "a1")).toEqual([
      [0, 2, 0],
      [2, 4, 6],
    ]);
    expect(spans(next, "lk")).toEqual([[0, 8, 0]]);
    expect(normal(undo(p, plan))).toBe(normal(p));
  });

  it("extracting a whole clip removes its transition and Undo restores it", () => {
    const p = fixture();
    const plan = planExtract(p, { start: 0, end: 4 }, "op");
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([[0, 4, 10]]);
    expect(next.timeline.tracks[0].transitions).toHaveLength(0);
    const back = undo(p, plan);
    expect(back.timeline.tracks[0].transitions).toHaveLength(1);
    expect(normal(back)).toBe(normal(p));
  });

  it("inserts at the playhead, rippling others and pruning the opened transition", () => {
    const p = fixture();
    const media = p.mediaLibrary.items[0];
    const plan = planInsert(
      p,
      4,
      [
        {
          trackId: "v1",
          clip: createMediaClip(media, "v1", "new", { inPoint: 1, outPoint: 3 }),
        },
      ],
      "op",
    );
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([
      [0, 4, 0],
      [4, 6, 1],
      [6, 10, 10],
    ]);
    expect(spans(next, "a1")).toEqual([
      [0, 4, 0],
      [6, 10, 4],
    ]);
    expect(next.timeline.tracks[0].transitions).toHaveLength(0);
    expect(normal(undo(p, plan))).toBe(normal(p));
  });

  it("insert splits a clip under the playhead", () => {
    const p = fixture();
    const plan = planInsert(
      p,
      1,
      [
        {
          trackId: "v1",
          clip: createMediaClip(p.mediaLibrary.items[0], "v1", "new", {
            inPoint: 0,
            outPoint: 2,
          }),
        },
      ],
      "op",
    );
    expect(spans(run(p, plan), "v1")).toEqual([
      [0, 1, 0],
      [1, 3, 0],
      [3, 6, 1],
      [6, 10, 10],
    ]);
  });

  it("overwrites without moving anything or touching other tracks", () => {
    const p = fixture();
    const plan = planOverwrite(
      p,
      3,
      [
        {
          trackId: "v1",
          clip: createMediaClip(p.mediaLibrary.items[0], "v1", "new", {
            inPoint: 0,
            outPoint: 2,
          }),
        },
      ],
      "op",
    );
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([
      [0, 3, 0],
      [3, 5, 0],
      [5, 8, 11],
    ]);
    expect(spans(next, "a1")).toEqual([[0, 8, 0]]);
    expect(normal(undo(p, plan))).toBe(normal(p));
  });

  it("rejects locked placement tracks and empty ranges", () => {
    const p = fixture();
    const c = createMediaClip(p.mediaLibrary.items[0], "lk", "n");
    expect(() =>
      planInsert(p, 0, [{ trackId: "lk", clip: c }], "op"),
    ).toThrow(/Unlock/);
    expect(() => planLift(p, { start: 2, end: 2 }, "op")).toThrow();
    expect(planLift(p, { start: 20, end: 30 }, "op").edits).toHaveLength(0);
  });

  it("maps match frame source time through speed and finds the topmost clip", () => {
    const p = fixture();
    expect(findTopmostVisualClipAt(p, 5)?.id).toBe("b");
    expect(clipSourceTimeAt(clip("x", "v1", 10, 4, 6), 11)).toBeCloseTo(7);
    expect(
      clipSourceTimeAt(
        { ...clip("x", "v1", 10, 2, 6), speed: 2, outPoint: 10 },
        11,
      ),
    ).toBeCloseTo(8);
  });

  describe("review regressions", () => {
    const exact = (p: Project) =>
      JSON.stringify({
        tracks: p.timeline.tracks,
        text: p.textClips,
        masks: p.masks,
      });
    function rich(): Project {
      const p = fixture();
      return {
        ...p,
        textClips: [
          { id: "t1", trackId: "v1", startTime: 1, duration: 1 },
          { id: "t2", trackId: "v1", startTime: 6, duration: 1 },
          { id: "tl", trackId: "lk", startTime: 6, duration: 1 },
        ],
        masks: [{ id: "m1", clipId: "a", type: "rect", keyframes: [] }],
      } as unknown as Project;
    }

    it("Undo restores exact array order, not just content", () => {
      for (const make of [
        (p: Project) => planExtract(p, { start: 1, end: 6 }, "op"),
        (p: Project) => planLift(p, { start: 1, end: 6 }, "op"),
        (p: Project) => planAddEditToAllTracks(p, 2, "op"),
        (p: Project) =>
          planInsert(
            p,
            2,
            [{ trackId: "v1", clip: createMediaClip(p.mediaLibrary.items[0], "v1", "n") }],
            "op",
          ),
        (p: Project) =>
          planOverwrite(
            p,
            2,
            [{ trackId: "v1", clip: createMediaClip(p.mediaLibrary.items[0], "v1", "n") }],
            "op",
          ),
      ]) {
        const p = rich();
        expect(exact(undo(p, make(p)))).toBe(exact(p));
      }
    });

    it("extract removes owned items and ripples later non-media items, leaving locked tracks", () => {
      const p = rich();
      const next = run(p, planExtract(p, { start: 0, end: 4 }, "op"));
      expect(next.masks).toHaveLength(0);
      expect(next.textClips?.find((t) => t.id === "t1")).toBeUndefined();
      expect(next.textClips?.find((t) => t.id === "t2")?.startTime).toBe(2);
      expect(next.textClips?.find((t) => t.id === "tl")?.startTime).toBe(6);
    });

    it("keeps a transition between two clips that both ripple together", () => {
      const p = fixture();
      const v = p.timeline.tracks[0];
      const next = run(p, planInsert(
        p,
        0,
        [{ trackId: "a1", clip: createMediaClip(p.mediaLibrary.items[0], "a1", "n", { inPoint: 0, outPoint: 1 }) }],
        "op",
      ));
      expect(next.timeline.tracks[0].transitions).toHaveLength(1);
      expect(spans(next, "v1")).toEqual([[1, 5, 0], [5, 9, 10]]);
      expect(v.transitions).toHaveLength(1);
    });

    it("lift across a clip boundary trims both clips by source frame", () => {
      const p = fixture();
      const next = run(p, planLift(p, { start: 3, end: 5 }, "op"));
      expect(spans(next, "v1")).toEqual([[0, 3, 0], [5, 8, 11]]);
      expect(next.timeline.tracks[0].transitions).toHaveLength(0);
    });

    it("maps reversed match frame source time", () => {
      const c = { ...clip("x", "v1", 10, 4, 6), reversed: true };
      expect(clipSourceTimeAt(c, 11)).toBeCloseTo(9);
    });
  });

  describe("markers, captions and overlay items", () => {
    /** Sequence-wide ripple needs every track unlocked; pass `lockOne` to keep fixture's locked track. */
    const withExtras = (lockOne = false) => {
      const base = fixture();
      const p = lockOne
        ? base
        : {
            ...base,
            timeline: {
              ...base.timeline,
              tracks: base.timeline.tracks.map((t) => ({ ...t, locked: false })),
            },
          };
      const text = (id: string, startTime: number, duration: number) => ({
        id, trackId: "v1", startTime, duration, text: id, keyframes: [],
      });
      return {
        ...p,
        textClips: [text("t-in", 3, 1), text("t-straddle", 1, 4), text("t-after", 6, 1)],
        timeline: {
          ...p.timeline,
          markers: [
            { id: "m0", time: 1, label: "", color: "red" },
            { id: "m1", time: 3, label: "", color: "red" },
            { id: "m2", time: 7, label: "", color: "red" },
          ],
          subtitles: [
            { id: "s0", text: "before", startTime: 0, endTime: 1.5 },
            { id: "s1", text: "over the cut", startTime: 1, endTime: 5 },
            { id: "s2", text: "after", startTime: 6, endTime: 7 },
            {
              id: "s3", text: "one two three four", startTime: 2, endTime: 6,
              words: [
                { text: "one", startTime: 2, endTime: 3 },
                { text: "two", startTime: 3, endTime: 4 },
                { text: "three", startTime: 4, endTime: 5 },
                { text: "four", startTime: 5, endTime: 6 },
              ],
            },
          ],
        },
      } as unknown as Project;
    };

    it("extract ripples markers and trims captions; undo restores everything", () => {
      const p = withExtras();
      const plan = planExtract(p, { start: 2, end: 4 }, "op");
      const next = run(p, plan);
      expect(next.timeline.markers.map((m) => [m.id, m.time])).toEqual([
        ["m0", 1],
        ["m2", 5],
      ]);
      const sub = (id: string) => next.timeline.subtitles.find((s) => s.id === id)!;
      expect([sub("s0").startTime, sub("s0").endTime]).toEqual([0, 1.5]);
      expect([sub("s1").startTime, sub("s1").endTime]).toEqual([1, 3]);
      expect([sub("s2").startTime, sub("s2").endTime]).toEqual([4, 5]);
      expect(sub("s3").words!.map((w) => [w.text, w.startTime, w.endTime])).toEqual([
        ["three", 2, 3],
        ["four", 3, 4],
      ]);
      expect(sub("s3").text).toBe("three four");
      const back = undo(p, plan);
      expect(back.timeline.markers).toEqual(p.timeline.markers);
      expect([...back.timeline.subtitles].sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual([...p.timeline.subtitles].sort((a, b) => a.id.localeCompare(b.id)));
    });

    describe("range markers", () => {
      const withRanges = (): Project => {
        const p = withExtras();
        return {
          ...p,
          timeline: {
            ...p.timeline,
            markers: [
              { id: "early", time: 0.5, label: "", color: "red", duration: 1 },
              { id: "span", time: 1, label: "", color: "red", duration: 6 },
              { id: "inside", time: 2.5, label: "", color: "red", duration: 1 },
              { id: "tailStraddle", time: 1.5, label: "", color: "red", duration: 1.5 },
              { id: "headStraddle", time: 3.5, label: "", color: "red", duration: 2 },
              { id: "later", time: 6, label: "", color: "red", duration: 2 },
            ],
          },
        } as unknown as Project;
      };

      it("extract shortens a spanning range, drops a covered one, trims straddlers and shifts later ones", () => {
        const p = withRanges();
        const plan = planExtract(p, { start: 2, end: 4 }, "op");
        const next = run(p, plan);
        const by = (id: string) => next.timeline.markers.find((m) => m.id === id);
        expect(by("early")).toMatchObject({ time: 0.5, duration: 1 });
        expect(by("span")).toMatchObject({ time: 1, duration: 4 });
        expect(by("inside")).toBeUndefined();
        expect(by("tailStraddle")).toMatchObject({ time: 1.5, duration: 0.5 });
        expect(by("headStraddle")).toMatchObject({ time: 2, duration: 1.5 });
        expect(by("later")).toMatchObject({ time: 4, duration: 2 });
        const back = undo(p, plan);
        expect(back.timeline.markers).toEqual(p.timeline.markers);
      });

      it("insert stretches a range marker spanning the insert point and shifts later ones", () => {
        const p = withRanges();
        const media = p.mediaLibrary.items[0];
        const plan = planInsert(
          p, 3,
          [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }],
          "op",
        );
        const next = run(p, plan);
        const by = (id: string) => next.timeline.markers.find((m) => m.id === id);
        expect(by("early")).toMatchObject({ time: 0.5, duration: 1 });
        expect(by("span")).toMatchObject({ time: 1, duration: 8 });
        expect(by("later")).toMatchObject({ time: 8, duration: 2 });
        expect(undo(p, plan).timeline.markers).toEqual(p.timeline.markers);
      });
    });

    it("lift leaves markers and captions alone", () => {
      const p = withExtras();
      const next = run(p, planLift(p, { start: 2, end: 4 }, "op"));
      expect(next.timeline.markers).toEqual(p.timeline.markers);
      expect(next.timeline.subtitles).toEqual(p.timeline.subtitles);
    });

    it("insert ripples markers and splits a caption straddling the insert point", () => {
      const p = withExtras();
      const media = p.mediaLibrary.items[0];
      const plan = planInsert(
        p, 3,
        [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }],
        "op",
      );
      const next = run(p, plan);
      expect(next.timeline.markers.map((m) => [m.id, m.time])).toEqual([
        ["m0", 1], ["m1", 5], ["m2", 9],
      ]);
      // An untimed caption is trimmed to each side with its text divided, never duplicated.
      const subs = next.timeline.subtitles.filter((s) => s.id.startsWith("s1"));
      expect(subs.map((s) => [s.text, s.startTime, s.endTime] as const).sort((a, b) => a[1] - b[1]))
        .toEqual([["over the", 1, 3], ["cut", 5, 7]]);
      const words = next.timeline.subtitles.filter((s) => s.id.startsWith("s3"));
      expect(words.map((s) => [s.text, s.startTime, s.endTime] as const).sort((a, b) => a[1] - b[1]))
        .toEqual([["one", 2, 3], ["two three four", 5, 8]]);
      const back = undo(p, plan);
      expect(back.timeline.subtitles.map((s) => s.id).sort()).toEqual(p.timeline.subtitles.map((s) => s.id).sort());
      expect(back.timeline.markers).toEqual(p.timeline.markers);
    });

    it("keeps an undividable untimed caption whole on the side holding most of it", () => {
      const p = withExtras();
      const single = {
        ...p,
        timeline: {
          ...p.timeline,
          subtitles: [
            { id: "w1", text: "hello", startTime: 1, endTime: 5 },
            { id: "w2", text: "world", startTime: 2.5, endTime: 6 },
          ],
        },
      } as unknown as Project;
      const media = p.mediaLibrary.items[0];
      const next = run(single, planInsert(
        single, 3,
        [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }],
        "op",
      ));
      // w1: 50% before the point -> stays left, trimmed; w2: 14% before -> moves right.
      expect(next.timeline.subtitles.map((s) => [s.id, s.text, s.startTime, s.endTime]))
        .toEqual([["w1", "hello", 1, 3], ["w2", "world", 5, 8]]);
      const total = (text: string) => next.timeline.subtitles.filter((s) => s.text === text).length;
      expect(total("hello")).toBe(1);
      expect(total("world")).toBe(1);
    });

    it("treats a caption with an empty word list as untimed instead of dropping it", () => {
      const p = withExtras();
      const empty = {
        ...p,
        timeline: {
          ...p.timeline,
          subtitles: [{ id: "e1", text: "one two three four", startTime: 1, endTime: 5, words: [] }],
        },
      } as unknown as Project;
      const media = p.mediaLibrary.items[0];
      const next = run(empty, planInsert(
        empty, 3,
        [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }],
        "op",
      ));
      expect(next.timeline.subtitles.map((s) => [s.text, s.startTime, s.endTime]))
        .toEqual([["one two", 1, 3], ["three four", 5, 7]]);
    });

    describe("with a locked track", () => {
      it("extract ripples sequence markers only; captions do not move", () => {
        const p = withExtras(true);
        const plan = planExtract(p, { start: 2, end: 4 }, "op");
        const next = run(p, plan);
        expect(next.timeline.markers.map((m) => [m.id, m.time])).toEqual([["m0", 1], ["m2", 5]]);
        expect(next.timeline.subtitles).toEqual(p.timeline.subtitles);
        const back = undo(p, plan);
        expect(back.timeline.markers).toEqual(p.timeline.markers);
        expect(back.timeline.subtitles).toEqual(p.timeline.subtitles);
      });

      it("insert ripples sequence markers only; captions are neither moved nor split", () => {
        const p = withExtras(true);
        const media = p.mediaLibrary.items[0];
        const plan = planInsert(
          p, 3,
          [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }],
          "op",
        );
        const next = run(p, plan);
        expect(next.timeline.markers.map((m) => [m.id, m.time])).toEqual([["m0", 1], ["m1", 5], ["m2", 9]]);
        expect(next.timeline.subtitles).toEqual(p.timeline.subtitles);
        const back = undo(p, plan);
        expect(back.timeline.subtitles).toEqual(p.timeline.subtitles);
        expect(back.timeline.markers).toEqual(p.timeline.markers);
      });
    });

    it("splits and trims overlay items consistently with clips on extract", () => {
      const p = withExtras();
      const next = run(p, planExtract(p, { start: 2, end: 4 }, "op"));
      const text = next.textClips!;
      expect(text.find((t) => t.id === "t-in")).toBeUndefined();
      const left = text.find((t) => t.id === "t-straddle")!;
      expect([left.startTime, left.duration]).toEqual([1, 1]);
      const right = text.find((t) => t.id.startsWith("t-straddle:split"))!;
      expect([right.startTime, right.duration]).toEqual([2, 1]);
      expect(text.find((t) => t.id === "t-after")!.startTime).toBe(4);
      const back = undo(p, planExtract(p, { start: 2, end: 4 }, "op"));
      expect(back.textClips!.find((t) => t.id === "t-straddle")).toMatchObject({ startTime: 1, duration: 4 });
      expect(back.textClips).toHaveLength(3);
    });

    it("undo restores markers and captions in their exact original order", () => {
      const p = withExtras();
      const media = p.mediaLibrary.items[0];
      const plans = [
        planExtract(p, { start: 2, end: 4 }, "op"),
        planInsert(p, 3, [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }], "op"),
      ];
      for (const plan of plans) {
        const back = undo(p, plan);
        expect(back.timeline.markers).toEqual(p.timeline.markers);
        expect(back.timeline.subtitles).toEqual(p.timeline.subtitles);
        expect(back.textClips).toEqual(p.textClips);
      }
    });

    it("leaves overlay items on locked tracks alone", () => {
      const p = withExtras(true);
      const locked = {
        ...p,
        textClips: [...p.textClips!, { id: "t-locked", trackId: "lk", startTime: 1, duration: 4, text: "x", keyframes: [] }],
      } as unknown as Project;
      const media = locked.mediaLibrary.items[0];
      const next = run(locked, planInsert(
        locked, 3,
        [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 2 }) }],
        "op",
      ));
      expect(next.textClips!.filter((t) => t.trackId === "lk")).toEqual([
        expect.objectContaining({ id: "t-locked", startTime: 1, duration: 4 }),
      ]);
    });

    it("does not split a caption that ends exactly at the insert point", () => {
      const p = withExtras();
      const media = p.mediaLibrary.items[0];
      const next = run(p, planInsert(
        p, 1.5,
        [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 1 }) }],
        "op",
      ));
      const s0 = next.timeline.subtitles.filter((s) => s.id.startsWith("s0"));
      expect(s0.map((s) => [s.startTime, s.endTime])).toEqual([[0, 1.5]]);
    });

    it("splits overlays straddling an insert point and shifts the right piece", () => {
      const p = withExtras();
      const media = p.mediaLibrary.items[0];
      const next = run(p, planInsert(
        p, 2,
        [{ trackId: "v1", clip: createMediaClip(media, "v1", "n", { inPoint: 0, outPoint: 1 }) }],
        "op",
      ));
      const left = next.textClips!.find((t) => t.id === "t-straddle")!;
      const right = next.textClips!.find((t) => t.id.startsWith("t-straddle:split"))!;
      expect([left.startTime, left.duration]).toEqual([1, 1]);
      expect([right.startTime, right.duration]).toEqual([3, 3]);
    });
  });

  describe("track targeting and track creation", () => {
    const base = () => {
      const p = fixture();
      return {
        ...p,
        timeline: {
          ...p.timeline,
          tracks: [
            { ...track("broll", "video", []), name: "B-roll" },
            { ...track("main", "video", []), name: "Main" },
            { ...track("dlg", "audio", []), name: "Dialogue", role: "dialogue" },
            track("music", "audio", []),
            track("locked", "video", [], true),
          ],
        },
      } as unknown as Project;
    };

    it("prefers the explicit target, then the selected track, then Main", () => {
      const p = base();
      const id = (r: ReturnType<typeof chooseTrackForMedia>) =>
        r.kind === "existing" ? r.track.id : r.kind;
      expect(id(chooseTrackForMedia(p, { mediaKind: "video" }))).toBe("main");
      expect(id(chooseTrackForMedia(p, { mediaKind: "video", selectedTrackId: "broll" }))).toBe("broll");
      expect(id(chooseTrackForMedia(p, { mediaKind: "video", selectedTrackId: "broll", targetTrackId: "main" }))).toBe("main");
      // Mismatched or locked preferences fall through.
      expect(id(chooseTrackForMedia(p, { mediaKind: "video", selectedTrackId: "dlg" }))).toBe("main");
      expect(id(chooseTrackForMedia(p, { mediaKind: "video", targetTrackId: "locked" }))).toBe("main");
      expect(id(chooseTrackForMedia(p, { mediaKind: "audio" }))).toBe("dlg");
      expect(id(chooseTrackForMedia(p, { mediaKind: "audio", targetTrackId: "music" }))).toBe("music");
    });

    it("uses the bottom-most video track when none is named Main, never list order", () => {
      const p = base();
      const renamed = {
        ...p,
        timeline: { ...p.timeline, tracks: p.timeline.tracks.map((t) => (t.id === "main" ? { ...t, name: "V1" } : t)) },
      } as Project;
      expect(findMainTrack(renamed, "video")?.id).toBe("main");
    });

    it("asks for a new track when nothing suitable is unlocked", () => {
      const p = base();
      const none = {
        ...p,
        timeline: { ...p.timeline, tracks: p.timeline.tracks.filter((t) => t.type === "audio") },
      } as Project;
      expect(chooseTrackForMedia(none, { mediaKind: "video" })).toEqual({ kind: "create", trackType: "video" });
    });

    it("creates the missing track inside the same insert plan and undoes it with it", () => {
      const p = base();
      const audioOnly = {
        ...p,
        timeline: { ...p.timeline, tracks: p.timeline.tracks.filter((t) => t.type === "audio") },
      } as Project;
      const created = createEmptyTrack(audioOnly, "video", "new-v");
      expect(created.index).toBe(0);
      const media = audioOnly.mediaLibrary.items[0];
      const plan = planInsert(
        audioOnly, 0,
        [{ trackId: "new-v", clip: createMediaClip(media, "new-v", "n", { inPoint: 0, outPoint: 2 }) }],
        "op", [created],
      );
      const next = run(audioOnly, plan);
      expect(next.timeline.tracks[0].id).toBe("new-v");
      expect(next.timeline.tracks[0].clips).toHaveLength(1);
      const back = undo(audioOnly, plan);
      expect(back.timeline.tracks.map((t) => t.id)).toEqual(["dlg", "music"]);
    });

    it("places a video media with audio as one clip, like import does", () => {
      const p = base();
      const media = p.mediaLibrary.items[0];
      expect(media.metadata.channels).toBeGreaterThan(0);
      const next = run(p, planInsert(
        p, 0,
        [{ trackId: "main", clip: createMediaClip(media, "main", "n", { inPoint: 0, outPoint: 2 }) }],
        "op",
      ));
      const placed = next.timeline.tracks.flatMap((t) => t.clips.filter((c) => c.mediaId === media.id));
      expect(placed).toHaveLength(1);
      expect(next.timeline.tracks.find((t) => t.id === "dlg")!.clips).toHaveLength(0);
    });
  });
});
