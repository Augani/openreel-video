import { describe, expect, it } from "vitest";
import { clipOf, media as makeMedia } from "./__fixtures__/project";
import type { Project } from "../types/project";
import type { Track } from "../types/timeline";
import { exportTimeline, importTimeline } from "./index";
import { validateXmeml } from "./xmeml-validate";

/**
 * Multichannel source clips in interchange: an 8-channel WAV placed as eight mono clips (A1..A8) and a MOV with two
 * stereo audio streams. XMEML carries each clip's file channel (mono / adjacent stereo); FCPXML carries it as
 * audio-channel-source; everything else reports the mapping as dropped.
 */
const FPS = 30;
const poly = (() => {
  const m = makeMedia("poly", "poly8.wav", "audio", 10, FPS, true);
  return { ...m, metadata: { ...m.metadata, channels: 8 } };
})();
const mov = (() => {
  const m = makeMedia("mov", "two-stereo.mov", "video", 10, FPS, true);
  return { ...m, metadata: { ...m.metadata, channels: 2, audioTrackCount: 2 } };
})();

function build(): Project {
  const monoTrack = (i: number): Track => ({
    id: `a${i + 1}`, type: "audio", name: `A${i + 1}`, transitions: [], locked: false, hidden: false, muted: false, solo: false,
    clips: [{ ...clipOf({ id: `s${i}`, mediaId: "poly", start: 0, length: 90, inFrame: 0 }, `a${i + 1}`, FPS), channelMap: { format: "mono", sources: [i] }, metadata: { sourceChannelGroup: i } }],
  } as unknown as Track);
  const video: Track = {
    id: "v1", type: "video", name: "V1", transitions: [], locked: false, hidden: false, muted: false, solo: false,
    clips: [{ ...clipOf({ id: "pic", mediaId: "mov", start: 0, length: 90, inFrame: 0, volume: 0 }, "v1", FPS) }],
  } as unknown as Track;
  const second: Track = {
    id: "m2", type: "audio", name: "M2", transitions: [], locked: false, hidden: false, muted: false, solo: false,
    clips: [{ ...clipOf({ id: "snd1", mediaId: "mov", start: 0, length: 90, inFrame: 0 }, "m2", FPS), audioTrackIndex: 1, metadata: { separatedFromClipId: "pic" } }],
  } as unknown as Track;
  const first: Track = {
    id: "m1", type: "audio", name: "M1", transitions: [], locked: false, hidden: false, muted: false, solo: false,
    clips: [{ ...clipOf({ id: "snd0", mediaId: "mov", start: 0, length: 90, inFrame: 0 }, "m1", FPS), metadata: { separatedFromClipId: "pic" } }],
  } as unknown as Track;
  return {
    id: "p", name: "mc", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: FPS, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [poly, mov] },
    timeline: { duration: 3, markers: [], subtitles: [], tracks: [video, first, second, ...[0, 1, 2, 3].map(monoTrack)] },
  } as unknown as Project;
}

