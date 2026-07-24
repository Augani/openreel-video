import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { z } from "zod";
import { registerAppSchemePrivileges, handleAppScheme, APP_INDEX } from "./protocol";
import { installNavigationGuard } from "./nav-guard";
import { handle } from "./ipc";
import { CHANNELS } from "../shared/ipc-contract";
import { collectHardwareInfo } from "./ipc/hardware";
import {
  startExport,
  writeAudioWav,
  writeAudioChunk,
  finishAudio,
  cancelExport,
  cancelAllExports,
} from "./ipc/export";
import {
  cancelAuroraPreviewSession,
  cancelAuroraSequenceSession,
  renderAuroraPreview,
  startAuroraPreviewSession,
  startAuroraSequenceSession,
} from "./ipc/aurora";
import { getKeyStore } from "./ipc/keychain";
import { cloudFetch } from "./ipc/cloud";
import { GpuTokenProvider } from "./gpu/token-provider";
import { GpuJobClient } from "./gpu/job-client";
import { getOrCreateInstanceId } from "./gpu/instance-id";
import { applyWindowControl, windowIsMaximized } from "./window-controls";
import { installApplicationMenu, sendMenuAction } from "./app-menu";
import { attachUnsavedGuard, markQuitting } from "./lifecycle";
import { initAutoUpdater } from "./updater";
import { initCrashReporter, reportError } from "./crash-reporter";
import { migrateGpuCacheOnUpgrade } from "./gpu-cache-migration";
import {
  startMcpServer,
  stopMcpServer,
  getMcpStatus,
  rotateMcpToken,
  testMcpConnection,
} from "./mcp/server";
import {
  fileWriters,
  showSaveDialog,
  showOpenDialog,
  readTextFile,
  readFileBytes,
  writeTextFile,
  revealInFolder,
  tempFilePath,
} from "./ipc/fs";
import {
  generateProxy,
  transcode,
  extractAudioWav,
  probeAudioStreams,
} from "./ipc/media";
import { fetchUrl } from "./ipc/fetch-url";
import { probeRiggingBackend, rigHumanoidModel } from "./sidecar/rigging-backend";
import { disposeAuroraClient } from "./aurora/client";
import {
  saveDialogArgsSchema,
  openDialogArgsSchema,
  readFileArgsSchema,
  writeFileArgsSchema,
  proxyArgsSchema,
  transcodeArgsSchema,
  extractAudioArgsSchema,
  probeAudioArgsSchema,
  fetchUrlArgsSchema,
  auroraPreviewSessionCancelArgsSchema,
  auroraPreviewSessionStartArgsSchema,
  auroraPreviewSessionStartResultSchema,
  auroraSequenceSessionCancelArgsSchema,
  auroraSequenceSessionStartArgsSchema,
  auroraSequenceSessionStartResultSchema,
  auroraRenderPreviewArgsSchema,
  auroraRenderPreviewResultSchema,
  riggingBackendProbeSchema,
  rigHumanoidModelArgsSchema,
  rigHumanoidModelResultSchema,
  cloudFetchArgsSchema,
  gpuUploadMediaArgsSchema,
  gpuUploadExportArgsSchema,
  gpuSubmitJobArgsSchema,
  gpuJobIdArgsSchema,
  gpuArtifactArgsSchema,
  windowControlArgsSchema,
} from "../shared/ipc-contract";
import type {
  AuroraPreviewSessionStartArgs,
  AuroraRenderPreviewArgs,
  AuroraSequenceSessionStartArgs,
} from "../shared/ipc-contract";

registerAppSchemePrivileges();

// Register crash/error reporting as early as possible so main-process faults and
// process-gone events during startup are captured (POST to the cloud worker).
initCrashReporter();

// Drop regenerable GPU/shader/code caches when the app version changes — before
// app is ready and the GPU process starts — so an upgrade can't crash on a stale
// cache written by a previous Electron build. Runs synchronously and early.
migrateGpuCacheOnUpgrade();

// Single-instance lock: a second launch focuses the existing window instead of
// opening a duplicate. Two instances would share the same autosave/IndexedDB
// (data races) and could clobber each other's GPU cache, so only one runs.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const BROKER_BASE_URL =
  process.env.OPENREEL_AUTH_BROKER_BASE_URL ?? "https://api.openreel.video";
const GPU_BASE_URL = process.env.OPENREEL_GPU_BASE_URL ?? "https://ai.openreel.video";
const GPU_BUNDLE_ID = "com.openreel.video";

