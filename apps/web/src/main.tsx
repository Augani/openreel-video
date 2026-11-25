import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { AppProviders } from "./components/AppProviders";
import { registerServiceWorker } from "./services/service-worker";
import { initCustomFonts } from "./components/editor/inspector/font-options";
import { setEncoderBackendFactory } from "@openreel/core/export/encoder-backend";
import { installRawWorker } from "./services/raw-worker-client";
import { startRawThumbnailSync } from "./services/raw-thumbnails";
import { compositionIdFromHash } from "./services/linked-comp-protocol";
import { segmentWorkerFromHash } from "./services/export-queue/segment-worker-protocol";

performance.mark("openreel:entry");

// Camera RAW is developed off the main thread.
installRawWorker();
startRawThumbnailSync();

if (import.meta.env.VITE_OPENREEL_E2E === "1") {
  void import("./e2e-hook").then(async (module) => {
    await module.prepareE2EHook();
    module.installE2EHook();
  });
}

const isDesktop =
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

// Desktop native decode, path hydration and the ffmpeg export backend are desktop-only, so they load as a
// separate chunk instead of sitting in the web entry. The first render waits for them (in parallel with the
// DesktopApp chunk, see renderApplication), so no import, decode or export can start before they are installed.
const desktopNativeReady: Promise<void> = !isDesktop
  ? Promise.resolve()
  : Promise.all([
    import("./services/native-decode"),
    import("./services/native-path-hydration"),
    import("./services/native-ffmpeg-backend"),
  ]).then(([decode, hydration, backend]) => {
    decode.installDesktopNativeDecode();
    hydration.startNativePathHydration();
    setEncoderBackendFactory(
      () =>
        new backend.NativeFFmpegBackend(
          () =>
            (window as { __openreelExportPath?: string }).__openreelExportPath ??
            "",
        ),
    );
  })
  .catch((error: unknown) => {
    console.error("[openreel] desktop native decode / export backend failed to load", error);
  });

// Hosted audio plugins (desktop): report plugins a project uses that this computer lacks, whenever a project opens.
if (isDesktop) void import("./services/native-plugin-report").then((report) => report.startNativePluginReport());

// The editor chunk (1.6 MB) and engine init are warmed by DesktopApp's idle callback
// once the welcome screen is mounted. Queueing them here instead made the editor
// chunk's synchronous evaluation compete with (and delay) the welcome screen's first
// render by ~300 ms on a cold launch.

registerServiceWorker().then((registration) => {
  if (registration) {
  }
});

void initCustomFonts();

const root = document.getElementById("root")!;

async function renderCompositionWindow(compositionId: string): Promise<void> {
  const { CompositionWindow } = await import("./components/composition/CompositionWindow");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppProviders>
        <CompositionWindow compositionId={compositionId} />
      </AppProviders>
    </React.StrictMode>,
  );
}

async function renderApplication(): Promise<void> {
  // A hidden worker window of a parallel export renders segments or audio and shows nothing.
  const worker = isDesktop ? segmentWorkerFromHash(window.location.hash) : null;
  if (worker) {
    await desktopNativeReady;
    void import("./services/export-queue/segment-worker").then((module) => module.runSegmentWorker(worker.sessionId, worker.role));
    return;
  }
  // A linked composition window shows only that composition's editor (see linked-comp-bridge).
  const compositionId = compositionIdFromHash(window.location.hash);
  if (compositionId) {
    await desktopNativeReady;
    await renderCompositionWindow(compositionId);
    return;
  }
  // Desktop: resolve the (tiny) DesktopApp chunk BEFORE the first render instead of
  // suspending on React.lazy. A Suspense fallback that has already committed makes
  // React hold the resolved content back until 300 ms after the fallback appeared,
  // which showed up as ~250 ms of dead time between chunk arrival and the welcome
  // screen on a cold launch.
  let application: React.ReactNode = <App />;
  if (isDesktop) {
    const loadDesktopApp = () => import("./desktop/DesktopApp");
    // A failed chunk fetch must not leave a blank window: retry once, then fall back to the
    // lazy/Suspense path so the failure surfaces through React like it did before.
    const [module] = await Promise.all([
      loadDesktopApp()
        .catch(() => new Promise<void>((resolve) => setTimeout(resolve, 400)).then(loadDesktopApp))
        .catch(() => null),
      desktopNativeReady,
    ]);
    if (module) {
      application = <module.DesktopApp />;
    } else {
      const LazyDesktopApp = React.lazy(() => loadDesktopApp().then((m) => ({ default: m.DesktopApp })));
      application = (
        <React.Suspense fallback={<div className="h-screen w-screen bg-bg text-fg" data-testid="desktop-boot-shell" />}>
          <LazyDesktopApp />
        </React.Suspense>
      );
    }
  }

  performance.mark("openreel:first-render");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppProviders>{application}</AppProviders>
    </React.StrictMode>,
  );
}

void renderApplication();
