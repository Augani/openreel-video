import { describe, expect, it, vi } from "vitest";

vi.mock("mediabunny", () => {
  class Input {
    async getPrimaryVideoTrack() {
      return { displayWidth: 640, displayHeight: 360, canDecode: async () => true };
    }
  }
  class CanvasSink {}
  return { Input, ALL_FORMATS: [], BlobSource: class {}, CanvasSink };
});

import { MediaBunnyEngine } from "./mediabunny-engine";

/**
 * A queued export retried from its snapshot runs on a fresh page where nothing imported media, so the
 * MediaBunny engine was never initialized. createExportDecoder used to throw there (the export swallowed
 * it), every frame fell back to getFrameAtTime and restarted a decoder at the previous keyframe: a
 * 60 s long-GOP export ran at 0.04x realtime instead of 1x+.
 */
describe("MediaBunnyEngine.createExportDecoder on a fresh engine", () => {
  it("initializes the engine itself and returns a reusable sequential decoder", async () => {
    const engine = new MediaBunnyEngine();
    expect(engine.isAvailable()).toBe(false);

    const blob = new Blob(["video"]);
    const decoder = await engine.createExportDecoder("media-1", blob, 640);

    expect(decoder).not.toBeNull();
    expect(engine.isAvailable()).toBe(true);
    expect(engine.getExportDecoder("media-1")).toBe(decoder);
    // A second request reuses the decoder (and its decode cursors) instead of building another.
    expect(await engine.createExportDecoder("media-1", blob, 640)).toBe(decoder);
  });
});
