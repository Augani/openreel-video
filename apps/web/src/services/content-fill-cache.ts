import { registerRemovalAnalysis, setRemovalAnalysisLoader } from "@openreel/core/video/content-aware-fill/registry";
import type { RemovalAnalysis } from "@openreel/core/video/content-aware-fill/types";

/**
 * The Remove Object analysis cache on disk (IndexedDB), per clip and analysis key. The project file only holds the
 * key; this is where the render path finds the fill again after a reload. Best effort: without IndexedDB the
 * analysis lives in memory for the session and the clip asks to be analysed again afterwards.
 */
const DB_NAME = "openreel-content-fill";
const STORE = "analyses";
const KEEP = 12;

interface Row { id: string; savedAt: number; analysis: RemovalAnalysis }

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });

export async function saveRemovalAnalysis(clipId: string, analysis: RemovalAnalysis): Promise<void> {
  registerRemovalAnalysis(clipId, analysis);
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ id: `${clipId}:${analysis.key}`, savedAt: Date.now(), analysis } satisfies Row);
    const all = store.getAll();
    all.onsuccess = () => {
      const rows = (all.result as Row[]).sort((a, b) => b.savedAt - a.savedAt);
      for (const row of rows.slice(KEEP)) store.delete(row.id);
    };
    await done(tx);
  } catch {
    // a full or blocked store only costs the reload
  } finally {
    db.close();
  }
}

export async function loadRemovalAnalysis(clipId: string, key: string): Promise<RemovalAnalysis | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await new Promise<RemovalAnalysis | null>((resolve) => {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      const request = store.get(`${clipId}:${key}`);
      request.onsuccess = () => {
        const own = (request.result as Row | undefined)?.analysis;
        if (own) { resolve(own); return; }
        // A duplicated or pasted clip carries the key of the clip it was copied from: that analysis is of the same footage.
        const all = store.getAll();
        all.onsuccess = () => resolve((all.result as Row[]).find((row) => row.analysis.key === key)?.analysis ?? null);
        all.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

setRemovalAnalysisLoader(loadRemovalAnalysis);
