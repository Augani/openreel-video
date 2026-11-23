import { describe, expect, it } from "vitest";
import {
  buildSourceGroups,
  clipFieldsForGroup,
  describeSourceGroup,
  flattenedSourceChannels,
  isMultichannelSource,
  matchSourceLayoutPreset,
  resolveSourceChannelGroups,
  sanitizeSourceLayout,
  sourceAudioShape,
} from "./source-channels";

const media = (channels: number, audioTrackCount = 1, extra: object = {}) => ({
  type: "audio",
  metadata: { channels, audioTrackCount, hasAudio: true },
  ...extra,
});

describe("source channel layout", () => {
  it("Use file keeps mono, stereo and 5.1 streams as one clip and splits other widths per channel", () => {
    expect(resolveSourceChannelGroups(media(1)).map((g) => g.map.format)).toEqual(["mono"]);
    expect(resolveSourceChannelGroups(media(2)).map((g) => g.map)).toEqual([{ format: "stereo", sources: [0, 1] }]);
    expect(resolveSourceChannelGroups(media(6)).map((g) => g.map.format)).toEqual(["5.1"]);
    const eight = resolveSourceChannelGroups(media(8));
    expect(eight).toHaveLength(8);
    expect(eight.map((g) => g.map.sources[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(isMultichannelSource(media(8))).toBe(true);
    expect(isMultichannelSource(media(2))).toBe(false);
  });

  it("a MOV with two stereo tracks is two stereo clips, one per stream", () => {
    const groups = resolveSourceChannelGroups({ type: "video", metadata: { channels: 2, audioTrackCount: 2, hasAudio: true } });
    expect(groups.map((g) => [g.stream, g.map.format])).toEqual([[0, "stereo"], [1, "stereo"]]);
  });

  it("presets regroup every channel", () => {
    const shape = sourceAudioShape(media(8));
    expect(buildSourceGroups("mono", shape)).toHaveLength(8);
    expect(buildSourceGroups("stereo", shape).map((g) => g.map.sources)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
    expect(buildSourceGroups("5.1", shape).map((g) => g.map.format)).toEqual(["5.1", "mono", "mono"]);
    expect(buildSourceGroups("stereo", sourceAudioShape(media(3))).map((g) => g.map.format)).toEqual(["stereo", "mono"]);
    expect(buildSourceGroups("stereo", sourceAudioShape(media(1))).map((g) => g.map.sources)).toEqual([[0, 0]]);
  });

  it("a stored layout wins, is fitted to the file and reported as a preset when it matches one", () => {
    const stored = media(8, 1, { channelLayout: buildSourceGroups("stereo", sourceAudioShape(media(8))) });
    expect(resolveSourceChannelGroups(stored)).toHaveLength(4);
    expect(matchSourceLayoutPreset(stored)).toBe("stereo");
    expect(matchSourceLayoutPreset(media(8))).toBe("file");
    const custom = media(4, 1, { channelLayout: [{ stream: 0, map: { format: "stereo", sources: [3, 0] } }] });
    expect(matchSourceLayoutPreset(custom)).toBeNull();
    // Channels and streams the file does not have are dropped / silenced.
    const narrow = media(2, 1, { channelLayout: [{ stream: 0, map: { format: "stereo", sources: [0, 5] } }, { stream: 3, map: { format: "mono", sources: [0] } }] });
    expect(resolveSourceChannelGroups(narrow)).toEqual([{ stream: 0, map: { format: "stereo", sources: [0, -1] } }]);
  });

  it("sources without audio have no groups", () => {
    expect(resolveSourceChannelGroups({ type: "image", metadata: { channels: 2 } })).toEqual([]);
    expect(resolveSourceChannelGroups({ type: "video", metadata: { channels: 2, hasAudio: false } })).toEqual([]);
  });

  it("sanitizes untrusted layouts", () => {
    expect(sanitizeSourceLayout("nope")).toBeUndefined();
    expect(sanitizeSourceLayout([{ stream: -1, map: { format: "mono", sources: [0] } }, { stream: 0, map: { format: "bad" } }])).toBeUndefined();
    expect(sanitizeSourceLayout([{ stream: 1, map: { format: "mono", sources: [2] } }])).toEqual([{ stream: 1, map: { format: "mono", sources: [2] } }]);
  });

  it("clip fields: stream index and map only when they differ from the file untouched", () => {
    const m = media(2, 2);
    expect(clipFieldsForGroup({ stream: 0, map: { format: "stereo", sources: [0, 1] } }, m)).toEqual({});
    expect(clipFieldsForGroup({ stream: 1, map: { format: "stereo", sources: [0, 1] } }, m)).toEqual({ audioTrackIndex: 1 });
    expect(clipFieldsForGroup({ stream: 0, map: { format: "mono", sources: [1] } }, m)).toEqual({ channelMap: { format: "mono", sources: [1] } });
    // A mono import default would otherwise reduce an untouched stereo group, so the map is stored explicitly.
    expect(clipFieldsForGroup({ stream: 0, map: { format: "stereo", sources: [0, 1] } }, { ...m, channelPreset: "mono" })).toEqual({ channelMap: { format: "stereo", sources: [0, 1] } });
  });

  it("flattens streams end to end", () => {
    const m = media(2, 2);
    expect(flattenedSourceChannels({ audioTrackIndex: 1, channelMap: { format: "mono", sources: [1] } }, m)).toMatchObject({ format: "mono", sources: [3], fileChannels: 4 });
    expect(flattenedSourceChannels({ audioTrackIndex: 1 }, m)).toMatchObject({ format: "stereo", sources: [2, 3] });
    expect(flattenedSourceChannels({ channelMap: { format: "stereo", sources: [1, -1] } }, m).sources).toEqual([1, -1]);
  });

  it("describes a group", () => {
    expect(describeSourceGroup({ stream: 0, map: { format: "mono", sources: [4] } })).toBe("Mono (ch 5)");
    expect(describeSourceGroup({ stream: 1, map: { format: "stereo", sources: [0, 1] } }, 2)).toBe("Stream 2 Stereo (ch 1 + 2)");
  });
});

describe("streams of different widths", () => {
  const mixed = (widths: number[], extra: object = {}) => ({ type: "video", metadata: { channels: Math.max(...widths), audioTrackCount: widths.length, audioStreamChannels: widths, hasAudio: true }, ...extra });

  it("groups per stream: a mono stream is one mono clip, a stereo stream one stereo clip, a 6-wide stream one 5.1 clip, a 4-wide one four monos", () => {
    expect(resolveSourceChannelGroups(mixed([1, 2])).map((g) => [g.stream, g.map.format, g.map.sources])).toEqual([[0, "mono", [0]], [1, "stereo", [0, 1]]]);
    expect(resolveSourceChannelGroups(mixed([2, 1, 6])).map((g) => [g.stream, g.map.format])).toEqual([[0, "stereo"], [1, "mono"], [2, "5.1"]]);
    expect(resolveSourceChannelGroups(mixed([2, 4])).map((g) => [g.stream, g.map.format, g.map.sources[0]])).toEqual([[0, "stereo", 0], [1, "mono", 0], [1, "mono", 1], [1, "mono", 2], [1, "mono", 3]]);
  });

  it("presets regroup each stream by its own width", () => {
    const shape = sourceAudioShape(mixed([1, 2, 3]));
    expect(shape.streamChannels).toEqual([1, 2, 3]);
    expect(shape.channels).toBe(3);
    expect(buildSourceGroups("stereo", shape).map((g) => [g.stream, g.map.sources])).toEqual([[0, [0, 0]], [1, [0, 1]], [2, [0, 1]], [2, [2]]]);
    expect(buildSourceGroups("mono", shape)).toHaveLength(6);
  });

  it("a stored layout is fitted per stream: a channel past that stream's width goes silent, not the file's widest", () => {
    const stored = [{ stream: 0, map: { format: "stereo" as const, sources: [0, 1] } }, { stream: 1, map: { format: "stereo" as const, sources: [0, 1] } }];
    const groups = resolveSourceChannelGroups(mixed([1, 2], { channelLayout: stored }));
    expect(groups.map((g) => g.map.sources)).toEqual([[0, -1], [0, 1]]);
  });

  it("clip fields leave the map off when the stream plays as it is, per stream width", () => {
    const media = mixed([1, 2]);
    const [mono, stereo] = resolveSourceChannelGroups(media);
    expect(clipFieldsForGroup(mono, media)).toEqual({});
    expect(clipFieldsForGroup(stereo, media)).toEqual({ audioTrackIndex: 1 });
    expect(clipFieldsForGroup({ stream: 1, map: { format: "mono", sources: [1] } }, media)).toEqual({ audioTrackIndex: 1, channelMap: { format: "mono", sources: [1] } });
  });

  it("flattened channels offset a stream by the widths of the streams before it", () => {
    const media = mixed([1, 2]);
    expect(flattenedSourceChannels({ audioTrackIndex: 1, channelMap: { format: "mono", sources: [1] } }, media)).toMatchObject({ sources: [2], fileChannels: 3 });
    expect(flattenedSourceChannels({ audioTrackIndex: 1 }, media)).toMatchObject({ format: "stereo", sources: [1, 2], fileChannels: 3 });
    expect(flattenedSourceChannels({ audioTrackIndex: 0 }, media)).toMatchObject({ format: "mono", sources: [0] });
  });

  it("a file that does not report per-stream widths keeps one width for every stream", () => {
    const shape = sourceAudioShape({ type: "video", metadata: { channels: 2, audioTrackCount: 3, hasAudio: true } });
    expect(shape.streamChannels).toEqual([2, 2, 2]);
  });
});
