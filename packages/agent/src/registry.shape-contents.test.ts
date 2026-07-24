import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeGroupItem,
  MotionShapeItem,
  MotionShapeLayer,
  MotionShapePathItem,
} from "@openreel/core/motion/types";
import { findShapeItem } from "@openreel/core/motion/motion-shape-contents";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-shape-contents";
const LAYER_ID = "layer-shape-contents";

function shapeLayer(
  overrides: Partial<MotionShapeLayer> = {},
): MotionShapeLayer {
  return {
    id: LAYER_ID,
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 0.8 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
    ...overrides,
  };
}

function projectWith(layers: readonly MotionLayer[]): Project {
  const composition: MotionComposition = {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [...layers],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return {
    ...makeEmptyProject(),
    motionCompositions: [composition],
  } as unknown as Project;
}

function projectWithShape(overrides: Partial<MotionShapeLayer> = {}): Project {
  return projectWith([shapeLayer(overrides) as MotionLayer]);
}

function compFrom(host: HeadlessHost): MotionComposition {
  const project = host.getProject();
  const compositions = project.motionCompositions ?? [];
  const found = compositions.find((candidate) => candidate.id === COMP_ID);
  if (!found) throw new Error("Composition missing");
  return found;
}

function layerFrom(host: HeadlessHost, layerId = LAYER_ID): MotionShapeLayer {
  const layer = compFrom(host).layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "shape") throw new Error("Shape layer missing");
  return layer;
}

function contentsFrom(
  host: HeadlessHost,
  layerId = LAYER_ID,
): readonly MotionShapeItem[] {
  return layerFrom(host, layerId).contents ?? [];
}

function dataString(value: unknown, key: string): string {
  const record = value as Record<string, unknown> | null | undefined;
  const found = record?.[key];
  if (typeof found !== "string") throw new Error(`Missing ${key} in result data`);
  return found;
}

