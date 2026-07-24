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

type AutoSaveEventType = "saved" | "restored" | "error" | "recoveryAvailable";
type AutoSaveEventCallback = (data?: unknown) => void;

export class AutoSaveManager {
  private config: AutoSaveConfig;
  private db: IDBDatabase | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private debounceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSavedHash: string = "";
  private currentSlot: number = 0;
  private listeners: Map<AutoSaveEventType, Set<AutoSaveEventCallback>> =
    new Map();

  private pendingProject: Project | null = null;
  private isDirty: boolean = false;

  constructor(config: Partial<AutoSaveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      this.db = await this.openDatabase();
    } catch (error) {
      console.error("[AutoSave] Failed to initialize:", error);
      this.emit("error", { error, message: "Failed to initialize auto-save" });
    }
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
    if (!this.config.enabled) {
      return;
    }

    this.stop(); // Stop any existing auto-save

    // Initial save
    this.pendingProject = getProject();
    this.saveIfDirty();

    // Set up periodic saves
    this.intervalId = setInterval(() => {
      this.pendingProject = getProject();
      this.saveIfDirty();
    }, this.config.interval);
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
  }

  markDirty(project?: Project): void {
    // Capture the state that caused this dirty notification. The debounce can
    // fire well before the periodic refresh in start(), so relying on the
    // previous pendingProject would save an older snapshot.
    if (project) {
      this.pendingProject = project;
    }
    this.isDirty = true;

    // Debounce the save
    if (this.debounceTimeoutId) {
      clearTimeout(this.debounceTimeoutId);
    }

    this.debounceTimeoutId = setTimeout(() => {
      this.saveIfDirty();
    }, this.config.debounceTime);
  }

  private async saveIfDirty(): Promise<void> {
    if (!this.pendingProject || !this.isDirty) {
      return;
    }

    const project = this.pendingProject;
    const hash = this.computeHash(project);

    if (hash === this.lastSavedHash) {
      return; // No changes
    }

    try {
      await this.save(project);
      this.lastSavedHash = hash;
      this.isDirty = false;
    } catch (error) {
      console.error("[AutoSave] Save failed:", error);
      this.emit("error", { error, message: "Auto-save failed" });
    }
  }

  private async save(project: Project): Promise<void> {
    if (!this.db) {
      throw new Error("Auto-save database not initialized");
    }

    const record: AutoSaveRecord = {
      id: `${project.id}-slot-${this.currentSlot}`,
      projectId: project.id,
      projectName: project.name,
      timestamp: Date.now(),
      slot: this.currentSlot,
      data: JSON.stringify(project),
    };

    await this.saveRecord(record);

    this.currentSlot = (this.currentSlot + 1) % this.config.maxSlots;
    await this.cleanupOldSaves(project.id);

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

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to save: ${request.error?.message}`));
    });
  }

  private async cleanupOldSaves(currentProjectId: string): Promise<void> {
    if (!this.db) return;

    const allSaves = await this.getAllSaves();
    const projectSaves = allSaves.filter(
      (s) => s.projectId === currentProjectId,
    );

    if (projectSaves.length > this.config.maxSlots) {
      const toDelete = projectSaves
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(this.config.maxSlots);

      for (const save of toDelete) {
        await this.deleteRecord(save.id);
      }
    }
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

      request.onsuccess = () => resolve();
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

      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () =>
        reject(new Error(`Failed to clear: ${request.error?.message}`));
    });
  }

  private computeHash(project: Project): string {
    const motionCompositions = project.motionCompositions ?? [];
    const motionLayerCount = motionCompositions.reduce(
      (sum, composition) => sum + (composition.layers?.length ?? 0),
      0,
    );
    const motionAudioClipCount = motionCompositions.reduce(
      (sum, composition) => sum + (composition.audioClips?.length ?? 0),
      0,
    );
    const motionModifiedAt = motionCompositions.reduce(
      (max, composition) => Math.max(max, composition.modifiedAt ?? 0),
      0,
    );

    const key = JSON.stringify({
      id: project.id,
      modifiedAt: project.modifiedAt,
      trackCount: project.timeline.tracks.length,
      clipCount: project.timeline.tracks.reduce(
        (sum, t) => sum + t.clips.length,
        0,
      ),
      mediaCount: project.mediaLibrary.items.length,
      motionCompositionCount: motionCompositions.length,
      motionLayerCount,
      motionAudioClipCount,
      motionInstanceCount: project.motionInstances?.length ?? 0,
      motionModifiedAt,
    });

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  updateConfig(config: Partial<AutoSaveConfig>): void {
    this.config = { ...this.config, ...config };
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
    await this.saveIfDirty();
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
    return this.computeHash(project) !== this.lastSavedHash;
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
