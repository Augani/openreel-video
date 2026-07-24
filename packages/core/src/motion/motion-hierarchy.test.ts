import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  canParentMotionLayer,
  clearMotionLayerParents,
  createMotionNullControllerForLayers,
  getMotionLayerChildren,
  getMotionLayerDescendantIds,
  getMotionRootLayers,
  groupMotionLayers,
  normalizeMotionLayerHierarchy,
  parentMotionLayers,
  setMotionLayerParent,
  ungroupMotionLayers,
} from "./motion-hierarchy";

const makeLayer = (id: string, parentId?: string): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  parentId,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 100,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#14b8a6", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
});

const makeComposition = (layers: MotionLayer[]): MotionComposition => ({
  id: "motion-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers,
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("group / ungroup", () => {
  it("wraps a selection in a group and reparents the members", () => {
    const composition = makeComposition([makeLayer("a"), makeLayer("b"), makeLayer("c")]);
    const result = groupMotionLayers(composition, ["a", "b"], { id: "grp" });
    expect(result).not.toBeNull();
    const next = result!.composition;
    const group = next.layers.find((layer) => layer.id === "grp");
    expect(group?.type).toBe("group");
    expect(next.layers.find((layer) => layer.id === "a")?.parentId).toBe("grp");
    expect(next.layers.find((layer) => layer.id === "b")?.parentId).toBe("grp");
    expect(next.layers.find((layer) => layer.id === "c")?.parentId).toBeUndefined();
    expect(getMotionLayerChildren(next, "grp").map((layer) => layer.id).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("ungroups: reparents children up and removes the group", () => {
    const grouped = groupMotionLayers(
      makeComposition([makeLayer("a"), makeLayer("b")]),
      ["a", "b"],
      { id: "grp" },
    )!.composition;
    const next = ungroupMotionLayers(grouped, ["grp"]);
    expect(next.layers.some((layer) => layer.id === "grp")).toBe(false);
    expect(next.layers.find((layer) => layer.id === "a")?.parentId).toBeUndefined();
    expect(next.layers.find((layer) => layer.id === "b")?.parentId).toBeUndefined();
  });

  it("returns null for an empty selection", () => {
    expect(groupMotionLayers(makeComposition([makeLayer("a")]), [])).toBeNull();
  });

  it("preserves internal nesting when a parent and its child are both selected", () => {
    const composition = makeComposition([
      makeLayer("parent"),
      makeLayer("child", "parent"),
      makeLayer("other"),
    ]);
    const next = groupMotionLayers(composition, ["parent", "child"], {
      id: "grp",
    })!.composition;
    // child rides along under parent, parent moves under the group
    expect(next.layers.find((layer) => layer.id === "parent")?.parentId).toBe("grp");
    expect(next.layers.find((layer) => layer.id === "child")?.parentId).toBe("parent");
    expect(
      getMotionLayerChildren(next, "grp").map((layer) => layer.id),
    ).toEqual(["parent"]);
  });
});

describe("motion hierarchy", () => {
  it("detects roots and descendants from parentId", () => {
    const composition = makeComposition([
      makeLayer("root"),
      makeLayer("child", "root"),
      makeLayer("grandchild", "child"),
    ]);

    expect(getMotionRootLayers(composition).map((layer) => layer.id)).toEqual([
      "root",
    ]);
    expect([...getMotionLayerDescendantIds(composition, "root")]).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("prevents parent cycles", () => {
    const composition = makeComposition([
      makeLayer("root"),
      makeLayer("child", "root"),
    ]);

    expect(canParentMotionLayer(composition, "root", "child")).toBe(false);
    expect(canParentMotionLayer(composition, "child", "root")).toBe(true);
    expect(canParentMotionLayer(composition, "child", "child")).toBe(false);
  });

  it("sets parentId and keeps group children in sync", () => {
    const group: MotionLayer = {
      id: "group",
      type: "group",
      name: "Controller",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      children: [],
    };
    const composition = makeComposition([group, makeLayer("child")]);

    const updated = setMotionLayerParent(composition, "child", "group");
    const updatedGroup = updated.layers.find((layer) => layer.id === "group");
    const updatedChild = updated.layers.find((layer) => layer.id === "child");

    expect(updatedChild?.parentId).toBe("group");
    expect(updatedGroup).toMatchObject({ type: "group", children: ["child"] });
  });

  it("drops invalid parent references during normalization", () => {
    const composition = makeComposition([makeLayer("child", "missing")]);
    const normalized = normalizeMotionLayerHierarchy(composition);

    expect(normalized.layers[0].parentId).toBeUndefined();
    expect(getMotionRootLayers(normalized).map((layer) => layer.id)).toEqual([
      "child",
    ]);
  });

  it("parents multiple layers while preserving stage position", () => {
    const parent = {
      ...makeLayer("parent"),
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 100, y: 50, z: 10 },
      },
    };
    const child = {
      ...makeLayer("child"),
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 320, y: 240, z: 30 },
      },
      keyframes: [
        {
          id: "x",
          property: "transform.position.x",
          time: 0,
          value: 420,
          easing: "linear",
        },
      ],
    } satisfies MotionLayer;
    const composition = makeComposition([parent, child]);

    const parented = parentMotionLayers(composition, ["child"], "parent", {
      preserveStagePosition: true,
    });
    const parentedChild = parented.layers.find((layer) => layer.id === "child");
    const cleared = clearMotionLayerParents(parented, ["child"]);

    expect(parentedChild?.parentId).toBe("parent");
    expect(parentedChild?.transform.position).toEqual({ x: 220, y: 190, z: 20 });
    expect(parentedChild?.keyframes[0].value).toBe(320);
    expect(cleared.layers.find((layer) => layer.id === "child")?.parentId)
      .toBeUndefined();
  });

  it("creates a null controller for selected layers and parents them under it", () => {
    const first = {
      ...makeLayer("first"),
      startTime: 1,
      duration: 2,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 100, y: 200 },
      },
    };
    const second = {
      ...makeLayer("second"),
      startTime: 2,
      duration: 4,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 300, y: 400 },
      },
    };
    const result = createMotionNullControllerForLayers(
      makeComposition([first, second]),
      ["first", "second"],
      { id: "controller" },
    );

    expect(result?.controllerLayerId).toBe("controller");
    const controller = result?.composition.layers.find(
      (layer) => layer.id === "controller",
    );
    expect(controller).toMatchObject({
      type: "null",
      startTime: 1,
      duration: 5,
      transform: {
        position: { x: 200, y: 300, z: 0 },
      },
    });
    expect(
      result?.composition.layers
        .filter((layer) => layer.id === "first" || layer.id === "second")
        .map((layer) => [layer.id, layer.parentId, layer.transform.position]),
    ).toEqual([
      ["first", "controller", { x: -100, y: -100, z: 0 }],
      ["second", "controller", { x: 100, y: 100, z: 0 }],
    ]);
  });
});
