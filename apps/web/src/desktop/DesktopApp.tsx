import { useCollabStore } from "../services/collab/collab-store";
import type { JSX } from "react";
import { Suspense, lazy, useEffect, useState } from "react";
import { WindowControls } from "./shell/WindowControls";
import App from "../App";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { openEditorProject } from "../services/project-replacement";
import { autoSaveManager } from "../services/auto-save";
import { UpdateBanner } from "./UpdateBanner";
import {
  installRendererCrashHandlers,
  reportRendererCrash,
} from "./crash-reporting";
import { useSettingsStore } from "../stores/settings-store";
import { usePluginManagerStore } from "../stores/plugin-manager-store";
import { keyboardShortcuts } from "../services/keyboard-shortcuts";
import { loadEditorModule } from "../editor-loader";
import { warmAudioDevices } from "./audio-warmup";
import { useOnboardingStore } from "../stores/onboarding-store";
import { installOnboardingSync } from "../components/onboarding/shell/onboarding-sync";
import { handleProjectOpenedOnWelcomeRoute, isWelcomeRoute } from "../components/onboarding/shell/agent-flip";
import { withUserProjectCreation } from "../components/onboarding/shell/project-intent";

const loadOnboardingHost = () => import("../components/onboarding/shell/OnboardingHost");
// Sheets (and their chunks) only load once something asks for one; the host is just a router.
const OnboardingHost = lazy(loadOnboardingHost);

function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // Marks are diagnostics only.
  }
}

/**
 * Settles when the editor warm-up (editor chunk, engine init, effects bridge) has finished or
 * failed. The agent/MCP stack (an ~860 KB chunk plus its registry) waits for it: it used to load on
 * the first animation frame, i.e. in the middle of the warm-up, and its compile + evaluate time
 * (measured with the perf-trace metrics) landed on the cold-start path.
 */
let resolveWarmupSettled: () => void = () => {};
const warmupSettled = new Promise<void>((resolve) => {
  resolveWarmupSettled = resolve;
});
const AGENT_STACK_MAX_WAIT_MS = 6000;
// After the editor route mounts, wait this long (then an idle slot) before loading the agent stack.
const AGENT_STACK_SETTLE_MS = 1200;
// On the welcome screen, load the agent stack after this long without the editor opening.
const AGENT_STACK_WELCOME_WAIT_MS = 8000;

function whenIdle(callback: () => void, timeout: number): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

