import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionComposition, Project } from "@openreel/core";
import {
  exportMotionCompositionSceneMp4,
  motionFrameExportFilename,
  motionSceneExportFilename,
} from "./export-motion-frame";

const {
  createDownloadWritableMock,
  exportVideoMock,
  initializeMock,
  insertInstanceMock,
  audioEngineClearCacheMock,
  audioEngineInitializeMock,
  audioEngineIsInitializedMock,
  audioEngineRenderAudioMock,
  createImageBitmapMock,
  isMotionLayerContentVisibleMock,
  nativeBackendAbortMock,
  nativeBackendAddAudioBufferMock,
  nativeBackendAddVideoFrameMock,
  nativeBackendCloseAudioMock,
  nativeBackendFinalizeMock,
  nativeBackendGetBytesWrittenMock,
  nativeBackendStartMock,
  resolveCreationMotionSceneBindingMock,
} = vi.hoisted(() => ({
  createDownloadWritableMock: vi.fn(),
  exportVideoMock: vi.fn(),
  initializeMock: vi.fn(),
  insertInstanceMock: vi.fn(),
  audioEngineClearCacheMock: vi.fn(),
  audioEngineInitializeMock: vi.fn(),
  audioEngineIsInitializedMock: vi.fn(),
  audioEngineRenderAudioMock: vi.fn(),
  createImageBitmapMock: vi.fn(),
  isMotionLayerContentVisibleMock: vi.fn(),
  nativeBackendAbortMock: vi.fn(),
  nativeBackendAddAudioBufferMock: vi.fn(),
  nativeBackendAddVideoFrameMock: vi.fn(),
  nativeBackendCloseAudioMock: vi.fn(),
  nativeBackendFinalizeMock: vi.fn(),
  nativeBackendGetBytesWrittenMock: vi.fn(),
  nativeBackendStartMock: vi.fn(),
  resolveCreationMotionSceneBindingMock: vi.fn(),
}));

vi.mock("../services/export-runner", () => ({
  createDownloadWritable: createDownloadWritableMock,
  mimeForExt: (ext: string) => (ext === "mp4" ? "video/mp4" : "application/octet-stream"),
}));

vi.mock("@openreel/core", () => ({
  DEFAULT_VIDEO_SETTINGS: {
    format: "mp4",
    codec: "h264",
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 5000,
    bitrateMode: "cbr",
    quality: 80,
    keyframeInterval: 60,
    audioSettings: {
      format: "aac",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 192,
      channels: 2,
    },
  },
  getExportEngine: () => ({
    initialize: initializeMock,
    exportVideo: exportVideoMock,
  }),
  getAudioEngine: () => ({
    clearCache: audioEngineClearCacheMock,
    initialize: audioEngineInitializeMock,
    isInitialized: audioEngineIsInitializedMock,
    renderAudio: audioEngineRenderAudioMock,
  }),
  isMotionLayerContentVisible: isMotionLayerContentVisibleMock,
  motionEngine: {
    createInstance: vi.fn((composition, options) => ({
      id: "instance-1",
      compositionId: composition.id,
      name: options.name,
      trackId: undefined,
      startTime: options.startTime,
      duration: options.duration,
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      },
      opacity: 1,
    })),
    insertInstance: insertInstanceMock,
  },
  motionRenderer: {
    renderComposition: vi.fn(),
  },
  MotionHighQualityRenderer: class {
    private readonly renderer: { renderComposition: (...args: unknown[]) => unknown };
    constructor(renderer: { renderComposition: (...args: unknown[]) => unknown }) {
      this.renderer = renderer;
    }
    render(...args: unknown[]) {
      return this.renderer.renderComposition(...args);
    }
  },
}));

vi.mock("@openreel/core/creation/index", () => ({
  resolveCreationMotionSceneBinding: resolveCreationMotionSceneBindingMock,
}));

vi.mock("../services/native-ffmpeg-backend", () => ({
  NativeFFmpegBackend: class {
    start = nativeBackendStartMock;
    addAudioBuffer = nativeBackendAddAudioBufferMock;
    addVideoFrame = nativeBackendAddVideoFrameMock;
    closeAudio = nativeBackendCloseAudioMock;
    getBytesWritten = nativeBackendGetBytesWrittenMock;
    finalize = nativeBackendFinalizeMock;
    abort = nativeBackendAbortMock;
  },
}));

