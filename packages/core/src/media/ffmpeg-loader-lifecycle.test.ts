import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { FFmpegFallback } from "./ffmpeg-fallback";

const worker = vi.hoisted(() => ({ load: vi.fn(), terminate: vi.fn(), writeFile: vi.fn(), exec: vi.fn(), readFile: vi.fn(), deleteFile: vi.fn(), on: vi.fn(), off: vi.fn() }));
vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: vi.fn(function () { return worker; }) }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const response = (status = 200) => ({ ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(8) }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
let created: MockInstance<Parameters<typeof URL.createObjectURL>, ReturnType<typeof URL.createObjectURL>>;
let revoked: MockInstance<Parameters<typeof URL.revokeObjectURL>, ReturnType<typeof URL.revokeObjectURL>>;

beforeEach(() => {
  for (const mock of Object.values(worker)) mock.mockReset();
  worker.load.mockResolvedValue(undefined);
  fetchMock = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
  let nextUrl = 0;
  created = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:ffmpeg-${++nextUrl}`);
  revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FFmpeg loader resources", () => {
  it("can retry after cancellation before the dynamically imported worker exists", async () => {
    const fallback = new FFmpegFallback();
    const controller = new AbortController();
    const pending = fallback.load(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(fetchMock).not.toHaveBeenCalled();
    await fallback.load();
    expect(fallback.isLoaded()).toBe(true);
  });
  it("releases both downloaded Blob URLs after a successful worker load and removes abort listeners", async () => {
    const fallback = new FFmpegFallback();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    await fallback.load(controller.signal);
    expect(fallback.isLoaded()).toBe(true);
    expect(worker.load).toHaveBeenCalledWith({ coreURL: "blob:ffmpeg-1", wasmURL: "blob:ffmpeg-2" });
    expect(revoked.mock.calls).toEqual([["blob:ffmpeg-1"], ["blob:ffmpeg-2"]]);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("cleans a completed download when its sibling fails and allows retry", async () => {
    const wasm = deferred<Response>();
    fetchMock.mockImplementation((url: string) => url.endsWith(".wasm") ? wasm.promise : Promise.resolve(response()));
    const fallback = new FFmpegFallback();
    const pending = fallback.load();
    const rejected = expect(pending).rejects.toThrow("FFmpeg download failed (503)");
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce());
    wasm.resolve(response(503));
    await rejected;
    expect(revoked).toHaveBeenCalledWith("blob:ffmpeg-1");
    expect(worker.load).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(fallback.isLoaded()).toBe(false);
    fetchMock.mockResolvedValue(response());
    await fallback.load();
    expect(fallback.isLoaded()).toBe(true);
    expect(revoked).toHaveBeenCalledTimes(3);
  });

  it("cancels a proxy during download, releases completed URLs, and never starts encoding", async () => {
    let downloadSignal!: AbortSignal;
    fetchMock.mockImplementation((url: string, options: { signal?: AbortSignal | null }) => {
      if (!url.endsWith(".wasm")) return Promise.resolve(response());
      downloadSignal = options.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => downloadSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const fallback = new FFmpegFallback();
    const controller = new AbortController();
    const pending = fallback.generateProxy(new Blob(["source"]), {}, undefined, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(downloadSignal.aborted).toBe(true);
    expect(revoked).toHaveBeenCalledWith("blob:ffmpeg-1");
    expect(worker.load).not.toHaveBeenCalled();
    expect(worker.exec).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancels deferred worker initialization and releases all download URLs", async () => {
    const initialization = deferred<void>();
    worker.load.mockReturnValue(initialization.promise);
    worker.terminate.mockImplementation(() => initialization.reject(new Error("terminated")));
    const fallback = new FFmpegFallback();
    const controller = new AbortController();
    const pending = fallback.generateProxy(new Blob(["source"]), {}, undefined, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(worker.load).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(revoked).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.exec).not.toHaveBeenCalled();
    expect(fallback.isLoaded()).toBe(false);
  });

  it("terminating an owner without a caller signal cancels its downloads", async () => {
    let downloadSignal!: AbortSignal;
    fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal | null }) => {
      downloadSignal = options.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => downloadSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const fallback = new FFmpegFallback();
    const pending = fallback.load();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fallback.terminate();
    await rejected;
    expect(downloadSignal.aborted).toBe(true);
    expect(created).not.toHaveBeenCalled();
    expect(fallback.isLoaded()).toBe(false);
  });
});