export function DesktopApp(): JSX.Element {
  const [editorRoute, setEditorRoute] = useState(() =>
    window.location.hash.startsWith("#/editor"),
  );
  useEffect(() => {
    mark("openreel:desktop-app-mounted");
    // After the welcome screen is committed: see audio-warmup.ts.
    warmAudioDevices(navigator);
    // Warm the editor chunk and the engines (WebGPU adapter/device, audio,
    // playback, export: ~1.1 s measured in the real app) while the welcome
    // screen is showing, so "New project" does not wait for them. initialize()
    // is idempotent and the editor hook awaits an in-flight init.
    const warm = () => {
      void loadEditorModule()
        .then(() => useEngineStore.getState().initialize())
        // The effects bridge (GPU context + shader compile, ~40 ms of main-thread work) is
        // otherwise the slowest step of editor init, after the click. The effects engine
        // resizes itself to the frames it processes, so the default 1920x1080 start size is
        // safe for every project format. A failure just leaves the editor to init it later.
        .then(() => import("../bridges/effects-bridge"))
        .then((bridge) => bridge.initializeEffectsBridge())
        .catch((error) => {
          console.warn("[desktop] editor warm-up failed", error);
        })
        .finally(resolveWarmupSettled);
    };
    const useIdle = typeof window.requestIdleCallback === "function";
    const idle = useIdle
      ? window.requestIdleCallback(warm, { timeout: 300 })
      : window.setTimeout(warm, 1500);
    return () => {
      if (useIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);
  useEffect(() => {
    mark(editorRoute ? "openreel:editor-mounted" : "openreel:welcome-visible");
  }, [editorRoute]);
  // Onboarding: warm the host chunk at idle (after welcome-visible; skipped once the user is in the
  // editor), keep the main-process mirror in step, and mount the host only when a sheet is requested.
  const sheetRequested = useOnboardingStore((state) => Boolean(state.openSheet));
  useEffect(() => {
    if (editorRoute) return;
    return whenIdle(() => {
      if (!window.location.hash.startsWith("#/editor")) void loadOnboardingHost().catch(() => undefined);
    }, 2500);
  }, [editorRoute]);
  useEffect(() => installOnboardingSync(), []);
  useEffect(() => {
    const update = () =>
      setEditorRoute(window.location.hash.startsWith("#/editor"));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  // Drive native-menu actions into the app: undo/redo hit the project store
  // directly; new/open use the same project flow as the shared editor.
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
        case "selectAll": {
          const active = document.activeElement;
          const editable = active instanceof HTMLElement
            ? active.closest('[contenteditable]:not([contenteditable="false"])')
            : null;
          if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
            active.select();
          } else if (editable) {
            window.getSelection()?.selectAllChildren(editable);
          } else {
            keyboardShortcuts.runCommand("selection.selectAll");
          }
          break;
        }
        case "newProject":
          // Onboarding is retired by the #/new flow once the project exists, so a cancel keeps it.
          window.location.hash = "#/new";
          break;
        case "showWelcomeSetup": {
          useOnboardingStore.getState().reopenBand();
          const route = window.location.hash.split("?")[0];
          if (route !== "#/welcome") window.location.hash = "#/welcome";
          break;
        }
        case "openLessons":
          useOnboardingStore.getState().showSheet("lessons");
          break;
        case "connectAgent":
          useOnboardingStore.getState().showSheet("agent");
          break;
        case "open":
          void withUserProjectCreation(() => openEditorProject())
            .then((opened) => {
              if (!opened) return;
              useOnboardingStore.getState().skip("user");
              window.location.hash = "#/editor";
            })
            .catch((error: unknown) => {
              reportRendererCrash({
                type: "project-open-error",
                message: error instanceof Error ? error.message : String(error),
              });
              useProjectStore.setState({
                error: "Could not open the project. Please try again.",
              });
            });
          break;
        case "export":
          window.dispatchEvent(new CustomEvent(`openreel:menu:${id}`));
          break;
        case "settings":
          useSettingsStore.getState().openSettings();
          break;
        case "collaborate":
          useCollabStore.getState().openDialog();
          break;
        case "managePlugins":
          usePluginManagerStore.getState().setOpen(true);
          break;
      }
    });
  }, []);

  // MCP clients can create or open a project while the start screen is shown.
  useEffect(
    () =>
      useProjectStore.subscribe((state, previous) => {
        if (
          !state.hasOpenProject ||
          (previous.hasOpenProject && state.project.id === previous.project.id)
        )
          return;
        if (isWelcomeRoute(window.location.hash)) {
          // An MCP client created or opened a project while the welcome UI (band or a sheet) was up:
          // retire onboarding quietly (skippedBy "agent") and flip to the editor.
          handleProjectOpenedOnWelcomeRoute();
          window.location.hash = "#/editor";
        }
      }),
    [],
  );

  // Forward uncaught renderer errors + unhandled rejections to the native crash
  // collector so editor-side faults are captured alongside main-process crashes.
  useEffect(() => installRendererCrashHandlers(), []);

  // Serve main-process MCP tool calls against the live editor so external MCP
  // clients drive the open project through the same tool layer as the chat panel.
  // Also back the export_* job tools with a runner that renders via the export
  // engine to a local file (the app's export folder, or the agent's outputPath inside the allowed
  // roots) and returns its path, size and SHA-256. Nothing is uploaded.
  // Loaded once the editor warm-up has settled and the main thread is idle, so the agent stack
  // stays off both the startup path and the enter-editor path.
  useEffect(() => {
    let cancelled = false;
    let cancelIdle: (() => void) | undefined;
    type Listener = typeof import("../services/agent/mcp-listener");
    let loading: Promise<Listener> | undefined;
    // Memoised: the idle path and an early MCP request share one load.
    const loadAgentStack = (): Promise<Listener> => {
      loading ??= Promise.all([
        import("../services/agent/host-singleton"),
        import("../services/agent/export-job-runner"),
        import("../services/agent/mcp-listener"),
      ]).then(([host, jobs, listener]) => {
        host.getLiveEditorHost().setJobRunner(jobs.createExportJobRunner());
        return listener;
      });
      return loading;
    };
    // The IPC handler is registered immediately (it is tiny); a request that arrives before the
    // deferred stack has loaded triggers the load and waits for it instead of being dropped by the
    // main process (webContents.send has no queue, so a late listener would time the call out).
    const mcp = window.openreel?.mcp;
    const uninstall = mcp?.onRequest(async (req) => {
      const listener = await loadAgentStack();
      return listener.handleMcpBridgeRequest(req);
    });
    const maxWait = window.setTimeout(resolveWarmupSettled, AGENT_STACK_MAX_WAIT_MS);
    const inEditor = () => window.location.hash.startsWith("#/editor");
    let scheduled = false;
    let welcomeTimer: number | undefined;
    let settleTimer: number | undefined;
    const scheduleAgentStack = () => {
      if (scheduled || cancelled) return;
      scheduled = true;
      window.removeEventListener("hashchange", onHash);
      window.clearTimeout(welcomeTimer);
      // A beat after the editor mounted, then an idle slot: the ~1 MB agent chunk's compile + evaluate must
      // not run between the click on "New project" and the editor being interactive.
      settleTimer = window.setTimeout(() => {
        if (cancelled) return;
        cancelIdle = whenIdle(() => {
          loadAgentStack().catch((error) => {
            console.warn("[desktop] agent/MCP bridge failed to load", error);
          });
        }, 1500);
      }, AGENT_STACK_SETTLE_MS);
    };
    function onHash(): void {
      if (inEditor()) scheduleAgentStack();
    }
    void warmupSettled.then(() => {
      if (cancelled) return;
      // The stack is only needed once something drives the editor, and an MCP request that arrives earlier
      // loads it on demand (above). So it follows the editor opening; a session that stays on the welcome
      // screen still gets it after a while, so the first agent call after a long idle is not cold.
      if (inEditor()) {
        scheduleAgentStack();
        return;
      }
      window.addEventListener("hashchange", onHash);
      welcomeTimer = window.setTimeout(scheduleAgentStack, AGENT_STACK_WELCOME_WAIT_MS);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(maxWait);
      window.clearTimeout(welcomeTimer);
      window.clearTimeout(settleTimer);
      window.removeEventListener("hashchange", onHash);
      cancelIdle?.();
      uninstall?.();
    };
  }, []);

  // Answer the native unsaved-changes guard on window close / quit: report
  // dirty state and flush pending changes on request.
  useEffect(() => {
    const lifecycle = window.openreel?.lifecycle;
    if (!lifecycle) return;
    const offQuery = lifecycle.onQueryUnsaved(() =>
      autoSaveManager.hasUnsavedChanges(
        useProjectStore.getState().getFullProject(),
      ),
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
    <div
      className="isolate flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg"
      data-testid="desktop-app"
    >
      {!editorRoute && (
        <div
          className="flex h-11 shrink-0 items-center justify-end border-b border-border bg-bg-1"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <WindowControls
            platform={
              /Mac/i.test(navigator.platform)
                ? "darwin"
                : /Win/i.test(navigator.platform)
                  ? "win32"
                  : "linux"
            }
          />
        </div>
      )}
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
          <App />
        </ErrorBoundary>
      </div>
      <UpdateBanner />
      {sheetRequested && (
        <Suspense fallback={null}>
          <OnboardingHost />
        </Suspense>
      )}
    </div>
  );
}
