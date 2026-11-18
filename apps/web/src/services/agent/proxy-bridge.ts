import type { ProxyBridge, ProxyStatusItem } from "@openreel/agent";
import { effectiveIngestPreset, matchProxyFiles, proxyDisplayState, proxyMatchKey, summarizeProxyStates, type MediaItem } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { previewProxyCache } from "../../stores/preview-proxy-store";
import { attachProxyBlobs, proxiesOn, queueProxies, setProxiesOn, useProxyIngestStore, type ProxySource } from "../proxy-ingest";
import {
  copyMediaToProject,
  desktopIngestAvailable,
  refreshFolders,
  relinkFromFolder,
  retryFailedDesktopProxies,
  useDesktopIngestStore,
} from "../desktop-ingest";

const stem = (name: string): string => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim().toLowerCase();
/** A library item whose name carries a proxy suffix (clip_proxy.mp4) is a proxy candidate. */
const looksLikeProxy = (item: MediaItem): boolean => proxyMatchKey(item.name) !== stem(item.name);

export function createProxyBridge(): ProxyBridge {
  return {
    ...(desktopIngestAvailable()
      ? {
          desktop: {
            async retryFailed() {
              return { retried: await retryFailedDesktopProxies() };
            },
            async copyToProject(mediaIds) {
              const items = useProjectStore.getState().project.mediaLibrary.items;
              const ids = mediaIds ?? items.filter((item) => !item.isPlaceholder && !item.copiedFrom && item.sourceFile?.path).map((item) => item.id);
              const report = await copyMediaToProject(ids);
              return { copied: report.copied, skipped: report.skipped };
            },
            async relink(kind, folder) {
              const report = await relinkFromFolder(kind, folder);
              return report
                ? { linked: report.linked, ambiguous: report.ambiguous, notFound: report.notFound, failed: report.failed }
                : { linked: [], ambiguous: [], notFound: [], failed: [] };
            },
            async folders() {
              await refreshFolders();
              return useDesktopIngestStore.getState().folders;
            },
          },
        }
      : {}),
    create(mediaIds, quality, force) {
      const items = useProjectStore.getState().project.mediaLibrary.items;
      const ids = mediaIds ?? items.filter((item) => item.type === "video" && !item.subclip && !item.proxy && !looksLikeProxy(item)).map((item) => item.id);
      return queueProxies(ids, quality, force);
    },
    async attach(pairs) {
      const items = useProjectStore.getState().project.mediaLibrary.items;
      const sources: ProxySource[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      if (pairs) {
        for (const pair of pairs) {
          const proxyItem = items.find((item) => item.id === pair.proxyMediaId);
          if (!proxyItem?.blob) skipped.push({ name: pair.proxyMediaId, reason: "The proxy media is not in the library or is offline." });
          else sources.push({ mediaId: pair.mediaId, blob: proxyItem.blob, name: proxyItem.name });
        }
      } else {
        const proxies = items.filter((item) => item.type === "video" && item.blob && looksLikeProxy(item));
        const originals = items.filter((item) => !proxies.includes(item));
        const match = matchProxyFiles(originals, proxies);
        for (const entry of match.matches) sources.push({ mediaId: entry.mediaId, blob: entry.file.blob as Blob, name: entry.file.name });
      }
      const report = await attachProxyBlobs(sources);
      const nameOf = new Map(items.map((item) => [item.id, item.name]));
      return {
        attached: report.attached.map((entry) => ({ mediaId: entry.mediaId, name: nameOf.get(entry.mediaId) ?? entry.name })),
        skipped: [...skipped, ...report.skipped],
      };
    },
    toggle(on) {
      setProxiesOn(on ?? !proxiesOn());
      return { on: proxiesOn() };
    },
    status() {
      const { project } = useProjectStore.getState();
      const { entries } = previewProxyCache.store.getState();
      const { missing } = useProxyIngestStore.getState();
      const native = useDesktopIngestStore.getState();
      const items: ProxyStatusItem[] = project.mediaLibrary.items
        .filter((item) => item.type === "video" && !item.subclip)
        .map((item) => {
          const entry = entries[item.id];
          const nativeJob = native.jobs[item.id];
          const file = native.files[item.id];
          const job = nativeJob
            ? nativeJob.status === "failed" ? "error" : nativeJob.status === "running" ? "encoding" : "queued"
            : entry?.status === "queued" || entry?.status === "encoding" || entry?.status === "error" ? entry.status : undefined;
          const state = proxyDisplayState(item, {
            fullAvailable: !item.isPlaceholder && !item.isPending && Boolean(item.blob || item.fileHandle),
            proxyAvailable: !missing[item.id] && ((entry?.status === "ready" && !!entry.persisted) || file?.exists === true),
            job,
          });
          return {
            mediaId: item.id,
            name: item.name,
            state,
            ...(file?.exists && !file.previewable ? { external: true } : {}),
            ...(item.proxy ? { proxyWidth: item.proxy.width, proxyHeight: item.proxy.height } : {}),
            ...(state === "building" ? { progress: Math.round((nativeJob?.progress ?? entry?.progress ?? 0) * 100) / 100 } : {}),
          };
        });
      const { total: _total, ...counts } = summarizeProxyStates(items.map((entry) => entry.state));
      void _total;
      return { on: proxiesOn(), ingestPreset: effectiveIngestPreset(project), items, counts };
    },
  };
}
