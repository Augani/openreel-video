import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, Keyframe } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { commitAutoReframe } from "./auto-reframe-subject";

const clip = {
  id: "c1",
  mediaId: "m1",
  trackId: "main",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
    rotation: 0,
  },
} as unknown as Clip;

const keyframes: Keyframe[] = [
  { id: "k1", time: 0, property: "position.x", value: 10, easing: "linear" },
  { id: "k2", time: 2, property: "position.x", value: 40, easing: "linear" },
] as unknown as Keyframe[];

beforeEach(() => {
  useProjectStore.getState().createNewProject("Reframe");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 5,
        tracks: [
          {
            id: "main",
            name: "Main",
            type: "video",
            clips: [structuredClone(clip)],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    },
  });
});

describe("commitAutoReframe", () => {
  it("resizes the project and applies keyframes as ONE undo step", async () => {
    await commitAutoReframe({ clipId: "c1", width: 1080, height: 1920, keyframes });
    const state = useProjectStore.getState();
    expect(state.project.settings.width).toBe(1080);
    expect(state.getClip("c1")!.keyframes.length).toBe(2);

    await useProjectStore.getState().undo();
    const undone = useProjectStore.getState();
    expect(undone.project.settings.width).toBe(1920);
    expect(undone.project.settings.height).toBe(1080);
    expect(undone.getClip("c1")!.keyframes.length).toBe(0);

    await useProjectStore.getState().redo();
    const redone = useProjectStore.getState();
    expect(redone.project.settings.width).toBe(1080);
    expect(redone.getClip("c1")!.keyframes.length).toBe(2);
  });
});
