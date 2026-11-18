/**
 * Desktop smart render hands source files to ffmpeg by path. A media item only
 * carries a Blob, so find the file it came from (a picked or dropped File knows
 * its path) and fall back to copying the Blob into an app temp file.
 */

const COPY_CHUNK_BYTES = 16 * 1024 * 1024;

export interface NativeSourceFile {
  readonly path: string;
  /** True when the Blob was copied to a temp file (released with the job). */
  readonly copied: boolean;
  /** Milliseconds spent copying (0 for a file used in place). */
  readonly copyMs: number;
}

type Bridge = NonNullable<Window["openreel"]>;

async function copyBlobToTemp(bridge: Bridge, blob: Blob): Promise<NativeSourceFile> {
  const started = performance.now();
  const path = await bridge.fs.tempFilePath("bin");
  const handle = await bridge.fs.openWrite(path);
  try {
    for (let offset = 0; offset < blob.size; offset += COPY_CHUNK_BYTES) {
      const chunk = await blob.slice(offset, offset + COPY_CHUNK_BYTES).arrayBuffer();
      await bridge.fs.writeChunk(handle, chunk, offset);
    }
    await bridge.fs.closeWrite(handle);
  } catch (error) {
    await bridge.fs.abortWrite(handle).catch(() => undefined);
    await bridge.fs.releaseTemp?.(path).catch(() => undefined);
    throw error;
  }
  return { path, copied: true, copyMs: performance.now() - started };
}

/** The on-disk file behind a Blob when it came from one, or null for an in-memory Blob. */
export function diskPathOf(bridge: Bridge, blob: Blob): string | null {
  if (typeof File === "undefined" || !(blob instanceof File)) return null;
  const path = bridge.export.pathForFile?.(blob) ?? "";
  return path === "" ? null : path;
}

/** Per-export cache of source files; `release()` deletes the temp copies. */
export class NativeSourceFiles {
  private readonly files = new Map<Blob, Promise<NativeSourceFile>>();
  private readonly copies: string[] = [];

  resolve(blob: Blob, forceCopy = false): Promise<NativeSourceFile> {
    const bridge = window.openreel;
    if (!bridge) return Promise.reject(new Error("The desktop bridge is not available"));
    const cached = this.files.get(blob);
    if (cached && !forceCopy) return cached;
    const next = (async (): Promise<NativeSourceFile> => {
      const disk = forceCopy ? null : diskPathOf(bridge, blob);
      if (disk) return { path: disk, copied: false, copyMs: 0 };
      const copy = await copyBlobToTemp(bridge, blob);
      this.copies.push(copy.path);
      return copy;
    })();
    this.files.set(blob, next);
    return next;
  }

  /** Milliseconds spent copying Blobs to temp files so far. */
  async copyMs(): Promise<number> {
    let total = 0;
    for (const file of this.files.values()) total += (await file.catch(() => null))?.copyMs ?? 0;
    return total;
  }

  async release(): Promise<void> {
    const bridge = window.openreel;
    const paths = this.copies.splice(0);
    this.files.clear();
    await Promise.all(paths.map((path) => bridge?.fs.releaseTemp?.(path).catch(() => undefined)));
  }
}
