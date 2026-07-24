import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { motionEngine } from "./motion-engine";

function createProject(): Project {
  return {
    id: "project-1",
    name: "Motion Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [],
      subtitles: [],
      duration: 0,
      markers: [],
    },
    motionCompositions: [],
    motionInstances: [],
  };
}

describe("motionEngine", () => {
  it("inserts a motion instance without mutating the original project", () => {
    const project = createProject();
    const composition = motionEngine.createStarterComposition({
      name: "Lower Third",
      duration: 4,
    });
    const withComposition = motionEngine.upsertComposition(project, composition);
    const instance = motionEngine.createInstance(composition, {
      startTime: 2,
    });

    const nextProject = motionEngine.insertInstance(withComposition, instance);

    expect(withComposition.timeline.tracks).toHaveLength(0);
    expect(withComposition.motionInstances).toHaveLength(0);
    expect(nextProject.motionInstances).toHaveLength(1);
    expect(nextProject.timeline.tracks).toHaveLength(1);
    expect(nextProject.timeline.tracks[0].name).toBe("Motion");
    expect(nextProject.timeline.tracks[0].clips[0].mediaId).toBe(
      `motion-${instance.id}`,
    );
    expect(nextProject.timeline.tracks[0].clips[0].metadata).toMatchObject({
      motionClip: true,
      motionCompositionId: composition.id,
      motionInstanceId: instance.id,
    });
    expect(nextProject.timeline.duration).toBe(6);
  });
});
