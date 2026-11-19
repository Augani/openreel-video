import type { DevelopedFrame } from "./develop";
import type { DngRaw } from "./dng";
import { rawSettingsKey, type RawSourceSettings, type RawStillInfo } from "./settings";

// develop/dng/tiff/color are the heavy RAW developer. The in-thread developer is only a
// fallback (the app installs a worker), so it loads them on first use to keep them out of
// the app's entry chunk.

/**
 * Glue between camera files and the media library: inspecting a RAW file on
 * import, and producing the ImageBitmap every renderer (preview, playback,
 * export) uses for a RAW still. There is one code path: `createMediaImageBitmap`.
 * It develops from the item's stored settings, so the preview and the export
 * show the same pixels and a settings change is visible everywhere at once.
 */

/** Develops a RAW source with settings. Replaceable so the web app can run it in a Web Worker. */
export interface RawDeveloper {
  develop(request: { sourceKey: string; blob: Blob; settings: RawSourceSettings; maxLongEdge?: number }): Promise<DevelopedFrame>;
  /** Decodes only what the import needs (metadata and default settings). */
  inspect(request: { sourceKey: string; blob: Blob }): Promise<RawInspection>;
}

export interface RawInspection {
  readonly info: RawStillInfo;
  /** Size of the developed image at the as-shot settings. */
  readonly width: number;
  readonly height: number;
}

const decodeCache = new Map<string, Promise<DngRaw>>();
const DECODE_CACHE_SIZE = 2;

function decodeBlob(sourceKey: string, blob: Blob): Promise<DngRaw> {
  const hit = decodeCache.get(sourceKey);
  if (hit) {
    decodeCache.delete(sourceKey);
    decodeCache.set(sourceKey, hit);
    return hit;
  }
  const pending = blob.arrayBuffer().then(async (buffer) => {
    const [{ decodeDng, looksLikeDng }, { RawDecodeError }] = await Promise.all([import("./dng"), import("./tiff")]);
    if (!looksLikeDng(buffer)) throw new RawDecodeError("This file is not a DNG.");
    return decodeDng(buffer);
  });
  decodeCache.set(sourceKey, pending);
  pending.catch(() => decodeCache.delete(sourceKey));
  while (decodeCache.size > DECODE_CACHE_SIZE) decodeCache.delete(decodeCache.keys().next().value as string);
  return pending;
}

/** The default developer: decodes and develops on the calling thread. */
export const inThreadRawDeveloper: RawDeveloper = {
  async develop({ sourceKey, blob, settings, maxLongEdge }) {
    const { developRaw } = await import("./develop");
    return developRaw(await decodeBlob(sourceKey, blob), settings, maxLongEdge ? { maxLongEdge } : {});
  },
  async inspect({ sourceKey, blob }) {
    const { inspectDngRaw } = await import("./inspect");
    return inspectDngRaw(await decodeBlob(sourceKey, blob));
  },
};

let developer: RawDeveloper = inThreadRawDeveloper;

/** Installs a developer (a worker-backed one in the web app); null restores the in-thread default. */
export function setRawDeveloper(next: RawDeveloper | null): void {
  developer = next ?? inThreadRawDeveloper;
}

export function getRawDeveloper(): RawDeveloper {
  return developer;
}

/** Whether `createMediaImageBitmap` develops this item instead of decoding its blob directly. */
export function isDevelopedRaw(item: { raw?: RawStillInfo }): boolean {
  return item.raw?.developedBy === "openreel" && !!item.raw.settings;
}

/**
 * Stable suffix for caches keyed by media id: empty for ordinary media, the
 * settings identity for RAW stills, so a settings change cannot serve stale pixels.
 */
export function mediaImageVersion(item: { raw?: RawStillInfo }): string {
  return isDevelopedRaw(item) ? `#raw:${rawSettingsKey(item.raw!.settings!)}` : "";
}

const MASTER_CACHE_SIZE = 3;
const masters = new Map<string, Promise<ImageBitmap>>();

function toBitmap(frame: DevelopedFrame): Promise<ImageBitmap> {
  const pixels = new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height);
  return createImageBitmap(pixels, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

/**
 * The image to draw for a media item. Ordinary images decode their blob; RAW
 * stills are developed (cached per settings). Always returns a fresh bitmap the
 * caller may close.
 */
export async function createMediaImageBitmap(item: { id: string; blob: Blob | null; raw?: RawStillInfo }): Promise<ImageBitmap> {
  if (!item.blob) throw new Error("The image has no file data.");
  if (!isDevelopedRaw(item)) return createImageBitmap(item.blob);
  const key = `${item.id}${mediaImageVersion(item)}`;
  let master = masters.get(key);
  if (!master) {
    const sourceKey = `${item.id}:${item.blob.size}`;
    master = getRawDeveloper().develop({ sourceKey, blob: item.blob, settings: item.raw!.settings! }).then(toBitmap);
    masters.set(key, master);
    master.catch(() => masters.delete(key));
    while (masters.size > MASTER_CACHE_SIZE) masters.delete(masters.keys().next().value as string);
  } else {
    masters.delete(key);
    masters.set(key, master);
  }
  return createImageBitmap(await master);
}

/** Forget cached developments of a media item (after delete / replace). */
export function invalidateRawMedia(mediaId: string): void {
  for (const key of [...masters.keys()]) if (key.startsWith(`${mediaId}#`)) masters.delete(key);
  for (const key of [...decodeCache.keys()]) if (key.startsWith(`${mediaId}:`)) decodeCache.delete(key);
}

/** Reads a RAW file's metadata and as-shot settings. Throws `RawDecodeError` for files that cannot be decoded. */
export async function inspectRawBlob(sourceKey: string, blob: Blob): Promise<RawInspection> {
  return getRawDeveloper().inspect({ sourceKey, blob });
}

/** Test helper: clears module caches. */
export function resetRawCachesForTests(): void {
  masters.clear();
  decodeCache.clear();
  developer = inThreadRawDeveloper;
}
