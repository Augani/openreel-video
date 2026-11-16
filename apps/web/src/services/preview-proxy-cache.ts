import { createStore } from "zustand/vanilla";
import type { MediaItem, Project } from "@openreel/core";

export type PreviewProxyPreset = "low" | "medium" | "high";
export interface PreviewProxyEntry {
  source: MediaItem;
  preset: PreviewProxyPreset;
  status: "queued" | "encoding" | "ready" | "error";
  progress: number;
  enabled: boolean;
  /** Bytes live in the project's persistent store (never evicted by the memory cap). */
  persisted?: boolean;
  blob?: Blob;
  width?: number;
  height?: number;
  duration?: number;
  frameRate?: number;
  codec?: string;
  error?: string;
  createdAt: number;
}
export interface PreviewProxyState {
  projectId: string | null;
  entries: Record<string, PreviewProxyEntry>;
  /** Global Toggle Proxies switch. Off = preview/scrub/playback decode the full-resolution media. */
  proxiesOn: boolean;
  /** Changes only when the visual source changes, never on progress updates. */
  revision: number;
}
interface ProxyDependencies {
  loadOriginal: (projectId: string, item: MediaItem) => Promise<Blob>;
  generate: (file: File, preset: PreviewProxyPreset, onProgress: (value: number) => void, signal: AbortSignal) => Promise<Blob>;
  inspect?: (blob: Blob) => Promise<{ width: number; height: number; duration?: number; frameRate?: number; codec?: string }>;
  maxBytes?: number;
  /** Resolved lazily at the first size check (desktop scales it with RAM). */
  getMaxBytes?: () => Promise<number> | number;
  /** Concurrent encode jobs. Defaults to 1. */
  getConcurrency?: () => number;
  /** While true no new job starts; running jobs finish. Call `resume()` when it clears. */
  isPaused?: () => boolean;
}
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/** Desktop proxy cache cap: ~5% of RAM, between 512 MB and 2 GB. Web keeps 256 MB. */
export function computeProxyCacheBytes(totalMemoryBytes: number | null, desktop: boolean): number {
  if (!desktop || !totalMemoryBytes || totalMemoryBytes <= 0) return DEFAULT_MAX_BYTES;
  return Math.floor(Math.min(2048 * 1024 * 1024, Math.max(512 * 1024 * 1024, totalMemoryBytes * 0.05)));
}

/**
 * Native proxy jobs run in parallel on desktop: one per 4 logical cores, 1 to 2. Each job copies
 * the source to disk and transcodes it, so more than two at once only thrashes disk and CPU.
 */
export function computeProxyConcurrency(logicalCores: number, desktop: boolean): number {
  if (!desktop) return 1;
  return Math.max(1, Math.min(2, Math.floor(logicalCores / 4)));
}
// One File wrapper per original Blob, so the native bridge sees a stable identity across jobs and
// reuses its temp copy instead of re-copying the source every time.
const namedFiles = new WeakMap<Blob, File>();
function toNamedFile(original: Blob, name: string): File {
  if (original instanceof File && original.name === name) return original;
  let file = namedFiles.get(original);
  if (!file || file.name !== name) {
    file = new File([original], name, { type: original.type });
    namedFiles.set(original, file);
  }
  return file;
}
const sameSource = (a: MediaItem, b: MediaItem) =>
  a.blob === b.blob && a.fileHandle === b.fileHandle && a.originalUrl === b.originalUrl && !b.isPlaceholder;

/** Preview-only, bounded memory cache. Originals never leave the project library. */
export class PreviewProxyCache {
  readonly store = createStore<PreviewProxyState>(() => ({ projectId: null, entries: {}, proxiesOn: true, revision: 0 }));
  private project: Project | null = null;
  private jobs = new Map<string, AbortController>();
  private queue: Array<{ id: string; controller: AbortController }> = [];
  private active = 0;
  constructor(private dependencies: ProxyDependencies) {}

