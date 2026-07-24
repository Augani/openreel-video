import { describe, expect, it } from "vitest";
import type { MediaItem } from "../types/project";
import {
  createMotionImageAssetFromMediaItem,
  createMotionImageLayerFromAsset,
} from "./motion-assets";

const makeImageItem = (): MediaItem => ({
  id: "media-1",
  name: "Product Shot.png",
  type: "image",
  fileHandle: null,
  blob: null,
  metadata: {
    duration: 0,
    width: 1440,
    height: 900,
    frameRate: 0,
    codec: "png",
    sampleRate: 0,
    channels: 0,
    fileSize: 1024,
  },
  thumbnailUrl: null,
  waveformData: null,
});

describe("motion assets", () => {
  it("creates image assets from project media items", () => {
    const asset = createMotionImageAssetFromMediaItem(makeImageItem());

    expect(asset).toMatchObject({
      id: "motion-asset-media-1",
      type: "image",
      name: "Product Shot.png",
      mediaId: "media-1",
      width: 1440,
      height: 900,
    });
  });

  it("creates centered image layers from image assets", () => {
    const asset = createMotionImageAssetFromMediaItem(makeImageItem());
    const layer = createMotionImageLayerFromAsset(asset, {
      id: "layer-1",
      duration: 6,
      compositionWidth: 1920,
      compositionHeight: 1080,
    });

    expect(layer).toMatchObject({
      id: "layer-1",
      type: "image",
      name: "Product Shot.png",
      duration: 6,
      assetId: asset.id,
      width: 1440,
      height: 900,
      fit: "contain",
      transform: {
        position: { x: 960, y: 540 },
      },
    });
  });

  it("rejects non-image media for image assets", () => {
    const item = { ...makeImageItem(), type: "video" as const };

    expect(() => createMotionImageAssetFromMediaItem(item)).toThrow(
      "Cannot create a motion image asset",
    );
  });
});
