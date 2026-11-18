/** Byte storage for encoded cache frames, keyed by string. */
export interface ChunkStore {
  put(key: string, data: ArrayBuffer): Promise<void>;
  get(key: string): Promise<ArrayBuffer | undefined>;
  delete(keys: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  /** Delete every entry whose key fails `keep` (startup sweep of dead sessions). */
  purge?(keep: (key: string) => boolean): Promise<number>;
  /** Total stored bytes if the backend can tell cheaply (used by tests and diagnostics). */
  size?(): Promise<number>;
}

export class MemoryChunkStore implements ChunkStore {
  private readonly map = new Map<string, ArrayBuffer>();

  async put(key: string, data: ArrayBuffer): Promise<void> {
    this.map.set(key, data);
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    return this.map.get(key);
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  async purge(keep: (key: string) => boolean): Promise<number> {
    let removed = 0;
    for (const key of Array.from(this.map.keys())) {
      if (!keep(key)) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async size(): Promise<number> {
    let total = 0;
    for (const data of this.map.values()) total += data.byteLength;
    return total;
  }

  get keys(): string[] {
    return Array.from(this.map.keys());
  }
}

const DB_VERSION = 1;
const STORE = "frames";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Persistent frame store backed by IndexedDB (works in browsers and Electron renderers). */
export class IndexedDbChunkStore implements ChunkStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName = "openreel-render-cache",
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = this.factory.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async put(key: string, data: ArrayBuffer): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data, key);
    await transactionDone(tx);
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readonly");
    const value = await request(tx.objectStore(STORE).get(key));
    return value as ArrayBuffer | undefined;
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const key of keys) store.delete(key);
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await transactionDone(tx);
  }

  async purge(keep: (key: string) => boolean): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const keys = (await request(store.getAllKeys())) as IDBValidKey[];
    let removed = 0;
    for (const key of keys) {
      if (typeof key === "string" && !keep(key)) {
        store.delete(key);
        removed++;
      }
    }
    await transactionDone(tx);
    return removed;
  }

  async size(): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readonly");
    const values = (await request(tx.objectStore(STORE).getAll())) as ArrayBuffer[];
    return values.reduce((sum, value) => sum + value.byteLength, 0);
  }

  close(): void {
    void this.dbPromise?.then((db) => db.close()).catch(() => undefined);
    this.dbPromise = null;
  }
}
