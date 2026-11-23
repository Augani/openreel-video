import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const streaming = vi.fn();
const extract = vi.fn();
vi.mock("@openreel/core/media", () => ({
  decodeAudioBufferStreaming: (...args: unknown[]) => streaming(...args),
  extractAudioWav: (...args: unknown[]) => extract(...args),
}));

import { decodeClipAudioBuffer } from "./decode-clip-audio";

const context = {
  decodeAudioData: vi.fn(async () => ({ numberOfChannels: 8 }) as unknown as AudioBuffer),
} as unknown as AudioContext;
const blob = new Blob([new Uint8Array(4)]);

beforeEach(() => {
  streaming.mockReset();
  extract.mockReset();
});

describe("decodeClipAudioBuffer width", () => {
  it("keeps the stereo fold-down by default", async () => {
    streaming.mockResolvedValue({ status: "unsupported" });
    extract.mockResolvedValue(new Blob([new Uint8Array(4)]));
    await decodeClipAudioBuffer(context, blob, 0, 8);
    expect(streaming).toHaveBeenCalledWith(context, blob, 0, 2);
    expect(extract).toHaveBeenCalledWith(blob, 0);
  });

  it("a clip whose channel map reads the file's own channels decodes every source channel, streamed or through ffmpeg", async () => {
    streaming.mockResolvedValue({ status: "unsupported" });
    extract.mockResolvedValue(new Blob([new Uint8Array(4)]));
    await decodeClipAudioBuffer(context, blob, 1, 8, true);
    expect(streaming).toHaveBeenCalledWith(context, blob, 1, 8);
    expect(extract).toHaveBeenCalledWith(blob, 1, { channels: 8 });
  });
});
