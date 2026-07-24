import { describe, expect, it } from "vitest";
import type {
  MotionCompositionLayer,
  MotionLayer,
  MotionParticleLayer,
  MotionShapeLayer,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  copyMotionPropertyKeyframes,
  duplicateMotionLayerPropertyKeyframes,
  evaluateMotionPuppetPinsAtTime,
  getMotionLayerContentsPropertyDescriptors,
  getMotionLayerEffectPropertyDescriptors,
  getMotionLayerPropertyKeyframes,
  getMotionLayerPuppetPropertyDescriptors,
  getMotionLayerPropertyValue,
  getMotionLayerPropertyValueAtTime,
  getMotionParticleEmitterAtTime,
  getMotionPropertyDescriptor,
  getMotionPuppetPinKeyframeProperty,
  moveMotionLayerKeyframe,
  parseContentsPropertyId,
  parseMotionPuppetKeyframeProperty,
  pasteMotionLayerPropertyKeyframes,
  removeMotionLayerPropertyKeyframes,
  resolveShapeContentsAtTime,
  reverseMotionLayerPropertyKeyframes,
  scaleMotionLayerPropertyKeyframeTimes,
  setMotionLayerPropertyValue,
  upsertMotionLayerKeyframe,
} from "./motion-keyframes";
import { getMotionTransformAtTime } from "./motion-renderer";
import { createMotionParticleLayer } from "./motion-particles";
import { addMotionPuppetPin, createMotionPuppetPin } from "./motion-puppet";
import { addMotionLayerEffect, createMotionEffect, getMotionEffectKeyframeProperty } from "./motion-effects";

const makeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "text",
  name: "Title",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 100, y: 200 },
    scale: { x: 1, y: 1 },
  },
  keyframes: [],
  text: "Hello",
  style: {
    fontFamily: "Inter",
    fontSize: 72,
    color: "#ffffff",
  },
});

const makeShapeLayer = (): MotionShapeLayer => ({
  id: "shape-1",
  type: "shape",
  name: "Shape",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 120,
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: {
      color: "#ffffff",
      width: 4,
      opacity: 1,
      dashOffset: 0,
    },
    cornerRadius: 8,
  },
});

const makeCompositionLayer = (): MotionCompositionLayer => ({
  id: "precomp-1",
  type: "composition",
  name: "Precomp",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  compositionId: "nested",
  width: 1920,
  height: 1080,
  timeOffset: 0.5,
  playbackRate: 2,
  fit: "contain",
});

const makeParticleLayer = (): MotionParticleLayer =>
  createMotionParticleLayer(
    { width: 1920, height: 1080, duration: 5 },
    {
      id: "particles-1",
      emitter: {
        emissionRate: 20,
        maxParticles: 100,
        lifetime: 2,
        speed: 120,
        spread: 90,
        gravity: 50,
        size: 8,
        sizeRandomness: 0.2,
        opacityStart: 1,
        opacityEnd: 0,
        colorStart: "#ffffff",
        colorEnd: "#14b8a6",
        seed: 12,
        shape: "circle",
      },
    },
  );

