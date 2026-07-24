import { describe, expect, it } from "vitest";
import {
  buildWavHeader,
  encodeAudioBufferToPcm16,
  initialNativeFrameCredits,
  NativeFFmpegBackend,
} from "./native-ffmpeg-backend";

function fakeAudioBuffer(
  channels: number[][],
  sampleRate = 48000,
): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (index: number) =>
      new Float32Array(channels[Math.min(index, channels.length - 1)] ?? []),
  } as AudioBuffer;
}

function ascii(buffer: ArrayBuffer, start: number, end: number): string {
  return String.fromCharCode(...new Uint8Array(buffer.slice(start, end)));
}

describe("native ffmpeg backend helpers", () => {
  it("keeps sequential frame decoder caches warm", () => {
    expect(new NativeFFmpegBackend(() => "/tmp/export.mp4").needsFrameThrottling).toBe(false);
  });

  it("caps in-flight raw frame credits by memory size", () => {
    expect(initialNativeFrameCredits(1920, 1080)).toBe(10);
    expect(initialNativeFrameCredits(3840, 2160)).toBe(4);
    expect(initialNativeFrameCredits(7680, 4320)).toBe(1);
  });

  it("builds a valid PCM WAV header for the final data length", () => {
    const header = buildWavHeader(48000, 2, 48000);
    const view = new DataView(header);

    expect(header.byteLength).toBe(44);
    expect(ascii(header, 0, 4)).toBe("RIFF");
    expect(ascii(header, 8, 12)).toBe("WAVE");
    expect(ascii(header, 36, 40)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(48000 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(36 + 48000 * 2 * 2);
  });

  it("encodes audio chunks directly to interleaved PCM16", () => {
    const buffer = fakeAudioBuffer([
      [-1, 0, 1],
      [0.5, -0.5, 0],
    ]);
    const pcm = encodeAudioBufferToPcm16(buffer, 2);
    const view = new DataView(pcm);

    expect(pcm.byteLength).toBe(12);
    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(16384);
    expect(view.getInt16(4, true)).toBe(0);
    expect(view.getInt16(6, true)).toBe(-16384);
    expect(view.getInt16(8, true)).toBe(32767);
    expect(view.getInt16(10, true)).toBe(0);
  });

  it("duplicates mono audio into requested output channels", () => {
    const buffer = fakeAudioBuffer([[0.25, -0.25]]);
    const pcm = encodeAudioBufferToPcm16(buffer, 2);
    const view = new DataView(pcm);

    expect(view.getInt16(0, true)).toBe(8192);
    expect(view.getInt16(2, true)).toBe(8192);
    expect(view.getInt16(4, true)).toBe(-8192);
    expect(view.getInt16(6, true)).toBe(-8192);
  });
});
