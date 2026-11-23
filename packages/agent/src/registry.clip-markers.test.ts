import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core/types/project";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

/** Two clips of one media: c1 plays source 0..5 at 0s, c2 plays source 2..7 at 10s. */
function makeProject(): Project {
  const project = makeProjectWithClip();
  const track = project.timeline.tracks[0] as unknown as { clips: Record<string, unknown>[] };
  const proto = structuredClone(track.clips[0]);
  (project.mediaLibrary as { items: unknown[] }).items = [
    { id: "m1", name: "Interview.mp4", type: "video", blob: null, metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30 } },
  ];
  const media = { id: "m1" };
  track.clips.length = 0;
  track.clips.push(
    { ...structuredClone(proto), id: "c1", mediaId: media.id, startTime: 0, duration: 5, inPoint: 0, outPoint: 5 },
    { ...structuredClone(proto), id: "c2", mediaId: media.id, startTime: 10, duration: 5, inPoint: 2, outPoint: 7 },
  );
  return project;
}

function setup() {
  const history = new ActionHistory();
  const host = new HeadlessHost(makeProject(), { history });
  return { host, history, mediaId: host.getProject().mediaLibrary.items[0].id };
}

type Listed = { markers: { timelineTime: number; scope: string }[] };

describe("clip marker and reverse match frame agent tools", () => {
  it("registers them, the read ones as read-only", () => {
    for (const name of ["reverse_match_frame", "list_clip_markers", "add_clip_marker", "remove_clip_marker"])
      expect(getTool(name), name).toBeDefined();
    expect(getTool("reverse_match_frame")!.readOnly).toBe(true);
    expect(getTool("list_clip_markers")!.readOnly).toBe(true);
    expect(getTool("add_clip_marker")!.readOnly).toBe(false);
  });

  it("adds a master-clip marker that shows on every instance, then removes it", async () => {
    const { host, mediaId, history } = setup();
    const added = await executeTool("add_clip_marker", { mediaId, time: 3, label: "Hero shot" }, host);
    expect(added.ok).toBe(true);
    const markerId = (added.data as { markerId: string }).markerId;
    expect(host.getProject().mediaLibrary.items[0].markers).toHaveLength(1);
    expect(history.canUndo()).toBe(true);

    const c1 = (await executeTool("list_clip_markers", { clipId: "c1" }, host)).data as Listed;
    const c2 = (await executeTool("list_clip_markers", { clipId: "c2" }, host)).data as Listed;
    expect(c1.markers[0]).toMatchObject({ scope: "master" });
    expect(c1.markers[0].timelineTime).toBeCloseTo(3, 3);
    expect(c2.markers[0].timelineTime).toBeCloseTo(11, 3);

    expect((await executeTool("remove_clip_marker", { mediaId, markerId }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.items[0].markers ?? []).toHaveLength(0);
  });

  it("keeps a clip marker on one instance only and rejects bad targets", async () => {
    const { host, mediaId } = setup();
    expect((await executeTool("add_clip_marker", { clipId: "c1", time: 1, label: "Only here" }, host)).ok).toBe(true);
    const onC1 = (await executeTool("list_clip_markers", { clipId: "c1" }, host)).data as Listed;
    const onC2 = (await executeTool("list_clip_markers", { clipId: "c2" }, host)).data as Listed;
    expect(onC1.markers).toHaveLength(1);
    expect(onC2.markers).toHaveLength(0);
    expect((await executeTool("add_clip_marker", { clipId: "c1", mediaId, time: 1 }, host)).ok).toBe(false);
    expect((await executeTool("add_clip_marker", { clipId: "nope", time: 1 }, host)).ok).toBe(false);
    expect((await executeTool("add_clip_marker", { clipId: "c1" }, host)).ok).toBe(false);
  });

  it("reverse_match_frame lists every instance of a source frame", async () => {
    const { host, mediaId } = setup();
    const both = await executeTool("reverse_match_frame", { mediaId, sourceTime: 3 }, host);
    expect(both.ok).toBe(true);
    const instances = (both.data as { instances: { clipId: string; timelineTime: number }[] }).instances;
    expect(instances.map((i) => i.clipId).sort()).toEqual(["c1", "c2"]);
    expect(instances.find((i) => i.clipId === "c2")!.timelineTime).toBeCloseTo(11, 3);
    const one = await executeTool("reverse_match_frame", { mediaId, sourceTime: 6 }, host);
    expect((one.data as { instances: unknown[] }).instances).toHaveLength(1);
    expect((await executeTool("reverse_match_frame", { mediaId, sourceTime: 9 }, host)).ok).toBe(false);
    expect((await executeTool("reverse_match_frame", { mediaId }, host)).ok).toBe(false);
  });
});
