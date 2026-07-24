import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { MotionComposition } from "@openreel/core";

import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MotionSyncPanel } from "./MotionSyncPanel";

const composition: MotionComposition = {
  id: "audio-inspector-composition",
  name: "Audio Inspector",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  audioClips: [
    {
      id: "audio-1",
      name: "Voiceover",
      mediaId: "media-1",
      startTime: 1,
      duration: 4,
      trimStart: 0.25,
      gain: 0.8,
      fadeIn: 0.1,
      fadeOut: 0.2,
    },
  ],
  createdAt: 1,
  modifiedAt: 1,
};

function storedComposition(): MotionComposition {
  const stored = useProjectStore
    .getState()
    .getMotionComposition(composition.id);
  if (!stored) throw new Error("audio inspector composition missing");
  return stored;
}

describe("MotionSyncPanel audio inspector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Audio inspector test"),
        motionCompositions: [composition],
      },
    });
    useMotionStore.setState({
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedKeyframeIds: [],
      selectedLightId: null,
      selectedAudioClipId: null,
      selectedProperty: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("links clip selection to the inspector and exposes detailed audio controls", async () => {
    render(<MotionSyncPanel composition={composition} embedded />);

    const clipButton = screen.getByRole("button", {
      name: "Select audio clip Voiceover",
    });
    fireEvent.click(clipButton);

    expect(useMotionStore.getState().selectedAudioClipId).toBe("audio-1");
    expect(clipButton).toHaveAttribute("aria-pressed", "true");
    for (const label of [
      "Gain",
      "Duration",
      "Source trim",
      "Fade in",
      "Fade out",
    ]) {
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Start", { exact: true }).length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Mute clip" }));
    await waitFor(() => {
      expect(storedComposition().audioClips?.[0]?.muted).toBe(true);
    });
  });

  it("clears shared selection when the selected clip is removed", async () => {
    useMotionStore.getState().selectAudioClip("audio-1");
    render(<MotionSyncPanel composition={composition} embedded />);

    fireEvent.click(screen.getByRole("button", { name: "Remove audio clip" }));

    await waitFor(() => {
      expect(storedComposition().audioClips).toHaveLength(0);
    });
    expect(useMotionStore.getState().selectedAudioClipId).toBeNull();
  });
});
