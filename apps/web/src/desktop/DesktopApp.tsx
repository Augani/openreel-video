import type { JSX } from "react";
import { useEffect } from "react";
import { DesktopTitleBar } from "./shell/DesktopTitleBar";
import { Workspace } from "./shell/Workspace";
import { DesktopStartScreen } from "./start/DesktopStartScreen";
import { DesktopExportButton } from "./editor/DesktopExportButton";
import { EditorBootstrapGate } from "./editor/EditorBootstrapGate";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useProjectStore } from "../stores/project-store";
import { autoSaveManager } from "../services/auto-save";
import { UpdateBanner } from "./UpdateBanner";
import { installRendererCrashHandlers, reportRendererCrash } from "./crash-reporting";
import { installMcpListener } from "../services/agent/mcp-listener";
import { getLiveEditorHost } from "../services/agent/host-singleton";
import { createExportJobRunner } from "../services/agent/export-job-runner";
import { useGpuJobPoller } from "../hooks/useGpuJobPoller";
import { useUIStore } from "../stores/ui-store";
import { useSettingsStore } from "../stores/settings-store";
import { SettingsDialog } from "../components/editor/settings/SettingsDialog";
import { ToolcraftButton as Button } from "@openreel/ui";
import { Settings } from "@/icons/lucide-compat";
import "./theme/desktop-theme.css";
import { useTranslation } from "react-i18next";

function detectPlatform(): string {
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)) return "darwin";
  if (typeof navigator !== "undefined" && /Win/i.test(navigator.platform)) return "win32";
  return "linux";
}

export function DesktopApp(): JSX.Element {
  const { t } = useTranslation();
  const platform = detectPlatform();
  const hasProject = useProjectStore((state) => state.hasOpenProject);
  const desktopPage = useUIStore((state) => state.desktopPage);
  const isVideoEditing = desktopPage !== "motion";

  useGpuJobPoller();

  // Drive native-menu actions into the app: undo/redo hit the project store
  // directly; new/open/export are broadcast as events for the relevant UI to
  // pick up (e.g. the export button opens its dialog on "export").
  useEffect(() => {
    const bridge = window.openreel;
    if (!bridge?.onMenuAction) return;
    return bridge.onMenuAction((id) => {
      switch (id) {
        case "undo":
          void useProjectStore.getState().undo();
          break;
        case "redo":
          void useProjectStore.getState().redo();
          break;
        case "newProject":
        case "open":
        case "export":
          window.dispatchEvent(new CustomEvent(`openreel:menu:${id}`));
          break;
        case "settings":
          useSettingsStore.getState().openSettings();
          break;
      }
    });
  }, []);

  // Forward uncaught renderer errors + unhandled rejections to the native crash
  // collector so editor-side faults are captured alongside main-process crashes.
  useEffect(() => installRendererCrashHandlers(), []);

  // Serve main-process MCP tool calls against the live editor so external MCP
  // clients drive the open project through the same tool layer as the chat panel.
  // Also back the export_* job tools with a runner that renders via the export
  // engine and uploads the artifact to R2, returning a presigned download URL.
  useEffect(() => {
    getLiveEditorHost().setJobRunner(createExportJobRunner());
    return installMcpListener();
  }, []);

  // Answer the native unsaved-changes guard on window close / quit: report
  // dirty state and flush pending changes on request.
  useEffect(() => {
    const lifecycle = window.openreel?.lifecycle;
    if (!lifecycle) return;
    const offQuery = lifecycle.onQueryUnsaved(() =>
      autoSaveManager.hasUnsavedChanges(useProjectStore.getState().getFullProject()),
    );
    const offFlush = lifecycle.onFlush(() =>
      useProjectStore.getState().forceSave(),
    );
    return () => {
      offQuery();
      offFlush();
    };
  }, []);

  return (
    <div className="openreel-desktop isolate flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <DesktopTitleBar platform={platform}>
        {hasProject && isVideoEditing ? <DesktopExportButton /> : null}
        <Button
          label={t("Settings")}
          variant="secondary"
          size="sm"
          icon={<Settings size={15} aria-hidden />}
          onClick={() => useSettingsStore.getState().openSettings()}
          className="mr-2"
        />
      </DesktopTitleBar>
      <div className="min-h-0 flex-1">
        <ErrorBoundary
          onError={(error, info) =>
            reportRendererCrash({
              type: "react-error",
              message: error.message,
              stack: error.stack,
              context: { componentStack: info.componentStack },
            })
          }
        >
          {hasProject ? (
            <EditorBootstrapGate>
              <Workspace />
            </EditorBootstrapGate>
          ) : (
            <DesktopStartScreen />
          )}
        </ErrorBoundary>
      </div>
      <UpdateBanner />
      <SettingsDialog />
    </div>
  );
}
