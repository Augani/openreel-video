import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import { getBuiltInGraphicTemplate, getGraphicInstance, type GraphicTemplate } from "../graphic-templates";
import {
  createLinkedComposition,
  editLinkedComposition,
  getLinkedComposition,
  renderAndReplace,
  restoreUnrendered,
  setParamKeyframe,
  type LinkedEditResult,
} from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const media = {
  id: "render1", name: "r.mov", type: "video", blob: new Blob(["x"]), fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
};
const base = (): Project => ({
  id: "p", name: "P", createdAt: 1, modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [media] },
  timeline: {
    tracks: [{
      id: "v1", type: "video", name: "V1", mode: "standard", clips: [{
        id: "c1", mediaId: "render1", trackId: "v1", startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
        effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
      }], transitions: [], locked: false, hidden: false, muted: false, solo: false,
    }],
    subtitles: [], markers: [], duration: 10,
  },
} as unknown as Project);

const must = (result: LinkedEditResult): Project => {
  if (!result.ok) throw new Error(result.message);
  return result.project;
};

/** Commit `next` as the one `project/applyEditSnapshot` step the app uses. */
async function commit(executor: ActionExecutor, live: Project, next: Project, id: string) {
  const result = await executor.execute(
    { type: "project/applyEditSnapshot", id, timestamp: 1, params: { snapshot: structuredClone(editSnapshot(next)) } },
    live,
  );
  expect(result.success).toBe(true);
}

describe("linked composition operations are single undoable steps", () => {
  it("create, parameter keyframe, master edit, Render and Replace and Restore each undo in one step", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const live = structuredClone(base());
    const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar") as GraphicTemplate;

    let current = must(createLinkedComposition(live, template, { startTime: 2 }));
    await commit(executor, live, current, "a1");
    const instanceId = live.graphicInstances?.[0].id as string;
    const compositionId = live.linkedCompositions?.[0].id as string;
    expect(live.linkedCompositions).toHaveLength(1);

    // Master edit.
    const afterCreate = structuredClone(editSnapshot(live));
    current = must(editLinkedComposition(live, compositionId, (t) => ({ ...t, description: "edited in the composition window" })));
    await commit(executor, live, current, "a2");
    expect(getLinkedComposition(live, compositionId)?.revision).toBe(2);
    await executor.undo(live);
    expect(getLinkedComposition(live, compositionId)?.revision).toBe(1);
    expect(structuredClone(editSnapshot(live))).toEqual(afterCreate);

    // Render and Replace, then Restore.
    const live2Before = structuredClone(editSnapshot(live));
    current = must(renderAndReplace(live, instanceId, "render1"));
    await commit(executor, live, current, "a3");
    expect(getGraphicInstance(live, instanceId)?.bake).toBeDefined();
    expect((live.textClips ?? []).length + (live.shapeClips ?? []).length + (live.svgClips ?? []).length).toBe(0);
    current = must(restoreUnrendered(live, instanceId));
    await commit(executor, live, current, "a4");
    expect(getGraphicInstance(live, instanceId)?.bake).toBeUndefined();
    expect((live.textClips ?? []).length + (live.shapeClips ?? []).length).toBeGreaterThan(0);
    await executor.undo(live);
    expect(getGraphicInstance(live, instanceId)?.bake).toBeDefined();
    await executor.undo(live);
    expect(structuredClone(editSnapshot(live))).toEqual(live2Before);

    // Parameter keyframe.
    const numeric = getGraphicInstance(live, instanceId)?.template.parameters.find((p) => p.type === "number" || p.type === "slider");
    if (numeric) {
      const keyed = setParamKeyframe(live, instanceId, numeric.id, { time: 0.5, value: 0 });
      if (keyed.ok) {
        await commit(executor, live, keyed.project, "a5");
        await executor.undo(live);
        expect(getGraphicInstance(live, instanceId)?.paramKeyframes).toBeUndefined();
      }
    }

    // And the whole creation undoes in one step too.
    await executor.undo(live);
    expect(live.graphicInstances).toBeUndefined();
    expect(live.linkedCompositions).toBeUndefined();
  });
});
