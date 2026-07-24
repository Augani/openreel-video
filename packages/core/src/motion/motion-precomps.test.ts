import { describe, expect, it } from "vitest";
import {
  addMotionComponentInstance,
  applyMotionInstanceOverrides,
  canNestMotionComposition,
  clearMotionCompositionTimeRemap,
  enableMotionCompositionTimeRemap,
  getMotionCompositionDescendantIds,
  getMotionCompositionLayerLocalTime,
  getMotionCompositionLayerPlaybackTime,
  getNestedMotionCompositionIds,
  isMotionCompositionTimeRemapped,
  MOTION_COMPOSITION_TIME_PROPERTY,
  precomposeMotionLayers,
} from "./motion-precomps";
import type { MotionComposition, MotionCompositionLayer, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

const makeComposition = (
  id: string,
  layers: MotionComposition["layers"] = [],
): MotionComposition => ({
  id,
  name: id,
  width: 1920,
  height: 1080,
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

const makePrecompLayer = (
  id: string,
  compositionId: string,
): MotionCompositionLayer => ({
  id,
  type: "composition",
  name: "Precomp",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  compositionId,
  width: 1920,
  height: 1080,
  timeOffset: 0,
  playbackRate: 1,
  fit: "contain",
});

const makeShapeLayer = (id: string, parentId?: string): MotionLayer => ({
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
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeGroupLayer = (id: string, children: readonly string[]): MotionLayer => ({
  id,
  type: "group",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  children: [...children],
});

describe("motion precomps", () => {
  it("lists nested composition layer sources", () => {
    const composition = makeComposition("host", [
      makePrecompLayer("layer-a", "source-a"),
      makePrecompLayer("layer-b", "source-b"),
    ]);

    expect(getNestedMotionCompositionIds(composition)).toEqual([
      "source-a",
      "source-b",
    ]);
  });

  it("walks nested composition descendants", () => {
    const leaf = makeComposition("leaf");
    const child = makeComposition("child", [makePrecompLayer("to-leaf", "leaf")]);
    const host = makeComposition("host", [makePrecompLayer("to-child", "child")]);

    expect(
      Array.from(getMotionCompositionDescendantIds([host, child, leaf], "host")),
    ).toEqual(["child", "leaf"]);
  });

  it("prevents recursive composition nesting", () => {
    const child = makeComposition("child", [makePrecompLayer("to-host", "host")]);
    const host = makeComposition("host");

    expect(canNestMotionComposition([host, child], "host", "child")).toBe(false);
    expect(canNestMotionComposition([host, child], "host", "host")).toBe(false);
    expect(canNestMotionComposition([host, child], "child", "host")).toBe(true);
  });

  it("maps layer-local time through offset and playback rate", () => {
    const layer = {
      ...makePrecompLayer("precomp", "source"),
      timeOffset: 1.5,
      playbackRate: 2,
    };

    expect(getMotionCompositionLayerLocalTime(layer, 0.75)).toBe(3);
  });

  it("loops source time without changing non-looping precomp behavior", () => {
    const base = {
      ...makePrecompLayer("precomp", "source"),
      timeOffset: 1,
      playbackRate: 2,
    };

    expect(getMotionCompositionLayerPlaybackTime(base, 3, 4)).toBe(7);
    expect(
      getMotionCompositionLayerPlaybackTime({ ...base, loop: true }, 3, 4),
    ).toBe(3);
    expect(
      getMotionCompositionLayerPlaybackTime({ ...base, loop: true }, 1.5, 4),
    ).toBe(0);
  });

  it("uses composition time-remap keyframes when present", () => {
    const layer = {
      ...makePrecompLayer("precomp", "source"),
      keyframes: [
        {
          id: "reverse-start",
          property: MOTION_COMPOSITION_TIME_PROPERTY,
          time: 0,
          value: 4,
          easing: "linear",
        },
        {
          id: "reverse-end",
          property: MOTION_COMPOSITION_TIME_PROPERTY,
          time: 2,
          value: 1,
          easing: "linear",
        },
      ],
    } satisfies MotionCompositionLayer;

    expect(getMotionCompositionLayerLocalTime(layer, 1)).toBe(2.5);
  });

  it("enables and clears composition time remapping", () => {
    const layer = {
      ...makePrecompLayer("precomp", "source"),
      duration: 4,
      timeOffset: 0.5,
      playbackRate: 2,
    };

    const remapped = enableMotionCompositionTimeRemap(layer, {
      sourceDuration: 3,
      idFactory: (_time, _value, index) => `remap-${index}`,
    });
    const cleared = clearMotionCompositionTimeRemap(remapped);

    expect(isMotionCompositionTimeRemapped(remapped)).toBe(true);
    expect(remapped.keyframes).toEqual([
      {
        id: "remap-0",
        property: MOTION_COMPOSITION_TIME_PROPERTY,
        time: 0,
        value: 0.5,
        easing: "linear",
      },
      {
        id: "remap-1",
        property: MOTION_COMPOSITION_TIME_PROPERTY,
        time: 4,
        value: 3,
        easing: "linear",
      },
    ]);
    expect(isMotionCompositionTimeRemapped(cleared)).toBe(false);
  });

  it("precomposes selected layers into a nested composition layer", () => {
    const host = makeComposition("host", [
      makeShapeLayer("background"),
      makeShapeLayer("headline"),
      makeShapeLayer("accent"),
      makeShapeLayer("foreground"),
    ]);
    const result = precomposeMotionLayers(host, ["headline", "accent"], {
      compositionId: "nested",
      layerId: "nested-layer",
      name: "Hero Lockup",
      now: 10,
    });

    expect(result?.precompLayerId).toBe("nested-layer");
    expect(result?.movedLayerIds).toEqual(["headline", "accent"]);
    expect(result?.nestedComposition).toMatchObject({
      id: "nested",
      name: "Hero Lockup",
      width: 1920,
      height: 1080,
      duration: 5,
      backgroundColor: "transparent",
      createdAt: 10,
      modifiedAt: 10,
    });
    expect(result?.nestedComposition.layers.map((layer) => layer.id)).toEqual([
      "headline",
      "accent",
    ]);
    expect(result?.hostComposition.layers.map((layer) => layer.id)).toEqual([
      "background",
      "nested-layer",
      "foreground",
    ]);
    expect(result?.hostComposition.layers[1]).toMatchObject({
      type: "composition",
      compositionId: "nested",
      width: 1920,
      height: 1080,
      fit: "fill",
    });
  });

  it("moves descendants with selected groups and keeps internal parenting", () => {
    const host = makeComposition("host", [
      makeShapeLayer("outside"),
      makeGroupLayer("group", ["child"]),
      makeShapeLayer("child", "group"),
    ]);
    const result = precomposeMotionLayers(host, ["group"], {
      compositionId: "nested",
      layerId: "nested-layer",
      now: 10,
    });

    expect(result?.movedLayerIds).toEqual(["group", "child"]);
    expect(result?.nestedComposition.layers.find((layer) => layer.id === "child")).toMatchObject({
      parentId: "group",
    });
    expect(result?.nestedComposition.layers.find((layer) => layer.id === "group")).toMatchObject({
      children: ["child"],
    });
    expect(result?.hostComposition.layers.map((layer) => layer.id)).toEqual([
      "outside",
      "nested-layer",
    ]);
  });

  it("cleans parent and matte references that point outside the precomp boundary", () => {
    const child = makeShapeLayer("child", "outside-parent");
    const fill = {
      ...makeShapeLayer("fill"),
      trackMatte: { enabled: true, type: "alpha", sourceLayerId: "child" },
    } satisfies MotionLayer;
    const host = makeComposition("host", [
      makeShapeLayer("outside-parent"),
      child,
      fill,
    ]);
    const result = precomposeMotionLayers(host, ["child"], {
      compositionId: "nested",
      layerId: "nested-layer",
      now: 10,
    });

    expect(result?.nestedComposition.layers[0]).toMatchObject({
      id: "child",
      parentId: undefined,
      trackMatte: undefined,
    });
    expect(result?.hostComposition.layers.find((layer) => layer.id === "fill")).toMatchObject({
      trackMatte: undefined,
    });
  });
});

describe("component instances + overrides", () => {
  const componentSource = makeComposition("comp-button", [
    {
      id: "label",
      type: "text",
      name: "Label",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      text: "Button",
      style: {
        fontFamily: "Inter",
        fontSize: 48,
        fontWeight: 700,
        color: "#ffffff",
        align: "center",
        lineHeight: 1.1,
      },
    } as MotionLayer,
    {
      id: "bg",
      type: "shape",
      name: "BG",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      shapeType: "rectangle",
      width: 200,
      height: 80,
      style: {
        fill: { type: "solid", color: "#14b8a6", opacity: 1 },
        stroke: { color: "#14b8a6", width: 0, opacity: 0 },
        cornerRadius: 12,
      },
    } as MotionLayer,
  ]);

  it("applies per-child text + color overrides onto a clone", () => {
    const out = applyMotionInstanceOverrides(componentSource, {
      label: { text: "Buy now", color: "#000000" },
      bg: { color: "#ff5800" },
    });
    expect(out).not.toBe(componentSource);
    const label = out.layers.find((l) => l.id === "label");
    const bg = out.layers.find((l) => l.id === "bg");
    expect(label).toMatchObject({ text: "Buy now" });
    expect((label as { style: { color: string } }).style.color).toBe("#000000");
    expect((bg as { style: { fill: { color: string } } }).style.fill.color).toBe("#ff5800");
    // master is untouched
    expect((componentSource.layers[0] as { text: string }).text).toBe("Button");
  });

  it("returns the same composition when there are no overrides", () => {
    expect(applyMotionInstanceOverrides(componentSource, {})).toBe(componentSource);
    expect(applyMotionInstanceOverrides(componentSource, undefined)).toBe(componentSource);
  });

  it("drops a master text gradient when overriding the color so the solid color wins", () => {
    const gradientSource = makeComposition("comp-gradient-text", [
      {
        id: "label",
        type: "text",
        name: "Label",
        startTime: 0,
        duration: 5,
        visible: true,
        locked: false,
        transform: DEFAULT_MOTION_TRANSFORM,
        keyframes: [],
        text: "Gradient",
        style: {
          fontFamily: "Inter",
          fontSize: 48,
          fontWeight: 700,
          color: "#ffffff",
          align: "center",
          lineHeight: 1.1,
          fillGradient: {
            type: "linear",
            angle: 90,
            stops: [
              { offset: 0, color: "#ff0000" },
              { offset: 1, color: "#0000ff" },
            ],
          },
        },
      } as MotionLayer,
    ]);
    const out = applyMotionInstanceOverrides(gradientSource, {
      label: { color: "#00ff00" },
    });
    const label = out.layers.find((l) => l.id === "label");
    expect((label as { style: { color: string } }).style.color).toBe("#00ff00");
    expect(
      (label as { style: { fillGradient?: unknown } }).style.fillGradient,
    ).toBeUndefined();
  });

  it("adds another instance referencing the same master composition", () => {
    const host = makeComposition("host", [makePrecompLayer("inst-1", "comp-button")]);
    const result = addMotionComponentInstance(host, "inst-1");
    expect(result).not.toBeNull();
    const layers = result!.composition.layers.filter((l) => l.type === "composition");
    expect(layers).toHaveLength(2);
    // both reference the same master comp
    expect(layers.every((l) => (l as MotionCompositionLayer).compositionId === "comp-button")).toBe(true);
    expect(result!.instanceLayerId).not.toBe("inst-1");
  });

  it("keeps a parented instance under the same group and registers it in children", () => {
    const group = makeGroupLayer("grp", ["inst-1"]);
    const parented: MotionCompositionLayer = {
      ...makePrecompLayer("inst-1", "comp-button"),
      parentId: "grp",
    };
    const host = makeComposition("host", [group, parented]);
    const result = addMotionComponentInstance(host, "inst-1");
    expect(result).not.toBeNull();
    const newId = result!.instanceLayerId;
    const newLayer = result!.composition.layers.find((l) => l.id === newId);
    expect(newLayer?.parentId).toBe("grp");
    const nextGroup = result!.composition.layers.find(
      (l) => l.id === "grp",
    ) as MotionLayer & { children: string[] };
    expect(nextGroup.children).toContain(newId);
    expect(nextGroup.children).toContain("inst-1");
  });

  it("returns null for a non-composition layer", () => {
    const host = makeComposition("host", []);
    expect(addMotionComponentInstance(host, "missing")).toBeNull();
  });
});
