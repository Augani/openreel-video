import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  alignMotionLayersToTime,
  fitMotionLayersToRange,
  moveMotionLayerInTime,
  rippleDeleteMotionLayer,
  rippleMotionLayers,
  sequenceMotionLayers,
  splitMotionLayerAtTime,
  staggerMotionLayers,
  trimMotionLayerInPoint,
  trimMotionLayerOutPoint,
} from "./motion-layer-timing";

const makeLayer = (
  id: string,
  startTime = 0,
  duration = 2,
): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime,
  duration,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 320,
  height: 180,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  backgroundColor: "transparent",
  layers: [makeLayer("a"), makeLayer("b"), makeLayer("c")],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion layer timing", () => {
  it("moves layer start time with frame snapping and composition bounds", () => {
    const moved = moveMotionLayerInTime(makeLayer("a", 0, 2), 3.241, {
      compositionDuration: 6,
      frameRate: 30,
    });
    const clamped = moveMotionLayerInTime(makeLayer("a", 0, 2), 4.5, {
      compositionDuration: 5,
      frameRate: 30,
    });

    expect(moved.startTime).toBe(3.2333);
    expect(clamped.startTime).toBe(3);
  });

  it("trims in and out while preserving valid layer duration", () => {
    const layer = makeLayer("a", 1, 3);
    const trimmedIn = trimMotionLayerInPoint(layer, 2.2, {
      frameRate: 10,
    });
    const trimmedOut = trimMotionLayerOutPoint(layer, 2.2, {
      frameRate: 10,
    });

    expect(trimmedIn).toMatchObject({ startTime: 2.2, duration: 1.8 });
    expect(trimmedOut).toMatchObject({ startTime: 1, duration: 1.2 });
  });

  it("sequences layers in composition order with a gap", () => {
    const composition = sequenceMotionLayers(makeComposition(), {
      layerIds: ["a", "b", "c"],
      startTime: 1,
      gap: 0.25,
      frameRate: 30,
    });

    expect(composition.layers.map((layer) => layer.startTime)).toEqual([
      1,
      3.2667,
      5.5333,
    ]);
  });

  it("staggers selected layers from a shared start time", () => {
    const composition = staggerMotionLayers(makeComposition(), {
      layerIds: ["a", "c"],
      startTime: 0.5,
      offset: 0.2,
      frameRate: 10,
    });

    expect(composition.layers.map((layer) => layer.startTime)).toEqual([
      0.5,
      0,
      0.7,
    ]);
  });

  it("aligns selected layer in and out points to a target time", () => {
    const composition = {
      ...makeComposition(),
      layers: [makeLayer("a", 0.25, 1), makeLayer("b", 2, 1.5), makeLayer("c", 4, 1)],
    };

    const alignedIn = alignMotionLayersToTime(composition, {
      layerIds: ["a", "b"],
      edge: "in",
      time: 1.234,
      frameRate: 30,
    });
    const alignedOut = alignMotionLayersToTime(composition, {
      layerIds: ["a", "b"],
      edge: "out",
      time: 5,
      frameRate: 30,
    });

    expect(alignedIn.layers.map((layer) => layer.startTime)).toEqual([
      1.2333,
      1.2333,
      4,
    ]);
    expect(alignedOut.layers.map((layer) => layer.startTime)).toEqual([
      4,
      3.5,
      4,
    ]);
  });

  it("fits selected layers to a target range and retimes their keyframes", () => {
    const composition: MotionComposition = {
      ...makeComposition(),
      layers: [
        {
          ...makeLayer("a", 1, 2),
          keyframes: [
            {
              id: "a-start",
              property: "transform.opacity",
              time: 0.5,
              value: 0,
              easing: "linear",
            },
          ],
        },
        makeLayer("b", 3, 1),
        makeLayer("c", 6, 1),
      ],
    };

    const fitted = fitMotionLayersToRange(composition, {
      layerIds: ["a", "b"],
      startTime: 0,
      endTime: 6,
      frameRate: 30,
    });

    expect(fitted.layers.map((layer) => [layer.id, layer.startTime, layer.duration]))
      .toEqual([
        ["a", 0, 4],
        ["b", 4, 2],
        ["c", 6, 1],
      ]);
    expect(fitted.layers[0].keyframes[0].time).toBe(1);
  });

  it("splits a layer at a composition time into two continuous halves", () => {
    const composition = makeComposition();
    const layer = {
      ...makeLayer("a", 1, 4),
      keyframes: [
        { id: "k1", property: "transform.opacity", time: 0.5, value: 0, easing: "linear" },
        { id: "k2", property: "transform.opacity", time: 3.5, value: 1, easing: "linear" },
      ],
    } as unknown as MotionLayer;
    const comp = { ...composition, layers: [layer, makeLayer("b", 0, 2)] };

    const result = splitMotionLayerAtTime(comp, "a", 3, { frameRate: 30 });
    expect(result).not.toBeNull();
    const layers = result!.layers;
    expect(layers).toHaveLength(3);

    const [first, second] = layers;
    expect(first.id).toBe("a");
    expect(first.startTime).toBe(1);
    expect(first.duration).toBe(2);
    expect(first.keyframes).toHaveLength(2);

    expect(second.id).not.toBe("a");
    expect(second.startTime).toBe(3);
    expect(second.duration).toBe(2);
    expect(second.keyframes.map((k) => k.time)).toEqual([-1.5, 1.5]);
    expect(second.keyframes[0].id).not.toBe("k1");
  });

  it("refuses to split outside the layer bounds", () => {
    const comp = makeComposition();
    expect(splitMotionLayerAtTime(comp, "a", 0, { frameRate: 30 })).toBeNull();
    expect(splitMotionLayerAtTime(comp, "a", 99, { frameRate: 30 })).toBeNull();
    expect(splitMotionLayerAtTime(comp, "missing", 1, {})).toBeNull();
  });

  it("offsets timeOffset for source-timed layers when splitting", () => {
    const comp = makeComposition();
    const precomp = {
      ...makeLayer("p", 0, 4),
      type: "composition",
      compositionId: "nested",
      timeOffset: 2,
      playbackRate: 1,
    } as unknown as MotionLayer;
    const result = splitMotionLayerAtTime(
      { ...comp, layers: [precomp] },
      "p",
      1.5,
      { frameRate: 30 },
    );
    const second = result!.layers[1] as unknown as { timeOffset: number };
    expect(second.timeOffset).toBe(3.5);
  });
});

