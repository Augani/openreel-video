import React, { useMemo, useState } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { ChevronDown, ChevronRight } from "@/icons/lucide-compat";
import {
  DESKTOP_PROXY_CODECS,
  DESKTOP_PROXY_SIZES,
  PROXY_PRESETS,
  proxyPresetForProfile,
  PROXY_STATE_LABEL,
  formatProxyCounts,
  proxyDisplayState,
  resolveDesktopConcurrency,
  resolveDesktopProxyProfile,
  summarizeProxyStates,
  type DesktopProxyCodec,
  type ProxyPresetId,
  type DesktopProxySize,
  type IngestPreset,
  type MediaItem,
  type ProxyDisplayState,
} from "@openreel/core";
import { CreateProxiesDialog } from "./CreateProxiesDialog";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { usePreviewProxyStore } from "../../stores/preview-proxy-store";
import type { PreviewProxyPreset } from "../../services/preview-proxy-cache";
import {
  attachProxyFiles,
  attachProxyBlobs,
  cancelProxyJob,
  detachProxies,
  queueProxies,
  setImportOverride,
  setProjectIngestPreset,
  setProxiesOn,
  setProxyQuality,
  useProxyIngestStore,
} from "../../services/proxy-ingest";
import { toast } from "../../stores/notification-store";
import {
  cancelDesktopJob,
  chooseIngestFolder,
  desktopIngestAvailable,
  relinkFromFolder,
  retryFailedDesktopProxies,
  revealIngestFolder,
  setDesktopProxyProfile,
  updateDesktopIngestConfig,
  useDesktopIngestStore,
} from "../../services/desktop-ingest";

const QUALITY_LABELS: Record<PreviewProxyPreset, string> = {
  low: "Up to 540p · Fastest",
  medium: "Up to 720p · Balanced",
  high: "Up to 1080p · Clearer",
};

const PRESET_LABELS: Record<IngestPreset, string> = {
  none: "None",
  proxies: "Create proxies",
  copy: "Copy media to project",
};
/** Copy-to-project needs a file on disk to copy, so only desktop offers it. */
const presetEntries = (desktop: boolean): Array<[string, string]> =>
  Object.entries(PRESET_LABELS).filter(([value]) => desktop || value !== "copy");

export interface ProxyRow {
  item: MediaItem;
  state: ProxyDisplayState;
  progress: number;
  error?: string;
  /** Desktop: the proxy file is on disk but the preview cannot decode it (it is for external tools). */
  external?: boolean;
}

/** Project-panel proxy state for every video item (also used by the badges). */
export function useProxyRows(): ProxyRow[] {
  const items = useProjectStore((s) => s.project.mediaLibrary.items);
  const entries = usePreviewProxyStore((s) => s.entries);
  const missing = useProxyIngestStore((s) => s.missing);
  const nativeJobs = useDesktopIngestStore((s) => s.jobs);
  const nativeFiles = useDesktopIngestStore((s) => s.files);
  return useMemo(
    () =>
      items
        .filter((item) => item.type === "video" && !item.subclip)
        .map((item) => {
          const entry = entries[item.id];
          const native = nativeJobs[item.id];
          const job = native
            ? native.status === "failed" ? "error" : native.status === "running" ? "encoding" : "queued"
            : entry?.status === "queued" || entry?.status === "encoding" || entry?.status === "error" ? entry.status : undefined;
          const file = nativeFiles[item.id];
          const state = proxyDisplayState(item, {
            fullAvailable: !item.isPlaceholder && !item.isPending && Boolean(item.blob || item.fileHandle),
            proxyAvailable: !missing[item.id] && ((entry?.status === "ready" && !!entry.persisted) || file?.exists === true),
            job,
          });
          return { item, state, progress: native?.progress ?? entry?.progress ?? 0, error: native?.error ?? entry?.error, external: file?.exists === true && !file.previewable };
        }),
    [items, entries, missing, nativeJobs, nativeFiles],
  );
}

const STATE_TONE: Record<ProxyDisplayState, string> = {
  none: "text-fg-muted",
  ready: "text-accent",
  building: "text-fg-2",
  failed: "text-status-warning",
  "missing-proxy": "text-status-warning",
  "missing-full": "text-status-warning",
};

/** Opens the system file picker (an input that never enters the DOM, so it cannot collide with the import input). */
function pickFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,.mxf";
    input.multiple = multiple;
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

