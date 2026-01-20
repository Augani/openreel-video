import type { Project, ProjectSettings } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";

interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

interface WindowWithFilePicker extends Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandle[]>;
}

interface FileHandleWithPermissions extends FileSystemFileHandle {
  queryPermission?: (options: { mode: string }) => Promise<string>;
  requestPermission?: (options: { mode: string }) => Promise<string>;
}

const PROJECT_DB_NAME = "openreel-projects";
const PROJECT_DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const RECENT_STORE = "recent";
const MAX_RECENT_PROJECTS = 10;

export interface RecentProject {
  id: string;
  name: string;
  lastOpened: number;
  thumbnail?: string;
  fileHandle?: FileSystemFileHandle;
  duration?: number;
  trackCount?: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  settings: Partial<ProjectSettings>;
  thumbnail?: string;
  tracks?: Array<{ type: string; name: string }>;
}

const DEFAULT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank",
    name: "Blank Project",
    description: "Start from scratch with no pre-configured tracks",
    category: "General",
    settings: { width: 1920, height: 1080, frameRate: 30 },
  },
  {
    id: "youtube-landscape",
    name: "YouTube Landscape",
    description: "1920x1080 at 30fps - Standard YouTube format",
    category: "Social Media",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    tracks: [
      { type: "video", name: "Main Video" },
      { type: "audio", name: "Background Music" },
      { type: "audio", name: "Voiceover" },
    ],
  },
  {
    id: "youtube-short",
    name: "YouTube Shorts",
    description: "1080x1920 at 60fps - Vertical short-form content",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 60 },
    tracks: [
      { type: "video", name: "Main Video" },
      { type: "audio", name: "Audio" },
      { type: "text", name: "Captions" },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "1080x1920 at 60fps - Optimized for TikTok",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 60 },
    tracks: [
      { type: "video", name: "Main" },
      { type: "audio", name: "Sound" },
    ],
  },
  {
    id: "instagram-reel",
    name: "Instagram Reel",
    description: "1080x1920 at 30fps - Instagram Reels format",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 30 },
    tracks: [
      { type: "video", name: "Video" },
      { type: "audio", name: "Audio" },
    ],
  },
  {
    id: "instagram-post",
    name: "Instagram Post",
    description: "1080x1080 at 30fps - Square format for posts",
    category: "Social Media",
    settings: { width: 1080, height: 1080, frameRate: 30 },
    tracks: [{ type: "video", name: "Video" }],
  },
  {
    id: "cinematic-4k",
    name: "Cinematic 4K",
    description: "3840x2160 at 24fps - Film-like quality",
    category: "Professional",
    settings: { width: 3840, height: 2160, frameRate: 24 },
    tracks: [
      { type: "video", name: "A-Roll" },
      { type: "video", name: "B-Roll" },
      { type: "audio", name: "Dialogue" },
      { type: "audio", name: "Music" },
      { type: "audio", name: "SFX" },
    ],
  },
  {
    id: "podcast",
    name: "Podcast Video",
    description: "1920x1080 at 30fps - Audio-focused with waveform visualizer",
    category: "Audio",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    tracks: [
      { type: "video", name: "Background" },
      { type: "audio", name: "Host" },
      { type: "audio", name: "Guest" },
      { type: "graphics", name: "Waveform" },
    ],
  },
  {
    id: "tutorial",
    name: "Screen Recording",
    description: "1920x1080 at 60fps - Perfect for tutorials",
    category: "Educational",
    settings: { width: 1920, height: 1080, frameRate: 60 },
    tracks: [
      { type: "video", name: "Screen" },
      { type: "video", name: "Webcam" },
      { type: "audio", name: "Narration" },
      { type: "text", name: "Annotations" },
    ],
  },
];

type ProjectManagerEvent = "recentUpdated" | "projectSaved" | "projectOpened";
type EventCallback = (data?: unknown) => void;

class ProjectManager {
  private db: IDBDatabase | null = null;
  private listeners: Map<ProjectManagerEvent, Set<EventCallback>> = new Map();
  private currentFileHandle: FileSystemFileHandle | null = null;

  async initialize(): Promise<void> {
    this.db = await this.openDatabase();
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not supported"));
        return;
      }

