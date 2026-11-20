import React, { useCallback, useEffect, useState } from "react";
import { FolderInput, FolderOutput, Pause, Play, Plus, RotateCcw, Trash2 } from "@/icons/lucide-compat";
import { Button, Switch } from "@openreel/ui";
import type { OpenReelWatchFolderConfig, OpenReelWatchFoldersBridge, OpenReelWatchFoldersSnapshot, OpenReelWatchFolderStatus, OpenReelWatchItem } from "../../../types/global";

type WatchPatch = Parameters<OpenReelWatchFoldersBridge["update"]>[1];

/** Presets an export watch folder can render: the Export dialog's quick presets. */
export const WATCH_EXPORT_PRESETS: ReadonlyArray<{ id: string; label: string; audioOnly?: boolean }> = [
  { id: "mp4", label: "MP4 Standard (source size)" },
  { id: "1080p-high", label: "1080p High Quality" },
  { id: "1080p-60", label: "1080p 60fps" },
  { id: "4k", label: "4K Standard" },
  { id: "wav", label: "Audio Only (WAV)", audioOnly: true },
];

const STATE_LABEL: Record<OpenReelWatchFolderStatus["state"], string> = {
  watching: "Watching",
  paused: "Paused",
  missing: "Folder missing",
  error: "Error",
};

function summary(status: OpenReelWatchFolderStatus): string {
  const parts: string[] = [];
  if (status.detecting) parts.push(`${status.detecting} copying`);
  if (status.running) parts.push(`${status.running} running`);
  if (status.queued) parts.push(`${status.queued} queued`);
  if (status.done) parts.push(`${status.done} done`);
  if (status.failed) parts.push(`${status.failed} failed`);
  if (status.duplicates) parts.push(`${status.duplicates} duplicate`);
  return parts.join(" · ");
}

const fieldClass = "h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring";
const iconButton = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-2 outline-none transition-colors hover:bg-bg-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring";

