import { useSyncExternalStore } from "react";
import {
  IdleRenderScheduler,
  hasIdleCacheRoom,
  PlaybackFrameStats,
  RenderCache,
  getMemoryGovernor,
  type IdleRenderState,
  buildRenderStatusSegments,
  cacheFrameSize,
  createFrameCodec,
  planInvalidation,
  normalizeRanges,
  intersectRanges,
  type ExportFrameSource,
  type Project,
  type RenderCacheSnapshot,
  type RenderSummary,
  type RenderTimeRange,
} from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";
import { isExportQueueRunning, registerExportFrameSourceProvider } from "./export-queue/export-queue-activity";
import {
  DeferredChunkStore,
  backendKeyPrefix,
  deleteAllOpfsRenderFiles,
  desktopBridge,
  dropLegacyIndexedDb,
  openRenderCacheBackend,
  projectKeyOf,
  sweepStaleOpfsProjects,
  type RenderCacheBackendKind,
} from "./render-cache-backends";
import {
  RENDER_CACHE_PREFS_EVENT,
  maxWidthFor,
  readRenderCachePrefs,
} from "./render-cache-prefs";

const DEFAULT_BUDGET = 2 * 1024 * 1024 * 1024;
const LOCK_PREFIX = "openreel-render-cache:";
const EPHEMERAL_BUDGET = 512 * 1024 * 1024;
const MEDIA_ONLINE_TIMEOUT_MS = 20_000;

function hasOfflineMedia(): boolean {
  return useProjectStore.getState().project.mediaLibrary.items.some((item) => item.isPlaceholder === true);
}

export interface PlaybackFrameLogEntry {
  /** performance.now() when the frame was painted. */
  readonly at: number;
  /** Timeline time of the painted frame. */
  readonly time: number;
  readonly source: "cache" | "live";
}

export interface PlaybackTelemetry {
  readonly entries: readonly PlaybackFrameLogEntry[];
  readonly cacheFrames: number;
  readonly liveFrames: number;
}

const FRAME_LOG_LIMIT = 20000;
/** Below this battery level (and not charging) the OS is treated as being in low-power territory. */
const LOW_BATTERY_LEVEL = 0.2;

interface BatteryLike {
  charging: boolean;
  level: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

class RenderCacheService {
  private cache: RenderCache | null = null;
  private cacheKey = "";
  private started = false;
  private unsubscribeProject: (() => void) | null = null;
  private unsubscribeCache: (() => void) | null = null;
  private releaseLock: (() => void) | null = null;
  private ready: Promise<void> = Promise.resolve();
  private backendKind: RenderCacheBackendKind | null = null;
  private persistentSession = false;
  private readonly listeners = new Set<() => void>();
  readonly stats = new PlaybackFrameStats();
  private frameLog: PlaybackFrameLogEntry[] = [];
  private cacheFrames = 0;
  private liveFrames = 0;
  private enabled = true;
  private idle: IdleRenderScheduler | null = null;
  private idleState: IdleRenderState = { kind: "off" };
  private readonly idleListeners = new Set<() => void>();
  private idleCleanups: Array<() => void> = [];
  private battery: BatteryLike | null = null;
  private lastProject: Project | null = null;
  /** media id -> "size:mtime" of the file on disk (desktop), part of every persisted segment hash. */
  private sourceStamps = new Map<string, string>();

