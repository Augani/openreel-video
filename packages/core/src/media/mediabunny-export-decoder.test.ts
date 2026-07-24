import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportFrameDecoder } from "./mediabunny-engine";

function findFrameAtOrBefore(
  frames: Array<{ timestamp: number }>,
  timestamp: number,
): number {
  let result = 0;
  for (let index = 0; index < frames.length; index++) {
    if (frames[index]!.timestamp > timestamp) break;
    result = index;
  }
  return result;
}

describe("ExportFrameDecoder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes monotonic export requests through one sequential canvas iterator", async () => {
    const drawImage = vi.fn();
    class MockOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { clearRect: vi.fn(), drawImage };
      }
    }
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);

    const frames = [0, 1 / 30, 2 / 30, 3 / 30].map((timestamp) => ({
      canvas: new MockOffscreenCanvas(640, 360),
      timestamp,
      duration: 1 / 30,
    }));
    const getCanvas = vi.fn();
    const canvases = vi.fn((startTimestamp: number) => {
      const startIndex = findFrameAtOrBefore(frames, startTimestamp);
      return (async function* () {
        for (const frame of frames.slice(startIndex)) yield frame;
      })();
    });
    class MockCanvasSink {
      getCanvas = getCanvas;
      canvases = canvases;
    }
    class MockInput {
      async getPrimaryVideoTrack() {
        return {
          displayWidth: 640,
          displayHeight: 360,
          canDecode: vi.fn().mockResolvedValue(true),
        };
      }
    }

    const mediabunny = {
      Input: MockInput,
      ALL_FORMATS: [],
      BlobSource: class {},
      CanvasSink: MockCanvasSink,
    } as unknown as typeof import("mediabunny");
    const decoder = new ExportFrameDecoder(mediabunny, new Blob(["video"]), 640);

    expect(await decoder.initialize()).toBe(true);
    await decoder.getFrame(0);
    await decoder.getFrame(1 / 60);
    await decoder.getFrame(2 / 60);
    await decoder.getFrame(3 / 60);

    expect(canvases).toHaveBeenCalledTimes(1);
    expect(getCanvas).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledTimes(4);
    expect(drawImage).toHaveBeenNthCalledWith(1, frames[0]!.canvas, 0, 0);
    expect(drawImage).toHaveBeenNthCalledWith(2, frames[0]!.canvas, 0, 0);
    expect(drawImage).toHaveBeenNthCalledWith(3, frames[1]!.canvas, 0, 0);
    expect(drawImage).toHaveBeenNthCalledWith(4, frames[1]!.canvas, 0, 0);
  });

  it("starts a new iterator when a later request moves backwards", async () => {
    class MockOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { clearRect: vi.fn(), drawImage: vi.fn() };
      }
    }
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);

    const frames = [0, 1, 2].map((timestamp) => ({
      canvas: new MockOffscreenCanvas(320, 180),
      timestamp,
      duration: 1,
    }));
    const canvases = vi.fn((startTimestamp: number) => {
      const startIndex = findFrameAtOrBefore(frames, startTimestamp);
      return (async function* () {
        for (const frame of frames.slice(startIndex)) yield frame;
      })();
    });
    class MockCanvasSink {
      canvases = canvases;
    }
    class MockInput {
      async getPrimaryVideoTrack() {
        return {
          displayWidth: 320,
          displayHeight: 180,
          canDecode: vi.fn().mockResolvedValue(true),
        };
      }
    }

    const decoder = new ExportFrameDecoder({
      Input: MockInput,
      ALL_FORMATS: [],
      BlobSource: class {},
      CanvasSink: MockCanvasSink,
    } as unknown as typeof import("mediabunny"), new Blob(["video"]));

    await decoder.initialize();
    await decoder.getFrame(1.5);
    await decoder.getFrame(0.25);

    expect(canvases).toHaveBeenNthCalledWith(1, 1.5);
    expect(canvases).toHaveBeenNthCalledWith(2, 0.25);
  });
});
