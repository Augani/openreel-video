import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  copyMotionLayersToClipboard,
  duplicateMotionLayers,
  nudgeMotionLayers,
  pasteMotionLayersFromClipboard,
  removeMotionLayers,
  setMotionLayersLocked,
  setMotionLayersVisible,
} from "./motion-layer-commands";

const makeLayer = (
  id: string,
  parentId?: string,
  position = { x: 100, y: 100 },
): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  parentId,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position,
  },
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeGroup = (id: string, children: string[] = []): MotionLayer => ({
  id,
  type: "group",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 200, y: 160 },
  },
  keyframes: [],
  children,
});

const makeComposition = (layers: MotionLayer[]): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1000,
  height: 600,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers,
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion layer commands", () => {
  it("duplicates selected groups with descendants and remapped parents", () => {
    const composition = makeComposition([
      makeGroup("group", ["child"]),
      makeLayer("child", "group"),
      makeLayer("matte"),
      {
        ...makeLayer("fill"),
        trackMatte: { enabled: true, type: "alpha", sourceLayerId: "child" },
      } as MotionLayer,
    ]);
    const result = duplicateMotionLayers(composition, ["group"], {
      idFactory: (layer) => `${layer.id}-copy`,
      keyframeIdFactory: (keyframeId) => `${keyframeId}-copy`,
      offset: { x: 20, y: 10 },
    });

    expect(result.duplicatedLayerIds).toEqual(["group-copy"]);
    expect(result.composition.layers.map((layer) => layer.id)).toEqual([
      "group",
      "child",
      "group-copy",
      "child-copy",
      "matte",
      "fill",
    ]);
    expect(result.composition.layers.find((layer) => layer.id === "child-copy")).toMatchObject({
      parentId: "group-copy",
    });
    expect(result.composition.layers.find((layer) => layer.id === "group-copy")).toMatchObject({
      transform: { position: { x: 220, y: 170 } },
    });
  });

  it("copies and pastes a hierarchy at the playhead with remapped references", () => {
    const composition = makeComposition([
      makeGroup("group", ["child"]),
      makeLayer("child", "group"),
      {
        ...makeLayer("fill"),
        startTime: 1,
        trackMatte: { enabled: true, type: "alpha", sourceLayerId: "child" },
      } as MotionLayer,
    ]);
    const clipboard = copyMotionLayersToClipboard(composition, ["group", "fill"]);

    expect(clipboard).not.toBeNull();
    const result = pasteMotionLayersFromClipboard(composition, clipboard!, {
      targetTime: 2,
      idFactory: (layer) => `${layer.id}-paste`,
      keyframeIdFactory: (keyframeId) => `${keyframeId}-paste`,
    });

    expect(result.duplicatedLayerIds).toEqual(["group-paste", "fill-paste"]);
    expect(result.composition.layers.find((layer) => layer.id === "group-paste")).toMatchObject({
      startTime: 2,
      children: ["child-paste"],
    });
    expect(result.composition.layers.find((layer) => layer.id === "child-paste")).toMatchObject({
      startTime: 2,
      parentId: "group-paste",
    });
    expect(result.composition.layers.find((layer) => layer.id === "fill-paste")).toMatchObject({
      startTime: 3,
      trackMatte: { sourceLayerId: "child-paste" },
    });
  });

  it("drops clipboard references to layers that were not copied", () => {
    const composition = makeComposition([
      makeLayer("matte"),
      {
        ...makeLayer("fill", "matte"),
        trackMatte: { enabled: true, type: "alpha", sourceLayerId: "matte" },
      } as MotionLayer,
    ]);

    const clipboard = copyMotionLayersToClipboard(composition, ["fill"]);

    expect(clipboard?.layers[0]?.parentId).toBeUndefined();
    expect(clipboard?.layers[0]?.trackMatte).toBeUndefined();
  });

  it("removes selected layers with descendants and clears dangling references", () => {
    const composition = makeComposition([
      makeGroup("group", ["child"]),
      makeLayer("child", "group"),
      {
        ...makeLayer("fill"),
        trackMatte: { enabled: true, type: "alpha", sourceLayerId: "child" },
      } as MotionLayer,
    ]);
    const result = removeMotionLayers(composition, ["group"]);

    expect(result.layers.map((layer) => layer.id)).toEqual(["fill"]);
    expect(result.layers[0]?.trackMatte).toBeUndefined();
  });

  it("toggles layer lock and visibility for selected ids", () => {
    const composition = makeComposition([makeLayer("a"), makeLayer("b")]);
    const locked = setMotionLayersLocked(composition, ["a"], true);
    const hidden = setMotionLayersVisible(locked, ["b"], false);

    expect(hidden.layers.find((layer) => layer.id === "a")?.locked).toBe(true);
    expect(hidden.layers.find((layer) => layer.id === "b")?.visible).toBe(false);
  });

  it("nudges selected top-level layers without double-moving children", () => {
    const composition = makeComposition([
      makeGroup("group", ["child"]),
      makeLayer("child", "group"),
      makeLayer("solo", undefined, { x: 20, y: 40 }),
    ]);
    const result = nudgeMotionLayers(
      composition,
      ["group", "child", "solo"],
      { x: 5, y: -2 },
    );

    expect(result.layers.find((layer) => layer.id === "group")?.transform.position).toEqual({
      x: 205,
      y: 158,
    });
    expect(result.layers.find((layer) => layer.id === "child")?.transform.position).toEqual({
      x: 100,
      y: 100,
    });
    expect(result.layers.find((layer) => layer.id === "solo")?.transform.position).toEqual({
      x: 25,
      y: 38,
    });
  });

  it("writes position keyframes when nudging animated layers", () => {
    const composition = makeComposition([
      {
        ...makeLayer("animated"),
        keyframes: [
          {
            id: "kf-1",
            property: "transform.position.x",
            time: 1,
            value: 100,
            easing: "linear",
          },
        ],
      } as MotionLayer,
    ]);
    const result = nudgeMotionLayers(
      composition,
      ["animated"],
      { x: 12, y: 3 },
      { time: 1 },
    );
    const layer = result.layers[0];

    expect(layer?.keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: "transform.position.x",
          time: 1,
          value: 112,
        }),
        expect.objectContaining({
          property: "transform.position.y",
          time: 1,
          value: 103,
        }),
      ]),
    );
  });
});
