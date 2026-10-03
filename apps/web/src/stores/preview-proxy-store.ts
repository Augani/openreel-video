import { useStore } from "zustand";
import { FFmpegFallback, MediaImportService, getMediaEngine } from "@openreel/core";
import { PreviewProxyCache, type PreviewProxyState } from "../services/preview-proxy-cache";
import { loadMediaRecord } from "../services/media-storage";
import { useProjectStore } from "./project-store";

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
    return { width: metadata.width, height: metadata.height };
  },
  async generate(file, preset, onProgress, signal) {
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
const unsubscribe = useProjectStore.subscribe((state, previous) => {
  if (state.project !== previous.project || state.hasOpenProject !== previous.hasOpenProject) sync();
});
if (import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribe();
  previewProxyCache.syncProject(null);
});

export const usePreviewProxyStore = <T,>(selector: (state: PreviewProxyState) => T): T => useStore(previewProxyCache.store, selector);
