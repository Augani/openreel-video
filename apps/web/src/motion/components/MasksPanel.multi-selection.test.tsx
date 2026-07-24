import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  createMotionMask,
  getMotionMaskKeyframeProperty,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MasksPanel } from "./MasksPanel";

const COMPOSITION_ID = "mask-multi";
const LAYER_IDS = ["shape-a", "shape-b"] as const;

function shapeLayer(id: string): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name: id,
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
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMPOSITION_ID,
    name: "Mask selection",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers: LAYER_IDS.map(shapeLayer),
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("MasksPanel multi-selection", () => {
  beforeEach(() => {
    const comp = composition();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Mask batch"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_IDS[0],
      selectedLayerIds: [...LAYER_IDS],
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("adds independent preset masks to every selected layer", async () => {
    render(<MasksPanel composition={composition()} />);

    expect(
      screen.getByText("New preset masks will be added to all 2 selected layers."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Ellipse Mask" }));

    await waitFor(() => {
      const stored = useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === COMPOSITION_ID,
        );
      expect(stored?.layers.map((layer) => layer.masks?.[0]?.shape)).toEqual([
        "ellipse",
        "ellipse",
      ]);
      expect(stored?.layers[0]?.masks?.[0]?.id).not.toBe(
        stored?.layers[1]?.masks?.[0]?.id,
      );
    });
  });

  it("replaces animated mask stacks across selected layers", async () => {
    const base = composition();
    const sourceMask = {
      ...createMotionMask("ellipse", "source-mask"),
      feather: 0.18,
    };
    const animated: MotionComposition = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          masks: [sourceMask],
          keyframes: [
            {
              id: "source-opacity-keyframe",
              time: 1.25,
              property: getMotionMaskKeyframeProperty(
                sourceMask.id,
                "opacity",
              ),
              value: 0.45,
              easing: "ease-in-out",
            },
          ],
        },
        {
          ...base.layers[1],
          masks: [createMotionMask("rectangle", "old-mask")],
        },
      ],
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, motionCompositions: [animated] },
    }));
    render(<MasksPanel composition={animated} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy mask stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace masks" }));

    await waitFor(() => {
      const stored = useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === COMPOSITION_ID,
        );
      expect(stored?.layers.map((layer) => layer.masks?.[0]?.shape)).toEqual([
        "ellipse",
        "ellipse",
      ]);
      expect(stored?.layers[0]?.masks?.[0]?.feather).toBe(0.18);
      expect(stored?.layers[1]?.masks?.[0]?.feather).toBe(0.18);
      const firstMaskId = stored?.layers[0]?.masks?.[0]?.id;
      const secondMaskId = stored?.layers[1]?.masks?.[0]?.id;
      expect(firstMaskId).not.toBe(secondMaskId);
      expect(stored?.layers[1]?.keyframes[0]?.property).toBe(
        getMotionMaskKeyframeProperty(secondMaskId!, "opacity"),
      );
    });
  });
});
