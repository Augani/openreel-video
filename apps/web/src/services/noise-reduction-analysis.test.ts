import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpectralNoiseReducer,
  autoLearnNoiseProfile,
  type Clip,
  type Project,
} from "@openreel/core";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  analyzeNoiseSource,
  getRecommendationSampleRanges,
  getNoiseSearchRanges,
  noiseAnalysisSignature,
} from "./noise-reduction-analysis";
vi.mock("@openreel/core", async () => ({
  ...(await vi.importActual<typeof import("@openreel/core")>("@openreel/core")),
  autoLearnNoiseProfile: vi.fn(),
}));
vi.mock("../utils/load-audio-buffer", () => ({ loadAudioBuffer: vi.fn() }));
function buffer(
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel) => data[channel],
    copyFromChannel: (destination, channel, start = 0) =>
      destination.set(
        data[channel].subarray(start, start + destination.length),
      ),
    copyToChannel: (source, channel, start = 0) =>
      data[channel].set(source, start),
  };
}
function project(): Project {
  const p = createEmptyProject("Analysis");
  const clip: Clip = {
    id: "clip",
    trackId: "root",
    mediaId: "source",
    startTime: 20,
    duration: 60,
    inPoint: 5,
    outPoint: 125,
    speed: 2,
    reversed: true,
    audioTrackIndex: 2,
    volume: 0.5,
    fade: { fadeIn: 2, fadeOut: 2 },
    automation: { volume: [{ time: 0, value: 0.4 }] },
    audioEffects: [
      {
        id: "noise",
        type: "noiseReduction",
        enabled: true,
        params: { threshold: -40 },
      },
    ],
    effects: [],
    keyframes: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
  };
  const result: Project = {
    ...p,
    settings: { ...p.settings, sampleRate: 8000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "source",
          type: "audio",
          name: "Audio",
          blob: new Blob(["source"]),
          fileHandle: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 150,
            width: 0,
            height: 0,
            frameRate: 0,
            sampleRate: 8000,
            channels: 2,
            codec: "pcm",
            fileSize: 6,
          },
        },
      ],
    },
    timeline: {
      ...p.timeline,
      duration: 80,
      tracks: [
        {
          id: "root",
          name: "Root",
          type: "audio",
          clips: [clip],
          transitions: [],
          hidden: true,
          muted: true,
          solo: true,
          locked: false,
        },
      ],
    },
  };
  const root = result.timeline.tracks[0],
    source = {
      ...root.clips[0],
      id: "leaf",
      trackId: "inside",
      startTime: 0,
      duration: 150,
      inPoint: 0,
      outPoint: 150,
      speed: 1,
      reversed: false,
    };
  return {
    ...result,
    compoundClips: [
      {
        id: "definition",
        name: "Nested",
        color: "#888",
        createdAt: 0,
        modifiedAt: 0,
        content: {
          duration: 150,
          clips: [source],
          tracks: [
            {
              ...root,
              id: "inside",
              clips: [source],
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
      },
    ],
    timeline: {
      ...result.timeline,
      tracks: [
        {
          ...root,
          clips: root.clips.map((clip) => ({
            ...clip,
            mediaId: "compound:definition",
          })),
        },
      ],
    },
  };
}
function ordinaryProject(reversed = false): Project {
  const p = project();
  return {
    ...p,
    compoundClips: undefined,
    mediaLibrary: {
      items: p.mediaLibrary.items.map((item) => ({
        ...item,
        metadata: { ...item.metadata, channels: 1 },
      })),
    },
    timeline: {
      ...p.timeline,
      tracks: p.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          mediaId: "source",
          inPoint: 0,
          outPoint: 6,
          duration: 3,
          reversed,
        })),
      })),
    },
  };
}
function renderer() {
  let count = 0;
  return {
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    renderAudio: vi.fn(
      async (_project: Project, start: number, duration: number) => {
        const b = buffer(2, Math.round(duration * 8000), 8000);
        for (let c = 0; c < 2; c++) b.getChannelData(c).fill(++count);
        return {
          buffer: b,
          startTime: start,
          duration,
          sampleRate: 8000,
          channels: 2,
        };
      },
    ),
  };
}
const originalOfflineContext = globalThis.OfflineAudioContext;
beforeEach(() => {
  vi.mocked(autoLearnNoiseProfile).mockReset();
  vi.mocked(autoLearnNoiseProfile).mockResolvedValue({
    frequencyBins: new Float32Array([80, 250]),
    magnitudes: new Float32Array([0.4, 0.3]),
    standardDeviations: new Float32Array([0.02, 0.02]),
    sampleRate: 8000,
    fftSize: 4,
  });
  vi.spyOn(SpectralNoiseReducer.prototype, "learnNoiseProfile").mockReturnValue(
    {
      frequencyBins: new Float32Array([80, 250]),
      magnitudes: new Float32Array([0.4, 0.3]),
      standardDeviations: new Float32Array([0.02, 0.02]),
      sampleRate: 8000,
      fftSize: 4,
    },
  );
  globalThis.OfflineAudioContext = class {
    createBuffer = buffer;
  } as unknown as typeof OfflineAudioContext;
});
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.OfflineAudioContext = originalOfflineContext;
});
describe("bounded owned noise analysis", () => {
  it("reads three source windows totalling 24 seconds before clip gain/fades/cleanup and preserves track selection", async () => {
    const p = project(),
      engine = renderer(),
      progress = vi.fn();
    await analyzeNoiseSource(
      p,
      "clip",
      new AbortController().signal,
      progress,
      () => engine,
    );
    const ranges = getRecommendationSampleRanges(120);
    expect(
      engine.renderAudio.mock.calls.map((call) => call.slice(1, 3)),
    ).toEqual(ranges.map((range) => [range.start, range.end - range.start]));
    expect(ranges.reduce((n, r) => n + r.end - r.start, 0)).toBeCloseTo(24);
    const input = engine.renderAudio.mock.calls[0][0],
      clip = input.timeline.tracks[0].clips[0];
    expect(clip).toMatchObject({
      startTime: 0,
      duration: 120,
      speed: 1,
      reversed: true,
      audioTrackIndex: 2,
      volume: 1,
      audioEffects: [],
    });
    expect(clip.fade).toBeUndefined();
    expect(clip.automation).toBeUndefined();
    expect(input.timeline.tracks[0]).toMatchObject({
      hidden: false,
      muted: false,
      solo: false,
      transitions: [],
    });
    expect(p.timeline.tracks[0].clips[0]).toMatchObject({
      startTime: 20,
      speed: 2,
      volume: 0.5,
    });
    const sample = vi.mocked(autoLearnNoiseProfile).mock.calls[0][0];
    expect(sample.duration).toBeCloseTo(24);
    expect(sample.getChannelData(0)[0]).toBe(1);
    expect(sample.getChannelData(0).at(-1)).toBe(5);
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith({
      progress: 1,
      message: "Recommendation ready",
    });
  });
  it("aborts before decoding when cancelled during initialization", async () => {
    const p = project(),
      engine = renderer(),
      controller = new AbortController();
    let finish!: () => void;
    engine.initialize.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const pending = analyzeNoiseSource(
      p,
      "clip",
      controller.signal,
      () => {},
      () => engine,
    );
    controller.abort();
    finish();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.renderAudio).not.toHaveBeenCalled();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
  it("drops cancelled decoding before profile analysis and always closes the renderer", async () => {
    const p = project(),
      engine = renderer(),
      controller = new AbortController();
    let finish!: (
      value: Awaited<ReturnType<typeof engine.renderAudio>>,
    ) => void;
    engine.renderAudio.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const pending = analyzeNoiseSource(
      p,
      "clip",
      controller.signal,
      () => {},
      () => engine,
    );
    await vi.waitFor(() => expect(engine.renderAudio).toHaveBeenCalledOnce());
    controller.abort();
    finish({
      buffer: buffer(2, 64000, 8000),
      startTime: 0,
      duration: 8,
      sampleRate: 8000,
      channels: 2,
    });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(autoLearnNoiseProfile).not.toHaveBeenCalled();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
  it("closes a renderer after a decode failure", async () => {
    const engine = renderer();
    engine.renderAudio.mockRejectedValueOnce(new Error("decode failed"));
    await expect(
      analyzeNoiseSource(
        project(),
        "clip",
        new AbortController().signal,
        () => {},
        () => engine,
      ),
    ).rejects.toThrow("decode failed");
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
  it("keeps signatures stable for unrelated media and visual updates but observes source replacement", () => {
    const p = project(),
      before = noiseAnalysisSignature(p, "clip");
    const changed = {
      ...p,
      name: "Renamed",
      mediaLibrary: {
        items: [
          ...p.mediaLibrary.items,
          {
            ...p.mediaLibrary.items[0],
            id: "unrelated",
            blob: new Blob(["unrelated"]),
          },
        ],
      },
      timeline: {
        ...p.timeline,
        tracks: p.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => ({
            ...clip,
            volume: 0.2,
            transform: { ...clip.transform, rotation: 45 },
            audioEffects: [],
          })),
        })),
      },
    };
    expect(noiseAnalysisSignature(changed, "clip")).toBe(before);
    expect(
      noiseAnalysisSignature(
        {
          ...p,
          mediaLibrary: {
            items: p.mediaLibrary.items.map((item) => ({
              ...item,
              blob: new Blob(["new"]),
            })),
          },
        },
        "clip",
      ),
    ).not.toBe(before);
  });
  it("analyzes a compound without a proxy media asset and observes descendant audio changes", async () => {
    const compound = project(),
      engine = renderer();
    await analyzeNoiseSource(
      compound,
      "clip",
      new AbortController().signal,
      () => {},
      () => engine,
    );
    expect(engine.renderAudio.mock.calls[0][0].compoundClips).toBe(
      compound.compoundClips,
    );
    const signature = noiseAnalysisSignature(compound, "clip");
    const changed = {
      ...compound,
      compoundClips: compound.compoundClips!.map((def) => ({
        ...def,
        content: {
          ...def.content,
          tracks: def.content.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => ({ ...clip, volume: 0.25 })),
          })),
        },
      })),
    };
    expect(noiseAnalysisSignature(changed, "clip")).not.toBe(signature);
  });
  it("requires relinking unavailable ordinary source data before opening a renderer", async () => {
    const base = project(),
      p = {
        ...base,
        compoundClips: undefined,
        timeline: {
          ...base.timeline,
          tracks: base.timeline.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => ({ ...clip, mediaId: "source" })),
          })),
        },
      },
      create = vi.fn(renderer);
    await expect(
      analyzeNoiseSource(
        {
          ...p,
          mediaLibrary: {
            items: p.mediaLibrary.items.map((item) => ({
              ...item,
              blob: null,
            })),
          },
        },
        "clip",
        new AbortController().signal,
        () => {},
        create,
      ),
    ).rejects.toThrow(/Relink/);
    expect(create).not.toHaveBeenCalled();
  });
  it("searches the rest of a long source in short windows when distributed samples contain no isolated noise", async () => {
    vi.mocked(autoLearnNoiseProfile).mockResolvedValue(null);
    const p = project(),
      engine = renderer();
    const result = await analyzeNoiseSource(
      p,
      "clip",
      new AbortController().signal,
      () => {},
      () => engine,
    );
    expect(result.learnedProfile).toBeNull();
    const sampled = getRecommendationSampleRanges(120),
      remaining = [...getNoiseSearchRanges(120, sampled)];
    expect(
      engine.renderAudio.mock.calls.slice(3).map((call) => call.slice(1, 3)),
    ).toEqual(remaining.map((range) => [range.start, range.end - range.start]));
    let covered = 0;
    for (const range of [...sampled, ...remaining].sort(
      (a, b) => a.start - b.start,
    )) {
      expect(range.start).toBeLessThanOrEqual(covered);
      covered = Math.max(covered, range.end);
    }
    expect(covered).toBe(120);
    expect(
      vi
        .mocked(autoLearnNoiseProfile)
        .mock.calls.slice(1)
        .every((call) => call[0].duration <= 8),
    ).toBe(true);
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    "reads actual raw mono levels before the stereo panner and honors source reversal (reverse=%s)",
    async (reversed) => {
      const p = ordinaryProject(reversed),
        source = buffer(1, 48000, 8000);
      source.getChannelData(0).fill(0.25);
      source.getChannelData(0)[0] = 0.1;
      source.getChannelData(0)[47999] = 0.9;
      const decoder = {
        initialize: vi.fn(async () => true),
        dispose: vi.fn(),
        buffers: vi.fn(async function* () {
          yield { timestamp: 0, duration: 6, buffer: source };
        }),
      };
      const createRenderer = vi.fn(renderer),
        createDecoder = vi.fn(() => decoder);
      await analyzeNoiseSource(
        p,
        "clip",
        new AbortController().signal,
        () => {},
        createRenderer,
        createDecoder,
      );
      expect(createRenderer).not.toHaveBeenCalled();
      expect(createDecoder).toHaveBeenCalledWith(
        p.mediaLibrary.items[0].blob,
        2,
      );
      expect(decoder.buffers).toHaveBeenCalledWith(0, 6);
      const sample = vi.mocked(autoLearnNoiseProfile).mock.calls[0][0];
      expect(sample.numberOfChannels).toBe(1);
      expect(sample.sampleRate).toBe(8000);
      expect(sample.getChannelData(0)[100]).toBe(0.25);
      expect(sample.getChannelData(0)[0]).toBeCloseTo(reversed ? 0.9 : 0.1, 6);
      expect(sample.getChannelData(0).at(-1)).toBeCloseTo(
        reversed ? 0.1 : 0.9,
        6,
      );
      expect(source.getChannelData(0)[0]).toBeCloseTo(0.1, 6);
      expect(decoder.dispose).toHaveBeenCalledOnce();
    },
  );
  it("retains full-source decoding fallback when a ranged codec is unavailable", async () => {
    const p = ordinaryProject(),
      source = buffer(1, 48000, 8000);
    source.getChannelData(0).fill(0.25);
    vi.mocked(loadAudioBuffer).mockResolvedValueOnce(source);
    const decoder = {
      initialize: vi.fn(async () => false),
      dispose: vi.fn(),
      buffers: vi.fn(async function* () {}),
    };
    const createRenderer = vi.fn(renderer);
    await analyzeNoiseSource(
      p,
      "clip",
      new AbortController().signal,
      () => {},
      createRenderer,
      () => decoder,
    );
    expect(createRenderer).not.toHaveBeenCalled();
    expect(loadAudioBuffer).toHaveBeenCalledWith(
      expect.anything(),
      p.mediaLibrary.items[0].blob,
      expect.objectContaining({ audioTrackIndex: 2 }),
    );
    const sample = vi.mocked(autoLearnNoiseProfile).mock.calls[0][0];
    expect(sample.numberOfChannels).toBe(1);
    expect(sample.getChannelData(0)[100]).toBe(0.25);
    expect(decoder.dispose).toHaveBeenCalledOnce();
  });
  it("replaces partial ranged output with a complete legacy decode when a codec fails mid-window", async () => {
    const p = ordinaryProject(),
      source = buffer(1, 48000, 8000);
    source.getChannelData(0).fill(0.25);
    vi.mocked(loadAudioBuffer).mockResolvedValueOnce(source);
    const partial = buffer(1, 24000, 8000);
    partial.getChannelData(0).fill(0.1);
    const decoder = {
      initialize: vi.fn(async () => true),
      dispose: vi.fn(),
      buffers: vi.fn(async function* () {
        yield { timestamp: 0, duration: 3, buffer: partial };
        throw new Error("unsupported packet");
      }),
    };
    await analyzeNoiseSource(
      p,
      "clip",
      new AbortController().signal,
      () => {},
      vi.fn(renderer),
      () => decoder,
    );
    const sample = vi.mocked(autoLearnNoiseProfile).mock.calls[0][0];
    expect(sample.duration).toBe(6);
    expect(sample.getChannelData(0)[100]).toBe(0.25);
    expect(sample.getChannelData(0).at(-1)).toBe(0.25);
    expect(decoder.dispose).toHaveBeenCalledOnce();
  });
});
