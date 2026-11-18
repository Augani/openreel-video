import { describe, expect, it } from "vitest";
import type { Project, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import type { SelectionItem } from "../../../stores/ui-store";
import { getPrimarySelectedTrackId } from "./primary-track";

const track = (id: string): Track => ({
  id,
  name: id,
  type: "video",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});
const project = (): Project => {
  const empty = createEmptyProject("Track selection");
  return {
    ...empty,
    timeline: { ...empty.timeline, tracks: [track("main"), track("overlay")] },
  };
};

describe("primary selected timeline track", () => {
  it.each([
    "textClips",
    "shapeClips",
    "svgClips",
    "stickerClips",
    "adjustmentLayers",
    "motionInstances",
  ] as const)(
    "resolves %s from current project ownership instead of stale selection metadata",
    (family) => {
      const state = {
        ...project(),
        [family]: [{ id: "placed-item", trackId: "overlay" }],
      } as Project;
      const selection: SelectionItem[] = [
        { id: "placed-item", type: "shape-clip", trackId: "main" },
      ];
      expect(getPrimarySelectedTrackId(state, selection)).toBe("overlay");
      expect(selection[0].trackId).toBe("main");
      expect(
        getPrimarySelectedTrackId({ ...state, [family]: [] }, selection),
      ).toBeNull();
    },
  );

  it("resolves explicit tracks and transitions, and ignores stale or library selections", () => {
    const state = project();
    state.timeline.tracks[1].transitions.push({
      id: "dissolve",
      clipAId: "clip",
      type: "crossfade",
      duration: 0.5,
      params: {},
    });
    expect(
      getPrimarySelectedTrackId(state, [{ id: "overlay", type: "track" }]),
    ).toBe("overlay");
    expect(
      getPrimarySelectedTrackId(state, [
        { id: "dissolve", type: "transition", trackId: "main" },
      ]),
    ).toBe("overlay");
    expect(
      getPrimarySelectedTrackId(state, [
        { id: "unplaced-media", type: "clip", trackId: "main" },
      ]),
    ).toBeNull();
    expect(
      getPrimarySelectedTrackId(state, [
        { id: "deleted-track", type: "track" },
      ]),
    ).toBeNull();
    expect(
      getPrimarySelectedTrackId(state, [
        { id: "marker", type: "marker", trackId: "main" },
      ]),
    ).toBeNull();
    expect(getPrimarySelectedTrackId(state, [])).toBeNull();
  });
});
