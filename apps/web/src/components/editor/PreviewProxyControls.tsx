import React, { useState } from "react";
import type { MediaItem } from "@openreel/core";
import type { PreviewProxyPreset } from "../../services/preview-proxy-cache";
import { previewProxyCache, usePreviewProxyStore } from "../../stores/preview-proxy-store";

const labels = { low: "Up to 540p · Faster", medium: "Up to 720p · Balanced", high: "Up to 1080p · Clearer" };
export const PreviewProxyBadge: React.FC<{ mediaId: string }> = ({ mediaId }) => {
  const entry = usePreviewProxyStore((state) => state.entries[mediaId]);
  if (!entry) return null;
  const label = entry.status === "ready" ? (entry.enabled ? "Proxy preview" : "Original preview") : entry.status === "encoding" ? `Proxy ${Math.round(entry.progress * 100)}%` : entry.status === "queued" ? "Proxy queued" : "Original preview";
  return <span className="absolute z-10 left-1 top-1 max-w-[calc(100%-8px)] truncate rounded bg-black/75 px-1.5 py-0.5 text-[9px] text-white pointer-events-none">{label}</span>;
};

export const PreviewProxyControls: React.FC<{ item: MediaItem }> = ({ item }) => {
  const entry = usePreviewProxyStore((state) => state.entries[item.id]);
  const [preset, setPreset] = useState<PreviewProxyPreset>(entry?.preset ?? "medium");
  const busy = entry?.status === "queued" || entry?.status === "encoding";
  const heavy = item.metadata.width >= 3840 || item.metadata.height >= 2160 || item.metadata.duration >= 600 || item.metadata.fileSize >= 500 * 1024 * 1024;
  if (item.type !== "video" || item.isPlaceholder || item.isPending) return null;
  return (
    <section aria-label={`Preview performance for ${item.name}`} className="min-w-0 rounded-lg border border-border bg-bg-2 p-3 space-y-2">
      <div className="text-xs font-semibold text-fg-2">Smoother preview {heavy && <span className="font-normal text-accent">· Recommended</span>}</div>
      <p className="text-[11px] text-fg-muted leading-relaxed">Create a smaller copy for editing. Exports always use your original video. Cached in this tab, up to 256 MB.</p>
      <label className="block text-[11px] text-fg-muted">Preview quality
        <select aria-label="Proxy quality" value={preset} onChange={(event) => setPreset(event.target.value as PreviewProxyPreset)} disabled={busy} className="mt-1 min-h-[40px] w-full min-w-0 rounded border border-border bg-bg px-2 text-xs text-fg-2">
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {entry?.status === "ready" && entry.width && entry.height && <p className="text-[11px] text-fg-muted">Proxy ready · {entry.width} × {entry.height} · {((entry.blob?.size ?? 0) / 1024 / 1024).toFixed(1)} MB</p>}
      {busy ? <>
        <div role="status" className="text-[11px] text-fg-muted">{entry.status === "queued" ? "Queued — one video at a time" : `Creating proxy · ${Math.round(entry.progress * 100)}%`}</div>
        <progress aria-label={`Proxy progress for ${item.name}`} value={entry.progress} max={1} className="w-full h-1.5 accent-[var(--accent)]" />
        <button type="button" className="min-h-[40px] w-full rounded border border-border text-xs text-fg-2" onClick={() => previewProxyCache.remove(item.id)}>Cancel proxy</button>
      </> : <>
        {entry?.status === "ready" && <div className="flex gap-1" role="group" aria-label="Preview source">
          <button type="button" aria-pressed={!entry.enabled} onClick={() => previewProxyCache.setEnabled(item.id, false)} className={`min-h-[40px] flex-1 rounded border text-xs ${!entry.enabled ? "border-accent text-accent" : "border-border text-fg-muted"}`}>Original</button>
          <button type="button" aria-pressed={entry.enabled} onClick={() => previewProxyCache.setEnabled(item.id, true)} className={`min-h-[40px] flex-1 rounded border text-xs ${entry.enabled ? "border-accent text-accent" : "border-border text-fg-muted"}`}>Proxy</button>
        </div>}
        {entry?.error && <p role="status" className="text-[11px] text-status-warning break-words">{entry.error}</p>}
        <button type="button" onClick={() => previewProxyCache.request(item, preset)} className="min-h-[40px] w-full rounded border border-accent/40 bg-accent-soft text-xs text-accent">{entry?.status === "ready" ? "Recreate proxy" : "Create preview proxy"}</button>
        {entry?.status === "ready" && <button type="button" onClick={() => previewProxyCache.remove(item.id)} className="min-h-[40px] w-full text-[11px] text-fg-muted">Remove cached proxy</button>}
      </>}
    </section>
  );
};
