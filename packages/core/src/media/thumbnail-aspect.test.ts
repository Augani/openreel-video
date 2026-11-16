import { describe, expect, it } from "vitest";
import { thumbnailSizeFor, thumbnailsNeedRefresh } from "./interpretation";

const meta = { duration: 1, width: 1440, height: 1080, frameRate: 25, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 };
const legacy = { type: "video" as const, metadata: meta };

describe("thumbnail display aspect", () => {
  it("a 1440x1080 PAR 4/3 clip yields a 16:9 thumbnail; square pixels keep the stored aspect", () => {
    expect(thumbnailSizeFor(1440, 1080, 4 / 3, 160)).toEqual({ width: 160, height: 90 });
    expect(thumbnailSizeFor(1440, 1080, 1, 160)).toEqual({ width: 160, height: 120 });
    expect(thumbnailSizeFor(1920, 1080, 1, 160)).toEqual({ width: 160, height: 90 });
  });

  it("flags thumbnails stale only when the effective pixel aspect differs from the one they were made for", () => {
    expect(thumbnailsNeedRefresh(legacy)).toBe(false);
    expect(thumbnailsNeedRefresh({ ...legacy, interpretation: { pixelAspectRatio: 4 / 3 } })).toBe(true);
    expect(thumbnailsNeedRefresh({ ...legacy, metadata: { ...meta, pixelAspectRatio: 4 / 3 } })).toBe(true);
    expect(thumbnailsNeedRefresh({ ...legacy, thumbnailUrl: "data:x", interpretation: { pixelAspectRatio: 4 / 3 }, thumbnailPixelAspect: 4 / 3 })).toBe(false);
    expect(thumbnailsNeedRefresh({ ...legacy, thumbnailUrl: "data:x", thumbnailPixelAspect: 4 / 3 })).toBe(true);
    expect(thumbnailsNeedRefresh({ ...legacy, type: "audio" as never, interpretation: { pixelAspectRatio: 2 } } as never)).toBe(false);
  });

  it("ignores a stale marker when the frames it described are gone (null or transient blob thumbnail)", () => {
    const anamorphic = { ...legacy, interpretation: { pixelAspectRatio: 4 / 3 }, thumbnailPixelAspect: 4 / 3 };
    expect(thumbnailsNeedRefresh({ ...anamorphic, thumbnailUrl: "data:image/jpeg;base64,x" })).toBe(false);
    expect(thumbnailsNeedRefresh({ ...anamorphic, thumbnailUrl: null })).toBe(true);
    expect(thumbnailsNeedRefresh({ ...anamorphic, thumbnailUrl: "blob:abc" })).toBe(true);
  });
});