  /**
   * Stat the source files of the open project (desktop) so a file replaced at the same path changes the content
   * hash. Frames of clips whose file changed since the last check are dropped.
   */
  async refreshSourceStamps(): Promise<void> {
    const bridge = desktopBridge();
    const cache = this.cache;
    if (!bridge || !cache) return;
    const project = useProjectStore.getState().getFullProject();
    const items = project.mediaLibrary.items
      .map((item) => ({ id: item.id, path: item.nativeSource?.path ?? item.sourceFile?.path }))
      .filter((entry): entry is { id: string; path: string } => typeof entry.path === "string" && entry.path.length > 0);
    if (items.length === 0) {
      this.sourceStamps = new Map();
      return;
    }
    let stats: Array<{ size: number; mtimeMs: number } | null>;
    try {
      stats = await bridge.stat(items.map((entry) => entry.path));
    } catch {
      return;
    }
    const next = new Map<string, string>();
    items.forEach((entry, i) => next.set(entry.id, stats[i] ? `${stats[i]!.size}:${stats[i]!.mtimeMs}` : "missing"));
    const changed = new Set<string>();
    for (const [id, stamp] of next) {
      const before = this.sourceStamps.get(id);
      if (before !== undefined && before !== stamp) changed.add(id);
    }
    this.sourceStamps = next;
    cache.refreshContentHashes();
    if (changed.size > 0) {
      const spans = project.timeline.tracks.flatMap((track) =>
        track.clips.filter((clip) => changed.has(clip.mediaId)).map((clip) => ({ start: clip.startTime, end: clip.startTime + clip.duration })),
      );
      if (spans.length > 0) cache.invalidateRanges(normalizeRanges(spans));
    }
  }

  /** Idempotent: creates the cache for the open project and keeps following the project store. */
  ensureStarted(): RenderCache {
    const full = useProjectStore.getState().getFullProject();
    const key = projectKeyOf(full.id);
    if (!this.cache || this.cacheKey !== key) this.switchProject(full, key);
    if (!this.started) {
      this.started = true;
      this.unsubscribeProject = useProjectStore.subscribe((state, previous) => {
        if (state.project !== previous.project) this.follow();
      });
      window.addEventListener("openreel:preview-invalidate", this.onPreviewInvalidate);
      window.addEventListener(RENDER_CACHE_PREFS_EVENT, this.onPrefsChanged);
      window.addEventListener("pagehide", this.onPageHide);
      dropLegacyIndexedDb();
      this.startIdleRender();
    }
    return this.cache as RenderCache;
  }

  /** Background rendering: quiet-period scheduler fed by edits, playback, scrubbing and the setting. */
  private startIdleRender(): void {
    const scheduler = new IdleRenderScheduler({
      isEnabled: () => readRenderCachePrefs().idleRender,
      isBusy: () =>
        !this.cache ||
        !useEngineStore.getState().videoEngine ||
        this.cache.isRendering() ||
        useUIStore.getState().exportState.isExporting ||
        isExportQueueRunning() ||
        useTimelineStore.getState().playbackState === "playing" ||
        useTimelineStore.getState().isScrubbing ||
        hasOfflineMedia(),
      isMemoryOk: () => getMemoryGovernor().policy.pressure === "normal",
      isPowerOk: () => !(this.battery && !this.battery.charging && this.battery.level <= LOW_BATTERY_LEVEL),
      getPlayhead: () => useTimelineStore.getState().playheadPosition,
      getPendingRanges: () => this.pendingEffectRanges(),
      prepare: () => {
        this.cache?.setProject(useProjectStore.getState().getFullProject());
      },
      renderChunk: async (range, signal) => {
        const cache = this.cache;
        if (!cache) return { status: "failed", framesRendered: 0, framesSkipped: 0 };
        await this.ready;
        const summary = await cache.renderRange(range, { signal });
        return { status: summary.status, framesRendered: summary.framesRendered, framesSkipped: summary.framesSkipped };
      },
      onStateChange: (state) => {
        this.idleState = state;
        for (const listener of Array.from(this.idleListeners)) listener();
      },
    });
    this.idle = scheduler;
    const unsubs: Array<() => void> = [
      // Any edit invalidates cached frames and ends the quiet period.
      useProjectStore.subscribe((state, previous) => {
        if (state.project !== previous.project) scheduler.notifyActivity();
      }),
      useTimelineStore.subscribe((state, previous) => {
        if (
          state.playbackState !== previous.playbackState ||
          state.isScrubbing !== previous.isScrubbing ||
          state.playheadPosition !== previous.playheadPosition
        ) {
          scheduler.notifyActivity();
        }
      }),
      getMemoryGovernor().subscribe(() => scheduler.notifyConditionsChanged()),
      // An export starting takes the engine: stop the running chunk at once instead of at the next chunk boundary.
      useUIStore.subscribe((state, previous) => {
        if (state.exportState.isExporting !== previous.exportState.isExporting) scheduler.notifyActivity();
      }),
    ];
    const onPrefs = () => scheduler.notifyConditionsChanged();
    window.addEventListener(RENDER_CACHE_PREFS_EVENT, onPrefs);
    unsubs.push(() => window.removeEventListener(RENDER_CACHE_PREFS_EVENT, onPrefs));
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (typeof getBattery === "function") {
      void getBattery
        .call(navigator)
        .then((battery) => {
          if (this.idle !== scheduler) return;
          this.battery = battery;
          const onChange = () => scheduler.notifyConditionsChanged();
          battery.addEventListener("chargingchange", onChange);
          battery.addEventListener("levelchange", onChange);
          this.idleCleanups.push(() => {
            battery.removeEventListener("chargingchange", onChange);
            battery.removeEventListener("levelchange", onChange);
          });
        })
        .catch(() => undefined);
    }
    this.idleCleanups = unsubs;
    scheduler.notifyConditionsChanged();
  }

