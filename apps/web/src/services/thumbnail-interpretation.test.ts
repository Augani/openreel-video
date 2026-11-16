import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { refreshStaleThumbnails, resetThumbnailRefreshState } from "./thumbnail-interpretation";

const blob = new Blob(["v"]);
const video = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "m1", name: "m1.mp4", type: "video", fileHandle: null, blob,
  metadata: { duration: 5, width: 1440, height: 1080, frameRate: 25, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 },
  thumbnailUrl: "old-0", waveformData: null,
  filmstripThumbnails: [{ timestamp: 0, url: "old-0" }],
  ...extra,
});
function harness(item: MediaItem) {
  let project: Project = { ...createEmptyProject("T"), mediaLibrary: { items: [item] } };
  const handle = { getProject: () => project, setProject: (p: Project) => { project = p; } };
  const set = (patch: Partial<MediaItem>) => { project = { ...project, mediaLibrary: { items: [{ ...project.mediaLibrary.items[0], ...patch }] } }; };
  return { handle, set, item: () => project.mediaLibrary.items[0] };
}
function bridge() {
  return {
    generateThumbnailsForMedia: vi.fn(async (_f: File | Blob, _t: "video" | "audio" | "image", o?: { pixelAspect?: number }) => [
      { timestamp: 0, dataUrl: `new-${o?.pixelAspect ?? 1}` },
    ]),
  };
}

describe("thumbnails follow the interpretation", () => {
  beforeEach(() => resetThumbnailRefreshState());

  it("leaves square-pixel (legacy) media untouched", async () => {
    const h = harness(video());
    const b = bridge();
    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).not.toHaveBeenCalled();
    expect(h.item().thumbnailUrl).toBe("old-0");
    expect("thumbnailPixelAspect" in h.item()).toBe(false);
  });

  it("regenerates at the effective pixel aspect when the interpretation changes, and back again", async () => {
    const h = harness(video());
    const b = bridge();
    h.set({ interpretation: { pixelAspectRatio: 4 / 3 } });
    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).toHaveBeenCalledWith(blob, "video", { pixelAspect: 4 / 3 });
    expect(h.item().thumbnailUrl).toBe(`new-${4 / 3}`);
    expect(h.item().filmstripThumbnails?.[0].url).toBe(`new-${4 / 3}`);
    expect(h.item().thumbnailPixelAspect).toBe(4 / 3);

    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).toHaveBeenCalledTimes(1);

    h.set({ interpretation: undefined });
    await refreshStaleThumbnails(h.handle, b);
    expect(h.item().thumbnailUrl).toBe("new-1");
    expect("thumbnailPixelAspect" in h.item()).toBe(false);
  });

  it("uses the file's own reported pixel aspect and ignores a result for an interpretation that moved on mid-flight", async () => {
    const h = harness(video({ metadata: { ...video().metadata, pixelAspectRatio: 4 / 3 } }));
    const b = bridge();
    b.generateThumbnailsForMedia.mockImplementationOnce(async () => {
      h.set({ interpretation: { pixelAspectRatio: 2 } });
      return [{ timestamp: 0, dataUrl: "stale" }];
    });
    await refreshStaleThumbnails(h.handle, b);
    expect(h.item().thumbnailUrl).toBe("old-0");
    await refreshStaleThumbnails(h.handle, b);
    expect(h.item().thumbnailUrl).toBe("new-2");
  });
});