const smallButton = "h-7 min-w-0 rounded border border-border px-2 text-[11px] text-fg-2";

export const ProxyIngestPanel: React.FC = () => {
  const rows = useProxyRows();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const desktop = desktopIngestAvailable();
  const preset = useProjectStore((s) => s.project.mediaLibrary.ingestPreset ?? "none");
  const ingestConfig = useProjectStore((s) => s.project.mediaLibrary.desktopIngest);
  const offlineCount = useProjectStore((s) => s.project.mediaLibrary.items.filter((item) => item.isPlaceholder && !item.isPending).length);
  const folders = useDesktopIngestStore((s) => s.folders);
  const copying = useDesktopIngestStore((s) => s.copying);
  const override = useProxyIngestStore((s) => s.importOverride);
  const quality = useProxyIngestStore((s) => s.quality);
  const proxiesOn = usePreviewProxyStore((s) => s.proxiesOn);
  const rowIds = useMemo(() => new Set(rows.map((row) => row.item.id)), [rows]);
  // Only selected media rows matter; a string key keeps timeline-clip selection out of this render.
  const selectedRowKey = useUIStore((s) => s.selectedItems.filter((entry) => rowIds.has(entry.id)).map((entry) => entry.id).join("\u0000"));
  const replaceMediaAsset = useProjectStore((s) => s.replaceMediaAsset);

  const counts = useMemo(() => summarizeProxyStates(rows.map((row) => row.state)), [rows]);
  if (rows.length === 0) return null;

  const profile = resolveDesktopProxyProfile({ mediaLibrary: { items: [], desktopIngest: ingestConfig } });
  const concurrency = resolveDesktopConcurrency({ mediaLibrary: { items: [], desktopIngest: ingestConfig } });
  const selectedIds = new Set(selectedRowKey.split("\u0000").filter(Boolean));
  const targets = rows.filter((row) => selectedIds.has(row.item.id));
  const createTargets = (targets.length ? targets : rows).filter((row) => row.state === "none" || row.state === "failed" || row.state === "missing-proxy");
  const attention = rows.filter((row) => (row.state !== "none" && row.state !== "ready") || row.external);
  const summary = formatProxyCounts(counts);
  const copyingCount = Object.keys(copying).length;
  // Nothing to report: shrink to a quiet one-line entry point so it never crowds the media grid.
  const quiet = !summary && attention.length === 0 && offlineCount === 0 && preset === "none" && copyingCount === 0;

  const create = () => {
    const result = queueProxies(createTargets.map((row) => row.item.id), quality, true);
    if (!result.queued.length) toast.info("No proxies to create", result.skipped[0]?.reason ?? "Every video already has a proxy.");
  };

  const retryFailed = async () => {
    if (desktop) {
      const count = await retryFailedDesktopProxies();
      // Rows that failed before a restart have no job left; rebuild them from their media.
      const rest = rows.filter((row) => row.state === "failed" && !useDesktopIngestStore.getState().jobs[row.item.id]).map((row) => row.item.id);
      if (rest.length) queueProxies(rest, quality, true);
      if (!count && !rest.length) toast.info("Nothing to retry", "No proxy has failed.");
    } else {
      queueProxies(rows.filter((row) => row.state === "failed").map((row) => row.item.id), quality, true);
    }
  };

  const onAttach = async () => {
    const files = await pickFiles(true);
    if (files.length) await attachProxyFiles(files);
  };

  const pickRelink = async (id: string, kind: "full" | "proxy") => {
    const file = (await pickFiles(false))[0];
    if (!file) return;
    if (kind === "full") {
      const result = await replaceMediaAsset(id, file);
      if (!result.success) toast.error("Could not relink", result.error?.message ?? "Check that the file can be decoded.");
    } else {
      await attachProxyBlobs([{ mediaId: id, blob: file, name: file.name }]);
    }
  };

  const cancelJob = (id: string) => {
    cancelDesktopJob(id);
    cancelProxyJob(id);
  };

  return (
    <section aria-label="Proxies and ingest" data-testid="proxy-panel" className={`min-w-0 text-[11px] ${quiet ? "mx-2 mb-0.5" : "mx-3 mb-2 rounded-md border border-border bg-bg-2"}`}>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Proxy and ingest settings"
        className={`flex w-full min-w-0 items-center gap-1.5 px-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${quiet ? "h-5 text-fg-muted hover:text-fg-2" : "h-7 text-fg-2"}`}
        data-quiet={quiet || undefined}
      >
        <ChevronRight size={12} aria-hidden />
        <span className="font-semibold">Proxies</span>
        <span className="min-w-0 flex-1 truncate text-fg-muted" data-testid="proxy-summary">{summary}</span>
        {attention.length > 0 && <span className="shrink-0 rounded bg-yellow-500/20 px-1 text-[10px] text-yellow-500" data-testid="proxy-attention">{attention.length} need attention</span>}
        {offlineCount > 0 && <span className="shrink-0 rounded bg-yellow-500/20 px-1 text-[10px] text-yellow-500" data-testid="offline-count">{offlineCount} offline</span>}
        {preset === "proxies" && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] text-accent">Ingest on</span>}
        {preset === "copy" && desktop && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] text-accent">Copy on</span>}
      </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" collisionPadding={8} className="w-[22rem] max-w-[calc(100vw-1rem)] border-border bg-bg-2 p-0 text-[11px]" aria-label="Proxies and ingest settings">
        <div className="max-h-[min(36rem,var(--radix-popover-content-available-height,36rem))] space-y-2 overflow-y-auto p-2" data-testid="proxy-panel-body">
          <dl className="grid grid-cols-4 gap-1 text-center" data-testid="proxy-counts" aria-label="Proxy state counts">
            {([["Ready", counts.ready, "ready"], ["Building", counts.building, "building"], ["Missing", counts.missing, "missing"], ["Failed", counts.failed, "failed"]] as const).map(([label, value, key]) => (
              <div key={key} className="min-w-0 rounded border border-border bg-bg-1 px-1 py-1" data-testid={`proxy-count-${key}`}>
                <dd className={`text-[13px] font-semibold ${key === "failed" && value ? "text-status-warning" : key === "missing" && value ? "text-status-warning" : "text-fg-2"}`}>{value}</dd>
                <dt className="truncate text-[10px] text-fg-muted">{label}</dt>
              </div>
            ))}
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-fg-muted">
              Ingest preset
              <Select value={preset === "copy" && !desktop ? "none" : preset} onValueChange={(value) => void setProjectIngestPreset(value as IngestPreset)}>
                <SelectTrigger aria-label="Ingest preset" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presetEntries(desktop).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-0 text-fg-muted">
              This import
              <Select value={override ?? "default"} onValueChange={(value) => setImportOverride(value === "default" ? null : (value as IngestPreset))}>
                <SelectTrigger aria-label="Ingest for this import" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Project default</SelectItem>
                  {presetEntries(desktop).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          {desktop ? (
            <div className="space-y-2" data-testid="desktop-ingest-settings">
              <label className="block min-w-0 text-fg-muted">
                Proxy preset
                <Select
                  value={proxyPresetForProfile(profile) ?? "custom"}
                  onValueChange={(value) => {
                    const chosen = PROXY_PRESETS.find((entry) => entry.id === (value as ProxyPresetId));
                    if (chosen) void setDesktopProxyProfile(chosen.profile);
                  }}
                >
                  <SelectTrigger aria-label="Proxy preset" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROXY_PRESETS.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}
                    {proxyPresetForProfile(profile) === null && <SelectItem value="custom" disabled>Custom</SelectItem>}
                  </SelectContent>
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0 text-fg-muted">
                  Proxy format
                  <Select value={profile.codec} onValueChange={(value) => void setDesktopProxyProfile({ ...profile, codec: value as DesktopProxyCodec })}>
                    <SelectTrigger aria-label="Proxy format" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue>{profile.codec === "prores-proxy" ? "ProRes Proxy" : profile.codec === "dnxhr-lb" ? "DNxHR LB" : "H.264"}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {DESKTOP_PROXY_CODECS.map((codec) => <SelectItem key={codec.id} value={codec.id}>{codec.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="min-w-0 text-fg-muted">
                  Proxy size
                  <Select value={profile.size} onValueChange={(value) => void setDesktopProxyProfile({ ...profile, size: value as DesktopProxySize })}>
                    <SelectTrigger aria-label="Proxy size" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DESKTOP_PROXY_SIZES.map((size) => <SelectItem key={size.id} value={size.id}>{size.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <button
                type="button"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(!moreOpen)}
                className="flex w-full min-w-0 items-center gap-1 text-left text-fg-muted"
                data-testid="proxy-more-settings"
              >
                {moreOpen ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                <span>Jobs and folders</span>
                <span className="min-w-0 flex-1 truncate text-right text-[10px]">{concurrency} at once</span>
              </button>
              {moreOpen && (<>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0 text-fg-muted">
                  Build at once
                  <Select value={String(concurrency)} onValueChange={(value) => void updateDesktopIngestConfig({ concurrency: Number(value) === 2 ? 2 : 1 }, "Set proxy jobs at once")}>
                    <SelectTrigger aria-label="Proxy jobs at once" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 job</SelectItem>
                      <SelectItem value="2">2 jobs</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex min-w-0 items-end gap-1.5 pb-1.5 text-fg-muted">
                  <input
                    type="checkbox"
                    aria-label="Also create proxies when copying"
                    checked={ingestConfig?.proxiesWithCopy === true}
                    onChange={(event) => void updateDesktopIngestConfig({ proxiesWithCopy: event.target.checked }, "Set copy and proxies")}
                  />
                  <span className="min-w-0 leading-tight">Proxies with copy</span>
                </label>
              </div>
              {(["proxy", "media"] as const).map((kind) => {
                const dir = kind === "proxy" ? folders?.proxyDir : folders?.mediaDir;
                return (
                  <div key={kind} className="min-w-0" data-testid={`${kind}-folder`}>
                    <div className="text-fg-muted">{kind === "proxy" ? "Proxies folder" : "Media folder (copy to project)"}</div>
                    <div className="mt-1 flex min-w-0 items-center gap-1">
                      <span className="min-w-0 flex-1 truncate rounded border border-border bg-bg-1 px-1.5 py-1 text-fg-2" title={dir ?? ""}>{dir ?? "Next to the project"}</span>
                      <Button type="button" variant="secondary" className={smallButton} onClick={() => void chooseIngestFolder(kind)} aria-label={kind === "proxy" ? "Choose proxies folder" : "Choose media folder"}>Choose…</Button>
                      <Button type="button" variant="secondary" className={smallButton} onClick={() => revealIngestFolder(kind)} aria-label={kind === "proxy" ? "Reveal proxies folder" : "Reveal media folder"}>Reveal</Button>
                    </div>
                  </div>
                );
              })}
              {folders && !folders.projectSaved && <p className="leading-snug text-fg-muted">Save the project to keep these folders beside it. Until then they live in the app's data folder, and Copy to project waits.</p>}
              </>)}
              {copyingCount > 0 && <p className="text-fg-2" data-testid="copy-progress">Copying {copyingCount} file{copyingCount === 1 ? "" : "s"} to the project… {Math.round((Object.values(copying)[0] ?? 0) * 100)}%</p>}
            </div>
          ) : (
            <label className="block text-fg-muted">
              Proxy size
              <Select value={quality} onValueChange={(value) => setProxyQuality(value as PreviewProxyPreset)}>
                <SelectTrigger aria-label="Proxy size" className="mt-1 h-8 min-w-0 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(QUALITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="secondary" className={smallButton} onClick={create} disabled={!createTargets.length} aria-label="Create proxies">
              {targets.length ? "Create for selected" : "Create proxies"}
            </Button>
            {desktop && (
              <Button type="button" variant="secondary" className={smallButton} onClick={() => setDialogOpen(true)} disabled={!createTargets.length} aria-label="Create proxies with a preset">
                Preset…
              </Button>
            )}
            <Button type="button" variant="secondary" className={smallButton} onClick={() => void retryFailed()} disabled={!counts.failed} aria-label="Retry failed proxies">
              Retry failed{counts.failed ? ` (${counts.failed})` : ""}
            </Button>
            <Button type="button" variant="secondary" className={smallButton} onClick={() => void onAttach()} aria-label="Attach proxies">
              Attach proxies…
            </Button>
            {desktop && (
              <Button type="button" variant="secondary" className={smallButton} onClick={() => void relinkFromFolder("proxy")} aria-label="Search a folder for proxies">
                Find proxies…
              </Button>
            )}
            <Button type="button" variant="secondary" aria-pressed={proxiesOn} className={`${smallButton} ${proxiesOn ? "border-accent text-accent" : ""}`} onClick={() => setProxiesOn(!proxiesOn)} aria-label="Use proxies in preview">
              Proxies {proxiesOn ? "on" : "off"}
            </Button>
          </div>
          {desktop && offlineCount > 0 && (
            <div className="flex min-w-0 items-center gap-1.5 rounded border border-yellow-500/40 bg-yellow-500/5 p-1.5" data-testid="offline-media-row">
              <span className="min-w-0 flex-1 text-yellow-500">{offlineCount} media file{offlineCount === 1 ? " is" : "s are"} offline</span>
              <Button type="button" variant="secondary" className={smallButton} onClick={() => void relinkFromFolder("full")} aria-label="Reconnect full resolution from a folder">Reconnect full resolution…</Button>
            </div>
          )}
          <p className="leading-snug text-fg-muted">
            Proxies are for editing only. Exports and interchange always read the full-resolution media{desktop ? " (the desktop export report says so)" : ""}.
          </p>
          {attention.length > 0 && (
            <ul className="space-y-1.5" aria-label="Proxy jobs and problems">
              {attention.map(({ item, state, progress, error, external }) => (
                <li key={item.id} data-testid="proxy-row" data-state={state} data-external={external ? "true" : undefined} className="min-w-0 rounded border border-border bg-bg-1 p-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-fg-2" title={item.name}>{item.name}</span>
                    <span className={`shrink-0 ${STATE_TONE[state]}`}>{state === "building" ? `${Math.round(progress * 100)}%` : PROXY_STATE_LABEL[state]}</span>
                  </div>
                  {state === "building" && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <Progress aria-label={`Proxy progress for ${item.name}`} value={progress * 100} className="h-1.5 min-w-0 flex-1" />
                      <Button type="button" variant="secondary" className={smallButton} onClick={() => cancelJob(item.id)} aria-label={`Cancel proxy for ${item.name}`}>Cancel</Button>
                    </div>
                  )}
                  {external && state === "ready" && <p className="mt-1 break-words text-fg-muted">The proxy file is on disk for other editing tools. This player cannot decode ProRes, so preview uses the original.</p>}
                  {error && state !== "building" && <p className="mt-1 break-words text-status-warning">{error}</p>}
                  {(state === "failed" || state === "missing-proxy") && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button type="button" variant="secondary" className={smallButton} onClick={() => queueProxies([item.id], quality, true)}>Rebuild</Button>
                      <Button type="button" variant="secondary" className={smallButton} onClick={() => void pickRelink(item.id, "proxy")}>Relink proxy…</Button>
                      {item.proxy && <Button type="button" variant="secondary" className={smallButton} onClick={() => void detachProxies([item.id])}>Remove link</Button>}
                    </div>
                  )}
                  {state === "missing-full" && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button type="button" variant="secondary" className={smallButton} onClick={() => void pickRelink(item.id, "full")}>Reconnect full resolution…</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
      </Popover>
      {desktop && (
        <CreateProxiesDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          count={createTargets.length}
          scopeLabel={targets.length ? "selected" : "without a proxy"}
          onCreate={create}
        />
      )}
    </section>
  );
};

/** Compact warning badge for a media thumbnail: only for states that need the user's attention. */
export const ProxyStateBadge: React.FC<{ mediaId: string }> = ({ mediaId }) => {
  const item = useProjectStore((s) => s.project.mediaLibrary.items.find((candidate) => candidate.id === mediaId));
  const entryStatus = usePreviewProxyStore((s) => s.entries[mediaId]?.status);
  const entryPersistedReady = usePreviewProxyStore((s) => s.entries[mediaId]?.status === "ready" && !!s.entries[mediaId]?.persisted);
  const missing = useProxyIngestStore((s) => Boolean(s.missing[mediaId]));
  const nativeFileExists = useDesktopIngestStore((s) => s.files[mediaId]?.exists === true);
  if (!item || (!item.proxy && entryStatus !== "error")) return null;
  const state = proxyDisplayState(item, {
    fullAvailable: !item.isPlaceholder,
    proxyAvailable: !missing && (entryPersistedReady || nativeFileExists),
    job: entryStatus === "error" ? "error" : undefined,
  });
  if (state !== "missing-proxy" && state !== "missing-full" && state !== "failed") return null;
  return (
    <span data-testid="proxy-badge" data-state={state} className="pointer-events-none absolute bottom-1 right-1 z-10 max-w-[calc(100%-8px)] truncate rounded bg-yellow-600/90 px-1.5 py-0.5 text-[9px] text-white">
      {PROXY_STATE_LABEL[state]}
    </span>
  );
};
