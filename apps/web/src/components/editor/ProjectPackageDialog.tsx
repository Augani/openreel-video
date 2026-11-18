import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, FolderOpen, X } from "@/icons/lucide-compat";
import {
  Input,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@openreel/ui";
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { createCustomFontReader, compareRegisteredFont, registerEmbeddedFont } from "./inspector/font-options";
import { registerPackagedFonts, type PackagedFont } from "../../services/font-embedding";
import { toast } from "../../stores/notification-store";
import { autoSaveManager } from "../../services/auto-save";
import {
  loadMediaBlob,
  saveMediaBlob,
  deleteMediaBlob,
} from "../../services/media-storage";
import {
  createProjectPackage,
  readProjectPackageContents,
  copyPackagedProject,
  projectMediaSummary,
} from "../../services/project-package";
import { exportFilename } from "../../services/export-runner";
import { restoreMediaItem } from "../../utils/media-recovery";
import { saveCurrentProjectForReplacement } from "../../services/project-replacement";

function formatPackageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
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
  const projectName = useProjectStore((state) => state.project.name);
  const mediaLibrary = useProjectStore((state) => state.project.mediaLibrary);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Project | null>(null);
  const [incomingFonts, setIncomingFonts] = useState<PackagedFont[]>([]);
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
  } | null>(null);
  const summary = useMemo(
    () => projectMediaSummary({ mediaLibrary }),
    [mediaLibrary],
  );
  const close = () => {
    if (committing.current) return;
    controller.current?.abort();
    onClose();
  };
  useEffect(() => {
    let active = true;
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (active) setStorage(estimate);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, []);
  const progress = ({
    completed,
    total,
    name,
  }: {
    completed: number;
    total: number;
    name: string;
  }) => setStatus(`${completed}/${total} media files · ${name}`);

  const save = async (chooseLocation: boolean) => {
    if (controller.current || exporting) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setStatus("Preparing your project backup…");
    const snapshot = useProjectStore.getState().getFullProject();
    let writable: FileSystemWritableFileStream | undefined;
    try {
      if (chooseLocation) {
        // Request the picker before any async work to preserve user activation.
        const picker = (
          window as Window & {
            showSaveFilePicker?: (
              options: unknown,
            ) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker;
        if (!picker) throw new Error("Use Download backup in this browser.");
        const handle = await picker.call(window, {
          suggestedName: exportFilename(snapshot.name, "oreelpack"),
          types: [
            {
              description: "OpenReel project with media",
              accept: { "application/octet-stream": [".oreelpack"] },
            },
          ],
        });
        abort.signal.throwIfAborted();
        writable = await handle.createWritable();
      }
      const fontReader = await createCustomFontReader();
      const blob = await createProjectPackage(snapshot, {
        signal: abort.signal,
        onProgress: progress,
        resolveMedia: (item) => loadMediaBlob(item.id),
        resolveFont: fontReader.read,
        isUserFont: fontReader.isUserFont,
        onFontReport: (entries) => {
          const skipped = entries.filter((entry) => entry.status === "restricted" || entry.status === "unknown-license");
          if (skipped.length > 0)
            toast.warning(
              "Some fonts were not embedded",
              `${skipped.map((entry) => entry.family).join(", ")}: the font license does not allow embedding or could not be read. Install them on the other machine.`,
            );
          const readOnly = entries.filter((entry) => entry.status === "embedded-readonly");
          if (readOnly.length > 0)
            toast.info("Fonts embedded read-only", `${readOnly.map((entry) => entry.family).join(", ")} can be previewed and exported but not edited with.`);
        },
      });
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
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } else downloadPackage(blob, snapshot.name);
      toast.success(
        "Project backup ready",
        "Includes your edits and original media. Open it in another browser to continue editing.",
      );
      setStatus("Backup ready. Keep this file somewhere safe.");
    } catch (cause) {
      await writable?.abort().catch(() => {});
      if (cause instanceof Error && cause.name === "AbortError")
        setStatus("Backup cancelled.");
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not create the project backup.",
        );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };

  const inspectFile = async (file: File) => {
    if (controller.current || exporting) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setIncoming(null);
    setIncomingFonts([]);
    setError(null);
    setStatus("Checking the project and media…");
    try {
      const contents = await readProjectPackageContents(file, {
        signal: abort.signal,
        onProgress: progress,
      });
      setIncoming(contents.project);
      setIncomingFonts(contents.fonts);
      setStatus("");
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "This backup could not be opened.",
        );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };

  const open = async () => {
    if (!incoming || controller.current || exporting) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setStatus("Saving your current work…");
    const startingId = useProjectStore.getState().project.id;
    const copy = copyPackagedProject(incoming);
    const written: string[] = [];
    let committed = false;
    try {
      await saveCurrentProjectForReplacement(startingId);
      const estimate = await navigator.storage?.estimate?.();
      const bytes = projectMediaSummary(copy).bytes;
      if (estimate?.quota && bytes > estimate.quota - (estimate.usage ?? 0))
        throw new Error(
          "There is not enough browser storage for this project. Free space or use another browser profile, then try again.",
        );
      for (const item of copy.mediaLibrary.items) {
        abort.signal.throwIfAborted();
        setStatus(`Restoring ${item.name}…`);
        await saveMediaBlob(copy.id, item.id, item.blob!, item.metadata);
        written.push(item.id);
      }
      abort.signal.throwIfAborted();
      if (useProjectStore.getState().project.id !== startingId)
        throw new Error(
          "The open project changed. Open the backup again to continue.",
        );
      // Embedded fonts must be registered before the first render of the project.
      const fontResult = await registerPackagedFonts(incomingFonts, {
        compare: compareRegisteredFont,
        register: (family, data, options) => registerEmbeddedFont(family, data, { readOnly: options.readOnly }),
      });
      abort.signal.throwIfAborted();
      if (fontResult.failed.length > 0)
        toast.warning("Some embedded fonts could not be loaded", fontResult.failed.join(", "));
      if (fontResult.readOnly.length > 0)
        toast.info(
          "Read-only fonts in this project",
          `${fontResult.readOnly.join(", ")} came with the project under a license that allows preview and export only. They are not added to your font list and are not saved to this browser.`,
        );
      if (fontResult.conflicts.length > 0)
        toast.warning(
          "Fonts replaced for this project",
          `${fontResult.conflicts.join(", ")} already existed here as a different font file; the project's packaged version is used.`,
        );
      committing.current = true;
      setStatus("Finishing project restore…");
      await autoSaveManager.forceSave(copy);
      await saveCurrentProjectForReplacement(startingId);
      abort.signal.throwIfAborted();
      useTimelineStore.getState().stop();
      useTimelineStore.getState().seekToStart();
      useTimelineStore.getState().clearLoopRange();
      useUIStore.getState().clearSelection();
      useProjectStore.getState().loadProject(copy);
      useTimelineStore.getState().zoomToFit(copy.timeline.duration || 5);
      committed = true;
      toast.success(
        "Project opened",
        `${copy.mediaLibrary.items.length} original media file${copy.mediaLibrary.items.length === 1 ? "" : "s"} restored. Your previous project is saved in Recent projects.`,
      );
      // Thumbnails are optional; restoring footage never waits for every video
      // decode. Refresh them sequentially in the background after opening.
      void (async () => {
        for (const item of copy.mediaLibrary.items) {
          if (useProjectStore.getState().project.id !== copy.id) break;
          const restored = await restoreMediaItem(item, item.blob!);
          if (useProjectStore.getState().project.id !== copy.id) {
            if (restored.thumbnailUrl?.startsWith("blob:"))
              URL.revokeObjectURL(restored.thumbnailUrl);
            break;
          }
          useProjectStore.setState((state) => ({
            project: {
              ...state.project,
              mediaLibrary: {
                ...state.project.mediaLibrary,
                items: state.project.mediaLibrary.items.map((current) =>
                  current.id === item.id
                    ? { ...current, thumbnailUrl: restored.thumbnailUrl }
                    : current,
                ),
              },
            },
          }));
        }
      })().catch(() => {});
      onClose();
    } catch (cause) {
      if (!committed) {
        await Promise.allSettled(written.map((id) => deleteMediaBlob(id)));
        await autoSaveManager.clearProjectSaves(copy.id).catch(() => {});
      }
      if (!abort.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not restore the project.",
        );
    } finally {
      committing.current = false;
      controller.current = null;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent
        hideCloseButton
        className="flex max-h-[90dvh] w-[calc(100vw-32px)] max-w-[560px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg shadow-xl"
        onEscapeKeyDown={(event) => {
          if (committing.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (committing.current) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 flex-row items-start gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] font-semibold leading-5 text-fg">
              Project backups
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12px] leading-4 text-fg-muted">
              Take your edits and original media with you.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="Close dialog"
            onClick={close}
            disabled={committing.current}
            className="h-7 w-7 shrink-0 text-fg-muted"
          >
            <X size={15} aria-hidden />
          </Button>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          <section
            className="space-y-3 rounded-lg border border-border bg-bg-1 p-4"
            aria-label="Back up current project"
          >
            <h3 className="text-sm font-semibold text-fg">{projectName}</h3>
            <p className="text-xs text-fg-2">
              {summary.count} media file{summary.count === 1 ? "" : "s"} ·
              approximately {formatPackageBytes(summary.bytes)}
            </p>
            <p className="text-xs leading-relaxed text-fg-3">
              The backup includes original videos, images, audio, captions, and
              timeline edits. Preview proxies can be recreated. Uploaded custom
              fonts need to be installed in the destination browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void save(false)}
                type="button"
                aria-label="Download backup"
                disabled={busy || exporting}
                className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {<Download size={15} aria-hidden />}
                </span>
                <span className="truncate">{"Download backup"}</span>
              </Button>
              {"showSaveFilePicker" in window && (
                <Button
                  onClick={() => void save(true)}
                  type="button"
                  aria-label="Choose file location"
                  disabled={busy || exporting}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {<FolderOpen size={15} aria-hidden />}
                  </span>
                  <span className="truncate">{"Choose file location"}</span>
                </Button>
              )}
            </div>
            <p className="text-xs text-fg-3">
              For large projects, choosing a file location writes directly to
              disk.
            </p>
          </section>
          <section className="space-y-3" aria-label="Open a project backup">
            <Input
              ref={input}
              type="file"
              accept=".oreelpack"
              className="hidden"
              aria-label="Project backup file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void inspectFile(file);
              }}
            />
            <Button
              onClick={() => input.current?.click()}
              type="button"
              aria-label="Choose backup to open"
              disabled={busy || exporting}
              className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {<Upload size={15} aria-hidden />}
              </span>
              <span className="truncate">{"Choose backup to open"}</span>
            </Button>
            {incoming && (
              <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
                <h3 className="text-sm font-semibold text-fg">
                  {incoming.name}
                </h3>
                <p className="text-xs text-fg-2">
                  {incoming.settings.width}×{incoming.settings.height} ·{" "}
                  {incoming.settings.frameRate} fps ·{" "}
                  {projectMediaSummary(incoming).count} media files ·{" "}
                  {formatPackageBytes(projectMediaSummary(incoming).bytes)}
                </p>
                <p className="text-xs text-fg-3">
                  Opens as an independent copy. Your current project will be
                  saved first.
                </p>
                <Button
                  onClick={() => void open()}
                  type="button"
                  aria-label="Open this project"
                  disabled={busy || exporting}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90"
                >
                  <span className="truncate">{"Open this project"}</span>
                </Button>
              </div>
            )}
          </section>
          {storage?.quota && (
            <p className="text-xs text-fg-3">
              Browser storage: {formatPackageBytes(storage.usage ?? 0)} of{" "}
              {formatPackageBytes(storage.quota)} used. Keep a backup outside
              your browser.
            </p>
          )}
          {status && (
            <p role="status" className="text-xs text-fg-2">
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-status-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-border px-5 py-4">
          <Button
            onClick={close}
            type="button"
            aria-label={
              (busy ? "Cancel operation" : "Close").trim() || undefined
            }
            disabled={committing.current}
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"
          >
            <span className="truncate">
              {busy ? "Cancel operation" : "Close"}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
