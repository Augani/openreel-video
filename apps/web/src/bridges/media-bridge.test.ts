import { describe, it, expect, beforeEach, vi } from "vitest";
import { MediaBridge } from "./media-bridge";
import * as realEngines from "../services/engine-modules";
import { setEngineModulesForTests } from "../services/lazy-engines";

const { mockImportMedia } = vi.hoisted(() => ({
  mockImportMedia: vi.fn(),
}));

vi.mock("@openreel/core", () => ({
  initializeMediaImportService: vi.fn().mockResolvedValue({
    importMedia: mockImportMedia,
    getSupportedFormats: vi
      .fn()
      .mockReturnValue(["mp4", "mov", "webm", "mp3", "wav"]),
  }),
  getWaveformGenerator: vi.fn().mockReturnValue({
    generateWaveform: vi.fn().mockResolvedValue({
      samples: new Float32Array(100).fill(0.5),
      sampleRate: 100,
    }),
  }),
  MediaImportService: vi.fn(),
  WaveformGenerator: vi.fn(),
}));

vi.mock("../stores/project-store", () => ({
  useProjectStore: {
    getState: vi.fn().mockReturnValue({
      project: {
        id: "test-project",
        mediaLibrary: { items: [] },
        timeline: {
          tracks: [],
          subtitles: [],
          duration: 0,
          markers: [],
        },
      },
    }),
  },
}));

beforeEach(() => {
  // initializeMediaImportService / getWaveformGenerator come from the lazily loaded engine modules.
  setEngineModulesForTests({
    ...realEngines,
    initializeMediaImportService: vi.fn().mockResolvedValue({
      importMedia: mockImportMedia,
      getSupportedFormats: vi.fn().mockReturnValue(["mp4", "mov", "webm", "mp3", "wav"]),
    }),
    getWaveformGenerator: vi.fn().mockReturnValue({
      generateWaveform: vi.fn().mockResolvedValue({ samples: new Float32Array(100).fill(0.5), sampleRate: 100 }),
    }),
  } as unknown as typeof realEngines);
});

describe("MediaBridge - Import Validation", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should reject import when not initialized", async () => {
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
    expect(result.error).toBe("MediaBridge not initialized");
    expect(result.hasWaveform).toBe(false);
  });

  it("should pass file to import service when initialized", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "imported-id",
        name: "test.mp4",
        type: "video",
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
        thumbnails: [],
        waveformData: null,
      },
      warnings: [],
    });

    await mediaBridge.initialize();
    const file = new File(["test content"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(mockImportMedia).toHaveBeenCalledTimes(1);
    expect(mockImportMedia).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        generateThumbnails: true,
        generateWaveform: true,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("should propagate import service errors", async () => {
    mockImportMedia.mockResolvedValue({
      success: false,
      error: "Unsupported codec",
      warnings: [],
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unsupported codec");
  });

  it("should propagate warnings from import service", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "id",
        name: "test.mp4",
        type: "video",
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
        thumbnails: [],
        waveformData: null,
      },
      warnings: ["Variable frame rate detected", "Audio track missing"],
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Variable frame rate detected");
    expect(result.warnings).toContain("Audio track missing");
  });

});

describe("MediaBridge - Error Handling", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should handle import service throwing exception", async () => {
    mockImportMedia.mockRejectedValue(new Error("Decode failed"));

    await mediaBridge.initialize();
    const file = new File(["test"], "corrupt.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Decode failed");
  });

  it("should handle missing media in response", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: null,
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "empty.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
  });
});

describe("MediaBridge - Quick Mode Import", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should pass quickMode=true to import service when specified", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "large-file-id",
        name: "large-video.mp4",
        type: "video",
        metadata: {
          duration: 600,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 100000000,
        },
        thumbnails: [],
        waveformData: null,
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "large-video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file, true, true);

    expect(mockImportMedia).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        quickMode: true,
        generateThumbnails: false,
        generateWaveform: false,
      }),
    );
    expect(result.success).toBe(true);
  });

});