  /** Yellow and red stretches with no cached frames yet, longer than one frame. */
  private pendingEffectRanges(): RenderTimeRange[] {
    const cache = this.cache;
    if (!cache) return [];
    const project = useProjectStore.getState().getFullProject();
    const snapshot = cache.getSnapshot();
    // Never evict earlier frames to make room: stop once the cache cannot take another chunk.
    if (!hasIdleCacheRoom(snapshot, project.settings.frameRate)) return [];
    const segments = buildRenderStatusSegments(project, {
      cachedRuns: snapshot.cachedRuns,
      measuredMs: (range) => this.stats.mean(range),
    });
    const minLength = 1 / Math.max(1, project.settings.frameRate);
    return segments
      .filter((s) => (s.level === "light" || s.level === "heavy") && s.end - s.start >= minLength)
      .map((s) => ({ start: s.start, end: s.end }));
  }

  /** Aborts a running background chunk and waits (briefly) for the cache to free up. */
  private async yieldIdleRender(cache: RenderCache): Promise<void> {
    if (!this.idle || this.idleState.kind !== "rendering" || !cache.isRendering()) return;
    this.idle.notifyActivity();
    for (let i = 0; i < 100 && cache.isRendering(); i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  getIdleRenderState(): IdleRenderState {
    return this.idleState;
  }

  subscribeIdleRender(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RenderCacheSnapshot {
    return this.cache?.getSnapshot() ?? EMPTY_SNAPSHOT;
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Where the current project's render files live ("desktop-disk", "opfs", ...), once known. */
  get storageKind(): RenderCacheBackendKind | null {
    return this.backendKind;
  }

  /** True when this tab owns the project's persistent render files (false in a second tab or without storage). */
  get isPersistent(): boolean {
    return this.persistentSession;
  }

  /** Resolves when the cache has opened its storage and restored what the last session left. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private follow(): void {
    const full = useProjectStore.getState().getFullProject();
    const key = projectKeyOf(full.id);
    if (!this.cache || key !== this.cacheKey) {
      this.switchProject(full, key);
      return;
    }
    const previous = this.lastProject;
    this.lastProject = full;
    this.cache.setProject(full);
    if (previous) this.invalidateStatsFor(previous, full);
  }

  /**
   * Another tab holding the project's lock means this one must not share its files. A lock released a moment ago
   * (a reload, a project switch in this tab) may not be free yet, so ask again for a few seconds before giving up.
   */
  private async acquireProjectLock(key: string): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await this.tryProjectLock(key)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  private tryProjectLock(key: string): Promise<boolean> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      void locks
        .request(`${LOCK_PREFIX}${key}`, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        })
        .catch(() => resolve(true));
    });
  }