  syncProject(project: Project | null): void {
    this.project = project;
    const state = this.store.getState();
    if (state.projectId !== (project?.id ?? null)) {
      for (const controller of this.jobs.values()) controller.abort();
      this.jobs.clear();
      this.queue = [];
      this.store.setState({ projectId: project?.id ?? null, entries: {}, revision: state.revision + 1 });
      for (const key of Object.keys(this.decodes)) delete this.decodes[key];
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

  /** Toggle Proxies: every ready proxy is used for preview (on) or none is (off). */
  setProxiesOn(on: boolean): void {
    const state = this.store.getState();
    if (state.proxiesOn === on) return;
    this.store.setState({ proxiesOn: on, revision: state.revision + 1 });
  }

  /** Registers proxy bytes loaded from the project's persistent store as a ready entry. */
  hydrate(item: MediaItem, blob: Blob, info: { width: number; height: number; preset?: PreviewProxyPreset }): void {
    if (!this.project || item.isPlaceholder) return;
    this.patch(item.id, {
      source: item,
      preset: info.preset ?? "medium",
      status: "ready",
      progress: 1,
      enabled: true,
      persisted: true,
      blob,
      width: info.width,
      height: info.height,
      createdAt: Date.now(),
    }, true);
  }

  /** The entry's bytes are now stored with the project; the memory cap no longer evicts it. */
  markPersisted(id: string, blob: Blob): void {
    const entry = this.store.getState().entries[id];
    if (entry?.blob === blob && !entry.persisted) this.patch(id, { ...entry, persisted: true });
  }

  /** What the preview decoder was last given for a media id (proxy vs original), for diagnostics and tests. */
  readonly decodes: Record<string, { source: "proxy" | "original"; count: number; proxyCount: number; originalCount: number }> = {};
  noteDecode(mediaId: string, blob: Blob | null | undefined): void {
    if (!blob) return;
    const entry = this.store.getState().entries[mediaId];
    const source = entry?.blob === blob ? "proxy" : "original";
    const prior = this.decodes[mediaId] ?? { source, count: 0, proxyCount: 0, originalCount: 0 };
    this.decodes[mediaId] = {
      source,
      count: prior.count + 1,
      proxyCount: prior.proxyCount + (source === "proxy" ? 1 : 0),
      originalCount: prior.originalCount + (source === "original" ? 1 : 0),
    };
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
    return state.proxiesOn && entry?.status === "ready" && entry.enabled && entry.blob && sameSource(entry.source, item)
      ? { ...item, blob: entry.blob }
      : item;
  }

  private patch(id: string, entry: PreviewProxyEntry, visualChange = false): void {
    const state = this.store.getState();
    this.store.setState({ entries: { ...state.entries, [id]: entry }, revision: state.revision + Number(visualChange) });
  }

  /** Restarts the queue after `isPaused` clears. */
  resume(): void {
    void this.drain();
  }

  private async drain(): Promise<void> {
    const limit = Math.max(1, Math.floor(this.dependencies.getConcurrency?.() ?? 1));
    while (this.active < limit && this.queue.length && !this.dependencies.isPaused?.()) {
      const job = this.queue.shift()!;
      this.active++;
      void this.run(job.id, job.controller).finally(() => {
        this.active--;
        void this.drain();
      });
    }
  }

  private async run(id: string, controller: AbortController): Promise<void> {
    const entry = this.store.getState().entries[id];
    const projectId = this.store.getState().projectId;
    const isCurrent = () => !controller.signal.aborted && this.jobs.get(id) === controller && this.store.getState().projectId === projectId;
    if (!entry || !projectId || !isCurrent()) return;
    this.patch(id, { ...entry, status: "encoding" });
    try {
      const original = await this.dependencies.loadOriginal(projectId, entry.source);
      if (!isCurrent()) return;
      const file = toNamedFile(original, entry.source.name);
      const blob = await this.dependencies.generate(file, entry.preset, (value) => {
        if (!isCurrent()) return;
        const latest = this.store.getState().entries[id];
        if (latest) this.patch(id, { ...latest, progress: Math.max(0, Math.min(1, value)) });
      }, controller.signal);
      if (!isCurrent()) return;
      const dimensions = await this.dependencies.inspect?.(blob);
      if (!isCurrent()) return;
      const maxBytes = this.dependencies.maxBytes ?? (await this.dependencies.getMaxBytes?.()) ?? DEFAULT_MAX_BYTES;
      if (!isCurrent()) return;
      if (blob.size > maxBytes) throw new Error(`Proxy exceeds this preview cache (${Math.round(maxBytes / 1024 / 1024)} MB). Choose a smaller quality.`);
      let bytes = Object.values(this.store.getState().entries).reduce((total, cached) => total + (cached.blob && !cached.persisted ? cached.blob.size : 0), 0);
      const oldest = Object.entries(this.store.getState().entries).filter(([key, cached]) => key !== id && cached.blob && !cached.persisted).sort((a, b) => a[1].createdAt - b[1].createdAt);
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
}
