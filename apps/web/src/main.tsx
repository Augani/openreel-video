import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./index.css";
import { AstryxProvider } from "./components/astryx/AstryxProvider";
import { registerServiceWorker } from "./services/service-worker";
import { initCustomFonts } from "./components/editor/inspector/font-options";
import { setEncoderBackendFactory } from "@openreel/core";
import { NativeFFmpegBackend } from "./services/native-ffmpeg-backend";
import { takeHandoff } from "./hawsh/handoff";
import { initHawsh } from "./hawsh/session";

const DesktopApp = React.lazy(() =>
  import("./desktop/DesktopApp").then((module) => ({
    default: module.DesktopApp,
  })),
);

const isDesktop =
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

if (isDesktop) {
  setEncoderBackendFactory(
    () =>
      new NativeFFmpegBackend(
        () =>
          (window as { __openreelExportPath?: string }).__openreelExportPath ??
          "",
      ),
  );
}

// Director's Eyes sign-in: strip the one-time code from the address bar before the router reads the hash.
void initHawsh(takeHandoff());

registerServiceWorker().then((registration) => {
  if (registration) {
  }
});

void initCustomFonts();

const root = document.getElementById("root")!;

async function renderApplication(): Promise<void> {
  const application: React.ReactNode = isDesktop ? (
        <React.Suspense fallback={<div className="h-screen w-screen bg-bg" />}>
          <DesktopApp />
        </React.Suspense>
      ) : (
        <App />
      );

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AstryxProvider>{application}</AstryxProvider>
    </React.StrictMode>,
  );
}

void renderApplication();