  private switchProject(full: Project, key: string): void {
    const previous = this.cache;
    const releasePrevious = this.releaseLock;
    this.releaseLock = null;
    this.unsubscribeCache?.();
    this.lastProject = full;
    this.stats.clear();
    const prefs = readRenderCachePrefs();
    const backendReady = (async () => {
      // The old project's index is written out before the new one opens, and only then is its lock freed.
      if (previous) await previous.detach().catch(() => undefined);
      releasePrevious?.();
      const owner = await this.acquireProjectLock(key);
      const backend = await openRenderCacheBackend(key, owner);
      this.backendKind = backend.kind;
      this.persistentSession = backend.persistent;
      return backend;
    })();
    const deferred = new DeferredChunkStore(backendReady.then((backend) => backend.store));
    const cache = new RenderCache(
      {
        store: deferred,
        createCodec: (options) => createFrameCodec(options),
        renderFrame: async (project, time, width, height) => {
          const engine = useEngineStore.getState().videoEngine;
          if (!engine) throw new Error("Video engine is not ready");
          const frame = await engine.renderFrame(project, time, width, height);
          return frame.image;
        },
      },
      {
        maxBytes: DEFAULT_BUDGET,
        maxWidth: maxWidthFor(prefs.resolution),
        keyPrefix: backendKeyPrefix(key),
        persistence: { projectKey: key },
        mediaStamps: () => this.sourceStamps,
      },
    );
    this.cache = cache;
    this.cacheKey = key;
    this.unsubscribeCache = cache.subscribe(() => this.notify());
    this.ready = (async () => {
      const backend = await backendReady;
      await this.applyBudget(cache, backend.kind);
      if (backend.persistent) {
        // A reopened project's media comes back offline first. Checking the render files against that state would
        // throw away every frame, so wait for the sources to reconnect (or give up and leave the files untouched).
        if (await this.waitForMediaOnline(MEDIA_ONLINE_TIMEOUT_MS)) {
          await this.restoreFromDisk(cache);
        } else {
          const stop = useProjectStore.subscribe(() => {
            if (this.cache !== cache) return stop();
            if (hasOfflineMedia() || cache.cachedFrameCount() > 0 || cache.isRendering()) return;
            stop();
            void this.restoreFromDisk(cache).then(() => cache.setProject(useProjectStore.getState().getFullProject()));
          });
        }
        if (backend.kind === "opfs") void sweepStaleOpfsProjects(key);
      }
      // Anything edited while the files were being checked is diffed against the restored baseline.
      if (this.cache === cache) cache.setProject(useProjectStore.getState().getFullProject());
    })().catch(() => undefined);
    this.notify();
  }

  private async restoreFromDisk(cache: RenderCache): Promise<void> {
    await this.refreshSourceStamps();
    await cache.restore(useProjectStore.getState().getFullProject());
  }

