import { describe, expect, it, vi } from "vitest";
import { MediaBunnyEngine } from "./mediabunny-engine";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const setup = () => {
  const dispose = vi.fn();
  const conversion = { isValid: true, discardedTracks: [], execute: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) };
  const init = vi.fn().mockResolvedValue(conversion);
  class Input { [Symbol.dispose] = dispose; }
  class Output { target = { buffer: new ArrayBuffer(8) }; }
  const engine = new MediaBunnyEngine();
  vi.spyOn(engine, "initialize").mockResolvedValue();
  Object.assign(engine, { mediabunny: { Input, Output, Conversion: { init }, ALL_FORMATS: [], BlobSource: class {}, BufferTarget: class {}, Mp4OutputFormat: class {}, QUALITY_HIGH: 5, QUALITY_MEDIUM: 3 } });
  return { engine, conversion, init, dispose };
};

describe("MediaBunny proxy conversion lifecycle", () => {
  it("sets explicit codecs and frequent keyframes and releases its input after completion", async () => {
    const { engine, init, dispose } = setup();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    await engine.generateProxy(new Blob(["source"]), undefined, controller.signal, { width: 1280, height: 720, videoCodec: "avc", audioCodec: "aac" });
    expect(init.mock.calls[0][0]).toMatchObject({ video: { width: 1280, height: 720, codec: "avc", keyFrameInterval: 1 }, audio: { codec: "aac" } });
    expect(dispose).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("cancels an initialization that settles after abort and waits before freeing the input", async () => {
    const { engine, conversion, init, dispose } = setup();
    const initialized = deferred<typeof conversion>();
    const cancelled = deferred<void>();
    init.mockReturnValue(initialized.promise);
    conversion.cancel.mockReturnValue(cancelled.promise);
    const controller = new AbortController();
    const pending = engine.generateProxy(new Blob(["source"]), undefined, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce());
    controller.abort();
    initialized.resolve(conversion);
    await vi.waitFor(() => expect(conversion.cancel).toHaveBeenCalledOnce());
    expect(conversion.execute).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    cancelled.resolve();
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("releases input even if conversion setup fails", async () => {
    const { engine, init, dispose } = setup();
    init.mockRejectedValue(new Error("unsupported encoder"));
    await expect(engine.generateProxy(new Blob(["source"]))).rejects.toThrow("unsupported encoder");
    expect(dispose).toHaveBeenCalledOnce();
  });
});
