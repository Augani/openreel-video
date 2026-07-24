import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";
import {
  createCreationScene,
  createCreationSceneObject,
  type CreationAssetRecipe,
} from "../../creation";

function makeProject(): Project {
  return {
    id: "project-1",
    name: "Creation Project",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [],
      subtitles: [],
      duration: 0,
      markers: [],
    },
  };
}

function asset(): CreationAssetRecipe {
  return {
    id: "asset-phone",
    name: "Phone",
    kind: "product",
    seed: "seed",
    parameters: { productKind: "phone" },
    nodes: [],
    materials: [],
    dependencies: [],
    caches: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function action(id: string, operation: Record<string, unknown>): Action {
  return {
    id,
    type: "creation/applyOperation",
    timestamp: 10,
    params: {
      operation: {
        id: `op-${id}`,
        timestamp: 10,
        source: "agent",
        ...operation,
      },
    },
  };
}

describe("creation action handlers", () => {
  it("persists creation operations through the action executor", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const scene = createCreationScene({ id: "scene-product", name: "Product", now: 1 });
    const object = createCreationSceneObject({
      id: "object-phone",
      name: "Phone assembly",
      assetId: "asset-phone",
    });

    expect(
      await executor.execute(action("asset", { type: "asset/upsert", asset: asset() }), project),
    ).toMatchObject({ success: true });
    expect(
      await executor.execute(action("scene", { type: "scene/upsert", scene }), project),
    ).toMatchObject({ success: true });
    expect(
      await executor.execute(
        action("object", {
          type: "scene-object/upsert",
          sceneId: scene.id,
          object,
        }),
        project,
      ),
    ).toMatchObject({ success: true });

    expect(project.creation?.assets).toHaveLength(1);
    expect(project.creation?.scenes[0]?.objects[0]?.id).toBe("object-phone");
    expect(project.creation?.operationHistory.map((entry) => entry.id)).toEqual([
      "op-asset",
      "op-scene",
      "op-object",
    ]);

    const undo = await executor.undo(project);
    expect(undo.success).toBe(true);
    expect(project.creation?.scenes[0]?.objects).toEqual([]);
  });

  it("rejects operations that would leave broken references", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const scene = createCreationScene({ id: "scene-product", name: "Product", now: 1 });

    await executor.execute(action("scene", { type: "scene/upsert", scene }), project);
    const result = await executor.execute(
      action("bad-object", {
        type: "scene-object/upsert",
        sceneId: scene.id,
        object: createCreationSceneObject({
          id: "object-missing",
          name: "Missing asset object",
          assetId: "missing-asset",
        }),
      }),
      project,
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("missing asset");
  });
});
