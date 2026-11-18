import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeCanvasSink,
  NativeExportFrameDecoder,
  claimNativeSource,
  hasNativeFrameProvider,
  registerNativeFrameProvider,
  type NativeFrameProvider,
  type NativeSourceInfo,
} from "./native-frame-source";

const source: NativeSourceInfo = { id: "/clips/a.mov", width: 1920, height: 1080, frameRate: 24, duration: 4, codec: "prores" };
const canvas = { width: 640, height: 360 } as unknown as OffscreenCanvas;

function provider(over: Partial<NativeFrameProvider> = {}): NativeFrameProvider {
  return {
    claim: vi.fn(async () => source),
    getFrame: vi.fn(async (_source, time) => ({ canvas, timestamp: Math.floor(time * 24) / 24, duration: 1 / 24 })),
    ...over,
  };
}

afterEach(() => registerNativeFrameProvider(null));

describe("native frame source registry", () => {
  it("claims nothing without a provider, so WebCodecs keeps handling everything (web build)", async () => {
    expect(hasNativeFrameProvider()).toBe(false);
    expect(await claimNativeSource(new Blob(["x"]))).toBeNull();
  });

  it("asks the provider once per Blob and remembers the answer", async () => {
    const p = provider();
    registerNativeFrameProvider(p);
    const blob = new Blob(["x"]);
    expect(await claimNativeSource(blob)).toEqual(source);
    expect(await claimNativeSource(blob)).toEqual(source);
    expect(p.claim).toHaveBeenCalledTimes(1);
    await claimNativeSource(new Blob(["y"]));
    expect(p.claim).toHaveBeenCalledTimes(2);
  });

  it("treats a provider failure as 'not native' rather than breaking import", async () => {
    registerNativeFrameProvider(provider({ claim: vi.fn(async () => { throw new Error("ipc down"); }) }));
    expect(await claimNativeSource(new Blob(["x"]))).toBeNull();
  });

  it("forgets earlier claims when the provider changes", async () => {
    const blob = new Blob(["x"]);
    registerNativeFrameProvider(provider());
    expect(await claimNativeSource(blob)).toEqual(source);
    registerNativeFrameProvider(provider({ claim: vi.fn(async () => null) }));
    expect(await claimNativeSource(blob)).toBeNull();
  });
});

describe("native sinks", () => {
  it("the preview sink asks for preview quality at the requested width", async () => {
    const p = provider();
    registerNativeFrameProvider(p);
    const frame = await new NativeCanvasSink(source, { width: 960, quality: "preview" }).getCanvas(1.5);
    expect(frame?.timestamp).toBeCloseTo(1.5, 6);
    expect(p.getFrame).toHaveBeenCalledWith(source, 1.5, { width: 960, quality: "preview" });
  });

  it("export decodes at full quality, at the export width", async () => {
    const p = provider();
    registerNativeFrameProvider(p);
    const decoder = new NativeExportFrameDecoder(source, 1280);
    expect(await decoder.getFrame(2)).toBe(canvas);
    expect(p.getFrame).toHaveBeenCalledWith(source, 2, { width: 1280, quality: "full" });
    decoder.dispose();
  });

  it("returns null when the provider is gone", async () => {
    expect(await new NativeExportFrameDecoder(source).getFrame(0)).toBeNull();
    expect(await new NativeCanvasSink(source).getCanvas(0)).toBeNull();
  });
});
