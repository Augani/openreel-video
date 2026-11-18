/* global IDBValidKey */
import type { ExportQueueState, Project } from "@openreel/core";
import { loadMediaBlob } from "../media-storage";

/**
 * Persistence for the export queue.
 *
 * - IndexedDB `openreel-export-queue`: the queue state, one project snapshot per
 *   job (media blobs stripped) and the media blobs themselves, stored once per
 *   (media id, size, type) so several jobs of the same project share bytes.
 * - OPFS `export-queue/`: finished files of browser jobs, so a completed export
 *   can still be downloaded after a reload.
 *
 * Everything degrades: if storage is unavailable the queue still works for the
 * current session and just does not survive a reload.
 */

const DB_NAME = "openreel-export-queue";
const DB_VERSION = 1;
const STATE_KEY = "queue";
const OUTPUT_DIR = "export-queue";

interface StoredSnapshot {
  readonly project: Project;
  /** mediaId -> media store key (only for items that had a blob). */
  readonly blobKeys: Record<string, string>;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["state", "snapshots", "media"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(
  stores: string | string[],
  mode: "readonly" | "readwrite",
  run: (t: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) return resolve(undefined);
        try {
          const t = db.transaction(stores, mode);
          const request = run(t);
          let value: T | undefined;
          if (request) request.onsuccess = () => (value = request.result);
          t.oncomplete = () => resolve(value);
          t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
          t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
        } catch (error) {
          reject(error);
        }
      }),
  );
}

export async function saveQueueState(state: ExportQueueState): Promise<void> {
  try {
    await tx("state", "readwrite", (t) => {
      t.objectStore("state").put(JSON.parse(JSON.stringify(state)), STATE_KEY);
    });
  } catch {
    /* queue persistence is best effort */
  }
}

export async function loadQueueState(): Promise<ExportQueueState | null> {
  try {
    const value = await tx<ExportQueueState>("state", "readonly", (t) => t.objectStore("state").get(STATE_KEY));
    return value && Array.isArray(value.jobs) ? value : null;
  } catch {
    return null;
  }
}

const blobKey = (id: string, blob: Blob): string => `${id}:${blob.size}:${blob.type}`;

/**
 * Snapshot blob keys that start with this prefix point at the project's own media store (the copy
 * written at import) instead of a second copy in this database. A feature-length project holds
 * gigabytes of source media; copying them into the queue's DB on every first enqueue was slow, doubled
 * the disk use and kept the snapshot transaction open for as long as the copy took, so a crash during
 * it left an `interrupted` job with no snapshot to retry from.
 */
const PROJECT_REF = "project:";

/** The project store already holds exactly these bytes (same size and type) for this media id. */
async function projectStoreHolds(id: string, blob: Blob): Promise<boolean> {
  try {
    const stored = await loadMediaBlob(id);
    return !!stored && stored.size === blob.size && stored.type === blob.type;
  } catch {
    return false;
  }
}

/** Store a job's project snapshot. Returns false when it could not be persisted. */
export async function saveSnapshot(jobId: string, project: Project): Promise<boolean> {
  try {
    const blobKeys: Record<string, string> = {};
    const blobs: Array<[string, Blob]> = [];
    const items = [] as Project["mediaLibrary"]["items"];
    for (const item of project.mediaLibrary.items) {
      if (item.blob) {
        const key = blobKey(item.id, item.blob);
        if (await projectStoreHolds(item.id, item.blob)) {
          blobKeys[item.id] = PROJECT_REF + key;
        } else {
          blobKeys[item.id] = key;
          blobs.push([key, item.blob]);
        }
      }
      items.push({ ...item, blob: null, fileHandle: null });
    }
    const stored: StoredSnapshot = { project: { ...project, mediaLibrary: { ...project.mediaLibrary, items } }, blobKeys };
    await tx(["snapshots", "media"], "readwrite", (t) => {
      const media = t.objectStore("media");
      for (const [key, blob] of blobs) {
        const existing = media.count(key);
        existing.onsuccess = () => {
          if (existing.result === 0) media.put(blob, key);
        };
      }
      t.objectStore("snapshots").put(stored, jobId);
    });
    return true;
  } catch {
    return false;
  }
}

/** Read a snapshot back with its media blobs re-attached. */
export async function loadSnapshot(jobId: string): Promise<Project | null> {
  try {
    const stored = await tx<StoredSnapshot>("snapshots", "readonly", (t) => t.objectStore("snapshots").get(jobId));
    if (!stored) return null;
    const items = [] as Project["mediaLibrary"]["items"];
    for (const item of stored.project.mediaLibrary.items) {
      const key = stored.blobKeys[item.id];
      if (!key) {
        items.push(item);
        continue;
      }
      let blob: Blob | null | undefined;
      if (key.startsWith(PROJECT_REF)) {
        // `${id}:${size}:${type}`: the bytes must still be the ones the job was queued with.
        const [, size] = key.slice(PROJECT_REF.length).split(":");
        const stored = await loadMediaBlob(item.id);
        blob = stored && String(stored.size) === size ? stored : null;
      } else {
        blob = await tx<Blob>("media", "readonly", (t) => t.objectStore("media").get(key));
      }
      if (!blob) return null;
      items.push({ ...item, blob });
    }
    return { ...stored.project, mediaLibrary: { ...stored.project.mediaLibrary, items } };
  } catch {
    return null;
  }
}

