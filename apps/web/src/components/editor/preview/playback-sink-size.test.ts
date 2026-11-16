import { describe, expect, it } from "vitest";
import { playbackSinkSize } from "./playback-sink-size";

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
});