describe("ripple delete and ripple trim", () => {
  it("removes the target and pulls trailing layers earlier by the deleted duration", () => {
    const composition: MotionComposition = {
      ...makeComposition(),
      layers: [makeLayer("a", 0, 2), makeLayer("b", 2, 2), makeLayer("c", 4, 2)],
    };

    const result = rippleDeleteMotionLayer(composition, "b", { frameRate: 30 });

    expect(result.layers.map((layer) => layer.id)).toEqual(["a", "c"]);
    expect(result.layers.map((layer) => [layer.id, layer.startTime])).toEqual([
      ["a", 0],
      ["c", 2],
    ]);
  });

  it("does not move layers starting before the deleted clip's end", () => {
    const composition: MotionComposition = {
      ...makeComposition(),
      layers: [makeLayer("a", 0, 4), makeLayer("b", 2, 2), makeLayer("c", 5, 2)],
    };

    const result = rippleDeleteMotionLayer(composition, "b", { frameRate: 30 });

    expect(result.layers.map((layer) => [layer.id, layer.startTime])).toEqual([
      ["a", 0],
      ["c", 3],
    ]);
  });

  it("skips a locked trailing layer by default", () => {
    const composition: MotionComposition = {
      ...makeComposition(),
      layers: [
        makeLayer("a", 0, 2),
        makeLayer("b", 2, 2),
        { ...makeLayer("c", 4, 2), locked: true },
      ],
    };

    const result = rippleDeleteMotionLayer(composition, "b", { frameRate: 30 });

    expect(result.layers.map((layer) => [layer.id, layer.startTime])).toEqual([
      ["a", 0],
      ["c", 4],
    ]);
  });

  it("leaves keyframe times untouched on shifted layers", () => {
    const trailing = {
      ...makeLayer("c", 4, 2),
      keyframes: [
        { id: "kc", property: "transform.opacity", time: 0.5, value: 0, easing: "linear" },
        { id: "kc2", property: "transform.opacity", time: 1.5, value: 1, easing: "linear" },
      ],
    } as unknown as MotionLayer;
    const composition: MotionComposition = {
      ...makeComposition(),
      layers: [makeLayer("a", 0, 2), makeLayer("b", 2, 2), trailing],
    };

    const result = rippleDeleteMotionLayer(composition, "b", { frameRate: 30 });
    const shifted = result.layers.find((layer) => layer.id === "c");

    expect(shifted?.startTime).toBe(2);
    expect(shifted?.keyframes.map((keyframe) => keyframe.time)).toEqual([0.5, 1.5]);
  });

  it("never produces a negative start time", () => {
    const composition: MotionComposition = {
      ...makeComposition(),
      layers: [makeLayer("a", 1, 5), makeLayer("b", 6, 2)],
    };

    const result = rippleDeleteMotionLayer(composition, "a", { frameRate: 30 });

    expect(result.layers.map((layer) => [layer.id, layer.startTime])).toEqual([
      ["b", 1],
    ]);
    expect(result.layers.every((layer) => layer.startTime >= 0)).toBe(true);
  });

  it("returns the same composition reference when delta is zero", () => {
    const composition = makeComposition();
    const result = rippleMotionLayers(composition, {
      fromTime: 0,
      deltaSeconds: 0,
      frameRate: 30,
    });

    expect(result).toBe(composition);
  });
});
