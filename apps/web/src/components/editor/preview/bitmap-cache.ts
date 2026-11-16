import { ByteBudgetCache, getMediaMemoryBudget, subscribeMediaMemoryBudget } from "@openreel/core";

/**
 * A decoded still (photo, motion asset) is width x height x 4 bytes: a 4K still is 33 MB, so a
 * timeline of photos used to hold every one of them for the whole session. These caches are
 * byte-budgeted (the `imageBitmapBytes` share of the media memory budget, split across the three
 * Preview caches) and close every bitmap that leaves them.
 *
 * The floor (about five 4K stills) keeps overlapping photo layers and a single large still (an 8K photo is 133 MB) from evicting each other every frame.
 */
const MIN_BITMAP_CACHE_BYTES = 192 * 1024 * 1024;

export type PreviewBitmapCache = ByteBudgetCache<string, ImageBitmap>;

export function bitmapByteSize(bitmap: ImageBitmap): number {
  return Math.max(1, bitmap.width * bitmap.height * 4);
}

export function bitmapCacheBudget(share: number, totalImageBytes = getMediaMemoryBudget().imageBitmapBytes): number {
  return Math.max(MIN_BITMAP_CACHE_BYTES, Math.floor(totalImageBytes * share));
}

export function createBitmapCache(share: number): PreviewBitmapCache {
  return new ByteBudgetCache<string, ImageBitmap>(bitmapCacheBudget(share), {
    sizeOf: bitmapByteSize,
    // A rejected bitmap (bigger than the whole budget) still belongs to the caller that is about to
    // draw it, so it is not closed here; the garbage collector reclaims it.
    dispose: (bitmap, _key, reason) => {
      if (reason === "rejected") return;
      try {
        bitmap.close();
      } catch {
        // Already closed.
      }
    },
  });
}

/** Resizes `cache` whenever the media memory budget changes (desktop hardware probe). Returns the unsubscribe. */
export function followBitmapBudget(cache: PreviewBitmapCache, share: number): () => void {
  return subscribeMediaMemoryBudget((budget) => cache.setBudget(bitmapCacheBudget(share, budget.imageBitmapBytes)));
}