      const request = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(RECENT_STORE)) {
          const store = db.createObjectStore(RECENT_STORE, { keyPath: "id" });
          store.createIndex("lastOpened", "lastOpened", { unique: false });
        }
      };
    });
  }

  async createProject(
    options: {
      name?: string;
      templateId?: string;
      settings?: Partial<ProjectSettings>;
    } = {},
  ): Promise<Project> {
    const template = options.templateId
      ? DEFAULT_TEMPLATES.find((t) => t.id === options.templateId) ||
        DEFAULT_TEMPLATES[0]
      : DEFAULT_TEMPLATES[0];

    const settings: ProjectSettings = {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
      ...template.settings,
      ...options.settings,
    };

    const tracks =
      template.tracks?.map((t, i) => ({
        id: `track-${Date.now()}-${i}`,
        type: t.type as "video" | "audio" | "image" | "text" | "graphics",
        name: t.name,
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      })) || [];

    const project: Project = {
      id: uuidv4(),
      name: options.name || "Untitled Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings,
      timeline: {
        duration: 0,
        tracks,
        markers: [],
        subtitles: [],
      },
      mediaLibrary: {
        items: [],
      },
    };

    this.currentFileHandle = null;
    this.emit("projectOpened", { project });
    return project;
  }

  async saveProject(project: Project): Promise<boolean> {
    if (this.currentFileHandle) {
      return this.saveToFileHandle(project, this.currentFileHandle);
    }
    return this.saveProjectAs(project);
  }

  async saveProjectAs(project: Project): Promise<boolean> {
    if (!("showSaveFilePicker" in window)) {
      return this.downloadProject(project);
    }

    try {
      const win = window as WindowWithFilePicker;
      const handle = await win.showSaveFilePicker!({
        suggestedName: `${project.name}.oreel`,
        types: [
          {
            description: "OpenReel Project",
            accept: { "application/json": [".oreel", ".json"] },
          },
        ],
      });

      const success = await this.saveToFileHandle(project, handle);
      if (success) {
        this.currentFileHandle = handle;
        await this.addToRecent(project, handle);
      }
      return success;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return false;
      }
      console.error("[ProjectManager] Save failed:", error);
      return false;
    }
  }

  private async saveToFileHandle(
    project: Project,
    handle: FileSystemFileHandle,
  ): Promise<boolean> {
    try {
      const writable = await handle.createWritable();
      const data = JSON.stringify(project, null, 2);
      await writable.write(data);
      await writable.close();

      this.emit("projectSaved", { project });
      return true;
    } catch (error) {
      console.error("[ProjectManager] Save to file failed:", error);
      return false;
    }
  }

  private downloadProject(project: Project): boolean {
    try {
      const data = JSON.stringify(project, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name}.oreel`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.emit("projectSaved", { project });
      return true;
    } catch (error) {
      console.error("[ProjectManager] Download failed:", error);
      return false;
    }
  }

  async openProject(): Promise<Project | null> {
    if ("showOpenFilePicker" in window) {
      try {
        const win = window as WindowWithFilePicker;
        const [handle] = await win.showOpenFilePicker!({
          types: [
            {
              description: "OpenReel Project",
              accept: { "application/json": [".oreel", ".json"] },
            },
          ],
          multiple: false,
        });

        const file = await handle.getFile();
        const content = await file.text();
        const project = JSON.parse(content) as Project;

        this.currentFileHandle = handle;
        await this.addToRecent(project, handle);
        this.emit("projectOpened", { project });

        return project;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return null;
        }
        console.error("[ProjectManager] Open failed:", error);
        return null;
      }
    }

    return this.openProjectViaInput();
  }

  private openProjectViaInput(): Promise<Project | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".oreel,.json";

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const content = await file.text();
          const project = JSON.parse(content) as Project;
          await this.addToRecent(project);
          this.emit("projectOpened", { project });
          resolve(project);
        } catch (error) {
          console.error("[ProjectManager] Parse failed:", error);
          resolve(null);
        }
      };

      input.click();
    });
  }

  async openRecentProject(
    recentProject: RecentProject,
  ): Promise<Project | null> {
    if (recentProject.fileHandle) {
      try {
        const handle = recentProject.fileHandle as FileHandleWithPermissions;
        const permission = await handle.queryPermission?.({ mode: "read" });
        if (permission !== "granted") {
          const request = await handle.requestPermission?.({ mode: "read" });
          if (request !== "granted") {
            return null;
          }
        }

        const file = await recentProject.fileHandle.getFile();
        const content = await file.text();
        const project = JSON.parse(content) as Project;

        this.currentFileHandle = recentProject.fileHandle;
        await this.updateRecentTimestamp(recentProject.id);
        this.emit("projectOpened", { project });

        return project;
      } catch (error) {
        console.error("[ProjectManager] Open recent failed:", error);
        await this.removeFromRecent(recentProject.id);
        return null;
      }
    }

    return this.loadProjectFromDb(recentProject.id);
  }

  private async loadProjectFromDb(id: string): Promise<Project | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(PROJECTS_STORE, "readonly");
      const store = tx.objectStore(PROJECTS_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        const project = request.result as Project | undefined;
        if (project) {
          this.emit("projectOpened", { project });
        }
        resolve(project || null);
      };

      request.onerror = () => resolve(null);
    });
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    if (!this.db) {
      await this.initialize();
    }

    return new Promise((resolve) => {
      if (!this.db) {
        resolve([]);
        return;
      }

      const tx = this.db.transaction(RECENT_STORE, "readonly");
      const store = tx.objectStore(RECENT_STORE);
      const index = store.index("lastOpened");
      const request = index.getAll();

      request.onsuccess = () => {
        const items = (request.result as RecentProject[])
          .sort((a, b) => b.lastOpened - a.lastOpened)
          .slice(0, MAX_RECENT_PROJECTS);
        resolve(items);
      };

      request.onerror = () => resolve([]);
    });
  }

  async addToRecent(
    project: Project,
    fileHandle?: FileSystemFileHandle,
  ): Promise<void> {
    if (!this.db) return;

    const recentProject: RecentProject = {
      id: project.id,
      name: project.name,
      lastOpened: Date.now(),
      fileHandle,
      duration: project.timeline.duration,
      trackCount: project.timeline.tracks.length,
    };

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      store.put(recentProject);

      tx.oncomplete = () => {
        this.emit("recentUpdated");
        this.cleanupOldRecent();
        resolve();
      };

      tx.onerror = () => resolve();
    });
  }

  private async updateRecentTimestamp(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        const recent = request.result as RecentProject | undefined;
        if (recent) {
          recent.lastOpened = Date.now();
          store.put(recent);
        }
        resolve();
      };

      request.onerror = () => resolve();
    });
  }

  async removeFromRecent(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      store.delete(id);

      tx.oncomplete = () => {
        this.emit("recentUpdated");
        resolve();
      };

      tx.onerror = () => resolve();
    });
  }

  private async cleanupOldRecent(): Promise<void> {
    const recent = await this.getRecentProjects();
    if (recent.length > MAX_RECENT_PROJECTS) {
      const toRemove = recent.slice(MAX_RECENT_PROJECTS);
      for (const item of toRemove) {
        await this.removeFromRecent(item.id);
      }
    }
  }

  async clearRecentProjects(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(RECENT_STORE, "readwrite");
      const store = tx.objectStore(RECENT_STORE);
      store.clear();

      tx.oncomplete = () => {
        this.emit("recentUpdated");
        resolve();
      };

      tx.onerror = () => resolve();
    });
  }

  getTemplates(): ProjectTemplate[] {
    return [...DEFAULT_TEMPLATES];
  }

  getTemplatesByCategory(): Map<string, ProjectTemplate[]> {
    const map = new Map<string, ProjectTemplate[]>();
    for (const template of DEFAULT_TEMPLATES) {
      const existing = map.get(template.category) || [];
      existing.push(template);
      map.set(template.category, existing);
    }
    return map;
  }

  getCurrentFileHandle(): FileSystemFileHandle | null {
    return this.currentFileHandle;
  }

  hasUnsavedChanges(project: Project): boolean {
    const projectWithSavedAt = project as Project & { lastSavedAt?: number };
    return (
      !this.currentFileHandle ||
      project.modifiedAt > (projectWithSavedAt.lastSavedAt ?? 0)
    );
  }

  on(event: ProjectManagerEvent, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: ProjectManagerEvent, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (error) {
        console.error("[ProjectManager] Event callback error:", error);
      }
    });
  }
}

export const projectManager = new ProjectManager();

export async function initializeProjectManager(): Promise<void> {
  await projectManager.initialize();
}
