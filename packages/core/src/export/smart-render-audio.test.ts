import { describe, expect, it } from "vitest";
import type { Clip, MediaItem, Project, Track } from "../types";
import {
  AAC_FRAME_SAMPLES,
  declineSmartAudio,
  formatSmartAudioSummary,
  mixdownSampleCount,
  planSmartAudio,
  skippableAudioChunks,
  type SmartAudioSourceInfo,
} from "./smart-render-audio";

const SR = 48000;

const clip = (over: Partial<Clip> & Pick<Clip, "id" | "startTime" | "duration">): Clip => ({
  mediaId: "m1",
  trackId: "t1",
  inPoint: 0,
  outPoint: over.duration,
  effects: [],
  audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1,
  keyframes: [],
  ...over,
});

const media = (id: string, name = `${id}.mov`): MediaItem =>
  ({
    id,
    name,
    type: "video",
    fileHandle: null,
    blob: new Blob(["x"]),
    thumbnailUrl: null,
    waveformData: null,
    metadata: { duration: 30, width: 1280, height: 720, frameRate: 30, codec: "h264", sampleRate: SR, channels: 2, fileSize: 1, hasVideo: true, hasAudio: true },
  }) as MediaItem;

const track = (id: string, clips: Clip[], over: Partial<Track> = {}): Track =>
  ({ id, type: "video", name: id, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...over }) as Track;

const project = (tracks: Track[], over: Partial<Project> = {}, items: MediaItem[] = [media("m1"), media("m2")]): Project =>
  ({
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1280, height: 720, frameRate: 30, sampleRate: SR, channels: 2 },
    mediaLibrary: { items },
    timeline: { tracks, subtitles: [], duration: 30, markers: [] },
    ...over,
  }) as unknown as Project;

const pcm = (over: Partial<SmartAudioSourceInfo> = {}): SmartAudioSourceInfo => ({
  mediaId: "m1",
  codec: "pcm",
  sampleRate: SR,
  channels: 2,
  sampleCount: 30 * SR,
  startsAtZero: true,
  ...over,
});

const aac = (over: Partial<SmartAudioSourceInfo> = {}): SmartAudioSourceInfo => ({
  mediaId: "m1",
  codec: "aac",
  sampleRate: SR,
  channels: 2,
  sampleCount: 30 * SR,
  startsAtZero: true,
  priming: 1024,
  frameSamples: 1024,
  packets: 30 * 46.875 + 1,
  bitrateKbps: 128,
  ...over,
});

const aacSettings = { format: "mp4", codec: "h264", audioSettings: { format: "aac", sampleRate: SR, channels: 2, bitrate: 192 } } as const;
const pcmSettings = { format: "mov", codec: "prores", audioSettings: { format: "wav", sampleRate: SR, channels: 2, bitrate: 192 } } as const;

const plan = (p: Project, sources: SmartAudioSourceInfo[], settings: typeof aacSettings | typeof pcmSettings, exportStart = 0, exportDuration = 8) =>
  planSmartAudio({ project: p, settings, sources: new Map(sources.map((s) => [s.mediaId, s])), exportStart, exportDuration });

describe("mixdownSampleCount", () => {
  it("is the sum of the export's 15-second chunks", () => {
    expect(mixdownSampleCount(8, SR)).toBe(384000);
    expect(mixdownSampleCount(40, SR)).toBe(40 * SR);
    // 10.01 s at 44.1 kHz: ceil per chunk
    expect(mixdownSampleCount(20.00001, 44100)).toBe(Math.ceil(15 * 44100) + Math.ceil(5.00001 * 44100 - 1e-7));
  });
});

