import { describe, expect, it } from "vitest";
import { clonePlain } from "./clone-plain";

describe("clonePlain", () => {
  it("deep copies plain trees without sharing any object", () => {
    const source = { a: 1, b: [{ c: "x" }, [1, 2]], d: { e: null, f: undefined, g: { h: true } } };
    const copy = clonePlain(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.b).not.toBe(source.b);
    expect(copy.b[0]).not.toBe(source.b[0]);
    expect(copy.d.g).not.toBe(source.d.g);
    expect("f" in copy.d).toBe(true);
    copy.b[0] = { c: "changed" };
    expect(source.b[0]).toEqual({ c: "x" });
  });

  it("hands non-plain values to structuredClone", () => {
    const waveform = new Float32Array([0.1, 0.5]);
    const when = new Date(1_700_000_000_000);
    const source = { waveform, when, list: [new Map([["k", 1]])] };
    const copy = clonePlain(source);
    expect(copy.waveform).not.toBe(waveform);
    expect(Array.from(copy.waveform)).toEqual([expect.closeTo(0.1), expect.closeTo(0.5)]);
    expect(copy.when).toEqual(when);
    expect(copy.when).not.toBe(when);
    expect(copy.list[0].get("k")).toBe(1);
  });

  it("returns primitives unchanged", () => {
    expect(clonePlain(3)).toBe(3);
    expect(clonePlain("s")).toBe("s");
    expect(clonePlain(null)).toBeNull();
    expect(clonePlain(undefined)).toBeUndefined();
  });
});
