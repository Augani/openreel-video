import { v4 as uuidv4 } from "uuid";
import {
  DEFAULT_VERSION_POLICY,
  createVersionRecord,
  versionMeta,
  versionsToPrune,
  type Project,
  type ProjectVersionMeta,
  type ProjectVersionRecord,
  type VersionKind,
  type VersionPolicy,
} from "@openreel/core";
import { serializeProjectForAutoSave } from "./auto-save";

/**
 * Persistence for project versions.
 *
 * Web: one IndexedDB object store keyed by version id, indexed by project id.
 * Desktop: when the project lives in a file, its versions are kept in a sidecar
 * file next to it (`<project>.oreel.versions.json`) so they travel with the
 * project. Versions taken before the first save (no file yet) stay in IndexedDB
 * and are still listed, restored and deleted alongside the sidecar ones.
 */

export interface VersionBackend {
  list(projectId: string): Promise<ProjectVersionRecord[]>;
  put(record: ProjectVersionRecord): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
}

const DB_NAME = "openreel-versions";
const DB_VERSION = 1;
const STORE = "versions";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open the versions database"));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

const wrap = <T,>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const indexedDbBackend: VersionBackend = {
  async list(projectId) {
    const db = await openDb();
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    return wrap(store.index("projectId").getAll(projectId) as IDBRequest<ProjectVersionRecord[]>);
  },
  async put(record) {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  async remove(ids) {
    if (ids.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    for (const id of ids) tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

interface SidecarFile {
  readonly format: "openreel-versions";
  readonly version: 1;
  readonly records: ProjectVersionRecord[];
}

export const sidecarPathFor = (projectPath: string): string => `${projectPath}.versions.json`;

/** Backend for a desktop project file: every record lives in one JSON file beside it. */
export function createSidecarBackend(projectPath: string): VersionBackend {
  const path = sidecarPathFor(projectPath);
  // Read-modify-write cycles must not interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const read = async (): Promise<ProjectVersionRecord[]> => {
    let text: string;
    try {
      text = await window.openreel!.fs.readFile(path);
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(text) as Partial<SidecarFile>;
      return Array.isArray(parsed.records) ? parsed.records : [];
    } catch {
      return [];
    }
  };
  const write = async (records: ProjectVersionRecord[]): Promise<void> => {
    const file: SidecarFile = { format: "openreel-versions", version: 1, records };
    await window.openreel!.fs.writeFile(path, JSON.stringify(file));
  };

  return {
    list: (projectId) => serial(async () => (await read()).filter((r) => r.projectId === projectId)),
    put: (record) =>
      serial(async () => {
        const records = (await read()).filter((r) => r.id !== record.id);
        await write([...records, record]);
      }),
    remove: (ids) =>
      serial(async () => {
        const drop = new Set(ids);
        const records = await read();
        const kept = records.filter((r) => !drop.has(r.id));
        if (kept.length !== records.length) await write(kept);
      }),
  };
}

let override: VersionBackend[] | null = null;

/** Tests inject backends; pass null to restore the real ones. */
export function setVersionBackendsForTests(backends: VersionBackend[] | null): void {
  override = backends;
}

/** The backends that may hold versions of the open project, preferred (write target) first. */
async function backends(): Promise<VersionBackend[]> {
  if (override) return override;
  const list: VersionBackend[] = [];
  if (typeof window !== "undefined" && window.openreel?.fs) {
    const { projectManager } = await import("./project-manager");
    const path = projectManager.getCurrentProjectPath();
    if (path) list.push(createSidecarBackend(path));
  }
  list.push(indexedDbBackend);
  return list;
}

const byNewest = (a: { createdAt: number }, b: { createdAt: number }): number => b.createdAt - a.createdAt;

/** Every version of the project, newest first (full records, snapshot data included). */
async function listRecords(projectId: string): Promise<ProjectVersionRecord[]> {
  const merged = new Map<string, ProjectVersionRecord>();
  for (const backend of await backends()) {
    try {
      for (const record of await backend.list(projectId)) if (!merged.has(record.id)) merged.set(record.id, record);
    } catch (error) {
      console.warn("[Versions] Could not read a version store", error);
    }
  }
  return [...merged.values()].sort(byNewest);
}

export async function listVersions(projectId: string): Promise<ProjectVersionMeta[]> {
  return (await listRecords(projectId)).map(versionMeta);
}

export async function getVersion(projectId: string, id: string): Promise<ProjectVersionRecord | null> {
  return (await listRecords(projectId)).find((r) => r.id === id) ?? null;
}

export async function deleteVersions(ids: readonly string[]): Promise<void> {
  for (const backend of await backends()) await backend.remove(ids);
}

/** Apply the retention policy to a project's versions. Returns the ids removed. */
export async function pruneVersions(projectId: string, policy: VersionPolicy = DEFAULT_VERSION_POLICY): Promise<string[]> {
  const doomed = versionsToPrune(await listVersions(projectId), policy);
  if (doomed.length > 0) await deleteVersions(doomed);
  return doomed;
}

export interface CreateVersionOptions {
  readonly kind: VersionKind;
  readonly name?: string;
  /** Already serialized snapshot, when the caller has one (avoids serializing twice). */
  readonly data?: string;
  readonly policy?: VersionPolicy;
}

/** Store a snapshot of `project` and prune the project's versions to the policy. */
export async function createVersion(project: Project, options: CreateVersionOptions): Promise<ProjectVersionMeta> {
  const data = options.data ?? serializeProjectForAutoSave(project);
  const record = createVersionRecord({ id: uuidv4(), project, data, kind: options.kind, name: options.name });
  const [target] = await backends();
  await target.put(record);
  await pruneVersions(project.id, options.policy);
  notifyVersionsChanged();
  return versionMeta(record);
}

export async function removeVersion(id: string): Promise<void> {
  await deleteVersions([id]);
  notifyVersionsChanged();
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** The Versions panel refreshes through this when a version is added or removed (manual or automatic). */
export function onVersionsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyVersionsChanged(): void {
  for (const listener of [...listeners]) listener();
}
