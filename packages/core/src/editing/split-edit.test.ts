import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Track, Transition } from "../types/timeline";
import type { MediaItem, Project } from "../types/project";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  validateTimelineToolEdits,
} from "./timeline-tool-edit";
import {
  DEFAULT_SPLIT_EDIT_FRAMES,
  findLinkedPartners,
  planEdgeMoves,
  planExtendEdit,
  planSplitEdit,
  prepareEdgeMove,
  splitEditOffsets,
} from "./split-edit";

const FR = 1 / 30;
const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const clip = (
  id: string,
  trackId: string,
  startTime: number,
  inPoint: number,
  outPoint: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  trackId,
  mediaId: "source",
  startTime,
  duration: (outPoint - inPoint) / (extra.speed ?? 1),
  inPoint,
  outPoint,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
  ...extra,
});
const track = (
  id: string,
  type: Track["type"],
  clips: Clip[],
  extra: Partial<Track> = {},
): Track => ({
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

/** Two linked A/V pairs: A 0-4 (src 5-9) and B 4-8 (src 10-14); media is 40s. */
function fixture(): Project {
  const media = {
    id: "source",
    name: "Source.mp4",
    type: "video",
    fileHandle: null,
    blob: new Blob(["source"]),
    thumbnailUrl: null,
    waveformData: null,
    metadata: {
      duration: 40,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 6,
    },
  } as unknown as MediaItem;
  const link = (id: string) => ({ metadata: { separatedFromClipId: id } });
  return {
    id: "project",
    name: "Split edits",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media] },
    timeline: {
      tracks: [
        track("main", "video", [clip("vA", "main", 0, 5, 9), clip("vB", "main", 4, 10, 14)]),
        track("dialogue", "audio", [
          clip("aA", "dialogue", 0, 5, 9, link("vA")),
          clip("aB", "dialogue", 4, 10, 14, link("vB")),
        ]),
      ],
      duration: 8,
      markers: [],
      subtitles: [],
    },
    textClips: [],
  } as unknown as Project;
}
const find = (p: Project, id: string) =>
  p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const patch = (p: Project, id: string, change: Partial<Clip>) => {
  for (const t of p.timeline.tracks)
    Object.assign(t, { clips: t.clips.map((c) => (c.id === id ? { ...c, ...change } : c)) });
};
/** Give a clip its own, short media so only its tail handle is tight. */
const shortMediaFor = (p: Project, id: string, duration: number) => {
  const source = p.mediaLibrary.items[0];
  p.mediaLibrary.items.push({
    ...source,
    id: "short",
    metadata: { ...source.metadata, duration },
  } as MediaItem);
  patch(p, id, { mediaId: "short" });
};
function apply(p: Project, edits: Parameters<typeof applyTimelineToolEdits>[1]) {
  validateTimelineToolEdits(p, edits);
  return applyTimelineToolEdits(p, edits);
}
const idsOf = (plan: { edits: Array<{ id: string }> }) => plan.edits.map((e) => e.id).sort();

