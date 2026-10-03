import type { Project } from "@openreel/core";

export interface AutoSaveConfig {
  interval: number;
  maxSlots: number;
  enabled: boolean;
  debounceTime: number;
}

export interface AutoSaveMetadata {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: number;
  slot: number;
  isRecovery: boolean;
}

interface AutoSaveRecord {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: number;
  slot: number;
  data: string;
}

const DEFAULT_CONFIG: AutoSaveConfig = {
  interval: 30000, // 30 seconds
  maxSlots: 3,
  enabled: true,
  debounceTime: 2000, // 2 seconds
};

const AUTO_SAVE_DB_NAME = "openreel-autosave";
const AUTO_SAVE_DB_VERSION = 1;
const AUTO_SAVE_STORE = "autosaves";

export function serializeProjectForAutoSave(project: Project): string {
  const mediaItems = project.mediaLibrary.items.map((item) => ({
    ...item,
    blob: null,
    fileHandle: null,
    waveformData: null,
    thumbnailUrl: item.thumbnailUrl?.startsWith("blob:")
      ? null
      : item.thumbnailUrl,
    filmstripThumbnails: undefined,
  }));

  return JSON.stringify({
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: mediaItems,
    },
  });
}

type AutoSaveEventType = "saved" | "restored" | "error" | "recoveryAvailable";
type AutoSaveEventCallback = (data?: unknown) => void;

export class AutoSaveManager {
  private config: AutoSaveConfig;
  private db: IDBDatabase | null = null;
  private initializationPromise: Promise<void> | null = null;
  private savePromise: Promise<void> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private debounceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSavedData: string = "";
  private currentSlot: number = 0;
  private listeners: Map<AutoSaveEventType, Set<AutoSaveEventCallback>> =
    new Map();

  private pendingProject: Project | null = null;
  private isDirty: boolean = false;
  private dirtyRevision = 0;
  private getProject: (() => Project) | null = null;

  private flushOnHide = (): void => {
    if (this.getProject) this.pendingProject = this.getProject();
    this.requestSave();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.flushOnHide();
  };

  constructor(config: Partial<AutoSaveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.config.maxSlots = Math.max(1, Math.floor(this.config.maxSlots) || 1);
  }

