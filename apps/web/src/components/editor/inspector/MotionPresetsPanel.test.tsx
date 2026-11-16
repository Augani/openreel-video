import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ActionExecutor, type Clip, type Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { MotionPresetsPanel } from "./MotionPresetsPanel";
import { useEngineStore } from "../../../stores/engine-store";
import { useTimelineStore } from "../../../stores/timeline-store";

const CLIP_ID = "motion-preset-clip";
const originalGraphicsEngine = useEngineStore.getState().getGraphicsEngine();

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
    const executor = new ActionExecutor();
    useProjectStore.setState({
      hasOpenProject: true,
      actionExecutor: executor,
      actionHistory: executor.getHistory(),
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
    useUIStore.setState({
      effectApplicationClipId: null,
      exportState: { ...useUIStore.getState().exportState, isExporting: false },
    });
    useTimelineStore.setState({ playbackLockedReason: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useEngineStore.setState({ graphicsEngine: originalGraphicsEngine });
    useProjectStore.setState({ hasOpenProject: false });
    useUIStore.getState().clearSelection();
  });

  it("saves graphics preset keyframes and history without a rendering engine", () => {
    const state = useProjectStore.getState();
    const engine = useEngineStore.getState().getGraphicsEngine();
    const shape = engine?.createShape(
      {
        id: CLIP_ID,
        shapeType: "rectangle",
        width: 240,
        height: 160,
        style: {
          fill: { type: "solid", color: "#14b8a6", opacity: 1 },
          stroke: { color: "#ffffff", width: 0, opacity: 1 },
        },
      },
      "video-track-1",
      0,
      5,
    );
    if (!shape) throw new Error("Missing graphics engine");
    useProjectStore.setState({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map((track) => ({
            ...track,
            clips: [],
          })),
        },
        shapeClips: [shape],
      },
    });
    useEngineStore.setState({ graphicsEngine: null });
    render(<MotionPresetsPanel clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Fade In" }));
    expect(
      useProjectStore.getState().project.shapeClips?.[0].keyframes?.length,
    ).toBeGreaterThan(0);
    expect(useProjectStore.getState().actionHistory.canUndo()).toBe(true);
  });

  it("does not let a delayed duration reapply the previous preset over a newer choice", () => {
    vi.useFakeTimers();
    render(<MotionPresetsPanel clipId={CLIP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Fade In" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Motion preset duration value" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Motion preset duration value",
    });
    fireEvent.change(input, { target: { value: "1.2s" } });
    fireEvent.blur(input);
    fireEvent.click(
      screen.getByRole("button", { name: "Apply Slide In Left" }),
    );
    act(() => vi.advanceTimersByTime(200));
    const keys =
      useProjectStore.getState().project.timeline.tracks[0].clips[0].keyframes;
    expect(keys.some((key) => key.property === "position.x")).toBe(true);
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
      expect(
        Math.max(...entranceKeyframes.map((keyframe) => keyframe.time)),
      ).toBe(1.2);
    });
  });

  it("disables preset changes while the owning track is locked", () => {
    const state = useProjectStore.getState();
    useProjectStore.setState({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map((track) => ({
            ...track,
            locked: true,
          })),
        },
      },
    });
    render(<MotionPresetsPanel clipId={CLIP_ID} />);
    expect(
      screen.getByRole("button", { name: "Apply Fade In" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("slider", { name: "Motion preset duration" }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Apply Fade In" }));
    expect(state.actionHistory.canUndo()).toBe(false);
  });
});
