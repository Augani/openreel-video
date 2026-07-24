import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MaskEngine, type Clip, type Project } from "@openreel/core";

import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { MaskSection } from "./MaskSection";

const CLIP_ID = "mask-workflow-clip";

function clip(): Clip {
  return {
    id: CLIP_ID,
    mediaId: "mask-media",
    trackId: "mask-track",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}

function project(): Project {
  const empty = createEmptyProject("Mask workflow");
  return {
    ...empty,
    modifiedAt: 1,
    timeline: {
      ...empty.timeline,
      duration: 5,
      tracks: [
        {
          id: "mask-track",
          type: "video",
          name: "Video",
          clips: [clip()],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}

describe("MaskSection professional workflow", () => {
  let engine: MaskEngine;
  let originalGetMaskEngine: ReturnType<typeof useEngineStore.getState>["getMaskEngine"];

  beforeEach(() => {
    engine = new MaskEngine({ width: 1920, height: 1080 });
    originalGetMaskEngine = useEngineStore.getState().getMaskEngine;
    useEngineStore.setState({ getMaskEngine: async () => engine });
    useProjectStore.setState({
      hasOpenProject: true,
      project: project(),
    });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.setState({ getMaskEngine: originalGetMaskEngine });
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("creates an editable custom path, persists opacity, and duplicates all settings", async () => {
    render(<MaskSection clipId={CLIP_ID} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Add custom path mask" }),
    );

    await waitFor(() => {
      expect(engine.getMasksForClip(CLIP_ID)).toHaveLength(1);
      expect(useProjectStore.getState().project.masks).toHaveLength(1);
      expect(useProjectStore.getState().project.modifiedAt).toBeGreaterThan(1);
    });
    expect(screen.getByText("Path points")).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Point 1 X percent" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Opacity value" }));
    const opacityInput = screen.getByRole("textbox", { name: "Opacity value" });
    fireEvent.change(opacityInput, { target: { value: "42%" } });
    fireEvent.keyDown(opacityInput, { key: "Enter" });

    await waitFor(() => {
      expect(engine.getMasksForClip(CLIP_ID)[0]?.opacity).toBe(0.42);
      expect(useProjectStore.getState().project.masks?.[0]?.opacity).toBe(0.42);
    });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Mask" }));
    await waitFor(() => {
      const masks = engine.getMasksForClip(CLIP_ID);
      expect(masks).toHaveLength(2);
      expect(masks[1]).toMatchObject({ type: "drawn", opacity: 0.42 });
      expect(useProjectStore.getState().project.masks).toHaveLength(2);
    });
  });
});
