import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionComposition, Project } from "@openreel/core";
import {
  exportMotionCompositionScene,
  MOTION_EXPORT_FORMATS,
} from "./export-motion-frame";

const {
  createDownloadWritableMock,
  exportVideoMock,
  initializeMock,
  insertInstanceMock,
  renderMock,
} = vi.hoisted(() => ({
  createDownloadWritableMock: vi.fn(),
  exportVideoMock: vi.fn(),
  initializeMock: vi.fn(),
  insertInstanceMock: vi.fn(),
  renderMock: vi.fn(),
}));

vi.mock("../services/export-runner", () => ({
  createDownloadWritable: createDownloadWritableMock,
  mimeForExt: (ext: string) =>
    ext === "mp4"
      ? "video/mp4"
      : ext === "zip"
        ? "application/zip"
        : "application/octet-stream",
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
  DEFAULT_MOTION_INSTANCE_TRANSFORM: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  getExportEngine: () => ({
    initialize: initializeMock,
    exportVideo: exportVideoMock,
  }),
  getAudioEngine: () => ({
    clearCache: vi.fn(),
    initialize: vi.fn(),
    isInitialized: vi.fn(() => true),
    renderAudio: vi.fn(),
  }),
  isMotionLayerContentVisible: (
    _composition: unknown,
    layer: { visible: boolean },
  ) => layer.visible,
  motionEngine: {
    createInstance: vi.fn((composition: { id: string }, options: { name: string; startTime: number; duration: number }) => ({
      id: "instance-1",
      compositionId: composition.id,
      name: options.name,
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
  motionRenderer: { renderComposition: vi.fn() },
  MotionHighQualityRenderer: class {
    render = renderMock;
  },
}));

vi.mock("@openreel/core/creation/index", () => ({
  resolveCreationMotionSceneBinding: vi.fn(() => null),
}));

vi.mock("../services/native-ffmpeg-backend", () => ({
  NativeFFmpegBackend: class {},
}));

function readUint16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

interface ParsedZipEntry {
  readonly name: string;
  readonly crc: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

function parseCentralDirectory(zip: Uint8Array): ParsedZipEntry[] {
  let eocd = -1;
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (readUint32(zip, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("EOCD record not found");
  }
  const count = readUint16(zip, eocd + 10);
  let cursor = readUint32(zip, eocd + 16);
  const entries: ParsedZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (readUint32(zip, cursor) !== 0x02014b50) {
      throw new Error("Central directory signature mismatch");
    }
    const crc = readUint32(zip, cursor + 16);
    const size = readUint32(zip, cursor + 24);
    const nameLength = readUint16(zip, cursor + 28);
    const extraLength = readUint16(zip, cursor + 30);
    const commentLength = readUint16(zip, cursor + 32);
    const localHeaderOffset = readUint32(zip, cursor + 42);
    const nameBytes = zip.slice(cursor + 46, cursor + 46 + nameLength);
    entries.push({
      name: new TextDecoder().decode(nameBytes),
      crc,
      size,
      localHeaderOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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
      tracks: [],
      subtitles: [],
      duration: 12,
      markers: [],
    },
    motionCompositions: [],
    motionInstances: [],
  } as unknown as Project;
}

const composition = {
  id: "comp-1",
  name: "Range Scene",
  width: 400,
  height: 300,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#111827",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
} as unknown as MotionComposition;

let bitmapData: Uint8Array;

function setupCanvasStub(): void {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") {
        return { style: {} };
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toBlob: (cb: (blob: Blob) => void) => {
          const bytes = bitmapData;
          cb({
            type: "image/png",
            size: bytes.length,
            arrayBuffer: async () => bytes.slice().buffer,
          } as unknown as Blob);
        },
      };
    },
    body: { append: () => undefined },
  });
}

describe("motion export range / resolution / png-sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bitmapData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    createDownloadWritableMock.mockResolvedValue({ close: vi.fn() });
    initializeMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        readonly bytes: Uint8Array;
        readonly type: string;
        constructor(parts: Array<Uint8Array | ArrayBuffer>, options?: { type?: string }) {
          const chunks = parts.map((part) =>
            part instanceof Uint8Array ? part : new Uint8Array(part),
          );
          const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const merged = new Uint8Array(total);
          let cursor = 0;
          for (const chunk of chunks) {
            merged.set(chunk, cursor);
            cursor += chunk.length;
          }
          this.bytes = merged;
          this.type = options?.type ?? "";
        }
        async arrayBuffer(): Promise<ArrayBuffer> {
          return this.bytes.slice().buffer;
        }
      },
    );
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
    renderMock.mockImplementation(async () => ({
      width: composition.width,
      height: composition.height,
      close: vi.fn(),
    }));
    insertInstanceMock.mockImplementation((project: Project, instance: { duration: number }) => ({
      ...project,
      motionInstances: [instance],
      timeline: { ...project.timeline, duration: instance.duration },
    }));
    exportVideoMock.mockImplementation(async function* () {
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 1,
        totalFrames: 2,
      };
      return {
        success: true,
        stats: { framesRendered: 30 },
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: undefined,
    });
  });

  it("registers png-sequence as a zip/transparent format", () => {
    const descriptor = MOTION_EXPORT_FORMATS.find((entry) => entry.id === "png-sequence");
    expect(descriptor).toBeDefined();
    expect(descriptor?.extension).toBe("zip");
    expect(descriptor?.transparent).toBe(true);
  });

  it("throws INVALID when range start is not before end", async () => {
    await expect(
      exportMotionCompositionScene({
        project: makeProject(),
        composition,
        range: { startTime: 2, endTime: 2 },
      }),
    ).rejects.toThrow(/INVALID/);
  });

  it("scales encoder dimensions with resolutionScale and rounds even", async () => {
    let seenSettings: { width: number; height: number } | null = null;
    exportVideoMock.mockImplementation(async function* (_project: unknown, settings: { width: number; height: number }) {
      seenSettings = settings;
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 1,
        totalFrames: 2,
      };
      return { success: true, stats: { framesRendered: 10 } };
    });

    await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      resolutionScale: 0.5,
    });

    expect(seenSettings).not.toBeNull();
    const resolved = seenSettings as unknown as { width: number; height: number };
    expect(resolved.width).toBe(200);
    expect(resolved.height).toBe(150);
    expect(resolved.width % 2).toBe(0);
    expect(resolved.height % 2).toBe(0);
  });

  it("aborts a canceled export within a few frames and produces no file", async () => {
    let calls = 0;
    const isCanceled = vi.fn(() => calls >= 3);
    renderMock.mockImplementation(async () => {
      calls += 1;
      return { width: composition.width, height: composition.height, close: vi.fn() };
    });
    setupCanvasStub();

    const result = await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "png-sequence",
      isCanceled,
    });

    expect((result as { canceled?: boolean }).canceled).toBe(true);
    expect(renderMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(createDownloadWritableMock).not.toHaveBeenCalled();
  });

  it("aborts the opened writable and terminates the encoder when a video export is canceled mid-run", async () => {
    const abortMock = vi.fn().mockResolvedValue(undefined);
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const writeMock = vi.fn().mockResolvedValue(undefined);
    createDownloadWritableMock.mockResolvedValue({
      abort: abortMock,
      close: closeMock,
      write: writeMock,
    });

    let returnCalled = false;
    let yields = 0;
    exportVideoMock.mockImplementation(() => {
      const iterator = {
        async next() {
          yields += 1;
          return {
            done: false as const,
            value: {
              phase: "rendering",
              progress: 0.1 * yields,
              estimatedTimeRemaining: 1,
              currentFrame: yields,
              totalFrames: 100,
            },
          };
        },
        async return() {
          returnCalled = true;
          return { done: true as const, value: { success: false } };
        },
        async throw() {
          return { done: true as const, value: { success: false } };
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    });

    let calls = 0;
    const isCanceled = vi.fn(() => {
      calls += 1;
      return calls > 3;
    });
    const onProgress = vi.fn();

    const result = await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "mp4",
      isCanceled,
      onProgress,
    });

    expect((result as { canceled?: boolean }).canceled).toBe(true);
    expect(result.framesRendered).toBe(0);
    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(returnCalled).toBe(true);
  });

  it("encodes png-sequence frames at scaled dimensions when resolutionScale < 1", async () => {
    const canvasSizes: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "canvas") {
          return { style: {} };
        }
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: () => undefined }),
          toBlob: (cb: (blob: Blob) => void) => {
            canvasSizes.push({ width: canvas.width, height: canvas.height });
            const bytes = bitmapData;
            cb({
              type: "image/png",
              size: bytes.length,
              arrayBuffer: async () => bytes.slice().buffer,
            } as unknown as Blob);
          },
        };
        return canvas;
      },
      body: { append: () => undefined },
    });
    createDownloadWritableMock.mockImplementation(async () => ({
      write: async () => undefined,
      close: vi.fn(),
    }));

    await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "png-sequence",
      range: { startTime: 0, endTime: 1 },
      resolutionScale: 0.5,
    });

    expect(canvasSizes.length).toBe(30);
    for (const size of canvasSizes) {
      expect(size.width).toBe(200);
      expect(size.height).toBe(150);
    }
  });

  it("encodes png-sequence frames at native composition dimensions when resolutionScale is 1", async () => {
    const canvasSizes: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "canvas") {
          return { style: {} };
        }
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: () => undefined }),
          toBlob: (cb: (blob: Blob) => void) => {
            canvasSizes.push({ width: canvas.width, height: canvas.height });
            const bytes = bitmapData;
            cb({
              type: "image/png",
              size: bytes.length,
              arrayBuffer: async () => bytes.slice().buffer,
            } as unknown as Blob);
          },
        };
        return canvas;
      },
      body: { append: () => undefined },
    });
    createDownloadWritableMock.mockImplementation(async () => ({
      write: async () => undefined,
      close: vi.fn(),
    }));

    await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "png-sequence",
      range: { startTime: 0, endTime: 1 },
    });

    expect(canvasSizes.length).toBe(30);
    for (const size of canvasSizes) {
      expect(size.width).toBe(composition.width);
      expect(size.height).toBe(composition.height);
    }
  });

  it("normalizes a webm-alpha export to H.264 mp4 on web (no native backend)", async () => {
    let seenSettings: { format?: string } | null = null;
    exportVideoMock.mockImplementation(async function* (
      _project: unknown,
      settings: { format?: string },
    ) {
      seenSettings = settings;
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 1,
        totalFrames: 2,
      };
      return { success: true, stats: { framesRendered: 10 } };
    });

    const result = await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "webm-alpha",
    });

    expect(result.encodedFormat).toBe("mp4");
    expect(result.filename.endsWith(".mp4")).toBe(true);
    expect(seenSettings).not.toBeNull();
    expect((seenSettings as unknown as { format?: string }).format).toBe("mp4");
  });

  it("leaves a plain mp4 export format unchanged", async () => {
    exportVideoMock.mockImplementation(async function* () {
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 1,
        totalFrames: 2,
      };
      return { success: true, stats: { framesRendered: 10 } };
    });

    const result = await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "mp4",
    });

    expect(result.encodedFormat).toBe("mp4");
    expect(result.filename.endsWith(".mp4")).toBe(true);
  });

  it("produces a stored ZIP whose central directory lists the range frames with valid CRCs", async () => {
    setupCanvasStub();
    let capturedBytes: Uint8Array | null = null;
    createDownloadWritableMock.mockImplementation(async () => ({
      write: async (chunk: { bytes: Uint8Array }) => {
        capturedBytes = chunk.bytes;
      },
      close: vi.fn(),
    }));

    const result = await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "png-sequence",
      range: { startTime: 0, endTime: 1 },
    });

    expect(result.framesRendered).toBe(30);
    expect(capturedBytes).not.toBeNull();
    const zip = capturedBytes as unknown as Uint8Array;
    const entries = parseCentralDirectory(zip);
    expect(entries).toHaveLength(30);
    expect(entries[0].name).toBe("frame-00001.png");
    expect(entries[29].name).toBe("frame-00030.png");
    const expectedCrc = crc32(bitmapData);
    for (const entry of entries) {
      expect(entry.crc).toBe(expectedCrc);
      expect(entry.size).toBe(bitmapData.length);
    }
  });

  it("offsets the exported motion instance so a non-zero-start video range samples from range.startTime", async () => {
    let seenInstance: { startTime: number; duration: number } | null = null;
    exportVideoMock.mockImplementation(async function* (project: Project) {
      const instances = project.motionInstances ?? [];
      const instance = instances[0] as unknown as {
        startTime: number;
        duration: number;
      };
      seenInstance = { startTime: instance.startTime, duration: instance.duration };
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 1,
        totalFrames: 2,
      };
      return { success: true, stats: { framesRendered: 60 } };
    });

    await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "mp4",
      range: { startTime: 2, endTime: 4 },
    });

    expect(seenInstance).not.toBeNull();
    const resolved = seenInstance as unknown as {
      startTime: number;
      duration: number;
    };
    expect(resolved.startTime).toBe(-2);
    expect(resolved.duration).toBe(4);
  });

  it("leaves a full-range video export instance at startTime 0 and full duration", async () => {
    let seenInstance: { startTime: number; duration: number } | null = null;
    let seenTimelineDuration: number | null = null;
    exportVideoMock.mockImplementation(async function* (project: Project) {
      const instances = project.motionInstances ?? [];
      const instance = instances[0] as unknown as {
        startTime: number;
        duration: number;
      };
      seenInstance = { startTime: instance.startTime, duration: instance.duration };
      seenTimelineDuration = project.timeline.duration;
      yield {
        phase: "rendering",
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 1,
        totalFrames: 2,
      };
      return { success: true, stats: { framesRendered: 150 } };
    });

    await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "mp4",
    });

    expect(seenInstance).not.toBeNull();
    const resolved = seenInstance as unknown as {
      startTime: number;
      duration: number;
    };
    expect(Object.is(resolved.startTime, 0)).toBe(true);
    expect(resolved.duration).toBe(composition.duration);
    expect(seenTimelineDuration).toBe(composition.duration);
  });

  it("clamps a range that exceeds the composition duration", async () => {
    setupCanvasStub();
    let capturedBytes: Uint8Array | null = null;
    createDownloadWritableMock.mockImplementation(async () => ({
      write: async (chunk: { bytes: Uint8Array }) => {
        capturedBytes = chunk.bytes;
      },
      close: vi.fn(),
    }));

    await exportMotionCompositionScene({
      project: makeProject(),
      composition,
      format: "png-sequence",
      range: { startTime: -3, endTime: 999 },
    });

    const zip = capturedBytes as unknown as Uint8Array;
    const entries = parseCentralDirectory(zip);
    expect(entries.length).toBe(Math.round(5 * 30));
  });
});
