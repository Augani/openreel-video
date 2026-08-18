import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Clip, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { MotionPresetsPanel } from "./MotionPresetsPanel";

const CLIP_ID = "motion-preset-clip";

function makeClip(): Clip {
  return {
    id: CLIP_ID,
    mediaId: "image-1",
    trackId: "video-track-1",
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

describe("MotionPresetsPanel duration", () => {
  beforeEach(() => {
    const project = createEmptyProject("Motion preset duration");
    const track: Track = {
      id: "video-track-1",
      type: "video",
      name: "Video 1",
      clips: [makeClip()],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [track],
          duration: 5,
        },
      },
    });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
    useUIStore.getState().clearSelection();
  });

  it("reapplies the selected preset with the customized duration", async () => {
    render(<MotionPresetsPanel clipId={CLIP_ID} />);

    expect(
      screen.getByRole("slider", { name: "Motion preset duration" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply Fade In" }));

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

    await waitFor(() => {
      const clip = useProjectStore
        .getState()
        .project.timeline.tracks[0]?.clips.find(
          (candidate) => candidate.id === CLIP_ID,
        );
      const entranceKeyframes = (clip?.keyframes ?? []).filter((keyframe) =>
        keyframe.id.startsWith("motion-in-"),
      );
      expect(entranceKeyframes.length).toBeGreaterThan(0);
      expect(Math.max(...entranceKeyframes.map((keyframe) => keyframe.time))).toBe(
        1.2,
      );
    });
  });
});