describe("motion keyframe helpers", () => {
  it("gets and sets transform property values without mutating the source layer", () => {
    const layer = makeLayer();
    const updated = setMotionLayerPropertyValue(
      layer,
      "transform.position.x",
      320,
    );

    expect(getMotionLayerPropertyValue(layer, "transform.position.x")).toBe(100);
    expect(getMotionLayerPropertyValue(updated, "transform.position.x")).toBe(320);
    expect(updated.transform.position.y).toBe(200);
  });

  it("adds sorted keyframes and replaces an existing keyframe at the same time", () => {
    const layer = makeLayer();
    const withFirst = upsertMotionLayerKeyframe(
      layer,
      "transform.opacity",
      1,
      { value: 0.4, idFactory: () => "kf-1" },
    );
    const withSecond = upsertMotionLayerKeyframe(
      withFirst,
      "transform.opacity",
      0,
      { value: 0, idFactory: () => "kf-2" },
    );
    const replaced = upsertMotionLayerKeyframe(
      withSecond,
      "transform.opacity",
      1.0004,
      { value: 1 },
    );

    expect(replaced.keyframes).toEqual([
      {
        id: "kf-2",
        time: 0,
        property: "transform.opacity",
        value: 0,
        easing: "ease",
      },
      {
        id: "kf-1",
        time: 1.0004,
        property: "transform.opacity",
        value: 1,
        easing: "ease",
      },
    ]);
  });

  it("lists and removes keyframes by property", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.scale.x", 0, {
        value: 0,
        idFactory: () => "scale",
      }),
      "transform.opacity",
      0,
      { value: 0, idFactory: () => "opacity" },
    );

    expect(getMotionLayerPropertyKeyframes(layer, "transform.scale.x")).toHaveLength(1);

    const cleaned = removeMotionLayerPropertyKeyframes(
      layer,
      "transform.scale.x",
    );

    expect(cleaned.keyframes.map((keyframe) => keyframe.id)).toEqual(["opacity"]);
  });

  it("moves keyframes in time and merges same-property collisions", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.opacity", 0.5, {
        value: 0,
        idFactory: () => "first",
      }),
      "transform.opacity",
      1,
      { value: 1, idFactory: () => "second" },
    );

    const moved = moveMotionLayerKeyframe(layer, "first", 2.25);
    expect(moved.keyframes.map((keyframe) => [keyframe.id, keyframe.time])).toEqual([
      ["second", 1],
      ["first", 2.25],
    ]);

    const clamped = moveMotionLayerKeyframe(moved, "first", 99);
    expect(clamped.keyframes.find((keyframe) => keyframe.id === "first")?.time).toBe(
      5,
    );

    const merged = moveMotionLayerKeyframe(layer, "first", 1);
    expect(merged.keyframes).toEqual([
      {
        id: "second",
        time: 1,
        property: "transform.opacity",
        value: 0,
        easing: "ease",
      },
    ]);
  });

  it("evaluates a motion property value at a local timestamp", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.position.x", 0, {
        value: 100,
        easing: "linear",
        idFactory: () => "start",
      }),
      "transform.position.x",
      2,
      {
        value: 300,
        easing: "linear",
        idFactory: () => "end",
      },
    );

    expect(getMotionLayerPropertyValueAtTime(layer, "transform.position.x", 1)).toBe(200);
  });

  it("uses composition time as an animatable precomp property", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeCompositionLayer(), "composition.time", 0, {
        value: 4,
        easing: "linear",
        idFactory: () => "source-end",
      }),
      "composition.time",
      2,
      {
        value: 1,
        easing: "linear",
        idFactory: () => "source-start",
      },
    );

    expect(getMotionLayerPropertyValue(layer, "composition.time")).toBe(0.5);
    expect(getMotionLayerPropertyValueAtTime(layer, "composition.time", 1)).toBe(
      2.5,
    );

    const offset = setMotionLayerPropertyValue(
      makeCompositionLayer(),
      "composition.time",
      1.25,
    );
    expect(offset.timeOffset).toBe(1.25);
  });

  it("supports depth, 3D rotation, and perspective properties", () => {
    const depthLayer = setMotionLayerPropertyValue(
      setMotionLayerPropertyValue(
        setMotionLayerPropertyValue(makeLayer(), "transform.position.z", 80),
        "transform.rotation.x",
        35,
      ),
      "transform.perspective",
      1400,
    );

    expect(getMotionLayerPropertyValue(depthLayer, "transform.position.z")).toBe(80);
    expect(getMotionLayerPropertyValue(depthLayer, "transform.rotation.x")).toBe(35);
    expect(getMotionLayerPropertyValue(depthLayer, "transform.perspective")).toBe(1400);

    const animatedLayer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(depthLayer, "transform.position.z", 0, {
        value: 0,
        easing: "linear",
        idFactory: () => "depth-start",
      }),
      "transform.position.z",
      2,
      {
        value: 200,
        easing: "linear",
        idFactory: () => "depth-end",
      },
    );

    const transform = getMotionTransformAtTime(
      animatedLayer.transform,
      animatedLayer.keyframes,
      1,
    );

    expect(transform.position.z).toBe(100);
    expect(transform.rotation3d?.x).toBe(35);
    expect(transform.perspective).toBe(1400);
  });

  it("rotates a layer along its motion path when auto-orient is enabled", () => {
    const base = makeShapeLayer().transform;
    const keyframes = [
      { id: "px0", property: "transform.position.x", time: 0, value: 0, easing: "linear" as const },
      { id: "px1", property: "transform.position.x", time: 2, value: 100, easing: "linear" as const },
      { id: "py0", property: "transform.position.y", time: 0, value: 0, easing: "linear" as const },
      { id: "py1", property: "transform.position.y", time: 2, value: 100, easing: "linear" as const },
    ];

    const flat = getMotionTransformAtTime(base, keyframes, 1, [], 5, false);
    const oriented = getMotionTransformAtTime(base, keyframes, 1, [], 5, true);

    expect(flat.rotation).toBe(0);
    expect(oriented.rotation).toBeCloseTo(45, 1);
  });

  it("gets, sets, and evaluates shape style properties", () => {
    const layer = setMotionLayerPropertyValue(
      setMotionLayerPropertyValue(
        setMotionLayerPropertyValue(makeShapeLayer(), "shape.stroke.width", 12),
        "shape.fill.opacity",
        0.5,
      ),
      "shape.cornerRadius",
      24,
    );

    expect(getMotionLayerPropertyValue(layer, "shape.stroke.width")).toBe(12);
    expect(getMotionLayerPropertyValue(layer, "shape.fill.opacity")).toBe(0.5);
    expect(getMotionLayerPropertyValue(layer, "shape.cornerRadius")).toBe(24);

    const animated = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(layer, "shape.stroke.dashOffset", 0, {
        value: 0,
        easing: "linear",
        idFactory: () => "dash-start",
      }),
      "shape.stroke.dashOffset",
      2,
      {
        value: 40,
        easing: "linear",
        idFactory: () => "dash-end",
      },
    );

    expect(getMotionLayerPropertyValueAtTime(animated, "shape.stroke.dashOffset", 1))
      .toBe(20);
  });

  it("gets, sets, and evaluates particle emitter properties", () => {
    const layer = setMotionLayerPropertyValue(
      setMotionLayerPropertyValue(
        setMotionLayerPropertyValue(makeParticleLayer(), "particle.speed", 300),
        "particle.emissionRate",
        48,
      ),
      "particle.opacityEnd",
      0.25,
    );

    expect(getMotionLayerPropertyValue(layer, "particle.speed")).toBe(300);
    expect(getMotionLayerPropertyValue(layer, "particle.emissionRate")).toBe(48);
    expect(getMotionLayerPropertyValue(layer, "particle.opacityEnd")).toBe(0.25);

    const animated = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(layer, "particle.speed", 0, {
        value: 100,
        easing: "linear",
        idFactory: () => "speed-start",
      }),
      "particle.speed",
      2,
      {
        value: 500,
        easing: "linear",
        idFactory: () => "speed-end",
      },
    );

    expect(getMotionLayerPropertyValueAtTime(animated, "particle.speed", 1)).toBe(
      300,
    );
    expect(getMotionParticleEmitterAtTime(animated, 1).speed).toBe(300);
  });

  it("gets, sets, describes, and evaluates puppet pin properties", () => {
    const layer = addMotionPuppetPin(
      makeShapeLayer(),
      createMotionPuppetPin({
        id: "pin-1",
        name: "Corner Pin",
        bindPosition: { x: 0, y: 0 },
        position: { x: 20, y: 30 },
        radius: 120,
        strength: 1,
      }),
    );
    const xProperty = getMotionPuppetPinKeyframeProperty("pin-1", "position.x");
    const yProperty = getMotionPuppetPinKeyframeProperty("pin-1", "position.y");
    const radiusProperty = getMotionPuppetPinKeyframeProperty("pin-1", "radius");

    const edited = setMotionLayerPropertyValue(
      setMotionLayerPropertyValue(layer, xProperty, 60),
      radiusProperty,
      180,
    );

    expect(parseMotionPuppetKeyframeProperty(xProperty)).toEqual({
      pinId: "pin-1",
      property: "position.x",
    });
    expect(getMotionLayerPropertyValue(edited, xProperty)).toBe(60);
    expect(getMotionLayerPropertyValue(edited, radiusProperty)).toBe(180);
    expect(getMotionLayerPuppetPropertyDescriptors(layer).map((item) => item.label))
      .toContain("Corner Pin Position X");
    expect(getMotionPropertyDescriptor(yProperty)).toMatchObject({
      group: "Deform",
      label: "Pin Position Y",
      unit: "px",
    });

    const animated = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(edited, yProperty, 0, {
        value: 0,
        easing: "linear",
        idFactory: () => "pin-y-start",
      }),
      yProperty,
      2,
      {
        value: 100,
        easing: "linear",
        idFactory: () => "pin-y-end",
      },
    );
    const evaluated = evaluateMotionPuppetPinsAtTime(animated, 1);

    expect(getMotionLayerPropertyValueAtTime(animated, yProperty, 1)).toBe(50);
    expect(evaluated.puppetPins?.[0]).toMatchObject({
      position: { x: 60, y: 50 },
      radius: 180,
      strength: 1,
    });
  });

  it("gets, sets, and describes effect parameter properties", () => {
    const layer = addMotionLayerEffect(
      makeLayer(),
      createMotionEffect("blur", "blur-1"),
    );
    const property = getMotionEffectKeyframeProperty("blur-1", "radius");
    const edited = setMotionLayerPropertyValue(layer, property, 24);

    expect(getMotionLayerPropertyValue(edited, property)).toBe(24);
    expect(getMotionLayerEffectPropertyDescriptors(layer)).toEqual([
      expect.objectContaining({
        property,
        label: "Gaussian Blur Radius",
        group: "Effects",
        unit: "px",
      }),
    ]);
    expect(getMotionPropertyDescriptor(property)).toMatchObject({
      label: "Effect Radius",
      group: "Effects",
      min: 0,
      max: 200,
    });

    const animated = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(edited, property, 0, {
        value: 0,
        easing: "linear",
        idFactory: () => "blur-start",
      }),
      property,
      2,
      {
        value: 40,
        easing: "linear",
        idFactory: () => "blur-end",
      },
    );

    expect(getMotionLayerPropertyValueAtTime(animated, property, 1)).toBe(20);
  });

  it("duplicates property keyframes by an offset and replaces collisions", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.opacity", 0, {
        value: 0,
        easing: "linear",
        idFactory: () => "start",
      }),
      "transform.opacity",
      1,
      {
        value: 1,
        easing: "ease-out",
        idFactory: () => "end",
      },
    );

    const duplicated = duplicateMotionLayerPropertyKeyframes(
      layer,
      "transform.opacity",
      1,
      { idFactory: (_source, index) => `copy-${index}` },
    );

    expect(
      getMotionLayerPropertyKeyframes(duplicated, "transform.opacity").map(
        (keyframe) => [keyframe.id, keyframe.time, keyframe.value],
      ),
    ).toEqual([
      ["start", 0, 0],
      ["copy-0", 1, 0],
      ["copy-1", 2, 1],
    ]);
  });

  it("copies and pastes property keyframes relative to the paste time", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.opacity", 0.25, {
        value: 0,
        easing: "linear",
        idFactory: () => "fade-in",
      }),
      "transform.opacity",
      1.25,
      {
        value: 1,
        easing: "ease-out",
        idFactory: () => "fade-up",
      },
    );

    const clipboard = copyMotionPropertyKeyframes(
      layer.keyframes,
      "transform.opacity",
    );

    expect(clipboard).toMatchObject({
      sourceProperty: "transform.opacity",
      sourceStartTime: 0.25,
      span: 1,
      entries: [
        { timeOffset: 0, value: 0, easing: "linear" },
        { timeOffset: 1, value: 1, easing: "ease-out" },
      ],
    });

    const pasted = pasteMotionLayerPropertyKeyframes(
      layer,
      "transform.scale.x",
      clipboard!,
      2,
      { idFactory: (_source, index) => `paste-${index}` },
    );

    expect(
      getMotionLayerPropertyKeyframes(pasted, "transform.scale.x").map(
        (keyframe) => [
          keyframe.id,
          keyframe.time,
          keyframe.value,
          keyframe.easing,
        ],
      ),
    ).toEqual([
      ["paste-0", 2, 0, "linear"],
      ["paste-1", 3, 1, "ease-out"],
    ]);
  });

  it("pasted keyframes replace same-property collisions at the target times", () => {
    const sourceLayer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.opacity", 0, {
        value: 0,
        idFactory: () => "source-start",
      }),
      "transform.opacity",
      1,
      { value: 1, idFactory: () => "source-end" },
    );
    const targetLayer = upsertMotionLayerKeyframe(
      makeLayer(),
      "transform.rotation",
      2,
      { value: 45, idFactory: () => "old-rotation" },
    );
    const clipboard = copyMotionPropertyKeyframes(
      sourceLayer.keyframes,
      "transform.opacity",
    );

    const pasted = pasteMotionLayerPropertyKeyframes(
      targetLayer,
      "transform.rotation",
      clipboard!,
      2,
      { idFactory: (_source, index) => `new-rotation-${index}` },
    );

    expect(
      getMotionLayerPropertyKeyframes(pasted, "transform.rotation").map(
        (keyframe) => [keyframe.id, keyframe.time, keyframe.value],
      ),
    ).toEqual([
      ["new-rotation-0", 2, 0],
      ["new-rotation-1", 3, 1],
    ]);
  });

  it("reverses property keyframes inside their existing time range", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.position.x", 0.25, {
        value: 100,
        easing: "linear",
        idFactory: () => "first",
      }),
      "transform.position.x",
      1.25,
      {
        value: 500,
        easing: "ease-in",
        idFactory: () => "second",
      },
    );

    const reversed = reverseMotionLayerPropertyKeyframes(
      layer,
      "transform.position.x",
    );

    expect(
      getMotionLayerPropertyKeyframes(reversed, "transform.position.x").map(
        (keyframe) => [keyframe.id, keyframe.time, keyframe.value],
      ),
    ).toEqual([
      ["second", 0.25, 500],
      ["first", 1.25, 100],
    ]);
  });

  it("scales property keyframe timing around an anchor", () => {
    const layer = upsertMotionLayerKeyframe(
      upsertMotionLayerKeyframe(makeLayer(), "transform.rotation", 0.5, {
        value: 0,
        easing: "linear",
        idFactory: () => "start",
      }),
      "transform.rotation",
      2.5,
      {
        value: 180,
        easing: "ease-in-out",
        idFactory: () => "end",
      },
    );

    const stretched = scaleMotionLayerPropertyKeyframeTimes(
      layer,
      "transform.rotation",
      0.5,
      { anchorTime: 0.5 },
    );

    expect(
      getMotionLayerPropertyKeyframes(stretched, "transform.rotation").map(
        (keyframe) => [keyframe.id, keyframe.time, keyframe.value],
      ),
    ).toEqual([
      ["start", 0.5, 0],
      ["end", 1.5, 180],
    ]);
  });
});

