import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { CAPABILITY_MANIFEST } from "@openreel/core/capabilities/manifest";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import type { TargetingBridge, TargetingState } from "./host";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

type Loose = Record<string, unknown>;

function build(): Project {
  const project = makeProjectWithClip();
  const proto = structuredClone(project.timeline.tracks[0].clips[0]) as unknown as Loose;
  const clip = (id: string, trackId: string, startTime: number, duration: number) => ({
    ...structuredClone(proto),
    id,
    trackId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
  });
  const track = (id: string, type: string, name: string, clips: unknown[]) => ({
    id, type, name, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
  });
  const tracks = project.timeline.tracks as unknown as unknown[];
  tracks.length = 0;
  tracks.push(
    track("v2", "video", "V2", []),
    track("v1", "video", "V1", [clip("c1", "v1", 0, 5), clip("c2", "v1", 5, 5)]),
    track("a1", "audio", "A1", [clip("a-1", "a1", 0, 5), clip("a-2", "a1", 5, 5)]),
    track("a2", "audio", "A2", [clip("m-1", "a2", 6, 4)]),
  );
  (project.timeline as { duration: number }).duration = 10;
  (project.mediaLibrary as { items: unknown[] }).items = [
    {
      id: "m1", name: "Interview.mp4", type: "video", blob: null,
      metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, hasAudio: true },
    },
  ];
  return project;
}

function setup() {
  const history = new ActionHistory();
  const host = new HeadlessHost(build(), { history }) as HeadlessHost & { targeting?: TargetingBridge };
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo };
}
const spans = (host: HeadlessHost, trackId: string) =>
  (host.getProject().timeline.tracks.find((t) => t.id === trackId)?.clips ?? [])
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => [c.id, +c.startTime.toFixed(4), +(c.startTime + c.duration).toFixed(4)]);

function fakeTargeting(): TargetingBridge & { state: { targeted: string[]; video?: string; audio?: string } } {
  const state: { targeted: string[]; video?: string; audio?: string } = { targeted: [] };
  return {
    state,
    getState: (): TargetingState => ({
      targetedTrackIds: [...state.targeted],
      sourcePatch: { ...(state.video ? { video: state.video } : {}), ...(state.audio ? { audio: state.audio } : {}) },
    }),
    setTrackTargeted: (id, on) => {
      state.targeted = on ? [...state.targeted, id] : state.targeted.filter((t) => t !== id);
    },
    setSourcePatch: (kind, id) => {
      if (id) state[kind] = id;
      else delete state[kind];
    },
  };
}

