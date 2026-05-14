import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import {
  createNoiseReductionEffect,
  DEFAULT_NOISE_REDUCTION,
} from "../../../bridges/audio-bridge-effects";
import * as audioBridgeEffects from "../../../bridges/audio-bridge-effects";
import { NoiseReductionSection } from "./NoiseReductionSection";

const clipId = "clip-noise";
const trackId = "track-audio";

const createProjectWithNoiseReduction = (): Project => {
  const project = createEmptyProject("Noise Reduction Persistence");
  const noiseReductionEffect = createNoiseReductionEffect({
    ...DEFAULT_NOISE_REDUCTION,
    threshold: -36,
    reduction: 0.64,
    attack: 9,
    release: 130,
    focus: "speech",
    profile: {
      frequencyBins: [80, 250, 1000, 4000],
      magnitudes: [0.35, 0.28, 0.12, 0.08],
      sampleRate: 48000,
    },
  });

  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 6,
      tracks: [
        {
          id: trackId,
          type: "video",
          name: "Primary",
          clips: [
            {
              id: clipId,
              mediaId: "media-1",
              trackId,
              startTime: 0,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [noiseReductionEffect],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
};

describe("NoiseReductionSection persistence", () => {
  beforeEach(() => {
    vi.spyOn(audioBridgeEffects, "initializeAudioBridgeEffects").mockResolvedValue(
      audioBridgeEffects.getAudioBridgeEffects(),
    );
    useProjectStore.setState({
      project: createProjectWithNoiseReduction(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("rehydrates persisted noise removal after the clip is selected again", async () => {
    const firstRender = render(<NoiseReductionSection clipId={clipId} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hear Original" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Hear Cleaned" })).not.toBeDisabled();
      expect(screen.getByText(/Current mode:/)).toHaveTextContent("Speech Focus");
    });

    firstRender.unmount();

    render(<NoiseReductionSection clipId={clipId} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hear Original" })).not.toBeDisabled();
      expect(screen.getByText(/Current mode:/)).toHaveTextContent("Speech Focus");
    });
  });
});