import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_ATTEMPTS, captureNativeVideoFrame, decodeFrameWithWebCodecs, waitForDrawableFrame } from "./video-frame";

const notUsable = () => new DOMException("The image source is not usable.", "InvalidStateError");

function fakeVideo(readyState: number) {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { configurable: true, get: () => readyState });
  return {
    video,
    setReady(next: number) {
      readyState = next;
    },
  };
}

describe("captureNativeVideoFrame", () => {
  const bitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn();
    vi.stubGlobal("createImageBitmap", create);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("captures a ready frame in one call", async () => {
    const { video } = fakeVideo(4);
    create.mockResolvedValueOnce(bitmap);
    await expect(captureNativeVideoFrame(video)).resolves.toBe(bitmap);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("waits for a not-yet-drawable frame and retries instead of failing", async () => {
    const f = fakeVideo(1);
    create.mockRejectedValueOnce(notUsable()).mockResolvedValueOnce(bitmap);
    const pending = captureNativeVideoFrame(f.video);
    // Frame becomes drawable: the element fires loadeddata.
    f.setReady(2);
    f.video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    f.video.dispatchEvent(new Event("seeked"));
    await expect(pending).resolves.toBe(bitmap);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("allows presentation to catch up when a ready element still has no current frame", async () => {
    vi.useFakeTimers();
    const { video } = fakeVideo(2);
    let presented = false;
    create.mockImplementation(async () => {
      if (!presented) throw notUsable();
      return bitmap;
    });
    const pending = captureNativeVideoFrame(video);
    setTimeout(() => { presented = true; }, 16);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(bitmap);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded number of attempts and rethrows", async () => {
    vi.useFakeTimers();
    const { video } = fakeVideo(4);
    create.mockRejectedValue(notUsable());
    const pending = captureNativeVideoFrame(video);
    const assertion = expect(pending).rejects.toThrow("not usable");
    await vi.runAllTimersAsync();
    await assertion;
    expect(create).toHaveBeenCalledTimes(CAPTURE_ATTEMPTS);
  });

  it("does not retry other errors", async () => {
    const { video } = fakeVideo(4);
    create.mockRejectedValueOnce(new TypeError("bad source"));
    await expect(captureNativeVideoFrame(video)).rejects.toThrow("bad source");
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("waitForDrawableFrame", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when a frame is drawable", async () => {
    await expect(waitForDrawableFrame(fakeVideo(2).video)).resolves.toBeUndefined();
  });

  it("resolves on timeout when no event arrives, and removes its listeners", async () => {
    vi.useFakeTimers();
    const { video } = fakeVideo(0);
    const remove = vi.spyOn(video, "removeEventListener");
    const pending = waitForDrawableFrame(video, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(3);
  });
});

const mediabunny = vi.hoisted(() => ({
  canDecode: vi.fn(async () => true),
  getCanvas: vi.fn(),
  dispose: vi.fn(),
  hasTrack: true,
}));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {
    constructor(readonly blob: Blob) {}
  },
  Input: class {
    getPrimaryVideoTrack = async () => (mediabunny.hasTrack ? { canDecode: mediabunny.canDecode } : null);
    [Symbol.dispose] = mediabunny.dispose;
  },
  CanvasSink: class {
    getCanvas = mediabunny.getCanvas;
  },
}));

describe("decodeFrameWithWebCodecs", () => {
  const bitmap = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
  beforeEach(() => {
    mediabunny.hasTrack = true;
    mediabunny.canDecode.mockResolvedValue(true);
    mediabunny.getCanvas.mockReset();
    mediabunny.dispose.mockReset();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes the frame at the requested time and disposes the input", async () => {
    mediabunny.getCanvas.mockResolvedValue({ canvas: document.createElement("canvas"), timestamp: 1, duration: 1 / 30 });
    await expect(decodeFrameWithWebCodecs(new Blob(["x"]), 1.25)).resolves.toBe(bitmap);
    expect(mediabunny.getCanvas).toHaveBeenCalledWith(1.25);
    expect(mediabunny.dispose).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no decodable video track, still disposing", async () => {
    mediabunny.canDecode.mockResolvedValue(false);
    await expect(decodeFrameWithWebCodecs(new Blob(["x"]), 0)).resolves.toBeNull();
    mediabunny.hasTrack = false;
    await expect(decodeFrameWithWebCodecs(new Blob(["x"]), 0)).resolves.toBeNull();
    expect(mediabunny.getCanvas).not.toHaveBeenCalled();
    expect(mediabunny.dispose).toHaveBeenCalledTimes(2);
  });

  it("clamps negative times to zero", async () => {
    mediabunny.getCanvas.mockResolvedValue(null);
    await expect(decodeFrameWithWebCodecs(new Blob(["x"]), -0.5)).resolves.toBeNull();
    expect(mediabunny.getCanvas).toHaveBeenCalledWith(0);
  });
});
