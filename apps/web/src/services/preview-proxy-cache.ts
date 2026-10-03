import { createStore } from "zustand/vanilla";
import type { MediaItem, Project } from "@openreel/core";

export type PreviewProxyPreset = "low" | "medium" | "high";
export interface PreviewProxyEntry {
  source: MediaItem;
  preset: PreviewProxyPreset;
  status: "queued" | "encoding" | "ready" | "error";
  progress: number;
  enabled: boolean;
  blob?: Blob;
  width?: number;
  height?: number;
  error?: string;
  createdAt: number;
}
export interface PreviewProxyState {
  projectId: string | null;
  entries: Record<string, PreviewProxyEntry>;
  /** Changes only when the visual source changes, never on progress updates. */
  revision: number;
}
interface ProxyDependencies {
  loadOriginal: (projectId: string, item: MediaItem) => Promise<Blob>;
  generate: (file: File, preset: PreviewProxyPreset, onProgress: (value: number) => void, signal: AbortSignal) => Promise<Blob>;
  inspect?: (blob: Blob) => Promise<{ width: number; height: number }>;
  maxBytes?: number;
}
const sameSource = (a: MediaItem, b: MediaItem) =>
  a.blob === b.blob && a.fileHandle === b.fileHandle && a.originalUrl === b.originalUrl && !b.isPlaceholder;

/** Preview-only, bounded memory cache. Originals never leave the project library. */
export class PreviewProxyCache {
  readonly store = createStore<PreviewProxyState>(() => ({ projectId: null, entries: {}, revision: 0 }));
  private project: Project | null = null;
  private jobs = new Map<string, AbortController>();
  private queue: Array<{ id: string; controller: AbortController }> = [];
  private running = false;
  constructor(private dependencies: ProxyDependencies) {}

  syncProject(project: Project | null): void {
    this.project = project;
    const state = this.store.getState();
    if (state.projectId !== (project?.id ?? null)) {
      for (const controller of this.jobs.values()) controller.abort();
      this.jobs.clear();
      this.queue = [];
      this.store.setState({ projectId: project?.id ?? null, entries: {}, revision: state.revision + 1 });
      return;
    }
    for (const [id, entry] of Object.entries(state.entries)) {
      const item = project?.mediaLibrary.items.find((candidate) => candidate.id === id);
      if (!item || !sameSource(entry.source, item)) this.remove(id);
    }
  }

  request(item: MediaItem, preset: PreviewProxyPreset): void {
    if (!this.project || item.type !== "video" || item.isPlaceholder || item.isPending) return;
    const current = this.project.mediaLibrary.items.find((candidate) => candidate.id === item.id);
    if (!current || !sameSource(item, current)) return;
    this.remove(item.id);
    const controller = new AbortController();
    this.jobs.set(item.id, controller);
    this.patch(item.id, { source: item, preset, status: "queued", progress: 0, enabled: true, createdAt: Date.now() });
    this.queue.push({ id: item.id, controller });
    void this.drain();
  }

  remove(id: string): void {
    this.jobs.get(id)?.abort();
    this.jobs.delete(id);
    this.queue = this.queue.filter((job) => job.id !== id);
    const state = this.store.getState();
    if (!state.entries[id]) return;
    const entries = { ...state.entries };
    delete entries[id];
    this.store.setState({ entries, revision: state.revision + 1 });
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.store.getState().entries[id];
    if (entry?.status === "ready" && entry.enabled !== enabled) this.patch(id, { ...entry, enabled }, true);
  }

  failPlayback(id: string, blob: Blob): void {
    const entry = this.store.getState().entries[id];
    // A late decoder failure cannot disable a replacement proxy.
    if (entry?.blob !== blob || !entry.enabled) return;
    this.patch(id, { ...entry, blob: undefined, enabled: false, status: "error", error: "Preview could not play this proxy. Using the original." }, true);
  }

  resolve(projectId: string, item: MediaItem, purpose: "preview" | "export" = "preview"): MediaItem {
    if (purpose === "export") return item;
    const state = this.store.getState();
    const entry = state.projectId === projectId ? state.entries[item.id] : undefined;
    return entry?.status === "ready" && entry.enabled && entry.blob && sameSource(entry.source, item)
      ? { ...item, blob: entry.blob }
      : item;
  }

  private patch(id: string, entry: PreviewProxyEntry, visualChange = false): void {
    const state = this.store.getState();
    this.store.setState({ entries: { ...state.entries, [id]: entry }, revision: state.revision + Number(visualChange) });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const { id, controller } = this.queue.shift()!;
        const entry = this.store.getState().entries[id];
        const projectId = this.store.getState().projectId;
        const isCurrent = () => !controller.signal.aborted && this.jobs.get(id) === controller && this.store.getState().projectId === projectId;
        if (!entry || !projectId || !isCurrent()) continue;
        this.patch(id, { ...entry, status: "encoding" });
        try {
          const original = await this.dependencies.loadOriginal(projectId, entry.source);
          if (!isCurrent()) continue;
          const file = new File([original], entry.source.name, { type: original.type });
          const blob = await this.dependencies.generate(file, entry.preset, (value) => {
            if (!isCurrent()) return;
            const latest = this.store.getState().entries[id];
            if (latest) this.patch(id, { ...latest, progress: Math.max(0, Math.min(1, value)) });
          }, controller.signal);
          if (!isCurrent()) continue;
          const dimensions = await this.dependencies.inspect?.(blob);
          if (!isCurrent()) continue;
          const maxBytes = this.dependencies.maxBytes ?? 256 * 1024 * 1024;
          if (blob.size > maxBytes) throw new Error("Proxy exceeds this tab's 256 MB preview cache. Choose a smaller quality.");
          let bytes = Object.values(this.store.getState().entries).reduce((total, cached) => total + (cached.blob?.size ?? 0), 0);
          const oldest = Object.entries(this.store.getState().entries).filter(([key, cached]) => key !== id && cached.blob).sort((a, b) => a[1].createdAt - b[1].createdAt);
          for (const [key, cached] of oldest) {
            if (bytes + blob.size <= maxBytes) break;
            bytes -= cached.blob!.size;
            this.remove(key);
          }
          this.patch(id, { ...entry, ...dimensions, status: "ready", progress: 1, blob, createdAt: Date.now() }, true);
        } catch (error) {
          if (isCurrent()) this.patch(id, { ...entry, status: "error", enabled: false, error: error instanceof Error ? error.message : "Could not create a preview proxy." });
        } finally {
          if (this.jobs.get(id) === controller) this.jobs.delete(id);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
