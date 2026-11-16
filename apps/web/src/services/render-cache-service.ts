import { useSyncExternalStore } from "react";
import {
  IndexedDbChunkStore,
  MemoryChunkStore,
  PlaybackFrameStats,
  RenderCache,
  buildRenderStatusSegments,
  cacheFrameSize,
  createFrameCodec,
  planInvalidation,
  type ChunkStore,
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

const DEFAULT_BUDGET = 2 * 1024 * 1024 * 1024;
const SESSION_KEY_PREFIX = "openreel-render-cache:";

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

class RenderCacheService {
  private cache: RenderCache | null = null;
  private started = false;
  private unsubscribeProject: (() => void) | null = null;
  readonly stats = new PlaybackFrameStats();
  private frameLog: PlaybackFrameLogEntry[] = [];
  private cacheFrames = 0;
  private liveFrames = 0;
  private enabled = true;

  /** Idempotent: creates the cache and starts following the project store. */
  ensureStarted(): RenderCache {
    if (this.cache && this.started) return this.cache;
    const store: ChunkStore =
      typeof indexedDB === "undefined" ? new MemoryChunkStore() : new IndexedDbChunkStore();
    const sessionId = globalThis.crypto?.randomUUID?.() ?? `s${Date.now()}${Math.random().toString(36).slice(2)}`;
    void this.sweepDeadSessions(store, sessionId);
    const cache = new RenderCache(
      {
        store,
        createCodec: (options) => createFrameCodec(options),
        renderFrame: async (project, time, width, height) => {
          const engine = useEngineStore.getState().videoEngine;
          if (!engine) throw new Error("Video engine is not ready");
          const frame = await engine.renderFrame(project, time, width, height);
          return frame.image;
        },
      },
      { maxBytes: DEFAULT_BUDGET, keyPrefix: `${SESSION_KEY_PREFIX}${sessionId}:` },
    );
    this.cache = cache;
    void this.applyQuotaBudget(cache);
    const follow = () => {
      const state = useProjectStore.getState();
      const full = state.getFullProject();
      const prevProject = this.lastProject;
      this.lastProject = full;
      cache.setProject(full);
      if (prevProject) this.invalidateStatsFor(prevProject, full);
    };
    follow();
    this.unsubscribeProject = useProjectStore.subscribe((state, previous) => {
      if (state.project !== previous.project) follow();
    });
    window.addEventListener("openreel:preview-invalidate", this.onPreviewInvalidate);
    this.started = true;
    return cache;
  }

  private lastProject: Project | null = null;

  /**
   * Render files do not survive a reload: the in-memory index that says which
   * frames are valid is gone, so anything a previous session left behind could
   * be stale. Each tab owns a Web Lock for its lifetime; entries of sessions
   * whose lock is no longer held are removed, other open tabs are untouched.
   */
  private async sweepDeadSessions(store: ChunkStore, sessionId: string): Promise<void> {
    try {
      const locks = navigator.locks;
      if (!locks?.request || !locks.query) {
        await store.clear();
        return;
      }
      void locks.request(`${SESSION_KEY_PREFIX}${sessionId}`, () => new Promise<never>(() => undefined));
      const state = await locks.query();
      const live = new Set<string>([sessionId]);
      for (const lock of state.held ?? []) {
        if (lock.name?.startsWith(SESSION_KEY_PREFIX)) live.add(lock.name.slice(SESSION_KEY_PREFIX.length));
      }
      await store.purge?.((key) => {
        if (!key.startsWith(SESSION_KEY_PREFIX)) return false;
        const owner = key.slice(SESSION_KEY_PREFIX.length).split(":")[0];
        return live.has(owner);
      });
    } catch {
      /* a failed sweep only leaves unreachable bytes behind */
    }
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
    // Engine-side pixel state (e.g. background removal) changed without a
    // project edit: nothing finer than "everything" is knowable here.
    void this.deleteRenderFiles({ silent: true });
  };

  private async applyQuotaBudget(cache: RenderCache): Promise<void> {
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota) {
        cache.setBudget(Math.max(256 * 1024 * 1024, Math.min(DEFAULT_BUDGET, Math.floor(estimate.quota * 0.4))));
      }
    } catch {
      /* keep the default budget */
    }
  }

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
    const cache = this.ensureStarted();
    if (useUIStore.getState().exportState.isExporting || isExportQueueRunning()) {
      toast.warning("Render unavailable", "Wait for the export to finish before rendering previews.");
      return null;
    }
    if (cache.isRendering()) return null;
    const duration = useProjectStore.getState().project.timeline.duration;
    const range = override
      ? { start: Math.max(0, override.start), end: Math.min(duration, override.end) }
      : this.getRenderRange();
    if (!range || !(range.end > range.start)) {
      toast.info("Nothing to render", "Add clips to the timeline first.");
      return null;
    }
    cache.setProject(useProjectStore.getState().getFullProject());
    const summary = await cache.renderRange(range);
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
    this.cache?.cancelRender();
  }

  async deleteRenderFiles(options: { silent?: boolean } = {}): Promise<number> {
    const cache = this.ensureStarted();
    const removed = await cache.deleteAll();
    this.stats.clear();
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
    const size = cacheFrameSize(live.settings.width, live.settings.height);
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
    this.unsubscribeProject?.();
    this.unsubscribeProject = null;
    window.removeEventListener("openreel:preview-invalidate", this.onPreviewInvalidate);
    this.cache?.dispose();
    this.cache = null;
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
};

/** Live snapshot of the render cache for React. */
export function useRenderCacheSnapshot(): RenderCacheSnapshot {
  return useSyncExternalStore(
    (listener) => {
      let unsubscribe: (() => void) | undefined;
      try {
        unsubscribe = renderCacheService.ensureStarted().subscribe(listener);
      } catch {
        unsubscribe = undefined;
      }
      return () => unsubscribe?.();
    },
    () => {
      try {
        return renderCacheService.instance.getSnapshot();
      } catch {
        return EMPTY_SNAPSHOT;
      }
    },
    () => EMPTY_SNAPSHOT,
  );
}