describe("xmeml audio channels", () => {
  const out = exportTimeline(build(), "xmeml");
  const xml = out.files[0].content;

  it("is structurally valid xmeml", () => {
    expect(validateXmeml(xml)).toEqual([]);
  });

  it("writes mono clips with their source file channel, and the file's channel count", () => {
    const monoItems = [...xml.matchAll(/<clipitem id="[^"]+" premiereChannelType="mono">[\s\S]*?<trackindex>(\d+)<\/trackindex>/g)].map((m) => Number(m[1]));
    expect(monoItems).toEqual([1, 2, 3, 4]);
    expect(xml).toMatch(/<name>poly8\.wav<\/name>[\s\S]*?<channelcount>8<\/channelcount>/);
  });

  it("a second audio stream is addressed by its flattened channel and the file shows both streams' channels", () => {
    expect(xml).toMatch(/<name>two-stereo\.mov<\/name>[\s\S]*?<channelcount>4<\/channelcount>/);
    expect(xml).toMatch(/premiereChannelType="stereo">[\s\S]*?<sourcetrack>\s*<mediatype>audio<\/mediatype>\s*<trackindex>3<\/trackindex>/);
  });

  it("does not write a duplicate audio item for the muted picture whose sound is separate", () => {
    const audioSection = xml.split("<numOutputChannels>")[1];
    // snd0 + snd1 only: the picture (volume 0, its sound separated) adds no third item of its own.
    expect(audioSection.match(/<name>two-stereo\.mov<\/name>/g)).toHaveLength(2);
  });

  it("reports nothing as lost for representable mappings, and imports the mapping back", () => {
    expect(out.report.items.filter((i) => i.feature === "Audio channel mapping")).toEqual([]);
    const items = [poly, mov];
    const imported = importTimeline(xml, { mediaItems: items, makeId: (() => { let n = 0; return () => `i${++n}`; })() });
    const maps = imported.tracks.flatMap((t) => t.clips).filter((c) => c.mediaId === "poly").map((c) => c.channelMap);
    expect(maps).toEqual([0, 1, 2, 3].map((i) => ({ format: "mono", sources: [i] })));
  });

  it("approximates what xmeml cannot say: a swapped stereo pair and a 5.1 clip", () => {
    const project = build();
    const track = project.timeline.tracks[3];
    const tweaked = { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => t.id === track.id ? { ...t, clips: [{ ...t.clips[0], channelMap: { format: "stereo" as const, sources: [3, 2] } }] } : t) } } as Project;
    const result = exportTimeline(tweaked, "xmeml");
    const items = result.report.items.filter((i) => i.feature === "Audio channel mapping");
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("approximated");
    expect(items[0].detail).toMatch(/adjacent stereo pairs/);
  });
});

describe("fcpxml audio-channel-source", () => {
  const out = exportTimeline(build(), "fcpxml");
  const xml = out.files[0].content;

  it("writes srcCh / outCh per clip and the asset's streams and channels", () => {
    expect(xml).toContain('<audio-channel-source srcCh="1" outCh="C"');
    expect(xml).toContain('<audio-channel-source srcCh="4" outCh="C"');
    expect(xml).toContain('<audio-channel-source srcCh="3, 4" outCh="L, R"');
    expect(xml).toMatch(/audioSources="2" audioChannels="4"|audioChannels="4"[^>]*audioSources="2"|audioSources="2"[^>]*audioChannels="4"/);
    expect(xml).toMatch(/audioChannels="8"/);
  });

  it("a swapped stereo pair and a silent side are expressible", () => {
    const project = build();
    const swapped = { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => t.id === "a1" ? { ...t, clips: [{ ...t.clips[0], channelMap: { format: "stereo" as const, sources: [1, 0] } }] } : t.id === "a2" ? { ...t, clips: [{ ...t.clips[0], channelMap: { format: "stereo" as const, sources: [4, -1] } }] } : t) } } as Project;
    const text = exportTimeline(swapped, "fcpxml").files[0].content;
    expect(text).toContain('srcCh="2, 1" outCh="L, R"');
    expect(text).toContain('srcCh="5" outCh="L"');
  });

  it("imports the mapping back", () => {
    const imported = importTimeline(xml, { mediaItems: [poly, mov], makeId: (() => { let n = 0; return () => `f${++n}`; })() });
    const maps = imported.tracks.flatMap((t) => t.clips).filter((c) => c.mediaId === "poly").map((c) => c.channelMap?.sources[0]).sort();
    expect(maps).toEqual([0, 1, 2, 3]);
  });
});

describe("formats without channel mapping", () => {
  it.each(["otio", "edl", "aaf"] as const)("%s reports the mapping as dropped", (format) => {
    const project = build();
    const result = exportTimeline(project, format);
    const dropped = result.report.items.filter((i) => i.feature === "Audio channel mapping");
    // EDL exports no audio tracks at all, so its report is about the audio tracks instead.
    if (format === "edl") expect(result.report.items.some((i) => i.feature === "Audio track")).toBe(true);
    else expect(dropped.length).toBeGreaterThan(0);
    for (const item of dropped) expect(item.severity).toBe("dropped");
  });
});
