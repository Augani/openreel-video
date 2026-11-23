import { describe, expect, it } from "vitest";
import {
  MIX_CHANNELS, SILENT_CHANNEL, applyChannelMapToChannels, channelMapNeedsWideSource, channelMatrix, describeChannelMap, fileChannelFormat,
  identityChannelMap, isIdentityChannelMap, mapAudioBuffer, matchChannelPreset, presetChannelMap, resolveClipChannelMap, sanitizeChannelMap,
  type ClipChannelMap,
} from "./channel-map";

const mono = (...sources: number[]): ClipChannelMap => ({ format: "mono", sources });
const stereo = (...sources: number[]): ClipChannelMap => ({ format: "stereo", sources });

describe("channel map matrix", () => {
  it("identity maps are recognised per file layout", () => {
    expect(identityChannelMap(1)).toEqual(mono(0));
    expect(identityChannelMap(2)).toEqual(stereo(0, 1));
    expect(identityChannelMap(6).sources).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fileChannelFormat(4)).toBe("stereo");
    expect(isIdentityChannelMap(undefined, 2)).toBe(true);
    expect(isIdentityChannelMap(stereo(0, 1), 2)).toBe(true);
    expect(isIdentityChannelMap(stereo(1, 0), 2)).toBe(false);
  });

  it("builds the matrix for left only, right only, swap and mix", () => {
    expect(channelMatrix(mono(0), 2)).toEqual([[1, 0]]);
    expect(channelMatrix(mono(1), 2)).toEqual([[0, 1]]);
    expect(channelMatrix(stereo(1, 0), 2)).toEqual([[0, 1], [1, 0]]);
    expect(channelMatrix(mono(MIX_CHANNELS), 2)).toEqual([[0.5, 0.5]]);
    expect(channelMatrix(stereo(0, SILENT_CHANNEL), 2)).toEqual([[1, 0], [0, 0]]);
  });

  it("treats a source channel the file does not have as silent", () => {
    expect(channelMatrix(stereo(0, 3), 2)).toEqual([[1, 0], [0, 0]]);
    expect(channelMatrix({ format: "5.1", sources: [0, 1, 2, 3, 4, 5] }, 2)[5]).toEqual([0, 0]);
  });

  it("presets: use file is no mapping, mono is the first channel, stereo follows the file", () => {
    expect(presetChannelMap("file", 2)).toBeUndefined();
    expect(presetChannelMap("mono", 2)).toEqual(mono(0));
    expect(presetChannelMap("mono", 1)).toEqual(mono(0));
    expect(presetChannelMap("stereo", 2)).toEqual(stereo(0, 1));
    expect(presetChannelMap("stereo", 1)).toEqual(stereo(0, 0));
    expect(matchChannelPreset(stereo(0, 0), 1)).toBe("stereo");
    expect(matchChannelPreset(mono(0), 2)).toBe("mono");
    expect(matchChannelPreset(stereo(1, 0), 2)).toBeNull();
    expect(matchChannelPreset(undefined, 2)).toBe("file");
  });

  it("sanitises untrusted maps", () => {
    expect(sanitizeChannelMap(null)).toBeUndefined();
    expect(sanitizeChannelMap({ format: "quad", sources: [] })).toBeUndefined();
    expect(sanitizeChannelMap({ format: "stereo", sources: [1] })).toEqual(stereo(1, SILENT_CHANNEL));
    expect(sanitizeChannelMap({ format: "mono", sources: [-2.5] })).toEqual(mono(SILENT_CHANNEL));
    expect(sanitizeChannelMap({ format: "mono", sources: [MIX_CHANNELS] })).toEqual(mono(MIX_CHANNELS));
  });

  it("clip map wins over the media import preset", () => {
    const media = { channelPreset: "mono" as const, metadata: { channels: 2 } };
    expect(resolveClipChannelMap({}, media)).toEqual(mono(0));
    expect(resolveClipChannelMap({ channelMap: stereo(1, 0) }, media)).toEqual(stereo(1, 0));
    expect(resolveClipChannelMap({}, { metadata: { channels: 2 } })).toBeUndefined();
  });

  it("describes maps", () => {
    expect(describeChannelMap(undefined, 2)).toBe("Stereo (file)");
    expect(describeChannelMap(mono(0), 2)).toBe("Mono (Left)");
    expect(describeChannelMap(stereo(1, 0), 2)).toBe("Stereo (Right / Left)");
  });
});

describe("channel map on sample data", () => {
  const left = Float32Array.from([1, 1, 1, 1]);
  const right = Float32Array.from([0.5, 0.5, 0.5, 0.5]);

  it("routes, swaps, mixes and mutes", () => {
    expect(applyChannelMapToChannels([left, right], mono(0))).toEqual([left]);
    expect(applyChannelMapToChannels([left, right], mono(1))).toEqual([right]);
    expect(applyChannelMapToChannels([left, right], stereo(1, 0))).toEqual([right, left]);
    expect(Array.from(applyChannelMapToChannels([left, right], mono(MIX_CHANNELS))[0])).toEqual([0.75, 0.75, 0.75, 0.75]);
    expect(Array.from(applyChannelMapToChannels([left, right], stereo(0, SILENT_CHANNEL))[1])).toEqual([0, 0, 0, 0]);
  });

  it("maps AudioBuffers once and returns the source when nothing changes", () => {
    const makeBuffer = (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, (_, c) => (c === 0 ? left : right).slice());
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
    };
    const ctx = { createBuffer: makeBuffer };
    const source = makeBuffer(2, 4, 48000);
    expect(mapAudioBuffer(ctx, source, undefined)).toBe(source);
    expect(mapAudioBuffer(ctx, source, stereo(0, 1))).toBe(source);
    const swapped = mapAudioBuffer(ctx, source, stereo(1, 0));
    expect(swapped).not.toBe(source);
    expect(swapped.numberOfChannels).toBe(2);
    expect(Array.from(swapped.getChannelData(0))).toEqual(Array.from(right));
    expect(mapAudioBuffer(ctx, source, stereo(1, 0))).toBe(swapped);
    expect(mapAudioBuffer(ctx, source, mono(0)).numberOfChannels).toBe(1);
  });
});

describe("wide source decoding", () => {
  it("is needed only when a map reads beyond L/R or outputs 5.1", () => {
    expect(channelMapNeedsWideSource(undefined)).toBe(false);
    expect(channelMapNeedsWideSource(stereo(0, 1))).toBe(false);
    expect(channelMapNeedsWideSource(mono(MIX_CHANNELS))).toBe(false);
    expect(channelMapNeedsWideSource(mono(2))).toBe(true);
    expect(channelMapNeedsWideSource(stereo(4, 5))).toBe(true);
    expect(channelMapNeedsWideSource({ format: "5.1", sources: [0, 1, 2, 3, 4, 5] })).toBe(true);
    // Any map over a source wider than stereo needs its own channels: the stereo fold-down mixes them all into L / R.
    expect(channelMapNeedsWideSource(mono(0), 8)).toBe(true);
    expect(channelMapNeedsWideSource(mono(0), 2)).toBe(false);
    expect(channelMapNeedsWideSource(undefined, 8)).toBe(false);
  });
});
