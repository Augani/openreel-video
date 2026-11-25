/* global IDBValidKey */
import { parseSourceTranscriptRecord, type SourceTranscriptRecord } from "@openreel/core";

/**
 * Cache of per-asset transcripts, keyed by media content hash and held in IndexedDB (`openreel-source-transcripts`),
 * outside the project file: projects saved before this existed simply find nothing, and the same recording used in
 * another project reuses its transcript. Reads validate what comes back; storage that is unavailable degrades to a
 * cache that lasts for the session.
 */
export interface TranscriptBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryTranscriptBackend implements TranscriptBackend {
  readonly values = new Map<string, unknown>();
  async get(key: string) {
    const value = this.values.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  async put(key: string, value: unknown) {
    this.values.set(key, JSON.parse(JSON.stringify(value)));
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

const DB_NAME = "openreel-source-transcripts";
const STORE = "transcripts";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
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

async function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    try {
      const request = make(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const indexedDbBackend: TranscriptBackend = {
  get: (key) => run("readonly", (store) => store.get(key as IDBValidKey)),
  put: async (key, value) => {
    await run("readwrite", (store) => store.put(value, key as IDBValidKey));
  },
  delete: async (key) => {
    await run("readwrite", (store) => store.delete(key as IDBValidKey));
  },
};

export class SourceTranscriptStorage {
  /** Session fallback for when persistence fails, so a transcript is never lost to a full disk mid-session. */
  private readonly session = new Map<string, SourceTranscriptRecord>();

  constructor(private readonly backend: TranscriptBackend = indexedDbBackend) {}

  async get(mediaHash: string): Promise<{ record: SourceTranscriptRecord | null; raw: unknown }> {
    let raw: unknown;
    try {
      raw = await this.backend.get(mediaHash);
    } catch {
      raw = undefined;
    }
    if (raw === undefined) {
      const kept = this.session.get(mediaHash);
      return { record: kept ?? null, raw: kept };
    }
    return { record: parseSourceTranscriptRecord(raw), raw };
  }

  async save(record: SourceTranscriptRecord): Promise<void> {
    this.session.set(record.mediaHash, record);
    try {
      await this.backend.put(record.mediaHash, record);
    } catch {
      /* kept for this session only */
    }
  }

  async remove(mediaHash: string): Promise<void> {
    this.session.delete(mediaHash);
    try {
      await this.backend.delete(mediaHash);
    } catch {
      /* nothing to remove */
    }
  }
}

let shared: SourceTranscriptStorage | null = null;
export function getSourceTranscriptStorage(): SourceTranscriptStorage {
  shared ??= new SourceTranscriptStorage();
  return shared;
}