describe("planSmartAudio: AAC", () => {
  const one = (over: Partial<Clip> = {}, trackOver: Partial<Track> = {}) => project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8, ...over })], trackOver)]);

  it("copies the whole export when one untouched AAC source is the audio and the end is on a frame", () => {
    const result = plan(one(), [aac()], aacSettings);
    expect(result.eligible).toBe(true);
    expect(result.mode).toBe("whole");
    expect(result.segments).toEqual([{ kind: "copy", start: 0, end: 384000, mediaId: "m1", sourceStart: 0, priming: 1024 }]);
    expect(result.copiedSeconds).toBe(8);
    expect(result.encodedSeconds).toBe(0);
    expect(formatSmartAudioSummary(result.copiedSamples, result.totalSamples)).toBe("Audio: 100% copied");
  });

  it("starts mid-stream when the trim lands on an AAC frame boundary of the source's own grid", () => {
    // source sample 1024*100 is the start of packet 101 (priming 1024); 8 s = 375 frames
    const start = 1024 * 100;
    const result = plan(one({ inPoint: start / SR, outPoint: start / SR + 8 }), [aac()], aacSettings);
    expect(result.eligible).toBe(true);
    expect(result.segments[0]).toMatchObject({ kind: "copy", sourceStart: start, start: 0, end: 384000 });
  });

  it("follows the source's own frame grid when its encoder delay is 2112 samples", () => {
    const start = 1024 * 40 - 2112 + 1024;
    const on = plan(one({ inPoint: start / SR, outPoint: start / SR + 8 }), [aac({ priming: 2112 })], aacSettings);
    expect(on.eligible).toBe(true);
    // the same trim is off the grid of a source with 1024 samples of delay
    expect(plan(one({ inPoint: start / SR, outPoint: start / SR + 8 }), [aac({ priming: 1024 })], aacSettings).reasons.join()).toMatch(/AAC frame boundary/);
  });

  it("re-encodes when the trim starts or ends between frames", () => {
    const offGrid = plan(one({ inPoint: 1.0, outPoint: 9 }), [aac()], aacSettings);
    expect(offGrid.eligible).toBe(false);
    expect(offGrid.reasons.join()).toMatch(/start on an AAC frame boundary/);
    // 8.5 s = 408000 samples = 398.4 frames
    const endOff = plan(one({ duration: 8.5, outPoint: 8.5 }), [aac()], aacSettings, 0, 8.5);
    expect(endOff.eligible).toBe(false);
    expect(endOff.reasons.join()).toMatch(/end on an AAC frame boundary/);
    expect(endOff.segments).toEqual([{ kind: "encode", start: 0, end: 408000 }]);
  });

  it("does not copy an AAC span between rendered spans (the joins would not be seamless)", () => {
    const p = project([track("t1", [clip({ id: "c1", startTime: 0, duration: 4, outPoint: 4 })]), track("t2", [clip({ id: "c2", mediaId: "m2", startTime: 4, duration: 4, outPoint: 4 })])]);
    const result = plan(p, [aac(), aac({ mediaId: "m2" })], aacSettings);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join()).toMatch(/whole export/);
  });

  it("an export that ends past the audio, or a source of another rate or channel count, is rendered", () => {
    expect(plan(one(), [aac({ sampleCount: 7 * SR })], aacSettings).eligible).toBe(false);
    expect(plan(one(), [aac({ sampleRate: 44100 })], aacSettings).reasons.join()).toMatch(/44100 Hz differs/);
    expect(plan(one(), [aac({ channels: 1 })], aacSettings).reasons.join()).toMatch(/1 channels differ/);
    expect(plan(one(), [aac({ startsAtZero: false })], aacSettings).reasons.join()).toMatch(/does not start/);
  });

  it("does not copy a source whose bitrate is above the export's", () => {
    expect(plan(one(), [aac({ bitrateKbps: 320 })], aacSettings).reasons.join()).toMatch(/320 kb\/s audio is above/);
    expect(plan(one(), [aac({ bitrateKbps: 200 })], aacSettings).eligible).toBe(true);
  });

  it("does not put PCM into an AAC track, or AAC into a PCM one", () => {
    expect(plan(one(), [pcm()], aacSettings).eligible).toBe(false);
    expect(plan(one(), [aac()], pcmSettings).eligible).toBe(false);
  });

  it.each<[string, Partial<Clip>]>([
    ["clip volume", { volume: 0.5 }],
    ["fade", { fade: { fadeIn: 0.5, fadeOut: 0 } }],
    ["audio effects", { audioEffects: [{ id: "e", type: "eq", params: {}, enabled: true }] }],
    ["audio keyframes", { keyframes: [{ id: "k", time: 0, property: "volume", value: 0.5, easing: "linear" }] }],
    ["speed", { speed: 2 }],
    ["speed", { reversed: true }],
    ["channel mapping", { channelMap: { channels: [0, 1] } as never }],
  ])("a touched clip is rendered (%s)", (reason, over) => {
    const result = plan(one(over), [aac()], aacSettings);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join()).toContain(reason);
  });

  it("anything else in the mixer is rendered: racks, buses, mute and solo state, other clips, loudness, Dolby", () => {
    expect(plan(one({}, { audioRack: { effects: [{ id: "x" } as never] } }), [aac()], aacSettings).reasons.join()).toMatch(/track mixer/);
    expect(plan(one({}, { audioRack: { effects: [], volume: 0.8 } }), [aac()], aacSettings).eligible).toBe(false);
    expect(plan(one({}, { output: "bus1" }), [aac()], aacSettings).eligible).toBe(false);
    expect(plan(one({}, { solo: true }), [aac()], aacSettings).eligible).toBe(false);
    expect(plan(project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8 })])], { timeline: { ...one().timeline, masterAudioRack: { effects: [], volume: 1.2 } } as never }), [aac()], aacSettings).reasons.join()).toMatch(/master bus/);
    expect(plan(project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8 })])], { timeline: { ...one().timeline, audioBuses: [{ id: "b" }] } as never }), [aac()], aacSettings).reasons.join()).toMatch(/audio buses/);
    // a second audible clip over the span
    const mixed = project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8 })]), track("t2", [clip({ id: "c2", mediaId: "m2", startTime: 2, duration: 3 })])]);
    expect(plan(mixed, [aac(), aac({ mediaId: "m2" })], aacSettings).eligible).toBe(false);
    expect(planSmartAudio({ project: one(), settings: { ...aacSettings, audioSettings: { ...aacSettings.audioSettings, loudness: { enabled: true, targetLufs: -16, truePeakCeilingDb: -1 } as never } }, sources: new Map([["m1", aac()]]), exportStart: 0, exportDuration: 8 }).eligible).toBe(false);
    expect(planSmartAudio({ project: one(), settings: { ...aacSettings, audioSettings: { ...aacSettings.audioSettings, format: "ac3" } }, sources: new Map([["m1", aac()]]), exportStart: 0, exportDuration: 8 }).reasons.join()).toMatch(/Dolby/);
    expect(plan(one({}, { muted: true }), [aac()], aacSettings).reasons.join()).toMatch(/no audio/);
  });

  it("asks for a source only after the cheap project-wide checks pass", () => {
    const asked: string[] = [];
    const sources = new Map<string, SmartAudioSourceInfo>();
    sources.get = (id: string) => {
      asked.push(id);
      return undefined;
    };
    planSmartAudio({ project: one({ volume: 0.5 }), settings: aacSettings, sources, exportStart: 0, exportDuration: 8 });
    expect(asked).toEqual([]);
    planSmartAudio({ project: one(), settings: aacSettings, sources, exportStart: 0, exportDuration: 8 });
    expect(asked).toEqual(["m1"]);
  });
});

