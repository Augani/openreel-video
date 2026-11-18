import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conformBitmap } from "./deinterlace";
import { VideoEngine } from "./video-engine";

// The parallel decoder module evaluates a Web Worker body on import; the fallback under test never uses it.
vi.mock("./parallel-frame-decoder", () => ({ ParallelFrameDecoder: class {} }));
import type { FrameConform } from "../media/interpretation";

interface DrawCall {
  readonly source: unknown;
  readonly args: number[];
}

/** Minimal 2D canvas recording what is drawn into it and holding pixels for get/putImageData. */
class FakeCanvas {
  readonly draws: DrawCall[] = [];
  pixels: Uint8ClampedArray;
  imageSmoothingQuality = "low";
  imageSmoothingEnabled = true;
  fillStyle = "";
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext(): FakeCanvas {
    return this;
  }
  drawImage(source: unknown, ...args: number[]): void {
    this.draws.push({ source, args });
    const src = source as { pixelData?: Uint8ClampedArray; width?: number };
    if (src.pixelData && src.width === this.width) this.pixels = new Uint8ClampedArray(src.pixelData);
  }
  fillRect(): void {}
  getImageData(): { width: number; height: number; data: Uint8ClampedArray } {
    return { width: this.width, height: this.height, data: new Uint8ClampedArray(this.pixels) };
  }
  putImageData(image: { data: Uint8ClampedArray }): void {
    this.pixels = new Uint8ClampedArray(image.data);
  }
  get pixelData(): Uint8ClampedArray {
    return this.pixels;
  }
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

interface FakeBitmap {
  width: number;
  height: number;
  pixelData: Uint8ClampedArray;
  close: ReturnType<typeof vi.fn>;
}

function bitmap(width: number, height: number, rowValue: (y: number) => number): FakeBitmap {
  const pixelData = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixelData.fill(rowValue(y), (y * width + x) * 4, (y * width + x) * 4 + 3);
  return { width, height, pixelData, close: vi.fn() };
}

beforeEach(() => {
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal("createImageBitmap", async (source: { width: number; height: number; pixelData?: Uint8ClampedArray }) => ({
    width: source.width,
    height: source.height,
    pixelData: source.pixelData,
    close: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const anamorphic: FrameConform = { pixelAspect: 4 / 3, fieldOrder: "progressive", deinterlace: "none" };

describe("conformBitmap", () => {
  it("stretches an anamorphic 1440x1080 frame to a 1920x1080 display frame", async () => {
    const frame = bitmap(1440, 1080, () => 10);
    const out = await conformBitmap(frame as unknown as ImageBitmap, anamorphic);
    expect(out).not.toBe(frame);
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    // The caller keeps ownership of the input.
    expect(frame.close).not.toHaveBeenCalled();
  });

  it("returns the very same bitmap when nothing applies", async () => {
    const frame = bitmap(8, 8, () => 10);
    const out = await conformBitmap(frame as unknown as ImageBitmap, { pixelAspect: 1, fieldOrder: "progressive", deinterlace: "none" });
    expect(out).toBe(frame);
  });

  it("deinterlaces a combed interlaced frame before handing it back", async () => {
    const frame = bitmap(4, 6, (y) => (y % 2 === 0 ? 200 : 40));
    const out = (await conformBitmap(frame as unknown as ImageBitmap, { pixelAspect: 1, fieldOrder: "upper", deinterlace: "blend" })) as unknown as FakeBitmap;
    expect(out).not.toBe(frame);
    const rows = Array.from({ length: 6 }, (_, y) => out.pixelData[y * 4 * 4]);
    expect(rows).toEqual([120, 120, 120, 120, 120, 120]);
  });

  it("applies both: output is display width and deinterlaced height", async () => {
    const frame = bitmap(4, 6, (y) => (y % 2 === 0 ? 200 : 40));
    const out = await conformBitmap(frame as unknown as ImageBitmap, { pixelAspect: 2, fieldOrder: "lower", deinterlace: "bob" });
    expect(out.width).toBe(8);
    expect(out.height).toBe(6);
  });

  it("leaves the frame alone when there is no canvas support", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const frame = bitmap(4, 4, () => 1);
    expect(await conformBitmap(frame as unknown as ImageBitmap, anamorphic)).toBe(frame);
  });
});

describe("VideoEngine video-element fallback", () => {
  function engineWithVideo(videoWidth: number, videoHeight: number): VideoEngine {
    const engine = new VideoEngine();
    const video = {
      videoWidth,
      videoHeight,
      width: videoWidth,
      height: videoHeight,
      currentTime: 0,
      readyState: 4,
      addEventListener: () => {},
      removeEventListener: () => {},
      pixelData: new Uint8ClampedArray(videoWidth * videoHeight * 4),
    };
    (engine as unknown as { videoElementCache: Map<string, unknown> }).videoElementCache.set("m", { video, url: "blob:x" });
    return engine;
  }
  const lastDraw = (engine: VideoEngine): number[] =>
    (engine as unknown as { decodeCanvas: FakeCanvas }).decodeCanvas.draws.at(-1)!.args;

  it("draws an anamorphic frame at display aspect into a 1920x1080 canvas", async () => {
    const engine = engineWithVideo(1440, 1080);
    await engine.decodeFrameWithVideoElement("m", new Blob(), 0, 1920, 1080, anamorphic);
    // 1440x1080 at PAR 4/3 is 1920x1080: it fills the 16:9 canvas exactly.
    expect(lastDraw(engine)).toEqual([0, 0, 1920, 1080]);
  });

  it("without a conform the same clip is pillarboxed at its stored 4:3 shape", async () => {
    const engine = engineWithVideo(1440, 1080);
    await engine.decodeFrameWithVideoElement("m", new Blob(), 0, 1920, 1080);
    expect(lastDraw(engine)).toEqual([240, 0, 1440, 1080]);
  });
});
