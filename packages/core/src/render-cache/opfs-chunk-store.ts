import type { ChunkStore } from "./chunk-store";

/** The slice of the File System Access API the store needs (OPFS directory handles satisfy it). */
export interface OpfsDirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, { kind: string }]>;
}

export interface OpfsFileLike {
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable?(): Promise<{ write(data: ArrayBuffer): Promise<void>; close(): Promise<void> }>;
}

/** True when the browser can write OPFS files from the main thread (Chromium, Firefox, recent Safari). */
export function opfsWritable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

const fileName = (key: string) => encodeURIComponent(key);
const keyOf = (name: string) => decodeURIComponent(name);

/**
 * Chunk store on the Origin Private File System: one file per key in a directory the caller scopes (one
 * directory per project). Survives reloads and restarts; the browser decides the quota.
 */
export class OpfsChunkStore implements ChunkStore {
  constructor(private readonly dir: OpfsDirectoryLike) {}

  async put(key: string, data: ArrayBuffer): Promise<void> {
    const handle = await this.dir.getFileHandle(fileName(key), { create: true });
    if (!handle.createWritable) throw new Error("OPFS writable streams are not supported");
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    try {
      const handle = await this.dir.getFileHandle(fileName(key));
      return await (await handle.getFile()).arrayBuffer();
    } catch {
      return undefined;
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.dir.removeEntry(fileName(key));
      } catch {
        /* already gone */
      }
    }
  }

  async clear(): Promise<void> {
    await this.delete((await this.list()).map((entry) => entry.key));
  }

  async purge(keep: (key: string) => boolean): Promise<number> {
    const doomed = (await this.list()).map((e) => e.key).filter((key) => !keep(key));
    await this.delete(doomed);
    return doomed.length;
  }

  async list(): Promise<Array<{ key: string; bytes: number }>> {
    const out: Array<{ key: string; bytes: number }> = [];
    for await (const [name, entry] of this.dir.entries()) {
      if (entry.kind !== "file") continue;
      try {
        const file = await (await this.dir.getFileHandle(name)).getFile();
        out.push({ key: keyOf(name), bytes: file.size });
      } catch {
        /* removed while listing */
      }
    }
    return out;
  }

  async size(): Promise<number> {
    return (await this.list()).reduce((sum, e) => sum + e.bytes, 0);
  }
}
