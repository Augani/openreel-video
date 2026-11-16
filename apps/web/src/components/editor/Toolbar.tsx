import { AIConnectionDialog } from "./chat/AIConnectionDialog";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { MobileEditorHeader } from "./mobile/MobileEditorHeader";
import "./mobile/mobile-editor.css";
import { useAIConnectionStore } from "../../stores/ai-connection-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { DesktopExportButton } from "../../desktop/editor/DesktopExportButton";
import { WindowControls } from "../../desktop/shell/WindowControls";
import { Button as ShadcnButton, Input } from "@openreel/ui";
import { EditorHeaderIcon } from "./EditorHeaderIcon";
import { EditorExportControl } from "./EditorExportControl";
import { getQuickExportPresets, type QuickExportPresetId } from "../../services/quick-export-presets";
import { WorkspaceSaveStatus } from "./WorkspaceSaveStatus";
import { EditorMenuBar } from "./EditorMenuBar";
import React, { lazy, Suspense, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import {
  projectForSequence,
  trackHasAudioItems,
  type VideoExportSettings,
} from "@openreel/core";
import { ExportQueueButton, ExportQueuePanel } from "./ExportQueuePanel";
import { addDialogExportToQueue, isExportQueueBusy } from "../../stores/export-queue-store";
import { getUseExportPreviews } from "../../services/export-queue/export-queue-activity";
import { CompressDialog } from "./CompressDialog";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import { useExportRunner, extForFormat, exportFilename, type ExportDeliveryMode } from "../../services/export-runner";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { CollaborationDialog } from "./CollaborationDialog";
import { CollaboratorAvatars } from "./CollaboratorAvatars";
import { connectionOf, useCollabStore } from "../../services/collab/collab-store";
import { SettingsDialog } from "./settings/SettingsDialog";
import { toast } from "../../stores/notification-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

// Dialogs that only open on demand stay out of the editor chunk (bundle-budgets.json).
const ExportDialog = lazy(() => import("./ExportDialog").then((m) => ({ default: m.ExportDialog })));
const ScreenRecorder = lazy(() => import("./ScreenRecorder").then((m) => ({ default: m.ScreenRecorder })));
const ProjectPackageDialog = lazy(() => import("./ProjectPackageDialog").then((m) => ({ default: m.ProjectPackageDialog })));


export const Toolbar: React.FC = () => {
  const phone = usePhoneEditor();
  const isDesktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const nativePlatform = /Mac/i.test(navigator.platform) ? "darwin" : /Win/i.test(navigator.platform) ? "win32" : "linux";
  const project = useProjectStore((state) => state.project);
  const loopStart = useTimelineStore((state) => state.loopStart);
  const loopEnd = useTimelineStore((state) => state.loopEnd);
  const renameProject = useProjectStore((state) => state.renameProject);
  const setGlobalExportState = useUIStore((state) => state.setExportState);
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const isExportDialogOpen = activeModal === "export";
  const openExportDialog = useCallback(() => {
    if (useUIStore.getState().exportState.isExporting) return;
    if (window.openreel?.platform === "desktop") window.dispatchEvent(new CustomEvent("openreel:menu:export"));
    else useUIStore.getState().openModal("export");
  }, []);
  const aiMode = useUIStore((s) => s.panels.agentChat?.visible ?? false);
  const [isCompressOpen, setIsCompressOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const collabConnection = useCollabStore((state) => connectionOf(state.snapshot));
  const openCollabDialog = useCollabStore((state) => state.openDialog);
  const importMedia = useProjectStore((state) => state.importMedia);
  // Export renders the chosen sequence (default: the active one) as if it were open.
  const exportSequenceId = useUIStore((state) => state.exportSequenceId);
  const exportProject = useMemo(
    () => (exportSequenceId && exportSequenceId !== project.activeSequenceId ? projectForSequence(project, exportSequenceId) ?? project : project),
    [project, exportSequenceId],
  );
  useEffect(() => {
    if (exportSequenceId && !project.sequences?.some((sequence) => sequence.id === exportSequenceId)) useUIStore.getState().setExportSequenceId(null);
  }, [project.sequences, exportSequenceId]);
  const sourceMatch = useMemo(() => deriveSourceExportMatch(exportProject), [exportProject]);
  const projectHasAudio = useMemo(
    () => exportProject.timeline.tracks.some((track) => trackHasAudioItems(exportProject, track.id)),
    [exportProject],
  );
  const hasTimelineContent = (exportProject.timeline?.duration ?? 0) > 0;
  // The chosen sequence only lasts for one export: opening the dialog or switching tabs starts over.
  useEffect(() => {
    useUIStore.getState().setExportSequenceId(null);
  }, [project.activeSequenceId, isExportDialogOpen]);
  const { track } = useAnalytics();

  // Local editable project name (committed onBlur / Enter)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  const cancelProjectNameCommit = useRef(false);
  useEffect(() => {
    setProjectNameDraft(project.name);
  }, [project.name]);

  const commitProjectName = useCallback(() => {
    if (cancelProjectNameCommit.current) {
      cancelProjectNameCommit.current = false;
      return;
    }
    const next = projectNameDraft.trim();
    if (next && next !== project.name) {
      void renameProject(next);
    } else {
      setProjectNameDraft(project.name);
    }
  }, [projectNameDraft, project.name, renameProject]);

  const handleExported = useCallback(
    (videoSettings: Partial<VideoExportSettings>) => {
      track(AnalyticsEvents.PROJECT_EXPORTED, {
        format: videoSettings.format ?? "mp4",
        codec: videoSettings.codec ?? "h264",
        width: videoSettings.width ?? project.settings.width,
        height: videoSettings.height ?? project.settings.height,
        frameRate: videoSettings.frameRate ?? project.settings.frameRate,
        duration: project.timeline?.duration ?? 0,
      });
    },
    [project, track],
  );

  const {
    state: exportState,
    runExport,
    runAudioExport,
    showSavePicker,
    markComplete,
    beginExport,
    finishExportSoon,
    failExport,
    cancel: handleCancelExport,
    resetError,
  } = useExportRunner({ project: exportProject, onExported: handleExported });

  useEffect(() => {
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
    });
  }, [exportState.isExporting, exportState.progress, exportState.phase, setGlobalExportState]);

  const handleQuickExport = useCallback(async (id: QuickExportPresetId) => {
    if (!hasTimelineContent || useUIStore.getState().exportState.isExporting) return;
    if (isDesktop) {
      window.dispatchEvent(new CustomEvent("openreel:menu:quick-export", { detail: { preset: id } }));
      return;
    }
    const preset = getQuickExportPresets(exportProject.settings).find(entry => entry.id === id);
    if (!preset) return;
    try {
      const ext = preset.kind === "audio" ? "wav" : extForFormat(preset.settings.format ?? "mp4", preset.settings.codec);
      const writable = await showSavePicker(exportFilename(project.name, ext), ext, { delivery: "download" });
      beginExport(writable);
      if (preset.kind === "audio") {
        await runAudioExport(preset.settings, writable);
        markComplete();
        track(AnalyticsEvents.PROJECT_EXPORTED, { format: "wav", duration: project.timeline.duration });
      } else {
        await runExport(preset.settings, ext, writable);
      }
      finishExportSoon();
    } catch (error) {
      failExport(error);
    }
  }, [hasTimelineContent, isDesktop, project, exportProject.settings, showSavePicker, beginExport, runAudioExport, markComplete, track, runExport, finishExportSoon, failExport]);

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings, delivery: ExportDeliveryMode = window.openreel?.platform === "desktop" ? "file" : "download") => {
      closeModal();
      if (!hasTimelineContent) return;
      // The encoder is busy with a queued job: line this export up behind it.
      if (isExportQueueBusy()) {
        addDialogExportToQueue(settings, { presetLabel: "Custom", usePreviews: getUseExportPreviews(), sequenceId: exportSequenceId });
        return;
      }

      try {
        const ext = extForFormat(settings.format);
        const writable = await showSavePicker(exportFilename(project.name, ext), ext, { delivery });

        beginExport(writable);

        const needsUpscaling =
          settings.width > exportProject.settings.width ||
          settings.height > exportProject.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        await runExport(exportSettings, ext, writable);

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        finishExportSoon();
      } catch (error) {
        failExport(error);
      } finally {
        useUIStore.getState().setExportSequenceId(null);
      }
    },
    [project, exportProject, exportSequenceId, hasTimelineContent, closeModal, track, runExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );


  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          "Recording failed",
          "No video data was captured. Please try again.",
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importMedia(screenFile);
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || "Failed to import screen recording",
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importMedia(webcamFile);
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || "Failed to import webcam recording",
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          `${importCount} recording${importCount > 1 ? "s" : ""} imported!`,
          webcamBlob && webcamBlob.size > 0
            ? "Screen and webcam added to assets. Use the timeline to composite them."
            : "Screen recording added to assets.",
        );
      } else if (errors.length > 0) {
        toast.error("Import failed", errors.join(". "));
      }
    },
    [importMedia],
  );

  return (
    <header className={`${phone ? "mobile-editor-header" : "workspace-topbar flex items-center border-b border-border"} shrink-0 z-30 relative ${isDesktop ? `workspace-native-${nativePlatform}` : ""}`} style={isDesktop ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}>
      <AIConnectionDialog />
      {phone ? <MobileEditorHeader
        onAI={() => useUIStore.getState().setPanelVisible("agentChat", true)}
        onExport={() => { if (exportState.isExporting) handleCancelExport(); else { if (exportState.error) resetError(); openExportDialog(); } }}
        exportLabel={exportState.isExporting ? `${Math.round(exportState.progress)}%` : exportState.error ? "Retry" : exportState.complete ? "Saved" : "Export"}
        exportDisabled={exportState.complete}
        exportControl={isDesktop ? <span className="mobile-native-export"><DesktopExportButton compact /></span> : <EditorExportControl
          state={exportState} disabled={false} compact onOpen={openExportDialog} onCancel={handleCancelExport} onDismissError={resetError} />}
        menu={<EditorMenuBar onExport={openExportDialog} onQuickExport={handleQuickExport} onCompress={() => setIsCompressOpen(true)}/>}
      /> : <><ProjectSwitcher trigger={<ShadcnButton variant="ghost" className="workspace-brand p-0 h-auto" aria-label="Project menu">
        <img src={`${import.meta.env.BASE_URL}icons/editor-reel.svg`} alt="" />OpenReel
      </ShadcnButton>} />
      <EditorMenuBar onExport={openExportDialog} onQuickExport={handleQuickExport} onCompress={() => setIsCompressOpen(true)} />
      <div className="workspace-project">
        <Input aria-label="Project name" value={projectNameDraft} onChange={(e) => setProjectNameDraft(e.target.value)}
          onBlur={commitProjectName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { cancelProjectNameCommit.current = true; setProjectNameDraft(project.name); e.currentTarget.blur(); } }} />
        <span className="workspace-project-meta">{project.settings.width}×{project.settings.height} · {project.settings.frameRate} fps</span>
        <WorkspaceSaveStatus />
      </div>
      <div className="workspace-actions">
        <div role="group" aria-label="Editing mode" className="workspace-mode">
          <ShadcnButton variant="ghost" aria-pressed={!aiMode} onClick={() => useUIStore.getState().setPanelVisible("agentChat", false)}>Manual</ShadcnButton>
          <ShadcnButton variant="ghost" aria-pressed={aiMode} onClick={() => { const c = useAIConnectionStore.getState(); if (!c.model.trim() || (!c.apiKey && c.provider !== "compatible")) useEditorWorkspaceStore.getState().setAIConnectionOpen(true); else useUIStore.getState().setPanelVisible("agentChat", true); }}><EditorHeaderIcon kind="ai" /> AI assist</ShadcnButton>
        </div>
        <div className="workspace-history">
          <ShadcnButton variant="ghost" size="icon" aria-label="Undo" onClick={() => void useProjectStore.getState().undo()}><EditorHeaderIcon kind="undo" /></ShadcnButton>
          <ShadcnButton variant="ghost" size="icon" aria-label="Redo" onClick={() => void useProjectStore.getState().redo()}><EditorHeaderIcon kind="redo" /></ShadcnButton>
        </div>
        <ExportQueueButton className="workspace-queue h-7 w-7 text-fg-2" />
        <CollaboratorAvatars compact />
        <ShadcnButton variant="ghost" className="workspace-collab" data-testid="collab-button" data-connection={collabConnection} aria-label="Collaborate" title="Edit this project with other people" onClick={openCollabDialog}>
          {collabConnection === "off" ? "Collaborate" : collabConnection === "live" ? "Live" : collabConnection === "offline" ? "Offline" : "Joining…"}
        </ShadcnButton>
        <ShadcnButton variant="secondary" className="workspace-share" onClick={() => setIsShareOpen(true)}>Share</ShadcnButton>
        {/* Export */}
        {isDesktop ? <DesktopExportButton /> : <EditorExportControl
          state={exportState} disabled={false} onOpen={openExportDialog}
          onCancel={handleCancelExport} onDismissError={resetError} />}
      </div>

      {isDesktop && <WindowControls platform={nativePlatform} />}
      </>}
      {/* ─── Auxiliary popups & dialogs ───────────────────────── */}
      <CompressDialog
        isOpen={isCompressOpen}
        onClose={() => setIsCompressOpen(false)}
      />
      <Suspense fallback={null}>
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeModal}
        onExport={handleCustomExport}
        onAddToQueue={(settings, meta) => { addDialogExportToQueue(settings, { ...meta, sequenceId: exportSequenceId }); }}
        duration={exportProject.timeline?.duration ?? 0}
        projectWidth={exportProject.settings?.width ?? 1920}
        projectHeight={exportProject.settings?.height ?? 1080}
        frameRate={exportProject.settings?.frameRate ?? 30}
        sourceMatch={sourceMatch}
        hasAudio={projectHasAudio}
        markedRange={loopEnd > loopStart && exportProject === project ? { startTime: loopStart, endTime: loopEnd } : null}
      />
      </Suspense>

      <ExportQueuePanel />

      <Suspense fallback={null}>
        <ScreenRecorder
          isOpen={activeModal === "recorder"}
          onClose={closeModal}
          onRecordingComplete={handleRecordingComplete}
        />
      </Suspense>

      <SettingsDialog />
      <CollaborationDialog />
      {isShareOpen && (
        <Suspense fallback={null}>
          <ProjectPackageDialog onClose={() => setIsShareOpen(false)} />
        </Suspense>
      )}

      {activeModal === "history" && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeModal}
          />
          <div className="fixed top-topbar right-0 bottom-0 w-80 bg-bg-1 border-l border-border z-50 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="font-bold text-sm text-fg">
                Action history
              </span>
              <ShadcnButton variant="ghost" size="icon-sm" onClick={closeModal} type="button" aria-label="Close action history" title="Close action history" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent p-1.5 rounded hover:bg-hover text-fg-3 hover:text-fg transition-colors">
                {<X size={14} aria-hidden />}
              </ShadcnButton>
            </div>
            <div className="h-[calc(100%-49px)]">
              <HistoryPanel />
            </div>
          </div>
        </>
      )}
    </header>
  );
};