  isInitialized(): boolean {
    return this.db !== null;
  }

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this.openDatabase()
      .then((db) => {
        this.db = db;
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
        };
      })
      .catch((error) => {
        console.error("[AutoSave] Failed to initialize:", error);
        this.emit("error", { error, message: "Failed to initialize auto-save" });
      })
      .finally(() => {
        this.initializationPromise = null;
      });
    return this.initializationPromise;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not supported"));
        return;
      }

      const request = indexedDB.open(AUTO_SAVE_DB_NAME, AUTO_SAVE_DB_VERSION);

      request.onerror = () => {
        reject(
          new Error(
            `Failed to open auto-save database: ${request.error?.message}`,
          ),
        );
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(AUTO_SAVE_STORE)) {
          const store = db.createObjectStore(AUTO_SAVE_STORE, {
            keyPath: "id",
          });
          store.createIndex("projectId", "projectId", { unique: false });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("slot", "slot", { unique: false });
        }
      };
    });
  }

  start(getProject: () => Project): void {
    this.stop();
    this.getProject = getProject;
    this.pendingProject = getProject();

    if (!this.config.enabled) {
      return;
    }

    this.requestSave();

    // Set up periodic saves
    this.intervalId = setInterval(() => {
      this.pendingProject = getProject();
      this.requestSave();
    }, this.config.interval);

    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.flushOnHide);
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.debounceTimeoutId) {
      clearTimeout(this.debounceTimeoutId);
      this.debounceTimeoutId = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.flushOnHide);
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.getProject = null;
  }

  markDirty(project?: Project): void {
    // Capture the state that caused this dirty notification. The debounce can
    // fire well before the periodic refresh in start(), so relying on the
    // previous pendingProject would save an older snapshot.
    if (project) {
      this.pendingProject = project;
    } else if (this.getProject) {
      this.pendingProject = this.getProject();
    }
    this.isDirty = true;
    this.dirtyRevision += 1;

    if (!this.config.enabled) return;

    // Debounce the save
    if (this.debounceTimeoutId) {
      clearTimeout(this.debounceTimeoutId);
    }

    this.debounceTimeoutId = setTimeout(() => {
      this.debounceTimeoutId = null;
      this.requestSave();
    }, this.config.debounceTime);
  }

  private requestSave(): void {
    // Background failures are reported by flushPending; explicit forceSave calls
    // keep the rejection so callers cannot report an unsuccessful save as saved.
    void this.saveIfDirty().catch(() => {});
  }

  private async saveIfDirty(force = false): Promise<void> {
    if (!this.config.enabled && !force) return;
    if (this.savePromise) {
      await this.savePromise;
      if (force && this.isDirty) await this.saveIfDirty(true);
      return;
    }

    const pending = this.flushPending(force);
    this.savePromise = pending;
    try {
      await pending;
    } finally {
      this.savePromise = null;
    }
  }

  private async flushPending(force: boolean): Promise<void> {
    try {
      while (this.pendingProject && this.isDirty && (this.config.enabled || force)) {
        const project = this.pendingProject;
        const revision = this.dirtyRevision;
        const data = serializeProjectForAutoSave(project);

        if (data !== this.lastSavedData) {
          await this.save(project, data);
          this.lastSavedData = data;
        }

        // Edits arriving while IndexedDB commits must be saved in a subsequent
        // snapshot. Never let an older write mark those newer edits as clean.
        this.isDirty = revision !== this.dirtyRevision;
      }
    } catch (error) {
      console.error("[AutoSave] Save failed:", error);
      this.emit("error", { error, message: "Auto-save failed" });
      throw error;
    }
  }

  private async save(project: Project, data: string): Promise<void> {
    if (!this.db) await this.initialize();
    if (!this.db) {
      throw new Error("Auto-save database not initialized");
    }

    const record: AutoSaveRecord = {
      id: `${project.id}-slot-${this.currentSlot}`,
      projectId: project.id,
      projectName: project.name,
      timestamp: Date.now(),
      slot: this.currentSlot,
      data,
    };

    await this.saveRecord(record);

    this.currentSlot = (this.currentSlot + 1) % this.config.maxSlots;

    this.emit("saved", {
      projectId: project.id,
      timestamp: record.timestamp,
      slot: record.slot,
    });
  }

  private saveRecord(record: AutoSaveRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const tx = this.db.transaction(AUTO_SAVE_STORE, "readwrite");
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.put(record);

      // A successful request is still provisional until its transaction commits.
      // Keep retention in this transaction and read keys only, avoiding copies
      // of every large project snapshot on every auto-save.
      const retainedIds = new Set(
        Array.from({ length: this.config.maxSlots }, (_, slot) =>
          `${record.projectId}-slot-${slot}`,
        ),
      );
      const keys = store.index("projectId").getAllKeys(record.projectId);
      keys.onsuccess = () => {
        for (const id of keys.result) {
          if (!retainedIds.has(String(id))) store.delete(id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Auto-save transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Auto-save transaction failed"));
      request.onerror = () =>
        reject(new Error(`Failed to save: ${request.error?.message}`));
      keys.onerror = () => reject(keys.error ?? new Error("Failed to prune auto-saves"));
    });
  }

  private deleteRecord(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const tx = this.db.transaction(AUTO_SAVE_STORE, "readwrite");
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Auto-save delete aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Auto-save delete failed"));
      request.onerror = () =>
        reject(new Error(`Failed to delete: ${request.error?.message}`));
    });
  }

  private getAllSaves(): Promise<AutoSaveRecord[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const tx = this.db.transaction(AUTO_SAVE_STORE, "readonly");
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error(`Failed to get saves: ${request.error?.message}`));
    });
  }

  async checkForRecovery(projectId?: string): Promise<AutoSaveMetadata[]> {
    if (!this.db) {
      await this.initialize();
    }

    try {
      const allSaves = await this.getAllSaves();

      let saves = allSaves;
      if (projectId) {
        saves = allSaves.filter((s) => s.projectId === projectId);
      }

      const metadata: AutoSaveMetadata[] = saves
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((s) => ({
          id: s.id,
          projectId: s.projectId,
          projectName: s.projectName,
          timestamp: s.timestamp,
          slot: s.slot,
          isRecovery: true,
        }));

      if (metadata.length > 0) {
        this.emit("recoveryAvailable", { saves: metadata });
      }

      return metadata;
    } catch (error) {
      console.error("[AutoSave] Failed to check for recovery:", error);
      return [];
    }
  }

  async recover(saveId: string): Promise<Project | null> {
    if (!this.db) {
      await this.initialize();
    }

    try {
      const record = await this.getRecord(saveId);
      if (!record) {
        console.warn(`[AutoSave] No save found with id: ${saveId}`);
        return null;
      }

      const project = JSON.parse(record.data) as Project;

      this.emit("restored", { project, timestamp: record.timestamp });
      return project;
    } catch (error) {
      console.error("[AutoSave] Recovery failed:", error);
      this.emit("error", { error, message: "Failed to recover project" });
      return null;
    }
  }

  private getRecord(id: string): Promise<AutoSaveRecord | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }

      const tx = this.db.transaction(AUTO_SAVE_STORE, "readonly");
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () =>
        reject(new Error(`Failed to get record: ${request.error?.message}`));
    });
  }

  async getMostRecentSave(projectId: string): Promise<AutoSaveMetadata | null> {
    const saves = await this.checkForRecovery(projectId);
    return saves.length > 0 ? saves[0] : null;
  }

  async clearProjectSaves(projectId: string): Promise<void> {
    if (!this.db) return;

    const allSaves = await this.getAllSaves();
    const projectSaves = allSaves.filter((s) => s.projectId === projectId);

    for (const save of projectSaves) {
      await this.deleteRecord(save.id);
    }
  }

  async clearAllSaves(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(AUTO_SAVE_STORE, "readwrite");
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.clear();

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Clearing auto-saves aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Clearing auto-saves failed"));
      request.onerror = () =>
        reject(new Error(`Failed to clear: ${request.error?.message}`));
    });
  }

  updateConfig(config: Partial<AutoSaveConfig>): void {
    this.config = { ...this.config, ...config };
    this.config.maxSlots = Math.max(1, Math.floor(this.config.maxSlots) || 1);
    this.currentSlot %= this.config.maxSlots;
    if (this.getProject) this.start(this.getProject);
  }

  getConfig(): AutoSaveConfig {
    return { ...this.config };
  }

  on(event: AutoSaveEventType, callback: AutoSaveEventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: AutoSaveEventType, callback: AutoSaveEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: AutoSaveEventType, data?: unknown): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error("[AutoSave] Event callback error:", error);
      }
    });
  }

  async forceSave(project: Project): Promise<void> {
    this.pendingProject = project;
    this.isDirty = true;
    this.dirtyRevision += 1;
    await this.saveIfDirty(true);
  }

  /**
   * Whether the given project has edits that have not been persisted to the
   * latest auto-save slot. Returns false for a pristine session (no edits yet)
   * and once the pending edits have been flushed. Used by the desktop
   * unsaved-changes guard on quit/close.
   */
  hasUnsavedChanges(project: Project): boolean {
    if (!this.isDirty) {
      return false;
    }
    return serializeProjectForAutoSave(project) !== this.lastSavedData;
  }

  destroy(): void {
    this.stop();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.listeners.clear();
  }
}

export const autoSaveManager = new AutoSaveManager();

export async function initializeAutoSave(): Promise<void> {
  await autoSaveManager.initialize();
}

export function startAutoSave(getProject: () => Project): void {
  autoSaveManager.start(getProject);
}

export function stopAutoSave(): void {
  autoSaveManager.stop();
}

export function markProjectDirty(): void {
  autoSaveManager.markDirty();
}

export async function checkForRecovery(
  projectId?: string,
): Promise<AutoSaveMetadata[]> {
  return autoSaveManager.checkForRecovery(projectId);
}

export async function recoverProject(saveId: string): Promise<Project | null> {
  return autoSaveManager.recover(saveId);
}