  /** Resolves true once no media item is an offline placeholder, false after `timeoutMs`. */
  private waitForMediaOnline(timeoutMs: number): Promise<boolean> {
    if (!hasOfflineMedia()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        stop();
        resolve(false);
      }, timeoutMs);
      const stop = useProjectStore.subscribe(() => {
        if (hasOfflineMedia()) return;
        clearTimeout(timer);
        stop();
        resolve(true);
      });
    });
  }

  private readonly onPageHide = (): void => {
    void this.cache?.flushIndex();
  };

  private readonly onPrefsChanged = (): void => {
    const cache = this.cache;
    if (!cache) return;
    const prefs = readRenderCachePrefs();
    cache.setMaxWidth(maxWidthFor(prefs.resolution));
    void this.applyBudget(cache, this.backendKind);
  };

  private async applyBudget(cache: RenderCache, kind: RenderCacheBackendKind | null): Promise<void> {
    try {
      if (kind === "memory") {
        cache.setBudget(EPHEMERAL_BUDGET);
        return;
      }
      if (kind === "desktop-disk") {
        const settings = await desktopBridge()?.getSettings();
        if (settings) cache.setBudget(settings.capBytes);
        return;
      }
      const cap = readRenderCachePrefs().webCapBytes;
      const estimate = await navigator.storage?.estimate?.();
      const quota = estimate?.quota ? Math.max(256 * 1024 * 1024, Math.floor(estimate.quota * 0.6)) : cap;
      cache.setBudget(Math.min(cap, quota));
    } catch {
      /* keep the current budget */
    }
  }

  /** Called when the scratch folder or the size cap changed in Settings. */
  async refreshBudget(): Promise<void> {
    if (this.cache) await this.applyBudget(this.cache, this.backendKind);
  }

  private invalidateStatsFor(prev: Project, next: Project): void {
    // Measured playback cost is only meaningful for unchanged content.
    if (this.stats.size === 0) return;
    const plan = planInvalidation(prev, next);
    if (plan.all) this.stats.clear();
    else if (plan.ranges.length > 0) this.stats.invalidate(plan.ranges);
  }

  private readonly onPreviewInvalidate = (event: Event): void => {
    const detail = (event as CustomEvent<{ audioOnly?: boolean } | undefined>).detail;
    if (detail?.audioOnly) return;
    this.idle?.notifyActivity();
    // Engine-side pixel state (e.g. background removal) changed without a project edit:
    // nothing finer than "everything" is knowable here.
    void this.deleteRenderFiles({ silent: true });
  };

  get instance(): RenderCache {
    return this.ensureStarted();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** In/Out range when marked, else the whole sequence. */
  getRenderRange(): RenderTimeRange | null {
    const duration = useProjectStore.getState().project.timeline.duration;
    if (!(duration > 0)) return null;
    const { loopStart, loopEnd } = useTimelineStore.getState();
    if (loopEnd > loopStart) {
      const start = Math.max(0, loopStart);
      const end = Math.min(duration, loopEnd);
      if (end > start) return { start, end };
    }
    return { start: 0, end: duration };
  }

  async renderInToOut(override?: RenderTimeRange): Promise<RenderSummary | null> {
    return this.runRender("all", override);
  }

  /**
   * Render only the stretches that carry effects, transitions, grades, text or other layers that need compositing
   * (the yellow and red parts of the render bar) inside the In/Out range, skipping plain media.
   */
  async renderEffectsInToOut(override?: RenderTimeRange): Promise<RenderSummary | null> {
    return this.runRender("effects", override);
  }

  /** Ranges of the render bar that still need a render (yellow or red), as time ranges. */
  effectRanges(within: RenderTimeRange): RenderTimeRange[] {
    const project = useProjectStore.getState().getFullProject();
    const segments = buildRenderStatusSegments(project, { cachedRuns: [], measuredMs: () => undefined });
    const needing = segments.filter((s) => s.level === "light" || s.level === "heavy").map((s) => ({ start: s.start, end: s.end }));
    return intersectRanges(normalizeRanges(needing), [within]);
  }

  private async runRender(mode: "all" | "effects", override?: RenderTimeRange): Promise<RenderSummary | null> {
    const cache = this.ensureStarted();
    if (useUIStore.getState().exportState.isExporting || isExportQueueRunning()) {
      toast.warning("Render unavailable", "Wait for the export to finish before rendering previews.");
      return null;
    }
    // A background chunk yields to a render the user asked for.
    await this.yieldIdleRender(cache);
    if (cache.isRendering()) return null;
    await this.ready;
    const duration = useProjectStore.getState().project.timeline.duration;
    const range = override
      ? { start: Math.max(0, override.start), end: Math.min(duration, override.end) }
      : this.getRenderRange();
    if (!range || !(range.end > range.start)) {
      toast.info("Nothing to render", "Add clips to the timeline first.");
      return null;
    }
    await this.refreshSourceStamps();
    cache.setProject(useProjectStore.getState().getFullProject());
    const ranges = mode === "effects" ? this.effectRanges(range) : [range];
    if (ranges.length === 0) {
      toast.info("Nothing to render", "No effects, transitions or layers need rendering in this range.");
      return null;
    }
    const summary = await cache.renderRanges(ranges);
    if (summary.status === "completed") {
      toast.success(
        "Render complete",
        `${summary.framesRendered} frames in ${(summary.elapsedMs / 1000).toFixed(1)}s`,
      );
    } else if (summary.status === "failed") {
      toast.error("Render failed", summary.message);
    }
    return summary;
  }

  /** Status for agents and diagnostics: cached ranges in seconds plus the status-bar segments. */
  getStatus(): {
    rendering: boolean;
    frameCount: number;
    bytes: number;
    budgetBytes: number;
    cachedRanges: Array<{ start: number; end: number }>;
    segments: Array<{ start: number; end: number; level: "cached" | "light" | "heavy"; reasons: readonly string[] }>;
  } {
    const cache = this.ensureStarted();
    const snapshot = cache.getSnapshot();
    const project = useProjectStore.getState().getFullProject();
    const segments = buildRenderStatusSegments(project, {
      cachedRuns: snapshot.cachedRuns,
      measuredMs: (range) => this.stats.mean(range),
    });
    return {
      rendering: snapshot.phase === "rendering",
      frameCount: snapshot.frameCount,
      bytes: snapshot.bytes,
      budgetBytes: snapshot.budget,
      cachedRanges: snapshot.cachedRuns.map((run) => ({
        start: run.start / snapshot.frameRate,
        end: (run.end + 1) / snapshot.frameRate,
      })),
      segments: segments
        .filter((segment) => segment.level !== "none")
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          level: segment.level as "cached" | "light" | "heavy",
          reasons: segment.reasons,
        })),
    };
  }

  cancelRender(): void {
    // A render the user cancelled must not start again by itself until the next edit.
    this.idle?.suspendUntilActivity();
    this.cache?.cancelRender();
  }

  async deleteRenderFiles(options: { silent?: boolean; allProjects?: boolean } = {}): Promise<number> {
    const cache = this.ensureStarted();
    await this.ready;
    const removed = await cache.deleteAll();
    this.stats.clear();
    if (options.allProjects) {
      try {
        const bridge = desktopBridge();
        if (bridge) await bridge.clearAll();
        else await deleteAllOpfsRenderFiles();
      } catch {
        /* the current project's files are already gone */
      }
    }
    if (!options.silent) {
      toast.info("Render files deleted", removed > 0 ? `${removed} cached frames removed.` : "Nothing was cached.");
    }
    return removed;
  }

  /** Frame number when the playhead time has a cached frame, else null. */
  cachedFrameIndex(time: number): number | null {
    if (!this.enabled || !this.cache || !this.started) return null;
    return this.cache.hasFrameAt(time) ? this.cache.frameForTime(time) : null;
  }

  /** Decoded cached frame for playback, or undefined when the live path must render. */
  async takePlaybackFrame(time: number): Promise<ImageBitmap | undefined> {
    if (!this.enabled || !this.cache || !this.started) return undefined;
    if (!this.cache.hasFrameAt(time)) return undefined;
    return this.cache.takeFrame(time);
  }

  /**
   * Cached frames an export of `snapshot` may reuse ("Use previews"), or null
   * when nothing in the cache can match: the cache must hold frames at exactly
   * the export size and frame rate, and a frame is only served for time ranges
   * where the snapshot renders identically to the live project the cache
   * follows (planInvalidation), on the frame grid, with no upscaling.
   */
  createExportFrameSource(
    snapshot: Project,
    settings: { width: number; height: number; frameRate: number; upscaling?: { enabled?: boolean } },
  ): (ExportFrameSource & { readonly stats: { used: number; missed: number } }) | null {
    const cache = this.cache;
    if (!cache || !this.started || cache.cachedFrameCount() === 0 || settings.upscaling?.enabled) return null;
    const live = useProjectStore.getState().getFullProject();
    const size = cacheFrameSize(live.settings.width, live.settings.height, cache.frameWidthLimit);
    if (
      size.width !== settings.width ||
      size.height !== settings.height ||
      live.settings.frameRate !== settings.frameRate ||
      snapshot.settings.frameRate !== settings.frameRate
    ) {
      return null;
    }
    const plan = planInvalidation(snapshot, live);
    if (plan.all) return null;
    const stale = plan.ranges;
    const stats = { used: 0, missed: 0 };
    return {
      stats,
      takeFrame: async (time: number): Promise<ImageBitmap | undefined> => {
        const onGrid = Math.abs(time * settings.frameRate - Math.round(time * settings.frameRate)) < 1e-6;
        const frameTime = (Math.round(time * settings.frameRate) + 0.5) / settings.frameRate;
        const bad = !onGrid || stale.some((range) => frameTime >= range.start && frameTime < range.end);
        const bitmap = bad ? undefined : await cache.takeFrame(time);
        if (bitmap) stats.used++;
        else stats.missed++;
        return bitmap;
      },
    };
  }

  /** True while a Render In to Out is running (the video engine is busy). */
  isRenderingNow(): boolean {
    return this.cache?.isRendering() ?? false;
  }

  hasCachedFrames(): boolean {
    return this.cache !== null && this.cache.cachedFrameCount() > 0;
  }

  logFrame(time: number, source: "cache" | "live"): void {
    if (source === "cache") this.cacheFrames++;
    else this.liveFrames++;
    this.frameLog.push({ at: performance.now(), time, source });
    if (this.frameLog.length > FRAME_LOG_LIMIT) this.frameLog.splice(0, this.frameLog.length - FRAME_LOG_LIMIT);
  }

  recordLiveFrameInterval(time: number, ms: number): void {
    if (ms > 0 && ms < 1500) this.stats.record(time, ms);
  }

  getTelemetry(): PlaybackTelemetry {
    return { entries: this.frameLog.slice(), cacheFrames: this.cacheFrames, liveFrames: this.liveFrames };
  }

  resetTelemetry(): void {
    this.frameLog = [];
    this.cacheFrames = 0;
    this.liveFrames = 0;
  }

  dispose(): void {
    this.idle?.dispose();
    this.idle = null;
    for (const cleanup of this.idleCleanups) cleanup();
    this.idleCleanups = [];
    this.battery = null;
    this.unsubscribeProject?.();
    this.unsubscribeProject = null;
    this.unsubscribeCache?.();
    this.unsubscribeCache = null;
    window.removeEventListener("openreel:preview-invalidate", this.onPreviewInvalidate);
    window.removeEventListener(RENDER_CACHE_PREFS_EVENT, this.onPrefsChanged);
    window.removeEventListener("pagehide", this.onPageHide);
    void this.cache?.detach();
    this.releaseLock?.();
    this.releaseLock = null;
    this.cache = null;
    this.cacheKey = "";
    this.started = false;
  }
}

