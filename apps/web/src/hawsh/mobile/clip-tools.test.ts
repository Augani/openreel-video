import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const state = {
  project: { timeline: { tracks: [] as unknown[] } },
  beginHistoryGroup: vi.fn(() => calls.push("begin")),
  endHistoryGroup: vi.fn(() => calls.push("end")),
  splitClip: vi.fn(async (id: string, time: number) => { calls.push(`split ${id} ${time}`); return { success: true }; }),
  executeAction: vi.fn(async (a: { type: string; params: Record<string, unknown> }) => {
    calls.push(`${a.type} ${a.params.clipId} ${a.params.playheadTime ?? a.params.startTime}${a.params.trimStart === undefined ? "" : a.params.trimStart ? " start" : " end"}`);
    return { success: true };
  }),
  removeClip: vi.fn(async (id: string) => { calls.push(`remove ${id}`); return { success: true }; }),
  deleteTextClip: vi.fn((id: string) => { calls.push(`deleteText ${id}`); return true; }),
  splitOverlayClip: vi.fn(() => ({ left: {}, right: {} })),
  trimOverlayToPlayhead: vi.fn(() => ({})),
};
vi.mock("../../stores/project-store", () => ({ useProjectStore: { getState: () => state } }));

const { canCutAt, remove, selectedTarget, splitAt, trimAt, NOT_UNDER_PLAYHEAD } = await import("./clip-tools");
const { toolsFor } = await import("./ClipTools");

const clip = { id: "c1", trackId: "v", mediaId: "m", startTime: 0, duration: 10, inPoint: 0, outPoint: 10 };
const project = {
  timeline: { tracks: [{ id: "v", type: "video", clips: [clip] }, { id: "i", type: "image", clips: [{ ...clip, id: "img" }] }] },
  textClips: [{ id: "t1", trackId: "x", startTime: 2, duration: 3, text: "مرحبا" }],
} as never;

beforeEach(() => {
  calls.length = 0;
  state.project = { timeline: { tracks: [{ id: "v", type: "video", clips: [clip] }] } };
});

describe("selectedTarget", () => {
  it("finds a single selected clip or text clip and ignores multi-selection", () => {
    expect(selectedTarget(project, [{ type: "clip", id: "c1" }])).toMatchObject({ kind: "clip", id: "c1", trackType: "video" });
    expect(selectedTarget(project, [{ type: "text-clip", id: "t1" }])).toMatchObject({ kind: "text-clip", start: 2, duration: 3 });
    expect(selectedTarget(project, [{ type: "clip", id: "c1" }, { type: "clip", id: "img" }])).toBeNull();
    expect(selectedTarget(project, [{ type: "clip", id: "nope" }])).toBeNull();
    expect(selectedTarget(project, [])).toBeNull();
  });

  it("offers only the tools that fit the clip", () => {
    expect(toolsFor(selectedTarget(project, [{ type: "text-clip", id: "t1" }])!)).toEqual(["split", "trim", "delete"]);
    expect(toolsFor(selectedTarget(project, [{ type: "clip", id: "img" }])!)).toEqual(["split", "trim", "duplicate", "delete"]);
    expect(toolsFor(selectedTarget(project, [{ type: "clip", id: "c1" }])!)).toContain("silence");
  });
});

describe("cutting at the playhead", () => {
  const target = () => selectedTarget(project, [{ type: "clip", id: "c1" }])!;

  it("refuses a playhead outside the clip or on its edge", async () => {
    expect(canCutAt(target(), 5)).toBe(true);
    expect(canCutAt(target(), 0.01)).toBe(false);
    expect(canCutAt(target(), 12)).toBe(false);
    expect(await splitAt(target(), 12)).toBe(NOT_UNDER_PLAYHEAD);
    expect(state.splitClip).not.toHaveBeenCalledWith("c1", 12);
  });

  it("trims the start in place and slides later clips left, as one undo step", async () => {
    state.project = { timeline: { tracks: [{ id: "v", type: "video", clips: [clip, { ...clip, id: "c3", startTime: 10 }, { ...clip, id: "c0", startTime: -10 }] }] } };
    expect(await trimAt(target(), 4, "start")).toBeNull();
    expect(calls).toEqual(["begin", "clip/trimToPlayhead c1 4 start", "clip/move c1 0", "clip/move c3 6", "end"]);
  });

  it("trims the end and slides later clips into the gap", async () => {
    state.project = { timeline: { tracks: [{ id: "v", type: "video", clips: [clip, { ...clip, id: "c3", startTime: 12 }] }] } };
    expect(await trimAt(target(), 4, "end")).toBeNull();
    expect(calls).toEqual(["begin", "clip/trimToPlayhead c1 4 end", "clip/move c3 6", "end"]);
  });

  it("deletes text clips through the text engine", async () => {
    expect(await remove(selectedTarget(project, [{ type: "text-clip", id: "t1" }])!)).toBeNull();
    expect(await remove(target())).toBeNull();
    expect(calls).toEqual(["deleteText t1", "remove c1"]);
  });
});
