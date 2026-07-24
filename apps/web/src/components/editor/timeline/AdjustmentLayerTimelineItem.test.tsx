import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdjustmentLayer, Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { AdjustmentLayerTimelineItem } from "./AdjustmentLayerTimelineItem";

const layer: AdjustmentLayer = {
  id: "adjustment-1",
  trackId: "track-1",
  name: "Hero grade",
  startTime: 1,
  duration: 3,
  effects: [],
  opacity: 1,
  blendMode: "normal",
  enabled: true,
  affectedTracks: "all",
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
};

describe("AdjustmentLayerTimelineItem", () => {
  beforeEach(() => {
    const project: Project = { ...createEmptyProject("Adjustment timeline"), adjustmentLayers: [layer] };
    useProjectStore.setState({
      hasOpenProject: true,
      project,
      beginHistoryGroup: vi.fn(),
      endHistoryGroup: vi.fn(),
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
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("shows the timed FX ribbon and moves it on frame boundaries", async () => {
    const onSelectOwner = vi.fn();
    render(
      <AdjustmentLayerTimelineItem
        layer={layer}
        pixelsPerSecond={60}
        frameRate={30}
        onSelectOwner={onSelectOwner}
      />,
    );
    const ribbon = screen.getByTestId("adjustment-layer-timeline-item");
    expect(ribbon).toHaveStyle({ left: "60px", width: "180px" });

    fireEvent.mouseDown(ribbon, { button: 0, clientX: 80 });
    fireEvent.mouseMove(window, { clientX: 140 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(useProjectStore.getState().project.adjustmentLayers?.[0]?.startTime).toBe(2);
    });
    expect(onSelectOwner).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().beginHistoryGroup).toHaveBeenCalledWith("Move adjustment layer");
    expect(useProjectStore.getState().endHistoryGroup).toHaveBeenCalledTimes(1);
  });
});
