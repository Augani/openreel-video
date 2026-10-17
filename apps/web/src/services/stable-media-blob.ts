const COPY_CHUNK_BYTES = 1024 * 1024;

/** Detach file-backed slices before IndexedDB serializes their byte offsets. */
export async function copyMediaBlobInChunks(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  const parts: Blob[] = [];
  for (let offset = 0; offset < blob.size; offset += COPY_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const end = Math.min(blob.size, offset + COPY_CHUNK_BYTES);
    const bytes = await blob.slice(offset, end).arrayBuffer();
    if (bytes.byteLength !== end - offset) {
      throw new Error("The stored media bytes are incomplete. Reopen the original project backup.");
    }
    // Each buffer is copied into a Blob before reading the next chunk. The
    // complete original is never held in one JavaScript ArrayBuffer.
    parts.push(new Blob([bytes]));
  }
  signal?.throwIfAborted();
  return new Blob(parts, { type: blob.type });
}

export function needsStableMediaCopy(blob: Blob): boolean {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /AppleWebKit\//.test(ua) && !/(?:Chrome|Chromium|Edg)\//.test(ua)
    && !(typeof File !== "undefined" && blob instanceof File);
}
