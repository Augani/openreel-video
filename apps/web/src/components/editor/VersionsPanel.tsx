import { useCallback, useEffect, useState } from "react";
import { DEFAULT_VERSION_POLICY, versionLabel, type ProjectVersionMeta } from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { Copy, History, RotateCcw, Save, Trash2 } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import { listVersions, onVersionsChanged } from "../../services/project-versions";
import { deleteVersion, restoreVersion, restoreVersionAsCopy, saveNamedVersion } from "../../services/version-commands";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

function Detail({ version }: { version: ProjectVersionMeta }) {
  const s = version.summary;
  const cells: [string, string][] = [
    ["Duration", formatFrameTimecode(s.duration, s.frameRate || 30)],
    ["Frame size", `${s.width}x${s.height} at ${s.frameRate} fps`],
    ["Tracks", String(s.tracks)],
    ["Clips", String(s.clips)],
    ["Sequences", String(s.sequences)],
    ["Media items", String(s.mediaItems)],
    ["Markers", String(s.markers)],
    ["Comments", `${s.comments} (${s.openComments} open)`],
    ["Size", formatBytes(version.bytes)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]" data-testid="version-detail">
      {cells.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="font-mono text-fg-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Named and automatic project snapshots: preview, restore (undoable or as a copy) and delete. */
export function VersionsPanel() {
  const projectId = useProjectStore((s) => s.project.id);
  const [versions, setVersions] = useState<ProjectVersionMeta[]>([]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setVersions(await listVersions(projectId));
    } catch {
      setVersions([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    return onVersionsChanged(() => void refresh());
  }, [refresh]);

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (await saveNamedVersion(name)) setName("");
    });

  const total = versions.reduce((sum, v) => sum + v.bytes, 0);
  const autoCount = versions.filter((v) => v.kind === "auto").length;
  const minutes = Math.round(DEFAULT_VERSION_POLICY.autoIntervalMs / 60000);

  return (
    <section className="flex min-h-0 flex-1 flex-col text-fg" aria-label="Versions" data-testid="versions-panel">
      <header className="flex flex-col gap-2 border-b border-border px-3 py-3">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <History size={14} aria-hidden />
          Versions
          <span className="rounded-full bg-bg-2 px-1.5 text-[11px] font-normal text-fg-muted" data-testid="versions-count">
            {versions.length}
          </span>
        </h2>
        <div className="flex gap-1.5">
          <Input
            aria-label="Version name"
            placeholder="Version name"
            data-testid="version-name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") void save();
            }}
            className="h-7 flex-1 text-[12px]"
          />
          <Button size="sm" className="h-7 gap-1 px-2.5 text-[12px]" data-testid="version-save" disabled={busy} onClick={() => void save()}>
            <Save size={12} aria-hidden />
            Save version
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {versions.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-fg-muted" data-testid="versions-empty">
            No versions yet. Save one before a risky edit; automatic versions appear every {minutes} minutes while you work.
          </p>
        ) : (
          <ul aria-label="Version list">
            {versions.map((version) => {
              const selected = selectedId === version.id;
              return (
                <li
                  key={version.id}
                  data-testid="version-row"
                  data-version-id={version.id}
                  data-kind={version.kind}
                  aria-selected={selected}
                  className={`border-b border-border/60 ${selected ? "bg-bg-2" : ""}`}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-2 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSelectedId(selected ? null : version.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium" data-testid="version-name">
                        {versionLabel(version)}
                      </span>
                      <span className="block text-[11px] text-fg-muted">
                        {formatDate(version.createdAt)} · {formatBytes(version.bytes)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${version.kind === "manual" ? "bg-accent/20 text-fg" : "bg-bg-2 text-fg-muted"}`}
                    >
                      {version.kind === "manual" ? "Manual" : "Auto"}
                    </span>
                  </button>
                  {selected && (
                    <div className="flex flex-col gap-2.5 px-3 pb-3">
                      <Detail version={version} />
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 gap-1 px-2 text-[12px]"
                          data-testid="version-restore"
                          disabled={busy}
                          title="Replace the current edit with this version. Undo brings it back."
                          onClick={() => void run(() => restoreVersion(version.id))}
                        >
                          <RotateCcw size={12} aria-hidden />
                          Restore
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[12px]"
                          data-testid="version-restore-copy"
                          disabled={busy}
                          title="Open this version as a new project and keep the current one"
                          onClick={() => void run(() => restoreVersionAsCopy(version.id))}
                        >
                          <Copy size={12} aria-hidden />
                          Restore as copy
                        </Button>
                        {confirmDeleteId === version.id ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-[12px]"
                              data-testid="version-delete-confirm"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                setSelectedId(null);
                                void run(() => deleteVersion(version.id));
                              }}
                            >
                              Delete for good
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => setConfirmDeleteId(null)}>
                              Keep
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[12px]"
                            data-testid="version-delete"
                            onClick={() => setConfirmDeleteId(version.id)}
                          >
                            <Trash2 size={12} aria-hidden />
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-3 py-2 text-[11px] text-fg-muted" data-testid="versions-footer">
        {formatBytes(total)} used · {autoCount} automatic (keeps the latest {DEFAULT_VERSION_POLICY.maxAuto}) · media files are not copied into versions
      </footer>
    </section>
  );
}
