import { describe, it, expect } from "vitest";
import { frameIndexForTimestamp, totalGridFrames, CfrWriter } from "../src/main/sidecar/cfr";

describe("CFR mapping", () => {
  it("maps timestamps to a 30fps grid", () => {
    expect(frameIndexForTimestamp(0, 30)).toBe(0);
    expect(frameIndexForTimestamp(0.0166, 30)).toBe(0);
    expect(frameIndexForTimestamp(0.0334, 30)).toBe(1);
    expect(frameIndexForTimestamp(1.0, 30)).toBe(30);
  });

  it("computes total grid frames from duration", () => {
    expect(totalGridFrames(2.0, 30)).toBe(60);
    expect(totalGridFrames(2.0167, 30)).toBe(61);
  });
});

describe("CfrWriter dup/drop", () => {
  it("writes one frame per grid cell for a normal sequence", async () => {
    const calls: number[] = [];
    const tag = (n: number) => new Uint8Array([n]);
    const w = new CfrWriter(30, async (f: Uint8Array) => {
      calls.push(f[0]);
    });
    await w.push(tag(1), 0);
    await w.push(tag(2), 1 / 30);
    await w.push(tag(3), 2 / 30);
    expect(calls).toEqual([1, 2, 3]);
  });

  // Semantics: hold-previous (sample-and-hold). A gap is filled with the
  // PREVIOUSLY written frame, then the new frame is written at its target grid
  // index. Writing [1] at index 0 and pushing [2] at ts 3/30 fills indices 1,2
  // with the held [1] and writes [2] at 3, yielding [1,1,1,2]. Frames mapping
  // to an already-written cell are dropped.
  it("holds the previous frame across a gap and drops same-cell frames", async () => {
    const calls: number[] = [];
    const tag = (n: number) => new Uint8Array([n]);
    const w = new CfrWriter(30, async (f: Uint8Array) => {
      calls.push(f[0]);
    });
    await w.push(tag(1), 0);
    await w.push(tag(1), 0.01);
    await w.push(tag(2), 3 / 30);
    expect(calls).toEqual([1, 1, 1, 2]);
    expect(calls.length).toBe(4);
  });

  it("drops a frame that rounds backwards to an already-written cell", async () => {
    const calls: number[] = [];
    const tag = (n: number) => new Uint8Array([n]);
    const w = new CfrWriter(30, async (f: Uint8Array) => {
      calls.push(f[0]);
    });
    await w.push(tag(1), 0);
    await w.push(tag(2), 1 / 30);
    await w.push(tag(3), 1 / 30 - 0.001);
    expect(calls).toEqual([1, 2]);
    expect(calls.length).toBe(2);
  });

  // Regression: the renderer streams frames concurrently (credit window). With a
  // slow/async writer, pushes fired without awaiting each other must NOT race the
  // stateful fill logic. Before single-flighting, concurrent pushes read a stale
  // lastWrittenIndex and re-ran the fill loop, exploding the write count and
  // repeating early frames (the 21x-duration / looping-frames export bug).
  it("serializes concurrent pushes so each grid cell is written exactly once", async () => {
    const calls: number[] = [];
    const tag = (n: number) => new Uint8Array([n]);
    const w = new CfrWriter(30, async (f: Uint8Array) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      calls.push(f[0]);
    });
    await Promise.all([
      w.push(tag(0), 0),
      w.push(tag(1), 1 / 30),
      w.push(tag(2), 2 / 30),
      w.push(tag(3), 3 / 30),
      w.push(tag(4), 4 / 30),
    ]);
    expect(calls).toEqual([0, 1, 2, 3, 4]);
  });
});
