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
  getMotionTextShaderAnimator,
  type MotionComposition,
  type MotionTextLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const LAYER_ID = "layer-text";
const COMP_ID = "comp-text-shader";

function textLayer(): MotionTextLayer {
  return {
    id: LAYER_ID,
    type: "text",
    name: "Title",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "HELLO",
    style: {
      fontFamily: "Inter",
      fontSize: 120,
      fontWeight: 700,
      color: "#ffffff",
      align: "center",
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
    layers: [textLayer()],
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

function storedTextLayer(): MotionTextLayer {
  return storedComposition().layers[0] as MotionTextLayer;
}

describe("PropertiesPanel text shader animator", () => {
  beforeEach(() => {
    const project = {
      ...createEmptyProject("Text shader test"),
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

  it("picks a text shader and writes a param via the store", async () => {
    render(<PropertiesPanel composition={composition()} />);

    const picker = screen.getByRole("combobox", { name: "Text shader animator" });
    fireEvent.change(picker, { target: { value: "glyph-dissolve" } });

    await waitFor(() => {
      expect(getMotionTextShaderAnimator(storedTextLayer())?.shader?.shaderId).toBe(
        "glyph-dissolve",
      );
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);

    const scaleField = screen
      .getAllByText("Scale")
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (field): field is HTMLElement =>
          field !== null && within(field).queryByRole("spinbutton") !== null,
      );
    expect(scaleField).toBeDefined();

    const scaleControl = within(scaleField!).getByRole("spinbutton");
    fireEvent.change(scaleControl, { target: { value: "20" } });

    await waitFor(() => {
      expect(
        getMotionTextShaderAnimator(storedTextLayer())?.shader?.params.scale,
      ).toBe(20);
    });
  });

  it("clears the text shader animator", async () => {
    render(<PropertiesPanel composition={composition()} />);

    const picker = screen.getByRole("combobox", { name: "Text shader animator" });
    fireEvent.change(picker, { target: { value: "glyph-dissolve" } });

    await waitFor(() => {
      expect(getMotionTextShaderAnimator(storedTextLayer())).toBeDefined();
    });

    cleanup();
    render(<PropertiesPanel composition={storedComposition()} />);

    const clearPicker = screen.getByRole("combobox", {
      name: "Text shader animator",
    });
    fireEvent.change(clearPicker, { target: { value: "" } });

    await waitFor(() => {
      expect(getMotionTextShaderAnimator(storedTextLayer())).toBeUndefined();
    });
  });
});
