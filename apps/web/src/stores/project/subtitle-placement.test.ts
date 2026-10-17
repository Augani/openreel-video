import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVisibleTrackRenderOrder } from "@openreel/core";
import { useProjectStore } from "../project-store";
import { createEmptyProject } from "./project-helpers";

beforeEach(() => useProjectStore.getState().loadProject(createEmptyProject("Caption placement")));
afterEach(() => useProjectStore.getState().loadProject(createEmptyProject("Reset")));
describe("generated caption placement", () => {
  it("creates captions in front of existing video so export paints them last", async () => {
    await useProjectStore.getState().addTrack("video");
    const sourceId = useProjectStore.getState().project.timeline.tracks[0].id;
    await useProjectStore.getState().addSubtitle({ id: "cue", text: "Visible caption", startTime: 0, endTime: 2 });
    const state = useProjectStore.getState();
    const caption = state.project.timeline.tracks.find((track) => track.role === "captions")!;
    expect(state.project.timeline.tracks[0].id).toBe(caption.id);
    expect(getVisibleTrackRenderOrder(state.project.timeline.tracks).map(({ track }) => track.id)).toEqual([sourceId, caption.id]);
    expect(state.getAllTextClips()[0].transform.position).toEqual({ x: .5, y: .85 });
  });
  it("honors top and center subtitle placement and does not edit locked caption tracks", async () => {
    await useProjectStore.getState().addTrack("video", 0, { mode: "standard", role: "captions", name: "Captions" });
    const lockedId = useProjectStore.getState().project.timeline.tracks[0].id;
    await useProjectStore.getState().lockTrack(lockedId, true);
    await useProjectStore.getState().addSubtitle({ id: "top", text: "Top", startTime: 0, endTime: 1, style: { fontFamily: "Inter", fontSize: 24, color: "white", backgroundColor: "black", position: "top" } });
    await useProjectStore.getState().addSubtitle({ id: "center", text: "Center", startTime: 1, endTime: 2, style: { fontFamily: "Inter", fontSize: 24, color: "white", backgroundColor: "black", position: "center" } });
    const clips = useProjectStore.getState().getAllTextClips();
    expect(clips.map((clip) => clip.transform.position.y)).toEqual([.15, .5]);
    expect(clips.every((clip) => clip.trackId !== lockedId)).toBe(true);
  });
});
