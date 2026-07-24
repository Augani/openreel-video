import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionVideoLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

const COMP_ID = "video-timing-comp";
const LAYER_ID = "video-layer";

function composition(): MotionComposition {
  const layer: MotionVideoLayer = {
    id: LAYER_ID,
    type: "video",
    name: "Footage",
    assetId: "video-asset",
    startTime: 0,
    duration: 8,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    playbackRate: 1,
    trimStart: 1,
  };
  return {
    id: COMP_ID,
    name: "Video timing",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 8,
    backgroundColor: "#000000",
    layers: [layer],
    assets: [{ id: "video-asset", type: "video", name: "Take 01", duration: 10 }],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("PropertiesPanel video source timing", () => {
  beforeEach(() => {
    useProjectStore.setState({
      hasOpenProject: true,
      project: { ...createEmptyProject("Video timing"), motionCompositions: [composition()] },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 2,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("exposes loop, reverse, and freezes the current source frame", async () => {
    render(<PropertiesPanel composition={composition()} />);
    expect(screen.getByRole("switch", { name: "Loop source" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Reverse" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Freeze frame" }));
    await waitFor(() => {
      const stored = useProjectStore.getState().project.motionCompositions?.[0];
      expect((stored?.layers[0] as MotionVideoLayer).freezeFrame).toBe(3);
    });
  });
});
