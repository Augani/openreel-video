import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import {
  createMediaClip,
  planAddEdit,
  planExtract,
  planInsert,
  planLift,
  planOverwrite,
} from "./premiere-edits";
import {
  planCloseGap,
  planCloseGapBeforeClip,
  planRemoveGaps,
  planRippleDelete,
  planSilenceCut,
} from "./ripple-delete";
import { planExtendEdit, planSplitEdit } from "./split-edit";
import { SyncLockBlockedError } from "./sync-lock";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  prepareTimelineToolEdit,
  validateTimelineToolEdits,
  type TimelineToolMode,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

/**
 * LOCK MATRIX: every edit command x follower track state (locked / sync lock
 * on / sync lock off) x content (clear / overlapping the edit) x targeted or
 * untargeted. Invariants:
 *  - a locked track never changes, whatever else is going on;
 *  - a track with Sync Lock off is never touched by an edit it is not part of
 *    (except by commands that cut every unlocked track by design);
 *  - a sync-locked follower either stays aligned with the edit point (what is
 *    after the edit moves by exactly the time the edit added or removed) or the
 *    whole edit is blocked with SyncLockBlockedError naming it;
 *  - a plan that applies is undone exactly by its inverse.
 */
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
  mediaId = "media",
): Clip => ({
  id,
  mediaId,
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
const track = (id: string, type: Track["type"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id,
  name: id.toUpperCase(),
  type,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...extra,
});
const media = {
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
    hasAudio: true,
  },
};
const makeProject = (tracks: Track[]): Project =>
  ({
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media, { ...media, id: "other" }] },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
  }) as unknown as Project;

type FollowerState = "locked" | "on" | "off";
type Setup = "base" | "gap" | "av" | "paste";

interface Command {
  name: string;
  setup?: Setup;
  /** Content the follower holds inside the range the edit removes/cuts. */
  overlap: [number, number];
  /** Clips starting at/after this time must end up `shift` later. */
  checkFrom: number;
  shift: number;
  /** The edit is blocked by overlapping content on a sync-locked follower. */
  blocks: (targeted: boolean) => boolean;
  /** Commands that cut/split every unlocked track (also sync-off ones) by design. */
  touchesSyncOff?: (targeted: boolean) => boolean;
  build: (p: Project, targeted: boolean) => TimelineToolPlan;
}

const placement = (trackId: string, length: number, offset?: number) => ({
  trackId,
  offset,
  clip: createMediaClip(media as never, trackId, `new-${trackId}`, { inPoint: 0, outPoint: length }),
});
const tool = (mode: TimelineToolMode, itemId: string, delta: number, edge: "left" | "right" = "right") =>
  (p: Project) => prepareTimelineToolEdit(p, { mode, itemId, edge }).plan(delta);
const never = () => false;
const RANGE = { start: 2, end: 4 };

