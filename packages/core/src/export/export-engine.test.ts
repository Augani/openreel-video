import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockRenderFrame,
  mockVideoEngine,
  mockRenderAudio,
  mockAudioEngine,
  mockMediaEngine,
  mockVideoSourceAdd,
  mockAudioSourceAdd,
  mockOutputStart,
  mockOutputFinalize,
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
    mockOutputStart: vi.fn().mockResolvedValue(undefined),
    mockOutputFinalize: vi.fn().mockResolvedValue(undefined),
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

vi.mock("mediabunny", () => {
  class MockMp4OutputFormat {
    getSupportedVideoCodecs() {
      return ["avc"];
    }

    getSupportedAudioCodecs() {
      return ["aac"];
    }
  }

  class MockWebMOutputFormat extends MockMp4OutputFormat {}
  class MockMovOutputFormat extends MockMp4OutputFormat {}

  class MockOutput {
    addVideoTrack = vi.fn();
    addAudioTrack = vi.fn();
    setMetadataTags = vi.fn();
    start = mockOutputStart;
    finalize = mockOutputFinalize;
  }

  class MockStreamTarget {
    constructor(
      _writable: WritableStream<{ data: Uint8Array; position: number }>,
      _options?: Record<string, unknown>,
    ) {}
  }

  class MockVideoSampleSource {
    add = mockVideoSourceAdd;
    close = vi.fn();

    constructor(_config: Record<string, unknown>) {}
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
      _init: { timestamp: number; duration: number },
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
    getFirstEncodableVideoCodec: vi.fn().mockResolvedValue("avc"),
    getFirstEncodableAudioCodec: vi.fn().mockResolvedValue("aac"),
    QUALITY_MEDIUM: 1_000_000,
  };
});

import { ExportEngine, getExportEngine } from "./export-engine";
import {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
} from "./types";
import type { Project, Timeline, Track, Clip } from "../types";

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
    items: [],
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
    mockRenderFrame.mockResolvedValue({
      image: { close: vi.fn() },
      width: 1920,
      height: 1080,
    });
    mockRenderAudio.mockResolvedValue({ buffer: null });
  });

  afterEach(() => {
    exportEngine.dispose();
  });

  describe("initialization", () => {
    it("should start uninitialized", () => {
      expect(exportEngine.isInitialized()).toBe(false);
    });

    it("should report MediaBunny unavailable before init", () => {
      expect(exportEngine.isMediaBunnyAvailable()).toBe(false);
    });
  });

  describe("singleton pattern", () => {
    it("should return same instance from getExportEngine", () => {
      const engine1 = getExportEngine();
      const engine2 = getExportEngine();
      expect(engine1).toBe(engine2);
    });
  });

  describe("presets", () => {
    it("should return export presets", () => {
      const presets = exportEngine.getPresets();
      expect(presets.length).toBeGreaterThan(0);
    });

    it("should have presets for all categories", () => {
      const presets = exportEngine.getPresets();
      const categories = new Set(presets.map((p) => p.category));
      expect(categories.has("social")).toBe(true);
      expect(categories.has("broadcast")).toBe(true);
      expect(categories.has("web")).toBe(true);
      expect(categories.has("archive")).toBe(true);
    });

    it("should have YouTube preset", () => {
      const presets = exportEngine.getPresets();
      const youtubePreset = presets.find((p) => p.id === "youtube-1080p");
      expect(youtubePreset).toBeDefined();
      expect(youtubePreset?.settings).toHaveProperty("codec", "h264");
    });

    it("should have TikTok preset with vertical dimensions", () => {
      const presets = exportEngine.getPresets();
      const tiktokPreset = presets.find((p) => p.id === "tiktok-1080p");
      expect(tiktokPreset).toBeDefined();
      if ("width" in tiktokPreset!.settings) {
        expect(tiktokPreset!.settings.width).toBe(1080);
        expect(tiktokPreset!.settings.height).toBe(1920);
      }
    });

    it("should create custom preset", () => {
      const customPreset = exportEngine.createPreset("My Preset", {
        ...DEFAULT_VIDEO_SETTINGS,
        bitrate: 15000,
      });
      expect(customPreset.name).toBe("My Preset");
      expect(customPreset.category).toBe("custom");
      expect(customPreset.id).toMatch(/^custom-/);
    });
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

    it("should estimate audio file size for WAV", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = { ...DEFAULT_AUDIO_SETTINGS, format: "wav" as const };
      const estimatedSize = exportEngine.estimateFileSize(project, settings);

      const expectedSize = 60 * 48000 * 2 * (16 / 8);
      expect(estimatedSize).toBe(Math.ceil(expectedSize));
    });

    it("should estimate audio file size for MP3", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = { ...DEFAULT_AUDIO_SETTINGS, bitrate: 320 };
      const estimatedSize = exportEngine.estimateFileSize(project, settings);

      const expectedSize = (320 * 1000 * 60) / 8;
      expect(estimatedSize).toBe(Math.ceil(expectedSize));
    });
  });

  describe("export time estimation", () => {
    it("should estimate video export time", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const settings = DEFAULT_VIDEO_SETTINGS;
      const estimatedTime = exportEngine.estimateExportTime(project, settings);

      expect(estimatedTime).toBeGreaterThan(0);
    });

    it("should estimate longer time for H.265", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const h264Settings = {
        ...DEFAULT_VIDEO_SETTINGS,
        codec: "h264" as const,
      };
      const h265Settings = {
        ...DEFAULT_VIDEO_SETTINGS,
        codec: "h265" as const,
      };

      const h264Time = exportEngine.estimateExportTime(project, h264Settings);
      const h265Time = exportEngine.estimateExportTime(project, h265Settings);

      expect(h265Time).toBeGreaterThan(h264Time);
    });

    it("should estimate longer time for 4K", () => {
      const project = createMockProject({
        timeline: createMockTimeline({ duration: 60 }),
      });

      const hd = { ...DEFAULT_VIDEO_SETTINGS, width: 1920, height: 1080 };
      const fourK = { ...DEFAULT_VIDEO_SETTINGS, width: 3840, height: 2160 };

      const hdTime = exportEngine.estimateExportTime(project, hd);
      const fourKTime = exportEngine.estimateExportTime(project, fourK);

      expect(fourKTime).toBeGreaterThan(hdTime);
    });
  });

  describe("cancel", () => {
    it("should not throw when canceling without active export", () => {
      expect(() => exportEngine.cancel()).not.toThrow();
    });
  });

  describe("video export", () => {
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

      mockRenderAudio.mockResolvedValue({ buffer: { duration: 15 } });

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
  });

  describe("dispose", () => {
    it("should reset state on dispose", () => {
      exportEngine.dispose();
      expect(exportEngine.isInitialized()).toBe(false);
      expect(exportEngine.isMediaBunnyAvailable()).toBe(false);
    });
  });
});

