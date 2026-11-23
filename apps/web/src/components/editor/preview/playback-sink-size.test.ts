import { describe, expect, it } from "vitest";
import { MIN_LAYER_DECODE_ZOOM, canDecodeBelowMonitorSize, playbackSinkSize } from "./playback-sink-size";

describe("playbackSinkSize", () => {
  it("leaves sources that already fit the preview alone", () => {
    expect(playbackSinkSize(1920, 1080, 1920)).toBeNull();
    expect(playbackSinkSize(1280, 720, 1920)).toBeNull();
  });

  it("caps 4K landscape and portrait at the preview long edge, one dimension only", () => {
    expect(playbackSinkSize(3840, 2160, 1920)).toEqual({ width: 1920 });
    expect(playbackSinkSize(2160, 3840, 1920)).toEqual({ height: 1920 });
  });

  it("keeps detail for clips scaled up, within a 4x ceiling", () => {
    expect(playbackSinkSize(3840, 2160, 1920, 1.5)).toEqual({ width: 2880 });
    expect(playbackSinkSize(7680, 4320, 1920, 10)).toBeNull(); // 4x ceiling = 7680, the whole source
    expect(playbackSinkSize(7680, 4320, 1920, 3)).toEqual({ width: 5760 });
    expect(playbackSinkSize(3840, 2160, 1920, 2)).toBeNull();
  });

  it("ignores nonsense input and sub-1 zoom", () => {
    expect(playbackSinkSize(0, 100, 1920)).toBeNull();
    expect(playbackSinkSize(3840, 2160, 0)).toBeNull();
    expect(playbackSinkSize(3840, 2160, 1920, 0.2)).toEqual({ width: 1920 });
    expect(playbackSinkSize(3840, 2160, 1920, Number.NaN)).toEqual({ width: 1920 });
  });

  it("decodes a small static layer below the monitor size, never under the floor", () => {
    expect(playbackSinkSize(3840, 2160, 1920, 0.35, MIN_LAYER_DECODE_ZOOM)).toEqual({ width: 960 });
    expect(playbackSinkSize(3840, 2160, 1920, 0.7, MIN_LAYER_DECODE_ZOOM)).toEqual({ width: 1344 });
    expect(playbackSinkSize(3840, 2160, 1920, 0.05, MIN_LAYER_DECODE_ZOOM)).toEqual({ width: 960 });
    // A source that already fits the reduced size is left alone, and the default floor of 1 is unchanged.
    expect(playbackSinkSize(800, 450, 1920, 0.35, MIN_LAYER_DECODE_ZOOM)).toBeNull();
    expect(playbackSinkSize(3840, 2160, 1920, 0.35)).toEqual({ width: 1920 });
  });

  it("only lets layers whose look is independent of the decoded pixel count decode small", () => {
    expect(canDecodeBelowMonitorSize({ keyframes: [], effects: [] })).toBe(true);
    expect(canDecodeBelowMonitorSize({})).toBe(true);
    expect(canDecodeBelowMonitorSize({ keyframes: [{}] })).toBe(false);
    expect(canDecodeBelowMonitorSize({ effects: [{ type: "gaussian-blur" }] })).toBe(false);
    expect(canDecodeBelowMonitorSize({ transform: { crop: { x: 0 } } })).toBe(false);
  });
});

describe("playbackSinkSize / canDecodeBelowMonitorSize (independent parameters)", () => {
  it("portrait sources floor on height, never exceed the source, and clamp the floor to 0.25..1", () => {
    // 2160x3840 portrait on a 1280 monitor, shown at 20 %: floor 0.5 -> 640 px tall decode.
    expect(playbackSinkSize(2160, 3840, 1280, 0.2, 0.5)).toEqual({ height: 640 });
    // A floor below 0.25 is raised to 0.25; above 1 it is lowered to 1.
    expect(playbackSinkSize(2160, 3840, 1280, 0.01, 0.01)).toEqual({ height: 320 });
    expect(playbackSinkSize(2160, 3840, 1280, 0.2, 7)).toEqual({ height: 1280 });
    // A source already smaller than the capped size is left alone.
    expect(playbackSinkSize(640, 360, 1280, 0.2, 0.5)).toBeNull();
    // Scales above the floor still win, and zoom above 1 is unchanged by the floor.
    expect(playbackSinkSize(3840, 2160, 1280, 0.75, 0.5)).toEqual({ width: 960 });
    expect(playbackSinkSize(3840, 2160, 1280, 2, 0.5)).toEqual({ width: 2560 });
    // Non-finite inputs fall back to the default behaviour.
    expect(playbackSinkSize(3840, 2160, 1280, Number.NaN, Number.NaN)).toEqual({ width: 1280 });
  });

  it("only plain, unanimated, uncropped, effect-free layers may decode small", () => {
    expect(canDecodeBelowMonitorSize({ keyframes: [], effects: [], transform: {} })).toBe(true);
    expect(canDecodeBelowMonitorSize({})).toBe(true);
    expect(canDecodeBelowMonitorSize({ keyframes: [{}] })).toBe(false);
    expect(canDecodeBelowMonitorSize({ effects: [{}] })).toBe(false);
    expect(canDecodeBelowMonitorSize({ transform: { crop: { x: 0, y: 0, width: 1, height: 1 } } })).toBe(false);
  });
});