// applyTimelineToolEdits stamps modifiedAt with Date.now(); freeze the clock so
// deep-equality comparisons between two applies cannot straddle a millisecond.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("L-cut and J-cut", () => {
  it("L-cut: the audio cut moves 12 frames later, the video cut and clip content stay put", () => {
    const p = fixture();
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" });
    expect(DEFAULT_SPLIT_EDIT_FRAMES).toBe(12);
    const next = apply(p, plan.edits);
    const d = 12 * FR;
    expect(find(next, "aA").duration).toBeCloseTo(4 + d, 9);
    expect(find(next, "aA").outPoint).toBeCloseTo(9 + d, 9);
    expect(find(next, "aB").startTime).toBeCloseTo(4 + d, 9);
    expect(find(next, "aB").duration).toBeCloseTo(4 - d, 9);
    expect(find(next, "aB").inPoint).toBeCloseTo(10 + d, 9);
    expect(find(next, "aB").outPoint).toBe(14);
    expect(find(next, "vA")).toBe(find(p, "vA"));
    expect(find(next, "vB")).toBe(find(p, "vB"));
    expect(idsOf(plan)).toEqual(["aA", "aB"]);
    expect(plan.label).toBe("L-cut");
    expect(plan.moves).toEqual([
      expect.objectContaining({ clipId: "aA", edge: "right", rolledNeighborId: "aB" }),
    ]);
  });

  it("J-cut: the audio of the next clip leads by 12 frames", () => {
    const p = fixture();
    const plan = planSplitEdit(p, { clipId: "aB", edge: "left", kind: "j" });
    const next = apply(p, plan.edits);
    const d = 12 * FR;
    expect(find(next, "aA").duration).toBeCloseTo(4 - d, 9);
    expect(find(next, "aB").startTime).toBeCloseTo(4 - d, 9);
    expect(find(next, "aB").inPoint).toBeCloseTo(10 - d, 9);
    expect(find(next, "vB").startTime).toBe(4);
  });

  it("works from the video clip when its linked partners are given", () => {
    const p = fixture();
    const fromAudio = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", frames: 6 });
    const fromVideo = planSplitEdit(p, {
      clipId: "vA",
      edge: "right",
      partnerIds: ["aA"],
      kind: "l",
      frames: 6,
    });
    // Compare the timelines: apply() stamps modifiedAt from the clock, which can tick between the two calls.
    expect(apply(p, fromVideo.edits).timeline).toEqual(apply(p, fromAudio.edits).timeline);
  });

  it("is idempotent: the offset is measured from the video cut, not accumulated", () => {
    const p = fixture();
    const once = apply(p, planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" }).edits);
    const again = planSplitEdit(once, { clipId: "aA", edge: "right", kind: "l" });
    expect(again.edits).toEqual([]);
    expect(again.moves[0].applied).toBe(0);
  });

  it("switches a J-cut into an L-cut by measuring from the video cut", () => {
    const p = fixture();
    const j = apply(p, planSplitEdit(p, { clipId: "aA", edge: "right", kind: "j", frames: 5 }).edits);
    const l = apply(j, planSplitEdit(j, { clipId: "aA", edge: "right", kind: "l", frames: 5 }).edits);
    expect(find(l, "aA").duration).toBeCloseTo(4 + 5 * FR, 9);
  });

  it("the pair stays linked and the offset is reported", () => {
    const p = fixture();
    const next = apply(p, planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" }).edits);
    const partners = findLinkedPartners(find(next, "aA"), next.timeline.tracks);
    expect(partners.map((x) => x.clip.id)).toEqual(["vA"]);
    // The tail that now overlaps the next shot does not steal its partner.
    const tracks = next.timeline.tracks;
    expect(findLinkedPartners(find(next, "vB"), tracks).map((x) => x.clip.id)).toEqual(["aB"]);
    expect(findLinkedPartners(find(next, "aB"), tracks).map((x) => x.clip.id)).toEqual(["vB"]);
    const offset = splitEditOffsets(find(next, "aA"), next.timeline.tracks, 30)!;
    expect(offset.end).toBeCloseTo(12 * FR, 9);
    expect(offset.start).toBeCloseTo(0, 9);
    expect(offset.partnerId).toBe("vA");
    expect(splitEditOffsets(find(p, "aA"), p.timeline.tracks, 30)).toBeNull();
    // B's audio now starts late: a negative-to-positive start offset on that clip.
    expect(splitEditOffsets(find(next, "aB"), next.timeline.tracks, 30)!.start).toBeCloseTo(12 * FR, 9);
  });

  it("is one exact undo step: inverting the edits restores every clip", () => {
    const p = fixture();
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" });
    const next = apply(p, plan.edits);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.timeline).toEqual(p.timeline);
  });

  it("can offset the video instead of the audio", () => {
    const p = fixture();
    const plan = planSplitEdit(p, {
      clipId: "aA",
      edge: "right",
      partnerIds: ["vA"],
      kind: "l",
      side: "video",
      frames: 3,
    });
    const next = apply(p, plan.edits);
    expect(find(next, "vA").duration).toBeCloseTo(4 + 3 * FR, 9);
    expect(find(next, "aA")).toBe(find(p, "aA"));
  });

  it("without a linked clip on the other side there is nothing to offset from", () => {
    const p = fixture();
    p.timeline.tracks[0] = { ...p.timeline.tracks[0], clips: [] };
    expect(() => planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" })).toThrow(
      /linked video and audio/,
    );
    expect(() =>
      planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", side: "video" }),
    ).toThrow(/linked video and audio/);
  });

  it("at the end of the last clip it extends the audio tail into free space", () => {
    const p = fixture();
    const plan = planSplitEdit(p, { clipId: "aB", edge: "right", kind: "l", frames: 12 });
    const next = apply(p, plan.edits);
    expect(find(next, "aB").duration).toBeCloseTo(4 + 12 * FR, 9);
    expect(find(next, "aB").outPoint).toBeCloseTo(14 + 12 * FR, 9);
    expect(plan.moves[0].rolledNeighborId).toBeUndefined();
  });
});

