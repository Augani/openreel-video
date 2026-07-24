import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdjustmentLayerEngine, type AdjustmentLayer, type Project } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { AdjustmentLayerSection } from "./AdjustmentLayerSection";

function projectWithClip(): Project {
  const project = createEmptyProject("Adjustment workflow");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [{
        id: "video-track",
        type: "video",
        name: "Video",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: [{
          id: "clip-1",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 1,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          transform: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
          },
          effects: [],
          audioEffects: [],
          volume: 1,
          keyframes: [],
        }],
      }],
    },
  };
}

describe("AdjustmentLayerSection workflow", () => {
  const engine = new AdjustmentLayerEngine();
  const originalGetEngine = useEngineStore.getState().getAdjustmentLayerEngine;

  beforeEach(() => {
    engine.clearAll();
    const project = projectWithClip();
    useEngineStore.setState({ getAdjustmentLayerEngine: async () => engine });
    useProjectStore.setState({
      hasOpenProject: true,
      project,
      executeAction: vi.fn(async (action) => {
        if (action.type === "adjustment/setAll") {
          useProjectStore.setState((state) => ({
            project: {
              ...state.project,
              adjustmentLayers: action.params.layers as AdjustmentLayer[],
              modifiedAt: Date.now(),
            },
          }));
        }
        return { success: true };
      }),
    });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.setState({ getAdjustmentLayerEngine: originalGetEngine });
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("persists creation and exposes visible, editable effect defaults", async () => {
    render(<AdjustmentLayerSection clipId="clip-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Adjustment Layer" }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.adjustmentLayers).toHaveLength(1);
    });
    expect(engine.getAllLayers()[0]).toMatchObject({ startTime: 1, duration: 4 });
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Brightness" }));
    await waitFor(() => {
      expect(engine.getAllLayers()[0]?.effects[0]).toMatchObject({
        type: "brightness",
        params: { value: 12 },
      });
    });
    expect(screen.getByRole("button", { name: "Edit Brightness value" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Grayscale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Sepia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Invert" })).toBeInTheDocument();
    expect(screen.getByTestId("adjustment-effect-preview-grayscale")).toBeInTheDocument();
    expect(screen.getByTestId("adjustment-effect-preview-sepia")).toBeInTheDocument();
    expect(screen.getByTestId("adjustment-effect-preview-invert")).toBeInTheDocument();
  });
});
