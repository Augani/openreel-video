import { describe, expect, it } from "vitest";
import type { Track } from "../types/timeline";
import { getTrackTransitionAudioFades } from "./transition-audio-fades";

const track = (transitions: Track["transitions"]): Track => ({
  id: "track",
  type: "video",
  name: "Video",
  clips: [],
  transitions,
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});

describe("transition audio fades", () => {
  it("splits an enabled clip-to-clip audio fade across both sides", () => {
    const subject = track([{ id: "t", clipAId: "a", clipBId: "b", type: "crossfade", duration: 2, params: { audioFade: true } }]);
    expect(getTrackTransitionAudioFades(subject, "a")).toEqual({ fadeIn: 0, fadeOut: 1 });
    expect(getTrackTransitionAudioFades(subject, "b")).toEqual({ fadeIn: 1, fadeOut: 0 });
  });

  it("does not alter audio unless explicitly enabled", () => {
    const subject = track([{ id: "t", clipAId: "a", clipBId: "b", type: "wipe", duration: 2, params: {} }]);
    expect(getTrackTransitionAudioFades(subject, "a")).toEqual({ fadeIn: 0, fadeOut: 0 });
  });

  it("uses the full duration for clip-edge fades", () => {
    const subject = track([{ id: "t", clipAId: "a", edge: "in", type: "blur", duration: 0.8, params: { audioFade: true } }]);
    expect(getTrackTransitionAudioFades(subject, "a")).toEqual({ fadeIn: 0.8, fadeOut: 0 });
  });
});