function IngestOptions({ config, onPatch }: { config: OpenReelWatchFolderConfig; onPatch: (patch: WatchPatch) => void }) {
  const [bin, setBin] = useState(config.bin);
  useEffect(() => setBin(config.bin), [config.bin]);
  return (
    <div className="mt-2 space-y-2">
      <label className="flex items-center gap-2 text-xs text-fg-2">
        <span className="w-24 shrink-0">Import into bin</span>
        <input
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          onBlur={() => bin !== config.bin && onPatch({ bin })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Bin name"
          placeholder="Project root"
          className={`${fieldClass} flex-1`}
        />
      </label>
      <div className="flex items-center justify-between gap-3 text-xs text-fg-2">
        <span>Create preview proxies for imported media</span>
        <Switch aria-label="Create proxies" checked={config.createProxies} onCheckedChange={(createProxies) => onPatch({ createProxies })} />
      </div>
    </div>
  );
}

function FolderCard({ config, status, items, bridge }: { config: OpenReelWatchFolderConfig; status: OpenReelWatchFolderStatus; items: OpenReelWatchItem[]; bridge: OpenReelWatchFoldersBridge }) {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That did not work.");
    }
  }, []);
  const patch = (next: WatchPatch) => void run(() => bridge.update(config.id, next));
  const Icon = config.kind === "ingest" ? FolderInput : FolderOutput;
  const failed = items.filter((item) => item.state === "failed");
  return (
    <li className="rounded-lg border border-border bg-bg-1 p-3" data-testid="watch-folder" data-kind={config.kind} data-state={status.state}>
      <div className="flex items-center gap-2">
        <Icon size={16} className="shrink-0 text-fg-2" aria-hidden />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={config.path}>
          {config.path}
        </code>
        <span className="shrink-0 rounded bg-bg-3 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted" data-testid="watch-folder-state">
          {STATE_LABEL[status.state]}
        </span>
        <button type="button" className={iconButton} aria-label={config.paused ? `Resume ${config.path}` : `Pause ${config.path}`} title={config.paused ? "Resume" : "Pause"} onClick={() => patch({ paused: !config.paused })}>
          {config.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
        </button>
        <button type="button" className={iconButton} aria-label={`Remove ${config.path}`} title="Stop watching" onClick={() => void run(() => bridge.remove(config.id))}>
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-xs text-fg-2">
        {config.kind === "ingest" ? "New media is imported into the open project." : "Media dropped here is rendered to the output folder; the source moves to done/ or failed/."}
        {status.message ? ` ${status.message}` : ""}
      </p>
      {config.kind === "ingest" ? (
        <IngestOptions config={config} onPatch={patch} />
      ) : (
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-xs text-fg-2">
            <span className="w-24 shrink-0">Export preset</span>
            <select value={config.presetId} onChange={(e) => patch({ presetId: e.target.value })} aria-label="Export preset" className={`${fieldClass} flex-1`}>
              {WATCH_EXPORT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-xs text-fg-2">
            <span className="w-24 shrink-0">Output folder</span>
            <code className="min-w-0 flex-1 truncate font-mono" title={config.outputDir}>
              {config.outputDir}
            </code>
            <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void run(() => bridge.pickOutput(config.id))}>
              Change
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-fg-2">
            <span className="max-w-sm">Also render .oreel project files (opens each in the editor; the project open now is saved first)</span>
            <Switch aria-label="Render project files" checked={config.includeProjects} onCheckedChange={(includeProjects) => patch({ includeProjects })} />
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-fg-2">
        <span data-testid="watch-folder-summary">{summary(status) || "Nothing yet"}</span>
        {failed.length > 0 && (
          <Button type="button" variant="ghost" className="ml-auto h-6 gap-1 px-1.5 text-xs" onClick={() => void run(() => Promise.all(failed.map((item) => bridge.retry(item.id))))}>
            <RotateCcw size={11} aria-hidden /> Retry failed
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-status-error">
          {error}
        </p>
      )}
    </li>
  );
}

/** Settings > Watch folders (desktop). The folder list lives in the main process; this edits it. */
export const WatchFoldersPanel: React.FC = () => {
  const bridge = typeof window !== "undefined" ? window.openreel?.watchFolders : undefined;
  const [snapshot, setSnapshot] = useState<OpenReelWatchFoldersSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.list().then((next) => alive && setSnapshot(next)).catch(() => undefined);
    const off = bridge.onChange((next) => alive && setSnapshot(next));
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const add = useCallback(
    async (kind: "ingest" | "export") => {
      if (!bridge) return;
      try {
        setError(null);
        await bridge.add(kind);
        setSnapshot(await bridge.list());
      } catch (err) {
        setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Could not add that folder.");
      }
    },
    [bridge],
  );

  if (!bridge) return <p className="text-xs text-fg-2">Watch folders are available in the OpenReel desktop app.</p>;
  const folders = snapshot?.folders ?? [];
  return (
    <div className="space-y-4" data-testid="watch-folders-panel">
      <div>
        <span className="block text-sm font-medium text-fg">Watch folders</span>
        <span className="mt-0.5 block text-xs text-fg-2">
          An ingest folder imports media dropped into it into the open project. An export folder renders media dropped into it with a preset.
          Files are picked up once they stop growing, duplicates are skipped, and watching resumes when OpenReel starts. Progress shows in the background tasks panel.
        </span>
      </div>
      <ul className="space-y-2" aria-label="Watch folders">
        {snapshot === null && <li className="text-xs text-fg-2">Loading…</li>}
        {snapshot !== null && folders.length === 0 && <li className="text-xs text-fg-2">No watch folders yet.</li>}
        {folders.map(({ config, status }) => (
          <FolderCard key={config.id} config={config} status={status} items={(snapshot?.items ?? []).filter((item) => item.folderId === config.id)} bridge={bridge} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void add("ingest")} className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-border bg-bg-2 px-2.5 text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg">
          <Plus size={14} aria-hidden />
          Add ingest folder
        </Button>
        <Button type="button" onClick={() => void add("export")} className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-border bg-bg-2 px-2.5 text-[12px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg">
          <Plus size={14} aria-hidden />
          Add export folder
        </Button>
        {snapshot?.items.some((item) => ["done", "failed", "duplicate", "cancelled"].includes(item.state)) && (
          <Button type="button" variant="ghost" className="h-7 px-2 text-xs text-fg-2 hover:text-fg" onClick={() => void bridge.clearFinished()}>
            Clear finished
          </Button>
        )}
      </div>
      <p className="text-xs text-fg-2">Files already in a folder when you add it are skipped; only files that arrive afterwards are processed.</p>
      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}
    </div>
  );
};

export default WatchFoldersPanel;
