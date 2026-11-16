import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionExecutor,
  AdjustmentLayerEngine,
  type Clip,
  type Mask,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useEngineStore } from "../stores/engine-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { EditingSession } from "./agent/editing-session";
import {
  createAdjustmentLayerForClip,
  createEditorCompound,
  duplicateAdjustmentLayer,
  editAdjustmentLayer,
  editEditorCompound,
  flattenEditorCompound,
  type AdvancedLayerScope,
} from "./advanced-layer-edit";

const state = () => useProjectStore.getState();
const originalGetAdjustment =
  useEngineStore.getState().getAdjustmentLayerEngine;
const originalGetNested = useEngineStore.getState().getNestedSequenceEngine;
const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number): Clip => ({
  id,
  trackId,
  mediaId: id,
  startTime,
  duration: 2,
  inPoint: 1,
  outPoint: 3,
  transform,
  volume: 0.75,
  effects: [
    {
      id: `look-${id}`,
      type: "brightness",
      enabled: false,
      params: { value: 12 },
    },
  ],
  audioEffects: [
    { id: `audio-${id}`, type: "pan", enabled: true, params: { value: -0.2 } },
  ],
  keyframes: [
    {
      id: `key-${id}`,
      time: 0.5,
      property: "rotation",
      value: 10,
      easing: "linear",
    },
  ],
  metadata: { keep: "source metadata" },
});
function fixture(): AdvancedLayerScope {
  const base = createEmptyProject("Advanced controls");
  const project: Project = {
    ...base,
    timeline: {
      ...base.timeline,
      duration: 6,
      tracks: ["top", "bottom"].map((id, index) => ({
        id,
        name: id,
        type: "video",
        clips: [clip(index ? "b" : "a", id, index ? 4 : 2)],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      })),
    },
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    hasOpenProject: true,
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
  });
  return { projectId: project.id, executor };
}
beforeEach(() => {
  fixture();
  useUIStore.setState({
    selectedItems: [],
    effectApplicationClipId: null,
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  useTimelineStore.setState({ playbackLockedReason: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  useEngineStore.setState({
    getAdjustmentLayerEngine: originalGetAdjustment,
    getNestedSequenceEngine: originalGetNested,
  });
});
const scope = (): AdvancedLayerScope => ({
  projectId: state().project.id,
  executor: state().actionExecutor,
});

describe("canonical adjustment editing", () => {
  it("creates, saves, edits and undoes without awaiting a renderer", async () => {
    useEngineStore.setState({
      getAdjustmentLayerEngine: () => new Promise(() => {}),
    });
    const owner = scope(),
      id = createAdjustmentLayerForClip(owner, "a")!;
    expect(state().project.adjustmentLayers?.[0]).toMatchObject({
      id,
      trackId: "top",
      startTime: 2,
      duration: 2,
      opacity: 1,
    });
    expect(
      editAdjustmentLayer(owner, id, (layer) => ({ ...layer, opacity: 0.37 })),
    ).toBe(true);
    expect(
      JSON.parse(JSON.stringify(state().getFullProject())).adjustmentLayers[0]
        .opacity,
    ).toBe(0.37);
    await state().undo();
    expect(state().project.adjustmentLayers?.[0].opacity).toBe(1);
    await state().redo();
    expect(state().project.adjustmentLayers?.[0].opacity).toBe(0.37);
    await state().undo();
    await state().undo();
    expect(state().project.adjustmentLayers).toEqual([]);
  });
  it("duplicates nested effect data with fresh IDs and preserves independent history", async () => {
    const owner = scope(),
      id = createAdjustmentLayerForClip(owner, "a")!;
    editAdjustmentLayer(owner, id, (layer) => ({
      ...layer,
      effects: [
        {
          id: "effect",
          type: "grain",
          enabled: false,
          params: { amount: 0.18, size: 1 },
        },
      ],
    }));
    const copy = duplicateAdjustmentLayer(owner, id)!;
    editAdjustmentLayer(owner, copy, (layer) => ({
      ...layer,
      effects: layer.effects.map((effect) => ({
        ...effect,
        params: { ...effect.params, amount: 8 },
      })),
    }));
    expect(state().project.adjustmentLayers?.[0].effects[0].params.amount).toBe(
      0.18,
    );
    expect(state().project.adjustmentLayers?.[1].effects[0]).toMatchObject({
      enabled: false,
      params: { amount: 8 },
    });
    expect(state().project.adjustmentLayers?.[1].effects[0].id).not.toBe(
      "effect",
    );
    await state().undo();
    expect(state().project.adjustmentLayers?.[1].effects[0].params.amount).toBe(
      0.18,
    );
    editAdjustmentLayer(owner, copy, () => null);
    expect(state().project.adjustmentLayers).toHaveLength(1);
    await state().undo();
    expect(state().project.adjustmentLayers).toHaveLength(2);
  });
  it("retains zero opacity, fractional timing, disabled effects and unknown imported parameters", () => {
    const owner = scope(),
      id = createAdjustmentLayerForClip(owner, "a")!;
    editAdjustmentLayer(owner, id, (layer) => ({
      ...layer,
      startTime: 0,
      duration: 1 / 30,
      opacity: 0,
      effects: [
        {
          id: "custom",
          type: "grain",
          enabled: false,
          params: { amount: 0.18, customData: "preserve" },
        },
      ],
    }));
    expect(state().getFullProject().adjustmentLayers?.[0]).toMatchObject({
      opacity: 0,
      startTime: 0,
      duration: 1 / 30,
      effects: [
        { enabled: false, params: { amount: 0.18, customData: "preserve" } },
      ],
    });
  });
  it("rejects invalid layer values and no-op edits without adding history", () => {
    const owner = scope(),
      id = createAdjustmentLayerForClip(owner, "a")!,
      before = state().actionHistory.getUndoStackSize();
    for (const change of [
      { opacity: NaN },
      { opacity: 1.1 },
      { duration: 0 },
      { startTime: -1 },
    ])
      expect(
        editAdjustmentLayer(owner, id, (layer) => ({ ...layer, ...change })),
      ).toBe(false);
    expect(editAdjustmentLayer(owner, id, (layer) => layer)).toBe(false);
    expect(state().actionHistory.getUndoStackSize()).toBe(before);
  });
  it("does not hydrate a later project's renderer after delayed initialization", async () => {
    let resolve!: (engine: AdjustmentLayerEngine) => void;
    useEngineStore.setState({
      getAdjustmentLayerEngine: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    createAdjustmentLayerForClip(scope(), "a");
    fixture();
    const engine = new AdjustmentLayerEngine(),
      load = vi.spyOn(engine, "loadLayers");
    resolve(engine);
    await Promise.resolve();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    expect(state().project.adjustmentLayers).toBeUndefined();
  });
  it("records layer-only history instead of serializing unrelated media or timeline state", () => {
    const project = state().project;
    useProjectStore.setState({
      project: { ...project, name: "large-unrelated-state".repeat(10000) },
    });
    createAdjustmentLayerForClip(scope(), "a");
    const history = JSON.stringify(state().actionHistory.getHistoryEntries());
    expect(history).not.toContain("large-unrelated-state");
    expect(history.length).toBeLessThan(5000);
  });
});

describe("atomic compound workflows", () => {
  it("preserves source fields, saves the compound and restores the exact timeline with one Undo", async () => {
    const before = structuredClone(state().project.timeline),
      owner = scope();
    const result = await createEditorCompound(owner, ["a", "b"]);
    expect(result).not.toBeNull();
    const saved = state().getFullProject();
    expect(
      saved.compoundClips?.[0].content.clips.map((item) => [
        item.id,
        item.startTime,
        item.inPoint,
        item.volume,
        item.audioEffects,
        item.keyframes,
        item.metadata,
      ]),
    ).toEqual(
      before.tracks
        .flatMap((track) => track.clips)
        .map((item) => [
          item.id,
          item.startTime - 2,
          item.inPoint,
          item.volume,
          item.audioEffects,
          item.keyframes,
          item.metadata,
        ]),
    );
    expect(JSON.parse(JSON.stringify(saved)).nestedInstances).toHaveLength(1);
    expect(state().actionHistory.getUndoStackSize()).toBe(1);
    await state().undo();
    expect(state().project.timeline).toEqual(before);
    expect(state().project.compoundClips).toBeUndefined();
    expect(state().project.nestedInstances).toBeUndefined();
    await state().redo();
    expect(state().project.compoundClips).toHaveLength(1);
  });
  it("flattens onto the original tracks while preserving source trims, effects and animation", async () => {
    const owner = scope(),
      before = state().project.timeline.tracks.flatMap((track) => track.clips),
      result = (await createEditorCompound(owner, ["a", "b"]))!;
    expect(await flattenEditorCompound(owner, result.instanceId)).toBe(true);
    const restored = state().project.timeline.tracks.flatMap(
      (track) => track.clips,
    );
    const withoutId = (item: Clip) => {
      const { id: _id, ...value } = item;
      return value;
    };
    expect(restored.map(withoutId)).toEqual(before.map(withoutId));
    expect(restored.map((clip) => clip.id)).toEqual(
      before.map((clip) => clip.id),
    );
    expect(state().project.nestedInstances).toHaveLength(0);
    await state().undo();
    expect(state().project.nestedInstances).toHaveLength(1);
    expect(
      state().project.timeline.tracks.flatMap((track) => track.clips),
    ).toHaveLength(1);
  });
  it("keeps saved mask fill/source references attached across flatten and Undo/Redo", async () => {
    const mask: Mask = {
      id: "saved-matte",
      type: "track-matte",
      clipId: "a",
      sourceClipId: "b",
      matteSource: "bounds",
      feathering: 0,
      inverted: false,
      expansion: 0,
      opacity: 1,
      keyframes: [],
      path: {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    };
    useProjectStore.setState({
      project: { ...state().project, masks: [mask] },
    });
    const owner = scope(),
      result = (await createEditorCompound(owner, ["a", "b"]))!;
    const sourceIds = state().project.compoundClips![0].content.clips.map(
      (clip) => clip.id,
    );
    await flattenEditorCompound(owner, result.instanceId);
    expect(
      state()
        .project.timeline.tracks.flatMap((track) => track.clips)
        .map((clip) => clip.id),
    ).toEqual(sourceIds);
    await state().undo();
    await state().redo();
    expect(
      state()
        .project.timeline.tracks.flatMap((track) => track.clips)
        .map((clip) => clip.id),
    ).toEqual(sourceIds);
    const saved = JSON.parse(
      JSON.stringify(state().getFullProject()),
    ) as Project;
    expect(saved.masks).toEqual([mask]);
    const clips = saved.timeline.tracks.flatMap((track) => track.clips);
    expect(
      clips.find((clip) => clip.id === saved.masks![0].clipId)?.mediaId,
    ).toBe("a");
    expect(
      clips.find((clip) => clip.id === saved.masks![0].sourceClipId)?.mediaId,
    ).toBe("b");
  });
  it("does not replace an existing clip when a source ID is already in use", async () => {
    const owner = scope(),
      result = (await createEditorCompound(owner, ["a", "b"]))!;
    const project = state().project;
    const existing = {
      ...clip("a", "top", 10),
      metadata: { keep: "existing owner" },
    };
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) =>
            track.id === "top"
              ? { ...track, clips: [...track.clips, existing] }
              : track,
          ),
        },
      },
    });
    await flattenEditorCompound(owner, result.instanceId);
    const clips = state().project.timeline.tracks.flatMap(
      (track) => track.clips,
    );
    expect(clips).toHaveLength(3);
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(3);
    expect(clips.find((clip) => clip.id === "a")).toEqual(existing);
    expect(clips.some((clip) => clip.id === "b")).toBe(true);
  });
  it("renames all visible proxy metadata, duplicates independently and protects used definitions", async () => {
    const owner = scope(),
      result = (await createEditorCompound(owner, ["a", "b"]))!;
    await editEditorCompound(owner, result.compoundId, {
      type: "rename",
      name: "  Scene One  ",
    });
    expect(state().project.compoundClips?.[0].name).toBe("Scene One");
    expect(
      state().project.timeline.tracks.flatMap((track) => track.clips)[0]
        .metadata?.compoundClipName,
    ).toBe("Scene One");
    const copy = (await editEditorCompound(owner, result.compoundId, {
      type: "duplicate",
    }))!;
    expect(state().project.compoundClips?.[1].name).toBe("Scene One (Copy)");
    expect(
      await editEditorCompound(owner, result.compoundId, { type: "delete" }),
    ).toBeNull();
    expect(await editEditorCompound(owner, copy, { type: "delete" })).toBe(
      copy,
    );
    expect(state().project.compoundClips).toHaveLength(1);
    await state().undo();
    expect(state().project.compoundClips).toHaveLength(2);
  });
  it("rejects locked source tracks without changing timeline or renderer state", async () => {
    const project = state().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) => ({
            ...track,
            locked: track.id === "bottom",
          })),
        },
      },
    });
    await expect(createEditorCompound(scope(), ["a", "b"])).rejects.toThrow(
      /Unlock/,
    );
    expect(
      state().project.timeline.tracks.flatMap((track) => track.clips),
    ).toHaveLength(2);
    expect(state().project.compoundClips).toBeUndefined();
    expect(state().actionHistory.canUndo()).toBe(false);
  });
  it("leaves canonical data unchanged when the snapshot cannot be committed", async () => {
    const execute = vi.spyOn(state(), "executeAction").mockResolvedValueOnce({
      success: false,
      error: { code: "INVALID_PARAMS", message: "Commit rejected" },
    });
    const before = structuredClone(state().project);
    await expect(createEditorCompound(scope(), ["a", "b"])).rejects.toThrow(
      "Commit rejected",
    );
    expect(state().project).toEqual(before);
    expect(state().actionHistory.canUndo()).toBe(false);
    execute.mockRestore();
  });
  it.each(["project", "executor", "export", "processing", "playback"])(
    "rejects a stale or blocked %s edit",
    async (reason) => {
      const owner = scope();
      if (reason === "project") owner.projectId = "other";
      if (reason === "executor") owner.executor = new ActionExecutor();
      if (reason === "export")
        useUIStore.setState({
          exportState: {
            ...useUIStore.getState().exportState,
            isExporting: true,
          },
        });
      if (reason === "processing")
        useUIStore.setState({ effectApplicationClipId: "a" });
      if (reason === "playback")
        useTimelineStore.setState({ playbackLockedReason: "test" });
      expect(createAdjustmentLayerForClip(owner, "a")).toBeNull();
      await expect(createEditorCompound(owner, ["a", "b"])).rejects.toThrow();
      expect(state().actionHistory.canUndo()).toBe(false);
    },
  );
});