const COMMANDS: Command[] = [
  {
    name: "ripple delete",
    overlap: [7, 9],
    checkFrom: 12,
    shift: -6,
    blocks: () => true,
    build: (p) => planRippleDelete(p, ["v-b"], "op"),
  },
  {
    name: "extract",
    overlap: [3, 3.8],
    checkFrom: 4,
    shift: -2,
    blocks: (targeted) => targeted,
    build: (p, targeted) => planExtract(p, RANGE, "op", targeted ? ["v1"] : undefined),
  },
  {
    name: "lift",
    overlap: [3, 3.8],
    checkFrom: 4,
    shift: 0,
    blocks: never,
    touchesSyncOff: (targeted) => !targeted,
    build: (p, targeted) => planLift(p, RANGE, "op", targeted ? ["v1"] : undefined),
  },
  {
    name: "insert",
    overlap: [2, 5],
    checkFrom: 3,
    shift: 2,
    blocks: never,
    build: (p) => planInsert(p, 3, [placement("v1", 2)], "op"),
  },
  {
    name: "overwrite",
    overlap: [2, 5],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => planOverwrite(p, 3, [placement("v1", 2)], "op"),
  },
  {
    name: "paste insert",
    setup: "paste",
    overlap: [2, 5],
    checkFrom: 3,
    shift: 3,
    blocks: never,
    build: (p) => planInsert(p, 3, [placement("v1", 2, 0), placement("a1", 2, 1)], "op"),
  },
  {
    name: "ripple trim (shorten)",
    overlap: [4.2, 5],
    checkFrom: 6,
    shift: -2,
    blocks: () => true,
    build: (p) => tool("ripple", "v-a", -2)(p),
  },
  {
    name: "ripple trim (lengthen)",
    overlap: [5, 7],
    checkFrom: 6,
    shift: 2,
    blocks: never,
    build: (p) => tool("ripple", "v-a", 2)(p),
  },
  {
    name: "roll",
    overlap: [5, 7],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => tool("roll", "v-a", 1)(p),
  },
  {
    name: "slip",
    overlap: [5, 7],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => tool("slip", "v-a", 1, "right")(p),
  },
  {
    name: "slide",
    overlap: [5, 7],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => tool("slide", "v-b", 1)(p),
  },
  {
    name: "rate stretch",
    overlap: [5, 7],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => tool("stretch", "v-b", -1)(p),
  },
  {
    name: "split edit (J-cut)",
    setup: "av",
    overlap: [5, 7],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => planSplitEdit(p, { clipId: "v-a", edge: "right", kind: "j", frames: 12 }),
  },
  {
    name: "extend edit",
    setup: "av",
    overlap: [5, 7],
    checkFrom: 0,
    shift: 0,
    blocks: never,
    build: (p) => planExtendEdit(p, { clipIds: ["v-a", "a-a"], edge: "right", time: 6.5 }),
  },
  {
    name: "close gap",
    setup: "gap",
    overlap: [4.5, 5.5],
    checkFrom: 6,
    shift: -2,
    blocks: () => true,
    build: (p) => planCloseGap(p, "v1", { start: 4, end: 6 }, "op"),
  },
  {
    name: "close gap before clip",
    setup: "gap",
    overlap: [4.5, 5.5],
    checkFrom: 6,
    shift: -2,
    blocks: () => true,
    build: (p) => planCloseGapBeforeClip(p, "v-b", "op"),
  },
  {
    name: "remove gaps",
    setup: "gap",
    overlap: [4.5, 5.5],
    checkFrom: 6,
    shift: -2,
    blocks: () => true,
    build: (p) => planRemoveGaps(p, "v1", "op"),
  },
  {
    name: "silence cut",
    overlap: [3, 3.5],
    checkFrom: 4,
    shift: -2,
    blocks: () => true,
    build: (p) => planSilenceCut(p, "v-a", [{ start: 2, end: 4 }], "op"),
  },
  {
    name: "add edit",
    overlap: [2.5, 3.5],
    checkFrom: 10,
    shift: 0,
    blocks: never,
    touchesSyncOff: (targeted) => !targeted,
    build: (p, targeted) => planAddEdit(p, 3, "op", targeted ? ["v1"] : undefined),
  },
];

function layout(command: Command, state: FollowerState, overlapping: boolean): Project {
  const setup = command.setup ?? "base";
  const v1 =
    setup === "gap"
      ? [clip("v-a", "v1", 0, 4), clip("v-b", "v1", 6, 6, 20), clip("v-c", "v1", 12, 4, 30)]
      : [clip("v-a", "v1", 0, 6), clip("v-b", "v1", 6, 6, 20), clip("v-c", "v1", 12, 4, 30)];
  // Different media, so split-edit/link detection never pairs them with V1.
  const followerClips = [clip("fo-1", "fo", 14, 2, 0, "other")];
  if (overlapping)
    followerClips.push(clip("fo-x", "fo", command.overlap[0], command.overlap[1] - command.overlap[0], 5, "other"));
  const tracks = [
    track("v1", "video", v1),
    track("fo", "audio", followerClips, {
      locked: state === "locked",
      ...(state === "off" ? { syncLock: false } : {}),
    }),
    track("lk", "audio", [clip("lk-1", "lk", 0, 12, 40, "other")], { locked: true }),
  ];
  if (setup === "av")
    tracks.push(
      track("a1", "audio", [clip("a-a", "a1", 0, 6), clip("a-b", "a1", 6, 6, 20), clip("a-c", "a1", 12, 4, 30)]),
    );
  if (setup === "paste") tracks.push(track("a1", "audio", []));
  return makeProject(tracks);
}

const clipsOf = (p: Project, id: string) => p.timeline.tracks.find((t) => t.id === id)!.clips;
const snapshot = (p: Project, id: string) =>
  JSON.stringify([...clipsOf(p, id)].sort((a, b) => a.id.localeCompare(b.id)));
const fullSnapshot = (p: Project) =>
  JSON.stringify(
    p.timeline.tracks.map((t) => ({
      id: t.id,
      clips: [...t.clips].sort((a, b) => a.id.localeCompare(b.id)),
      transitions: t.transitions,
    })),
  );

