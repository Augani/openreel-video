import { create } from "zustand";
import {
  createIngestPreset,
  deleteIngestPreset,
  duplicateIngestPreset,
  renameIngestPreset,
  sanitizeUserPresets,
  serializeUserPresets,
  updateIngestPresetProfile,
  type DesktopProxyProfile,
  type ProxyPresetEntry,
} from "@openreel/core";

/**
 * The user's own proxy presets, kept in app settings (the browser storage of this install, like the other
 * preferences), not in any project. Built-in presets live in core and are never stored here. The pure model
 * (validation, create / duplicate / rename / delete, sanitising what was read back) is in core/media/ingest-presets.
 */
export const INGEST_PRESETS_STORAGE_KEY = "openreel:ingest-presets";

export function readStoredPresets(storage: Pick<Storage, "getItem"> | null = safeStorage()): ProxyPresetEntry[] {
  try {
    const raw = storage?.getItem(INGEST_PRESETS_STORAGE_KEY);
    return raw ? sanitizeUserPresets(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeStoredPresets(presets: readonly ProxyPresetEntry[], storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(INGEST_PRESETS_STORAGE_KEY, JSON.stringify(serializeUserPresets(presets)));
  } catch {
    // Storage blocked or full: the presets last for this session only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

type Outcome = { ok: true; preset: ProxyPresetEntry } | { ok: false; error: string };

interface IngestPresetsState {
  /** The user's presets (built-ins are not in this list). */
  presets: ProxyPresetEntry[];
  create(name: string, profile: DesktopProxyProfile): Outcome;
  duplicate(sourceId: string, name?: string): Outcome;
  rename(id: string, name: string): Outcome;
  updateProfile(id: string, profile: DesktopProxyProfile): Outcome;
  remove(id: string): { ok: true } | { ok: false; error: string };
  /** Re-read storage (another window changed it). */
  reload(): void;
}

export const useIngestPresetsStore = create<IngestPresetsState>((set, get) => {
  const commit = (result: { ok: true; presets: ProxyPresetEntry[]; preset: ProxyPresetEntry } | { ok: false; error: string }): Outcome => {
    if (!result.ok) return result;
    set({ presets: result.presets });
    writeStoredPresets(result.presets);
    return { ok: true, preset: result.preset };
  };
  return {
    presets: readStoredPresets(),
    create: (name, profile) => commit(createIngestPreset(get().presets, name, profile)),
    duplicate: (sourceId, name) => commit(duplicateIngestPreset(get().presets, sourceId, name)),
    rename: (id, name) => commit(renameIngestPreset(get().presets, id, name)),
    updateProfile: (id, profile) => commit(updateIngestPresetProfile(get().presets, id, profile)),
    remove: (id) => {
      const result = deleteIngestPreset(get().presets, id);
      if (!result.ok) return result;
      set({ presets: result.presets });
      writeStoredPresets(result.presets);
      return { ok: true };
    },
    reload: () => set({ presets: readStoredPresets() }),
  };
});

// Another window of the app edited the presets.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === INGEST_PRESETS_STORAGE_KEY) useIngestPresetsStore.getState().reload();
  });
}
