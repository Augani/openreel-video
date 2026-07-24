import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionCompositionLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { PropertiesPanel } from "./PropertiesPanel";

function sourceComposition(): MotionComposition {
  return {
    id: "source-comp",
    name: "Reusable title",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 2,
    backgroundColor: "#000000",
    layers: [],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function hostComposition(): MotionComposition {
  const layer: MotionCompositionLayer = {
    id: "precomp-layer",
    type: "composition",
    name: "Title instance",
    compositionId: "source-comp",
    width: 1280,
    height: 720,
    startTime: 0,
    duration: 6,
    timeOffset: 0,
    playbackRate: 1,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
  };
  return {
    ...sourceComposition(),
    id: "host-comp",
    name: "Host",
    duration: 6,
    layers: [layer],
  };
}

describe("PropertiesPanel precomposition playback", () => {
  const upsert = vi.fn();
  const host = hostComposition();

  beforeEach(() => {
    upsert.mockReset();
    const project = {
      ...createEmptyProject("Precomp loop test"),
      motionCompositions: [sourceComposition(), host],
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project,
      upsertMotionComposition: upsert,
    });
    useMotionStore.setState({
      selectedLayerId: "precomp-layer",
      selectedLayerIds: ["precomp-layer"],
      selectedLightId: null,
      rightTab: "properties",
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("enables looping on the selected precomposition instance", () => {
    render(<PropertiesPanel composition={host} />);
    fireEvent.click(screen.getByRole("switch", { name: "Loop source" }));

    expect(upsert).toHaveBeenCalledTimes(1);
    const next = upsert.mock.calls[0]![0] as MotionComposition;
    expect((next.layers[0] as MotionCompositionLayer).loop).toBe(true);
  });
});
