import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio-engine";
import type { Clip, MediaItem, Project, Track } from "../types";

const identity = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const clip = (
  id: string,
  mediaId: string,
  changes: Partial<Clip> = {},
): Clip => ({
  id,
  mediaId,
  trackId: "track",
  startTime: 0,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
  volume: 1,
  transform: identity,
  effects: [],
  audioEffects: [],
  keyframes: [],
  ...changes,
});
const track = (
  id: string,
  clips: Clip[],
  changes: Partial<Track> = {},
): Track => ({
  id,
  name: id,
  type: "video",
  clips: clips.map((clip) => ({ ...clip, trackId: id })),
  transitions: [],
  muted: false,
  solo: false,
  hidden: false,
  locked: false,
  ...changes,
});
function project(proxyChanges: Partial<Clip> = {}): Project {
  return {
    id: "audio",
    name: "Audio",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 30,
      sampleRate: 8000,
      channels: 2,
    },
    timeline: {
      tracks: [
        track("root", [clip("proxy", "compound:definition", proxyChanges)]),
      ],
      duration: 10,
      subtitles: [],
      markers: [],
    },
    mediaLibrary: {
      items: [
        {
          id: "source",
          name: "source.wav",
          type: "audio",
          fileHandle: null,
          blob: new Blob(["fixture"]),
          thumbnailUrl: null,
          waveformData: null,
          metadata: {
            duration: 20,
            width: 0,
            height: 0,
            frameRate: 0,
            codec: "pcm",
            sampleRate: 8000,
            channels: 2,
            fileSize: 7,
          },
        },
      ],
    },
    compoundClips: [
      {
        id: "definition",
        name: "Nested",
        color: "#8b5cf6",
        createdAt: 0,
        modifiedAt: 0,
        content: {
          duration: 10,
          clips: [clip("leaf", "source")],
          tracks: [track("inner", [clip("leaf", "source")])],
        },
      },
    ],
  };
}
function buffer(channels = 2, length = 80000, sampleRate = 8000): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    duration: length / sampleRate,
    length,
    sampleRate,
    numberOfChannels: channels,
    getChannelData: (channel: number) => data[channel],
  } as AudioBuffer;
}
const parameter = () => ({
  value: 0,
  cancelScheduledValues: vi.fn(),
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
});
const gainNode = () => ({ gain: parameter(), connect: vi.fn() });
const sourceNode = () => ({
  buffer: null as AudioBuffer | null,
  playbackRate: parameter(),
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
});
const contexts: FakeOffline[] = [];
class FakeOffline {
  destination = {};
  sources: Array<ReturnType<typeof sourceNode>> = [];
  gains: Array<ReturnType<typeof gainNode>> = [];
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {
    contexts.push(this);
  }
  createGain() {
    const node = gainNode();
    this.gains.push(node);
    return node;
  }
  createStereoPanner() {
    return { pan: parameter(), connect: vi.fn() };
  }
  createBufferSource() {
    const node = sourceNode();
    this.sources.push(node);
    return node;
  }
  async startRendering() {
    return buffer(this.channels, this.length, this.sampleRate);
  }
}
function engine() {
  const instance = new AudioEngine();
  const decoded = vi.fn(
    async (_item: MediaItem, _context: BaseAudioContext, _index: number) =>
      buffer(),
  );
  Object.assign(instance, {
    initialized: true,
    audioContext: { createBuffer: buffer },
    getAudioBuffer: decoded,
    getSegmentedAudioDecoder: vi.fn(async () => null),
  });
  return { instance, decoded };
}
beforeEach(() => {
  contexts.length = 0;
  vi.stubGlobal("OfflineAudioContext", FakeOffline);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compound audio uses the canonical range renderer", () => {
  it("schedules the audible peak of overlapping fades in the actual renderer", async () => {
    const { instance } = engine();
    await instance.renderAudio(project({ duration: 5, outPoint: 5, fade: { fadeIn: 5, fadeOut: 5 } }), 0, 5);
    expect(contexts[0].gains[1].gain.linearRampToValueAtTime.mock.calls).toEqual([[0.5, 2.5], [0, 5]]);
  });

  it("keeps cropped parent fade timing distinct from a new local transition", async () => {
    const { instance } = engine(), input = project({ duration: 2, inPoint: 4, outPoint: 6, fade: { fadeIn: 5, fadeOut: 4, origin: { offset: 4, duration: 10 } } });
    input.timeline.tracks[0].transitions.push({ id: "enter", type: "crossfade", clipAId: "proxy", edge: "in", duration: 1, params: { audioFade: true } });
    await instance.renderAudio(input, 0, 2);
    const gain = contexts[0].gains[1].gain;
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(gain.linearRampToValueAtTime.mock.calls.at(-1)).toEqual([1, 2]);
    expect(gain.linearRampToValueAtTime.mock.calls.some(([value, time]) => value > 0.99 && Math.abs(time - 1) < 1e-8)).toBe(true);
  });

  it("mixes actual descendant media without a fake compound media asset", async () => {
    const { instance, decoded } = engine();
    await instance.renderAudio(project(), 0, 2);
    expect(decoded).toHaveBeenCalledOnce();
    expect(decoded.mock.calls[0][0].id).toBe("source");
    expect(contexts).toHaveLength(2);
    expect(contexts[0].sources).toHaveLength(1);
    expect(contexts[1].sources).toHaveLength(1);
  });
  it("maps parent trims, seek offset and speed into the descendant source range", async () => {
    const { instance } = engine();
    await instance.renderAudio(
      project({
        startTime: 10,
        duration: 3,
        inPoint: 2,
        outPoint: 8,
        speed: 2,
        pitchCorrection: false,
      }),
      11,
      1,
    );
    expect(contexts).toHaveLength(2);
    expect(contexts[1].sources[0].start).toHaveBeenCalledWith(0, 4, 2);
    expect(contexts[0].sources[0].playbackRate.value).toBe(2);
    expect(contexts[0].sources[0].start).toHaveBeenCalledWith(0, 0, 2);
    expect(contexts[0].sources[0].stop).toHaveBeenCalledWith(1);
  });
  it("honors mute and local solo inside the compound independently of the root track", async () => {
    const { instance, decoded } = engine(),
      original = project();
    const definition = original.compoundClips![0];
    await instance.renderAudio(
      {
        ...original,
        compoundClips: [
          {
            ...definition,
            content: {
              ...definition.content,
              tracks: [
                track("muted", [clip("muted-leaf", "source")], { muted: true }),
                track("ordinary", [clip("ordinary-leaf", "source")]),
                track("solo", [clip("solo-leaf", "source")], { solo: true }),
              ],
            },
          },
        ],
      },
      0,
      2,
    );
    expect(decoded).toHaveBeenCalledOnce();
    expect(contexts[1].sources).toHaveLength(1);
  });
  it("does not recurse forever through corrupt definitions and still mixes valid siblings", async () => {
    const { instance, decoded } = engine(),
      original = project();
    const definition = original.compoundClips![0];
    await instance.renderAudio(
      {
        ...original,
        compoundClips: [
          {
            ...definition,
            content: {
              ...definition.content,
              tracks: [
                track("inner", [
                  clip("cycle", "compound:definition"),
                  clip("leaf", "source"),
                ]),
              ],
            },
          },
        ],
      },
      0,
      2,
    );
    expect(decoded).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(2);
  });
  it("time-stretches instead of resampling when pitch is maintained (default)", async () => {
    const { instance } = engine();
    await instance.renderAudio(project({ duration: 3, inPoint: 2, outPoint: 8, speed: 2 }), 0.5, 1);
    expect(contexts[0].sources[0].playbackRate.value).toBe(1);
  });
  it("physically reverses the requested source segment instead of using a negative playback rate", async () => {
    const { instance } = engine();
    await instance.renderAudio(
      project({
        duration: 3,
        inPoint: 2,
        outPoint: 8,
        speed: 2,
        pitchCorrection: false,
        reversed: true,
      }),
      0.5,
      1,
    );
    expect(contexts).toHaveLength(2);
    expect(contexts[1].sources[0].start).toHaveBeenCalledWith(0, 5, 2);
    expect(contexts[0].sources[0].playbackRate.value).toBe(2);
    expect(contexts[0].sources[0].start).toHaveBeenCalledWith(0, 0, 2);
  });
  it("applies descendant effects before parent effects and retains export-only effects outside preview", async () => {
    const { instance } = engine(),
      original = project({
        audioEffects: [{ id: "parent", type: "eq", enabled: true, params: {} }],
      });
    const definition = original.compoundClips![0],
      child = {
        ...definition.content.tracks[0].clips[0],
        audioEffects: [
          { id: "child", type: "eq", enabled: true, params: {} },
          {
            id: "export-only",
            type: "eq",
            enabled: true,
            params: {},
            metadata: { previewBypass: true },
          },
        ],
      };
    const input: Project = {
      ...original,
      compoundClips: [
        {
          ...definition,
          content: { ...definition.content, tracks: [track("inner", [child])] },
        },
      ],
    };
    const effects = vi.fn(
      async (value: AudioBuffer, _effects: Clip["audioEffects"]) => ({
        buffer: value,
      }),
    );
    Object.assign(instance, { effectsEngine: { applyEffectChain: effects } });
    await instance.renderAudio(input, 0, 2);
    expect(
      effects.mock.calls.map((call) => call[1].map((effect) => effect.id)),
    ).toEqual([["child", "export-only"], ["parent"]]);
    effects.mockClear();
    await instance.renderAudio(input, 0, 2, { preview: true });
    expect(
      effects.mock.calls.map((call) => call[1].map((effect) => effect.id)),
    ).toEqual([["child"], ["parent"]]);
  });
  it("reverses the actual source samples without mutating a shared decoded buffer", async () => {
    const { instance, decoded } = engine(),
      original = project();
    const data = buffer(2, 16000, 8000);
    for (let i = 0; i < data.length; i++) data.getChannelData(0)[i] = i;
    decoded.mockResolvedValue(data);
    const root = track("root", [
      clip("backwards", "source", { duration: 2, outPoint: 2, reversed: true }),
    ]);
    await instance.renderAudio(
      { ...original, timeline: { ...original.timeline, tracks: [root] } },
      0,
      2,
    );
    const reversed = contexts[0].sources[0].buffer!;
    expect(reversed.getChannelData(0)[0]).toBe(15999);
    expect(reversed.getChannelData(0)[15999]).toBe(0);
    expect(data.getChannelData(0)[0]).toBe(0);
    expect(data.getChannelData(0)[15999]).toBe(15999);
  });
  it("reuses one descendant mix for aligned instances while keeping parent gains independent", async () => {
    const { instance, decoded } = engine(),
      original = project();
    const first = original.timeline.tracks[0].clips[0];
    const root = track("root", [
      { ...first, volume: 0.5 },
      { ...first, id: "second", volume: 0.25 },
    ]);
    await instance.renderAudio(
      { ...original, timeline: { ...original.timeline, tracks: [root] } },
      0,
      2,
    );
    expect(decoded).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(2);
    expect(contexts[0].sources).toHaveLength(2);
  });
  it("respects an audible solo track even when its first source starts after this render window", async () => {
    const { instance, decoded } = engine(),
      original = project();
    const solo = track("later", [clip("later", "source", { startTime: 10 })], {
      solo: true,
    });
    await instance.renderAudio(
      {
        ...original,
        timeline: {
          ...original.timeline,
          tracks: [...original.timeline.tracks, solo],
        },
      },
      0,
      2,
    );
    expect(decoded).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(1);
  });
  it.each([false, true])(
    "invalidates decoded or silent media when its blob is replaced (silent=%s)",
    async (silent) => {
      const instance = new AudioEngine(),
        original = project();
      const decode = vi.fn(async () => {
        if (silent) {
          const error = new Error("silent");
          error.name = "NoAudioStreamError";
          throw error;
        }
        return buffer();
      });
      Object.assign(instance, {
        initialized: true,
        audioContext: { createBuffer: buffer },
        extractAudioFromVideo: decode,
        getSegmentedAudioDecoder: vi.fn(async () => null),
      });
      await instance.renderAudio(original, 0, 2);
      await instance.renderAudio(original, 0, 2);
      expect(decode).toHaveBeenCalledOnce();
      const replaced = {
        ...original,
        mediaLibrary: {
          items: original.mediaLibrary.items.map((item) => ({
            ...item,
            blob: new Blob(["new source"]),
          })),
        },
      };
      await instance.renderAudio(replaced, 0, 2);
      expect(decode).toHaveBeenCalledTimes(2);
    },
  );
  it("decodes only the requested source interval for a long, sped-up compound source", async () => {
    const { instance, decoded } = engine(),
      original = project({ inPoint: 2, speed: 2 });
    const segment = buffer(2, 32000, 8000);
    const ranges = vi.fn(async function* (start: number, end: number) {
      yield { timestamp: start, duration: end - start, buffer: segment };
    });
    Object.assign(instance, {
      getSegmentedAudioDecoder: vi.fn(async () => ({ buffers: ranges })),
    });
    await instance.renderAudio(original, 0, 2);
    expect(ranges).toHaveBeenCalledWith(2, 6);
    expect(decoded).not.toHaveBeenCalled();
    expect(contexts[0].length).toBe(16000);
    expect(contexts[1].length).toBe(32000);
  });
  it("processes effects in the reversed playback direction without mutating shared source PCM", async () => {
    const { instance, decoded } = engine(),
      original = project();
    const data = buffer(2, 16000, 8000);
    for (let i = 0; i < data.length; i++) data.getChannelData(0)[i] = i;
    decoded.mockResolvedValue(data);
    const effects = vi.fn(async (value: AudioBuffer) => ({ buffer: value }));
    Object.assign(instance, { effectsEngine: { applyEffectChain: effects } });
    const root = track("root", [
      clip("backwards", "source", {
        duration: 2,
        outPoint: 2,
        reversed: true,
        audioEffects: [
          { id: "gain", type: "gain", enabled: true, params: { value: 0.5 } },
        ],
      }),
    ]);
    await instance.renderAudio(
      { ...original, timeline: { ...original.timeline, tracks: [root] } },
      0,
      2,
    );
    expect(effects.mock.calls[0][0].getChannelData(0)[0]).toBe(15999);
    expect(effects.mock.calls[0][0].getChannelData(0)[15999]).toBe(0);
    expect(data.getChannelData(0)[0]).toBe(0);
  });

  it("bounds decoded PCM retention and evicts the least recently used source", async () => {
    const instance = new AudioEngine(),
      original = project();
    const decode = vi.fn(
      async () =>
        ({
          duration: 20,
          length: 10000000,
          sampleRate: 8000,
          numberOfChannels: 2,
        }) as AudioBuffer,
    );
    Object.assign(instance, {
      initialized: true,
      audioContext: { createBuffer: buffer },
      extractAudioFromVideo: decode,
      getSegmentedAudioDecoder: vi.fn(async () => null),
    });
    const media = original.mediaLibrary.items[0];
    const input = (id: string): Project => ({
      ...original,
      mediaLibrary: { items: [{ ...media, id }] },
      timeline: {
        ...original.timeline,
        tracks: [track("root", [clip("direct", id)])],
      },
    });
    await instance.renderAudio(input("a"), 0, 2);
    await instance.renderAudio(input("a"), 0, 2);
    expect(decode).toHaveBeenCalledOnce();
    await instance.renderAudio(input("b"), 0, 2);
    await instance.renderAudio(input("a"), 0, 2);
    expect(decode).toHaveBeenCalledTimes(3);
    instance.clearCache();
    await instance.renderAudio(input("a"), 0, 2);
    expect(decode).toHaveBeenCalledTimes(4);
  });
  it("does not retain a decoded source larger than the PCM budget", async () => {
    const instance = new AudioEngine(),
      original = project();
    const decode = vi.fn(
      async () =>
        ({
          duration: 20,
          length: 20000000,
          sampleRate: 8000,
          numberOfChannels: 2,
        }) as AudioBuffer,
    );
    Object.assign(instance, {
      initialized: true,
      audioContext: { createBuffer: buffer },
      extractAudioFromVideo: decode,
      getSegmentedAudioDecoder: vi.fn(async () => null),
    });
    const input = {
      ...original,
      timeline: {
        ...original.timeline,
        tracks: [track("root", [clip("direct", "source")])],
      },
    };
    await instance.renderAudio(input, 0, 2);
    await instance.renderAudio(input, 0, 2);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("does not add a phantom sample at an aligned reverse effect-history boundary", async () => {
    const { instance, decoded } = engine(),
      original = project({
        duration: 6,
        outPoint: 6,
        reversed: true,
        audioEffects: [
          {
            id: "room",
            type: "reverb",
            enabled: true,
            params: { roomSize: 0.5, wetLevel: 0.5 },
          },
        ],
      });
    decoded.mockResolvedValue(buffer(2, 288000, 48000));
    Object.assign(instance, {
      effectsEngine: {
        applyEffectChain: vi.fn(async (value: AudioBuffer) => ({
          buffer: value,
        })),
      },
    });
    await instance.renderAudio(
      { ...original, settings: { ...original.settings, sampleRate: 48000 } },
      4,
      2,
    );
    expect(contexts[0].length).toBe(204160);
    expect(contexts[1].length).toBe(204160);
    expect(contexts[0].sources[0].buffer!.length).toBe(204160);
  });
});
