/**
 * Cache identity of the footage a Time Interpolation frame is made from. The media id alone is not enough: replacing
 * or relinking a file keeps the id but changes the pixels, and the same file decoded at another project size gives
 * other source frames. A per-Blob serial separates replaced files without hashing their bytes.
 */
const blobSerials = new WeakMap<object, number>();
let nextSerial = 1;

export function interpolationSourceKey(mediaId: string, blob: object, width: number, height: number): string {
  let serial = blobSerials.get(blob);
  if (serial === undefined) {
    serial = nextSerial++;
    blobSerials.set(blob, serial);
  }
  return `${mediaId}#${serial}@${width}x${height}`;
}
