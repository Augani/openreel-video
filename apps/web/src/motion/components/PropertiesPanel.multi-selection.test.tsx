import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const COMP_ID = "comp-multi-inspector";
const LAYER_IDS = ["shape-a", "shape-b", "shape-c"];

function shapeLayer(id: string, x: number, y: number): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x, y },
    },
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Multi inspect",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 5,
    backgroundColor: "#111827",
    layers: [
      shapeLayer(LAYER_IDS[0], 120, 100),
      shapeLayer(LAYER_IDS[1], 420, 260),
      shapeLayer(LAYER_IDS[2], 760, 480),
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const stored = (useProjectStore.getState().project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!stored) throw new Error("composition missing");
  return stored;
}

describe("PropertiesPanel multi-selection inspector", () => {
  beforeEach(() => {
    const comp = composition();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Multi-selection inspector"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_IDS[2],
      selectedLayerIds: [...LAYER_IDS],
      selectedLightId: null,
      playhead: 0,
      autoKeyframe: false,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("shows a dedicated inspector and aligns the full selection", async () => {
    render(<PropertiesPanel composition={composition()} />);

    expect(screen.getByText("3 layers selected")).toBeTruthy();
    expect(screen.getByText("Multi-selection inspector")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Align left" }));

    await waitFor(() => {
      const xs = storedComposition().layers.map((layer) => layer.transform.position.x);
      expect(new Set(xs).size).toBe(1);
    });
  });

  it("duplicates the selection and selects the new layers", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate selection" }));

    await waitFor(() => {
      expect(storedComposition().layers).toHaveLength(6);
      expect(useMotionStore.getState().selectedLayerIds).toHaveLength(3);
      expect(useMotionStore.getState().selectedLayerIds).not.toEqual(LAYER_IDS);
    });
  });

  it("can hide and lock every selected layer", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
    await waitFor(() => {
      expect(storedComposition().layers.every((layer) => !layer.visible)).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Lock all" }));
    await waitFor(() => {
      expect(storedComposition().layers.every((layer) => layer.locked)).toBe(true);
    });
  });
});
