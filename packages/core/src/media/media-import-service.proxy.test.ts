import { describe, expect, it, vi } from "vitest";
import { MediaImportService } from "./media-import-service";
import type { MediaBunnyEngine } from "./mediabunny-engine";
import type { FFmpegFallback } from "./ffmpeg-fallback";

vi.mock("./native-media-bridge", () => ({ nativeMediaAvailable: () => false }));
const setup = (width = 1920, height = 1080) => {
  const proxy = new Blob(["proxy"]);
  const engine = {
    isAvailable: () => true,
    generateProxy: vi.fn().mockResolvedValue(proxy),
    extractMetadata: vi.fn().mockImplementation(async (blob: Blob) => blob === proxy ? { width: 1280, height: 720, hasVideo: true, canDecode: true } : { width, height, hasVideo: true, canDecode: true }),
  };
  const fallback = { generateProxy: vi.fn().mockResolvedValue(new Blob(["fallback"])) };
  return { proxy, engine, fallback, service: new MediaImportService(engine as unknown as MediaBunnyEngine, fallback as unknown as FFmpegFallback) };
};

describe("browser proxy preset generation", () => {
  it.each([ ["low", 960, 540], ["medium", 1280, 720], ["high", 1920, 1080] ] as const)("prefers MediaBunny and caps %s dimensions without extra scaling", async (preset, width, height) => {
    const { service, engine, fallback, proxy } = setup();
    const source = new Blob(["source"]);
    const progress = vi.fn();
    const controller = new AbortController();
    expect(await service.generateProxyWithPreset(source, preset, progress, controller.signal)).toBe(proxy);
    expect(engine.generateProxy).toHaveBeenCalledWith(source, progress, controller.signal, expect.objectContaining({ width, height, videoCodec: "avc", audioCodec: "aac" }));
    expect(fallback.generateProxy).not.toHaveBeenCalled();
  });

  it("preserves portrait aspect and never upscales small videos", async () => {
    const portrait = setup(1080, 1920);
    await portrait.service.generateProxyWithPreset(new Blob(["source"]), "medium");
    expect(portrait.engine.generateProxy.mock.calls[0][3]).toMatchObject({ width: 404, height: 720 });
    const small = setup(640, 360);
    await small.service.generateProxyWithPreset(new Blob(["source"]), "high");
    expect(small.engine.generateProxy.mock.calls[0][3]).toMatchObject({ width: 640, height: 360 });
  });

  it("does not start software fallback after cancelling hardware generation", async () => {
    const { service, engine, fallback } = setup();
    const controller = new AbortController();
    engine.generateProxy.mockImplementation(async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); });
    await expect(service.generateProxyWithPreset(new Blob(["source"]), "medium", undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback.generateProxy).not.toHaveBeenCalled();
  });

  it("falls back when the browser generates an unplayable video and forwards cancellation", async () => {
    const { service, engine, fallback, proxy } = setup();
    engine.extractMetadata.mockImplementation(async (blob: Blob) => ({ width: 1920, height: 1080, hasVideo: true, canDecode: blob !== proxy }));
    const source = new Blob(["source"]);
    const controller = new AbortController();
    await service.generateProxyWithPreset(source, "low", undefined, controller.signal);
    expect(fallback.generateProxy).toHaveBeenCalledWith(source, expect.objectContaining({ maxHeight: 540, scale: 1 }), undefined, controller.signal);
  });

  it("does not mistake playable proxy audio for a decodable video track", async () => {
    const { service, engine, fallback } = setup();
    engine.extractMetadata.mockResolvedValue({ width: 1920, height: 1080, hasVideo: true, canDecode: true, canDecodeVideo: false });
    await service.generateProxyWithPreset(new Blob(["source"]), "medium");
    expect(fallback.generateProxy).toHaveBeenCalledOnce();
  });
});
