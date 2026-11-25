import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockRenderFrame,
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

import { ExportEngine, setEncoderBackendFactory } from "./export-engine";
import type { EncoderBackend } from "./encoder-backend";
import { DEFAULT_VIDEO_SETTINGS } from "./types";
import type { Project, Timeline, Track, Clip } from "../types";
import type { ExportResult } from "./types";

const createMockProject = (overrides?: Partial<Project>): Project => ({
  id: "test-project-id",
  name: "Test Project",
  createdAt: Date.now(),
  modifiedAt: Date.now(),
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: {
    items: [
      {
        id: "media-1",
        name: "Mock video",
        type: "video",
        fileHandle: null,
        blob: new Blob(["original media"]),
        metadata: {
          duration: 40,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48_000,
          channels: 2,
          fileSize: 0,
          hasVideo: true,
          hasAudio: true,
        },
        thumbnailUrl: null,
        waveformData: null,
      },
    ],
  },
  timeline: {
    tracks: [],
    subtitles: [],
    duration: 0,
    markers: [],
  },
  ...overrides,
});

const createMockClip = (overrides?: Partial<Clip>): Clip => ({
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-1",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0.5, y: 0.5 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...overrides,
});

const createMockTrack = (overrides?: Partial<Track>): Track => ({
  id: "track-1",
  type: "video",
  name: "Video 1",
  clips: [createMockClip()],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

const createMockTimeline = (overrides?: Partial<Timeline>): Timeline => ({
  tracks: [createMockTrack()],
  subtitles: [],
  duration: 5,
  markers: [],
  ...overrides,
});

describe("ExportEngine", () => {
  let exportEngine: ExportEngine;

  beforeEach(() => {
    exportEngine = new ExportEngine();
    vi.clearAllMocks();
    mockVideoEngine.isInitialized.mockReturnValue(false);
    mockAudioEngine.isInitialized.mockReturnValue(false);
    mockMediaEngine.isAvailable.mockReturnValue(true);
    mockMediaEngine.getExportDecoder.mockReturnValue(null);
    mockVideoSourceConfigs.length = 0;
    mockGetFirstEncodableVideoCodec.mockResolvedValue("avc");
    mockCanEncodeVideo.mockResolvedValue(true);
    mockRenderFrame.mockResolvedValue({
      image: { close: vi.fn() },
      width: 1920,
      height: 1080,
    });
    mockRenderAudio.mockResolvedValue({ buffer: null });
  });

  afterEach(() => {
    exportEngine.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("file size estimation", () => {
    it("should estimate video file size", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = { ...DEFAULT_VIDEO_SETTINGS, bitrate: 8000 };
      const estimatedSize = exportEngine.estimateFileSize(project, settings);

      const expectedSize = ((8000 * 1000 + 192 * 1000) * 60) / 8;
      expect(estimatedSize).toBe(Math.ceil(expectedSize));
    });
  });

  describe("video export", () => {
    const writableStream = {
      seek: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileSystemWritableFileStream;

    async function drainVideoExport(
      settings = { ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 },
      duration = 1,
    ): Promise<ExportResult> {
      const project = createMockProject({
        timeline: createMockTimeline({
          tracks: [
            createMockTrack({
              clips: [createMockClip({ duration, outPoint: duration })],
            }),
          ],
          duration,
        }),
      });

      await exportEngine.initialize();
      const generator = exportEngine.exportVideo(project, settings, writableStream);

      while (true) {
        const { done, value } = await generator.next();
        if (done) return value;
      }
    }

    describe("timecode burn-in", () => {
      beforeEach(() => mockRenderFrame.mockClear());

      it("hands the burn-in setting to every rendered frame", async () => {
        const burnInTimecode = { enabled: true, position: "top-left" as const };
        await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360, burnInTimecode }, 2);
        expect(mockRenderFrame.mock.calls.length).toBeGreaterThan(0);
        for (const call of mockRenderFrame.mock.calls) expect(call[4]).toEqual({ timecodeBurnIn: burnInTimecode });
      });

      it("renders frames exactly as before when it is off or absent", async () => {
        await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360, burnInTimecode: { enabled: false } }, 1);
        await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 }, 1);
        expect(mockRenderFrame.mock.calls.length).toBeGreaterThan(0);
        for (const call of mockRenderFrame.mock.calls) expect(call).toHaveLength(4);
      });
    });

    describe("parallel segment windows", () => {
      afterEach(() => setEncoderBackendFactory(null));

      function installRecordingBackend() {
        const log = { stamps: [] as number[], audioBuffers: 0, closeAudio: 0, finalize: 0 };
        const backend: EncoderBackend = {
          requiresWebCodecsClamping: false,
          needsFrameThrottling: false,
          normalizesProResToH264: false,
          audioBeforeVideo: true,
          start: async () => undefined,
          addVideoFrame: async (_frame, timestampSec) => {
            log.stamps.push(timestampSec);
          },
          addAudioBuffer: async () => {
            log.audioBuffers += 1;
          },
          closeAudio: async () => {
            log.closeAudio += 1;
          },
          getBytesWritten: () => 0,
          finalize: async () => {
            log.finalize += 1;
          },
          abort: async () => undefined,
        };
        setEncoderBackendFactory(() => backend);
        return log;
      }
      const base = { ...DEFAULT_VIDEO_SETTINGS, frameRate: 10, width: 640, height: 360 };

      it("a video window renders only its frames, at the absolute times of a whole export, numbered from zero", async () => {
        const log = installRecordingBackend();
        mockRenderFrame.mockClear();
        const result = await drainVideoExport({ ...base, segmentWindow: { startFrame: 7, endFrame: 13, role: "video" } }, 3);
        expect(result.success).toBe(true);
        expect(log.stamps).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
        // The picture is rendered at the project time of frames 7..12 of the full export.
        expect(mockRenderFrame.mock.calls.map((call) => call[1])).toEqual([0.7, 0.8, 0.9, 1, 1.1, 1.2]);
        expect(log.finalize).toBe(1);
      });

      it("a video window sends no audio", async () => {
        const log = installRecordingBackend();
        mockRenderAudio.mockClear();
        await drainVideoExport({ ...base, segmentWindow: { startFrame: 0, endFrame: 5, role: "video" } }, 2);
        expect(log.audioBuffers).toBe(0);
        expect(log.closeAudio).toBe(0);
        expect(mockRenderAudio).not.toHaveBeenCalled();
      });

      it("an audio window renders the whole timeline's audio and no picture", async () => {
        const log = installRecordingBackend();
        mockRenderFrame.mockClear();
        const result = await drainVideoExport({ ...base, segmentWindow: { startFrame: 0, endFrame: 0, role: "audio" } }, 2);
        expect(result.success).toBe(true);
        expect(log.stamps).toEqual([]);
        expect(mockRenderFrame).not.toHaveBeenCalled();
        expect(log.closeAudio).toBe(1);
      });

      it("windows that tile the export render every frame exactly once", async () => {
        const log = installRecordingBackend();
        mockRenderFrame.mockClear();
        const tiles = [[0, 8], [8, 15], [15, 20]];
        for (const [startFrame, endFrame] of tiles) {
          await drainVideoExport({ ...base, segmentWindow: { startFrame, endFrame, role: "video" } }, 2);
        }
        const times = mockRenderFrame.mock.calls.map((call) => Math.round((call[1] as number) * 10));
        expect(times).toEqual(Array.from({ length: 20 }, (_, i) => i));
        expect(log.stamps).toHaveLength(20);
      });
    });

    describe("frame pipelining", () => {
      afterEach(() => setEncoderBackendFactory(null));

      function installBackend(supportsPipelining: boolean) {
        const state = { inFlight: 0, maxInFlight: 0, order: [] as number[], finalizedInFlight: -1 };
        const backend: EncoderBackend = {
          requiresWebCodecsClamping: false,
          needsFrameThrottling: false,
          normalizesProResToH264: false,
          audioBeforeVideo: true,
          supportsPipelining,
          start: async () => undefined,
          addVideoFrame: async (_frame, timestampSec) => {
            state.order.push(timestampSec);
            state.inFlight += 1;
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            await new Promise((resolve) => setTimeout(resolve, 3));
            state.inFlight -= 1;
          },
          addAudioBuffer: async () => undefined,
          closeAudio: async () => undefined,
          getBytesWritten: () => 0,
          finalize: async () => {
            state.finalizedInFlight = state.inFlight;
          },
          abort: async () => undefined,
        };
        setEncoderBackendFactory(() => backend);
        return state;
      }

      it("keeps frame order and bounds the queue for pipelined backends", async () => {
        const state = installBackend(true);
        const result = await drainVideoExport(
          { ...DEFAULT_VIDEO_SETTINGS, frameRate: 10, width: 640, height: 360 },
          2,
        );

        expect(result.success).toBe(true);
        expect(state.order).toEqual(Array.from({ length: 20 }, (_, i) => i / 10));
        expect(state.maxInFlight).toBeLessThanOrEqual(3);
        expect(state.finalizedInFlight).toBe(0);
      });

      it("stays sequential when the backend does not declare support", async () => {
        const state = installBackend(false);
        const result = await drainVideoExport(
          { ...DEFAULT_VIDEO_SETTINGS, frameRate: 10, width: 640, height: 360 },
          1,
        );

        expect(result.success).toBe(true);
        expect(state.maxInFlight).toBe(1);
      });
    });

    describe("audio beside video", () => {
      afterEach(() => setEncoderBackendFactory(null));

      function installBackend(audio: () => Promise<void>) {
        const events: string[] = [];
        const backend: EncoderBackend = {
          requiresWebCodecsClamping: false,
          needsFrameThrottling: false,
          normalizesProResToH264: false,
          audioBeforeVideo: true,
          start: async () => undefined,
          addVideoFrame: async () => { events.push("video"); },
          addAudioBuffer: async () => { events.push("audio"); await audio(); },
          closeAudio: async () => { events.push("audio-closed"); },
          getBytesWritten: () => 0,
          finalize: async () => { events.push("finalize"); },
          abort: async () => { events.push("abort"); },
        };
        setEncoderBackendFactory(() => backend);
        return events;
      }

      it("starts rendering frames while the audio mixdown is still running, and finishes audio before finalizing", async () => {
        let releaseAudio: () => void = () => undefined;
        const events = installBackend(() => new Promise<void>((resolve) => { releaseAudio = resolve; }));
        mockRenderAudio.mockImplementation(async (_project, _start, duration) => ({ buffer: { duration, length: duration * 48000 } }));
        const settings = { ...DEFAULT_VIDEO_SETTINGS, frameRate: 5, width: 640, height: 360 };
        const run = drainVideoExport(settings, 1);
        // Video frames must flow although the first audio chunk has not been accepted yet.
        await vi.waitFor(() => expect(events.filter((e) => e === "video")).toHaveLength(5));
        expect(events).not.toContain("audio-closed");
        expect(events).not.toContain("finalize");
        releaseAudio();
        const result = await run;
        expect(result.success).toBe(true);
        expect(events.indexOf("audio-closed")).toBeGreaterThan(-1);
        expect(events.indexOf("audio-closed")).toBeLessThan(events.indexOf("finalize"));
      });

      it("fails the export with the audio error, not a cancellation, when the mixdown breaks mid-export", async () => {
        installBackend(async () => { throw Object.assign(new Error("mix"), { code: "FRAME_ENCODE_FAILED", message: "audio mix failed", phase: "encoding", recoverable: false }); });
        mockRenderAudio.mockImplementation(async (_project, _start, duration) => ({ buffer: { duration, length: duration * 48000 } }));
        const result = await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 5, width: 640, height: 360 }, 1);
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FRAME_ENCODE_FAILED");
        expect(result.error?.message).toBe("audio mix failed");
      });
    });

    it("stops the audio mixdown after a video-side failure instead of rendering the remaining chunks", async () => {
      const events: string[] = [];
      let releaseAudio: () => void = () => undefined;
      const backend: EncoderBackend = {
        requiresWebCodecsClamping: false,
        needsFrameThrottling: false,
        normalizesProResToH264: false,
        audioBeforeVideo: true,
        start: async () => undefined,
        addVideoFrame: async () => { throw new Error("video encode broke"); },
        addAudioBuffer: async () => { events.push("audio"); await new Promise<void>((resolve) => { releaseAudio = resolve; }); },
        closeAudio: async () => undefined,
        getBytesWritten: () => 0,
        finalize: async () => undefined,
        abort: async () => undefined,
      };
      setEncoderBackendFactory(() => backend);
      try {
        mockRenderAudio.mockClear();
        mockRenderAudio.mockImplementation(async (_project, _start, duration) => ({ buffer: { duration, length: duration * 48000 } }));
        const result = await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 }, 40);
        expect(result.success).toBe(false);
        await vi.waitFor(() => expect(events).toHaveLength(1));
        releaseAudio();
        await new Promise((resolve) => setTimeout(resolve, 50));
        // 40 s is three 15 s chunks; only the one already in flight may have been rendered.
        expect(mockRenderAudio).toHaveBeenCalledTimes(1);
      } finally {
        setEncoderBackendFactory(null);
      }
    });

    describe("finalize watchdog", () => {
      afterEach(() => {
        setEncoderBackendFactory(null);
        vi.useRealTimers();
      });

      function installSlowFinalize(flags: Partial<EncoderBackend>) {
        let release!: () => void;
        const finalizeCalled = vi.fn();
        const backend: EncoderBackend = {
          requiresWebCodecsClamping: false,
          needsFrameThrottling: false,
          normalizesProResToH264: false,
          audioBeforeVideo: true,
          start: async () => undefined,
          addVideoFrame: async () => undefined,
          addAudioBuffer: async () => undefined,
          closeAudio: async () => undefined,
          getBytesWritten: () => 0,
          finalize: () => new Promise<void>((resolve) => { finalizeCalled(); release = resolve; }),
          abort: async () => undefined,
          ...flags,
        };
        setEncoderBackendFactory(() => backend);
        return { release: () => release(), finalizeCalled };
      }

      it("does not abort a slow finalize on external-encoder backends", async () => {
        vi.useFakeTimers();
        const { release, finalizeCalled } = installSlowFinalize({ drivesExternalEncoder: true });
        const pending = drainVideoExport();
        await vi.waitFor(() => expect(finalizeCalled).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        release();
        await vi.advanceTimersByTimeAsync(10);
        expect(await pending).toMatchObject({ success: true });
      });

      it("keeps the 30s finalize watchdog for WebCodecs backends", async () => {
        vi.useFakeTimers();
        const { finalizeCalled } = installSlowFinalize({});
        const pending = drainVideoExport();
        await vi.waitFor(() => expect(finalizeCalled).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(35_000);
        expect(await pending).toMatchObject({
          success: false,
          error: { message: expect.stringContaining("stopped responding") },
        });
      });
    });

    it("should render long export audio in chunks and clear cached audio", async () => {
      const project = createMockProject({
        timeline: createMockTimeline({
          tracks: [
            createMockTrack({
              clips: [createMockClip({ duration: 40, outPoint: 40 })],
            }),
          ],
          duration: 40,
        }),
      });

      mockRenderAudio.mockImplementation(async (_project, _start, duration) => ({ buffer: { duration, length: duration * 48000 } }));

      await exportEngine.initialize();

      const writableStream = {
        seek: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystemWritableFileStream;

      const generator = exportEngine.exportVideo(
        project,
        { ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360 },
        writableStream,
      );

      while (true) {
        const { done } = await generator.next();
        if (done) break;
      }

      expect(mockRenderAudio).toHaveBeenCalledTimes(3);
      expect(mockRenderAudio).toHaveBeenNthCalledWith(1, project, 0, 15);
      expect(mockRenderAudio).toHaveBeenNthCalledWith(2, project, 15, 15);
      expect(mockRenderAudio).toHaveBeenNthCalledWith(3, project, 30, 10);
      expect(mockAudioSourceAdd).toHaveBeenCalledTimes(3);
      expect(mockAudioEngine.clearCache).toHaveBeenCalled();
    });

    it("renders a selected range at original timeline times with output starting at zero", async () => {
      const settings = { ...DEFAULT_VIDEO_SETTINGS, width: 640, height: 360, frameRate: 30, range: { startTime: 2, endTime: 4 } };
      expect(await drainVideoExport(settings, 6)).toMatchObject({ success: true, stats: { framesRendered: 60 } });
      expect(mockRenderFrame).toHaveBeenNthCalledWith(1, expect.anything(), 2, 640, 360);
      expect(mockRenderFrame).toHaveBeenNthCalledWith(60, expect.anything(), 2 + 59 / 30, 640, 360);
      expect(mockVideoSourceAdd).toHaveBeenNthCalledWith(1, expect.objectContaining({ init: { timestamp: 0, duration: 1 / 30 } }));
      expect(mockRenderAudio).toHaveBeenCalledWith(expect.anything(), 2, 2);
    });

    describe("export frame rate different from the sequence frame rate", () => {
      async function renderTimes(projectFps: number, exportFps: number, duration: number, range?: { startTime: number; endTime: number }): Promise<number[]> {
        const project = createMockProject({
          settings: { width: 1920, height: 1080, frameRate: projectFps, sampleRate: 48000, channels: 2 },
          timeline: createMockTimeline({
            tracks: [createMockTrack({ clips: [createMockClip({ duration, outPoint: duration })] })],
            duration,
          }),
        });
        await exportEngine.initialize();
        const generator = exportEngine.exportVideo(
          project,
          { ...DEFAULT_VIDEO_SETTINGS, width: 640, height: 360, frameRate: exportFps, ...(range ? { range } : {}) },
          writableStream,
        );
        for (;;) {
          const { done, value } = await generator.next();
          if (done) {
            expect(value).toMatchObject({ success: true });
            break;
          }
        }
        return mockRenderFrame.mock.calls.map((call) => call[1] as number);
      }

      it("a 24 fps sequence exported at 30 fps shows sequence frames: every render time is a whole 24 fps frame, one is repeated per four", async () => {
        const times = await renderTimes(24, 30, 1);
        expect(times).toHaveLength(30);
        const frames = times.map((t) => Math.round(t * 24));
        times.forEach((t, i) => expect(t).toBeCloseTo(frames[i] / 24, 9));
        expect(frames.slice(0, 10)).toEqual([0, 0, 1, 2, 3, 4, 4, 5, 6, 7]);
        expect(new Set(frames).size).toBe(24);
      });

      it("a 30 fps sequence exported at 24 fps skips sequence frames and still stamps frames at the export rate", async () => {
        const times = await renderTimes(30, 24, 1);
        expect(times.map((t) => Math.round(t * 30)).slice(0, 6)).toEqual([0, 1, 2, 3, 5, 6]);
        expect(mockVideoSourceAdd).toHaveBeenNthCalledWith(2, expect.objectContaining({ init: { timestamp: 1 / 24, duration: 1 / 24 } }));
      });

      it("23.976 export of a 24 fps sequence never samples ahead of the frame on screen", async () => {
        const times = await renderTimes(24, 24000 / 1001, 2);
        times.forEach((t, i) => expect(t).toBeLessThanOrEqual(i / (24000 / 1001) + 1e-6));
      });

      it("quantises to sequence frames at the original timeline time when a range is exported", async () => {
        const times = await renderTimes(24, 30, 6, { startTime: 2, endTime: 3 });
        expect(times[0]).toBeCloseTo(2, 9);
        expect(times[2]).toBeCloseTo(2 + 1 / 24, 9);
      });

      it("matching rates render the same instants as before (no quantising)", async () => {
        const times = await renderTimes(30, 30, 1, { startTime: 0.01, endTime: 1 });
        expect(times[0]).toBeCloseTo(0.01, 12);
      });
    });

    it("chunks selected-range audio without including sound before In or after Out", async () => {
      mockRenderAudio.mockImplementation(async (_project, _start, duration) => ({ buffer: { duration, length: duration * 48000 } }));
      expect(await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, width: 640, height: 360, frameRate: 1, range: { startTime: 2, endTime: 34 } }, 35)).toMatchObject({ success: true });
      expect(mockRenderAudio.mock.calls.map(([, start, duration]) => [start, duration])).toEqual([[2, 15], [17, 15], [32, 2]]);
    });

    it.each([
      { startTime: -1, endTime: 2 }, { startTime: 2, endTime: 2 },
      { startTime: 4, endTime: 2 }, { startTime: 2, endTime: 7 },
      { startTime: NaN, endTime: 4 },
    ])("rejects invalid export ranges before rendering: %j", async (range) => {
      expect(await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360, range }, 6)).toMatchObject({ success: false, error: { code: "INVALID_SETTINGS" } });
      expect(mockRenderFrame).not.toHaveBeenCalled();
    });

    it("exports at the original size without starting the optional GPU upscaler", async () => {
      expect(await drainVideoExport()).toMatchObject({ success: true });
      expect(mockVideoEngine.initializeGPUCompositor).not.toHaveBeenCalled();
    });

    it("aborts upscaler initialization failures, restores preview mode, and allows retry", async () => {
      mockVideoEngine.initializeGPUCompositor.mockRejectedValueOnce(new Error("GPU initialization failed"));
      const upscaled = { ...DEFAULT_VIDEO_SETTINGS, width: 3840, height: 2160, frameRate: 1, upscaling: { enabled: true, quality: "balanced" as const, sharpening: 0 } };
      expect(await drainVideoExport(upscaled)).toMatchObject({ success: false, error: { message: expect.stringContaining("GPU initialization failed") } });
      expect(writableStream.abort).toHaveBeenCalled();
      expect(mockVideoEngine).toHaveProperty("exportMode", false);
      expect(await drainVideoExport()).toMatchObject({ success: true });
    });

    it("reports an unsupported requested codec before rendering instead of substituting", async () => {
      mockGetFirstEncodableVideoCodec.mockResolvedValue(null);
      expect(await drainVideoExport()).toMatchObject({ success: false, error: { code: "UNSUPPORTED_CODEC" } });
      expect(mockRenderFrame).not.toHaveBeenCalled();
      expect(writableStream.abort).toHaveBeenCalled();
      expect(mockVideoEngine).toHaveProperty("exportMode", false);
    });

    it("reports output commit failure and permits another export", async () => {
      vi.mocked(writableStream.close).mockRejectedValueOnce(new Error("Disk full"));
      expect(await drainVideoExport()).toMatchObject({ success: false, error: { message: "Disk full" } });
      expect(writableStream.abort).toHaveBeenCalled();
      expect(mockVideoEngine).toHaveProperty("exportMode", false);
      expect(await drainVideoExport()).toMatchObject({ success: true });
    });

    it("checks cancellation after the last frame before committing output", async () => {
      mockVideoSourceAdd.mockImplementationOnce(async () => { exportEngine.cancel(); });
      expect(await drainVideoExport()).toMatchObject({ success: false, error: { code: "CANCELLED" } });
      expect(writableStream.close).not.toHaveBeenCalled();
      expect(writableStream.abort).toHaveBeenCalled();
      expect(mockVideoEngine).toHaveProperty("exportMode", false);
      expect(await drainVideoExport()).toMatchObject({ success: true });
    });

    it("cancels a stalled frame submission and releases the export for retry", async () => {
      mockVideoSourceAdd.mockImplementationOnce(() => new Promise(() => {}));
      const pending = drainVideoExport();
      await vi.waitFor(() => expect(mockVideoSourceAdd).toHaveBeenCalled());
      exportEngine.cancel();
      expect(await pending).toMatchObject({ success: false, error: { code: "CANCELLED" } });
      expect(writableStream.abort).toHaveBeenCalled();
      expect(await drainVideoExport()).toMatchObject({ success: true });
    });

    it("closes a frame that arrives after its cancelled render", async () => {
      const image = { close: vi.fn() };
      let completeRender!: (frame: { image: typeof image; width: number; height: number }) => void;
      mockRenderFrame.mockImplementationOnce(() => new Promise((resolve) => { completeRender = resolve; }));
      const pending = drainVideoExport();
      await vi.waitFor(() => expect(mockRenderFrame).toHaveBeenCalled());
      exportEngine.cancel();
      expect(await pending).toMatchObject({ success: false, error: { code: "CANCELLED" } });
      completeRender({ image, width: 640, height: 360 });
      await vi.waitFor(() => expect(image.close).toHaveBeenCalledOnce());
    });

    it("gives a slow frame render (long-GOP seeks on a dense timeline) two minutes, not thirty seconds", async () => {
      vi.useFakeTimers();
      let completeRender!: (frame: { image: { close: () => void }; width: number; height: number }) => void;
      mockRenderFrame.mockImplementationOnce(() => new Promise((resolve) => { completeRender = resolve; }));
      const pending = drainVideoExport();
      await vi.waitFor(() => expect(mockRenderFrame).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(90_000);
      completeRender({ image: { close: vi.fn() }, width: 640, height: 360 });
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toMatchObject({ success: true });
    });

    it("still fails a render that never returns, after the render watchdog", async () => {
      vi.useFakeTimers();
      mockRenderFrame.mockImplementationOnce(() => new Promise(() => {}));
      const pending = drainVideoExport();
      await vi.waitFor(() => expect(mockRenderFrame).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await pending).toMatchObject({ success: false, error: { message: expect.stringContaining("stopped responding") } });
    });

    it("reports a stalled encoder and allows retry after its watchdog expires", async () => {
      vi.useFakeTimers();
      mockVideoSourceAdd.mockImplementationOnce(() => new Promise(() => {}));
      const pending = drainVideoExport();
      await vi.waitFor(() => expect(mockVideoSourceAdd).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toMatchObject({ success: false, error: { message: expect.stringContaining("stopped responding") } });
      expect(writableStream.abort).toHaveBeenCalled();
      expect(await drainVideoExport()).toMatchObject({ success: true });
    });

    it("uses realtime encoding in WebKit and requires every output frame", async () => {
      vi.stubGlobal("navigator", { userAgent: "AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15" });
      expect(await drainVideoExport()).toMatchObject({ success: true });
      expect(mockVideoSourceConfigs[0]).toMatchObject({ latencyMode: "realtime" });
      mockVideoSourceAdd.mockImplementationOnce(async () => {
        mockVideoSourceConfigs.at(-1)!.onEncodedPacket = undefined;
      });
      expect(await drainVideoExport()).toMatchObject({ success: false, error: { message: expect.stringContaining("0 of 1 frames") } });
      expect(writableStream.abort).toHaveBeenCalled();
    });

    it("decodes the original video blob for export", async () => {
      expect(await drainVideoExport()).toMatchObject({ success: true });
      expect(mockMediaEngine.createExportDecoder).toHaveBeenCalledWith("media-1", expect.any(Blob), 640);
    });

    it("renders export audio at the selected sample rate and channel count", async () => {
      expect(await drainVideoExport({ ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360, audioSettings: { ...DEFAULT_VIDEO_SETTINGS.audioSettings, sampleRate: 96000, channels: 1 } })).toMatchObject({ success: true });
      expect(mockRenderAudio).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ sampleRate: 96000, channels: 1 }) }), 0, 1);
    });

    it("cleans up when a cancelled export generator is closed at a yield", async () => {
      await exportEngine.initialize();
      const project = createMockProject({ timeline: createMockTimeline({ tracks: [createMockTrack({ clips: [createMockClip({ duration: 1, outPoint: 1 })] })] }) });
      const generator = exportEngine.exportVideo(project, DEFAULT_VIDEO_SETTINGS, writableStream);
      await generator.next();
      exportEngine.cancel();
      await generator.return({ success: false });
      expect(writableStream.abort).toHaveBeenCalled();
      expect(mockVideoEngine).toHaveProperty("exportMode", false);
      expect(await drainVideoExport()).toMatchObject({ success: true });
    });

    it("prefers hardware WebCodecs for the default browser backend", async () => {
      mockGetFirstEncodableVideoCodec.mockImplementation(async (codecs) => codecs[0]);

      await drainVideoExport();

      expect(mockGetFirstEncodableVideoCodec).toHaveBeenCalledWith(
        ["avc"],
        expect.objectContaining({ hardwareAcceleration: "prefer-hardware" }),
      );
      expect(mockVideoSourceConfigs[0]).toMatchObject({
        codec: "avc",
        hardwareAcceleration: "prefer-hardware",
      });
    });

    it("keeps decoder caches warm while throttling browser exports", async () => {
      await drainVideoExport({
        ...DEFAULT_VIDEO_SETTINGS,
        frameRate: 5,
        width: 640,
        height: 360,
      });

      // Caches are released once before muxing and once by the final safety
      // cleanup, but never in the middle of the five-frame render loop.
      expect(mockVideoEngine.clearVideoElementCache).toHaveBeenCalledTimes(2);
      expect(mockVideoEngine.clearCache).toHaveBeenCalledTimes(2);
      expect(mockMediaEngine.clearFrameCache).toHaveBeenCalledTimes(2);
    });

    it("falls back to no-preference when hardware WebCodecs is unavailable", async () => {
      mockGetFirstEncodableVideoCodec.mockImplementation(async (_codecs, options) =>
        options.hardwareAcceleration === "prefer-hardware" ? null : "avc",
      );

      await drainVideoExport();

      expect(mockGetFirstEncodableVideoCodec).toHaveBeenNthCalledWith(
        2,
        ["avc"],
        expect.objectContaining({ hardwareAcceleration: "prefer-hardware" }),
      );
      expect(mockGetFirstEncodableVideoCodec).toHaveBeenNthCalledWith(
        3,
        ["avc"],
        expect.objectContaining({ hardwareAcceleration: "no-preference" }),
      );
      expect(mockVideoSourceConfigs[0]).toMatchObject({
        codec: "avc",
        hardwareAcceleration: "no-preference",
      });
    });

    it("tries the requested codec before other container codecs", async () => {
      mockGetFirstEncodableVideoCodec.mockImplementation(async (codecs) => codecs[0]);

      await drainVideoExport({
        ...DEFAULT_VIDEO_SETTINGS,
        codec: "h265",
        frameRate: 1,
        width: 640,
        height: 360,
      });

      expect(mockGetFirstEncodableVideoCodec).toHaveBeenCalledWith(
        ["hevc"],
        expect.objectContaining({ hardwareAcceleration: "prefer-hardware" }),
      );
      expect(mockVideoSourceConfigs[0]).toMatchObject({
        codec: "hevc",
      });
    });

    it("validates the hardware hint and retries the same codec without it", async () => {
      mockGetFirstEncodableVideoCodec.mockResolvedValue("avc");
      mockCanEncodeVideo.mockImplementation(async (_codec, config) => config.hardwareAcceleration !== "prefer-hardware");
      expect(await drainVideoExport()).toMatchObject({ success: true });
      expect(mockCanEncodeVideo).toHaveBeenCalledWith("avc", expect.objectContaining({ hardwareAcceleration: "prefer-hardware", bitrateMode: "constant" }));
      expect(mockVideoSourceConfigs[0]).toMatchObject({ codec: "avc", hardwareAcceleration: "no-preference", bitrateMode: "constant" });
    });
  });
  describe("export duration", () => {
    it("ignores overlays that belong to other sequences or to a nest's own clock", async () => {
      const { titleEngine } = await import("../text/title-engine");
      const getAll = vi.mocked(titleEngine.getAllTextClips);
      getAll.mockReturnValueOnce([
        { id: "own", trackId: "t-text", startTime: 1, duration: 2 },
        { id: "in-nest", trackId: "nest-track", startTime: 0.5, duration: 9 },
      ] as never);
      const timeline = {
        tracks: [{ id: "t-text", type: "text", clips: [] }, { id: "t-video", type: "video", clips: [{ startTime: 0, duration: 2 }] }],
        subtitles: [],
        duration: 2,
        markers: [],
      };
      const duration = (exportEngine as unknown as { calculateTimelineDuration(t: unknown): number }).calculateTimelineDuration(timeline);
      expect(duration).toBe(3);
    });
  });

  describe("Dolby Digital delivery", () => {
    const AC3_BYTES = new Uint8Array([0x0b, 0x77, 1, 2, 3]);
    const fakeMix = (channels: number, sampleRate = 48000, length = 480): AudioBuffer =>
      ({
        numberOfChannels: channels,
        sampleRate,
        length,
        duration: length / sampleRate,
        getChannelData: (c: number) => Float32Array.from({ length }, (_, i) => (c + 1) * 0.1 * Math.sin(i / 7)),
      }) as unknown as AudioBuffer;
    const project = (settings: Partial<Project["settings"]> = {}): Project =>
      createMockProject({ settings: { ...createMockProject().settings, ...settings }, timeline: createMockTimeline() });
    const stubMix = (buffer: AudioBuffer) =>
      vi.spyOn(exportEngine as unknown as { renderTimelineAudio: () => Promise<AudioBuffer> }, "renderTimelineAudio").mockResolvedValue(buffer);
    const drainAudio = async (p: Project, settings: Record<string, unknown>): Promise<ExportResult> => {
      await exportEngine.initialize();
      const generator = exportEngine.exportAudio(p, settings);
      for (;;) {
        const { done, value } = await generator.next();
        if (done) return value;
      }
    };
    const readWav = (wav: ArrayBuffer) => {
      const view = new DataView(wav);
      return {
        channels: view.getUint16(22, true),
        sampleRate: view.getUint32(24, true),
        bits: view.getUint16(34, true),
        mask: view.getUint16(22, true) > 2 ? view.getUint32(40, true) : 0,
      };
    };

    it("desktop: a stereo AC-3 file goes to the sidecar as a 24-bit stereo WAV at the offered bitrate", async () => {
      const encodeDolbyAudio = vi.fn().mockResolvedValue(AC3_BYTES.buffer);
      vi.stubGlobal("openreel", { platform: "desktop", export: { encodeDolbyAudio } });
      stubMix(fakeMix(2));
      const result = await drainAudio(project(), { format: "ac3", sampleRate: 96000, bitrate: 300, channels: 2, bitDepth: 24 });
      expect(result).toMatchObject({ success: true });
      expect(result.blob?.type).toBe("audio/ac3");
      expect(new Uint8Array(await result.blob!.arrayBuffer())).toEqual(AC3_BYTES);
      const call = encodeDolbyAudio.mock.calls[0][0];
      expect(call).toMatchObject({ codec: "ac3", channels: 2, bitrateKbps: 320, sampleRate: 48000, dialnorm: -31 });
      expect(readWav(call.wav)).toMatchObject({ channels: 2, bits: 24 });
    });

    it("desktop: a 5.1 sequence sends six channels with the 5.1 speaker mask (L R C LFE Ls Rs) and at least 384 kbps; dialnorm follows the loudness target", async () => {
      const encodeDolbyAudio = vi.fn().mockResolvedValue(AC3_BYTES.buffer);
      vi.stubGlobal("openreel", { platform: "desktop", export: { encodeDolbyAudio } });
      stubMix(fakeMix(6));
      // The loudness step rebuilds the buffer through the Web Audio AudioBuffer constructor.
      vi.stubGlobal("AudioBuffer", class {
        readonly numberOfChannels: number; readonly sampleRate: number; readonly length: number;
        private readonly data: Float32Array[];
        constructor(o: { length: number; numberOfChannels: number; sampleRate: number }) {
          Object.assign(this, o);
          this.numberOfChannels = o.numberOfChannels; this.sampleRate = o.sampleRate; this.length = o.length;
          this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
        }
        getChannelData(c: number) { return this.data[c]; }
        copyToChannel(d: Float32Array, c: number) { this.data[c].set(d); }
      });
      const result = await drainAudio(project({ channels: 6, channelLayout: "5.1" }), {
        format: "eac3", sampleRate: 48000, bitrate: 192, channels: 2, bitDepth: 24,
        loudness: { enabled: true, targetLufs: -24, truePeakCeilingDb: -2 },
      });
      expect(result).toMatchObject({ success: true });
      expect(result.blob?.type).toBe("audio/eac3");
      const call = encodeDolbyAudio.mock.calls[0][0];
      expect(call).toMatchObject({ codec: "eac3", channels: 6, bitrateKbps: 384, dialnorm: -24 });
      expect(readWav(call.wav)).toMatchObject({ channels: 6, mask: 0x3f, bits: 24 });
    });

    it("browser: encodes on the ffmpeg.wasm core with the same arguments, the 5.1 relabel included", async () => {
      vi.stubGlobal("openreel", undefined);
      mockWasmEncode.mockResolvedValue(AC3_BYTES);
      stubMix(fakeMix(6));
      const result = await drainAudio(project({ channels: 6, channelLayout: "5.1" }), { format: "ac3", sampleRate: 48000, bitrate: 448, channels: 2, bitDepth: 24, dialnorm: -27 });
      expect(result).toMatchObject({ success: true });
      const [wav, args, muxer, extension] = mockWasmEncode.mock.calls[0];
      expect(wav).toBeInstanceOf(Uint8Array);
      expect(args).toEqual(["-af", "channelmap=map=0|1|2|3|4|5:channel_layout=5.1(side)", "-c:a", "ac3", "-b:a", "448k", "-ar", "48000", "-dialnorm", "-27"]);
      expect([muxer, extension]).toEqual(["ac3", "ac3"]);
    });

    it("refuses mono and other layouts", async () => {
      stubMix(fakeMix(1));
      const result = await drainAudio(project(), { format: "ac3", sampleRate: 48000, bitrate: 192, channels: 1, bitDepth: 24 });
      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: "INVALID_SETTINGS" });
      expect(result.error?.message).toMatch(/stereo or 5.1/);
    });

    it("the browser video exporter refuses an AC-3 track and MKV with a desktop-only reason, before any work", async () => {
      await exportEngine.initialize();
      const run = async (settings: Record<string, unknown>) => {
        const generator = exportEngine.exportVideo(project(), { ...DEFAULT_VIDEO_SETTINGS, frameRate: 1, width: 640, height: 360, ...settings }, {} as FileSystemWritableFileStream);
        for (;;) {
          const { done, value } = await generator.next();
          if (done) return value;
        }
      };
      const dolby = await run({ audioSettings: { ...DEFAULT_VIDEO_SETTINGS.audioSettings, format: "ac3", bitrate: 448 } });
      expect(dolby.success).toBe(false);
      expect(dolby.error).toMatchObject({ code: "UNSUPPORTED_CODEC" });
      expect(dolby.error?.message).toMatch(/needs the desktop app/);
      const mkv = await run({ format: "mkv" });
      expect(mkv.error).toMatchObject({ code: "UNSUPPORTED_CODEC" });
      expect(mkv.error?.message).toMatch(/MKV export needs the desktop app/);
      const webm = await run({ format: "webm", codec: "vp9", audioSettings: { ...DEFAULT_VIDEO_SETTINGS.audioSettings, format: "eac3", bitrate: 640 } });
      expect(webm.error).toMatchObject({ code: "INVALID_SETTINGS" });
      expect(webm.error?.message).toMatch(/WebM cannot carry/);
    });
  });
});
