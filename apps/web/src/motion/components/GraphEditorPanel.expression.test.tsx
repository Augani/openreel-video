import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  evaluateMotionPropertyValueAtTime,
  type MotionComposition,
  type MotionExpression,
  type MotionLayer,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { GraphEditorPanel } from "./GraphEditorPanel";

function expression(overrides: Partial<MotionExpression>): MotionExpression {
  return {
    id: "expr-1",
    property: "transform.opacity",
    type: "expression",
    name: "Expression",
    enabled: true,
    amplitude: 0,
    frequency: 1,
    phase: 0,
    seed: 1,
    decay: 3,
    code: "value + 1",
    ...overrides,
  };
}

function shapeLayer(
  id: string,
  name: string,
  expressions: readonly MotionExpression[] = [],
): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name,
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 200,
    height: 200,
    style: {
      fill: { type: "solid", color: "#ffffff", opacity: 1 },
      stroke: { color: "#000000", width: 0, opacity: 1 },
    },
    masks: [],
    expressions: [...expressions],
  };
}

function composition(layers: readonly MotionLayer[]): MotionComposition {
  return {
    id: "comp-1",
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
}

describe("GraphEditorPanel expression section", () => {
  const upsert = vi.fn();

  beforeEach(() => {
    upsert.mockReset();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Expression test"),
      upsertMotionComposition: upsert,
    });
    useMotionStore.setState({
      selectedLayerId: "layer-a",
      selectedLayerIds: ["layer-a"],
      selectedLightId: null,
      selectedProperty: "transform.opacity",
      activeTool: "select",
      autoKeyframe: false,
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renders a red error alert from the registry and clears it when fixed", () => {
    const brokenLayer = shapeLayer("layer-a", "A", [
      expression({ id: "expr-broken", code: "undefinedFn()" }),
    ]);

    evaluateMotionPropertyValueAtTime({
      keyframes: brokenLayer.keyframes,
      expressions: brokenLayer.expressions,
      property: "transform.opacity",
      localTime: 0,
      fallback: 1,
      duration: 4,
    });

    const { rerender } = render(
      <GraphEditorPanel composition={composition([brokenLayer])} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/undefinedFn/);

    const fixedLayer = shapeLayer("layer-a", "A", [
      expression({ id: "expr-broken", code: "value + 1" }),
    ]);
    evaluateMotionPropertyValueAtTime({
      keyframes: fixedLayer.keyframes,
      expressions: fixedLayer.expressions,
      property: "transform.opacity",
      localTime: 0,
      fallback: 1,
      duration: 4,
    });

    rerender(<GraphEditorPanel composition={composition([fixedLayer])} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the error alert when the expression is disabled", () => {
    const brokenLayer = shapeLayer("layer-a", "A", [
      expression({ id: "expr-disabled", code: "undefinedFn()" }),
    ]);

    evaluateMotionPropertyValueAtTime({
      keyframes: brokenLayer.keyframes,
      expressions: brokenLayer.expressions,
      property: "transform.opacity",
      localTime: 0,
      fallback: 1,
      duration: 4,
    });

    const { rerender } = render(
      <GraphEditorPanel composition={composition([brokenLayer])} />,
    );
    expect(screen.getByRole("alert").textContent ?? "").toMatch(/undefinedFn/);

    const disabledLayer = shapeLayer("layer-a", "A", [
      expression({ id: "expr-disabled", code: "undefinedFn()", enabled: false }),
    ]);
    rerender(<GraphEditorPanel composition={composition([disabledLayer])} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("inserts thisComp.layer(...).value(...) for another layer", () => {
    const layerA = shapeLayer("layer-a", "A", [
      expression({ id: "expr-a", code: "value" }),
    ]);
    const layerB = shapeLayer("layer-b", "B");

    render(
      <GraphEditorPanel composition={composition([layerA, layerB])} />,
    );

    fireEvent.change(screen.getByLabelText(/reference layer/i), {
      target: { value: "layer-b" },
    });
    fireEvent.change(screen.getByLabelText(/reference property/i), {
      target: { value: "transform.opacity" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /insert reference/i }),
    );

    expect(upsert).toHaveBeenCalled();
    const next = upsert.mock.calls.at(-1)![0] as MotionComposition;
    const expr = next.layers[0]?.expressions?.[0];
    expect(expr?.code).toContain(
      'thisComp.layer("B").value("transform.opacity")',
    );
  });

  it("inserts thisLayer.value(...) when referencing the same layer", () => {
    const layerA = shapeLayer("layer-a", "A", [
      expression({ id: "expr-a", code: "value" }),
    ]);

    render(<GraphEditorPanel composition={composition([layerA])} />);

    fireEvent.change(screen.getByLabelText(/reference layer/i), {
      target: { value: "layer-a" },
    });
    fireEvent.change(screen.getByLabelText(/reference property/i), {
      target: { value: "transform.scale.x" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /insert reference/i }),
    );

    const next = upsert.mock.calls.at(-1)![0] as MotionComposition;
    const expr = next.layers[0]?.expressions?.[0];
    expect(expr?.code).toContain('thisLayer.value("transform.scale.x")');
  });

  it("escapes quotes and backslashes in referenced layer names", () => {
    const layerA = shapeLayer("layer-a", "A", [
      expression({ id: "expr-a", code: "value" }),
    ]);
    const trickyLayer = shapeLayer("layer-b", 'B"\\name');

    render(
      <GraphEditorPanel composition={composition([layerA, trickyLayer])} />,
    );

    fireEvent.change(screen.getByLabelText(/reference layer/i), {
      target: { value: "layer-b" },
    });
    fireEvent.change(screen.getByLabelText(/reference property/i), {
      target: { value: "transform.opacity" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /insert reference/i }),
    );

    const next = upsert.mock.calls.at(-1)![0] as MotionComposition;
    const expr = next.layers[0]?.expressions?.[0];
    expect(expr?.code).toContain(
      'thisComp.layer("B\\"\\\\name").value("transform.opacity")',
    );
  });
});
