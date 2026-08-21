import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { ClipVolumeSection } from "./ClipVolumeSection";

const clipId = "c1";

function seed() {
  const project = createEmptyProject("t");
  const seeded = {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        {
          id: "tr",
          type: "audio",
          name: "a",
          clips: [
            {
              id: clipId,
              mediaId: "m",
              trackId: "tr",
              startTime: 2,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
              effects: [],
              audioEffects: [],
              keyframes: [],
              volume: 1,
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
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
  useProjectStore.setState({ project: seeded as never });
  useTimelineStore.setState({ playheadPosition: 4 });
}

describe("ClipVolumeSection", () => {
  beforeEach(seed);
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ project: createEmptyProject("r") as never });
  });

  it("renders a Volume control showing 1", () => {
    render(<ClipVolumeSection clipId={clipId} />);
    expect(screen.getByText("Volume")).toBeInTheDocument();
    expect(screen.getByText("1.0")).toBeInTheDocument();
  });

  it("toggling the stopwatch adds an audio.volume keyframe", () => {
    render(<ClipVolumeSection clipId={clipId} />);
    fireEvent.click(screen.getByRole("button", { name: /keyframe Volume/i }));
    const kfs = useProjectStore.getState().getClip(clipId)!.keyframes;
    expect(kfs).toHaveLength(1);
    expect(kfs[0]).toMatchObject({ property: "audio.volume", time: 2, value: 1 });
  });

  it("setClipVolume changes clip.volume when not keyframed", () => {
    const changed = useProjectStore.getState().setClipVolume(clipId, 0.5);
    expect(changed).toBe(true);
    expect(useProjectStore.getState().getClip(clipId)!.volume).toBe(0.5);
  });
});
