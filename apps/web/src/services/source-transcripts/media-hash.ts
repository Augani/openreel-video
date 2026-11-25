const SLICE = 256 * 1024;

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const readBytes = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === "function"
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

const cache = new WeakMap<Blob, Promise<string>>();

/**
 * A content fingerprint for a media file: SHA-256 over its size and three 256 KiB samples (head, middle, tail).
 * Reading three slices keeps this instant for multi-gigabyte camera files while still telling two different
 * recordings apart; identical copies of one file (a relink to a copied folder) hash the same.
 */
export function hashMediaBlob(blob: Blob): Promise<string> {
  const cached = cache.get(blob);
  if (cached) return cached;
  const pending = (async () => {
    const size = blob.size;
    const offsets = size <= SLICE * 3 ? [0] : [0, Math.floor((size - SLICE) / 2), size - SLICE];
    const parts: Blob[] = [new Blob([`openreel-media:${size}:`])];
    for (const offset of offsets) parts.push(blob.slice(offset, size <= SLICE * 3 ? size : offset + SLICE));
    const bytes = await readBytes(new Blob(parts));
    return `v1-${size}-${hex(await crypto.subtle.digest("SHA-256", bytes))}`;
  })();
  cache.set(blob, pending);
  pending.catch(() => cache.delete(blob));
  return pending;
}