describe("add_motion_shape_group", () => {
  it("adds a root group and returns its id", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, name: "Union", mergeMode: "union" },
      host,
    );
    expect(res.ok).toBe(true);
    const groupId = dataString(res.data, "groupId");
    const item = findShapeItem(contentsFrom(host), groupId);
    expect(item?.kind).toBe("group");
    expect((item as MotionShapeGroupItem).mergeMode).toBe("union");
  });

  it("materializes the legacy root shape before adding a group", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, name: "Extra" },
      host,
    );
    expect(res.ok).toBe(true);
    const groupId = dataString(res.data, "groupId");
    const contents = contentsFrom(host);
    expect(contents.length).toBe(2);
    const materialized = contents.find(
      (item) => item.kind === "group" && item.id !== groupId,
    ) as MotionShapeGroupItem | undefined;
    expect(materialized).toBeDefined();
    expect(materialized?.items[0]?.kind).toBe("path");
    const original = materialized?.items[0] as MotionShapePathItem;
    expect(original.shapeType).toBe("rectangle");
    expect(original.width).toBe(200);
    expect(original.height).toBe(120);
  });

  it("nests a group under an existing parent group", async () => {
    const host = new HeadlessHost(projectWithShape());
    const parent = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, name: "Parent" },
      host,
    );
    const parentId = dataString(parent.data, "groupId");
    const child = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, parentGroupId: parentId, name: "Child" },
      host,
    );
    expect(child.ok).toBe(true);
    const childId = dataString(child.data, "groupId");
    const parentItem = findShapeItem(contentsFrom(host), parentId) as MotionShapeGroupItem;
    expect(parentItem.items.some((entry) => entry.id === childId)).toBe(true);
  });

  it("rejects a non-shape layer", async () => {
    const textLayer: MotionLayer = {
      id: "text-layer",
      type: "text",
      name: "Text",
      startTime: 0,
      duration: 4,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      text: "Hi",
      style: { fontFamily: "Inter", fontSize: 40, fontWeight: 700, color: "#fff" },
    } as unknown as MotionLayer;
    const host = new HeadlessHost(projectWith([textLayer]));
    const res = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: "text-layer" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an invalid merge mode", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, mergeMode: "nope" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown parent group", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, parentGroupId: "ghost" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for an unknown composition", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_group",
      { compositionId: "ghost-comp", layerId: LAYER_ID },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("add_motion_shape_to_group", () => {
  it("adds a path item into a group with baked position", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, name: "Group" },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    const res = await executeTool(
      "add_motion_shape_to_group",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        parentGroupId: groupId,
        shapeType: "ellipse",
        width: 80,
        height: 60,
        position: { x: 12, y: 34 },
        name: "Circle 2",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const itemId = dataString(res.data, "itemId");
    const item = findShapeItem(contentsFrom(host), itemId) as MotionShapePathItem;
    expect(item.kind).toBe("path");
    expect(item.shapeType).toBe("ellipse");
    expect(item.position).toEqual({ x: 12, y: 34 });
    expect(item.name).toBe("Circle 2");
  });

  it("materializes the legacy root shape before adding a root item", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_to_group",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        shapeType: "ellipse",
        width: 40,
        height: 40,
        name: "Dot",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const itemId = dataString(res.data, "itemId");
    const contents = contentsFrom(host);
    expect(contents.length).toBe(2);
    const materialized = contents.find(
      (item) => item.kind === "group",
    ) as MotionShapeGroupItem | undefined;
    expect(materialized).toBeDefined();
    const original = materialized?.items[0] as MotionShapePathItem;
    expect(original.shapeType).toBe("rectangle");
    const added = findShapeItem(contents, itemId) as MotionShapePathItem;
    expect(added.shapeType).toBe("ellipse");
    expect(added.name).toBe("Dot");
  });

  it("rejects an unknown shape type", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "hyperbola" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for a missing parent group", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shape_to_group",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        parentGroupId: "ghost",
        shapeType: "rectangle",
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("update_motion_shape_item", () => {
  it("patches path item fields", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "update_motion_shape_item",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        itemId,
        patch: { width: 321, visible: false, name: "Renamed" },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const item = findShapeItem(contentsFrom(host), itemId) as MotionShapePathItem;
    expect(item.width).toBe(321);
    expect(item.visible).toBe(false);
    expect(item.name).toBe("Renamed");
  });

  it("patches a path item shapeType from rectangle to ellipse", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "update_motion_shape_item",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        itemId,
        patch: { shapeType: "ellipse" },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const item = findShapeItem(contentsFrom(host), itemId) as MotionShapePathItem;
    expect(item.shapeType).toBe("ellipse");
  });

  it("rejects a mesh shapeType on a 2D path item", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "update_motion_shape_item",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        itemId,
        patch: { shapeType: "mesh-cube" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("patches group transform + merge mode", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    const res = await executeTool(
      "update_motion_shape_item",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        itemId: groupId,
        patch: {
          mergeMode: "subtract",
          transform: {
            anchor: { x: 0, y: 0 },
            position: { x: 5, y: 6 },
            scale: { x: 2, y: 2 },
            rotation: 45,
            opacity: 0.5,
          },
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const item = findShapeItem(contentsFrom(host), groupId) as MotionShapeGroupItem;
    expect(item.mergeMode).toBe("subtract");
    expect(item.transform.position).toEqual({ x: 5, y: 6 });
    expect(item.transform.rotation).toBe(45);
  });

  it("rejects a transform patch on a path item (kind-guard)", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "update_motion_shape_item",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        itemId,
        patch: {
          transform: {
            anchor: { x: 0, y: 0 },
            position: { x: 5, y: 6 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            opacity: 1,
          },
        },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for a missing item", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "update_motion_shape_item",
      { compositionId: COMP_ID, layerId: LAYER_ID, itemId: "ghost", patch: { name: "x" } },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("remove_motion_shape_item / move_motion_shape_item", () => {
  it("removes an item", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "remove_motion_shape_item",
      { compositionId: COMP_ID, layerId: LAYER_ID, itemId },
      host,
    );
    expect(res.ok).toBe(true);
    expect(findShapeItem(contentsFrom(host), itemId)).toBeNull();
  });

  it("moves an item down among siblings", async () => {
    const host = new HeadlessHost(projectWithShape());
    const first = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle", name: "First" },
      host,
    );
    const second = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle", name: "Second" },
      host,
    );
    const firstId = dataString(first.data, "itemId");
    const secondId = dataString(second.data, "itemId");
    const res = await executeTool(
      "move_motion_shape_item",
      { compositionId: COMP_ID, layerId: LAYER_ID, itemId: firstId, direction: "down" },
      host,
    );
    expect(res.ok).toBe(true);
    const roots = contentsFrom(host);
    const firstIndex = roots.findIndex((item) => item.id === firstId);
    const secondIndex = roots.findIndex((item) => item.id === secondId);
    expect(firstIndex).toBeGreaterThan(secondIndex);
  });

  it("rejects an invalid move direction", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "move_motion_shape_item",
      { compositionId: COMP_ID, layerId: LAYER_ID, itemId, direction: "sideways" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("shape group operators", () => {
  it("adds, updates and removes an operator on a group", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    const add = await executeTool(
      "add_motion_shape_group_operator",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        groupId,
        operatorType: "twist",
      },
      host,
    );
    expect(add.ok).toBe(true);
    const operatorId = dataString(add.data, "operatorId");
    const group1 = findShapeItem(contentsFrom(host), groupId) as MotionShapeGroupItem;
    expect((group1.operators ?? []).some((op) => op.id === operatorId)).toBe(true);
    expect((group1.operators ?? [])[0]?.type).toBe("twist");

    const update = await executeTool(
      "update_motion_shape_group_operator",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        groupId,
        operatorId,
        fields: { angle: 90 },
        enabled: false,
      },
      host,
    );
    expect(update.ok).toBe(true);
    const group2 = findShapeItem(contentsFrom(host), groupId) as MotionShapeGroupItem;
    const op2 = (group2.operators ?? []).find((op) => op.id === operatorId);
    expect(op2?.type).toBe("twist");
    if (op2 && op2.type === "twist") {
      expect(op2.angle).toBe(90);
    }
    expect(op2?.enabled).toBe(false);

    const remove = await executeTool(
      "remove_motion_shape_group_operator",
      { compositionId: COMP_ID, layerId: LAYER_ID, groupId, operatorId },
      host,
    );
    expect(remove.ok).toBe(true);
    const group3 = findShapeItem(contentsFrom(host), groupId) as MotionShapeGroupItem;
    expect((group3.operators ?? []).some((op) => op.id === operatorId)).toBe(false);
  });

  it("allows duplicate operator types (ordered append)", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    await executeTool(
      "add_motion_shape_group_operator",
      { compositionId: COMP_ID, layerId: LAYER_ID, groupId, operatorType: "offset-paths" },
      host,
    );
    await executeTool(
      "add_motion_shape_group_operator",
      { compositionId: COMP_ID, layerId: LAYER_ID, groupId, operatorType: "offset-paths" },
      host,
    );
    const groupItem = findShapeItem(contentsFrom(host), groupId) as MotionShapeGroupItem;
    expect((groupItem.operators ?? []).length).toBe(2);
  });

  it("rejects an unknown operator type", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    const res = await executeTool(
      "add_motion_shape_group_operator",
      { compositionId: COMP_ID, layerId: LAYER_ID, groupId, operatorType: "warp" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an operator on a path item (not a group)", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shape_to_group",
      { compositionId: COMP_ID, layerId: LAYER_ID, shapeType: "rectangle" },
      host,
    );
    const itemId = dataString(added.data, "itemId");
    const res = await executeTool(
      "add_motion_shape_group_operator",
      { compositionId: COMP_ID, layerId: LAYER_ID, groupId: itemId, operatorType: "twist" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("merge_motion_shape_layers", () => {
  function projectWithTwoRects(): Project {
    const rectA: MotionShapeLayer = shapeLayer({
      id: "rect-a",
      name: "Rect A",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 100, y: 200 } },
    });
    const rectB: MotionShapeLayer = shapeLayer({
      id: "rect-b",
      name: "Rect B",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 500, y: 400 } },
    });
    return projectWith([rectA as MotionLayer, rectB as MotionLayer]);
  }

  it("merges two rect layers into one grouped layer, removes sources, bakes offsets", async () => {
    const host = new HeadlessHost(projectWithTwoRects());
    const res = await executeTool(
      "merge_motion_shape_layers",
      {
        compositionId: COMP_ID,
        layerIds: ["rect-a", "rect-b"],
        mode: "union",
        name: "Merged",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layerId = dataString(res.data, "layerId");
    const groupId = dataString(res.data, "groupId");

    const comp = compFrom(host);
    expect(comp.layers.some((layer) => layer.id === "rect-a")).toBe(false);
    expect(comp.layers.some((layer) => layer.id === "rect-b")).toBe(false);

    const mergedLayer = comp.layers.find((layer) => layer.id === layerId);
    expect(mergedLayer?.type).toBe("shape");
    if (!mergedLayer || mergedLayer.type !== "shape") throw new Error("merged missing");
    const group = findShapeItem(mergedLayer.contents ?? [], groupId) as MotionShapeGroupItem;
    expect(group.kind).toBe("group");
    expect(group.mergeMode).toBe("union");
    expect(group.items.length).toBe(2);

    expect(mergedLayer.transform.position).toEqual({ x: 640, y: 360 });

    const wrappers = group.items.filter(
      (item): item is MotionShapeGroupItem => item.kind === "group",
    );
    expect(wrappers.length).toBe(2);
    const wrapperPositions = wrappers.map((wrapper) => wrapper.transform.position);
    expect(wrapperPositions[0]).not.toEqual(wrapperPositions[1]);
    expect(
      wrapperPositions.some((pos) => pos.x === -540 && pos.y === -160),
    ).toBe(true);
    expect(wrapperPositions.some((pos) => pos.x === -140 && pos.y === 40)).toBe(true);

    for (const wrapper of wrappers) {
      expect(wrapper.mergeMode ?? "none").toBe("none");
      const inner = wrapper.items[0] as MotionShapePathItem;
      expect(inner.kind).toBe("path");
      expect(inner.position).toEqual({ x: 0, y: 0 });
    }
  });

  it("preserves source rotation on the wrapper group", async () => {
    const rotated: MotionShapeLayer = shapeLayer({
      id: "rect-a",
      name: "Rotated",
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 100, y: 200 },
        rotation: 45,
      },
    });
    const plain: MotionShapeLayer = shapeLayer({
      id: "rect-b",
      name: "Plain",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 500, y: 400 } },
    });
    const host = new HeadlessHost(
      projectWith([rotated as MotionLayer, plain as MotionLayer]),
    );
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: ["rect-a", "rect-b"], mode: "union" },
      host,
    );
    expect(res.ok).toBe(true);
    const groupId = dataString(res.data, "groupId");
    const layerId = dataString(res.data, "layerId");
    const merged = compFrom(host).layers.find((layer) => layer.id === layerId);
    if (!merged || merged.type !== "shape") throw new Error("merged missing");
    const group = findShapeItem(merged.contents ?? [], groupId) as MotionShapeGroupItem;
    const wrappers = group.items.filter(
      (item): item is MotionShapeGroupItem => item.kind === "group",
    );
    const rotatedWrapper = wrappers.find(
      (wrapper) => wrapper.transform.rotation === 45,
    );
    expect(rotatedWrapper).toBeDefined();
    expect((rotatedWrapper?.items[0] as MotionShapePathItem).position).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("preserves source scale on the wrapper group", async () => {
    const scaled: MotionShapeLayer = shapeLayer({
      id: "rect-a",
      name: "Scaled",
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 300, y: 300 },
        scale: { x: 2, y: 3 },
      },
    });
    const plain: MotionShapeLayer = shapeLayer({
      id: "rect-b",
      name: "Plain",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 800, y: 600 } },
    });
    const host = new HeadlessHost(
      projectWith([scaled as MotionLayer, plain as MotionLayer]),
    );
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: ["rect-a", "rect-b"], mode: "union" },
      host,
    );
    expect(res.ok).toBe(true);
    const groupId = dataString(res.data, "groupId");
    const layerId = dataString(res.data, "layerId");
    const merged = compFrom(host).layers.find((layer) => layer.id === layerId);
    if (!merged || merged.type !== "shape") throw new Error("merged missing");
    const group = findShapeItem(merged.contents ?? [], groupId) as MotionShapeGroupItem;
    const wrappers = group.items.filter(
      (item): item is MotionShapeGroupItem => item.kind === "group",
    );
    const scaledWrapper = wrappers.find(
      (wrapper) => wrapper.transform.scale.x === 2 && wrapper.transform.scale.y === 3,
    );
    expect(scaledWrapper).toBeDefined();
  });

  it("merges a source that already has an explicit contents tree", async () => {
    const explicitChild: MotionShapePathItem = {
      kind: "path",
      id: "explicit-child",
      name: "Inner",
      shapeType: "ellipse",
      width: 60,
      height: 60,
      position: { x: 10, y: 20 },
    };
    const explicitGroup: MotionShapeGroupItem = {
      kind: "group",
      id: "explicit-group",
      name: "Explicit",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
      items: [explicitChild],
    };
    const withTree: MotionShapeLayer = shapeLayer({
      id: "rect-a",
      name: "Tree",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 200, y: 200 } },
      contents: [explicitGroup],
    });
    const plain: MotionShapeLayer = shapeLayer({
      id: "rect-b",
      name: "Plain",
      transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 600, y: 400 } },
    });
    const host = new HeadlessHost(
      projectWith([withTree as MotionLayer, plain as MotionLayer]),
    );
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: ["rect-a", "rect-b"], mode: "union" },
      host,
    );
    expect(res.ok).toBe(true);
    const groupId = dataString(res.data, "groupId");
    const layerId = dataString(res.data, "layerId");
    const merged = compFrom(host).layers.find((layer) => layer.id === layerId);
    if (!merged || merged.type !== "shape") throw new Error("merged missing");
    const group = findShapeItem(merged.contents ?? [], groupId) as MotionShapeGroupItem;
    expect(group.items.length).toBe(2);
    const preserved = findShapeItem(group.items, "explicit-child") as MotionShapePathItem;
    expect(preserved).toBeDefined();
    expect(preserved.shapeType).toBe("ellipse");
    expect(preserved.position).toEqual({ x: 10, y: 20 });
  });

  it("rejects fewer than two layers", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: [LAYER_ID], mode: "union" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a non-shape source layer", async () => {
    const textLayer: MotionLayer = {
      id: "text-layer",
      type: "text",
      name: "Text",
      startTime: 0,
      duration: 4,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      text: "Hi",
      style: { fontFamily: "Inter", fontSize: 40, fontWeight: 700, color: "#fff" },
    } as unknown as MotionLayer;
    const host = new HeadlessHost(projectWith([shapeLayer() as MotionLayer, textLayer]));
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: [LAYER_ID, "text-layer"], mode: "union" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
    expect(compFrom(host).layers.some((layer) => layer.id === LAYER_ID)).toBe(true);
  });

  it("rejects an invalid mode", async () => {
    const host = new HeadlessHost(projectWith([
      shapeLayer({ id: "rect-a" }) as MotionLayer,
      shapeLayer({ id: "rect-b" }) as MotionLayer,
    ]));
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: ["rect-a", "rect-b"], mode: "warp" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for a missing source layer", async () => {
    const host = new HeadlessHost(projectWith([
      shapeLayer({ id: "rect-a" }) as MotionLayer,
      shapeLayer({ id: "rect-b" }) as MotionLayer,
    ]));
    const res = await executeTool(
      "merge_motion_shape_layers",
      { compositionId: COMP_ID, layerIds: ["rect-a", "ghost"], mode: "union" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("add_motion_keyframe on contents.* properties", () => {
  it("keys a group transform rotation channel end-to-end", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    const property = `contents.${groupId}.transform.rotation`;
    const res = await executeTool(
      "add_motion_keyframe",
      { compositionId: COMP_ID, layerId: LAYER_ID, property, time: 1, value: 90 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerFrom(host);
    expect(layer.keyframes.some((keyframe) => keyframe.property === property)).toBe(true);
  });

  it("keys an operator param channel end-to-end", async () => {
    const host = new HeadlessHost(projectWithShape());
    const group = await executeTool(
      "add_motion_shape_group",
      { compositionId: COMP_ID, layerId: LAYER_ID },
      host,
    );
    const groupId = dataString(group.data, "groupId");
    const add = await executeTool(
      "add_motion_shape_group_operator",
      { compositionId: COMP_ID, layerId: LAYER_ID, groupId, operatorType: "twist" },
      host,
    );
    const operatorId = dataString(add.data, "operatorId");
    const property = `contents.${groupId}.operator.${operatorId}.angle`;
    const res = await executeTool(
      "add_motion_keyframe",
      { compositionId: COMP_ID, layerId: LAYER_ID, property, time: 2, value: 45 },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = layerFrom(host);
    expect(layer.keyframes.some((keyframe) => keyframe.property === property)).toBe(true);
  });
});
