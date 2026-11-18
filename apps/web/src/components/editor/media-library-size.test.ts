import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";
import {
  getMediaFileSize,
  getMediaLibrarySizeLabel,
} from "./media-library-size";

const media = (
  fileSize: number,
  extra: Partial<MediaItem> = {},
): MediaItem => ({
  id: "source",
  name: "Source.mov",
  type: "video",
  blob: null,
  fileHandle: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    duration: 5,
    width: 1920,
    height: 1080,
    frameRate: 30,
    codec: "h264",
    sampleRate: 48000,
    channels: 2,
    fileSize,
  },
  ...extra,
});

describe("media library source sizes", () => {
  it("counts original bytes once instead of substituting or adding preview bytes", () => {
    const source = media(1024 ** 3, {
      blob: new Blob(["preview"]),
      sourceFile: { name: "Source.mov", size: 1024 ** 3, lastModified: 0 },
    });
    expect(getMediaFileSize(source)).toBe(1024 ** 3);
    expect(getMediaLibrarySizeLabel([source, media(512 * 1024 ** 2)])).toBe(
      "1.50 GB",
    );
  });

  it("recovers legacy sizes from source hints, then actual blobs", () => {
    const source = media(0, {
      blob: new Blob(["preview"]),
      sourceFile: { name: "Source.mov", size: 4096, lastModified: 0 },
    });
    expect(getMediaFileSize(source)).toBe(4096);
    expect(
      getMediaFileSize(media(Number.NaN, { blob: new Blob(["real"]) })),
    ).toBe(4);
    expect(
      getMediaLibrarySizeLabel([
        source,
        media(0, { blob: new Blob([new Uint8Array(1024)]) }),
      ]),
    ).toBe("5.0 KB");
  });

});
