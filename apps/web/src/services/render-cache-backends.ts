import {
  IndexedDbChunkStore,
  MemoryChunkStore,
  OpfsChunkStore,
  hashString,
  opfsWritable,
  type ChunkStore,
  type OpfsDirectoryLike,
} from "@openreel/core";

/**
 * Where render files live. Desktop: the scratch-disk folder, written by the main process. Browser: the Origin
 * Private File System, one directory per project. Fallbacks (no OPFS writable streams, e.g. old Safari): IndexedDB,
 * then memory. Every backend except memory survives a restart.
 */

export type RenderCacheBackendKind = "desktop-disk" | "opfs" | "indexeddb" | "memory";

export interface RenderCacheBackend {
  readonly store: ChunkStore;
  readonly kind: RenderCacheBackendKind;
  /** Prefix the engine must put on keys (only the shared IndexedDB store needs one). */
  readonly keyPrefix: string;
  readonly persistent: boolean;
}

const OPFS_ROOT = "openreel-render-cache";
const OPFS_STALE_MS = 14 * 24 * 60 * 60 * 1000;
const LEGACY_IDB = "openreel-render-cache";

/** Filesystem-safe, stable key for a project id. */
export function projectKeyOf(projectId: string): string {
  return `p${hashString(projectId)}`;
}

export function desktopBridge() {
  return typeof window !== "undefined" ? window.openreel?.renderCache : undefined;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Frame files on the desktop scratch disk, via the main process. */
export class DesktopDiskChunkStore implements ChunkStore {
  constructor(
    private readonly bridge: NonNullable<ReturnType<typeof desktopBridge>>,
    private readonly project: string,
  ) {}

  async put(key: string, data: ArrayBuffer): Promise<void> {
    await this.bridge.put(this.project, key, data);
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    const data = await this.bridge.get(this.project, key);
    return data ? toArrayBuffer(data) : undefined;
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 5000) await this.bridge.delete(this.project, keys.slice(i, i + 5000));
  }

  async clear(): Promise<void> {
    await this.bridge.clearProject(this.project);
  }

  list(): Promise<Array<{ key: string; bytes: number }>> {
    return this.bridge.list(this.project);
  }
}

/** Defers every call until the real backend has opened, so the cache can be constructed synchronously. */
export class DeferredChunkStore implements ChunkStore {
  constructor(private readonly ready: Promise<ChunkStore>) {}
  async put(key: string, data: ArrayBuffer) {
    return (await this.ready).put(key, data);
  }
  async get(key: string) {
    return (await this.ready).get(key);
  }
  async delete(keys: readonly string[]) {
    return (await this.ready).delete(keys);
  }
  async clear() {
    return (await this.ready).clear();
  }
  async purge(keep: (key: string) => boolean) {
    const store = await this.ready;
    return store.purge ? store.purge(keep) : 0;
  }
  async list() {
    const store = await this.ready;
    if (!store.list) throw new Error("this render-cache backend cannot list its files");
    return store.list();
  }
}

async function opfsProjectDir(projectKey: string): Promise<OpfsDirectoryLike> {
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle(OPFS_ROOT, { create: true });
  return (await base.getDirectoryHandle(projectKey, { create: true })) as unknown as OpfsDirectoryLike;
}

/** Remove other projects' OPFS render files that have not been written for two weeks. */
export async function sweepStaleOpfsProjects(keepProjectKey: string, now = Date.now()): Promise<number> {
  let removed = 0;
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(OPFS_ROOT, { create: true });
    const names: string[] = [];
    for await (const [name, handle] of base as unknown as AsyncIterable<[string, { kind: string }]>) {
      if (handle.kind === "directory" && name !== keepProjectKey) names.push(name);
    }
    for (const name of names) {
      let newest = 0;
      const dir = await base.getDirectoryHandle(name);
      for await (const [fileName, handle] of dir as unknown as AsyncIterable<[string, { kind: string }]>) {
        if (handle.kind !== "file") continue;
        const file = await (await dir.getFileHandle(fileName)).getFile();
        newest = Math.max(newest, file.lastModified);
      }
      if (now - newest > OPFS_STALE_MS) {
        await base.removeEntry(name, { recursive: true });
        removed++;
      }
    }
  } catch {
    /* sweeping is best effort */
  }
  return removed;
}

export async function deleteAllOpfsRenderFiles(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_ROOT, { recursive: true });
  } catch {
    /* nothing stored */
  }
}

/** Frames from before projects had their own store lived in one shared IndexedDB database and are unreachable now. */
export function dropLegacyIndexedDb(): void {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(LEGACY_IDB);
  } catch {
    /* ignore */
  }
}

/**
 * Key prefix the engine must use for a project, known before any storage has opened. Only the shared IndexedDB
 * fallback needs one; desktop and OPFS give each project its own folder.
 */
export function backendKeyPrefix(projectKey: string): string {
  if (desktopBridge() || opfsWritable()) return "";
  return typeof indexedDB !== "undefined" ? `${projectKey}:` : "";
}

export async function openRenderCacheBackend(projectKey: string, persistent: boolean): Promise<RenderCacheBackend> {
  if (persistent) {
    const bridge = desktopBridge();
    if (bridge) {
      await bridge.open(projectKey);
      return { store: new DesktopDiskChunkStore(bridge, projectKey), kind: "desktop-disk", keyPrefix: "", persistent: true };
    }
    if (opfsWritable()) {
      try {
        return { store: new OpfsChunkStore(await opfsProjectDir(projectKey)), kind: "opfs", keyPrefix: "", persistent: true };
      } catch {
        /* fall through to IndexedDB */
      }
    }
    if (backendKeyPrefix(projectKey) !== "") {
      return {
        store: new IndexedDbChunkStore("openreel-render-cache-v2"),
        kind: "indexeddb",
        keyPrefix: backendKeyPrefix(projectKey),
        persistent: true,
      };
    }
  }
  return { store: new MemoryChunkStore(), kind: "memory", keyPrefix: "", persistent: false };
}
