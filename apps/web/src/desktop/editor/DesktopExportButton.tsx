import type { JSX } from "react";
import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { VideoExportSettings } from "@openreel/core";
import { desktopExportRequiresNativeEncoder, encoderChoiceForcesNative, setEncoderBackendFactory, WebCodecsBackend, webCodecsEncoderOptions } from "@openreel/core";
import { useUIStore } from "../../stores/ui-store";
import { useProjectStore } from "../../stores/project-store";
import { addDialogExportToQueue, isExportQueueBusy } from "../../stores/export-queue-store";
import { getUseExportPreviews } from "../../services/export-queue/export-queue-activity";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import {
  useExportRunner,
  extForFormat,
  exportFilename,
} from "../../services/export-runner";
import { NativeFFmpegBackend } from "../../services/native-ffmpeg-backend";
import { EditorExportControl } from "../../components/editor/EditorExportControl";
import { getQuickExportPresets, type QuickVideoExportSettings } from "../../services/quick-export-presets";
import { useTimelineStore } from "../../stores/timeline-store";

const ExportDialog = lazy(() => import("../../components/editor/ExportDialog").then((m) => ({ default: m.ExportDialog })));

const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const resolveExportOutputPath = (): string =>
  (window as { __openreelExportPath?: string }).__openreelExportPath ?? "";

// Native ffmpeg writes the file itself via the resolved output path, so it does
// not consume the writable stream — a no-op stream satisfies the interface.
const NOOP_WRITABLE = {
  async seek() {},
  async write() {},
  async close() {},
  async abort() {},
  async truncate() {},
} as unknown as FileSystemWritableFileStream;

// WebCodecs hardware encoding (no per-frame GPU->CPU readback) is the fast path
// for the common H.264/HEVC fast/balanced case. ProRes, AV1, and the
// software-CRF "Smallest" mode stay on the native ffmpeg backend, and so do
// HDR, MXF, DNxHR and >8-bit exports (see desktopExportRequiresNativeEncoder).
function shouldUseWebCodecs(settings: QuickVideoExportSettings): boolean {
  const hasWebCodecs =
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !==
    "undefined";
  const mode = settings.encodeMode ?? "balanced";
  return (
    hasWebCodecs &&
    !desktopExportRequiresNativeEncoder(settings) &&
    !encoderChoiceForcesNative(settings.encoderChoice, settings.codec) &&
    (settings.codec === "h264" || settings.codec === "h265") &&
    (mode === "fast" || mode === "balanced")
  );
}

export function DesktopExportButton({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const project = useProjectStore((state) => state.project);
  const loopStart = useTimelineStore((s) => s.loopStart);
  const loopEnd = useTimelineStore((s) => s.loopEnd);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const {
    state,
    runExport,
    runAudioExport,
    markComplete,
    showSavePicker,
    beginExport,
    finishExportSoon,
    failExport,
    cancel,
    resetError,
  } = useExportRunner({ project });

  useEffect(() => {
    useUIStore
      .getState()
      .setExportState({
        isExporting: state.isExporting,
        progress: state.progress,
        phase: state.phase,
      });
  }, [state.isExporting, state.progress, state.phase]);

  useEffect(() => {
    const open = () => { if (!useUIStore.getState().exportState.isExporting) setIsDialogOpen(true); };
    window.addEventListener("openreel:menu:export", open);
    return () => window.removeEventListener("openreel:menu:export", open);
  }, []);

  const handleExport = useCallback(
    async (settings: QuickVideoExportSettings) => {
      setIsDialogOpen(false);
      if (project.timeline.duration <= 0 || useUIStore.getState().exportState.isExporting) return;
      if (isExportQueueBusy()) {
        addDialogExportToQueue(settings as VideoExportSettings, { presetLabel: "Custom", usePreviews: getUseExportPreviews() });
        return;
      }

      try {
        const ext = extForFormat(settings.format, settings.codec);
        const useWebCodecs = shouldUseWebCodecs(settings);
        const writable = await showSavePicker(
          exportFilename(project.name, ext),
          ext,
          { streamToFile: useWebCodecs },
        );

        beginExport();

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        if (useWebCodecs) {
          const videoCodec = settings.codec === "h265" ? "hevc" : "avc";
          setEncoderBackendFactory((mediabunny) =>
            mediabunny
              ? new WebCodecsBackend(mediabunny, {
                  ...webCodecsEncoderOptions(settings.encoderChoice),
                  videoCodecs: [videoCodec],
                  // Desktop streams frames to disk and uses the hardware encoder,
                  // so export at the full (matched) resolution — no browser clamp.
                  clampResolution: false,
                })
              : new NativeFFmpegBackend(resolveExportOutputPath),
          );
          try {
            await runExport(exportSettings, ext, writable);
          } catch (webCodecsError) {
            console.warn(
              "[Export] WebCodecs export failed; falling back to native ffmpeg:",
              webCodecsError,
            );
            try {
              await writable.abort?.();
            } catch {}
            setEncoderBackendFactory(
              () => new NativeFFmpegBackend(resolveExportOutputPath),
            );
            await runExport(exportSettings, ext, NOOP_WRITABLE);
          }
        } else {
          setEncoderBackendFactory(
            () => new NativeFFmpegBackend(resolveExportOutputPath),
          );
          await runExport(exportSettings, ext, writable);
        }

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [
      project,
      runExport,
      showSavePicker,
      beginExport,
      finishExportSoon,
      failExport,
    ],
  );

  useEffect(() => {
    const quickExport = (event: Event) => {
      const id: unknown = (event as CustomEvent<{ preset?: unknown }>).detail?.preset;
      if (project.timeline.duration <= 0 || state.isExporting || useUIStore.getState().exportState.isExporting) return;
      const preset = getQuickExportPresets(project.settings).find(entry => entry.id === id);
      if (!preset) return;
      if (preset.kind === "video") {
        void handleExport(preset.settings);
      } else {
        void (async () => {
          try {
            const writable = await showSavePicker(exportFilename(project.name, preset.extension), preset.extension);
            beginExport(writable);
            await runAudioExport(preset.settings, writable);
            markComplete();
            finishExportSoon();
          } catch (error) {
            failExport(error);
          }
        })();
      }
    };
    window.addEventListener("openreel:menu:quick-export", quickExport);
    return () => window.removeEventListener("openreel:menu:quick-export", quickExport);
  }, [project, state.isExporting, handleExport, showSavePicker, beginExport, runAudioExport, markComplete, finishExportSoon, failExport]);

  return (
    <>
      <EditorExportControl state={state} disabled={false} compact={compact}
        style={NO_DRAG} onOpen={() => setIsDialogOpen(true)} onCancel={cancel} onDismissError={resetError} />

      <Suspense fallback={null}>
      <ExportDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onExport={handleExport}
        onAddToQueue={addDialogExportToQueue}
        duration={project?.timeline?.duration ?? 0}
        projectWidth={project?.settings?.width ?? 1920}
        projectHeight={project?.settings?.height ?? 1080}
        frameRate={project?.settings?.frameRate ?? 30}
        sourceMatch={deriveSourceExportMatch(project)}
        markedRange={
          loopEnd > loopStart
            ? { startTime: loopStart, endTime: loopEnd }
            : null
        }
      />
      </Suspense>
    </>
  );
}