describe("transaction ownership", () => {
  it.each(["replacement", "same-ID reload"])(
    "never publishes a delayed action after %s",
    async (kind) => {
      const owner = state(),
        original = owner.actionExecutor.execute.bind(owner.actionExecutor);
      let release!: () => void;
      const barrier = new Promise<void>((done) => {
        release = done;
      });
      vi.spyOn(owner.actionExecutor, "execute").mockImplementationOnce(
        async (action, project) => {
          await barrier;
          return original(action, project);
        },
      );
      const pending = owner.executeAction({
        type: "track/add",
        id: "pending",
        timestamp: Date.now(),
        params: { trackType: "video", position: 0 },
      });
      const replacement =
        kind === "replacement"
          ? createEmptyProject("Replacement")
          : { ...owner.project };
      const executor = new ActionExecutor();
      useProjectStore.setState({
        project: replacement,
        actionExecutor: executor,
        actionHistory: executor.getHistory(),
      });
      release();
      expect((await pending).success).toBe(false);
      expect(state().project).toBe(replacement);
      expect(state().actionHistory.canUndo()).toBe(false);
    },
  );
  it("rejects a prepared snapshot after an identical same-ID project reload", async () => {
    const session = new EditingSession(),
      transaction = session.beginTransaction();
    session.replaceDraft({
      ...session.getProject(),
      name: "Unpublished draft",
    });
    const executor = new ActionExecutor();
    useProjectStore.setState({
      actionExecutor: executor,
      actionHistory: executor.getHistory(),
    });
    await expect(
      session.commitTransaction(transaction, "Prepared edit"),
    ).rejects.toThrow(/project changed/);
    expect(state().project.name).toBe("Advanced controls");
    expect(state().actionHistory.canUndo()).toBe(false);
  });
});
