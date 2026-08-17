import type { JSX } from "react";
import React, { useCallback, useEffect, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import type { VideoExportSettings } from "@openreel/core";
import { setEncoderBackendFactory, WebCodecsBackend } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { ExportDialog } from "../../components/editor/ExportDialog";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import { useExportRunner, extForFormat, exportFilename } from "../../services/export-runner";
import { NativeFFmpegBackend } from "../../services/native-ffmpeg-backend";
import { Icon } from "@/icons/Icon";
import { useTranslation } from "react-i18next";

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
// software-CRF "Smallest" mode stay on the native ffmpeg backend.
function shouldUseWebCodecs(settings: VideoExportSettings): boolean {
  const hasWebCodecs =
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !==
    "undefined";
  const mode = settings.encodeMode ?? "balanced";
  return (
    hasWebCodecs &&
    (settings.codec === "h264" || settings.codec === "h265") &&
    (mode === "fast" || mode === "balanced")
  );
}

export function DesktopExportButton(): JSX.Element {
  const { t } = useTranslation();
  const project = useProjectStore((state) => state.project);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const {
    state,
    runExport,
    showSavePicker,
    beginExport,
    finishExportSoon,
    failExport,
    cancel,
    resetError,
  } = useExportRunner({ project });

  useEffect(() => {
    const open = () => setIsDialogOpen(true);
    window.addEventListener("openreel:menu:export", open);
    return () => window.removeEventListener("openreel:menu:export", open);
  }, []);

  const handleExport = useCallback(
    async (settings: VideoExportSettings) => {
      setIsDialogOpen(false);

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
            settings.upscaling?.enabled && needsUpscaling ? settings.upscaling : undefined,
        };

        if (useWebCodecs) {
          const videoCodec = settings.codec === "h265" ? "hevc" : "avc";
          setEncoderBackendFactory((mediabunny) =>
            mediabunny
              ? new WebCodecsBackend(mediabunny, {
                  hardwareAcceleration: "prefer-hardware",
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
    [project, runExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );

  if (state.isExporting) {
    return (
      <Button
        label={`${Math.round(state.progress)}%`}
        variant="secondary"
        size="sm"
        style={NO_DRAG}
        onClick={cancel}
        className="mr-2"
        aria-label={t("Cancel export")}
      />
    );
  }

  if (state.error) {
    return (
      <Button
        label={state.error}
        variant="destructive"
        size="sm"
        style={NO_DRAG}
        onClick={resetError}
        className="mr-2 max-w-[200px] truncate"
        aria-label={t("Dismiss export error")}
      />
    );
  }

  if (state.complete) {
    return (
      <Button
        label={t("Saved!")}
        variant="secondary"
        size="sm"
        style={NO_DRAG}
        className="mr-2"
        isDisabled
      />
    );
  }

  return (
    <>
      <Button
        label={t("Export")}
        variant="primary"
        size="sm"
        icon={<Icon name="square.and.arrow.up" size={15} ariaHidden />}
        style={NO_DRAG}
        onClick={() => setIsDialogOpen(true)}
        className="mr-2"
      />

      <ExportDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onExport={handleExport}
        duration={project?.timeline?.duration ?? 0}
        projectWidth={project?.settings?.width ?? 1920}
        projectHeight={project?.settings?.height ?? 1080}
        frameRate={project?.settings?.frameRate ?? 30}
        sourceMatch={deriveSourceExportMatch(project)}
      />
    </>
  );
}
