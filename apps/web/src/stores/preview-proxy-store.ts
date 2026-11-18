import { useStore } from "zustand";
import { FFmpegFallback, MediaImportService, getDeviceProfile, getMediaEngine, nativeMediaAvailable, proxyViaNative } from "@openreel/core";
import { PreviewProxyCache, computeProxyCacheBytes, computeProxyConcurrency, type PreviewProxyState } from "../services/preview-proxy-cache";
import { loadMediaRecord } from "../services/media-storage";
import { useProjectStore } from "./project-store";
import { useTimelineStore } from "./timeline-store";
import { useUIStore } from "./ui-store";

const isDesktop = () => typeof window !== "undefined" && window.openreel?.platform === "desktop";
const logicalCores = () => (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
// Native jobs cannot be paused mid-run, so playback and export hold back the next job instead.
const isBusy = () => useTimelineStore.getState().playbackState === "playing" || useUIStore.getState().exportState.isExporting;

// A dedicated fallback worker makes proxy cancellation safe during imports/exports.
export const previewProxyCache = new PreviewProxyCache({
  async loadOriginal(projectId, item) {
    if (item.blob) return item.blob;
    if (item.fileHandle) return item.fileHandle.getFile();
    const record = await loadMediaRecord(item.id);
    if (record?.projectId === projectId && record.blob) return record.blob;
    throw new Error("Relink the original media before creating a preview proxy.");
  },
  async inspect(blob) {
    const metadata = await getMediaEngine().extractMetadata(blob);
    if (!metadata.hasVideo || !(metadata.canDecodeVideo ?? metadata.canDecode)) throw new Error("This browser cannot play the generated proxy. Using the original.");
    return { width: metadata.width, height: metadata.height, duration: metadata.duration, frameRate: metadata.frameRate, codec: metadata.codec };
  },
  getConcurrency: () => computeProxyConcurrency(logicalCores(), isDesktop()),
  isPaused: () => isDesktop() && isBusy(),
  async getMaxBytes() {
    if (!isDesktop()) return computeProxyCacheBytes(null, false);
    try {
      return computeProxyCacheBytes((await getDeviceProfile()).memory.gb * 1024 ** 3, true);
    } catch {
      return computeProxyCacheBytes(null, false);
    }
  },
  async generate(file, preset, onProgress, signal) {
    if (isDesktop()) {
      // Never fall back to ffmpeg.wasm on desktop; a missing native bridge is an error.
      if (!nativeMediaAvailable()) throw new Error("Native media tools are unavailable. Using the original.");
      signal.throwIfAborted();
      // The native job reports no progress; the entry stays "encoding" until it finishes.
      const proxy = await proxyViaNative(file, preset);
      signal.throwIfAborted();
      onProgress(1);
      return proxy;
    }
    const fallback = new FFmpegFallback();
    const service = new MediaImportService(undefined, fallback);
    try {
      await service.initialize();
      return await service.generateProxyWithPreset(file, preset, (progress) => onProgress(progress.progress), signal);
    } finally {
      fallback.terminate();
    }
  },
});

const sync = () => {
  const { project, hasOpenProject } = useProjectStore.getState();
  previewProxyCache.syncProject(hasOpenProject ? project : null);
};
sync();
const unsubscribeBusy = (() => {
  if (!isDesktop()) return () => {};
  const resumeIfIdle = () => { if (!isBusy()) previewProxyCache.resume(); };
  const offPlayback = useTimelineStore.subscribe((state, previous) => { if (state.playbackState !== previous.playbackState) resumeIfIdle(); });
  const offExport = useUIStore.subscribe((state, previous) => { if (state.exportState.isExporting !== previous.exportState.isExporting) resumeIfIdle(); });
  return () => { offPlayback(); offExport(); };
})();
const unsubscribe = useProjectStore.subscribe((state, previous) => {
  if (state.project !== previous.project || state.hasOpenProject !== previous.hasOpenProject) sync();
});
if (import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribe();
  unsubscribeBusy();
  previewProxyCache.syncProject(null);
});

export const usePreviewProxyStore = <T,>(selector: (state: PreviewProxyState) => T): T => useStore(previewProxyCache.store, selector);
