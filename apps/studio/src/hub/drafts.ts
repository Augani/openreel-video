import { openDB, type IDBPDatabase } from "idb";
import type { Scene } from "../effect/scene";
import type { FilterDoc } from "../filter/types";

const DB_NAME = "openreel-studio";
const STORE = "drafts";
const DB_VERSION = 1;

export interface DraftRecord {
  id: string;
  kind: "effect" | "filter" | "template";
  name: string;
  doc: Scene | FilterDoc | unknown;
  thumbnailDataUrl: string;
  updatedAt: number;
  schemaVersion: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(record: DraftRecord): Promise<void> {
  const d = await db();
  await d.put(STORE, record);
}

export async function loadDraft(id: string): Promise<DraftRecord | undefined> {
  const d = await db();
  return (await d.get(STORE, id)) as DraftRecord | undefined;
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const d = await db();
  const all = (await d.getAll(STORE)) as DraftRecord[];
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}
