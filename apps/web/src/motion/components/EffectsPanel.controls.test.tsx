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
  type MotionEffect,
  type MotionTextLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { EffectsPanel } from "./EffectsPanel";

const LAYER_ID = "layer-text";
const COMP_ID = "comp-controls";

function textLayer(): MotionTextLayer {
  return {
    id: LAYER_ID,
    type: "text",
    name: "Headline",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "Hello",
    style: {
      fontFamily: "Inter",
      fontSize: 64,
      color: "#ffffff",
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

function storedEffects(): readonly MotionEffect[] {
  return storedComposition().layers[0].effects ?? [];
}

describe("EffectsPanel expression controls", () => {
  beforeEach(() => {
    const project = {
      ...createEmptyProject("Expression controls test"),
      motionCompositions: [composition()],
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      playhead: 0,
      autoKeyframe: false,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("adds a slider-control effect to the selected layer", async () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Slider Control" }));

    await waitFor(() => {
      const effects = storedEffects();
      expect(effects).toHaveLength(1);
      expect(effects[0]?.type).toBe("slider-control");
      expect(effects[0]?.name).toBe("Slider Control");
    });
  });

  it("auto-suffixes duplicate control names", async () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Slider Control" }));
    await waitFor(() => expect(storedEffects()).toHaveLength(1));

    cleanup();
    render(<EffectsPanel composition={storedComposition()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Slider Control" }));

    await waitFor(() => {
      const effects = storedEffects();
      expect(effects).toHaveLength(2);
      expect(effects[1]?.name).toBe("Slider Control 2");
    });
  });

  it("duplicates a tuned effect from its stack card", async () => {
    render(<EffectsPanel composition={composition()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Slider Control" }));
    await waitFor(() => expect(storedEffects()).toHaveLength(1));

    cleanup();
    render(<EffectsPanel composition={storedComposition()} />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate effect" }));

    await waitFor(() => {
      const effects = storedEffects();
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "slider-control",
        name: "Slider Control 2",
      });
      expect(effects[1]?.id).not.toBe(effects[0]?.id);
    });
  });

  it("persists slider value edits and shows the usage hint", async () => {
    render(<EffectsPanel composition={composition()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Slider Control" }));
    await waitFor(() => expect(storedEffects()).toHaveLength(1));

    cleanup();
    render(<EffectsPanel composition={storedComposition()} />);

    expect(
      screen.getByText('effect("Slider Control")("value")'),
    ).toBeInTheDocument();

    const slider = storedEffects()[0];
    const field = screen
      .getAllByText("Slider")
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (node): node is HTMLElement =>
          node !== null && within(node).queryByRole("spinbutton") !== null,
      );
    expect(field).toBeDefined();

    const input = within(field!).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "42" } });

    await waitFor(() => {
      const effect = storedEffects()[0];
      expect(effect?.type).toBe("slider-control");
      if (effect?.type === "slider-control") {
        expect(effect.value).toBe(42);
      }
    });
    expect(slider.id).toBe(storedEffects()[0]?.id);
  });

  it("renders a checkbox control as a switch writing 0/1", async () => {
    render(<EffectsPanel composition={composition()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add Checkbox Control" }),
    );
    await waitFor(() => expect(storedEffects()).toHaveLength(1));

    cleanup();
    render(<EffectsPanel composition={storedComposition()} />);

    const toggle = screen.getByRole("switch", { name: "Checkbox" });
    fireEvent.click(toggle);

    await waitFor(() => {
      const effect = storedEffects()[0];
      expect(effect?.type).toBe("checkbox-control");
      if (effect?.type === "checkbox-control") {
        expect(effect.value).toBe(1);
      }
    });
  });

  it("keeps control presets out of the generic Add Effect grid", () => {
    render(<EffectsPanel composition={composition()} />);

    const addButtons = screen.getAllByRole("button", { name: /^Add / });
    const genericSliderAdds = addButtons.filter(
      (button) => button.getAttribute("aria-label") === "Add Slider Control",
    );
    expect(genericSliderAdds).toHaveLength(1);
  });
});