describe("limits", () => {
  it("cannot extend beyond the available media", () => {
    const p = fixture();
    shortMediaFor(p, "aA", 9.2); // A's audio has 0.2s of tail handle left
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", frames: 12 });
    expect(plan.moves[0].applied).toBeCloseTo(6 * FR, 9);
    expect(plan.moves[0].limit).toBe("source-handle");
    const next = apply(p, plan.edits);
    expect(find(next, "aA").outPoint).toBeCloseTo(9.2, 9);
  });

  it("an extension with no handle at all changes nothing", () => {
    const p = fixture();
    shortMediaFor(p, "aA", 9);
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" });
    expect(plan.edits).toEqual([]);
    expect(plan.moves[0]).toMatchObject({ applied: 0, limit: "source-handle" });
  });

  it("a J-cut is limited by the next clip's head handle", () => {
    const p = fixture();
    patch(p, "aB", { inPoint: 0.2, outPoint: 4.2 });
    const plan = planSplitEdit(p, { clipId: "aB", edge: "left", kind: "j", frames: 12, partnerIds: ["vB"] });
    expect(plan.moves[0].applied).toBeCloseTo(-6 * FR, 9);
    expect(plan.moves[0].limit).toBe("source-handle");
    expect(find(apply(p, plan.edits), "aB").inPoint).toBeCloseTo(0, 9);
  });

  it("a roll is limited by the neighbour's source handle too", () => {
    const p = fixture();
    patch(p, "aB", { inPoint: 0.2, outPoint: 4.2 });
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "j", frames: 12 });
    expect(plan.moves[0].applied).toBeCloseTo(-6 * FR, 9);
    expect(plan.moves[0].limit).toBe("neighbor-handle");
  });

  it("never trims a clip below one frame", () => {
    const p = fixture();
    const plan = planEdgeMoves(p, [{ clipId: "aB", edge: "left", delta: 50 }]);
    expect(plan.moves[0].limit).toBe("minimum-length");
    const next = apply(p, plan.edits);
    expect(find(next, "aB").duration).toBeCloseTo(FR, 9);
    expect(find(next, "aA").duration).toBeCloseTo(8 - FR, 9);
  });

  it("stops at the timeline start", () => {
    const p = fixture();
    const plan = planSplitEdit(p, { clipId: "aA", edge: "left", kind: "j" });
    expect(plan.edits).toEqual([]);
    expect(plan.moves[0].limit).toBe("timeline-start");
  });

  it("extending into a gap stops at the next clip", () => {
    const p = fixture();
    patch(p, "aB", { startTime: 4.5, duration: 3.5, inPoint: 10.5 });
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", frames: 30 });
    expect(plan.moves[0].applied).toBeCloseTo(0.5, 9);
    expect(plan.moves[0].limit).toBe("gap");
    expect(plan.moves[0].rolledNeighborId).toBeUndefined();
    const next = apply(p, plan.edits);
    expect(find(next, "aB")).toBe(find(p, "aB"));
  });

  it("trimming back from a gap leaves the neighbour alone", () => {
    const p = fixture();
    patch(p, "aB", { startTime: 4.5, duration: 3.5, inPoint: 10.5 });
    const plan = planEdgeMoves(p, [{ clipId: "aA", edge: "right", delta: -1 }]);
    expect(idsOf(plan)).toEqual(["aA"]);
    expect(find(apply(p, plan.edits), "aA").duration).toBeCloseTo(3, 9);
  });

  it("extending the head leftwards stops at the previous clip across a gap", () => {
    const p = fixture();
    patch(p, "aB", { startTime: 4.5, duration: 3.5, inPoint: 10.5 });
    const plan = planEdgeMoves(p, [{ clipId: "aB", edge: "left", delta: -2 }]);
    expect(plan.moves[0]).toMatchObject({ limit: "gap" });
    expect(plan.moves[0].applied).toBeCloseTo(-0.5, 9);
  });

  it("refuses locked tracks", () => {
    const p = fixture();
    p.timeline.tracks[1] = { ...p.timeline.tracks[1], locked: true };
    expect(() => planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" })).toThrow(/Unlock/);
  });

  it("composes with a caller-defined editable policy (e.g. a sync lock)", () => {
    const p = fixture();
    const isTrackEditable = (t: Track) => !t.locked && t.id !== "dialogue";
    expect(() =>
      planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", isTrackEditable }),
    ).toThrow(/Unlock/);
    expect(() =>
      planEdgeMoves(p, [{ clipId: "vA", edge: "right", delta: -FR }], { isTrackEditable }),
    ).not.toThrow();
  });

  it("refuses a neighbour on a locked track-equivalent: both clips must be editable", () => {
    const p = fixture();
    p.timeline.tracks[0] = { ...p.timeline.tracks[0], locked: true };
    expect(() => planEdgeMoves(p, [{ clipId: "vA", edge: "right", delta: FR }])).toThrow(/Unlock/);
    // The unlocked audio side is still editable on its own.
    expect(() => planEdgeMoves(p, [{ clipId: "aA", edge: "right", delta: FR }])).not.toThrow();
  });

  it("refuses speed ramps and freeze frames (non-linear source time)", () => {
    const p = fixture();
    patch(p, "aA", { freezeFrames: [{ id: "f", time: 1, duration: 1 }] } as unknown as Partial<Clip>);
    expect(() => planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l" })).toThrow(/speed ramps/);
  });

  it("handles a reversed clip: its tail extends toward the source start", () => {
    const p = fixture();
    patch(p, "aB", { reversed: true });
    const plan = planEdgeMoves(p, [{ clipId: "aB", edge: "right", delta: 1 }]);
    const next = apply(p, plan.edits);
    expect(find(next, "aB").duration).toBeCloseTo(5, 9);
    expect(find(next, "aB").inPoint).toBeCloseTo(9, 9);
    expect(find(next, "aB").outPoint).toBe(14);
  });

  it("scales the source move by playback speed", () => {
    const p = fixture();
    patch(p, "aB", { speed: 2, duration: 2 });
    const plan = planEdgeMoves(p, [{ clipId: "aB", edge: "right", delta: 0.5 }]);
    const next = apply(p, plan.edits);
    expect(find(next, "aB").duration).toBeCloseTo(2.5, 9);
    expect(find(next, "aB").outPoint).toBeCloseTo(15, 9);
  });

  it("rejects non-finite input", () => {
    const p = fixture();
    expect(() => planEdgeMoves(p, [{ clipId: "aA", edge: "right", delta: Number.NaN }])).toThrow(/finite/);
    expect(() => planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", frames: -1 })).toThrow();
    expect(() => planEdgeMoves(p, [{ clipId: "nope", edge: "right", delta: 1 }])).toThrow(/no longer/);
  });
});

describe("off-grid edit points", () => {
  it("Extend Edit lands exactly on the playhead even when the edge is off the frame grid", () => {
    const p = fixture();
    patch(p, "vA", { duration: 4.0123 });
    patch(p, "vB", { startTime: 4.0123, duration: 3.9877 });
    const plan = planExtendEdit(p, { clipIds: ["vA"], edge: "right", time: 4.5, side: "video" });
    const next = apply(p, plan.edits);
    expect(find(next, "vA").duration).toBeCloseTo(4.5, 9);
    expect(find(next, "vB").startTime).toBeCloseTo(4.5, 9);
  });

  it("an L-cut is exactly N frames after the picture cut even when the audio cut is off-grid", () => {
    const p = fixture();
    patch(p, "aA", { duration: 4.0123 });
    patch(p, "aB", { startTime: 4.0123, duration: 3.9877 });
    const plan = planSplitEdit(p, { clipId: "aA", edge: "right", kind: "l", frames: 12 });
    const next = apply(p, plan.edits);
    expect(find(next, "aA").duration).toBeCloseTo(4 + 12 * FR, 9);
    expect(find(next, "aB").startTime).toBeCloseTo(4 + 12 * FR, 9);
    expect(planSplitEdit(next, { clipId: "aA", edge: "right", kind: "l", frames: 12 }).edits).toHaveLength(0);
  });
});

describe("extend edit", () => {
  it("extends both sides to the playhead: a plain rolling edit on each track", () => {
    const p = fixture();
    const plan = planExtendEdit(p, { clipIds: ["vA", "aA"], edge: "right", time: 4.5 });
    const next = apply(p, plan.edits);
    for (const id of ["vA", "aA"]) expect(find(next, id).duration).toBeCloseTo(4.5, 9);
    for (const id of ["vB", "aB"]) expect(find(next, id).startTime).toBeCloseTo(4.5, 9);
    expect(plan.label).toBe("Extend edit");
  });

  it("video only moves just the picture cut; audio only just the sound cut", () => {
    const p = fixture();
    const v = planExtendEdit(p, { clipIds: ["vA", "aA"], edge: "right", time: 4.5, side: "video" });
    expect(idsOf(v)).toEqual(["vA", "vB"]);
    expect(v.label).toBe("Extend video edit");
    const a = planExtendEdit(p, { clipIds: ["vA", "aA"], edge: "right", time: 3.5, side: "audio" });
    expect(idsOf(a)).toEqual(["aA", "aB"]);
    expect(find(apply(p, a.edits), "aB").startTime).toBeCloseTo(3.5, 9);
    expect(a.label).toBe("Extend audio edit");
  });

  it("shortens when the playhead is before the edit", () => {
    const p = fixture();
    const next = apply(p, planExtendEdit(p, { clipIds: ["vA"], edge: "right", time: 3 }).edits);
    expect(find(next, "vA").duration).toBeCloseTo(3, 9);
    expect(find(next, "vA").outPoint).toBeCloseTo(8, 9);
  });

  it("extends a head edge (left) to the playhead", () => {
    const p = fixture();
    const next = apply(p, planExtendEdit(p, { clipIds: ["aB"], edge: "left", time: 3.5 }).edits);
    expect(find(next, "aB").startTime).toBeCloseTo(3.5, 9);
    expect(find(next, "aB").inPoint).toBeCloseTo(9.5, 9);
    expect(find(next, "aA").duration).toBeCloseTo(3.5, 9);
  });

  it("clamps each side by its own handles and reports the clamp", () => {
    const p = fixture();
    patch(p, "aB", { inPoint: 0.2, outPoint: 4.2 });
    const early = planExtendEdit(p, { clipIds: ["vB", "aB"], edge: "left", time: 3 });
    const byId = Object.fromEntries(early.moves.map((m) => [m.clipId, m]));
    expect(byId.vB.applied).toBeCloseTo(-1, 9);
    expect(byId.aB.applied).toBeCloseTo(-0.2, 9);
    expect(byId.aB.limit).toBe("source-handle");
  });

  it("does nothing when the edit already sits on the playhead", () => {
    const p = fixture();
    const plan = planExtendEdit(p, { clipIds: ["vA", "aA"], edge: "right", time: 4 });
    expect(plan.edits).toEqual([]);
    expect(plan.moves).toEqual([]);
  });

  it("two moves meeting at one cut compose against the evolving state", () => {
    const p = fixture();
    const plan = planEdgeMoves(p, [
      { clipId: "aA", edge: "right", delta: 0.4 },
      { clipId: "aB", edge: "left", delta: 0.4 },
    ]);
    const next = apply(p, plan.edits);
    expect(find(next, "aA").duration).toBeCloseTo(4.8, 9);
    expect(find(next, "aB").startTime).toBeCloseTo(4.8, 9);
    expect(plan.edits.filter((e) => e.id === "aA")).toHaveLength(1);
  });

  it("extend is one exact undo step", () => {
    const p = fixture();
    const plan = planExtendEdit(p, { clipIds: ["vA", "aA"], edge: "right", time: 4.5 });
    const next = apply(p, plan.edits);
    expect(applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits)).timeline).toEqual(p.timeline);
  });

  it("rejects a bad playhead", () => {
    expect(() => planExtendEdit(fixture(), { clipIds: ["aA"], edge: "right", time: -1 })).toThrow();
  });
});