describe("planSmartAudio: multichannel layouts and source patching", () => {
  const sound = (id: string, over: Partial<Clip> = {}) =>
    clip({ id, startTime: 0, duration: 8, metadata: { sourceMonitorComponent: "audio" } as never, ...over });
  const patchedMedia = (extra: Partial<MediaItem> = {}): MediaItem => ({ ...media("m1"), ...extra }) as MediaItem;
  const withTracks = (tracks: Track[], items: MediaItem[] = [patchedMedia()]) => project(tracks, {}, items);
  const stereoMap = { channels: [0, 1] } as never;

  it("renders a project whose sound clips carry channel maps (a patched channel group)", () => {
    const p = withTracks([track("a1", [sound("s1", { channelMap: stereoMap })], { type: "audio" })]);
    const result = plan(p, [aac()], aacSettings);
    expect(result.eligible).toBe(false);
    expect(result.mode).toBe("none");
    expect(result.reasons.join()).toContain("channel mapping");
  });

  it("renders when one channel group of a multichannel source plays beside the picture, or on its own stream", () => {
    const groups = [
      { stream: 0, map: { channels: [0, 1] } },
      { stream: 0, map: { channels: [2, 3] } },
    ];
    const m = patchedMedia({ channelLayout: groups as never });
    const picture = clip({ id: "pic", startTime: 0, duration: 8, volume: 0, metadata: { sourceMonitorComponent: "video" } as never });
    const a1 = sound("s1", { channelMap: { channels: [0, 1] } as never });
    const a2 = sound("s2", { channelMap: { channels: [2, 3] } as never });
    const p = withTracks([track("v1", [picture]), track("a1", [a1], { type: "audio" }), track("a2", [a2], { type: "audio" })], [m]);
    expect(plan(p, [aac()], aacSettings).eligible).toBe(false);
    // the second stream of a file is not the first track
    const second = withTracks([track("a1", [sound("s1", { audioTrackIndex: 1 })], { type: "audio" })], [m]);
    expect(plan(second, [aac()], aacSettings).reasons.join()).toContain("alternate audio track");
  });

  it("renders when two sound clips of one source overlap in time, even if each is the untouched stream", () => {
    const p = withTracks([
      track("a1", [sound("s1")], { type: "audio" }),
      track("a2", [sound("s2")], { type: "audio" }),
    ]);
    expect(plan(p, [aac()], aacSettings).eligible).toBe(false);
  });

  it("renders when the file's import preset folds the channels, even without a clip channel map", () => {
    const p = withTracks([track("a1", [sound("s1")], { type: "audio" })], [patchedMedia({ channelPreset: "mono" })]);
    expect(plan(p, [aac()], aacSettings).reasons.join()).toContain("channel preset");
  });

  it("copies only the one sound clip that is the source's first stream played unchanged", () => {
    const m = patchedMedia({ channelLayout: [{ stream: 0, map: { channels: [0, 1] } }] as never });
    const p = withTracks([track("a1", [sound("s1")], { type: "audio" })], [m]);
    const result = plan(p, [aac()], aacSettings);
    expect(result.eligible).toBe(true);
    expect(result.mode).toBe("whole");
  });
});

