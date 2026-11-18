import type { MediaItem } from "@openreel/core";
import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { previewProxyCache } from "../stores/preview-proxy-store";
import { useDesktopIngestStore } from "../services/desktop-ingest";

const isDesktop = () => typeof window !== "undefined" && window.openreel?.platform === "desktop";
// Codecs the browser decodes slowly or not at all; native proxies make them cheap to proxy.
const HEAVY_CODEC = /hevc|hvc1|hev1|h\.?265|prores|apch|apcn|apcs|apco|ap4h|ap4x/i;
const needsProxy = (item: MediaItem, desktop: boolean) =>
  item.metadata.width >= 3840 ||
  item.metadata.height >= 2160 ||
  (desktop && HEAVY_CODEC.test(item.metadata.codec ?? ""));

/** Applies the user's proxy preference through the existing cancellable cache. */
export function usePreviewProxyPreference() {
  const enabled = useUIStore((state) => state.autoProxy4k);
  const project = useProjectStore((state) => state.project);
  const managed = useRef({ projectId: project.id, ids: new Set<string>() });
  const previousEnabled = useRef(enabled);
  useEffect(() => {
    const wasEnabled = previousEnabled.current;
    previousEnabled.current = enabled;
    if (managed.current.projectId !== project.id)
      managed.current = { projectId: project.id, ids: new Set() };
    const entries = previewProxyCache.store.getState().entries;
    if (!enabled) {
      for (const id of managed.current.ids) {
        const entry = entries[id];
        if (entry?.status === "ready") {
          if (entry.enabled) previewProxyCache.setEnabled(id, false);
        } else if (entry) previewProxyCache.remove(id);
      }
      return;
    }
    const desktop = isDesktop();
    for (const item of project.mediaLibrary.items) {
      if (
        item.type !== "video" ||
        item.isPlaceholder ||
        item.isPending ||
        item.proxy ||
        // A native proxy job (ingest preset / Create proxies on desktop) already covers this item.
        useDesktopIngestStore.getState().jobs[item.id] ||
        !needsProxy(item, desktop)
      )
        continue;
      if (!entries[item.id]) {
        previewProxyCache.request(item, "medium");
        managed.current.ids.add(item.id);
      } else if (
        !wasEnabled &&
        managed.current.ids.has(item.id) &&
        entries[item.id].status === "ready"
      ) {
        previewProxyCache.setEnabled(item.id, true);
      }
    }
  }, [enabled, project.id, project.mediaLibrary.items]);
}