const GROUP_TRANSFORM = {
  anchor: { x: 0, y: 0 },
  position: { x: 20, y: 30 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
} as const;

const makeContentsShapeLayer = (): MotionShapeLayer => ({
  ...makeShapeLayer(),
  contents: [
    {
      kind: "group",
      id: "grp-1",
      name: "Circle 2",
      transform: GROUP_TRANSFORM,
      items: [
        {
          kind: "path",
          id: "path-1",
          name: "Path 1",
          shapeType: "rectangle",
          width: 100,
          height: 100,
          position: { x: 0, y: 0 },
          pathData: "M 0 0 L 10 0 L 10 10 Z",
        },
      ],
      operators: [
        {
          id: "op-1",
          type: "twist",
          name: "Twist",
          enabled: true,
          angle: 0,
          center: { x: 0, y: 0 },
        },
      ],
    },
  ],
});

describe("parseContentsPropertyId", () => {
  it("accepts all three channel forms", () => {
    expect(parseContentsPropertyId("contents.abc.transform.positionX")).toEqual({
      itemId: "abc",
      channel: { type: "transform", field: "positionX" },
    });
    expect(parseContentsPropertyId("contents.abc.transform.opacity")).toEqual({
      itemId: "abc",
      channel: { type: "transform", field: "opacity" },
    });
    expect(parseContentsPropertyId("contents.abc.pathData")).toEqual({
      itemId: "abc",
      channel: { type: "pathData" },
    });
    expect(
      parseContentsPropertyId("contents.abc.operator.op-9.angle"),
    ).toEqual({
      itemId: "abc",
      channel: { type: "operator", operatorId: "op-9", param: "angle" },
    });
    expect(
      parseContentsPropertyId("contents.abc.operator.op-9.position.x"),
    ).toEqual({
      itemId: "abc",
      channel: { type: "operator", operatorId: "op-9", param: "position.x" },
    });
    expect(
      parseContentsPropertyId("contents.abc.operator.op-9.scale.y"),
    ).toEqual({
      itemId: "abc",
      channel: { type: "operator", operatorId: "op-9", param: "scale.y" },
    });
  });

  it("rejects malformed property ids", () => {
    expect(parseContentsPropertyId("contents..transform.positionX")).toBeNull();
    expect(parseContentsPropertyId("contents.abc.transform.zzz")).toBeNull();
    expect(
      parseContentsPropertyId("contents.abc.transform.positionX.extra"),
    ).toBeNull();
    expect(parseContentsPropertyId("contents.abc.operator.op-9")).toBeNull();
    expect(parseContentsPropertyId("shape.width")).toBeNull();
    expect(parseContentsPropertyId("contents.abc.unknown")).toBeNull();
    expect(
      parseContentsPropertyId("contents.abc.operator.op-9.position."),
    ).toBeNull();
    expect(
      parseContentsPropertyId("contents.abc.operator.op-9.position..x"),
    ).toBeNull();
  });

  it("returns null for legacy layers' unrelated ids", () => {
    expect(parseContentsPropertyId("transform.position.x")).toBeNull();
  });
});

describe("resolveShapeContentsAtTime", () => {
  it("resolves positionX at midpoint with linear easing", () => {
    let layer = makeContentsShapeLayer();
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.transform.positionX",
      0,
      { value: 0, easing: "linear" },
    );
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.transform.positionX",
      1,
      { value: 100, easing: "linear" },
    );
    const resolved = resolveShapeContentsAtTime(layer, 0.5);
    const group = resolved[0];
    if (group.kind !== "group") throw new Error("expected group");
    expect(group.transform.position.x).toBeCloseTo(50, 4);
    expect(group.transform.position.y).toBeCloseTo(30, 4);
  });

  it("resolves rotation and opacity channels", () => {
    let layer = makeContentsShapeLayer();
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.transform.rotation",
      0,
      { value: 0, easing: "linear" },
    );
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.transform.rotation",
      1,
      { value: 90, easing: "linear" },
    );
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.transform.opacity",
      0,
      { value: 1, easing: "linear" },
    );
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.transform.opacity",
      1,
      { value: 0, easing: "linear" },
    );
    const resolved = resolveShapeContentsAtTime(layer, 0.5);
    const group = resolved[0];
    if (group.kind !== "group") throw new Error("expected group");
    expect(group.transform.rotation).toBeCloseTo(45, 4);
    expect(group.transform.opacity).toBeCloseTo(0.5, 4);
  });

  it("resolves item pathData morph to an intermediate point count", () => {
    const base = makeContentsShapeLayer();
    const layer: MotionShapeLayer = {
      ...base,
      keyframes: [
        {
          id: "pd-0",
          time: 0,
          property: "contents.path-1.pathData",
          value: "M 0 0 L 10 0 L 10 10 Z",
          easing: "linear",
        },
        {
          id: "pd-1",
          time: 1,
          property: "contents.path-1.pathData",
          value: "M 0 0 L 20 0 L 20 20 L 0 20 Z",
          easing: "linear",
        },
      ],
    };
    const resolved = resolveShapeContentsAtTime(layer, 0.5);
    const group = resolved[0];
    if (group.kind !== "group") throw new Error("expected group");
    const path = group.items[0];
    if (path.kind !== "path") throw new Error("expected path");
    expect(typeof path.pathData).toBe("string");
    expect(path.pathData).not.toBe("M 0 0 L 10 0 L 10 10 Z");
    expect(path.pathData).not.toBe("M 0 0 L 20 0 L 20 20 L 0 20 Z");
  });

  it("resolves operator param (twist angle)", () => {
    let layer = makeContentsShapeLayer();
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.operator.op-1.angle",
      0,
      { value: 0, easing: "linear" },
    );
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.operator.op-1.angle",
      1,
      { value: 180, easing: "linear" },
    );
    const resolved = resolveShapeContentsAtTime(layer, 0.5);
    const group = resolved[0];
    if (group.kind !== "group") throw new Error("expected group");
    const operator = group.operators?.[0];
    if (!operator || operator.type !== "twist") {
      throw new Error("expected twist operator");
    }
    expect(operator.angle).toBeCloseTo(90, 4);
  });

  it("resolves a repeater operator dotted param (position.x) in a group", () => {
    const base = makeContentsShapeLayer();
    const group = base.contents?.[0];
    if (!group || group.kind !== "group") throw new Error("expected group");
    let layer: MotionShapeLayer = {
      ...base,
      contents: [
        {
          ...group,
          operators: [
            {
              id: "rep-1",
              type: "repeater",
              name: "Repeater",
              enabled: true,
              copies: 3,
              offset: 0,
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                opacity: 1,
              },
            },
          ],
        },
      ],
    };
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.operator.rep-1.position.x",
      0,
      { value: 0, easing: "linear" },
    );
    layer = upsertMotionLayerKeyframe(
      layer,
      "contents.grp-1.operator.rep-1.position.x",
      1,
      { value: 100, easing: "linear" },
    );
    const resolved = resolveShapeContentsAtTime(layer, 0.5);
    const resolvedGroup = resolved[0];
    if (resolvedGroup.kind !== "group") throw new Error("expected group");
    const operator = resolvedGroup.operators?.[0];
    if (!operator || operator.type !== "repeater") {
      throw new Error("expected repeater operator");
    }
    expect(operator.transform.position.x).toBeCloseTo(50, 4);
  });

  it("returns synthesized contents unchanged for a layer without keyframes", () => {
    const layer = makeContentsShapeLayer();
    const resolved = resolveShapeContentsAtTime(layer, 0.5);
    const group = resolved[0];
    if (group.kind !== "group") throw new Error("expected group");
    expect(group.transform.position.x).toBe(20);
  });
});

