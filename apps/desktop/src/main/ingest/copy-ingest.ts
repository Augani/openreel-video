import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { uniqueCopyName } from "../../../../../packages/core/src/media/desktop-ingest";

export interface CopyResult {
  destPath: string;
  sha256: string;
  size: number;
  /** The file already lives inside the destination folder, so nothing was copied. */
  alreadyInPlace: boolean;
}

export async function hashFile(filePath: string, onBytes?: (bytes: number) => void, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath, { signal })) {
    hash.update(chunk as Buffer);
    onBytes?.((chunk as Buffer).length);
  }
  return hash.digest("hex");
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
}): Promise<CopyResult> {
  const { srcPath, destDir, onProgress, signal } = args;
  const src = path.resolve(srcPath);
  const dir = path.resolve(destDir);
  const stat = await fs.stat(src);
  if (!stat.isFile()) throw new Error("Only files can be copied into the project.");

  // Already inside the project's media folder: nothing to copy.
  const rel = path.relative(dir, src);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const sha256 = await hashFile(src, undefined, signal);
    onProgress?.(1);
    return { destPath: src, sha256, size: stat.size, alreadyInPlace: true };
  }

  await fs.mkdir(dir, { recursive: true });
  const taken = new Set(await fs.readdir(dir).catch(() => [] as string[]));
  const destName = uniqueCopyName(path.basename(src), taken);
  const dest = path.join(dir, destName);
  const part = `${dest}.part`;
  const total = Math.max(1, stat.size) * 2;
  let done = 0;
  const bump = (bytes: number): void => {
    done += bytes;
    onProgress?.(Math.min(0.999, done / total));
  };

  const copyHash = createHash("sha256");
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
    const sourceHash = copyHash.digest("hex");
    const partStat = await fs.stat(part);
    if (partStat.size !== stat.size) throw new Error(`The copy is ${partStat.size} bytes but the original is ${stat.size}. Nothing was changed.`);
    const copyHashOnDisk = await hashFile(part, bump, signal);
    if (copyHashOnDisk !== sourceHash) throw new Error("The copy failed checksum verification. The original is untouched and no copy was kept.");
    // The unique name was chosen before the copy; never replace a file that appeared meanwhile.
    if (await fs.access(dest).then(() => true, () => false)) throw new Error(`${destName} already exists in the media folder.`);
    await fs.rename(part, dest);
    onProgress?.(1);
    return { destPath: dest, sha256: sourceHash, size: stat.size, alreadyInPlace: false };
  } catch (error) {
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}