describe("prepared drag edit (Alt-drag)", () => {
  it("previews without touching the project and matches the committed plan", () => {
    const p = fixture();
    const snapshot = JSON.stringify(p);
    const prepared = prepareEdgeMove(p, { clipId: "aA", edge: "right" });
    const preview = prepared.preview(0.4);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(preview.delta).toBeCloseTo(0.4, 9);
    expect(preview.duration).toBeCloseTo(4.4, 9);
    expect(preview.neighbors?.[0]).toMatchObject({ trackId: "dialogue" });
    expect(preview.neighbors?.[0].startTime).toBeCloseTo(4.4, 9);
    const plan = prepared.plan(0.4);
    expect(plan.delta).toBeCloseTo(0.4, 9);
    expect(idsOf(plan)).toEqual(["aA", "aB"]);
    expect(find(apply(p, plan.edits), "vB")).toBe(find(p, "vB"));
  });

  it("snaps to whole frames and clamps in the preview", () => {
    const p = fixture();
    shortMediaFor(p, "aA", 9.1);
    const prepared = prepareEdgeMove(p, { clipId: "aA", edge: "right" });
    expect(prepared.preview(0.4).delta).toBeCloseTo(3 * FR, 9);
    expect(prepared.preview(0.016).delta).toBe(0);
  });

  it("fails at pointer-down for a locked track", () => {
    const p = fixture();
    p.timeline.tracks[1] = { ...p.timeline.tracks[1], locked: true };
    expect(() => prepareEdgeMove(p, { clipId: "aA", edge: "right" })).toThrow(/Unlock/);
  });

  it("is a video-only roll when the video handle is grabbed", () => {
    const p = fixture();
    const plan = prepareEdgeMove(p, { clipId: "vB", edge: "left" }).plan(-0.4);
    expect(idsOf(plan)).toEqual(["vA", "vB"]);
    expect(find(apply(p, plan.edits), "aB")).toBe(find(p, "aB"));
  });
});

