import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompressionPlan } from "@openreel/core";
import { probeCompressionSource, runCompression } from "./video-compressor";
const engine = vi.hoisted(() => ({
  initialize: vi.fn(),
  extractMetadata: vi.fn(),
  convertMedia: vi.fn(),
}));
vi.mock("@openreel/core", () => ({ getMediaEngine: () => engine }));
const meta = {
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
  duration: 60,
  frameRate: 30,
};
const plan: CompressionPlan = {
  width: 1280,
  height: 720,
  frameRate: 30,
  videoBitrateKbps: 1800,
  audioBitrateKbps: 128,
  codec: "h264",
  container: "mp4",
};
const file = new Blob(["video"]);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  engine.initialize.mockResolvedValue(undefined);
  engine.extractMetadata.mockResolvedValue({ ...meta });
  engine.convertMedia.mockResolvedValue(new Blob(["encoded"]));
});
describe("compression metadata", () => {
  it("retains dimensions, duration, audio and frame rate", async () => {
    expect(await probeCompressionSource(file)).toEqual({
      width: 1920,
      height: 1080,
      durationSec: 60,
      hasAudio: true,
      frameRate: 30,
    });
    expect(engine.extractMetadata).toHaveBeenCalledWith(file);
  });
  it.each([{ width: NaN }, { duration: 0 }, { hasVideo: false }])(
    "rejects unusable metadata %j",
    async (change) => {
      engine.extractMetadata.mockResolvedValue({ ...meta, ...change });
      expect(await probeCompressionSource(file)).toBeNull();
    },
  );
  it("does not begin an already cancelled probe", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      probeCompressionSource(file, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.initialize).not.toHaveBeenCalled();
    expect(engine.extractMetadata).not.toHaveBeenCalled();
  });
  it("does not extract metadata after cancellation during initialization", async () => {
    const init = deferred<void>();
    engine.initialize.mockReturnValueOnce(init.promise);
    const controller = new AbortController();
    const result = probeCompressionSource(file, controller.signal);
    const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    init.resolve();
    await check;
    expect(engine.extractMetadata).not.toHaveBeenCalled();
  });
  it("rejects late metadata from a cancelled probe", async () => {
    const pending = deferred<typeof meta>();
    engine.extractMetadata.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const result = probeCompressionSource(file, controller.signal);
    await vi.waitFor(() =>
      expect(engine.extractMetadata).toHaveBeenCalledOnce(),
    );
    const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    pending.resolve(meta);
    await check;
  });
});
describe("compression encoding adapter", () => {
  it("forwards MP4 AVC/AAC options, exact bitrate units, progress and signal", async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const output = new Blob(["result"]);
    engine.convertMedia.mockResolvedValueOnce(output);
    expect(await runCompression(file, plan, progress, controller.signal)).toBe(
      output,
    );
    expect(engine.convertMedia).toHaveBeenCalledWith(
      file,
      {
        format: "mp4",
        videoCodec: "avc",
        audioCodec: "aac",
        width: 1280,
        height: 720,
        frameRate: 30,
        videoBitrate: 1800000,
        audioBitrate: 128000,
      },
      expect.any(Function),
      controller.signal,
    );
    engine.convertMedia.mock.calls[0][2]({ progress: 0.4 });
    expect(progress).toHaveBeenCalledWith(0.4);
  });
  it("preserves video-only sources without forcing an audio bitrate", async () => {
    await runCompression(file, { ...plan, audioBitrateKbps: 0 });
    expect(engine.convertMedia.mock.calls[0][1].audioBitrate).toBeUndefined();
    expect(engine.convertMedia.mock.calls[0][2]).toBeUndefined();
  });
  it("does not initialize an already cancelled encode", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runCompression(file, plan, undefined, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.initialize).not.toHaveBeenCalled();
  });
  it("does not start conversion after cancelled initialization", async () => {
    const init = deferred<void>();
    engine.initialize.mockReturnValueOnce(init.promise);
    const controller = new AbortController();
    const result = runCompression(file, plan, undefined, controller.signal);
    const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    init.resolve();
    await check;
    expect(engine.convertMedia).not.toHaveBeenCalled();
  });
  it("suppresses cancelled progress and rejects a late converter success", async () => {
    const pending = deferred<Blob>();
    engine.convertMedia.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const progress = vi.fn();
    const result = runCompression(file, plan, progress, controller.signal);
    await vi.waitFor(() => expect(engine.convertMedia).toHaveBeenCalledOnce());
    const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    engine.convertMedia.mock.calls[0][2]({ progress: 0.9 });
    pending.resolve(new Blob());
    await check;
    expect(progress).not.toHaveBeenCalled();
  });
});
