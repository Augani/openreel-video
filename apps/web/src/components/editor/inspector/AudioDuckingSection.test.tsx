import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { AudioDuckingSection } from "./AudioDuckingSection";

const targetClipId = "clip-music";
const triggerTrackId = "track-dialogue";

const createProjectWithPersistedDucking = (): Project => {
  const project = createEmptyProject("Audio Ducking Persistence");

  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [
        {
          id: "track-music",
          type: "audio",
          name: "Music Bed",
          clips: [
            {
              id: targetClipId,
              mediaId: "media-music",
              trackId: "track-music",
              startTime: 0,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
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
              automation: {
                volume: [
                  { time: 0, value: 1 },
                  { time: 0.25, value: 0.3 },
                  { time: 1.2, value: 1 },
                ],
              },
              keyframes: [],
              metadata: {
                audioDucking: {
                  enabled: true,
                  sourceTrackId: triggerTrackId,
                  threshold: -28,
                  reduction: 0.7,
                  attack: 0.08,
                  release: 0.4,
                  holdTime: 0.2,
                },
              },
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
        {
          id: triggerTrackId,
          type: "video",
          name: "Dialogue Track",
          clips: [
            {
              id: "clip-dialogue",
              mediaId: "media-dialogue",
              trackId: triggerTrackId,
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

describe("AudioDuckingSection", () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: createProjectWithPersistedDucking(),
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("rehydrates persisted ducking and shows video tracks as valid trigger sources", () => {
    render(<AudioDuckingSection clipId={targetClipId} />);

    expect(screen.getByText("Ducking Applied")).toBeInTheDocument();
    expect(screen.getByText("Ducking Enabled")).toBeInTheDocument();
    expect(screen.getByText("Dialogue Track")).toBeInTheDocument();
    expect(screen.getByText("Trigger Source (Voice Track)")).toBeInTheDocument();
  });
});