describe("sync lock agent tools", () => {
  it("registers the tools and lists them in the capability manifest", () => {
    for (const name of ["set_track_sync_lock", "set_track_target", "set_source_patch", "ripple_delete_clip", "add_edit"])
      expect(getTool(name), name).toBeDefined();
    for (const name of CAPABILITY_MANIFEST.premiere.rangeEdits) expect(getTool(name), name).toBeDefined();
  });

  it("set_track_sync_lock is one undoable step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("set_track_sync_lock", { trackId: "a2", syncLock: false }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(host.getProject().timeline.tracks.find((t) => t.id === "a2")!.syncLock).toBe(false);
    await undo();
    expect(host.getProject().timeline.tracks.find((t) => t.id === "a2")!.syncLock).not.toBe(false);
  });

  it("ripple_delete_clip keeps sync-locked tracks in step, as one undo step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    // A2's music starts at 6, after the deleted [0,5): not in the way.
    const result = await executeTool("ripple_delete_clip", { clipIds: ["c1", "a-1"] }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(spans(host, "v1")).toEqual([["c2", 0, 5]]);
    expect(spans(host, "a1")).toEqual([["a-2", 0, 5]]);
    expect(spans(host, "a2")).toEqual([["m-1", 1, 5]]);
    await undo();
    expect(spans(host, "a2")).toEqual([["m-1", 6, 10]]);
    expect(spans(host, "v1")).toEqual([["c1", 0, 5], ["c2", 5, 10]]);
  });

  it("blocks naming the track, and sync lock off lets it through leaving the track alone", async () => {
    const { host, history } = setup();
    const result = await executeTool("ripple_delete_clip", { clipIds: ["c2", "a-2"] }, host);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('"A2"');
    expect(spans(host, "v1")).toEqual([["c1", 0, 5], ["c2", 5, 10]]);
    const stack = history.getUndoStackSize();
    expect((await executeTool("set_track_sync_lock", { trackId: "a2", syncLock: false }, host)).ok).toBe(true);
    const retry = await executeTool("ripple_delete_clip", { clipIds: ["c2", "a-2"] }, host);
    expect(retry.ok, retry.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(stack + 2);
    expect(spans(host, "a2")).toEqual([["m-1", 6, 10]]);
  });

  it("consolidate_track and close_gap go through the sync-lock planners, one undo step each", async () => {
    const { host, history, undo } = setup();
    // Open a 2s gap on V1 before c2; A1 and A2 are clear over [5,7)? A2 starts at 6, so blocked.
    await host.applyAction({ type: "clip/move", id: "mv", timestamp: 0, params: { clipId: "c2", startTime: 7, trackId: "v1" } });
    const blocked = await executeTool("close_gap", { clipId: "c2" }, host);
    expect(blocked.ok).toBe(false);
    expect(blocked.summary).toContain("Sync Lock blocked");
    expect(spans(host, "v1")).toEqual([["c1", 0, 5], ["c2", 7, 12]]);
    expect((await executeTool("consolidate_track", { trackId: "v1" }, host)).ok).toBe(false);
    expect(spans(host, "a2")).toEqual([["m-1", 6, 10]]);
    // With the music out of the way the same tools ripple the followers as one undo step.
    await executeTool("set_track_sync_lock", { trackId: "a1", syncLock: false }, host);
    await executeTool("set_track_sync_lock", { trackId: "a2", syncLock: false }, host);
    const stack = history.getUndoStackSize();
    const ok = await executeTool("consolidate_track", { trackId: "v1" }, host);
    expect(ok.ok, ok.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(stack + 1);
    expect(spans(host, "v1")).toEqual([["c1", 0, 5], ["c2", 5, 10]]);
    expect(spans(host, "a2")).toEqual([["m-1", 6, 10]]);
    await undo();
    expect(spans(host, "v1")).toEqual([["c1", 0, 5], ["c2", 7, 12]]);
  });

  it("track_select_clips returns the clip and everything after (or before) it, skipping locked tracks", async () => {
    const { host } = setup();
    const forward = await executeTool("track_select_clips", { clipId: "c2" }, host);
    expect(forward.ok, forward.summary).toBe(true);
    expect((forward.data as { clipIds: string[] }).clipIds.sort()).toEqual(["a-2", "c2", "m-1"].sort());
    const trackOnly = await executeTool("track_select_clips", { clipId: "c1", trackOnly: true }, host);
    expect((trackOnly.data as { clipIds: string[] }).clipIds).toEqual(["c1", "c2"]);
    const backward = await executeTool("track_select_clips", { clipId: "c2", direction: "backward", trackOnly: true }, host);
    expect((backward.data as { clipIds: string[] }).clipIds).toEqual(["c1", "c2"]);
    expect((await executeTool("track_select_clips", { clipId: "nope" }, host)).ok).toBe(false);
    expect((await executeTool("track_select_clips", { clipId: "c1", direction: "up" }, host)).ok).toBe(false);
  });

  it("set_track_target and set_source_patch need the live editor and validate tracks", async () => {
    const { host } = setup();
    const noBridge = await executeTool("set_track_target", { trackId: "v1", targeted: true }, host);
    expect(noBridge.ok).toBe(false);
    host.targeting = fakeTargeting();
    expect((await executeTool("set_track_target", { trackId: "v1", targeted: true }, host)).ok).toBe(true);
    expect(host.targeting.getState().targetedTrackIds).toEqual(["v1"]);
    expect((await executeTool("set_track_target", { trackId: "nope", targeted: true }, host)).ok).toBe(false);
    expect((await executeTool("set_source_patch", { kind: "audio", trackId: "v1" }, host)).ok).toBe(false);
    expect((await executeTool("set_source_patch", { kind: "audio", trackId: "a2" }, host)).ok).toBe(true);
    expect(host.targeting.getState().sourcePatch.audio).toBe("a2");
    expect((await executeTool("set_source_patch", { kind: "audio", trackId: null }, host)).ok).toBe(true);
    expect(host.targeting.getState().sourcePatch.audio).toBeUndefined();
  });

  it("insert_from_source honours the patch: picture on V2, linked sound on A2, sync-locked tracks ripple", async () => {
    const { host, history, undo } = setup();
    host.targeting = fakeTargeting();
    await executeTool("set_source_patch", { kind: "video", trackId: "v2" }, host);
    await executeTool("set_source_patch", { kind: "audio", trackId: "a2" }, host);
    const before = history.getUndoStackSize();
    const result = await executeTool(
      "insert_from_source",
      { mediaId: "m1", at: 2, sourceIn: 0, sourceOut: 3 },
      host,
    );
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(spans(host, "v2").map((s) => s.slice(1))).toEqual([[2, 5]]);
    const sound = host.getProject().timeline.tracks.find((t) => t.id === "a2")!.clips.find((c) => c.startTime === 2)!;
    expect(sound.metadata?.separatedFromClipId).toBeDefined();
    // V1 and A1 split at 2 and shifted by 3.
    expect(spans(host, "v1").map((s) => s.slice(1))).toEqual([[0, 2], [5, 8], [8, 13]]);
    await undo();
    expect(spans(host, "v1")).toEqual([["c1", 0, 5], ["c2", 5, 10]]);
    expect(spans(host, "a2")).toEqual([["m-1", 6, 10]]);
  });

  it("extract_range and add_edit default to the targeted tracks", async () => {
    const { host } = setup();
    host.targeting = fakeTargeting();
    await executeTool("set_track_target", { trackId: "v1", targeted: true }, host);
    const edit = await executeTool("add_edit", { time: 2 }, host);
    expect(edit.ok, edit.summary).toBe(true);
    expect(spans(host, "v1").length).toBe(3);
    expect(spans(host, "a1").length).toBe(2);
  });
});
