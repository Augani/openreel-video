import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { thumbnailsNeedRefresh } from "@openreel/core/media/interpretation";
import { createMissingMediaItem, restoreMediaItem } from "./media-recovery";

const anamorphic = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "v1", name: "v1.mp4", type: "video", fileHandle: null, blob: null,
  metadata: { duration: 5, width: 1440, height: 1080, frameRate: 25, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 },
  thumbnailUrl: "data:image/jpeg;base64,stretched", waveformData: null,
  interpretation: { pixelAspectRatio: 4 / 3 },
  thumbnailPixelAspect: 4 / 3,
  ...extra,
});

describe("thumbnail marker cannot outlive its frames", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("restoreMediaItem drops the marker when it regenerates a (square) thumbnail, so it is refreshed", async () => {
    vi.useFakeTimers();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => "blob:x" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });
    const pending = restoreMediaItem(anamorphic({ thumbnailUrl: "blob:old" }), new Blob(["v"]));
    await vi.advanceTimersByTimeAsync(6000);
    const restored = await pending;
    expect("thumbnailPixelAspect" in restored).toBe(false);
    expect(thumbnailsNeedRefresh(restored)).toBe(true);
  });

  it("restoreMediaItem keeps the marker when the stretched thumbnail is kept", async () => {
    const restored = await restoreMediaItem(anamorphic(), new Blob(["v"]));
    expect(restored.thumbnailPixelAspect).toBe(4 / 3);
    expect(thumbnailsNeedRefresh(restored)).toBe(false);
  });

  it("createMissingMediaItem drops the marker with a discarded blob: thumbnail", () => {
    const missing = createMissingMediaItem(anamorphic({ thumbnailUrl: "blob:old" }));
    expect(missing.thumbnailUrl).toBeNull();
    expect("thumbnailPixelAspect" in missing).toBe(false);
  });
});
