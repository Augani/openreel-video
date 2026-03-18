import type { Project } from "../types";
import { serializeProject, deserializeProject } from "../utils/serialization";
import {
  DB_NAME,
  DB_VERSION,
  STORES,
  type IStorageEngine,
  type ProjectRecord,
  type ProjectSummary,
  type MediaRecord,
  type CacheRecord,
  type WaveformRecord,
  type StorageUsage,
  type StorageError,
  type StorageErrorCode,
} from "./types";

function createStorageError(
  code: StorageErrorCode,
  message: string,
  quotaInfo?: StorageError["quotaInfo"],
): StorageError {
  return { code, message, quotaInfo };
}

export class StorageEngine implements IStorageEngine {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = this.openDatabase();
    this.db = await this.dbPromise;
    return this.db;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(
          createStorageError(
            "BROWSER_NOT_SUPPORTED",
            "IndexedDB is not supported in this environment",
          ),
        );
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(
          createStorageError(
            "DATABASE_ERROR",
            `Failed to open database: ${request.error?.message}`,
          ),
        );
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
    });
  }

  private createStores(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
      const projectStore = db.createObjectStore(STORES.PROJECTS, {
        keyPath: "id",
      });
      projectStore.createIndex("modifiedAt", "modifiedAt", { unique: false });
      projectStore.createIndex("name", "name", { unique: false });
    }

    if (!db.objectStoreNames.contains(STORES.MEDIA)) {
      const mediaStore = db.createObjectStore(STORES.MEDIA, { keyPath: "id" });
      mediaStore.createIndex("projectId", "projectId", { unique: false });
    }

    if (!db.objectStoreNames.contains(STORES.CACHE)) {
      const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: "key" });
      cacheStore.createIndex("timestamp", "timestamp", { unique: false });
    }

    if (!db.objectStoreNames.contains(STORES.WAVEFORMS)) {
      db.createObjectStore(STORES.WAVEFORMS, { keyPath: "mediaId" });
    }

    if (!db.objectStoreNames.contains(STORES.FILE_HANDLES)) {
      db.createObjectStore(STORES.FILE_HANDLES, { keyPath: "key" });
    }

    if (!db.objectStoreNames.contains(STORES.DIR_HANDLES)) {
      db.createObjectStore(STORES.DIR_HANDLES, { keyPath: "key" });
    }
  }

  /**
   * Generic transaction wrapper for IDB operations.
   * Wraps callback-based IDB API in Promise for easier async/await handling.
   * Automatically creates transaction with specified mode and stores.
   *
   * Note: IDB transactions are short-lived. If the promise doesn't resolve quickly,
   * the transaction may abort. Large operations should batch requests.
   */
  private async transaction<T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    operation: (stores: Record<string, IDBObjectStore>) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const stores: Record<string, IDBObjectStore> = {};

      // Normalize store names to array and create object store map
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of names) {
        stores[name] = tx.objectStore(name);
      }

      // Execute the operation callback to get the request
      const request = operation(stores);

      // Promise resolution based on IDB request lifecycle
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          createStorageError(
            "DATABASE_ERROR",
            `Transaction failed: ${request.error?.message}`,
          ),
        );
    });
  }

  private async transactionGetAll<T>(
    storeName: string,
    indexName?: string,
    query?: IDBValidKey | IDBKeyRange,
  ): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const target = indexName ? store.index(indexName) : store;
      const request = query ? target.getAll(query) : target.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          createStorageError(
            "DATABASE_ERROR",
            `Failed to get all: ${request.error?.message}`,
          ),
        );
    });
  }

  async saveProject(project: Project): Promise<void> {
    try {
      const serialized = serializeProject(project);
      const record: ProjectRecord = {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        modifiedAt: project.modifiedAt,
        data: serialized,
      };

      await this.transaction(STORES.PROJECTS, "readwrite", (stores) =>
        stores[STORES.PROJECTS].put(record),
      );
    } catch (error) {
      if ((error as StorageError).code) {
        throw error;
      }
      throw createStorageError(
        "SERIALIZATION_FAILED",
        `Failed to serialize project: ${(error as Error).message}`,
      );
    }
  }

  async loadProject(id: string): Promise<Project | null> {
    try {
      const record = await this.transaction<ProjectRecord | undefined>(
        STORES.PROJECTS,
        "readonly",
        (stores) => stores[STORES.PROJECTS].get(id),
      );

      if (!record) {
        return null;
      }

      return deserializeProject(record.data);
    } catch (error) {
      if ((error as StorageError).code) {
        throw error;
      }
      throw createStorageError(
        "DESERIALIZATION_FAILED",
        `Failed to deserialize project: ${(error as Error).message}`,
      );
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const records = await this.transactionGetAll<ProjectRecord>(
      STORES.PROJECTS,
    );

    return records
      .map((record) => ({
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        modifiedAt: record.modifiedAt,
      }))
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.getDb();

    const mediaRecords = await this.getMediaByProject(id);
    for (const media of mediaRecords) {
      await this.deleteMedia(media.id);
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.PROJECTS, "readwrite");
      const store = tx.objectStore(STORES.PROJECTS);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(
          createStorageError(
            "DATABASE_ERROR",
            `Failed to delete project: ${request.error?.message}`,
          ),
        );
    });
  }

  async saveMedia(media: MediaRecord): Promise<void> {
    await this.transaction(STORES.MEDIA, "readwrite", (stores) =>
      stores[STORES.MEDIA].put(media),
    );
  }

  async loadMedia(id: string): Promise<MediaRecord | null> {
    const record = await this.transaction<MediaRecord | undefined>(
      STORES.MEDIA,
      "readonly",
      (stores) => stores[STORES.MEDIA].get(id),
    );
    return record || null;
  }

  async deleteMedia(id: string): Promise<void> {
    await this.deleteWaveform(id);

    await this.transaction(STORES.MEDIA, "readwrite", (stores) =>
      stores[STORES.MEDIA].delete(id),
    );
  }

  async getMediaByProject(projectId: string): Promise<MediaRecord[]> {
    return this.transactionGetAll<MediaRecord>(
      STORES.MEDIA,
      "projectId",
      projectId,
    );
  }

  async saveCache(record: CacheRecord): Promise<void> {
    await this.transaction(STORES.CACHE, "readwrite", (stores) =>
      stores[STORES.CACHE].put(record),
    );
  }

  async loadCache(key: string): Promise<CacheRecord | null> {
    const record = await this.transaction<CacheRecord | undefined>(
      STORES.CACHE,
      "readonly",
      (stores) => stores[STORES.CACHE].get(key),
    );

    if (record) {
      const updated: CacheRecord = {
        ...record,
        timestamp: Date.now(),
      };
      await this.saveCache(updated);
      return updated;
    }

    return null;
  }

  async deleteCache(key: string): Promise<void> {
    await this.transaction(STORES.CACHE, "readwrite", (stores) =>
      stores[STORES.CACHE].delete(key),
    );
  }

  async clearCache(): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CACHE, "readwrite");
      const store = tx.objectStore(STORES.CACHE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(
          createStorageError(
            "DATABASE_ERROR",
            `Failed to clear cache: ${request.error?.message}`,
          ),
        );
    });
  }

  async saveWaveform(record: WaveformRecord): Promise<void> {
    await this.transaction(STORES.WAVEFORMS, "readwrite", (stores) =>
      stores[STORES.WAVEFORMS].put(record),
    );
  }

  async loadWaveform(mediaId: string): Promise<WaveformRecord | null> {
    const record = await this.transaction<WaveformRecord | undefined>(
      STORES.WAVEFORMS,
      "readonly",
      (stores) => stores[STORES.WAVEFORMS].get(mediaId),
    );
    return record || null;
  }

  async deleteWaveform(mediaId: string): Promise<void> {
    await this.transaction(STORES.WAVEFORMS, "readwrite", (stores) =>
      stores[STORES.WAVEFORMS].delete(mediaId),
    );
  }

  async getStorageUsage(): Promise<StorageUsage> {
    const db = await this.getDb();

    const projectCount = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORES.PROJECTS, "readonly");
      const store = tx.objectStore(STORES.PROJECTS);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const mediaCount = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORES.MEDIA, "readonly");
      const store = tx.objectStore(STORES.MEDIA);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    let used = 0;
    let quota = 0;

    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        used = estimate.usage || 0;
        quota = estimate.quota || 0;
      } catch {}
    }

    return {
      used,
      quota,
      projects: projectCount,
      mediaItems: mediaCount,
    };
  }

  async saveFileHandle(name: string, size: number, handle: FileSystemFileHandle): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.FILE_HANDLES, "readwrite");
      const store = tx.objectStore(STORES.FILE_HANDLES);
      const request = store.put({ key: `${name}:${size}`, handle });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async loadFileHandle(name: string, size: number): Promise<FileSystemFileHandle | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.FILE_HANDLES, "readonly");
      const store = tx.objectStore(STORES.FILE_HANDLES);
      const request = store.get(`${name}:${size}`);
      request.onsuccess = () => resolve((request.result as { handle: FileSystemFileHandle } | undefined)?.handle ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.DIR_HANDLES, "readwrite");
      const store = tx.objectStore(STORES.DIR_HANDLES);
      const request = store.put({ key: projectId, handle, folderName: handle.name });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async loadDirectoryHandle(projectId: string): Promise<{ handle: FileSystemDirectoryHandle; folderName: string } | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.DIR_HANDLES, "readonly");
      const store = tx.objectStore(STORES.DIR_HANDLES);
      const request = store.get(projectId);
      request.onsuccess = () => {
        const rec = request.result as { handle: FileSystemDirectoryHandle; folderName: string } | undefined;
        resolve(rec ? { handle: rec.handle, folderName: rec.folderName } : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbPromise = null;
    }
  }
}

export function createStorageEngine(): IStorageEngine {
  return new StorageEngine();
}
