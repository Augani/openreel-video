import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { MotionComposition, MotionLayer } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { createMotionLayerOfType } from "../motion-layer-factory";
import { useMotionStore } from "../stores/motion-store";
import { StageCanvas } from "./StageCanvas";

function makeComposition(): MotionComposition {
  const base: MotionComposition = {
    id: "multi-selection",
    name: "Multi selection",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 5,
    backgroundColor: "#111111",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  const first = createMotionLayerOfType(base, "shape", { id: "shape-a" });
  const second = createMotionLayerOfType(base, "shape", { id: "shape-b" });
  return {
    ...base,
    layers: [
      {
        ...first,
        transform: {
          ...first.transform,
          position: { x: 320, y: 360 },
        },
      } as MotionLayer,
      {
        ...second,
        transform: {
          ...second.transform,
          position: { x: 800, y: 360 },
        },
      } as MotionLayer,
    ],
  };
}

describe("StageCanvas multi-selection", () => {
  beforeEach(() => {
    const composition = makeComposition();
    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project,
        motionCompositions: [composition],
      },
    } as never);
    useMotionStore.setState({
      activeCompositionId: composition.id,
      selectedLayerId: "shape-b",
      selectedLayerIds: ["shape-a", "shape-b"],
      activeTool: "select",
      playhead: 0,
    } as never);
  });

  it("shows one transform frame with resize and rotate controls", () => {
    render(<StageCanvas composition={makeComposition()} />);

    expect(screen.getByTestId("motion-composition-stage")).toHaveClass(
      "overflow-hidden",
    );
    expect(screen.getByText("2 layers")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Resize layer/ })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Rotate layer" })).toBeInTheDocument();
  });

  it("moves every selected layer when one selected layer is dragged", async () => {
    const { container } = render(<StageCanvas composition={makeComposition()} />);
    const target = container.querySelector<HTMLElement>(
      '[data-motion-layer-id="shape-a"]',
    );
    if (!target) throw new Error("shape layer was not rendered");
    target.setPointerCapture = () => undefined;

    await act(async () => {
      dispatchPointer(target, "pointerdown", 10, 10);
      dispatchPointer(target, "pointermove", 20, 20);
      dispatchPointer(target, "pointerup", 20, 20);
      await Promise.resolve();
    });

    const stored = useProjectStore
      .getState()
      .project.motionCompositions?.find(
        (composition) => composition.id === "multi-selection",
      );
    const positions = stored?.layers.map((layer) => layer.transform.position);
    if (!positions?.[0] || !positions[1]) throw new Error("layers were not stored");
    expect(positions[0].x).toBeGreaterThan(320);
    expect(positions[0].y).toBeGreaterThan(360);
    expect(positions[1].x - positions[0].x).toBe(480);
    expect(positions[1].y - positions[0].y).toBe(0);
    expect(useMotionStore.getState().selectedLayerIds).toEqual([
      "shape-a",
      "shape-b",
    ]);
  });
});

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
): void {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