/** Drop snapshots of removed jobs and media blobs nothing references any more. */
export async function pruneStorage(liveJobIds: () => ReadonlySet<string>): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    // Snapshots first; the live set is read lazily afterwards so a job enqueued while this runs
    // (already in the queue state, snapshot possibly already written) is never treated as stale.
    const snapshotKeys = await tx<IDBValidKey[]>("snapshots", "readonly", (t) => t.objectStore("snapshots").getAllKeys());
    const live = liveJobIds();
    const stale = (snapshotKeys ?? []).filter((key) => !live.has(String(key)));
    // Blobs are swept in ONE readwrite transaction over both stores, so a snapshot saved
    // concurrently (it checks for existing blobs in a transaction of its own) cannot lose a blob.
    await tx(["snapshots", "media"], "readwrite", (t) => {
      const snapshots = t.objectStore("snapshots");
      const media = t.objectStore("media");
      for (const key of stale) snapshots.delete(key);
      const all = snapshots.getAll();
      all.onsuccess = () => {
        const used = new Set<string>();
        for (const snapshot of (all.result ?? []) as StoredSnapshot[]) {
          // Deleted-in-this-transaction snapshots are already gone from the read.
          for (const key of Object.values(snapshot.blobKeys)) used.add(key);
        }
        const keys = media.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) if (!used.has(String(key))) media.delete(key);
        };
      };
    });
  } catch {
    /* pruning is an optimisation */
  }
}

// ---- finished files (browser jobs) -----------------------------------------

type OpfsDir = FileSystemDirectoryHandle;

async function outputDir(): Promise<OpfsDir | null> {
  try {
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<OpfsDir> };
    if (typeof storage?.getDirectory !== "function") return null;
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(OUTPUT_DIR, { create: true });
  } catch {
    return null;
  }
}

const outputFileName = (jobId: string, ext: string): string => `${jobId}.${ext}`;

/** In-memory fallback for browsers without OPFS: lost on reload. */
const memoryOutputs = new Map<string, Blob>();

export interface BrowserOutputSink {
  readonly writable: FileSystemWritableFileStream;
  /** Called after a successful export; resolves the stored size. */
  finish(): Promise<number>;
  discard(): Promise<void>;
}

export async function createBrowserOutputSink(jobId: string, ext: string, mime: string): Promise<BrowserOutputSink> {
  const dir = await outputDir();
  const name = outputFileName(jobId, ext);
  if (dir) {
    try {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await (handle as FileSystemFileHandle & {
        createWritable: () => Promise<FileSystemWritableFileStream>;
      }).createWritable();
      return {
        writable,
        async finish() {
          const file = await handle.getFile();
          if (file.size === 0) throw new Error("Export produced an empty file");
          return file.size;
        },
        async discard() {
          await dir.removeEntry(name).catch(() => undefined);
        },
      };
    } catch {
      /* fall through to memory */
    }
  }
  const parts: Array<{ position: number; data: Uint8Array }> = [];
  let cursor = 0;
  let size = 0;
  const toBytes = (data: unknown): Uint8Array => {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error("Unsupported chunk written to export stream");
  };
  const put = (data: Uint8Array) => {
    parts.push({ position: cursor, data });
    cursor += data.byteLength;
    size = Math.max(size, cursor);
  };
  const sink = {
    async seek(position: number) { cursor = position; },
    async truncate(next: number) { size = next; },
    async close() {},
    async abort() { parts.length = 0; },
    async write(chunk: unknown) {
      if (chunk && typeof chunk === "object" && "type" in chunk && !(chunk instanceof Blob) && !ArrayBuffer.isView(chunk)) {
        const command = chunk as { type: string; data?: unknown; position?: number; size?: number };
        if (command.type === "seek") { cursor = command.position ?? cursor; return; }
        if (command.type === "truncate") { size = command.size ?? size; return; }
        if (command.type === "write") { if (typeof command.position === "number") cursor = command.position; put(toBytes(command.data)); return; }
      }
      put(toBytes(chunk));
    },
  };
  return {
    writable: sink as unknown as FileSystemWritableFileStream,
    async finish() {
      const buffer = new Uint8Array(size);
      for (const part of parts) buffer.set(part.data, part.position);
      if (buffer.byteLength === 0) throw new Error("Export produced an empty file");
      memoryOutputs.set(jobId, new Blob([buffer], { type: mime }));
      return buffer.byteLength;
    },
    async discard() { memoryOutputs.delete(jobId); },
  };
}

export async function readBrowserOutput(jobId: string, ext: string): Promise<Blob | null> {
  const memory = memoryOutputs.get(jobId);
  if (memory) return memory;
  const dir = await outputDir();
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(outputFileName(jobId, ext));
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteBrowserOutput(jobId: string, ext: string): Promise<void> {
  memoryOutputs.delete(jobId);
  const dir = await outputDir();
  await dir?.removeEntry(outputFileName(jobId, ext)).catch(() => undefined);
}
