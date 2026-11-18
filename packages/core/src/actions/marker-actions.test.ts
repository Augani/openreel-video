import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";

const makeProject = (): Project =>
  ({
    id: "p1",
    name: "Markers",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 60, tracks: [], subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
  }) as unknown as Project;

let n = 0;
const act = (type: string, params: Record<string, unknown>): Action =>
  ({ id: `a${++n}`, type, timestamp: Date.now() + n * 1000, params }) as unknown as Action;

describe("marker actions with range, comment and kind", () => {
  it("adds a range marker and undo / redo restore exactly it", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const added = await executor.execute(
      act("marker/add", { time: 5, label: "Scene", color: "#f00", duration: 3, comment: "check audio", kind: "chapter" }),
      project,
    );
    expect(added.success).toBe(true);
    const [marker] = project.timeline.markers;
    expect(marker).toMatchObject({ time: 5, label: "Scene", duration: 3, comment: "check audio", kind: "chapter" });
    const snapshot = { ...marker };

    expect((await executor.undo(project)).success).toBe(true);
    expect(project.timeline.markers).toEqual([]);
    expect((await executor.redo(project)).success).toBe(true);
    expect(project.timeline.markers).toHaveLength(1);
    expect({ ...project.timeline.markers[0], id: snapshot.id }).toEqual(snapshot);
  });

  it("a point marker keeps no optional fields", async () => {
    const project = makeProject();
    await new ActionExecutor().execute(act("marker/add", { time: 1, label: "M", color: "#fff" }), project);
    expect(Object.keys(project.timeline.markers[0]).sort()).toEqual(["color", "id", "label", "time"]);
  });

  it("updates duration and comment; undo restores the original marker exactly", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("marker/add", { time: 2, label: "A", color: "#00f" }), project);
    const original = structuredClone(project.timeline.markers[0]);
    const result = await executor.execute(
      act("marker/update", { markerId: original.id, updates: { duration: 4, comment: "note", kind: "web" } }),
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.markers[0]).toMatchObject({ duration: 4, comment: "note", kind: "web" });
    await executor.undo(project);
    expect(project.timeline.markers[0]).toEqual(original);
    expect("duration" in project.timeline.markers[0]).toBe(false);
    await executor.redo(project);
    expect(project.timeline.markers[0]).toMatchObject({ duration: 4, comment: "note", kind: "web" });
  });

  it("removes a range marker and undo restores it at its position", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    for (const time of [1, 2, 3]) {
      await executor.execute(act("marker/add", { time, label: `M${time}`, color: "#fff", duration: time }), project);
    }
    const before = structuredClone(project.timeline.markers);
    await executor.execute(act("marker/remove", { markerId: before[1].id }), project);
    expect(project.timeline.markers.map((m) => m.label)).toEqual(["M1", "M3"]);
    await executor.undo(project);
    expect(project.timeline.markers).toEqual(before);
  });

  it.each([
    ["negative duration on add", "marker/add", { time: 1, label: "x", color: "#fff", duration: -1 }],
    ["negative time on add", "marker/add", { time: -1, label: "x", color: "#fff" }],
    ["unknown kind on add", "marker/add", { time: 1, label: "x", color: "#fff", kind: "nope" }],
    ["non-string comment on add", "marker/add", { time: 1, label: "x", color: "#fff", comment: 5 }],
  ])("rejects %s", async (_name, type, params) => {
    const project = makeProject();
    const result = await new ActionExecutor().execute(act(type, params), project);
    expect(result.success).toBe(false);
    expect(project.timeline.markers).toEqual([]);
  });

  it.each([
    ["negative duration", { duration: -0.5 }],
    ["NaN duration", { duration: Number.NaN }],
    ["negative time", { time: -2 }],
    ["unknown kind", { kind: "bogus" }],
  ])("rejects an update with %s", async (_name, updates) => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("marker/add", { time: 2, label: "A", color: "#00f" }), project);
    const before = structuredClone(project.timeline.markers);
    const result = await executor.execute(act("marker/update", { markerId: before[0].id, updates }), project);
    expect(result.success).toBe(false);
    expect(project.timeline.markers).toEqual(before);
  });
});