function makeProject(): Project {
  return {
    id: "project-1",
    name: "Project",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1280,
      height: 720,
      frameRate: 24,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [
        {
          id: "video-track",
          type: "video",
          name: "Video",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      duration: 12,
      markers: [],
    },
    motionCompositions: [],
    motionInstances: [],
  };
}

const composition = {
  id: "comp-1",
  name: "Launch Scene!",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#111827",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
};

describe("motion frame export helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    vi.stubGlobal(
      "ImageData",
      class MockImageData {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
    delete (window as { __openreelExportPath?: string }).__openreelExportPath;
    createDownloadWritableMock.mockResolvedValue({ close: vi.fn() });
    initializeMock.mockResolvedValue(undefined);
    audioEngineClearCacheMock.mockReturnValue(undefined);
    audioEngineInitializeMock.mockResolvedValue(undefined);
    audioEngineIsInitializedMock.mockReturnValue(true);
    audioEngineRenderAudioMock.mockResolvedValue({ buffer: { tag: "audio" } });
    createImageBitmapMock.mockResolvedValue({ close: vi.fn() });
    isMotionLayerContentVisibleMock.mockImplementation(
      (_composition, layer: { visible: boolean }) => layer.visible,
    );
    insertInstanceMock.mockImplementation((project, instance) => ({
      ...project,
      motionInstances: [instance],
      timeline: {
        ...project.timeline,
        duration: instance.duration,
        tracks: [
          {
            id: "motion-track",
            type: "graphics",
            name: "Motion",
            clips: [
              {
                id: "motion-clip",
                mediaId: "motion-instance-1",
                trackId: "motion-track",
                startTime: 0,
                duration: instance.duration,
                inPoint: 0,
                outPoint: instance.duration,
                effects: [],
                audioEffects: [],
                transform: instance.transform,
                volume: 1,
                keyframes: [],
                metadata: {
                  motionClip: true,
                  motionInstanceId: instance.id,
                  motionCompositionId: instance.compositionId,
                },
              },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    }));
    nativeBackendAbortMock.mockResolvedValue(undefined);
    nativeBackendAddAudioBufferMock.mockResolvedValue(undefined);
    nativeBackendAddVideoFrameMock.mockResolvedValue(undefined);
    nativeBackendCloseAudioMock.mockResolvedValue(undefined);
    nativeBackendFinalizeMock.mockResolvedValue(undefined);
    nativeBackendGetBytesWrittenMock.mockReturnValue(4096);
    nativeBackendStartMock.mockResolvedValue(undefined);
    resolveCreationMotionSceneBindingMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
    delete (window as { __openreelExportPath?: string }).__openreelExportPath;
  });

  it("builds stable filenames", () => {
    expect(motionFrameExportFilename(composition, 1.25)).toBe(
      "launch-scene-frame-00038.png",
    );
    expect(motionSceneExportFilename(composition)).toBe("launch-scene.mp4");
  });

  it("exports a temporary motion-instance project through the core export engine", async () => {
    let exportedProject: unknown = null;
    let exportedSettings: unknown = null;
    exportVideoMock.mockImplementation(async function* (project, settings) {
      exportedProject = project;
      exportedSettings = settings;
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 75,
        totalFrames: 150,
        bytesWritten: 1024,
        currentBitrate: 5000,
      };
      return {
        success: true,
        stats: {
          duration: 100,
          framesRendered: 150,
          averageSpeed: 1,
          fileSize: 2048,
          averageBitrate: 5000,
        },
      };
    });
    const onProgress = vi.fn();

    const result = await exportMotionCompositionSceneMp4({
      project: makeProject(),
      composition,
      onProgress,
    });

    expect(createDownloadWritableMock).toHaveBeenCalledWith(
      "launch-scene.mp4",
      "video/mp4",
    );
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    const projectSeen = exportedProject as Project;
    expect(projectSeen.settings).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(projectSeen.timeline.tracks).toHaveLength(1);
    expect(projectSeen.motionInstances).toHaveLength(1);
    expect(projectSeen.motionCompositions?.[0].id).toBe("comp-1");
    expect(exportedSettings).toMatchObject({
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(result).toMatchObject({
      filename: "launch-scene.mp4",
      framesRendered: 150,
    });
  });

  it("exports compatible creation-backed scene3d compositions through native Aurora", async () => {
    const nativeComposition: MotionComposition = {
      ...composition,
      duration: 2,
      frameRate: 1,
      layers: [
        {
          id: "layer-scene3d",
          type: "scene3d",
          name: "Scene",
          startTime: 0,
          duration: 2,
          visible: true,
          locked: false,
          transform: {
            position: { x: 960, y: 540, z: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            rotation3d: { x: 0, y: 0, z: 0 },
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
            perspective: 1000,
            transformStyle: "flat",
          },
          keyframes: [],
          object: { kind: "box" },
        },
      ],
    };

    let sequenceListener: ((event: Record<string, unknown>) => void) | null = null;
    const showSaveDialog = vi
      .fn()
      .mockResolvedValue("/Users/me/Movies/native-launch.mp4");
    const onSequenceEvent = vi.fn((cb: (event: Record<string, unknown>) => void) => {
      sequenceListener = cb;
      return () => {
        sequenceListener = null;
      };
    });
    const startSequenceSession = vi
      .fn()
      .mockImplementation(async (args: { sessionId?: string }) => {
        queueMicrotask(() => {
          sequenceListener?.({
            kind: "frame",
            sessionId: args.sessionId ?? "aurora-export-test",
            frameIndex: 0,
            totalFrames: 2,
            timeSeconds: 0,
            progress: 0.5,
            done: false,
            result: {
              backend: "native",
              rgba: new Uint8Array(16),
              width: 2,
              height: 2,
              coveredPixels: 4,
              shadowedPixels: 0,
              renderMs: 1.2,
            },
          });
          queueMicrotask(() => {
            sequenceListener?.({
              kind: "frame",
              sessionId: args.sessionId ?? "aurora-export-test",
              frameIndex: 1,
              totalFrames: 2,
              timeSeconds: 1,
              progress: 1,
              done: true,
              result: {
                backend: "native",
                rgba: new Uint8Array(16),
                width: 2,
                height: 2,
                coveredPixels: 4,
                shadowedPixels: 0,
                renderMs: 1.4,
              },
            });
          });
        });
        return { sessionId: args.sessionId ?? "aurora-export-test" };
      });
    const cancelSequenceSession = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: {
        platform: "desktop",
        fs: { showSaveDialog },
        aurora: {
          startSequenceSession,
          cancelSequenceSession,
          onSequenceEvent,
        },
      },
    });

    resolveCreationMotionSceneBindingMock.mockReturnValue({
      scene: { id: "scene-aurora" },
      binding: { id: "binding-aurora" },
      assets: [{ id: "asset-aurora" }],
    });

    const onProgress = vi.fn();
    const result = await exportMotionCompositionSceneMp4({
      project: makeProject(),
      composition: nativeComposition,
      onProgress,
    });

    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: "launch-scene.mp4",
      filters: [{ name: "Media file", extensions: ["mp4"] }],
    });
    expect(startSequenceSession).toHaveBeenCalledWith({
      sessionId: expect.stringContaining("aurora-export-comp-1-"),
      scene: { id: "scene-aurora" },
      assets: [{ id: "asset-aurora" }],
      width: 1920,
      height: 1080,
      frameRate: 1,
      durationSeconds: 2,
      background: "#111827",
      quality: "final",
    });
    expect(nativeBackendStartMock).toHaveBeenCalledTimes(1);
    expect(nativeBackendCloseAudioMock).toHaveBeenCalledTimes(1);
    expect(nativeBackendAddVideoFrameMock).toHaveBeenCalledTimes(2);
    expect(nativeBackendFinalizeMock).toHaveBeenCalledTimes(1);
    expect(nativeBackendAbortMock).not.toHaveBeenCalled();
    expect(cancelSequenceSession).not.toHaveBeenCalled();
    expect(createDownloadWritableMock).not.toHaveBeenCalled();
    expect(exportVideoMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      filename: "launch-scene.mp4",
      framesRendered: 2,
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "rendering",
        progress: 1,
        currentFrame: 2,
        totalFrames: 2,
      }),
    );
    expect((window as { __openreelExportPath?: string }).__openreelExportPath).toBe(
      "/Users/me/Movies/native-launch.mp4",
    );
  });
});
