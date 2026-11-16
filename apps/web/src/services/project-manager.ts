import { assertCanWriteProject, trackProjectFile } from "./project-lock";
import type { Project, ProjectSettings } from "@openreel/core";
import { loadEngineModules } from "./lazy-engines";
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

type NativeFileRef = { kind: "native"; path: string };
type ProjectFileRef = FileSystemFileHandle | NativeFileRef;

export interface PickedProjectFile {
  project: Project;
  fileHandle: ProjectFileRef | null;
}

function isDesktopFs(): boolean {
  return typeof window !== "undefined" && !!window.openreel?.fs;
}

function isNativeRef(ref: unknown): ref is NativeFileRef {
  return (
    !!ref &&
    typeof ref === "object" &&
    (ref as NativeFileRef).kind === "native"
  );
}

const PROJECT_DB_NAME = "openreel-projects";
const PROJECT_DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const RECENT_STORE = "recent";
const MAX_RECENT_PROJECTS = 10;

interface RecentProject {
  id: string;
  name: string;
  lastOpened: number;
  thumbnail?: string;
  fileHandle?: ProjectFileRef;
  duration?: number;
  trackCount?: number;
}

interface ProjectTemplate {
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
  private fileHandleRef: ProjectFileRef | null = null;
  /** The file the open project is saved to. Desktop files are locked while they are open (see project-lock). */
  private get currentFileHandle(): ProjectFileRef | null {
    return this.fileHandleRef;
  }
  private set currentFileHandle(next: ProjectFileRef | null) {
    this.fileHandleRef = next;
    trackProjectFile(isNativeRef(next) ? next.path : null);
  }
  private fileSession = 0;

  async parseProjectContent(content: string): Promise<Project> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("Project file is empty");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Invalid project file: ${error instanceof Error ? error.message : "Parse error"}`,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid project file: expected a JSON object");
    }

    const candidate = parsed as Record<string, unknown>;
    const isWrapped =
      typeof candidate.version === "string" &&
      typeof candidate.project === "object" &&
      candidate.project !== null;

    const rawProject = (isWrapped ? candidate.project : parsed) as Project;
    if (typeof rawProject.id !== "string" || typeof rawProject.name !== "string") {
      throw new Error("Invalid project file: missing project id or name");
    }

    const { normalizeProjectStoredFields } = await loadEngineModules();
    const project = normalizeProjectStoredFields(rawProject);
    if (!Array.isArray(project.mediaLibrary?.items)) return project;
    // JSON cannot retain a Blob or a live file handle. Legacy saves contain
    // truthy {} values here, which otherwise hide the existing relink controls.
    return { ...project, mediaLibrary: { ...project.mediaLibrary,
      items: project.mediaLibrary.items.map(item => ({ ...item, blob: null, fileHandle: null, isPlaceholder: true })),
    } };
  }

  async initialize(): Promise<void> {
    this.db = await this.openDatabase();
  }

  /** Open the database once. A project saved or opened without the start screen (MCP path tools) may be the first to need it. */
  async ensureInitialized(): Promise<void> {
    if (!this.db) await this.initialize();
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

    this.releaseCurrentFileHandle();
    this.emit("projectOpened", { project });
    return project;
  }

  async saveProject(project: Project, resolveProject?: () => Project | Promise<Project>): Promise<boolean> {
    if (this.currentFileHandle) {
      await this.saveToFileHandle(project, this.currentFileHandle, resolveProject);
      return true;
    }
    return this.saveProjectAs(project, resolveProject);
  }

  async saveProjectAs(project: Project, resolveProject?: () => Project | Promise<Project>): Promise<boolean> {
    const session = this.fileSession;
    if (isDesktopFs()) {
      const filePath = await window.openreel!.fs.showSaveDialog({
        defaultPath: `${project.name}.oreel`,
        filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
      });
      if (!filePath) return false;
      await this.saveNativeProjectAs(filePath, project, resolveProject, session);
      return true;
    }

    if (!("showSaveFilePicker" in window)) {
      return this.downloadProject(resolveProject ? await resolveProject() : project);
    }

    let handle: FileSystemFileHandle;
    try {
      const win = window as WindowWithFilePicker;
      handle = await win.showSaveFilePicker!({
        suggestedName: `${project.name}.oreel`,
        types: [
          {
            description: "OpenReel Project",
            accept: { "application/json": [".oreel", ".json"] },
          },
        ],
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return false;
      }
      console.warn(
        "[ProjectManager] showSaveFilePicker unavailable; falling back to download",
        error,
      );
      return this.downloadProject(resolveProject ? await resolveProject() : project);
    }

    // Picker cancellation returns false. A selected file that fails to write
    // must reject so callers can distinguish failure and report it to the user.
    const snapshot = await this.saveToFileHandle(project, handle, resolveProject);
    if (session === this.fileSession) this.currentFileHandle = handle;
    await this.addToRecent(snapshot, handle);
    return true;
  }

  /** Write the project to `filePath` (desktop, no dialog) and make that file the save target. */
  async saveProjectToPath(
    filePath: string,
    project: Project,
    resolveProject?: () => Project | Promise<Project>,
  ): Promise<Project> {
    return this.saveNativeProjectAs(filePath, project, resolveProject, this.fileSession);
  }

  private async saveNativeProjectAs(
    filePath: string,
    project: Project,
    resolveProject: (() => Project | Promise<Project>) | undefined,
    session: number,
  ): Promise<Project> {
    await assertCanWriteProject(filePath);
    const snapshot = resolveProject ? await resolveProject() : project;
    await window.openreel!.fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
    const handle: NativeFileRef = { kind: "native", path: filePath };
    if (session === this.fileSession) this.currentFileHandle = handle;
    await this.addToRecent(snapshot, handle);
    this.emit("projectSaved", { project: snapshot });
    return snapshot;
  }

  private async saveToFileHandle(
    project: Project,
    handle: ProjectFileRef,
    resolveProject?: () => Project | Promise<Project>,
  ): Promise<Project> {
    const data = resolveProject ? undefined : JSON.stringify(project, null, 2);
    if (isNativeRef(handle)) {
      await assertCanWriteProject(handle.path);
      const snapshot = resolveProject ? await resolveProject() : project;
      await window.openreel!.fs.writeFile(handle.path, data ?? JSON.stringify(snapshot, null, 2));
      this.emit("projectSaved", { project: snapshot });
      return snapshot;
    }

    const writable = await handle.createWritable();
    let snapshot = project;
    try {
      if (resolveProject) snapshot = await resolveProject();
      await writable.write(data ?? JSON.stringify(snapshot, null, 2));
      await writable.close();
    } catch (error) {
      // Release the stream/lock and discard partial data when writing fails.
      await writable.abort().catch(() => {});
      throw error;
    }

    this.emit("projectSaved", { project: snapshot });
    return snapshot;
  }

  private downloadProject(project: Project): boolean {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}.oreel`;
    try {
      document.body.appendChild(a);
      a.click();
    } finally {
      a.remove();
      URL.revokeObjectURL(url);
    }

