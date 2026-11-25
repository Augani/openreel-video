import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";
import { deserializeProject, serializeProject } from "../../utils/serialization";
import { DEFAULT_OBJECT_REMOVAL, type ObjectRemovalSettings } from "./types";

function projectWithClip(): Project {
  const clip = {
    id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    effects: [], audioEffects: [], keyframes: [], volume: 1,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
  };
  return {
    id: "p1", name: "T", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 4, subtitles: [], markers: [], tracks: [{ id: "t1", type: "video", name: "V1", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const act = (params: Record<string, unknown>): Action => ({ type: "clip/setObjectRemoval", id: `a-${Math.random()}`, timestamp: 0, params }) as Action;

describe("Remove Object settings through the action system", () => {
  it("turn on, change and clear are undoable, and the settings survive save and reload", async () => {
    const executor = new ActionExecutor();
    const project = projectWithClip();
    const clipOf = () => project.timeline.tracks[0].clips[0];
    const on: ObjectRemovalSettings = { enabled: true, maskId: "mask-1", analysisKey: "abc123", ...DEFAULT_OBJECT_REMOVAL };

    expect((await executor.execute(act({ clipId: "c1", objectRemoval: on }), project)).success).toBe(true);
    expect(clipOf().objectRemoval).toEqual(on);
    await new Promise((resolve) => setTimeout(resolve, 160));
    const off = { ...on, enabled: false };
    expect((await executor.execute(act({ clipId: "c1", objectRemoval: off }), project)).success).toBe(true);
    expect(clipOf().objectRemoval?.enabled).toBe(false);

    const reloaded = deserializeProject(serializeProject(project));
    expect(reloaded.timeline.tracks[0].clips[0].objectRemoval).toEqual(off);

    await executor.undo(project);
    expect(clipOf().objectRemoval).toEqual(on);
    await executor.undo(project);
    expect(clipOf().objectRemoval).toBeUndefined();
    await executor.redo(project);
    await executor.redo(project);
    expect(clipOf().objectRemoval).toEqual(off);

    await new Promise((resolve) => setTimeout(resolve, 160));
    expect((await executor.execute(act({ clipId: "c1", objectRemoval: null }), project)).success).toBe(true);
    expect(clipOf().objectRemoval).toBeUndefined();
    await executor.undo(project);
    expect(clipOf().objectRemoval).toEqual(off);
  });

  it("rejects settings that are malformed or out of range, and an unknown clip", async () => {
    const executor = new ActionExecutor();
    const project = projectWithClip();
    for (const bad of [{ enabled: "yes", maskId: "m", dilate: 5, feather: 2 }, { enabled: true, dilate: 5, feather: 2 }, { enabled: true, maskId: "m", dilate: 500, feather: 2 }, { enabled: true, maskId: "m", dilate: 5, feather: Number.NaN }]) {
      expect((await executor.execute(act({ clipId: "c1", objectRemoval: bad }), project)).success).toBe(false);
    }
    expect((await executor.execute(act({ clipId: "nope", objectRemoval: { enabled: true, maskId: "m", dilate: 5, feather: 2 } }), project)).success).toBe(false);
    expect(project.timeline.tracks[0].clips[0].objectRemoval).toBeUndefined();
  });
});
