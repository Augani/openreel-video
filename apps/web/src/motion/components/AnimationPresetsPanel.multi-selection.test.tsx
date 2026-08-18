import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionTextLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { AnimationPresetsPanel } from "./AnimationPresetsPanel";

const COMPOSITION_ID = "animation-multi";
const LAYER_IDS = ["headline", "subhead"] as const;

function textLayer(id: string, startTime: number): MotionTextLayer {
  return {
    id,
    type: "text",
    name: id,
    startTime,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: id,
    style: {
      fontFamily: "Inter",
      fontSize: 64,
      color: "#ffffff",
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMPOSITION_ID,
    name: "Animation batch",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 6,
    backgroundColor: "#101820",
    layers: [textLayer(LAYER_IDS[0], 0), textLayer(LAYER_IDS[1], 1)],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("AnimationPresetsPanel multi-selection", () => {
  beforeEach(() => {
    const comp = composition();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Animation preset test"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_IDS[0],
      selectedLayerIds: [...LAYER_IDS],
      playhead: 1.5,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("applies a preset at each selected layer's local playhead time", async () => {
    const comp = composition();
    render(<AnimationPresetsPanel composition={comp} />);

    expect(screen.getByText("2 selected layers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply Fade In" }));

    await waitFor(() => {
      const stored = useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === COMPOSITION_ID,
        );
      expect(stored?.layers.map((layer) => layer.keyframes.length)).toEqual([
        2, 2,
      ]);
      expect(stored?.layers[0]?.keyframes[0]?.time).toBe(1.5);
      expect(stored?.layers[1]?.keyframes[0]?.time).toBe(0.5);
    });
  });

  it("shows a visual preview before each compatible preset is applied", () => {
    render(<AnimationPresetsPanel composition={composition()} />);

    const previews = screen.getAllByTestId(
      "motion-animation-preset-preview",
    );
    expect(previews.length).toBeGreaterThan(8);
    expect(
      previews.some((preview) => preview.dataset.presetId === "fade-in"),
    ).toBe(true);
    expect(
      previews.some((preview) => preview.dataset.presetId === "flip-in-3d"),
    ).toBe(true);
  });

  it("uses the duration slider when generating preset keyframes", async () => {
    render(<AnimationPresetsPanel composition={composition()} />);

    expect(
      screen.getByRole("slider", { name: "Motion preset duration" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit Motion preset duration value",
      }),
    );
    const durationInput = screen.getByRole("textbox", {
      name: "Motion preset duration value",
    });
    fireEvent.change(durationInput, { target: { value: "1.2s" } });
    fireEvent.blur(durationInput);
    fireEvent.click(screen.getByRole("button", { name: "Apply Fade In" }));

    await waitFor(() => {
      const stored = useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === COMPOSITION_ID,
        );
      expect(stored?.layers[0]?.keyframes.at(-1)?.time).toBe(2.7);
      expect(stored?.layers[1]?.keyframes.at(-1)?.time).toBe(1.7);
    });
  });
});