describe("getMotionLayerContentsPropertyDescriptors", () => {
  it("enumerates one entry per animatable channel of a 2-item tree", () => {
    const layer = makeContentsShapeLayer();
    const descriptors = getMotionLayerContentsPropertyDescriptors(layer);
    const properties = descriptors.map((descriptor) => descriptor.property);
    expect(properties).toContain("contents.grp-1.transform.positionX");
    expect(properties).toContain("contents.grp-1.transform.positionY");
    expect(properties).toContain("contents.grp-1.transform.scaleX");
    expect(properties).toContain("contents.grp-1.transform.scaleY");
    expect(properties).toContain("contents.grp-1.transform.rotation");
    expect(properties).toContain("contents.grp-1.transform.opacity");
    expect(properties).toContain("contents.grp-1.operator.op-1.angle");
    expect(properties).toContain("contents.path-1.pathData");
    const positionX = descriptors.find(
      (descriptor) =>
        descriptor.property === "contents.grp-1.transform.positionX",
    );
    expect(positionX?.label).toBe("Circle 2 › Position X");
  });

  it("returns empty descriptors and null parses for legacy layers", () => {
    const layer = makeShapeLayer();
    expect(getMotionLayerContentsPropertyDescriptors(layer)).toEqual([]);
    expect(parseContentsPropertyId("contents.__root.pathData")).not.toBeNull();
  });
});
