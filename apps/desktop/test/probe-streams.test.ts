import { describe, it, expect } from "vitest";
import { parseAudioStreams } from "../src/main/sidecar/probe-streams";

const SAMPLE = `
Input #0, mov,mp4,m4a, from 'in.mp4':
  Duration: 00:00:42.00, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 30 fps
  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
  Stream #0:2(jpn): Audio: ac3, 48000 Hz, 5.1, 384 kb/s
  Stream #0:3: Audio: mp3, 44100 Hz, mono, 96 kb/s
`;

describe("parseAudioStreams", () => {
  it("extracts only audio streams with index/codec/channels/sampleRate/language", () => {
    const streams = parseAudioStreams(SAMPLE);
    expect(streams).toEqual([
      { index: 1, codec: "aac", channels: 2, sampleRate: 48000, language: "eng" },
      { index: 2, codec: "ac3", channels: 6, sampleRate: 48000, language: "jpn" },
      { index: 3, codec: "mp3", channels: 1, sampleRate: 44100 },
    ]);
  });

  it("maps explicit 'N channels' layout", () => {
    const s = parseAudioStreams("  Stream #0:1: Audio: pcm_s16le, 48000 Hz, 8 channels, s16\n");
    expect(s[0]).toMatchObject({ index: 1, codec: "pcm_s16le", channels: 8, sampleRate: 48000 });
  });

  it("returns [] when there are no audio streams", () => {
    expect(parseAudioStreams("  Stream #0:0: Video: h264, yuv420p, 1920x1080\n")).toEqual([]);
  });
});
