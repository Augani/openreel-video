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
import { LayerPanel } from "./LayerPanel";
import { MotionTimeline } from "./MotionTimeline";

function layer(id: string, name: string, shy = false): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name,
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    shy,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 120,
    height: 120,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(hideShyLayers = false): MotionComposition {
  return {
    id: "shy-comp",
    name: "Shy Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "transparent",
    hideShyLayers,
    layers: [layer("hero", "Hero"), layer("finished", "Finished", true)],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const stored = (useProjectStore.getState().project.motionCompositions ?? []).find(
    (candidate) => candidate.id === "shy-comp",
  );
  if (!stored) throw new Error("shy composition missing");
  return stored;
}

describe("Motion shy layer workflow", () => {
  beforeEach(() => {
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Shy layers"),
        motionCompositions: [composition()],
      },
    });
    useMotionStore.setState({ selectedLayerId: null, selectedLayerIds: [] });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("persists the master switch and only removes shy rows from the layer panel", async () => {
    const view = render(<LayerPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide shy layers" }));
    await waitFor(() => expect(storedComposition().hideShyLayers).toBe(true));

    view.rerender(<LayerPanel composition={storedComposition()} />);
    expect(screen.getByRole("button", { name: "Select Hero" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Finished" })).toBeNull();
    expect(storedComposition().layers).toHaveLength(2);
  });

  it("hides shy tracks in the timeline without deleting their composition data", () => {
    render(<MotionTimeline composition={composition(true)} />);

    expect(screen.getByRole("button", { name: "Select Hero" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Finished" })).toBeNull();
    expect(screen.getByText("1 / 2 layers")).toBeInTheDocument();
  });

  it("searches timeline rows without changing the composition", () => {
    render(<MotionTimeline composition={composition()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search timeline layers" }), {
      target: { value: "finished" },
    });

    expect(screen.queryByRole("button", { name: "Select Hero" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select Finished" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeInTheDocument();
  });

  it("isolates selected layers while retaining hidden selections in store", () => {
    useMotionStore.setState({
      selectedLayerId: "finished",
      selectedLayerIds: ["finished"],
    });
    render(<MotionTimeline composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "selected" }));

    expect(screen.queryByRole("button", { name: "Select Hero" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select Finished" })).toBeInTheDocument();
    expect(useMotionStore.getState().selectedLayerIds).toEqual(["finished"]);
  });

  it("uses a custom label color for the timeline bar", () => {
    const comp = composition();
    const labeled = {
      ...comp,
      layers: comp.layers.map((candidate, index) =>
        index === 0 ? { ...candidate, labelColor: "#ef6a6a" } : candidate,
      ),
    } as MotionComposition;
    render(<MotionTimeline composition={labeled} />);

    expect(screen.getByRole("button", { name: "Move Hero in time" })).toHaveStyle({
      backgroundColor: "#ef6a6a",
    });
  });
});
