/**
 * Changed-source guard for native smart render. The renderer scanned the
 * imported Blob; ffmpeg later copies packets out of the file on disk. If the
 * file was replaced, edited or truncated in between, the plan's key frame
 * times no longer describe it and the copy would be garbage. A size match is
 * not enough (a re-export of the same clip is often the same size), and a
 * head/tail sample misses an edit in the middle of the file, so the
 * fingerprint is size + modification time + a hash of EVERY byte.
 *
 * The content hash is a two-level SHA-256 so the browser can compute it at
 * native speed without a streaming hash API: the file is cut into
 * `CONTENT_HASH_CHUNK_BYTES` chunks, each chunk is hashed with
 * `crypto.subtle.digest` (native, runs off the main thread, never more than a
 * few chunks in memory), and the final hash is SHA-256 over a header, the size
 * and the chunk digests in order. The desktop main process computes the same
 * value from the file on disk with `node:crypto` (see
 * apps/desktop/src/main/sidecar/source-guard.ts; the desktop tests assert both
 * sides agree), so a changed byte anywhere changes the result.
 *
 * Results are cached per file identity (name + size + last-modified) so the
 * cost is paid once per imported file, not once per export.
 */

/** Bytes per hashed chunk. Part of the hash definition: both sides must use the same value. */
export const CONTENT_HASH_CHUNK_BYTES = 8 * 1024 * 1024;

/** Domain separator and version of the hash definition. */
export const CONTENT_HASH_HEADER = "openreel-source-content-v2";

/** Modification times closer than this are the same (FAT stores 2 s resolution). */
export const MTIME_TOLERANCE_MS = 2000;

/** Chunks read and hashed at once; bounds memory to a few chunks whatever the file size. */
const READ_AHEAD = 4;

export interface SourceFingerprint {
  readonly size: number;
  /** Last-modified time in ms since the epoch; absent for an in-memory Blob. */
  readonly mtimeMs?: number;
  /** Hex SHA-256 over every byte of the file (two-level, see the file comment). */
  readonly contentHash: string;
}

const hex = (bytes: ArrayBuffer | Uint8Array): string =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** Bytes that the final hash is taken over, given the chunk digests (32 bytes each, in file order). */
export function contentHashInput(size: number, chunkDigests: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(`${CONTENT_HASH_HEADER}\0${size}\0`);
  const out = new Uint8Array(header.length + chunkDigests.length * 32);
  out.set(header, 0);
  chunkDigests.forEach((digest, i) => out.set(digest, header.length + i * 32));
  return out;
}

export interface FingerprintOptions {
  /** Called with the fraction of the file hashed so far (0..1). */
  onProgress?: (fraction: number) => void;
}

/** Full-content hash of a Blob, read in chunks. Never holds more than `READ_AHEAD` chunks. */
export async function hashBlobContent(blob: Blob, options: FingerprintOptions = {}): Promise<string> {
  const chunkCount = Math.ceil(blob.size / CONTENT_HASH_CHUNK_BYTES);
  const digests: Uint8Array[] = new Array<Uint8Array>(chunkCount);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= chunkCount) return;
      const from = index * CONTENT_HASH_CHUNK_BYTES;
      const buffer = await blob.slice(from, Math.min(blob.size, from + CONTENT_HASH_CHUNK_BYTES)).arrayBuffer();
      digests[index] = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
      done++;
      options.onProgress?.(done / chunkCount);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_AHEAD, chunkCount) }, worker));
  return hex(await crypto.subtle.digest("SHA-256", contentHashInput(blob.size, digests)));
}

const byIdentity = new Map<string, Promise<SourceFingerprint>>();
const byBlob = new WeakMap<Blob, Promise<SourceFingerprint>>();
const MAX_CACHED_IDENTITIES = 64;

function identityOf(blob: Blob): string | null {
  const file = blob as Partial<File>;
  return typeof file.lastModified === "number" && typeof file.name === "string"
    ? `${file.name}\0${blob.size}\0${file.lastModified}`
    : null;
}

/** Fingerprint of a Blob without the cache (a File also contributes its last-modified time). */
export async function computeFingerprint(blob: Blob, options: FingerprintOptions = {}): Promise<SourceFingerprint> {
  const lastModified = (blob as Partial<File>).lastModified;
  return {
    size: blob.size,
    ...(typeof lastModified === "number" ? { mtimeMs: lastModified } : {}),
    contentHash: await hashBlobContent(blob, options),
  };
}

/**
 * Fingerprint of a Blob, computed once per file identity (name + size +
 * last-modified for a File, the object itself for any other Blob). Safe to call
 * early (for instance when the export starts) so the hash is ready, or running,
 * by the time the first copy needs it. A failed read is not cached.
 */
export function fingerprintBlob(blob: Blob, options: FingerprintOptions = {}): Promise<SourceFingerprint> {
  const key = identityOf(blob);
  const cached = key !== null ? byIdentity.get(key) : byBlob.get(blob);
  if (cached) return cached;
  const result = computeFingerprint(blob, options);
  const forget = (): void => {
    if (key !== null) byIdentity.delete(key);
    else byBlob.delete(blob);
  };
  result.catch(forget);
  if (key !== null) {
    if (byIdentity.size >= MAX_CACHED_IDENTITIES) byIdentity.delete(byIdentity.keys().next().value as string);
    byIdentity.set(key, result);
  } else {
    byBlob.set(blob, result);
  }
  return result;
}

/** Why the file on disk is not the file the project imported, or null when they match. */
export function fingerprintMismatch(expected: SourceFingerprint, actual: SourceFingerprint): string | null {
  if (expected.size !== actual.size) return `size changed (${expected.size} bytes in the project, ${actual.size} on disk)`;
  if (expected.mtimeMs !== undefined && actual.mtimeMs !== undefined && Math.abs(expected.mtimeMs - actual.mtimeMs) >= MTIME_TOLERANCE_MS) {
    return "modification time changed";
  }
  if (expected.contentHash !== actual.contentHash) return "content changed (the file's bytes differ from the imported copy)";
  return null;
}
