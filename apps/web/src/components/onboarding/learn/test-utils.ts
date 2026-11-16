import type { Project } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

/** Test helpers: a minimal project holding exactly the slice the lesson predicates read. */
export interface FixtureClip {
  id: string;
  media: string;
  inPoint?: number;
  outPoint?: number;
  volume?: number;
}

const DEFAULT_MEDIA: Record<string, "video" | "audio" | "image"> = { v: "video", m: "audio" };

export function fixtureProject(clips: FixtureClip[], opts: { texts?: number } = {}): Project {
  const isAudio = (c: FixtureClip) => DEFAULT_MEDIA[c.media] === "audio";
  const toClip = (c: FixtureClip) => ({
    id: c.id,
    mediaId: c.media,
    inPoint: c.inPoint ?? 0,
    outPoint: c.outPoint ?? 6,
    volume: c.volume ?? 1,
  });
  return {
    id: "fixture",
    mediaLibrary: { items: Object.entries(DEFAULT_MEDIA).map(([id, type]) => ({ id, type })) },
    timeline: {
      tracks: [
        { id: "t1", type: "video", clips: clips.filter((c) => !isAudio(c)).map(toClip) },
        { id: "t2", type: "audio", clips: clips.filter(isAudio).map(toClip) },
      ],
    },
    textClips: Array.from({ length: opts.texts ?? 0 }, (_, i) => ({ id: `x${i}` })),
  } as unknown as Project;
}

/** Replaces the live project (a new object, like every real edit). */
export function setFixtureProject(clips: FixtureClip[], opts: { texts?: number } = {}): void {
  useProjectStore.setState({ project: fixtureProject(clips, opts) });
}