    this.emit("projectSaved", { project });
    return true;
  }

  async openProject(): Promise<Project | null> {
    const picked = await this.pickProjectFile();
    if (!picked) return null;
    this.activatePickedProject(picked);
    return picked.project;
  }

  /** Read the chosen file without changing the active project's save target. */
  async pickProjectFile(): Promise<PickedProjectFile | null> {
    if (isDesktopFs()) {
      const filePath = await window.openreel!.fs.showOpenDialog({
        filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
      });
      if (!filePath) return null;
      const content = await window.openreel!.fs.readFile(filePath);
      return { project: await this.parseProjectContent(content), fileHandle: { kind: "native", path: filePath } };
    }

    if (typeof (window as WindowWithFilePicker).showOpenFilePicker === "function") {
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
        const project = await this.parseProjectContent(content);

        return { project, fileHandle: handle };
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return null;
        }
        throw error;
      }
    }

    return this.pickProjectViaInput();
  }

  activatePickedProject(picked: PickedProjectFile): void {
    this.fileSession++;
    this.currentFileHandle = picked.fileHandle;
    this.emit("projectOpened", { project: picked.project });
    void this.addToRecent(picked.project, picked.fileHandle ?? undefined).catch((error) => {
      console.warn("[ProjectManager] Could not update recent projects:", error);
    });
  }

  private pickProjectViaInput(): Promise<PickedProjectFile | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".oreel,.json";
      input.hidden = true;
      const cleanup = () => { input.onchange = null; input.oncancel = null; input.remove(); };
      input.oncancel = () => { cleanup(); resolve(null); };

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          resolve(null);
          return;
        }

        try {
          const content = await file.text();
          const project = await this.parseProjectContent(content);
          cleanup();
          resolve({ project, fileHandle: null });
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      document.body.appendChild(input);
      input.click();
    });
  }

  async openRecentProject(
    recentProject: RecentProject,
  ): Promise<Project | null> {
    if (recentProject.fileHandle) {
      if (isNativeRef(recentProject.fileHandle)) {
        try {
          const content = await window.openreel!.fs.readFile(
            recentProject.fileHandle.path,
          );
          const project = await this.parseProjectContent(content);
          this.fileSession++;
          this.currentFileHandle = recentProject.fileHandle;
          await this.updateRecentTimestamp(recentProject.id);
          this.emit("projectOpened", { project });
          return project;
        } catch (error) {
          console.error("[ProjectManager] Open recent (native) failed:", error);
          await this.removeFromRecent(recentProject.id);
          return null;
        }
      }

      try {
        const handle = recentProject.fileHandle as FileHandleWithPermissions;
        const permission = await handle.queryPermission?.({ mode: "read" });
        if (permission !== "granted") {
          const request = await handle.requestPermission?.({ mode: "read" });
          if (request !== "granted") {
            return null;
          }
        }

        const file = await handle.getFile();
        const content = await file.text();
        const project = await this.parseProjectContent(content);

        this.fileSession++;
        this.currentFileHandle = handle;
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
          this.releaseCurrentFileHandle();
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
    fileHandle?: ProjectFileRef,
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

  getCurrentFileHandle(): ProjectFileRef | null {
    return this.currentFileHandle;
  }

  /** Desktop path of the file the open project is saved to (null in the browser or before the first save). */
  getCurrentProjectPath(): string | null {
    const handle = this.fileHandleRef;
    return isNativeRef(handle) ? handle.path : null;
  }

  /** Imported independent copies must not overwrite a previously opened file. */
  releaseCurrentFileHandle(): void {
    this.fileSession++;
    this.currentFileHandle = null;
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