describe("lock matrix", () => {
  for (const command of COMMANDS) {
    describe(command.name, () => {
      for (const state of ["locked", "on", "off"] as FollowerState[])
        for (const overlapping of [false, true])
          for (const targeted of [true, false]) {
            const label = `follower ${state}${overlapping ? " + overlapping content" : ""}, ${targeted ? "targeted" : "untargeted"}`;
            it(label, () => {
              const before = layout(command, state, overlapping);
              let plan: TimelineToolPlan | undefined;
              let error: unknown;
              try {
                plan = command.build(before, targeted);
              } catch (caught) {
                error = caught;
              }
              const expectBlocked = state === "on" && overlapping && command.blocks(targeted);
              if (expectBlocked) {
                expect(error, "blocked by the sync-locked follower").toBeInstanceOf(SyncLockBlockedError);
                expect((error as SyncLockBlockedError).trackId).toBe("fo");
                return;
              }
              if (error) throw error;
              const edits = plan!.edits;
              validateTimelineToolEdits(before, edits);
              const after = applyTimelineToolEdits(before, edits);

              // A locked track never changes.
              expect(snapshot(after, "lk")).toBe(snapshot(before, "lk"));
              if (state === "locked") expect(snapshot(after, "fo")).toBe(snapshot(before, "fo"));
              if (state === "off") {
                if (command.touchesSyncOff?.(targeted)) {
                  // Cut by design, but nothing outside the cut moves.
                  const kept = (p: Project) => JSON.stringify(clipsOf(p, "fo").filter((c) => c.id === "fo-1"));
                  expect(kept(after)).toBe(kept(before));
                }
                else expect(snapshot(after, "fo")).toBe(snapshot(before, "fo"));
              }
              // A sync-locked follower stays aligned with the edit point.
              if (state === "on") {
                for (const original of clipsOf(before, "fo").filter((c) => c.startTime >= command.checkFrom - 1e-6)) {
                  const moved = clipsOf(after, "fo").find((c) => c.id === original.id);
                  expect(moved, `${original.id} survives`).toBeDefined();
                  expect(moved!.startTime).toBeCloseTo(original.startTime + command.shift, 5);
                  expect(moved!.duration).toBeCloseTo(original.duration, 5);
                }
              }
              // One plan, one exact undo.
              const back = invertTimelineToolEdits(edits);
              validateTimelineToolEdits(after, back);
              expect(fullSnapshot(applyTimelineToolEdits(after, back))).toBe(fullSnapshot(before));
            });
          }
    });
  }
});

describe("planSilenceCut", () => {
  it("cuts several regions as one plan, shifting a clear follower once per region", () => {
    const p = makeProject([
      track("v1", "video", [clip("v-a", "v1", 0, 12)]),
      track("fo", "audio", [clip("fo-1", "fo", 20, 2)]),
    ]);
    const plan = planSilenceCut(
      p,
      "v-a",
      [
        { start: 2, end: 3 },
        { start: 6, end: 8 },
      ],
      "op",
    );
    const after = applyTimelineToolEdits(p, plan.edits);
    const v1 = [...clipsOf(after, "v1")].sort((a, b) => a.startTime - b.startTime);
    expect(v1.map((c) => [c.startTime, c.duration])).toEqual([
      [0, 2],
      [2, 3],
      [5, 4],
    ]);
    expect(clipsOf(after, "fo")[0].startTime).toBeCloseTo(17, 5);
    expect(plan.label).toBe("Cut silence");
  });

  it("refuses a locked clip track and overlapping regions", () => {
    const p = makeProject([track("v1", "video", [clip("v-a", "v1", 0, 12)], { locked: true })]);
    expect(() => planSilenceCut(p, "v-a", [{ start: 1, end: 2 }], "op")).toThrow(/Unlock/);
    const q = makeProject([track("v1", "video", [clip("v-a", "v1", 0, 12)])]);
    expect(() =>
      planSilenceCut(q, "v-a", [{ start: 1, end: 3 }, { start: 2, end: 4 }], "op"),
    ).toThrow(/overlap/);
  });
});

describe("planRemoveGaps", () => {
  it("closes leading and inner gaps together and shifts clear followers by each", () => {
    const p = makeProject([
      track("v1", "video", [clip("v-a", "v1", 1, 2), clip("v-b", "v1", 5, 2, 10)]),
      track("fo", "audio", [clip("fo-1", "fo", 10, 2)]),
    ]);
    const after = applyTimelineToolEdits(p, planRemoveGaps(p, "v1", "op").edits);
    expect(clipsOf(after, "v1").map((c) => c.startTime)).toEqual([0, 2]);
    expect(clipsOf(after, "fo")[0].startTime).toBeCloseTo(7, 5);
  });

  it("is a no-op on a packed track", () => {
    const p = makeProject([track("v1", "video", [clip("v-a", "v1", 0, 2), clip("v-b", "v1", 2, 2, 10)])]);
    expect(planRemoveGaps(p, "v1", "op").edits).toEqual([]);
  });

  it("shifts text lanes on the track with the clips", () => {
    const p = {
      ...makeProject([track("t1", "text", [])]),
      textClips: [{ id: "cap", trackId: "t1", startTime: 3, duration: 2 }],
    } as unknown as Project;
    const after = applyTimelineToolEdits(p, planRemoveGaps(p, "t1", "op").edits);
    expect((after.textClips ?? [])[0].startTime).toBe(0);
  });
});
