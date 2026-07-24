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
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const LAYER_ID = "layer-shape";
const COMP_ID = "comp-shader-fill";

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
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
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

describe("PropertiesPanel shader fill", () => {
  beforeEach(() => {
    const project = {
      ...createEmptyProject("Shader fill test"),
      motionCompositions: [composition()],
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 0,
      autoKeyframe: false,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("switches a shape fill to a shader fill via the store", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Shader" }));

    await waitFor(() => {
      expect(storedShapeLayer().style.fill.type).toBe("shader");
    });

    expect(storedShapeLayer().style.fill.shader?.shaderId).toBe("liquid-metal");
    expect(storedShapeLayer().style.fill.shader?.params.scale).toBe(6);
  });

  it("picks Liquid Metal explicitly and writes a param via the store", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Shader" }));
    await waitFor(() => {
      expect(storedShapeLayer().style.fill.type).toBe("shader");
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);

    const picker = screen.getByRole("combobox", { name: "Shader fill" });
    fireEvent.change(picker, { target: { value: "liquid-metal" } });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);
    expect(storedShapeLayer().style.fill.shader?.shaderId).toBe("liquid-metal");

    const scaleField = screen
      .getAllByText("Scale")
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (field): field is HTMLElement =>
          field !== null && within(field).queryByRole("spinbutton") !== null,
      );
    expect(scaleField).toBeDefined();

    const scaleControl = within(scaleField!).getByRole("spinbutton");
    expect(scaleControl).toHaveAttribute("max", "20");
    fireEvent.change(scaleControl, { target: { value: "12" } });

    await waitFor(() => {
      expect(storedShapeLayer().style.fill.shader?.params.scale).toBe(12);
    });
  });

  it("groups the fill picker by collection with a Paper optgroup", async () => {
    render(<PropertiesPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Shader" }));
    await waitFor(() => {
      expect(storedShapeLayer().style.fill.type).toBe("shader");
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);

    const picker = screen.getByRole("combobox", { name: "Shader fill" });
    const groupLabels = Array.from(
      picker.querySelectorAll("optgroup"),
    ).map((group) => group.getAttribute("label"));
    expect(groupLabels).toContain("Built-in");
    expect(groupLabels).toContain("Paper");

    const paperGroup = Array.from(picker.querySelectorAll("optgroup")).find(
      (group) => group.getAttribute("label") === "Paper",
    );
    expect(paperGroup).toBeDefined();
    const paperValues = Array.from(
      paperGroup!.querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));
    expect(paperValues).toContain("paper-mesh-gradient");
  });
});
