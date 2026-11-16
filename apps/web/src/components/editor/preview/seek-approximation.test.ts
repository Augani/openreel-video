import { describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { isPlainVideoClip } from "./seek-approximation";

const plain = (over: Partial<Clip> = {}): Clip => ({
  id: "c",
  mediaId: "m",
  trackId: "t",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...over,
});

describe("isPlainVideoClip", () => {
  it("accepts an untouched clip", () => {
    expect(isPlainVideoClip(plain())).toBe(true);
  });

  it("rejects anything that changes the picture", () => {
    expect(isPlainVideoClip(plain(), true)).toBe(false);
    expect(isPlainVideoClip(plain({ effects: [{ id: "e", type: "blur", params: {}, enabled: true }] }))).toBe(false);
    expect(isPlainVideoClip(plain({ keyframes: [{ id: "k" } as never] }))).toBe(false);
    expect(isPlainVideoClip(plain({ reversed: true }))).toBe(false);
    expect(isPlainVideoClip(plain({ blendMode: "multiply" }))).toBe(false);
    expect(isPlainVideoClip(plain({ stabilization: { enabled: true, strength: 1, cropMode: "auto" } }))).toBe(false);
    expect(
      isPlainVideoClip(plain({ transform: { ...plain().transform, scale: { x: 1.2, y: 1.2 } } })),
    ).toBe(false);
    expect(
      isPlainVideoClip(plain({ transform: { ...plain().transform, fitMode: "cover" } })),
    ).toBe(false);
  });
});
