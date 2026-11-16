import type { MediaItem } from "@openreel/core";

export function getMediaFileSize(item: MediaItem): number | null {
  // Source metadata takes priority over any in-memory preview/proxy blob.
  for (const size of [
    item.metadata?.fileSize,
    item.sourceFile?.size,
    item.blob?.size,
  ]) {
    if (typeof size === "number" && Number.isFinite(size) && size > 0)
      return size;
  }
  return null;
}

export function formatMediaFileSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length,
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent >= 3 ? 2 : 1)} ${units[exponent - 1]}`;
}

export function getMediaLibrarySizeLabel(
  items: readonly MediaItem[],
): string | null {
  let bytes = 0;
  let unknown = false;
  for (const item of items) {
    const size = getMediaFileSize(item);
    if (size === null) unknown = true;
    else bytes += size;
  }
  const formatted = formatMediaFileSize(bytes);
  return formatted ? `${unknown ? "≥" : ""}${formatted}` : null;
}
