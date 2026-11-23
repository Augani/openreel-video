import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockVideoEngine,
  mockRenderAudio,
  mockAudioEngine,
  mockMediaEngine,
  mockVideoSourceAdd,
  mockAudioSourceAdd,
  mockVideoSourceConfigs,
  mockGetFirstEncodableVideoCodec,
  mockOutputStart,
  mockOutputFinalize,
  mockCanEncodeVideo,
} = vi.hoisted(() => {
  const mockRenderFrame = vi.fn().mockResolvedValue({
    image: { close: vi.fn() },
    width: 1920,
    height: 1080,
  });

  const mockVideoEngine = {
    isInitialized: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    initializeGPUCompositor: vi.fn().mockResolvedValue(undefined),
    getGPUCompositor: vi.fn().mockReturnValue(null),
    renderFrame: mockRenderFrame,
    resetExportState: vi.fn(),
    clearVideoElementCache: vi.fn(),
    clearCache: vi.fn(),
  };

  const mockRenderAudio = vi.fn().mockResolvedValue({ buffer: null });
  const mockAudioEngine = {
    isInitialized: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    renderAudio: mockRenderAudio,
    clearCache: vi.fn(),
  };

  const mockMediaEngine = {
    isAvailable: vi.fn().mockReturnValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    getExportDecoder: vi.fn().mockReturnValue(null),
    createExportDecoder: vi.fn().mockResolvedValue(null),
    disposeAllExportDecoders: vi.fn(),
    clearFrameCache: vi.fn(),
  };

  return {
    mockRenderFrame,
    mockVideoEngine,
    mockRenderAudio,
    mockAudioEngine,
    mockMediaEngine,
    mockVideoSourceAdd: vi.fn().mockResolvedValue(undefined),
    mockAudioSourceAdd: vi.fn().mockResolvedValue(undefined),
    mockVideoSourceConfigs: [] as Record<string, unknown>[],
    mockGetFirstEncodableVideoCodec: vi.fn().mockResolvedValue("avc"),
    mockOutputStart: vi.fn().mockResolvedValue(undefined),
    mockOutputFinalize: vi.fn().mockResolvedValue(undefined),
    mockCanEncodeVideo: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("../video/video-engine", () => ({
  VideoEngine: vi.fn(),
  getVideoEngine: vi.fn().mockReturnValue(mockVideoEngine),
}));

vi.mock("../audio/audio-engine", () => ({
  AudioEngine: vi.fn(),
  getAudioEngine: vi.fn().mockReturnValue(mockAudioEngine),
}));

vi.mock("../text/title-engine", () => ({
  titleEngine: {
    getAllTextClips: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../graphics/graphics-engine", () => ({
  graphicsEngine: {
    getAllShapeClips: vi.fn().mockReturnValue([]),
    getAllSVGClips: vi.fn().mockReturnValue([]),
    getAllStickerClips: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../media/mediabunny-engine", () => ({
  getMediaEngine: vi.fn().mockReturnValue(mockMediaEngine),
}));

const { mockWasmEncode } = vi.hoisted(() => ({ mockWasmEncode: vi.fn() }));
vi.mock("../media/ffmpeg-fallback", () => ({
  getFFmpegFallback: () => ({ load: vi.fn().mockResolvedValue(undefined), encodeAudioStream: mockWasmEncode }),
}));
vi.mock("./audio-priming", () => ({ getAacEncoderPriming: vi.fn().mockResolvedValue(2112) }));
vi.mock("./mp4-audio-timing", () => ({ applyMp4AudioTiming: vi.fn((bytes) => bytes) }));

vi.mock("mediabunny", () => {
  class MockMp4OutputFormat {
    constructor(public options?: { onMoov?: (bytes: Uint8Array, position: number) => void }) {}
    getSupportedVideoCodecs() {
      return ["avc", "hevc"];
    }

    getSupportedAudioCodecs() {
      return ["aac"];
    }
  }

  class MockWebMOutputFormat extends MockMp4OutputFormat {}
  class MockMovOutputFormat extends MockMp4OutputFormat {}

  class MockOutput {
    constructor(private options: { format: MockMp4OutputFormat }) {}
    addVideoTrack = vi.fn();
    addAudioTrack = vi.fn();
    setMetadataTags = vi.fn();
    start = mockOutputStart;
    finalize = async () => {
      await mockOutputFinalize();
      this.options.format.options?.onMoov?.(new Uint8Array(8), 1000);
    };
  }

  class MockStreamTarget {
    constructor(
      _writable: WritableStream<{ data: Uint8Array; position: number }>,
      _options?: Record<string, unknown>,
    ) {}
  }

  class MockVideoSampleSource {
    add = async (...args: unknown[]) => {
      await mockVideoSourceAdd(...args);
      (this.config.onEncodedPacket as (() => void) | undefined)?.();
    };
    close = vi.fn();

    constructor(private config: Record<string, unknown>) {
      mockVideoSourceConfigs.push(config);
    }
  }

  class MockAudioBufferSource {
    add = mockAudioSourceAdd;
    close = vi.fn();

    constructor(_config: Record<string, unknown>) {}
  }

  class MockVideoSample {
    close = vi.fn();

    constructor(
      _data: unknown,
      public init: { timestamp: number; duration: number },
    ) {}
  }

  return {
    Output: MockOutput,
    StreamTarget: MockStreamTarget,
    Mp4OutputFormat: MockMp4OutputFormat,
    WebMOutputFormat: MockWebMOutputFormat,
    MovOutputFormat: MockMovOutputFormat,
    VideoSampleSource: MockVideoSampleSource,
    AudioBufferSource: MockAudioBufferSource,
    VideoSample: MockVideoSample,
    getFirstEncodableVideoCodec: mockGetFirstEncodableVideoCodec,
    canEncodeVideo: mockCanEncodeVideo,
    getFirstEncodableAudioCodec: vi.fn().mockResolvedValue("aac"),
    QUALITY_MEDIUM: 1_000_000,
  };
});

vi.mock("./smart-render-scan", () => ({
  scanSourceForSmartRender: vi.fn(async (_mediabunny: unknown, mediaId: string) => ({
    mediaId,
    codec: "avc",
    width: 640,
    height: 360,
    frameRate: 30,
    firstPts: 0,
    endTime: 8,
    keyframeTimes: [0, 2, 4, 6],
    closedGops: true,
    constantFrameRate: true,
    nalLengthSize: 4,
    rotation: 0,
    profile: 100,
    level: 31,
    color: { matrix: "bt709" },
  })),
}));

import { ExportEngine, setEncoderBackendFactory } from "./export-engine";
import type { EncoderBackend, SmartRenderMuxer } from "./encoder-backend";
import { DEFAULT_VIDEO_SETTINGS } from "./types";
import type { SmartAudioPlan, SmartAudioSourceInfo } from "./smart-render-audio";
import type { Project, Clip, Track } from "../types";
import type { ExportResult } from "./types";

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 0,
  duration: 8,
  inPoint: 0,
  outPoint: 8,
  effects: [],
  audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1,
  keyframes: [],
  ...over,
});

const project = (clipOver: Partial<Clip> = {}): Project =>
  ({
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "media-1",
          name: "a.mp4",
          type: "video",
          fileHandle: null,
          blob: new Blob(["media"]),
          metadata: { duration: 8, width: 640, height: 360, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 5, hasVideo: true, hasAudio: true },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      tracks: [{ id: "track-1", type: "video", name: "V1", clips: [clip(clipOver)], transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track],
      subtitles: [],
      duration: 8,
      markers: [],
    },
  }) as unknown as Project;

const aacInfo = (): SmartAudioSourceInfo => ({
  mediaId: "media-1",
  codec: "aac",
  sampleRate: 48000,
  channels: 2,
  sampleCount: 8 * 48000,
  startsAtZero: true,
  priming: 1024,
  frameSamples: 1024,
  packets: 376,
  bitrateKbps: 128,
});

describe("ExportEngine: smart render audio", () => {
  let engine: ExportEngine;
  const events: string[] = [];
  let begun: SmartAudioPlan | null;
  const probe = vi.fn();
  const begin = vi.fn();
  const skip = vi.fn();

  const install = () => {
    const smartRender: SmartRenderMuxer = {
      engine: "native",
      enable: () => undefined,
      beginEncodeRun: () => undefined,
      endEncodeRun: async () => undefined,
      copyRun: async (_blob, start, end) => Math.round((end - start) * 30),
      audio: {
        probe: async (mediaId, blob) => probe(mediaId, blob),
        begin: async (plan, blobFor) => {
          begun = plan;
          expect(blobFor("media-1")).toBeInstanceOf(Blob);
          return begin(plan);
        },
        skip: async (frames) => {
          events.push(`skip:${frames}`);
          await skip(frames);
        },
      },
    };
    const backend: EncoderBackend = {
      smartRender,
      requiresWebCodecsClamping: false,
      needsFrameThrottling: false,
      normalizesProResToH264: false,
      audioBeforeVideo: true,
      start: async () => { events.push("start"); },
      addVideoFrame: async () => { events.push("video"); },
      addAudioBuffer: async () => { events.push("audio"); },
      closeAudio: async () => { events.push("audio-closed"); },
      getBytesWritten: () => 0,
      finalize: async () => { events.push("finalize"); },
      abort: async () => undefined,
    };
    setEncoderBackendFactory(() => backend);
  };

  async function run(p: Project): Promise<ExportResult> {
    await engine.initialize();
    const generator = engine.exportVideo(p, { ...DEFAULT_VIDEO_SETTINGS, format: "mp4", codec: "h264", frameRate: 30, width: 640, height: 360, audioSettings: { ...DEFAULT_VIDEO_SETTINGS.audioSettings, format: "aac", sampleRate: 48000, channels: 2, bitrate: 192 } }, {} as FileSystemWritableFileStream);
    while (true) {
      const { done, value } = await generator.next();
      if (done) return value;
    }
  }

  beforeEach(() => {
    engine = new ExportEngine();
    vi.clearAllMocks();
    events.length = 0;
    begun = null;
    probe.mockReset().mockResolvedValue(aacInfo());
    begin.mockReset().mockResolvedValue(null);
    skip.mockReset().mockResolvedValue(undefined);
    mockMediaEngine.isAvailable.mockReturnValue(true);
    mockMediaEngine.getExportDecoder.mockReturnValue(null);
    mockRenderAudio.mockReset().mockImplementation(async (_project, _start, duration) => ({ buffer: { duration, length: Math.ceil(duration * 48000) } }));
    install();
  });
  afterEach(() => {
    setEncoderBackendFactory(null);
    engine.dispose();
  });

  it("copies the audio of an export that is one untouched AAC source: nothing is mixed and the report says so", async () => {
    const result = await run(project());
    expect(result.success).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(begun).toMatchObject({ eligible: true, mode: "whole", totalSamples: 384000 });
    expect(mockRenderAudio).not.toHaveBeenCalled();
    expect(events.filter((e) => e === "audio")).toEqual([]);
    expect(events).toContain("skip:384000");
    // the audio copy is proved before any frame is encoded or any audio is mixed
    expect(events.indexOf("start")).toBeLessThan(events.indexOf("skip:384000"));
    expect(events.indexOf("audio-closed")).toBeLessThan(events.indexOf("finalize"));
    expect(result.stats?.smartRender).toMatchObject({
      active: true,
      copiedSeconds: 8,
      encodedSeconds: 0,
      audio: { mode: "whole", codec: "aac", copiedSeconds: 8, encodedSeconds: 0, summary: "Audio: 100% copied" },
    });
  });

  it("renders and encodes the audio when the muxer does not accept the copy, and says why", async () => {
    begin.mockResolvedValue("the AAC stream's decoder carries state");
    const result = await run(project());
    expect(result.success).toBe(true);
    expect(mockRenderAudio).toHaveBeenCalled();
    expect(events).toContain("audio");
    expect(events.filter((e) => e.startsWith("skip"))).toEqual([]);
    expect(result.stats?.smartRender?.audio).toMatchObject({ mode: "none", copiedSeconds: 0, encodedSeconds: 8, reasons: expect.arrayContaining(["the AAC stream's decoder carries state"]) });
  });

  it("does not even probe the sources when the mixer touches the audio", async () => {
    const result = await run(project({ volume: 0.5 }));
    expect(result.success).toBe(true);
    expect(probe).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(mockRenderAudio).toHaveBeenCalled();
    expect(result.stats?.smartRender?.audio).toMatchObject({ mode: "none", reasons: [expect.stringMatching(/clip volume/)] });
  });

  it("falls back to the rendered audio when the copy cannot be set up at all", async () => {
    begin.mockRejectedValue(new Error("ffmpeg exited with code 1"));
    const result = await run(project());
    expect(result.success).toBe(true);
    expect(mockRenderAudio).toHaveBeenCalled();
    expect(result.stats?.smartRender?.audio?.reasons).toContain("ffmpeg exited with code 1");
  });
});
