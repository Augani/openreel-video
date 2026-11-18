/**
 * Per-user colour library in IndexedDB: imported LUTs and saved looks. It lives
 * outside any project so entries are reusable across projects.
 */
import type { LutLibraryEntry, SavedLook } from "@openreel/core";

const DB_NAME = "openreel-color-library";
const DB_VERSION = 1;
const LUT_STORE = "luts";
const LOOK_STORE = "looks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LUT_STORE))
        db.createObjectStore(LUT_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LOOK_STORE))
        db.createObjectStore(LOOK_STORE, { keyPath: "id" });
    };
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function byNewest<T extends { createdAt: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listLutEntries(): Promise<LutLibraryEntry[]> {
  try {
    return byNewest(await run<LutLibraryEntry[]>(LUT_STORE, "readonly", (s) => s.getAll()));
  } catch {
    return [];
  }
}

export async function saveLutEntry(entry: LutLibraryEntry): Promise<void> {
  await run(LUT_STORE, "readwrite", (s) => s.put(entry));
}

export async function deleteLutEntry(id: string): Promise<void> {
  await run(LUT_STORE, "readwrite", (s) => s.delete(id));
}

export async function listLooks(): Promise<SavedLook[]> {
  try {
    return byNewest(await run<SavedLook[]>(LOOK_STORE, "readonly", (s) => s.getAll()));
  } catch {
    return [];
  }
}

export async function saveLookEntry(look: SavedLook): Promise<void> {
  await run(LOOK_STORE, "readwrite", (s) => s.put(look));
}

export async function deleteLookEntry(id: string): Promise<void> {
  await run(LOOK_STORE, "readwrite", (s) => s.delete(id));
}