describe("planSmartAudio: PCM spans", () => {
  const edited = () =>
    project([
      track("t1", [clip({ id: "c1", startTime: 0, duration: 10, outPoint: 10 })]),
      // a second audible clip plays over 3 s .. 5 s
      track("t2", [clip({ id: "c2", mediaId: "m2", startTime: 3, duration: 2, outPoint: 2 })]),
    ]);

  it("copies the stretches where one source plays alone and renders the others", () => {
    const result = plan(edited(), [pcm(), pcm({ mediaId: "m2" })], pcmSettings, 0, 10);
    expect(result.eligible).toBe(true);
    expect(result.mode).toBe("spans");
    expect(result.segments).toEqual([
      { kind: "copy", start: 0, end: 3 * SR, mediaId: "m1", sourceStart: 0 },
      { kind: "encode", start: 3 * SR, end: 5 * SR },
      { kind: "copy", start: 5 * SR, end: 10 * SR, mediaId: "m1", sourceStart: 5 * SR },
    ]);
    expect(result.copiedSeconds).toBe(8);
    expect(result.encodedSeconds).toBe(2);
    // tiles the output
    let cursor = 0;
    for (const segment of result.segments) {
      expect(segment.start).toBe(cursor);
      cursor = segment.end;
    }
    expect(cursor).toBe(result.totalSamples);
  });

  it("maps output samples to source samples through the trim and the placement", () => {
    const p = project([track("t1", [clip({ id: "c1", startTime: 2, duration: 5, inPoint: 1.5, outPoint: 6.5 })])]);
    const result = plan(p, [pcm()], pcmSettings, 0, 8);
    expect(result.segments).toEqual([
      { kind: "encode", start: 0, end: 2 * SR },
      { kind: "copy", start: 2 * SR, end: 7 * SR, mediaId: "m1", sourceStart: 1.5 * SR },
      { kind: "encode", start: 7 * SR, end: 8 * SR },
    ]);
  });

  it("a range export starts the output at the range start", () => {
    const result = plan(project([track("t1", [clip({ id: "c1", startTime: 0, duration: 20, outPoint: 20 })])]), [pcm()], pcmSettings, 5, 6);
    expect(result.segments).toEqual([{ kind: "copy", start: 0, end: 6 * SR, mediaId: "m1", sourceStart: 5 * SR }]);
    expect(result.mode).toBe("whole");
  });

  it("joins the clips a razor cut left (same source, same offset) into one copy", () => {
    const p = project([track("t1", [clip({ id: "c1", startTime: 0, duration: 4, outPoint: 4 }), clip({ id: "c2", startTime: 4, duration: 4, inPoint: 4, outPoint: 8 })])]);
    const result = plan(p, [pcm()], pcmSettings, 0, 8);
    expect(result.segments).toEqual([{ kind: "copy", start: 0, end: 8 * SR, mediaId: "m1", sourceStart: 0 }]);
    // a ripple delete (different offset) keeps two copies
    const rippled = project([track("t1", [clip({ id: "c1", startTime: 0, duration: 4, outPoint: 4 }), clip({ id: "c2", startTime: 4, duration: 4, inPoint: 6, outPoint: 10 })])]);
    expect(plan(rippled, [pcm()], pcmSettings, 0, 8).segments).toHaveLength(2);
  });

  it("ends the copy where the source's audio ends and renders the silence after it", () => {
    const result = plan(project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8, outPoint: 8 })])]), [pcm({ sampleCount: 6 * SR })], pcmSettings, 0, 8);
    expect(result.segments).toEqual([
      { kind: "copy", start: 0, end: 6 * SR, mediaId: "m1", sourceStart: 0 },
      { kind: "encode", start: 6 * SR, end: 8 * SR },
    ]);
  });

  it("does not copy a stretch shorter than a quarter second between rendered spans", () => {
    const p = project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8, outPoint: 8 })]), track("t2", [clip({ id: "c2", mediaId: "m2", startTime: 1, duration: 6.9, outPoint: 6.9 })])]);
    const result = plan(p, [pcm(), pcm({ mediaId: "m2" })], pcmSettings, 0, 8);
    expect(result.segments.filter((segment) => segment.kind === "copy").map((segment) => (segment.end - segment.start) / SR)).toEqual([1]);
  });

  it("a clip that is not on a whole sample is rendered", () => {
    // 1/29.97 s is 1601.6 samples
    const p = project([track("t1", [clip({ id: "c1", startTime: 1001 / 30000, duration: 5, outPoint: 5 })])]);
    expect(plan(p, [pcm()], pcmSettings, 0, 8).reasons.join()).toMatch(/whole sample/);
  });

  it("a touched clip anywhere in the span makes the audio rendered, so its tail cannot reach a copy", () => {
    const p = project([
      track("t1", [clip({ id: "c1", startTime: 0, duration: 10, outPoint: 10 })]),
      track("t2", [clip({ id: "c2", mediaId: "m2", startTime: 3, duration: 1, outPoint: 1, audioEffects: [{ id: "e", type: "reverb", params: {}, enabled: true }] })]),
    ]);
    const result = plan(p, [pcm(), pcm({ mediaId: "m2" })], pcmSettings, 0, 10);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join()).toMatch(/audio effects/);
  });
});

