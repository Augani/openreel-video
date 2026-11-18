import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio-engine";
import type { MediaItem } from "../types";

type Internals = {
  getAudioBuffer(item: MediaItem, context: BaseAudioContext, index?: number): Promise<AudioBuffer | null>;
  extractAudioFromVideo: (...args: unknown[]) => Promise<AudioBuffer | null>;
  shouldUseSegmentedAudioDecoding(item: MediaItem, preferSegments: boolean): boolean;
  decodeSurround: boolean;
};

const media = (seconds: number, bytes = 1000): MediaItem =>
  ({
    id: "m",
    type: "video",
    blob: new Blob([new Uint8Array(Math.min(bytes, 64))]),
    metadata: { duration: seconds, sampleRate: 48000, channels: 2 },
  }) as unknown as MediaItem;

const buffer = { length: 10, numberOfChannels: 2, sampleRate: 48000, duration: 1 } as AudioBuffer;

afterEach(() => {
  vi.useRealTimers();
});

describe("audio decode failures", () => {
  it("retries a failed decode after the cool-down instead of silencing the source", async () => {
    vi.useFakeTimers();
    const engine = new AudioEngine() as unknown as Internals;
    engine.extractAudioFromVideo = vi.fn(async () => null);
    const decodeAudioData = vi.fn()
      .mockRejectedValueOnce(new Error("EncodingError"))
      .mockResolvedValue(buffer);
    const context = { decodeAudioData } as unknown as BaseAudioContext;
    const item = media(5);
    // The blob has arrayBuffer in node; stub it so decodeAudioData is reached.
    (item.blob as Blob).arrayBuffer = async () => new ArrayBuffer(8);

    expect(await engine.getAudioBuffer(item, context)).toBeNull();
    // Inside the cool-down the source is left alone (no decode storm)...
    expect(await engine.getAudioBuffer(item, context)).toBeNull();
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    // ...then it is tried again, and the buffer is served.
    vi.advanceTimersByTime(6000);
    expect(await engine.getAudioBuffer(item, context)).toBe(buffer);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it("remembers a source without an audio stream for good", async () => {
    const engine = new AudioEngine() as unknown as Internals;
    const error = Object.assign(new Error("none"), { name: "NoAudioStreamError" });
    engine.extractAudioFromVideo = vi.fn(async () => {
      throw error;
    });
    const context = { decodeAudioData: vi.fn() } as unknown as BaseAudioContext;
    const item = media(5);
    expect(await engine.getAudioBuffer(item, context)).toBeNull();
    expect(await engine.getAudioBuffer(item, context)).toBeNull();
    expect(engine.extractAudioFromVideo).toHaveBeenCalledTimes(1);
  });
});

describe("streamed audio decoding threshold", () => {
  const engine = () => new AudioEngine() as unknown as Internals;

  it("streams sources above a small decoded size, not only long ones", () => {
    expect(engine().shouldUseSegmentedAudioDecoding(media(10), false)).toBe(false);
    expect(engine().shouldUseSegmentedAudioDecoding(media(30), false)).toBe(true);
    expect(engine().shouldUseSegmentedAudioDecoding(media(600), false)).toBe(true);
  });

  it("streams a short clip of a big file instead of copying the whole container into ffmpeg", () => {
    const big = media(10);
    Object.defineProperty(big.blob, "size", { value: 700 * 1024 * 1024 });
    expect(engine().shouldUseSegmentedAudioDecoding(big, false)).toBe(true);
  });

  it("keeps the long-source rule for 5.1 sequences", () => {
    const e = engine();
    e.decodeSurround = true;
    expect(e.shouldUseSegmentedAudioDecoding(media(60), false)).toBe(false);
    expect(e.shouldUseSegmentedAudioDecoding(media(130), false)).toBe(true);
  });
});
