/**
 * Changed-source guard for native smart render. The plan was made from the
 * Blob the project imported; ffmpeg copies packets out of the file on disk.
 * Before any packet is copied the file must still be that file:
 *
 *  - size and modification time match what the renderer saw,
 *  - a hash of EVERY byte matches the Blob's (see
 *    packages/core/src/export/source-fingerprint.ts, which defines the
 *    two-level chunk hash; `test/smart-render-sources.integration.test.ts`
 *    keeps both sides in step). An edit anywhere in the file is caught, not
 *    only at its ends,
 *  - a key frame sits where the plan starts the copy (the plan's key frame
 *    index is what makes the cut valid).
 *
 * Hashing a file costs one sequential read; the result is cached per export
 * job by path + size + modification time so every copy run of a source after
 * the first only stats the file.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { resolveFfmpegPath } from "./ffmpeg-path";

/** Mirrors CONTENT_HASH_CHUNK_BYTES / CONTENT_HASH_HEADER / MTIME_TOLERANCE_MS in packages/core/src/export/source-fingerprint.ts. */
export const CONTENT_HASH_CHUNK_BYTES = 8 * 1024 * 1024;
export const CONTENT_HASH_HEADER = "openreel-source-content-v2";
export const MTIME_TOLERANCE_MS = 2000;

/** What the renderer recorded about the imported file (see SourceFingerprint in core). */
export interface ExpectedSourceFingerprint {
  size: number;
  mtimeMs?: number;
  contentHash: string;
}

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
  contentHash: string;
}

/** Fingerprints already computed in this export job, by path + size + mtime. */
export type FingerprintCache = Map<string, Promise<FileFingerprint>>;

/** Two-level SHA-256 over every byte of `file` (the definition in source-fingerprint.ts), read sequentially in fixed chunks. */
export async function hashFileContent(file: string): Promise<{ size: number; contentHash: string }> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.allocUnsafe(Math.min(CONTENT_HASH_CHUNK_BYTES, Math.max(size, 1)));
    const digests: Buffer[] = [];
    let position = 0;
    while (position < size) {
      const want = Math.min(CONTENT_HASH_CHUNK_BYTES, size - position);
      let filled = 0;
      while (filled < want) {
        const { bytesRead } = await handle.read(buffer, filled, want - filled, position + filled);
        if (bytesRead === 0) throw new Error("the file was truncated while it was being read");
        filled += bytesRead;
      }
      digests.push(createHash("sha256").update(buffer.subarray(0, want)).digest());
      position += want;
    }
    const contentHash = createHash("sha256").update(`${CONTENT_HASH_HEADER}\0${size}\0`).update(Buffer.concat(digests)).digest("hex");
    return { size, contentHash };
  } finally {
    await handle.close();
  }
}

export async function fingerprintFile(file: string, cache?: FingerprintCache): Promise<FileFingerprint> {
  const before = await fs.stat(file);
  const key = `${file}\0${before.size}\0${before.mtimeMs}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const compute = (async (): Promise<FileFingerprint> => {
    const { size, contentHash } = await hashFileContent(file);
    // Written to while it was being read: the hash describes no single version of the file.
    const after = await fs.stat(file);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || size !== before.size) {
      throw new Error("the file changed while it was being checked");
    }
    return { size, mtimeMs: before.mtimeMs, contentHash };
  })();
  cache?.set(key, compute);
  compute.catch(() => cache?.delete(key));
  return compute;
}

/** Why the file on disk is not the imported one, or null. */
export function fingerprintMismatch(expected: ExpectedSourceFingerprint, actual: FileFingerprint): string | null {
  if (expected.size !== actual.size) return `size changed (${expected.size} bytes in the project, ${actual.size} on disk)`;
  if (expected.mtimeMs !== undefined && Math.abs(expected.mtimeMs - actual.mtimeMs) >= MTIME_TOLERANCE_MS) {
    return "modification time changed";
  }
  if (expected.contentHash !== actual.contentHash) return "content changed (the file's bytes differ from the imported copy)";
  return null;
}

/** Presentation time of the first key frame shown by `ffmpeg -skip_frame nokey ... -vf showinfo`, or null. */
export function parseFirstKeyFrameTime(stderr: string): number | null {
  const match = /pts_time:(-?\d+(?:\.\d+)?)/.exec(stderr);
  return match ? Number(match[1]) : null;
}

/**
 * Presentation time of the key frame the demuxer lands on when seeking to
 * `sourceStart` (plus half a frame), read from the file's own packets. A copy
 * starts at `sourceStart`; it is only valid when a key frame is there.
 *
 * `sourceStart` is a presentation time in the file's own timeline. ffmpeg adds
 * the container's start_time to an input `-ss` unless `-seek_timestamp 1` says
 * it is already absolute, so without that flag a source that does not start at
 * zero (a camera file with a timecode or edit-list offset, MPEG-TS) is seeked
 * start_time too far and lands on the wrong key frame.
 */
export function firstKeyFrameAtOrAfter(file: string, sourceStart: number, frameRate: number): Promise<number | null> {
  return new Promise((resolve) => {
    const half = 0.5 / frameRate;
    const proc = spawn(
      resolveFfmpegPath(),
      [
        "-hide_banner",
        "-skip_frame", "nokey",
        "-copyts",
        // Absolute seek, and no accurate-seek trim: the first frame out is the key frame the demuxer seeked to.
        "-seek_timestamp", "1",
        "-noaccurate_seek",
        "-ss", Math.max(0, sourceStart + half).toFixed(6),
        "-i", file,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-vf", "showinfo",
        "-f", "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 262144) stderr = stderr.slice(-65536);
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => resolve(parseFirstKeyFrameTime(stderr)));
  });
}

/** Null when a key frame sits at `sourceStart`; else why the copy cannot start there. */
export async function keyFrameIndexMismatch(file: string, sourceStart: number, frameRate: number): Promise<string | null> {
  const found = await firstKeyFrameAtOrAfter(file, sourceStart, frameRate);
  if (found === null) return "no key frame found where the copy starts";
  if (Math.abs(found - sourceStart) > 0.5 / frameRate) {
    return `the key frame index changed (expected a key frame at ${sourceStart.toFixed(3)} s, the file has one at ${found.toFixed(3)} s)`;
  }
  return null;
}

/** Whole guard: fingerprint (when the renderer sent one) then the key frame at the copy start. */
export async function verifySourceForCopy(
  file: string,
  expected: ExpectedSourceFingerprint | undefined,
  copy: { sourceStart: number; frameRate: number },
  cache?: FingerprintCache,
): Promise<string | null> {
  if (expected) {
    const mismatch = fingerprintMismatch(expected, await fingerprintFile(file, cache));
    if (mismatch) return mismatch;
  }
  return keyFrameIndexMismatch(file, copy.sourceStart, copy.frameRate);
}
