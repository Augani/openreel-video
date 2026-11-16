import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { EMPTY_SNAPSHOT, isLessonComplete, snapshotProject, visualClipCount, type LessonSnapshot } from "./predicates";

interface FixtureClip {
  id: string;
  media: string;
  inPoint?: number;
  outPoint?: number;
  volume?: number;
  trackType?: "video" | "audio";
}

/** The slice of Project that snapshotProject reads. */
function project(clips: FixtureClip[], opts: { texts?: number; media?: Record<string, "video" | "audio" | "image"> } = {}): Project {
  const media = opts.media ?? { v: "video", v2: "video", m: "audio", img: "image" };
  const tracks = [
    {
      id: "t1",
      type: "video",
      clips: clips
        .filter((c) => (c.trackType ?? (media[c.media] === "audio" ? "audio" : "video")) === "video")
        .map((c) => ({ id: c.id, mediaId: c.media, inPoint: c.inPoint ?? 0, outPoint: c.outPoint ?? 6, volume: c.volume ?? 1 })),
    },
    {
      id: "t2",
      type: "audio",
      clips: clips
        .filter((c) => (c.trackType ?? (media[c.media] === "audio" ? "audio" : "video")) === "audio")
        .map((c) => ({ id: c.id, mediaId: c.media, inPoint: c.inPoint ?? 0, outPoint: c.outPoint ?? 20, volume: c.volume ?? 1 })),
    },
  ];
  return {
    mediaLibrary: { items: Object.entries(media).map(([id, type]) => ({ id, type })) },
    timeline: { tracks },
    textClips: Array.from({ length: opts.texts ?? 0 }, (_, i) => ({ id: `x${i}` })),
  } as unknown as Project;
}

const snap = (p: Project, exportActivity = 0): LessonSnapshot => snapshotProject(p, exportActivity);

describe("lesson predicates (project state, not clicks)", () => {
  it("place-clip: done with at least one clip on a video lane, not before", () => {
    expect(isLessonComplete("place-clip", snap(project([])))).toBe(false);
    expect(isLessonComplete("place-clip", snap(project([{ id: "a", media: "v" }])))).toBe(true);
  });

  it("place-clip: an audio-only clip does not count as a video-lane clip", () => {
    expect(isLessonComplete("place-clip", snap(project([{ id: "m1", media: "m" }])))).toBe(false);
  });

  it("split: done when the clip count increased since the lesson started", () => {
    const baseline = snap(project([{ id: "a", media: "v" }]));
    expect(isLessonComplete("split", baseline, baseline)).toBe(false);
    const after = snap(project([{ id: "a", media: "v", outPoint: 3 }, { id: "b", media: "v", inPoint: 3 }]));
    expect(isLessonComplete("split", after, baseline)).toBe(true);
  });

  it("split: adding an audio clip is not a split", () => {
    const baseline = snap(project([{ id: "a", media: "v" }]));
    const after = snap(project([{ id: "a", media: "v" }, { id: "m1", media: "m" }]));
    expect(isLessonComplete("split", after, baseline)).toBe(false);
  });

  it("delete: done when the clip count dropped", () => {
    const baseline = snap(project([{ id: "a", media: "v" }, { id: "b", media: "v" }]));
    expect(isLessonComplete("delete", baseline, baseline)).toBe(false);
    expect(isLessonComplete("delete", snap(project([{ id: "a", media: "v" }])), baseline)).toBe(true);
  });

  it("delete: done when a surviving clip was trimmed (in or out changed)", () => {
    const baseline = snap(project([{ id: "a", media: "v", inPoint: 0, outPoint: 6 }]));
    expect(isLessonComplete("delete", snap(project([{ id: "a", media: "v", inPoint: 1, outPoint: 6 }])), baseline)).toBe(true);
    expect(isLessonComplete("delete", snap(project([{ id: "a", media: "v", inPoint: 0, outPoint: 4 }])), baseline)).toBe(true);
  });

  it("delete: a moved or untouched clip does not complete it", () => {
    const baseline = snap(project([{ id: "a", media: "v" }]));
    expect(isLessonComplete("delete", snap(project([{ id: "a", media: "v" }])), baseline)).toBe(false);
  });

  it("title: done when a text clip exists", () => {
    expect(isLessonComplete("title", snap(project([])))).toBe(false);
    expect(isLessonComplete("title", snap(project([], { texts: 1 })))).toBe(true);
  });

  it("music: needs an audio clip whose volume is not 1.0", () => {
    expect(isLessonComplete("music", snap(project([{ id: "m1", media: "m" }])))).toBe(false);
    expect(isLessonComplete("music", snap(project([{ id: "m1", media: "m", volume: 1 }])))).toBe(false);
    expect(isLessonComplete("music", snap(project([{ id: "m1", media: "m", volume: 0.3 }])))).toBe(true);
    expect(isLessonComplete("music", snap(project([{ id: "m1", media: "m", volume: 1.4 }])))).toBe(true);
  });

  it("music: lowering a video clip's volume is not enough", () => {
    expect(isLessonComplete("music", snap(project([{ id: "a", media: "v", volume: 0.2 }])))).toBe(false);
  });

  it("music: the media kind decides, not the legacy track type", () => {
    const p = project([{ id: "m1", media: "m", volume: 0.4, trackType: "video" }]);
    expect(isLessonComplete("music", snap(p))).toBe(true);
  });

  it("export: done once export activity grows past the baseline", () => {
    const p = project([{ id: "a", media: "v" }]);
    const baseline = snap(p, 2);
    expect(isLessonComplete("export", snap(p, 2), baseline)).toBe(false);
    expect(isLessonComplete("export", snap(p, 3), baseline)).toBe(true);
  });

  it("an empty baseline never completes split, delete or export on an empty project", () => {
    const empty = snap(project([]));
    expect(isLessonComplete("split", empty, EMPTY_SNAPSHOT)).toBe(false);
    expect(isLessonComplete("delete", empty, EMPTY_SNAPSHOT)).toBe(false);
    expect(isLessonComplete("export", empty, EMPTY_SNAPSHOT)).toBe(false);
  });

  it("counts images as visual clips", () => {
    expect(visualClipCount(snap(project([{ id: "i", media: "img" }])))).toBe(1);
  });
});
