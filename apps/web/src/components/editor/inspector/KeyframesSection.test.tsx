import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { KeyframesSection } from "./KeyframesSection";

const clipId = "c1";

function seedWithKeyframes() {
  const p = createEmptyProject("t");
  const seeded = {
    ...p,
    timeline: {
      ...p.timeline,
      duration: 10,
      tracks: [
        {
          id: "tr",
          type: "video",
          name: "v",
          clips: [
            {
              id: clipId,
              mediaId: "m",
              trackId: "tr",
              startTime: 0,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
              effects: [],
              audioEffects: [],
              volume: 1,
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              keyframes: [
                { id: "k1", property: "transform.opacity", time: 0, value: 1, easing: "linear" },
                { id: "k2", property: "transform.opacity", time: 2, value: 0, easing: "linear" },
              ],
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
  useTimelineStore.setState({ playheadPosition: 0 });
}

describe("KeyframesSection shows existing namespaced keyframes", () => {
  beforeEach(seedWithKeyframes);
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ project: createEmptyProject("r") as never });
  });

  it("auto-shows existing keyframes for a namespaced property so they can be edited/removed", () => {
    render(<KeyframesSection clipId={clipId} />);
    expect(screen.getByText(/Keyframes \(2\)/)).toBeInTheDocument();
    expect(screen.getAllByTitle("Delete keyframe")).toHaveLength(2);
  });
});
