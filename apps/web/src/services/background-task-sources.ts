import { backgroundTasks, type BackgroundTaskInput, type BackgroundTaskStatus } from "@openreel/core/tasks/task-registry";
import type { ExportJob } from "@openreel/core";
import { useExportQueueStore } from "../stores/export-queue-store";
import { previewProxyCache } from "../stores/preview-proxy-store";
import { useUIStore } from "../stores/ui-store";
import { cancelProxyJob, queueProxies } from "./proxy-ingest";
import { useDesktopIngestStore } from "./desktop-ingest";
import { useProjectStore } from "../stores/project-store";
import { getBeatSyncBridge } from "../bridges/beat-sync-bridge";
import { renderCacheService } from "./render-cache-service";
import { watchNativePluginRenderTasks } from "./native-plugin-tasks";

/**
 * Mirrors the existing job systems into the unified task registry. Nothing here runs work: the
 * export queue, proxy cache and direct export keep their own state, and every control forwards
 * to the owning system. Imports, scene detection and transcription report through
 * `backgroundTasks.track` / `upsert` at their call sites.
 */

const EXPORT_STATUS: Record<ExportJob["status"], BackgroundTaskStatus> = {
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  interrupted: "failed",
};

function syncExportQueue(): void {
  const { queue, cancel, retry, start } = useExportQueueStore.getState();
  backgroundTasks.syncSource(
    "export-queue",
    queue.jobs.map((job) => ({
      task: {
        id: `export-queue:${job.id}`,
        kind: "export",
        source: "export-queue",
        title: job.kind === "stems" ? `Stems · ${job.sequenceName}` : `Export · ${job.outputName}`,
        detail: job.status === "queued" && queue.paused ? "Export queue is paused \u00b7 Resume starts the whole queue" : job.status === "running" ? job.phase || job.presetLabel : job.status === "interrupted" ? "Interrupted by a restart" : job.presetLabel,
        // Queued jobs wait on the queue's own Start switch. Pausing is a queue-wide action, so no per-row Pause is offered.
        status: job.status === "queued" && queue.paused ? "paused" : EXPORT_STATUS[job.status],
        progress: job.status === "queued" ? 0 : job.progress,
        etaMs: job.status === "running" ? job.etaMs : undefined,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      } satisfies BackgroundTaskInput,
      controls: { cancel: () => cancel(job.id), retry: () => retry(job.id), resume: start },
    })),
  );
}

function syncDirectExport(): void {
  const { isExporting, progress, phase } = useUIStore.getState().exportState;
  backgroundTasks.syncSource(
    "export",
    isExporting
      ? [{ task: { id: "export:direct", kind: "export", source: "export", title: "Export", detail: phase || undefined, status: "running", progress } }]
      : [],
  );
}

type ProxyItem = { task: BackgroundTaskInput; controls: { cancel: () => void; retry: () => void } };

/** Last active snapshot of each proxy job, so a job that leaves the cache can be shown as finished or cancelled. */
const proxyLive = new Map<string, ProxyItem>();
/** Finished proxy jobs (completed / cancelled this session), listed until cleared. */
const proxyHistory = new Map<string, ProxyItem>();
const proxyCancelled = new Set<string>();

function finishedProxy(item: ProxyItem, status: "completed" | "cancelled"): ProxyItem {
  return { ...item, task: { ...item.task, status, progress: status === "completed" ? 1 : item.task.progress, error: undefined, etaMs: undefined, finishedAt: Date.now() } };
}

function syncProxies(): void {
  const { entries } = previewProxyCache.store.getState();
  const mediaItems = useProjectStore.getState().project.mediaLibrary.items;
  const names = new Map(mediaItems.map((m) => [m.id, m.name]));
  const active = new Map<string, ProxyItem>();
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.status === "ready") continue;
    const key = `proxy:${id}`;
    active.set(key, {
      task: {
        id: key,
        kind: "proxy",
        source: "proxy",
        title: `Proxy · ${entry.source.name}`,
        detail: `${entry.preset} quality`,
        status: entry.status === "error" ? "failed" : entry.status === "encoding" ? "running" : "queued",
        progress: entry.status === "queued" ? 0 : entry.progress,
        error: entry.error,
        createdAt: entry.createdAt,
      },
      controls: {
        cancel: () => { proxyCancelled.add(key); cancelProxyJob(id); },
        retry: () => void queueProxies([id], entry.preset, true),
      },
    });
  }
  // Desktop native proxy jobs (ffmpeg sidecar) live in the ingest store.
  for (const [mediaId, job] of Object.entries(useDesktopIngestStore.getState().jobs)) {
    if (job.status === "done") continue;
    const key = `proxy:native:${mediaId}`;
    active.set(key, {
      task: {
        id: key,
        kind: "proxy",
        source: "proxy",
        title: `Proxy · ${names.get(mediaId) ?? job.fileName}`,
        detail: `${job.profile.codec === "prores-proxy" ? "ProRes Proxy" : "H.264"} · ${job.profile.size}`,
        status: job.status === "failed" ? "failed" : job.status === "running" ? "running" : "queued",
        progress: job.status === "queued" ? 0 : job.progress,
        error: job.error,
      },
      controls: {
        cancel: () => { proxyCancelled.add(key); cancelProxyJob(mediaId); },
        retry: () => void queueProxies([mediaId], undefined, true),
      },
    });
  }
  // A job that left the cache either finished (a proxy is linked / ready), was cancelled here, or was removed with its media.
  for (const [key, last] of proxyLive) {
    if (active.has(key)) continue;
    proxyLive.delete(key);
    if (proxyCancelled.delete(key)) {
      proxyHistory.set(key, finishedProxy(last, "cancelled"));
      continue;
    }
    const mediaId = key.startsWith("proxy:native:") ? key.slice("proxy:native:".length) : key.slice("proxy:".length);
    const ready = entries[mediaId]?.status === "ready" || !!mediaItems.find((m) => m.id === mediaId)?.proxy;
    if (ready && last.task.status !== "failed") proxyHistory.set(key, finishedProxy(last, "completed"));
  }
  for (const [key, item] of active) {
    proxyLive.set(key, item);
    proxyHistory.delete(key);
  }
  backgroundTasks.syncSource("proxy", [...active.values(), ...proxyHistory.values()]);
}

