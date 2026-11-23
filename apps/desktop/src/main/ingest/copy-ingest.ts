import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { uniqueCopyName } from "../../../../../packages/core/src/media/desktop-ingest";
import type { IngestChecksumAlgorithm } from "../../../../../packages/core/src/types/project";
import { XxHash64 } from "./xxhash64";

/** A running digest for one of the checksum algorithms the copy dialog offers. */
export interface Digester {
  update(chunk: Uint8Array): void;
  digest(): string;
}

export function createDigester(algorithm: IngestChecksumAlgorithm): Digester {
  if (algorithm === "xxh64") {
    const h = new XxHash64();
    return { update: (chunk) => void h.update(chunk), digest: () => h.digest() };
  }
  const h = createHash(algorithm);
  return { update: (chunk) => void h.update(chunk), digest: () => h.digest("hex") };
}

export interface CopyResult {
  destPath: string;
  /** SHA-256 of the copy; empty when another algorithm verified it (see `checksum`). */
  sha256: string;
  /** What the copy was verified with: the source stream and the file on disk produced this same digest. */
  checksum: { algorithm: IngestChecksumAlgorithm; value: string };
  size: number;
  /** An identical copy from an interrupted run was found in the destination and kept (nothing was copied again). */
  reused?: boolean;
  /** The file already lives inside the destination folder, so nothing was copied. */
  alreadyInPlace: boolean;
}

export async function hashFile(filePath: string, onBytes?: (bytes: number) => void, signal?: AbortSignal, algorithm: IngestChecksumAlgorithm = "sha256"): Promise<string> {
  const hash = createDigester(algorithm);
  for await (const chunk of createReadStream(filePath, { signal })) {
    hash.update(chunk as Buffer);
    onBytes?.((chunk as Buffer).length);
  }
  return hash.digest();
}

/**
 * Copy `srcPath` into `destDir` and verify it. The source is only ever opened for reading. The copy
 * is written to a `.part` file while hashing the stream, re-read and hashed again once on disk, and
 * only a byte-identical copy (same SHA-256 and size) is renamed into place. Progress covers both passes.
 */
export async function copyIntoFolder(args: {
  srcPath: string;
  destDir: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Checksum to verify with (default SHA-256). */
  algorithm?: IngestChecksumAlgorithm;
  /** Test seam: runs on the finished `.part` file before it is re-read, to simulate a bad disk. */
  afterWrite?: (partPath: string) => Promise<void> | void;
  /** Resuming a job: a file of the same name that is byte-identical to the source (same checksum) is the finished copy of an interrupted run; keep it. */
  reuseIdentical?: boolean;
}): Promise<CopyResult> {
  const { srcPath, destDir, onProgress, signal } = args;
  const algorithm = args.algorithm ?? "sha256";
  const src = path.resolve(srcPath);
  const dir = path.resolve(destDir);
  const stat = await fs.stat(src);
  if (!stat.isFile()) throw new Error("Only files can be copied into the project.");

  // Already inside the project's media folder: nothing to copy.
  const rel = path.relative(dir, src);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const value = await hashFile(src, undefined, signal, algorithm);
    onProgress?.(1);
    return { destPath: src, sha256: algorithm === "sha256" ? value : "", checksum: { algorithm, value }, size: stat.size, alreadyInPlace: true };
  }

  await fs.mkdir(dir, { recursive: true });
  const taken = new Set(await fs.readdir(dir).catch(() => [] as string[]));
  if (args.reuseIdentical) {
    const existing = path.join(dir, path.basename(src));
    const existingStat = await fs.stat(existing).catch(() => null);
    if (existingStat?.isFile() && existingStat.size === stat.size) {
      const [a, b] = [await hashFile(src, undefined, signal, algorithm), await hashFile(existing, undefined, signal, algorithm)];
      if (a === b) {
        onProgress?.(1);
        return { destPath: existing, sha256: algorithm === "sha256" ? a : "", checksum: { algorithm, value: a }, size: stat.size, alreadyInPlace: false, reused: true };
      }
    }
  }
  const destName = uniqueCopyName(path.basename(src), taken);
  const dest = path.join(dir, destName);
  const part = `${dest}.part`;
  // A `.part` left by a run that was killed mid-copy is never finished by anyone: start over.
  await fs.rm(part, { force: true });
  const total = Math.max(1, stat.size) * 2;
  let done = 0;
  const bump = (bytes: number): void => {
    done += bytes;
    onProgress?.(Math.min(0.999, done / total));
  };

  const copyHash = createDigester(algorithm);
  try {
    await pipeline(
      createReadStream(src),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          copyHash.update(chunk);
          bump(chunk.length);
          callback(null, chunk);
        },
      }),
      createWriteStream(part, { flags: "wx" }),
      ...(signal ? [{ signal }] : []),
    );
    const sourceHash = copyHash.digest();
    const partStat = await fs.stat(part);
    if (partStat.size !== stat.size) throw new Error(`The copy is ${partStat.size} bytes but the original is ${stat.size}. Nothing was changed.`);
    await args.afterWrite?.(part);
    const copyHashOnDisk = await hashFile(part, bump, signal, algorithm);
    if (copyHashOnDisk !== sourceHash) throw new Error(`The copy failed ${algorithm.toUpperCase()} verification (${sourceHash} read, ${copyHashOnDisk} on disk). The original is untouched and no copy was kept.`);
    // The unique name was chosen before the copy; never replace a file that appeared meanwhile.
    if (await fs.access(dest).then(() => true, () => false)) throw new Error(`${destName} already exists in the media folder.`);
    await fs.rename(part, dest);
    onProgress?.(1);
    return { destPath: dest, sha256: algorithm === "sha256" ? sourceHash : "", checksum: { algorithm, value: sourceHash }, size: stat.size, alreadyInPlace: false };
  } catch (error) {
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}
