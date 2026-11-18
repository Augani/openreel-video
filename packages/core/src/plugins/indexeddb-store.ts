/**
 * Web persistence for installed plugins: one IndexedDB object store keyed by
 * plugin id holding the validated LoadedPlugin (manifest + source text).
 * Stored plugins are re-validated on load, so a tampered record is skipped
 * instead of trusted.
 */

import { parsePluginPackage, pluginToFiles, type LoadedPlugin } from "./package";
import type { PluginStore } from "./registry";

const DB_NAME = "openreel-effect-plugins";
const STORE = "plugins";

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the plugin database"));
  });
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("plugin database request failed"));
  });
}

interface Row {
  id: string;
  files: Record<string, string>;
  installedAt: number;
}

export class IndexedDbPluginStore implements PluginStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private get(): Promise<IDBDatabase> {
    return (this.db ??= open(this.factory));
  }

  async list(): Promise<LoadedPlugin[]> {
    const db = await this.get();
    const rows = await wrap<Row[]>(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
    const out: LoadedPlugin[] = [];
    for (const row of rows) {
      const parsed = parsePluginPackage(new Map(Object.entries(row.files)));
      if (parsed.ok) out.push(parsed.plugin);
    }
    return out;
  }

  async put(plugin: LoadedPlugin): Promise<void> {
    const db = await this.get();
    const row: Row = { id: plugin.manifest.id, files: pluginToFiles(plugin), installedAt: Date.now() };
    await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).put(row));
  }

  async remove(id: string): Promise<void> {
    const db = await this.get();
    await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  }
}
