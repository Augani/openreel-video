import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../action-executor";
import { editSnapshot } from "./edit-snapshot";
import { calculateProjectDuration } from "../../timeline/project-duration";
import type { Project } from "../../types/project";

function project(): Project {
  return {
    id: "original",
    name: "Original",
    createdAt: 12,
    modifiedAt: 12,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: { tracks: [], duration: 0, markers: [], subtitles: [] },
    mediaLibrary: { items: [] },
    capabilities: ["preserve-capability"],
    minimumReaderVersion: "3",
  };
}
async function commit(
  executor: ActionExecutor,
  target: Project,
  draft: Project,
) {
  expect(
    (
      await executor.execute(
        {
          type: "project/applyEditSnapshot",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { snapshot: editSnapshot(draft) },
        },
        target,
      )
    ).success,
  ).toBe(true);
}

describe("complete edit-snapshot restoration", () => {
  it("removes an undone compound instance so it cannot extend playback or survive save", async () => {
    const executor = new ActionExecutor(),
      target = project();
    const draft: Project = {
      ...target,
      nestedInstances: [
        {
          id: "nested",
          compoundClipId: "compound",
          trackId: "video",
          startTime: 0,
          duration: 80,
          inPoint: 0,
          outPoint: 80,
          volume: 1,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
        },
      ],
    };
    await commit(executor, target, draft);
    expect(calculateProjectDuration(target)).toBe(80);
    expect((await executor.undo(target)).success).toBe(true);
    expect(calculateProjectDuration(target)).toBe(0);
    expect(JSON.parse(JSON.stringify(target))).not.toHaveProperty(
      "nestedInstances",
    );
    expect((await executor.redo(target)).success).toBe(true);
    expect(calculateProjectDuration(target)).toBe(80);
  });
  it("restores absence for every optional edit collection and creation state", async () => {
    const executor = new ActionExecutor(),
      target = project();
    const additions = {
      textClips: [],
      shapeClips: [],
      svgClips: [],
      stickerClips: [],
      adjustmentLayers: [],
      masks: [],
      particleEffects: [],
      multicamGroups: [],
      compoundClips: [],
      nestedInstances: [],
      motionCompositions: [],
      motionInstances: [],
      generatedShaders: [],
      creation: { version: "1", assets: [], scenes: [], operationHistory: [] },
    };
    await commit(executor, target, { ...target, ...additions });
    expect((await executor.undo(target)).success).toBe(true);
    for (const field of Object.keys(additions))
      expect(target).not.toHaveProperty(field);
    expect((await executor.redo(target)).success).toBe(true);
    for (const [field, value] of Object.entries(additions))
      expect(target).toHaveProperty(field, value);
  });
  it("retains media blobs and project identity while replacing cloned edit data", async () => {
    const executor = new ActionExecutor();
    const blob = new Blob(["real source bytes"], { type: "video/mp4" });
    const target: Project = {
      ...project(),
      mediaLibrary: {
        items: [
          {
            id: "media",
            name: "clip.mp4",
            type: "video",
            blob,
            fileHandle: null,
            metadata: {
              duration: 5,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "avc1",
              sampleRate: 48000,
              channels: 2,
              fileSize: blob.size,
            },
            thumbnailUrl: null,
            waveformData: new Float32Array([0.1, 0.2]),
          },
        ],
      },
    };
    const draft: Project = {
      ...target,
      name: "Edited",
      compoundClips: [
        {
          id: "definition",
          name: "Opening",
          color: "#8b5cf6",
          createdAt: 0,
          modifiedAt: 0,
          content: { clips: [], tracks: [], duration: 0 },
        },
      ],
    };
    await commit(executor, target, draft);
    expect(target.compoundClips).toEqual(draft.compoundClips);
    expect(target.compoundClips).not.toBe(draft.compoundClips);
    expect(target.mediaLibrary.items[0].blob).toBe(blob);
    expect(target.id).toBe("original");
    expect(target.createdAt).toBe(12);
    expect(target.capabilities).toEqual(["preserve-capability"]);
    expect(target.minimumReaderVersion).toBe("3");
    expect((await executor.undo(target)).success).toBe(true);
    expect(target.name).toBe("Original");
    expect(target.compoundClips).toBeUndefined();
    expect(target.mediaLibrary.items[0].blob).toBe(blob);
  });
});
