import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { LayerPanel } from "./LayerPanel";

function shapeLayer(id: string, name: string): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 240,
    height: 120,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: "layer-panel-comp",
    name: "Layer Panel Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers: [
      shapeLayer("layer-one", "Layer One"),
      shapeLayer("layer-two", "Layer Two"),
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
    (candidate) => candidate.id === "layer-panel-comp",
  );
  if (!stored) throw new Error("layer panel composition missing");
  return stored;
}

describe("LayerPanel contextual layer workflow", () => {
  beforeEach(() => {
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Layer panel context menu"),
        motionCompositions: [composition()],
      },
    });
    useMotionStore.setState({
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedKeyframeIds: [],
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("renames a layer inline on double click", async () => {
    render(<LayerPanel composition={composition()} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Select Layer One" }));
    const input = screen.getByRole("textbox", { name: "Rename Layer One" });
    fireEvent.change(input, { target: { value: "Hero Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(storedComposition().layers[0]?.name).toBe("Hero Title");
    });
  });

  it("exposes layer switches with stable names and pressed state", () => {
    render(<LayerPanel composition={composition()} />);

    for (const button of screen.getAllByRole("button", {
      name: "Layer visibility",
    })) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
    for (const name of ["Solo layer", "Lock layer", "Guide layer", "Shy layer"]) {
      for (const button of screen.getAllByRole("button", { name })) {
        expect(button).toHaveAttribute("aria-pressed", "false");
      }
    }
  });

  it("opens a right-click menu and duplicates the contextual selection", async () => {
    render(<LayerPanel composition={composition()} />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Select Layer One" }),
      { clientX: 120, clientY: 160 },
    );

    expect(screen.getByRole("menu", { name: "Layer actions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate selection" }));

    await waitFor(() => {
      const stored = storedComposition();
      expect(stored.layers).toHaveLength(3);
      expect(stored.layers.some((layer) => layer.name === "Layer One Copy")).toBe(
        true,
      );
      expect(useMotionStore.getState().selectedLayerIds).toHaveLength(1);
    });
  });

  it("preserves a multi-selection and groups it from the context menu", async () => {
    render(<LayerPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Select Layer One" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Layer Two" }), {
      ctrlKey: true,
    });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Select Layer Two" }),
      { clientX: 140, clientY: 180 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Group selection" }));

    await waitFor(() => {
      const stored = storedComposition();
      const group = stored.layers.find((layer) => layer.type === "group");
      expect(group).toBeDefined();
      expect(
        stored.layers
          .filter((layer) => layer.type === "shape")
          .every((layer) => layer.parentId === group?.id),
      ).toBe(true);
      expect(useMotionStore.getState().selectedLayerIds).toEqual([group?.id]);
    });
  });

  it("applies and clears a label color across the contextual multi-selection", async () => {
    const view = render(<LayerPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Select Layer One" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Layer Two" }), {
      ctrlKey: true,
    });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Select Layer Two" }),
      { clientX: 140, clientY: 180 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Set layer label Blue" }));

    await waitFor(() => {
      expect(storedComposition().layers.every((layer) => layer.labelColor === "#5d91d8")).toBe(true);
    });

    view.rerender(<LayerPanel composition={storedComposition()} />);
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Select Layer Two" }),
      { clientX: 140, clientY: 180 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear layer label color" }));

    await waitFor(() => {
      expect(storedComposition().layers.every((layer) => layer.labelColor === undefined)).toBe(true);
    });
  });
});
