import { describe, expect, it } from "vitest";
import type { MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  MOTION_ANIMATION_PRESETS,
  applyMotionAnimationPreset,
  canApplyMotionAnimationPreset,
} from "./motion-animation-presets";

const makeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 960, y: 540 },
    opacity: 1,
  },
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

const makeTextLayer = (): MotionLayer => ({
  id: "text-1",
  type: "text",
  name: "Title",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  text: "Launch",
  style: {
    fontFamily: "Inter",
    fontSize: 72,
    color: "#ffffff",
  },
});

describe("motion animation presets", () => {
  it("applies a slide-up entrance at the requested local time", () => {
    const layer = applyMotionAnimationPreset(makeLayer(), "slide-up-in", {
      startTime: 1,
      duration: 0.5,
      distance: 80,
      idFactory: (_presetId, property, time) => `${property}-${time}`,
    });

    expect(layer.keyframes).toEqual([
      {
        id: "transform.opacity-1",
        property: "transform.opacity",
        time: 1,
        value: 0,
        easing: "easeOutCubic",
      },
      {
        id: "transform.position.y-1",
        property: "transform.position.y",
        time: 1,
        value: 620,
        easing: "easeOutCubic",
      },
      {
        id: "transform.opacity-1.5",
        property: "transform.opacity",
        time: 1.5,
        value: 1,
        easing: "easeOutCubic",
      },
      {
        id: "transform.position.y-1.5",
        property: "transform.position.y",
        time: 1.5,
        value: 540,
        easing: "easeOutCubic",
      },
    ]);
  });

  it("replaces only affected preset properties inside the target window", () => {
    const original = {
      ...makeLayer(),
      keyframes: [
        {
          id: "old-opacity",
          property: "transform.opacity",
          time: 1.2,
          value: 0.4,
          easing: "ease",
        },
        {
          id: "keep-rotation",
          property: "transform.rotation",
          time: 1.2,
          value: 18,
          easing: "ease",
        },
        {
          id: "keep-opacity-outside",
          property: "transform.opacity",
          time: 3,
          value: 0.8,
          easing: "ease",
        },
      ],
    } satisfies MotionLayer;

    const layer = applyMotionAnimationPreset(original, "fade-in", {
      startTime: 1,
      duration: 0.5,
      idFactory: (_presetId, property, time) => `${property}-${time}`,
    });

    expect(layer.keyframes.map((keyframe) => keyframe.id)).toEqual([
      "transform.opacity-1",
      "keep-rotation",
      "transform.opacity-1.5",
      "keep-opacity-outside",
    ]);
  });

  it("prepares shape stroke style for draw-on presets", () => {
    const layer = applyMotionAnimationPreset(makeLayer(), "stroke-draw-on", {
      startTime: 1,
      duration: 0.8,
      idFactory: (_presetId, property, time) => `${property}-${time}`,
    });

    expect(layer.type).toBe("shape");
    if (layer.type !== "shape") return;
    expect(layer.style.stroke.width).toBe(4);
    expect(layer.style.stroke.opacity).toBe(1);
    expect(layer.style.stroke.dashArray).toEqual([1000]);
    expect(layer.style.stroke.dashOffset).toBe(1000);
    expect(layer.keyframes).toEqual([
      {
        id: "shape.stroke.dashOffset-1",
        property: "shape.stroke.dashOffset",
        time: 1,
        value: 1000,
        easing: "easeOutCubic",
      },
      {
        id: "shape.stroke.opacity-1",
        property: "shape.stroke.opacity",
        time: 1,
        value: 0,
        easing: "ease-out",
      },
      {
        id: "shape.stroke.dashOffset-1.8",
        property: "shape.stroke.dashOffset",
        time: 1.8,
        value: 0,
        easing: "easeOutCubic",
      },
      {
        id: "shape.stroke.opacity-1.8",
        property: "shape.stroke.opacity",
        time: 1.8,
        value: 1,
        easing: "ease-out",
      },
    ]);
  });

  it("only allows shape presets for shape layers", () => {
    const shapePreset = MOTION_ANIMATION_PRESETS.find(
      (preset) => preset.id === "gradient-sweep",
    );
    expect(shapePreset).toBeDefined();
    expect(canApplyMotionAnimationPreset(makeLayer(), shapePreset!)).toBe(true);
    expect(canApplyMotionAnimationPreset(makeTextLayer(), shapePreset!)).toBe(false);
    expect(() =>
      applyMotionAnimationPreset(makeTextLayer(), "gradient-sweep"),
    ).toThrow(/does not support text layers/);
  });
});
