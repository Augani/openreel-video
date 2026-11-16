import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaskEngine } from "./mask-engine";

class OffscreenCanvasMock {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {};
  }
}

describe("MaskEngine state operations", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", OffscreenCanvasMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates and clamps mask opacity", () => {
    const engine = new MaskEngine({ width: 1920, height: 1080 });
    const mask = engine.createDrawnMask("clip-1", {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    engine.setOpacity(mask.id, 0.42);
    expect(engine.getMask(mask.id)?.opacity).toBe(0.42);
    engine.setOpacity(mask.id, 2);
    expect(engine.getMask(mask.id)?.opacity).toBe(1);
    engine.setOpacity(mask.id, -1);
    expect(engine.getMask(mask.id)?.opacity).toBe(0);
  });

  it("duplicates the complete mask without sharing path or keyframe objects", () => {
    const engine = new MaskEngine({ width: 1920, height: 1080 });
    const source = engine.createTrackMatteMask(
      "clip-1",
      "matte-source",
      "luminance",
    );
    engine.setFeathering(source.id, 18);
    engine.setExpansion(source.id, -12);
    engine.setOpacity(source.id, 0.65);
    engine.setInverted(source.id, true);
    engine.addMaskKeyframe(source.id, 1, {
      closed: true,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    });

    const duplicate = engine.duplicateMask(source.id, "clip-2");

    expect(duplicate).toMatchObject({
      clipId: "clip-2",
      type: "track-matte",
      sourceClipId: "matte-source",
      matteSource: "luminance",
      feathering: 18,
      expansion: -12,
      opacity: 0.65,
      inverted: true,
    });
    expect(duplicate?.id).not.toBe(source.id);
    expect(duplicate?.keyframes).toHaveLength(1);
    expect(duplicate?.keyframes[0]?.id).not.toBe(
      engine.getMask(source.id)?.keyframes[0]?.id,
    );
    expect(duplicate?.path).not.toBe(engine.getMask(source.id)?.path);
    expect(duplicate?.keyframes[0]?.path).not.toBe(
      engine.getMask(source.id)?.keyframes[0]?.path,
    );
  });

});
