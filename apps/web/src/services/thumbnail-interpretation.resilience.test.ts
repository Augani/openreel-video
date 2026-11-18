import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  refreshStaleThumbnails,
  resetThumbnailRefreshState,
  THUMBNAIL_CONCURRENCY,
  THUMBNAIL_RETRY_BACKOFF_MS,
} from "./thumbnail-interpretation";

const video = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "m1", name: "m1.mp4", type: "video", fileHandle: null, blob: new Blob(["v"]),
  metadata: { duration: 5, width: 1440, height: 1080, frameRate: 25, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 },
  thumbnailUrl: "old-0", waveformData: null,
  filmstripThumbnails: [{ timestamp: 0, url: "old-0" }],
  interpretation: { pixelAspectRatio: 4 / 3 },
  ...extra,
});
function harness(items: MediaItem[]) {
  let project: Project = { ...createEmptyProject("T"), mediaLibrary: { items } };
  return {
    handle: { getProject: () => project, setProject: (p: Project) => { project = p; } },
    set: (patch: Partial<MediaItem>) => {
      project = { ...project, mediaLibrary: { items: [{ ...project.mediaLibrary.items[0], ...patch }] } };
    },
    item: () => project.mediaLibrary.items[0],
  };
}
function bridge() {
  return {
    generateThumbnailsForMedia: vi.fn(async (_f: File | Blob, _t: "video" | "audio" | "image", o?: { pixelAspect?: number }) => [
      { timestamp: 0, dataUrl: `new-${o?.pixelAspect ?? 1}` },
    ]),
  };
}

describe("thumbnail refresh resilience", () => {
  beforeEach(() => {
    resetThumbnailRefreshState();
    vi.useRealTimers();
  });

  it("retries a failed regeneration after the backoff", async () => {
    vi.useFakeTimers();
    const h = harness([video()]);
    const b = bridge();
    b.generateThumbnailsForMedia.mockResolvedValueOnce([]);
    await refreshStaleThumbnails(h.handle, b);
    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(THUMBNAIL_RETRY_BACKOFF_MS + 1);
    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).toHaveBeenCalledTimes(2);
    expect(h.item().thumbnailUrl).toBe(`new-${4 / 3}`);
    vi.useRealTimers();
  });

  it("retries immediately when the item's blob changes", async () => {
    const h = harness([video()]);
    const b = bridge();
    b.generateThumbnailsForMedia.mockResolvedValueOnce([]);
    await refreshStaleThumbnails(h.handle, b);
    h.set({ blob: new Blob(["relinked"]) });
    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).toHaveBeenCalledTimes(2);
    expect(h.item().thumbnailUrl).toBe(`new-${4 / 3}`);
  });

  it("never runs more than the concurrency limit at once", async () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => video({ id }));
    const h = harness(items);
    let active = 0;
    let peak = 0;
    const b = {
      generateThumbnailsForMedia: vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return [{ timestamp: 0, dataUrl: "n" }];
      }),
    };
    await refreshStaleThumbnails(h.handle, b);
    expect(b.generateThumbnailsForMedia).toHaveBeenCalledTimes(5);
    expect(peak).toBe(THUMBNAIL_CONCURRENCY);
  });
});
