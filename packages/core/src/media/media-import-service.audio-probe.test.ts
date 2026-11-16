import { describe, expect, it } from "vitest";
import { FFMPEG_AUDIO_PROBE_MAX_BYTES, shouldProbeAudioStreamsWithFfmpeg } from "./media-import-service";

describe("shouldProbeAudioStreamsWithFfmpeg", () => {
  it("never reads a large file into ffmpeg.wasm when the container index already gave a count", () => {
    expect(shouldProbeAudioStreamsWithFfmpeg(1, 683 * 1024 * 1024)).toBe(false);
    expect(shouldProbeAudioStreamsWithFfmpeg(0, FFMPEG_AUDIO_PROBE_MAX_BYTES + 1)).toBe(false);
  });

  it("keeps the second opinion for small files, where it is cheap", () => {
    expect(shouldProbeAudioStreamsWithFfmpeg(1, 5 * 1024 * 1024)).toBe(true);
    expect(shouldProbeAudioStreamsWithFfmpeg(1, FFMPEG_AUDIO_PROBE_MAX_BYTES)).toBe(true);
  });

  it("probes when mediabunny could not count the tracks, whatever the size", () => {
    expect(shouldProbeAudioStreamsWithFfmpeg(undefined, 900 * 1024 * 1024)).toBe(true);
  });

  it("skips files that already report several tracks", () => {
    expect(shouldProbeAudioStreamsWithFfmpeg(3, 1024)).toBe(false);
  });
});
