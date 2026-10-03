import { describe, expect, it, vi } from "vitest";
import { FFmpegFallback } from "./ffmpeg-fallback";

const setup = () => {
  const fallback = new FFmpegFallback();
  vi.spyOn(fallback, "load").mockResolvedValue();
  const ffmpeg = { writeFile: vi.fn().mockResolvedValue(undefined), exec: vi.fn().mockResolvedValue(0), readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2])), deleteFile: vi.fn().mockResolvedValue(undefined), on: vi.fn(), off: vi.fn(), terminate: vi.fn() };
  Object.assign(fallback, { ffmpeg, loaded: true });
  return { fallback, ffmpeg };
};

describe("isolated software proxy cancellation", () => {
  it("terminates its own worker on abort, removes the listener and reports cancellation", async () => {
    const { fallback, ffmpeg } = setup();
    let reject!: (error: Error) => void;
    ffmpeg.exec.mockImplementation(() => new Promise<number>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    ffmpeg.terminate.mockImplementation(() => reject(new Error("worker terminated")));
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const pending = fallback.generateProxy(new Blob(["source"]), {}, undefined, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(ffmpeg.exec).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(ffmpeg.terminate).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("writes seek-friendly keyframes and removes temporary files after completion", async () => {
    const { fallback, ffmpeg } = setup();
    const controller = new AbortController();
    await fallback.generateProxy(new Blob(["source"]), {}, undefined, controller.signal);
    expect(ffmpeg.exec.mock.calls[0][0]).toEqual(expect.arrayContaining(["-force_key_frames", "expr:gte(t,n_forced*1)"]));
    expect(ffmpeg.deleteFile).toHaveBeenCalledWith("input");
    expect(ffmpeg.deleteFile).toHaveBeenCalledWith("proxy.mp4");
    controller.abort();
    expect(ffmpeg.terminate).not.toHaveBeenCalled();
  });
});
