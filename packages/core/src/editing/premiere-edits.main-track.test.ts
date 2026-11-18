import { describe, expect, it } from "vitest";
import type { Project, Track } from "../types";
import { findMainTrack } from "./premiere-edits";

const track = (id: string, type: Track["type"], name: string, locked = false) =>
  ({ id, type, name, clips: [], transitions: [], locked, hidden: false, muted: false, solo: false }) as unknown as Track;
const project = (tracks: Track[]) =>
  ({ timeline: { tracks, duration: 0, subtitles: [], markers: [] } }) as unknown as Project;

describe("findMainTrack", () => {
  it("prefers the base video layer over the top overlay lane", () => {
    const p = project([track("a", "video", "Overlay"), track("b", "video", "Layer 2")]);
    expect(findMainTrack(p, "video")?.id).toBe("b");
  });

  it("chooses a track named Main or V1 wherever it sits", () => {
    expect(findMainTrack(project([track("a", "video", "Main"), track("b", "video", "B-roll")]), "video")?.id).toBe("a");
    expect(findMainTrack(project([track("a", "video", "B-roll"), track("b", "video", "V1"), track("c", "video", "V2")]), "video")?.id).toBe("b");
  });

  it("never substitutes an overlay lane for a locked Main track", () => {
    const p = project([track("a", "video", "B-roll"), track("b", "video", "Main", true)]);
    expect(findMainTrack(p, "video")).toBeNull();
  });

  it("skips locked unnamed tracks and falls back to the next base layer", () => {
    const p = project([track("a", "video", "Top"), track("b", "video", "Base", true), track("c", "video", "Mid")]);
    expect(findMainTrack(p, "video")?.id).toBe("c");
  });

  it("uses the first unlocked audio track and returns null when none fits", () => {
    const p = project([track("v", "video", "Main"), track("a1", "audio", "Audio 1"), track("a2", "audio", "Audio 2")]);
    expect(findMainTrack(p, "audio")?.id).toBe("a1");
    expect(findMainTrack(p, "image")).toBeNull();
    expect(findMainTrack(project([track("a", "audio", "A1", true)]), "audio")).toBeNull();
  });
});
