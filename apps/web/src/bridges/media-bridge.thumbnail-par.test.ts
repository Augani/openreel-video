import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaBridge } from "./media-bridge";

function stubDom(videoWidth: number, videoHeight: number) {
  const canvases: { width: number; height: number; draws: number[][] }[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "video") {
      const listeners = new Map<string, () => void>();
      return {
        videoWidth,
        videoHeight,
        duration: 1,
        currentTime: 0,
        muted: false,
        playsInline: false,
        preload: "",
        src: "",
        removeAttribute: () => undefined,
        load: () => undefined,
        addEventListener: (name: string, fn: () => void) => {
          listeners.set(name, fn);
          if (name === "loadedmetadata" || name === "seeked") setTimeout(() => listeners.get(name)?.(), 0);
        },
        removeEventListener: () => undefined,
      } as unknown as HTMLVideoElement;
    }
    if (tag === "canvas") {
      const record = { width: 0, height: 0, draws: [] as number[][] };
      canvases.push(record);
      return {
        get width() { return record.width; },
        set width(v: number) { record.width = v; },
        get height() { return record.height; },
        set height(v: number) { record.height = v; },
        getContext: () => ({
          fillStyle: "",
          fillRect: () => undefined,
          drawImage: (_v: unknown, x: number, y: number, w: number, h: number) => record.draws.push([x, y, w, h]),
        }),
        toDataURL: () => "data:image/jpeg;base64,x",
      } as unknown as HTMLCanvasElement;
    }
    return realCreate(tag);
  }) as typeof document.createElement);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => "blob:x" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });
  return canvases;
}

describe("anamorphic thumbnail drawing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("stretches a 1440x1080 PAR 4/3 clip to a 160x90 (16:9) canvas and draws the frame into it", async () => {
    const canvases = stubDom(1440, 1080);
    const thumbs = await new MediaBridge().generateThumbnailsForMedia(new Blob(["v"]), "video", { pixelAspect: 4 / 3 });
    expect(thumbs.length).toBe(10);
    expect(canvases[0].width).toBe(160);
    expect(canvases[0].height).toBe(90);
    expect(canvases[0].draws.every(([x, y, w, h]) => x === 0 && y === 0 && w === 160 && h === 90)).toBe(true);
  });

  it("keeps the stored 4:3 aspect (160x120) for the same clip at square pixels", async () => {
    const canvases = stubDom(1440, 1080);
    // Square pixels take the import-service path when initialized; here it is not, so use the element path directly.
    const bridge = new MediaBridge() as unknown as {
      generateVideoElementThumbnails(f: Blob, c: number, w: number, p: number): Promise<unknown[]>;
    };
    await bridge.generateVideoElementThumbnails(new Blob(["v"]), 2, 160, 1);
    expect(canvases[0].height).toBe(120);
  });
});
