import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { buildClipIndex } from "./clip-index";

const clip = (id: string, trackId: string) => ({ id, trackId }) as Clip;
const track = (id: string, clips: Clip[]) => ({ id, clips }) as unknown as Track;

describe("buildClipIndex", () => {
  it("indexes clips and tracks by id", () => {
    const a = clip("a", "t1");
    const b = clip("b", "t2");
    const t1 = track("t1", [a]);
    const t2 = track("t2", [b]);
    const index = buildClipIndex([t1, t2]);
    expect(index.clips.get("a")).toBe(a);
    expect(index.clips.get("b")).toBe(b);
    expect(index.tracks.get("t2")).toBe(t2);
    expect(index.clips.get("missing")).toBeUndefined();
  });
});
