import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionScene3DLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

function scene3dLayer(): MotionScene3DLayer {
  return {
    id: "layer-3d",
    type: "scene3d",
    name: "Hero 3D",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    object: { kind: "box" },
  };
}

function composition(): MotionComposition {
  return {
    id: "comp-3d",
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [scene3dLayer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("PropertiesPanel scene3d lighting", () => {
  const upsert = vi.fn();

  beforeEach(() => {
    upsert.mockReset();
    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Scene3D lighting test"),
      upsertMotionComposition: upsert,
    });
    useMotionStore.setState({
      selectedLayerId: "layer-3d",
      selectedLayerIds: ["layer-3d"],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renders the Lighting & Environment controls for a selected 3D layer", () => {
    render(<PropertiesPanel composition={composition()} />);
    expect(screen.getByText("Lighting & Environment")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("HDRI map URL")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Show environment as backdrop" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Ground shadow" })).toBeInTheDocument();
  });

  it("patches the layer lighting when the environment preset changes", () => {
    render(<PropertiesPanel composition={composition()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Environment" }), {
      target: { value: "sunset" },
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const next = upsert.mock.calls[0]![0] as MotionComposition;
    const layer = next.layers[0] as MotionScene3DLayer;
    expect(layer.lighting?.environment).toBe("sunset");
  });

  it("stores an HDRI url and the backdrop toggle", () => {
    render(<PropertiesPanel composition={composition()} />);
    fireEvent.change(screen.getByPlaceholderText("https://…/studio_2k.hdr"), {
      target: { value: "https://cdn.example/studio.hdr" },
    });
    const stored = upsert.mock.calls[0]![0] as MotionComposition;
    expect((stored.layers[0] as MotionScene3DLayer).lighting?.environmentUrl).toBe(
      "https://cdn.example/studio.hdr",
    );
  });
});
