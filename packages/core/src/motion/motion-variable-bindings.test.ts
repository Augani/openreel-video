import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionLayerVariableBinding,
  getCompatibleMotionVariableBindingTargets,
  removeMotionLayerVariableBinding,
  resolveMotionLayerVariableBindings,
} from "./motion-variable-bindings";
import { createMotionVariable } from "./motion-variables";

const makeTextLayer = (): MotionLayer => ({
  id: "text-1",
  type: "text",
  name: "Headline",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  text: "Original",
  style: {
    fontFamily: "Inter",
    fontSize: 96,
    color: "#ffffff",
  },
});

const makeShapeLayer = (): MotionLayer => ({
  id: "shape-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 320,
  height: 180,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 2, opacity: 1 },
    cornerRadius: 12,
  },
});

const makeComposition = (
  layers: MotionLayer[],
  variables = [
    createMotionVariable("text", {
      id: "headline",
      name: "Headline",
      value: "Launch day",
    }),
    createMotionVariable("color", {
      id: "brand",
      name: "Brand",
      value: "#ff0055",
    }),
    createMotionVariable("number", {
      id: "opacity",
      name: "Opacity",
      value: 0.42,
    }),
  ],
): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers,
  assets: [],
  variables,
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion variable bindings", () => {
  it("finds compatible targets for variable and layer types", () => {
    const textVariable = createMotionVariable("text", { id: "v1" });
    const colorVariable = createMotionVariable("color", { id: "v2" });

    expect(
      getCompatibleMotionVariableBindingTargets(makeTextLayer(), textVariable).map(
        (target) => target.target,
      ),
    ).toContain("text.content");
    expect(
      getCompatibleMotionVariableBindingTargets(makeShapeLayer(), colorVariable).map(
        (target) => target.target,
      ),
    ).toEqual(["shape.fill.color", "shape.stroke.color"]);
  });

  it("adds, replaces, removes, and resolves layer bindings", () => {
    const composition = makeComposition([makeTextLayer()]);
    const textVariable = composition.variables[0];
    const opacityVariable = composition.variables[2];
    const boundLayer = addMotionLayerVariableBinding(
      addMotionLayerVariableBinding(
        composition.layers[0],
        textVariable,
        "text.content",
        "binding-text",
      ),
      opacityVariable,
      "transform.opacity",
      "binding-opacity",
    );
    const resolved = resolveMotionLayerVariableBindings(
      { ...composition, layers: [boundLayer] },
      boundLayer,
    );

    expect(resolved).toMatchObject({
      text: "Launch day",
      transform: { opacity: 0.42 },
    });
    expect(
      removeMotionLayerVariableBinding(boundLayer, "binding-opacity")
        .variableBindings,
    ).toEqual([
      {
        id: "binding-text",
        variableId: "headline",
        target: "text.content",
      },
    ]);
  });

  it("supports variable overrides when resolving a reusable composition instance", () => {
    const composition = makeComposition([makeShapeLayer()]);
    const colorVariable = composition.variables[1];
    const boundLayer = addMotionLayerVariableBinding(
      composition.layers[0],
      colorVariable,
      "shape.fill.color",
      "binding-fill",
    );
    const resolved = resolveMotionLayerVariableBindings(
      { ...composition, layers: [boundLayer] },
      boundLayer,
      { brand: "#00ffcc" },
    );

    expect(resolved.type === "shape" ? resolved.style.fill.color : "").toBe(
      "#00ffcc",
    );
  });

  it("rejects incompatible bindings", () => {
    const textVariable = createMotionVariable("text", { id: "v1" });

    expect(() =>
      addMotionLayerVariableBinding(
        makeShapeLayer(),
        textVariable,
        "shape.fill.color",
      ),
    ).toThrow("Cannot bind text variable");
  });
});
