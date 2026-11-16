import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Clip, Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { SpeedRampSection } from "./SpeedRampSection";

const clipId = "clip-speed";

const buildProject = (): Project => {
  const project = createEmptyProject("Pitch toggle");
  const clip: Clip = {
    id: clipId,
    mediaId: "media-1",
    trackId: "track-1",
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
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
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 4,
      tracks: [
        {
          id: "track-1",
          type: "video",
          name: "V1",
          clips: [clip],
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

const pitchOf = (): boolean | undefined =>
  useProjectStore
    .getState()
    .project.timeline.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === clipId)?.pitchCorrection;

describe("SpeedRampSection Maintain Pitch toggle", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
    useProjectStore.setState({ project: { ...buildProject(), id: useProjectStore.getState().project.id } });
  });
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("writes clip.pitchCorrection on its own and is undoable", async () => {
    expect(pitchOf()).toBeUndefined();
    render(<SpeedRampSection clip={{ id: clipId, startTime: 0, duration: 4 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Pitch Correct" }));
    await vi.waitFor(() => expect(useProjectStore.getState().canUndo()).toBe(true));
    expect(pitchOf()).toBe(false);

    await useProjectStore.getState().undo();
    expect(pitchOf()).toBeUndefined();
  });
});