function syncCopies(): void {
  const names = new Map(useProjectStore.getState().project.mediaLibrary.items.map((m) => [m.id, m.name]));
  backgroundTasks.syncSource(
    "ingest-copy",
    Object.entries(useDesktopIngestStore.getState().copying).map(([mediaId, progress]) => ({
      task: { id: `ingest:copy:${mediaId}`, kind: "import" as const, source: "ingest-copy", title: `Copy to project \u00b7 ${names.get(mediaId) ?? mediaId}`, detail: "Copying and verifying checksum", status: "running" as const, progress },
    })),
  );
}

function syncBeats(): void {
  const state = getBeatSyncBridge().getState();
  backgroundTasks.syncSource(
    "beat-detection",
    state.isAnalyzing
      ? [{ task: { id: "analysis:beats", kind: "analysis", source: "beat-detection", title: "Beat detection", status: "running", progress: state.progress / 100 } }]
      : [],
  );
}

/** Render In to Out / Render Effects In to Out (the render cache). The cache owns the job; this row mirrors and cancels it. */
function syncRenderCache(): void {
  const snapshot = renderCacheService.getSnapshot();
  const progress = snapshot.progress;
  const summary = snapshot.lastSummary;
  if (snapshot.phase === "rendering") {
    backgroundTasks.syncSource("render-cache", [
      {
        task: {
          id: "render:cache",
          kind: "render",
          source: "render-cache",
          title: "Render previews",
          detail: progress ? `${progress.done} of ${progress.total} frames` : undefined,
          status: "running",
          progress: progress && progress.total > 0 ? progress.done / progress.total : null,
        },
        controls: { cancel: () => renderCacheService.cancelRender() },
      },
    ]);
    return;
  }
  backgroundTasks.syncSource(
    "render-cache",
    summary && summary.totalFrames > 0
      ? [
          {
            task: {
              id: "render:cache",
              kind: "render",
              source: "render-cache",
              title: "Render previews",
              detail: summary.status === "completed" ? `${summary.framesRendered} frames rendered` : undefined,
              status: summary.status === "completed" ? "completed" : summary.status === "canceled" ? "cancelled" : "failed",
              progress: summary.status === "completed" ? 1 : null,
              error: summary.status === "failed" ? summary.message : undefined,
              finishedAt: Date.now(),
            },
          },
        ]
      : [],
  );
}

let started: (() => void) | null = null;

/** Idempotent; returns a disposer (HMR / tests). */
export function startBackgroundTaskSources(): () => void {
  if (started) return started;
  syncExportQueue();
  syncDirectExport();
  syncProxies();
  syncBeats();
  syncCopies();
  syncRenderCache();
  const offs = [
    useExportQueueStore.subscribe((s, p) => { if (s.queue !== p.queue) syncExportQueue(); }),
    useUIStore.subscribe((s, p) => { if (s.exportState !== p.exportState) syncDirectExport(); }),
    previewProxyCache.store.subscribe(syncProxies),
    useDesktopIngestStore.subscribe((s, p) => { if (s.jobs !== p.jobs) syncProxies(); if (s.copying !== p.copying) syncCopies(); }),
    getBeatSyncBridge().subscribe(syncBeats),
    renderCacheService.subscribe(syncRenderCache),
    watchNativePluginRenderTasks(),
  ];
  // Desktop watch folders: loaded on demand so the entry chunk does not carry it.
  let stopWatchTasks: (() => void) | null = null;
  let disposed = false;
  if (typeof window !== "undefined" && window.openreel?.watchFolders) {
    void import("./watch-folder-tasks").then((m) => {
      if (disposed) return;
      stopWatchTasks = m.startWatchFolderTasks();
    });
  }
  const dispose = () => {
    disposed = true;
    stopWatchTasks?.();
    offs.forEach((off) => off());
    started = null;
  };
  started = dispose;
  return dispose;
}
