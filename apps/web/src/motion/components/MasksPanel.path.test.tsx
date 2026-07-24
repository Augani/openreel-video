import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  addMotionLayerMask,
  type MotionComposition,
  type MotionLayer,
  type MotionMask,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { buildMotionPathMask } from "./StageCanvas";
import { MasksPanel } from "./MasksPanel";
import { MotionTimeline } from "./MotionTimeline";

function shapeLayer(masks: readonly MotionMask[] = []): MotionShapeLayer {
  return {
    id: "layer-1",
    type: "shape",
    name: "Card",
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
    masks: [...masks],
  };
}

function pathMask(): MotionMask {
  return {
    id: "mask-path-1",
    name: "Path Mask",
    enabled: true,
    shape: "path",
    mode: "add",
    inverted: false,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    expansion: 0,
    feather: 0,
    opacity: 1,
    pathPoints: [
      { x: -60, y: -60 },
      { x: 60, y: -60 },
      { x: 0, y: 60 },
    ],
  };
}

function composition(layer: MotionLayer): MotionComposition {
  return {
    id: "comp-1",
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [layer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("MasksPanel path masks", () => {
  const upsert = vi.fn();

  beforeEach(() => {
    upsert.mockReset();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Mask path test"),
      upsertMotionComposition: upsert,
    });
    useMotionStore.setState({
      selectedLayerId: "layer-1",
      selectedLayerIds: ["layer-1"],
      selectedProperty: null,
      rightTab: "masks",
      activeTool: "select",
      maskDrawMode: false,
      autoKeyframe: false,
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("arms mask-draw mode and the pen tool from the Draw mask button", () => {
    render(<MasksPanel composition={composition(shapeLayer())} />);
    fireEvent.click(screen.getByRole("button", { name: /draw mask/i }));
    expect(useMotionStore.getState().maskDrawMode).toBe(true);
    expect(useMotionStore.getState().activeTool).toBe("pen");
  });

  it("builds a shape:path mask with the drawn layer-local points", () => {
    const mask = buildMotionPathMask([
      { x: -60, y: -60 },
      { x: 60, y: -60 },
      { x: 0, y: 60 },
    ]);
    expect(mask.shape).toBe("path");
    expect(mask.pathPoints?.length ?? 0).toBeGreaterThanOrEqual(3);
    const layer = addMotionLayerMask(shapeLayer(), mask);
    const stored = layer.masks?.[0];
    expect(stored?.shape).toBe("path");
    expect(stored?.pathPoints?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("adds a path keyframe at the playhead via the path stopwatch", () => {
    useMotionStore.setState({ playhead: 1 });
    render(<MasksPanel composition={composition(shapeLayer([pathMask()]))} />);
    fireEvent.click(
      screen.getByRole("button", { name: /add mask path keyframe/i }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    const next = upsert.mock.calls[0]![0] as MotionComposition;
    const storedMask = next.layers[0]?.masks?.[0];
    expect((storedMask?.pathKeyframes?.length ?? 0)).toBe(1);
    expect(storedMask?.pathKeyframes?.[0]?.time).toBeCloseTo(1, 3);
  });

  it("renders a Mask Path lane with a diamond when path keyframes exist", () => {
    const keyed = pathMask();
    const layer = shapeLayer([
      {
        ...keyed,
        pathKeyframes: [
          {
            id: "kf-1",
            time: 1,
            property: "mask.mask-path-1.path",
            value: "M -60 -60 L 60 -60 L 0 60 Z",
            easing: "ease",
          },
        ],
      },
    ]);
    useMotionStore.setState({ selectedLayerId: "layer-1" });
    render(<MotionTimeline composition={composition(layer)} />);
    expect(screen.getAllByText(/Path/i).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Path Mask Path keyframe/i }),
    ).toBeInTheDocument();
  });
});
