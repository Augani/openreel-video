import type { MediaItem, Project } from "@openreel/core";
import { effectivePixelAspect, thumbnailsNeedRefresh } from "@openreel/core/media/interpretation";

/**
 * Thumbnails and filmstrips are drawn at the display aspect: stretched by the effective pixel aspect
 * when generated. This keeps them in step with "Interpret footage": whenever a video item's effective
 * pixel aspect no longer matches the one its stored frames were generated for, they are regenerated.
 * Square-pixel (legacy) media never has a mismatch, so it is never touched.
 */
export interface ThumbnailRegenerator {
  generateThumbnailsForMedia(
    file: File | Blob,
    mediaType: "video" | "audio" | "image",
    options?: { pixelAspect?: number },
  ): Promise<{ timestamp: number; dataUrl: string }[]>;
}

export interface ProjectHandle {
  getProject(): Project;
  setProject(project: Project): void;
}

/** Items whose stored thumbnails need regenerating (video with a decodable blob). */
export function staleThumbnailItems(project: Project): MediaItem[] {
  return project.mediaLibrary.items.filter((item) => item.blob !== null && thumbnailsNeedRefresh(item));
}

const inFlight = new Set<string>();
/** Failed attempts back off instead of being final, and are forgotten when the item's blob changes. */
const failed = new Map<string, { blob: Blob; at: number }>();
export const THUMBNAIL_RETRY_BACKOFF_MS = 30_000;
export const THUMBNAIL_CONCURRENCY = 2;

function recentlyFailed(key: string, blob: Blob): boolean {
  const entry = failed.get(key);
  if (!entry) return false;
  if (entry.blob !== blob || Date.now() - entry.at >= THUMBNAIL_RETRY_BACKOFF_MS) {
    failed.delete(key);
    return false;
  }
  return true;
}

/** Regenerate stale thumbnails; resolves when every started regeneration has settled. */
export async function refreshStaleThumbnails(handle: ProjectHandle, bridge: ThumbnailRegenerator): Promise<void> {
  const queue = staleThumbnailItems(handle.getProject());
  const run = async (item: MediaItem): Promise<void> => {
    const pixelAspect = effectivePixelAspect(item);
    const key = `${item.id}:${pixelAspect}`;
    if (!item.blob || inFlight.has(key) || recentlyFailed(key, item.blob)) return;
    const blob = item.blob;
    inFlight.add(key);
    try {
      const thumbs = await bridge.generateThumbnailsForMedia(blob, "video", { pixelAspect });
      if (thumbs.length === 0) {
        failed.set(key, { blob, at: Date.now() });
        return;
      }
      const project = handle.getProject();
      const index = project.mediaLibrary.items.findIndex((m) => m.id === item.id);
      const current = project.mediaLibrary.items[index];
      // Skip if the item changed under us (relinked, or the interpretation moved on again).
      if (!current || current.blob !== item.blob || Math.abs(effectivePixelAspect(current) - pixelAspect) > 1e-6) return;
      const { thumbnailPixelAspect: _previous, ...rest } = current;
      const next: MediaItem = {
        ...rest,
        thumbnailUrl: thumbs[0].dataUrl,
        filmstripThumbnails: thumbs.map((t) => ({ timestamp: t.timestamp, url: t.dataUrl })),
        // Square pixels carry no marker: identical to a legacy item.
        ...(Math.abs(pixelAspect - 1) > 1e-6 ? { thumbnailPixelAspect: pixelAspect } : {}),
      };
      const items = [...project.mediaLibrary.items];
      items[index] = next;
      handle.setProject({ ...project, mediaLibrary: { ...project.mediaLibrary, items } });
    } catch {
      failed.set(key, { blob, at: Date.now() });
    } finally {
      inFlight.delete(key);
    }
  };
  // At most THUMBNAIL_CONCURRENCY video decoders at once.
  const workers = Array.from({ length: Math.min(THUMBNAIL_CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await run(item);
  });
  await Promise.all(workers);
}

/** Test hook. */
export function resetThumbnailRefreshState(): void {
  inFlight.clear();
  failed.clear();
}