export const renderCacheService = new RenderCacheService();
registerExportFrameSourceProvider((project, settings) => renderCacheService.createExportFrameSource(project, settings));

const EMPTY_SNAPSHOT: RenderCacheSnapshot = {
  phase: "idle",
  progress: null,
  cachedRuns: [],
  frameRate: 30,
  bytes: 0,
  budget: DEFAULT_BUDGET,
  frameCount: 0,
  codec: null,
  version: 0,
  lastSummary: null,
  maxWidth: 1920,
  restored: null,
};

/** What background rendering is doing (off, waiting for a quiet period, rendering a range, paused). */
export function useIdleRenderState(): IdleRenderState {
  return useSyncExternalStore(
    (listener) => renderCacheService.subscribeIdleRender(listener),
    () => renderCacheService.getIdleRenderState(),
    () => OFF_STATE,
  );
}

const OFF_STATE: IdleRenderState = { kind: "off" };

/** Live snapshot of the render cache for React. */
export function useRenderCacheSnapshot(): RenderCacheSnapshot {
  return useSyncExternalStore(
    (listener) => {
      try {
        renderCacheService.ensureStarted();
      } catch {
        /* no project store yet: the snapshot stays empty */
      }
      return renderCacheService.subscribe(listener);
    },
    () => renderCacheService.getSnapshot(),
    () => EMPTY_SNAPSHOT,
  );
}