describe("Export Types and Defaults", () => {
  describe("DEFAULT_VIDEO_SETTINGS", () => {
    it("should have correct default format", () => {
      expect(DEFAULT_VIDEO_SETTINGS.format).toBe("mp4");
    });

    it("should have correct default codec", () => {
      expect(DEFAULT_VIDEO_SETTINGS.codec).toBe("h264");
    });

    it("should have correct default resolution", () => {
      expect(DEFAULT_VIDEO_SETTINGS.width).toBe(1920);
      expect(DEFAULT_VIDEO_SETTINGS.height).toBe(1080);
    });

    it("should have correct default frame rate", () => {
      expect(DEFAULT_VIDEO_SETTINGS.frameRate).toBe(30);
    });

    it("should have audio settings", () => {
      expect(DEFAULT_VIDEO_SETTINGS.audioSettings).toBeDefined();
      expect(DEFAULT_VIDEO_SETTINGS.audioSettings.sampleRate).toBe(48000);
    });
  });

  describe("DEFAULT_AUDIO_SETTINGS", () => {
    it("should have correct defaults", () => {
      expect(DEFAULT_AUDIO_SETTINGS.format).toBe("mp3");
      expect(DEFAULT_AUDIO_SETTINGS.sampleRate).toBe(48000);
      expect(DEFAULT_AUDIO_SETTINGS.bitrate).toBe(320);
      expect(DEFAULT_AUDIO_SETTINGS.channels).toBe(2);
    });
  });

  describe("DEFAULT_IMAGE_SETTINGS", () => {
    it("should have correct defaults", () => {
      expect(DEFAULT_IMAGE_SETTINGS.format).toBe("jpg");
      expect(DEFAULT_IMAGE_SETTINGS.quality).toBe(90);
      expect(DEFAULT_IMAGE_SETTINGS.width).toBe(1920);
      expect(DEFAULT_IMAGE_SETTINGS.height).toBe(1080);
    });
  });

  describe("VIDEO_QUALITY_PRESETS", () => {
    it("should have 4K preset", () => {
      expect(VIDEO_QUALITY_PRESETS["4k"]).toBeDefined();
      expect(VIDEO_QUALITY_PRESETS["4k"].width).toBe(3840);
      expect(VIDEO_QUALITY_PRESETS["4k"].height).toBe(2160);
    });

    it("should have 1080p preset", () => {
      expect(VIDEO_QUALITY_PRESETS["1080p"]).toBeDefined();
      expect(VIDEO_QUALITY_PRESETS["1080p"].width).toBe(1920);
      expect(VIDEO_QUALITY_PRESETS["1080p"].height).toBe(1080);
    });

    it("should have 720p preset", () => {
      expect(VIDEO_QUALITY_PRESETS["720p"]).toBeDefined();
      expect(VIDEO_QUALITY_PRESETS["720p"].width).toBe(1280);
      expect(VIDEO_QUALITY_PRESETS["720p"].height).toBe(720);
    });

    it("should have higher bitrate for 4K than 1080p", () => {
      expect(VIDEO_QUALITY_PRESETS["4k"].bitrate).toBeGreaterThan(
        VIDEO_QUALITY_PRESETS["1080p"].bitrate,
      );
    });
  });
});
