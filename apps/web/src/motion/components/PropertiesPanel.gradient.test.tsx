import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  createDefaultMotionGradientFill,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const LAYER_ID = "layer-shape";
const COMP_ID = "comp-gradient";

function shapeLayer(): MotionShapeLayer {
  return {
    id: LAYER_ID,
    type: "shape",
    name: "Block",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 400,
    height: 240,
    style: {
      fill: createDefaultMotionGradientFill("#14b8a6", "#ffffff"),
      stroke: { color: "#ffffff", width: 8, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [shapeLayer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function storedComposition(): MotionComposition {
  const project = useProjectStore.getState().project;
  const found = (project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!found) throw new Error("composition not stored");
  return found;
}

function storedShapeLayer(): MotionShapeLayer {
  return storedComposition().layers[0] as MotionShapeLayer;
}

function seed(comp: MotionComposition): void {
  useProjectStore.setState({
    hasOpenProject: true,
    project: {
      ...createEmptyProject("Gradient test"),
      motionCompositions: [comp],
    },
  });
  useMotionStore.setState({
    selectedLayerId: LAYER_ID,
    selectedLayerIds: [LAYER_ID],
    selectedLightId: null,
    rightTab: "properties",
    playhead: 0,
    autoKeyframe: false,
  });
}

describe("PropertiesPanel gradient editor", () => {
  beforeEach(() => {
    seed(composition());
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("shows every fill gradient stop", () => {
    render(<PropertiesPanel composition={composition()} />);
    expect(screen.getAllByTestId("gradient-stop")).toHaveLength(2);
  });

  it("adds a midway stop, sorted by offset", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));

    await waitFor(() => {
      const gradient = storedShapeLayer().style.fill.gradient;
      if (!gradient) throw new Error("gradient missing");
      expect(gradient.stops).toHaveLength(3);
    });

    const gradient = storedShapeLayer().style.fill.gradient!;
    const offsets = gradient.stops.map((stop) => stop.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(gradient.stops[1].offset).toBeCloseTo(0.5, 5);
  });

  it("edits a stop offset and persists sorted", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    await waitFor(() => {
      expect(storedShapeLayer().style.fill.gradient?.stops).toHaveLength(3);
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);

    const rows = screen.getAllByTestId("gradient-stop");
    const middleOffset = within(rows[1]).getByRole("spinbutton");
    fireEvent.change(middleOffset, { target: { value: "0.9" } });

    await waitFor(() => {
      const stops = storedShapeLayer().style.fill.gradient?.stops ?? [];
      expect(stops.map((stop) => stop.offset)).toEqual([0, 0.9, 1]);
    });
  });

  it("edits a stop color and persists", async () => {
    render(<PropertiesPanel composition={composition()} />);

    const rows = screen.getAllByTestId("gradient-stop");
    const firstColor = within(rows[0]).getByRole("textbox");
    fireEvent.change(firstColor, { target: { value: "#ff00aa" } });

    await waitFor(() => {
      const stops = storedShapeLayer().style.fill.gradient?.stops ?? [];
      expect(stops[0].color).toBe("#ff00aa");
    });
  });

  it("removes a stop back to the minimum of two", async () => {
    render(<PropertiesPanel composition={composition()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    await waitFor(() => {
      expect(storedShapeLayer().style.fill.gradient?.stops).toHaveLength(3);
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);

    const removeButtons = screen.getAllByRole("button", {
      name: /remove stop/i,
    });
    expect(removeButtons).toHaveLength(3);
    fireEvent.click(removeButtons[1]);

    await waitFor(() => {
      expect(storedShapeLayer().style.fill.gradient?.stops).toHaveLength(2);
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);
    expect(
      screen.queryAllByRole("button", { name: /remove stop/i }),
    ).toHaveLength(0);
  });

  it("enables a stroke gradient via the stroke fill-mode toggle", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Gradient stroke" }));

    await waitFor(() => {
      expect(storedShapeLayer().style.stroke.gradient).toBeDefined();
    });

    const gradient = storedShapeLayer().style.stroke.gradient!;
    expect(gradient.stops.length).toBeGreaterThanOrEqual(2);
  });
});
