import { describe, expect, it } from "vitest";
import { cloneProjectSnapshot } from "./project-snapshot";

describe("cloneProjectSnapshot", () => {
  it("is unaffected by later in-place edits of the source", () => {
    const blob = new Blob(["abc"]);
    const wave = new Float32Array([1, 2, 3]);
    const source = {
      timeline: { tracks: [{ id: "t", clips: [{ id: "c", volume: 1, startTime: 0 }] }] },
      mediaLibrary: { items: [{ id: "m", blob, waveformData: wave }] },
    };
    const snapshot = cloneProjectSnapshot(source);
    source.timeline.tracks[0].clips[0].volume = 0.2;
    source.timeline.tracks[0].clips.pop();
    source.timeline.tracks.push({ id: "t2", clips: [] });
    expect(snapshot.timeline.tracks).toHaveLength(1);
    expect(snapshot.timeline.tracks[0].clips).toEqual([{ id: "c", volume: 1, startTime: 0 }]);
  });

  it("shares blobs and typed arrays by reference instead of copying media", () => {
    const blob = new Blob(["abc"]);
    const wave = new Float32Array([1, 2, 3]);
    const snapshot = cloneProjectSnapshot({ items: [{ blob, wave }] });
    expect(snapshot.items[0].blob).toBe(blob);
    expect(snapshot.items[0].wave).toBe(wave);
  });

  it("keeps shared structure shared and survives cycles", () => {
    const shared = { n: 1 };
    const source: Record<string, unknown> = { a: shared, b: shared };
    source.self = source;
    const snapshot = cloneProjectSnapshot(source) as { a: unknown; b: unknown; self: unknown };
    expect(snapshot.a).toBe(snapshot.b);
    expect(snapshot.a).not.toBe(shared);
    expect(snapshot.self).toBe(snapshot);
  });
});