let gpuClient: GpuJobClient | null = null;
async function getGpuClient(): Promise<GpuJobClient> {
  if (gpuClient) return gpuClient;
  const instanceId = await getOrCreateInstanceId();
  const tokenProvider = new GpuTokenProvider({
    brokerBaseUrl: BROKER_BASE_URL,
    bundleId: GPU_BUNDLE_ID,
    instanceId,
  });
  gpuClient = new GpuJobClient({
    gpuBaseUrl: GPU_BASE_URL,
    brokerBaseUrl: BROKER_BASE_URL,
    bundleId: GPU_BUNDLE_ID,
    tokenProvider,
    tempFilePath: (ext: string) => tempFilePath({ ext }),
  });
  return gpuClient;
}

function rendererRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer")
    : path.join(__dirname, "../../../web/dist");
}

function createWindow(): void {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: isMac ? undefined : "#1b1b20",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: false,
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    icon: isMac ? undefined : path.join(__dirname, "../../build/icon.png"),
    vibrancy: isMac ? "under-window" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  attachUnsavedGuard(win);
  installNavigationGuard(win, APP_INDEX);
  win.loadURL(APP_INDEX);
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  handleAppScheme(rendererRoot());
  handle(CHANNELS.probeHardware, z.undefined(), () => collectHardwareInfo());
  handle(CHANNELS.fsShowSaveDialog, saveDialogArgsSchema, showSaveDialog);
  handle(CHANNELS.fsShowOpenDialog, openDialogArgsSchema, showOpenDialog);
  handle(CHANNELS.fsReadFile, readFileArgsSchema, readTextFile);
  handle(CHANNELS.fsWriteFile, writeFileArgsSchema, writeTextFile);
  handle(CHANNELS.fsOpenWrite, z.object({ path: z.string() }), ({ path }) => fileWriters.open(path));
  handle(
    CHANNELS.fsWriteChunk,
    z.object({
      handleId: z.string(),
      data: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
      position: z.number(),
    }),
    ({ handleId, data, position }) => fileWriters.writeChunk(handleId, data, position),
  );
  handle(CHANNELS.fsCloseWrite, z.object({ handleId: z.string() }), ({ handleId }) =>
    fileWriters.close(handleId),
  );
  handle(CHANNELS.fsAbortWrite, z.object({ handleId: z.string() }), ({ handleId }) =>
    fileWriters.abort(handleId),
  );
  handle(CHANNELS.fsRevealInFolder, readFileArgsSchema, revealInFolder);
  handle(CHANNELS.fsReadFileBytes, readFileArgsSchema, readFileBytes);
  handle(CHANNELS.fsTempFilePath, z.object({ ext: z.string() }), tempFilePath);
  handle(CHANNELS.mediaGenerateProxy, proxyArgsSchema, generateProxy);
  handle(CHANNELS.mediaTranscode, transcodeArgsSchema, transcode);
  handle(CHANNELS.mediaExtractAudioWav, extractAudioArgsSchema, extractAudioWav);
  handle(CHANNELS.mediaProbeAudioStreams, probeAudioArgsSchema, probeAudioStreams);
  handle(CHANNELS.mediaFetchUrl, fetchUrlArgsSchema, fetchUrl);
  handle(CHANNELS.auroraRenderPreview, auroraRenderPreviewArgsSchema, async (args) =>
    auroraRenderPreviewResultSchema.parse(
      await renderAuroraPreview(args as AuroraRenderPreviewArgs),
    ),
  );
  ipcMain.handle(
    CHANNELS.auroraStartPreviewSession,
    async (event, raw) =>
      auroraPreviewSessionStartResultSchema.parse(
        await startAuroraPreviewSession(
          event.sender,
          auroraPreviewSessionStartArgsSchema.parse(raw) as AuroraPreviewSessionStartArgs,
        ),
      ),
  );
  ipcMain.handle(CHANNELS.auroraCancelPreviewSession, async (event, raw) => {
    const { sessionId } = auroraPreviewSessionCancelArgsSchema.parse(raw);
    await cancelAuroraPreviewSession(sessionId, event.sender);
  });
  ipcMain.handle(
    CHANNELS.auroraStartSequenceSession,
    async (event, raw) =>
      auroraSequenceSessionStartResultSchema.parse(
        await startAuroraSequenceSession(
          event.sender,
          auroraSequenceSessionStartArgsSchema.parse(raw) as AuroraSequenceSessionStartArgs,
        ),
      ),
  );
  ipcMain.handle(CHANNELS.auroraCancelSequenceSession, async (event, raw) => {
    const { sessionId } = auroraSequenceSessionCancelArgsSchema.parse(raw);
    await cancelAuroraSequenceSession(sessionId, event.sender);
  });
  handle(CHANNELS.riggingProbeBackend, z.undefined(), async () =>
    riggingBackendProbeSchema.parse(await probeRiggingBackend()),
  );
  handle(CHANNELS.riggingRigHumanoidModel, rigHumanoidModelArgsSchema, async (args) =>
    rigHumanoidModelResultSchema.parse(await rigHumanoidModel(args)),
  );
  handle(CHANNELS.keychainGet, z.object({ id: z.string() }), ({ id }) => getKeyStore().get(id));
  handle(CHANNELS.keychainSet, z.object({ id: z.string(), value: z.string() }), ({ id, value }) =>
    getKeyStore().set(id, value),
  );
  handle(CHANNELS.keychainDelete, z.object({ id: z.string() }), ({ id }) => getKeyStore().delete(id));
  handle(CHANNELS.cloudFetch, cloudFetchArgsSchema, cloudFetch);
  handle(CHANNELS.gpuUploadMedia, gpuUploadMediaArgsSchema, async (args) =>
    (await getGpuClient()).uploadMedia(args),
  );
  handle(CHANNELS.gpuUploadExport, gpuUploadExportArgsSchema, async (args) =>
    (await getGpuClient()).uploadBytes(args),
  );
  handle(CHANNELS.gpuSubmitJob, gpuSubmitJobArgsSchema, async (args) =>
    (await getGpuClient()).submitJob(args),
  );
  handle(CHANNELS.gpuJobStatus, gpuJobIdArgsSchema, async ({ jobID }) =>
    (await getGpuClient()).jobStatus(jobID),
  );
  handle(CHANNELS.gpuFetchManifest, gpuJobIdArgsSchema, async ({ jobID }) =>
    (await getGpuClient()).fetchManifest(jobID),
  );
  handle(CHANNELS.gpuDownloadArtifact, gpuArtifactArgsSchema, async ({ jobID, relativePath }) =>
    (await getGpuClient()).downloadArtifact(jobID, relativePath),
  );
  handle(CHANNELS.gpuCancelJob, gpuJobIdArgsSchema, async ({ jobID }) =>
    (await getGpuClient()).cancelJob(jobID),
  );
  ipcMain.handle(CHANNELS.exportStart, (e, raw) => startExport(e.sender, raw));
  handle(
    CHANNELS.exportWriteAudioWav,
    z.object({ jobId: z.string(), wav: z.instanceof(ArrayBuffer) }),
    writeAudioWav,
  );
  handle(
    CHANNELS.exportWriteAudioChunk,
    z.object({
      jobId: z.string(),
      chunk: z.instanceof(ArrayBuffer),
      position: z.number().int().nonnegative(),
    }),
    writeAudioChunk,
  );
  handle(CHANNELS.exportFinishAudio, z.object({ jobId: z.string() }), finishAudio);
  handle(CHANNELS.exportCancel, z.object({ jobId: z.string() }), cancelExport);
  ipcMain.handle(CHANNELS.windowControl, (e, raw) => {
    const parsed = windowControlArgsSchema.parse(raw);
    applyWindowControl(BrowserWindow.fromWebContents(e.sender), parsed.action);
  });
  ipcMain.handle(CHANNELS.windowIsMaximized, (e) =>
    windowIsMaximized(BrowserWindow.fromWebContents(e.sender)),
  );
  ipcMain.on(CHANNELS.crashReport, (_e, raw) => {
    const payload = (raw ?? {}) as {
      message?: unknown;
      stack?: unknown;
      type?: unknown;
      context?: unknown;
    };
    const message = typeof payload.message === "string" ? payload.message : "";
    if (!message) return;
    reportError({
      type: typeof payload.type === "string" ? payload.type : "renderer-error",
      source: "renderer",
      message,
      stack: typeof payload.stack === "string" ? payload.stack : undefined,
      context: payload.context,
    });
  });
  handle(CHANNELS.mcpGetStatus, z.undefined(), () => getMcpStatus());
  handle(CHANNELS.mcpRotateToken, z.undefined(), () => rotateMcpToken());
  handle(CHANNELS.mcpTestConnection, z.undefined(), () => testMcpConnection());
  createWindow();
  initAutoUpdater();
  startMcpServer().catch((error) =>
    reportError({
      type: "mcp-start-failed",
      source: "main",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  installApplicationMenu(process.platform, (id) => {
    if (id === "openLicenses") {
      const dir = app.isPackaged
        ? path.join(process.resourcesPath, "LICENSES")
        : path.join(__dirname, "../../LICENSES");
      void shell.openPath(dir);
      return;
    }
    sendMenuAction(BrowserWindow.getFocusedWindow(), id);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// A second launch (blocked by the single-instance lock) surfaces the running
// window rather than starting a duplicate process.
app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Mark an app-wide quit in progress so the window close guard re-triggers the
// quit after the user confirms (rather than just closing the window).
app.on("before-quit", () => {
  markQuitting();
});

// Terminate any in-flight ffmpeg export jobs and remove their temp files so
// quitting mid-export cannot orphan encoder processes or leave temp WAVs. Run
// at will-quit (after the close guard has resolved) so a cancelled quit does
// not kill exports.
app.on("will-quit", () => {
  disposeAuroraClient();
  cancelAllExports();
  void stopMcpServer();
});
