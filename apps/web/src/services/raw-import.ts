import {
  getRawDeveloper,
  inspectRawBlob,
  rawFormatForFile,
  rawImportBlocker,
  type DevelopedFrame,
  type MediaItem,
  type RawStillInfo,
} from "@openreel/core";
import { nativePathForFile } from "./native-path";

/**
 * Camera RAW stills -> media items.
 *
 *  - DNG: decoded and developed by OpenReel (any platform). The media item keeps
 *    the camera file as its blob and the development settings in `item.raw`.
 *  - Other camera formats: on the desktop app for macOS, developed by ImageIO
 *    (`sips`) into a PNG that becomes the item's blob; there are no editable
 *    settings. Elsewhere the import is refused with the reason and the fix.
 *  - BRAW, R3D, ARRIRAW: refused (proprietary SDKs).
 */

export interface RawImportResult {
  readonly item: MediaItem;
}

export class RawImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawImportError";
  }
}

const THUMBNAIL_EDGE = 320;

function frameToDataUrl(frame: DevelopedFrame): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function macImageIOAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.openreel?.media?.developRawStill === "function";
}

async function importViaImageIO(file: File, id: string): Promise<{ blob: Blob; width: number; height: number }> {
  const srcPath = nativePathForFile(file);
  if (!srcPath) throw new RawImportError(`${file.name}: macOS can only convert files that are on disk. Drop the file from Finder or use Import.`);
  const media = window.openreel!.media;
  const { outPath, width, height } = await media.developRawStill!({ srcPath });
  const bytes = await window.openreel!.fs.readFileBytes(outPath);
  void id;
  return { blob: new Blob([bytes], { type: "image/png" }), width, height };
}

/** Builds the media item for one camera RAW still. Throws `RawImportError` with a message fit for a toast. */
export async function buildRawMediaItem(file: File, id: string): Promise<RawImportResult> {
  const format = rawFormatForFile(file.name);
  if (!format) throw new RawImportError(`${file.name} is not a camera RAW file.`);
  const blocker = rawImportBlocker(format, macImageIOAvailable());
  if (blocker) throw new RawImportError(blocker);

  const metadata = {
    duration: 0,
    frameRate: 0,
    sampleRate: 0,
    channels: 0,
    fileSize: file.size,
    hasVideo: false,
    hasAudio: false,
  };

  if (format.support === "native") {
    let inspection;
    try {
      inspection = await inspectRawBlob(`${id}:${file.size}`, file);
    } catch (error) {
      throw new RawImportError(`${file.name}: ${error instanceof Error ? error.message : "could not decode this DNG."}`);
    }
    let thumbnailUrl: string | null = null;
    try {
      const frame = await getRawDeveloper().develop({
        sourceKey: `${id}:${file.size}`,
        blob: file,
        settings: { ...inspection.info.settings!, demosaic: "draft" },
        maxLongEdge: THUMBNAIL_EDGE,
      });
      thumbnailUrl = frameToDataUrl(frame);
    } catch {
      thumbnailUrl = null;
    }
    const item = {
      id,
      name: file.name,
      type: "image" as const,
      fileHandle: null,
      blob: file,
      metadata: { ...metadata, width: inspection.width, height: inspection.height, codec: "dng" },
      thumbnailUrl,
      waveformData: null,
      raw: inspection.info,
    } satisfies MediaItem;
    return { item };
  }

  // macOS ImageIO path.
  let developed;
  try {
    developed = await importViaImageIO(file, id);
  } catch (error) {
    if (error instanceof RawImportError) throw error;
    throw new RawImportError(`${file.name}: ${error instanceof Error ? error.message : "macOS could not decode this RAW file."}`);
  }
  const raw: RawStillInfo = { format: format.id, developedBy: "macos-imageio" };
  const bitmap = await createImageBitmap(developed.blob);
  let thumbnailUrl: string | null = null;
  try {
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    bitmap.close();
  }
  const item = {
    id,
    name: file.name,
    type: "image" as const,
    fileHandle: null,
    blob: developed.blob,
    metadata: { ...metadata, fileSize: developed.blob.size, width: developed.width, height: developed.height, codec: format.id },
    thumbnailUrl,
    waveformData: null,
    raw,
  } satisfies MediaItem;
  return { item };
}