describe("skippableAudioChunks and declineSmartAudio", () => {
  it("leaves out the 15-second chunks that lie entirely inside copied spans", () => {
    const p = project([track("t1", [clip({ id: "c1", startTime: 0, duration: 50, outPoint: 50 })]), track("t2", [clip({ id: "c2", mediaId: "m2", startTime: 20, duration: 5, outPoint: 5 })])]);
    const result = plan(p, [pcm({ sampleCount: 60 * SR }), pcm({ mediaId: "m2", sampleCount: 60 * SR })], pcmSettings, 0, 50);
    // copies: 0..20 and 25..50; chunks: 0-15 yes, 15-30 touches 20..25, 30-45 yes, 45-50 yes
    expect(skippableAudioChunks(result, 50)).toEqual([
      { startSec: 0, durationSec: 15, frames: 15 * SR },
      { startSec: 30, durationSec: 15, frames: 15 * SR },
      { startSec: 45, durationSec: 5, frames: 5 * SR },
    ]);
  });

  it("a declined plan renders everything and keeps the reason", () => {
    const result = plan(project([track("t1", [clip({ id: "c1", startTime: 0, duration: 8 })])]), [aac()], aacSettings);
    const declined = declineSmartAudio(result, "the stream's decoder carries state");
    expect(declined.eligible).toBe(false);
    expect(declined.segments).toEqual([{ kind: "encode", start: 0, end: 384000 }]);
    expect(declined.reasons).toContain("the stream's decoder carries state");
    expect(skippableAudioChunks(declined, 8)).toEqual([]);
  });
});

describe("constants", () => {
  it("AAC-LC frames are 1024 samples", () => {
    expect(AAC_FRAME_SAMPLES).toBe(1024);
  });
});
