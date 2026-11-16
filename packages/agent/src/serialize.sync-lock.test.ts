import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core/types/project";
import { listTracks } from "./serialize";
import { makeProjectWithClip } from "./test-fixtures";

describe("list_tracks exposes Sync Lock", () => {
  it("reports true when the field is absent and false when switched off", () => {
    const project = makeProjectWithClip();
    const [first] = project.timeline.tracks;
    const withOff: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [first, { ...first, id: "off", syncLock: false }],
      },
    };
    expect(listTracks(withOff).map((track) => track.syncLock)).toEqual([true, false]);
  });
});