describe("side effects on attached data", () => {
  it("captions follow a shrinking source clip", () => {
    const p = fixture();
    (p as { textClips: unknown }).textClips = [
      { id: "cap", trackId: "main", startTime: 3, duration: 1, metadata: { captionSourceClipId: "vA" }, keyframes: [] },
    ];
    const plan = planEdgeMoves(p, [{ clipId: "vA", edge: "right", delta: -0.5 }]);
    const caption = plan.edits.find((e) => e.id === "cap")!;
    expect(caption).toBeDefined();
    expect((caption.after as { duration: number }).duration).toBeCloseTo(0.5, 9);
    const next = apply(p, plan.edits);
    expect(next.textClips![0].duration).toBeCloseTo(0.5, 9);
  });

  it("captions on an extended clip are left alone", () => {
    const p = fixture();
    (p as { textClips: unknown }).textClips = [
      { id: "cap", trackId: "main", startTime: 3, duration: 1, metadata: { captionSourceClipId: "vA" }, keyframes: [] },
    ];
    const plan = planEdgeMoves(p, [{ clipId: "vA", edge: "right", delta: 0.5 }]);
    expect(plan.edits.some((e) => e.id === "cap")).toBe(false);
  });

  it("a transition longer than a shrunken clip is shortened", () => {
    const p = fixture();
    const transition = {
      id: "t",
      type: "crossfade",
      duration: 3.5,
      clipAId: "vA",
      clipBId: "vB",
    } as unknown as Transition;
    p.timeline.tracks[0] = { ...p.timeline.tracks[0], transitions: [transition] };
    const plan = planEdgeMoves(p, [{ clipId: "vB", edge: "left", delta: 1 }]);
    const edit = plan.edits.find((e) => e.kind === "transition")!;
    expect((edit.after as Transition).duration).toBeCloseTo(3, 9);
    expect(applyTimelineToolEdits(apply(p, plan.edits), invertTimelineToolEdits(plan.edits)).timeline).toEqual(
      p.timeline,
    );
  });
});
