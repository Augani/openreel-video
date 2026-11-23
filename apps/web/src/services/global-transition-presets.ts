import { useSyncExternalStore } from "react";
import { v4 as uuidv4 } from "uuid";
import type { TransitionType } from "@openreel/core";
import { getDefaultTransitionParams } from "@openreel/core";
import { createTransitionPreset, type TransitionPreset } from "@openreel/core/video/transition-presets";
import { parseTransitionPresetFile, serializeTransitionPresets } from "@openreel/core/video/transition-preset-file";

/**
 * The app-wide transition preset library: presets saved here are on every project in this browser profile (or
 * desktop app), next to the ones a project carries itself. They live in IndexedDB like the other per-user libraries
 * (colour looks, motion presets) and move between machines as a small JSON file. A project never depends on this
 * library: applying a preset copies its parameters onto the transition, and a default transition keeps the values it
 * was set with, so a project opened where the preset does not exist still plays and exports unchanged.
 */

const DB_NAME = "openreel-transition-presets";
const DB_VERSION = 1;
const STORE = "presets";

export interface PresetBackend {
  list(): Promise<TransitionPreset[]>;
  put(preset: TransitionPreset): Promise<void>;
  remove(id: string): Promise<void>;
  /** False when nothing is written to disk (storage is unavailable), so the library says so instead of losing presets quietly. */
  readonly persistent: boolean;
}

export function createIdbBackend(factory: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB): PresetBackend {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (!factory) return reject(new Error("IndexedDB is not available"));
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      };
    });
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    persistent: !!factory,
    list: () => run<TransitionPreset[]>("readonly", (store) => store.getAll()),
    put: async (preset) => void (await run("readwrite", (store) => store.put(preset))),
    remove: async (id) => void (await run("readwrite", (store) => store.delete(id))),
  };
}

export type LibraryOutcome<T = undefined> = { readonly ok: true; readonly value: T; readonly message: string } | { readonly ok: false; readonly error: string };

export interface ImportSummary {
  readonly added: TransitionPreset[];
  readonly skipped: readonly { name: string; reason: string }[];
}

export class GlobalTransitionPresetLibrary {
  private presets: readonly TransitionPreset[] = [];
  private loaded: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly backend: PresetBackend) {}

  get persistent(): boolean {
    return this.backend.persistent;
  }

  getSnapshot = (): readonly TransitionPreset[] => this.presets;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.load();
    return () => this.listeners.delete(listener);
  };

  private emit(next: readonly TransitionPreset[]): void {
    this.presets = [...next].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
    this.listeners.forEach((listener) => listener());
  }

  /** Reads the stored presets (once); a storage failure leaves the library empty rather than throwing. */
  load(force = false): Promise<void> {
    if (!this.loaded || force) {
      this.loaded = this.backend
        .list()
        .then((stored) => this.emit(stored.filter((preset) => createTransitionPreset({ ...preset, createdAt: preset.createdAt }).ok)))
        .catch(() => undefined);
    }
    return this.loaded;
  }

  async list(): Promise<readonly TransitionPreset[]> {
    await this.load();
    return this.presets;
  }

  async find(id: string): Promise<TransitionPreset | undefined> {
    return (await this.list()).find((preset) => preset.id === id);
  }

  async save(name: string, source: { type: TransitionType; duration: number; params: Record<string, unknown> }): Promise<LibraryOutcome<TransitionPreset>> {
    await this.load();
    const created = createTransitionPreset({
      id: `gtpreset-${uuidv4()}`,
      name,
      type: source.type,
      duration: source.duration,
      params: { ...getDefaultTransitionParams(source.type), ...source.params },
    });
    if (!created.ok) return { ok: false, error: created.error };
    if (this.presets.some((preset) => preset.name.toLowerCase() === created.value.name.toLowerCase())) {
      return { ok: false, error: `A library preset named "${created.value.name}" already exists` };
    }
    try {
      await this.backend.put(created.value);
    } catch {
      return { ok: false, error: "The preset could not be stored in this browser" };
    }
    this.emit([...this.presets, created.value]);
    return { ok: true, value: created.value, message: `Saved "${created.value.name}" to the preset library` };
  }

  async rename(id: string, name: string): Promise<LibraryOutcome> {
    await this.load();
    const trimmed = name.trim();
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (!preset) return { ok: false, error: "That preset no longer exists" };
    if (!trimmed) return { ok: false, error: "Give the preset a name" };
    if (this.presets.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: `A library preset named "${trimmed}" already exists` };
    }
    const next = { ...preset, name: trimmed };
    try {
      await this.backend.put(next);
    } catch {
      return { ok: false, error: "The preset could not be renamed" };
    }
    this.emit(this.presets.map((candidate) => (candidate.id === id ? next : candidate)));
    return { ok: true, value: undefined, message: `Renamed to "${trimmed}"` };
  }

  async remove(id: string): Promise<LibraryOutcome> {
    await this.load();
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (!preset) return { ok: false, error: "That preset no longer exists" };
    try {
      await this.backend.remove(id);
    } catch {
      return { ok: false, error: "The preset could not be deleted" };
    }
    this.emit(this.presets.filter((candidate) => candidate.id !== id));
    return { ok: true, value: undefined, message: `Deleted "${preset.name}" from the preset library` };
  }

  async exportJson(): Promise<string> {
    return serializeTransitionPresets(await this.list());
  }

  /** Adds the presets of an exported file; names that clash are numbered, entries this build does not understand are skipped. */
  async importJson(text: string): Promise<LibraryOutcome<ImportSummary>> {
    await this.load();
    const parsed = parseTransitionPresetFile(text, () => `gtpreset-${uuidv4()}`, this.presets.map((preset) => preset.name));
    if (parsed.error) return { ok: false, error: parsed.error };
    const added: TransitionPreset[] = [];
    for (const preset of parsed.presets) {
      try {
        await this.backend.put(preset);
        added.push(preset);
      } catch {
        return { ok: false, error: "The presets could not be stored in this browser" };
      }
    }
    this.emit([...this.presets, ...added]);
    const skipped = parsed.skipped.length ? `, ${parsed.skipped.length} skipped` : "";
    return { ok: true, value: { added, skipped: parsed.skipped }, message: `Imported ${added.length} preset${added.length === 1 ? "" : "s"}${skipped}` };
  }
}

let shared: GlobalTransitionPresetLibrary | null = null;

/** The app's library (created on first use, so nothing opens IndexedDB until a picker or tool asks). */
export function getGlobalTransitionPresets(): GlobalTransitionPresetLibrary {
  shared ??= new GlobalTransitionPresetLibrary(createIdbBackend());
  return shared;
}

/** Test seam: replace the app's library (null restores the default). */
export function setGlobalTransitionPresetsForTests(library: GlobalTransitionPresetLibrary | null): void {
  shared = library;
}

const EMPTY: readonly TransitionPreset[] = [];

/** The app-wide presets, live. */
export function useGlobalTransitionPresets(): readonly TransitionPreset[] {
  const library = getGlobalTransitionPresets();
  return useSyncExternalStore(library.subscribe, library.getSnapshot, () => EMPTY);
}
