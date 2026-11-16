import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import { createSequence } from "../timeline/sequences";
import { planRippleDelete } from "../editing/ripple-delete";
import { applyTimelineToolEdits, invertTimelineToolEdits } from "../editing/timeline-tool-edit";
import {
  getBuiltInGraphicTemplate,
  graphicMemberClipIds,
  insertGraphicTemplate,
  setGraphicParameter,
  type GraphicInstance,
  type GraphicTemplate,
} from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const base = (): Project => ({
  id: "p", name: "P", createdAt: 1, modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: {
    tracks: [{
      id: "v1", type: "video", name: "V1", mode: "standard", clips: [{
        id: "c1", mediaId: "m1", trackId: "v1", startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
        effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
      }], transitions: [], locked: false, hidden: false, muted: false, solo: false,
    }],
    subtitles: [], markers: [], duration: 10,
  },
} as unknown as Project);

const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar") as GraphicTemplate;

function withGraphic(project = base(), start = 2) {
  const result = insertGraphicTemplate(project, template, { startTime: start });
  if (!result.ok) throw new Error(result.message);
  return { project: result.project, instance: result.project.graphicInstances?.[0] as GraphicInstance };
}

describe("graphics through the action executor", () => {
  it("an edit snapshot round-trips graphic instances and its inverse restores the exact members", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const { project: before } = withGraphic();
    const live = structuredClone(before);
    const changed = setGraphicParameter(before, before.graphicInstances![0].id, "name", "Changed");
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const result = await executor.execute(
      { type: "project/applyEditSnapshot", id: "a1", timestamp: 1, params: { snapshot: structuredClone(editSnapshot(changed.project)) } },
      live,
    );
    expect(result.success).toBe(true);
    expect(live.textClips?.find((c) => c.id.endsWith("__name"))?.text).toBe("Changed");
    const undone = await executor.undo(live);
    expect(undone.success).toBe(true);
    expect(live.textClips?.find((c) => c.id.endsWith("__name"))?.text).toBe("ALEX MORGAN");
    expect(live.graphicInstances?.[0].values.name ?? "ALEX MORGAN").toBe("ALEX MORGAN");
  });

  it("a generic edit that left the members shifted (sync lock, ripple) updates the instance", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const { project, instance } = withGraphic();
    const live = structuredClone(project) as { -readonly [K in keyof Project]: Project[K] };
    const shift = <T extends { startTime: number }>(list: T[] | undefined) => list?.map((c) => ({ ...c, startTime: c.startTime + 1.5 }));
    live.textClips = shift(live.textClips);
    live.shapeClips = shift(live.shapeClips);
    live.svgClips = shift(live.svgClips);
    const result = await executor.execute({ type: "marker/add", id: "m1", timestamp: 1, params: { time: 1, label: "M", color: "#fff" } }, live);
    expect(result.success).toBe(true);
    expect(live.graphicInstances?.[0].startTime).toBe(instance.startTime + 1.5);
  });

  it("a sync-locked ripple delete before the graphic moves graphic and layers together; its inverse restores them", () => {
    const short = base();
    short.timeline.tracks[0].clips[0] = { ...short.timeline.tracks[0].clips[0], duration: 4, outPoint: 4 };
    const { project, instance } = withGraphic(short, 6);
    const plan = planRippleDelete(project, ["c1"], "ripple-1");
    const after = applyTimelineToolEdits(project, plan.edits);
    const moved = after.graphicInstances?.[0] as GraphicInstance;
    expect(moved.startTime).toBeLessThan(instance.startTime);
    const members = [...(after.textClips ?? []), ...(after.shapeClips ?? []), ...(after.svgClips ?? [])];
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((clip) => clip.startTime === moved.startTime && clip.duration === moved.duration)).toBe(true);
    const restored = applyTimelineToolEdits(after, invertTimelineToolEdits(plan.edits));
    expect(restored.graphicInstances?.[0].startTime).toBe(instance.startTime);
    expect([...(restored.textClips ?? [])].every((clip) => clip.startTime === instance.startTime)).toBe(true);
  });

  it("deleting a track keeps the instance so undo (which restores the clips) finds it again", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const { project, instance } = withGraphic();
    const live = structuredClone(project);
    const removed = await executor.execute({ type: "track/remove", id: "r1", timestamp: 1, params: { trackId: instance.trackId } }, live);
    expect(removed.success).toBe(true);
    expect(live.graphicInstances).toHaveLength(1);
    expect((live.textClips ?? []).filter((c) => c.id.startsWith(instance.id))).toHaveLength(0);
    const undone = await executor.undo(live);
    expect(undone.success).toBe(true);
    expect((live.textClips ?? []).filter((c) => c.id.startsWith(instance.id)).length).toBeGreaterThan(0);
    expect(graphicMemberClipIds(live).size).toBeGreaterThan(0);
  });
});

describe("graphics in sequences", () => {
  it("works on whichever sequence is active: members live on that sequence's tracks", () => {
    const root = base();
    const made = createSequence(root, { name: "Second", activate: true });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const { project: next, instance } = withGraphic(made.project, 1);
    const activeTrackIds = new Set(next.timeline.tracks.map((t) => t.id));
    expect(activeTrackIds.has(instance.trackId)).toBe(true);
    for (const clip of [...(next.textClips ?? []), ...(next.shapeClips ?? []), ...(next.svgClips ?? [])]) {
      expect(activeTrackIds.has(clip.trackId)).toBe(true);
    }
  });
});
