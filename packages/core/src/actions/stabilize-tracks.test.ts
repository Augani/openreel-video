import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../types/timeline";
import { reuseUnchangedTracks } from "./stabilize-tracks";

const clip = (id: string, startTime = 0): Clip => ({ id, startTime, effects: [], keyframes: [] } as unknown as Clip);
const track = (id: string, clips: Clip[]): Track => ({ id, clips, transitions: [], name: id } as unknown as Track);

describe("reuseUnchangedTracks", () => {
  it("returns the previous objects for tracks and clips a handler rebuilt unchanged", () => {
    const prev = [track("a", [clip("a1"), clip("a2")]), track("b", [clip("b1")])];
    const next = prev.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) }));
    const result = reuseUnchangedTracks(prev, next);
    expect(result).toBe(prev);
  });

  it("keeps untouched tracks and clips, and only replaces what changed", () => {
    const prev = [track("a", [clip("a1"), clip("a2")]), track("b", [clip("b1")])];
    const changed = { ...prev[0].clips[1], startTime: 5 } as Clip;
    const next = prev.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === "a2" ? changed : { ...c })) }));
    const result = reuseUnchangedTracks(prev, next);
    expect(result).not.toBe(prev);
    expect(result[1]).toBe(prev[1]);
    expect(result[0]).not.toBe(prev[0]);
    expect(result[0].clips[0]).toBe(prev[0].clips[0]);
    expect(result[0].clips[1]).toBe(changed);
    expect(result[0].clips[1].startTime).toBe(5);
  });

  it("does not reuse across a reorder, add or remove", () => {
    const prev = [track("a", []), track("b", [])];
    expect(reuseUnchangedTracks(prev, [prev[1], prev[0]])).toEqual([prev[1], prev[0]]);
    expect(reuseUnchangedTracks(prev, [prev[0]]).length).toBe(1);
    const added = reuseUnchangedTracks(prev, [...prev, track("c", [])]);
    expect(added.length).toBe(3);
    expect(added[0]).toBe(prev[0]);
  });

  it("treats a track whose transitions changed as changed", () => {
    const prev = [track("a", [clip("a1")])];
    const next = [{ ...prev[0], transitions: [{ id: "t" }] } as unknown as Track];
    expect(reuseUnchangedTracks(prev, next)[0]).toBe(next[0]);
  });
});
