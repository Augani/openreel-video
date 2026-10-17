import { useEffect, useRef, useState } from "react";
import { Download, Upload, FolderOpen } from "@/icons/lucide-compat";
import { ToolcraftButton as Button, ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { autoSaveManager } from "../../services/auto-save";
import { loadMediaBlob, saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";
import { createProjectPackage, readProjectPackage, copyPackagedProject, projectMediaSummary } from "../../services/project-package";
import { exportFilename } from "../../services/export-runner";
import { restoreMediaItem } from "../../utils/media-recovery";
import { projectManager } from "../../services/project-manager";

export function formatPackageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function downloadPackage(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(name, "oreelpack");
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start consuming a large file before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProjectPackageDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((state) => state.project);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Project | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  const summary = projectMediaSummary(project);
  const close = () => { if (committing.current) return; controller.current?.abort(); onClose(); };
  useEffect(() => {
    let active = true;
    navigator.storage?.estimate?.().then((estimate) => { if (active) setStorage(estimate); }).catch(() => {});
    return () => { active = false; controller.current?.abort(); };
  }, []);
  const progress = ({ completed, total, name }: { completed: number; total: number; name: string }) => setStatus(`${completed}/${total} media files · ${name}`);

  const save = async (chooseLocation: boolean) => {
    if (controller.current || exporting) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(null); setStatus("Preparing your project backup…");
    const snapshot = useProjectStore.getState().getFullProject();
    let writable: FileSystemWritableFileStream | undefined;
    try {
      if (chooseLocation) {
        // Request the picker before any async work to preserve user activation.
        const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
        if (!picker) throw new Error("Use Download backup in this browser.");
        const handle = await picker.call(window, { suggestedName: exportFilename(snapshot.name, "oreelpack"), types: [{ description: "OpenReel project with media", accept: { "application/octet-stream": [".oreelpack"] } }] });
        abort.signal.throwIfAborted();
        writable = await handle.createWritable();
      }
      const blob = await createProjectPackage(snapshot, { signal: abort.signal, onProgress: progress, resolveMedia: (item) => loadMediaBlob(item.id) });
      abort.signal.throwIfAborted();
      if (writable) {
        const reader = blob.stream().getReader();
        try {
          for (;;) {
            abort.signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            await writable.write(chunk.value);
          }
          abort.signal.throwIfAborted();
          await writable.close();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else downloadPackage(blob, snapshot.name);
      toast.success("Project backup ready", "Includes your edits and original media. Open it in another browser to continue editing.");
      setStatus("Backup ready. Keep this file somewhere safe.");
    } catch (cause) {
      await writable?.abort().catch(() => {});
      if (cause instanceof Error && cause.name === "AbortError") setStatus("Backup cancelled.");
      else setError(cause instanceof Error ? cause.message : "Could not create the project backup.");
    } finally { controller.current = null; setBusy(false); }
  };

  const inspectFile = async (file: File) => {
    if (controller.current || exporting) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setIncoming(null); setError(null); setStatus("Checking the project and media…");
    try { setIncoming(await readProjectPackage(file, { signal: abort.signal, onProgress: progress })); setStatus(""); }
    catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "This backup could not be opened."); }
    finally { controller.current = null; setBusy(false); }
  };

  const open = async () => {
    if (!incoming || controller.current || exporting) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(null); setStatus("Saving your current work…");
    const startingId = useProjectStore.getState().project.id;
    const copy = copyPackagedProject(incoming);
    const written: string[] = [];
    let committed = false;
    try {
      await autoSaveManager.forceSave(useProjectStore.getState().getFullProject());
      const estimate = await navigator.storage?.estimate?.();
      const bytes = projectMediaSummary(copy).bytes;
      if (estimate?.quota && bytes > estimate.quota - (estimate.usage ?? 0)) throw new Error("There is not enough browser storage for this project. Free space or use another browser profile, then try again.");
      for (const item of copy.mediaLibrary.items) {
        abort.signal.throwIfAborted();
        setStatus(`Restoring ${item.name}…`);
        await saveMediaBlob(copy.id, item.id, item.blob!, item.metadata);
        written.push(item.id);
      }
      abort.signal.throwIfAborted();
      if (useProjectStore.getState().project.id !== startingId) throw new Error("The open project changed. Open the backup again to continue.");
      committing.current = true;
      setStatus("Finishing project restore…");
      await autoSaveManager.forceSave(copy);
      useTimelineStore.getState().stop();
      useTimelineStore.getState().seekToStart();
      useTimelineStore.getState().clearLoopRange();
      useUIStore.getState().clearSelection();
      projectManager.releaseCurrentFileHandle();
      useProjectStore.getState().loadProject(copy);
      useTimelineStore.getState().zoomToFit(copy.timeline.duration || 5);
      committed = true;
      toast.success("Project opened", `${copy.mediaLibrary.items.length} original media file${copy.mediaLibrary.items.length === 1 ? "" : "s"} restored. Your previous project is saved in Recent projects.`);
      // Thumbnails are optional; restoring footage never waits for every video
      // decode. Refresh them sequentially in the background after opening.
      void (async () => {
        for (const item of copy.mediaLibrary.items) {
          if (useProjectStore.getState().project.id !== copy.id) break;
          const restored = await restoreMediaItem(item, item.blob!);
          if (useProjectStore.getState().project.id !== copy.id) {
            if (restored.thumbnailUrl?.startsWith("blob:")) URL.revokeObjectURL(restored.thumbnailUrl);
            break;
          }
          useProjectStore.setState((state) => ({ project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items: state.project.mediaLibrary.items.map((current) => current.id === item.id ? { ...current, thumbnailUrl: restored.thumbnailUrl } : current) } } }));
        }
      })().catch(() => {});
      onClose();
    } catch (cause) {
      if (!committed) {
        await Promise.allSettled(written.map((id) => deleteMediaBlob(id)));
        await autoSaveManager.clearProjectSaves(copy.id).catch(() => {});
      }
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not restore the project.");
    } finally { committing.current = false; controller.current = null; setBusy(false); }
  };

  return <Dialog isOpen onOpenChange={(value) => { if (!value) close(); }} width={560} purpose="form">
    <DialogHeader title="Project backups" subtitle="Take your edits and original media with you." onOpenChange={(value) => { if (!value) close(); }} />
    <div className="space-y-5 p-5">
      <section className="space-y-3 rounded-lg border border-border bg-bg-1 p-4" aria-label="Back up current project">
        <h3 className="text-sm font-semibold text-fg">{project.name}</h3>
        <p className="text-xs text-fg-2">{summary.count} media file{summary.count === 1 ? "" : "s"} · approximately {formatPackageBytes(summary.bytes)}</p>
        <p className="text-xs leading-relaxed text-fg-3">The backup includes original videos, images, audio, captions, and timeline edits. Preview proxies can be recreated. Uploaded custom fonts need to be installed in the destination browser.</p>
        <div className="flex flex-wrap gap-2">
          <Button label="Download backup" icon={<Download size={15} aria-hidden />} onClick={() => void save(false)} isDisabled={busy || exporting} variant="primary" />
          {"showSaveFilePicker" in window && <Button label="Choose file location" icon={<FolderOpen size={15} aria-hidden />} onClick={() => void save(true)} isDisabled={busy || exporting} variant="secondary" />}
        </div>
        <p className="text-xs text-fg-3">For large projects, choosing a file location writes directly to disk.</p>
      </section>
      <section className="space-y-3" aria-label="Open a project backup">
        <input ref={input} type="file" accept=".oreelpack" className="hidden" aria-label="Project backup file" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void inspectFile(file); }} />
        <Button label="Choose backup to open" icon={<Upload size={15} aria-hidden />} variant="secondary" onClick={() => input.current?.click()} isDisabled={busy || exporting} />
        {incoming && <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <h3 className="text-sm font-semibold text-fg">{incoming.name}</h3>
          <p className="text-xs text-fg-2">{incoming.settings.width}×{incoming.settings.height} · {incoming.settings.frameRate} fps · {projectMediaSummary(incoming).count} media files · {formatPackageBytes(projectMediaSummary(incoming).bytes)}</p>
          <p className="text-xs text-fg-3">Opens as an independent copy. Your current project will be saved first.</p>
          <Button label="Open this project" variant="primary" onClick={() => void open()} isDisabled={busy || exporting} />
        </div>}
      </section>
      {storage?.quota && <p className="text-xs text-fg-3">Browser storage: {formatPackageBytes(storage.usage ?? 0)} of {formatPackageBytes(storage.quota)} used. Keep a backup outside your browser.</p>}
      {status && <p role="status" className="text-xs text-fg-2">{status}</p>}
      {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
      <div className="flex justify-end"><Button label={busy ? "Cancel operation" : "Close"} isDisabled={committing.current} variant="secondary" onClick={close} /></div>
    </div>
  </Dialog>;
}
