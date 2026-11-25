import { cleanupTempOnQuit, sweepStaleTemp } from "./temp-dir";
import { warmEncoderProbe } from "./sidecar/encoder-probe";
import { nativeDecodeService } from "./decode/native-decode";
import { app, BrowserWindow, ipcMain, screen, shell, type IpcMainInvokeEvent } from "electron";
import { initialWindowBounds } from "./window-bounds";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { AUDIO_WARM_ARGUMENT } from "../shared/audio-warm";
import { registerAppSchemePrivileges, handleAppScheme, handleAudioWarmScheme, APP_INDEX } from "./protocol";
import { installNavigationGuard } from "./nav-guard";
import { handle } from "./ipc";
import { ProjectLocks } from "./project-lock";
import fsSync from "node:fs";
import { CHANNELS } from "../shared/ipc-contract";
import { collectHardwareInfo } from "./ipc/hardware";
import {
  startExport,
  writeAudioWav,
  writeAudioChunk,
  finishAudio,
  cancelExport,
  cancelAllExports,
  copyExportRun,
  prepareAudioCopy,
} from "./ipc/export";
import {
  cancelAllSegmentExports,
  cancelSegmentExport,
  segmentAudioChunk,
  segmentAudioFinish,
  segmentWorkerFail,
  segmentWorkerInit,
  segmentWorkerNext,
  startSegmentExport,
} from "./ipc/segment-export";
import { encodeDolbyAudio } from "./ipc/dolby-audio";
import {
  cancelAuroraPreviewSession,
  cancelAuroraSequenceSession,
  renderAuroraPreview,
  startAuroraPreviewSession,
  startAuroraSequenceSession,
} from "./ipc/aurora";
import { probeGopTypes, probeSource } from "./sidecar/probe-source";
import { probeAudioSource } from "./sidecar/smart-audio";
import { getKeyStore } from "./ipc/keychain";
import { getPluginFolderStore } from "./ipc/plugins";
import { cloudFetch } from "./ipc/cloud";
import { applyWindowControl, windowIsMaximized } from "./window-controls";
import { registerLinkedCompIpc } from "./linked-comp-windows";
import { registerOnboardingIpc } from "./ipc/onboarding";
import { registerOllamaIpc } from "./ipc/ollama";
import { installMediaPermissionHandlers, registerMicrophoneIpc } from "./ipc/microphone";
import { registerSamplesIpc } from "./ipc/samples";
import { registerFontsIpc } from "./ipc/fonts";
import { registerMcpFilesIpc } from "./ipc/mcp-files";
import { noteOpenProjectFile } from "./mcp/policy";
import { getEditorWindow, registerEditorWindow, setEditorWindowFactory } from "./mcp/editor-window";
import { getMcpClientStatus } from "./mcp/client-tracker";
import { installApplicationMenu, sendMenuAction } from "./app-menu";
import { OpenFileRouter } from "./open-files";
import { attachUnsavedGuard, markQuitting } from "./lifecycle";
import { initAutoUpdater } from "./updater";
import { initCrashReporter, reportError } from "./crash-reporter";
import { migrateGpuCacheOnUpgrade } from "./gpu-cache-migration";
import { applyPerformanceSwitches, consumeGpuFallbackLaunch } from "./gpu/switches";
import {
  startMcpServer,
  stopMcpServer,
  getMcpStatus,
  rotateMcpToken,
  testMcpConnection,
} from "./mcp/server";
import {
  fileWriters,
  sweepPartFiles,
  showSaveDialog,
  showOpenDialog,
  readTextFile,
  readFileBytes,
  writeTextFile,
  revealInFolder,
  tempFilePath,
  releaseTempFile,
} from "./ipc/fs";
import {
  generateProxy,
  transcode,
  extractAudioWav,
  probeAudioStreams,
  developRawStill,
} from "./ipc/media";
import { fetchUrl } from "./ipc/fetch-url";
import { registerIngestIpc, startIngestQueue, stopIngestQueue } from "./ingest/ipc";
import { cancelProjectManagerJobs, registerProjectManagerIpc } from "./project-manager/ipc";
import { registerMediaBrowserIpc } from "./media-browser/ipc";
import { registerWatchFoldersIpc, startWatchFolders, stopWatchFolders } from "./watch/ipc";
import { registerRenderCacheIpc, restoreBundledRenderCache } from "./render-cache/ipc";
import { disposePlughost, registerPlughostIpc } from "./ipc/plughost";
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
  encodeDolbyAudioArgsSchema,
  probeAudioArgsSchema,
  developRawStillArgsSchema,
  fetchUrlArgsSchema,
  nativeProbeArgsSchema,
  nativeFrameArgsSchema,
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
  windowControlArgsSchema,
} from "../shared/ipc-contract";
import type {
  AuroraPreviewSessionStartArgs,
  AuroraRenderPreviewArgs,
  AuroraSequenceSessionStartArgs,
} from "../shared/ipc-contract";

/** Delay before electron-updater is loaded after the window is shown; see showWindow in createWindow. */
const UPDATER_START_DELAY_MS = 5000;

const mark = (label: string): void => {
  const ms = Number(process.hrtime.bigint() / 1_000_000n);
  const cpu = process.cpuUsage();
  // cpu= is this process's own CPU time (user+system): it does not stretch when other processes
  // compete for the cores, so it is the number to compare between builds on a busy machine.
  console.log(
    `[startup] ${label} t=${ms}ms uptime=${Math.round(process.uptime() * 1000)}ms cpu=${Math.round((cpu.user + cpu.system) / 1000)}ms`,
  );
};
mark("module-load");

registerAppSchemePrivileges();

// Must run before app is ready: switches and disableHardwareAcceleration are
// ignored once the GPU process has started.
applyPerformanceSwitches();

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
const projectLocks = new ProjectLocks();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Only the surviving instance uses up a software-rendering fallback launch.
  consumeGpuFallbackLaunch();
}

// Files the OS hands to the app (double-click, Open With, `OpenReel file.srt`, a second launch): held until the
// editor renderer asks for them, then sent straight to it. See open-files.ts.
const openFiles = new OpenFileRouter({
  send: (items) => {
    const win = getEditorWindow();
    if (!win || win.webContents.isLoading()) return false;
    win.webContents.send(CHANNELS.openFilesEvent, items);
    return true;
  },
  show: () => {
    if (app.isReady()) showEditorWindow();
  },
  exists: (filePath) => fsSync.existsSync(filePath),
});
// macOS delivers every document through this event, including the one that launched the app (before `ready`).
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  openFiles.addPaths([filePath]);
});
if (hasSingleInstanceLock) openFiles.addArgv(process.argv, process.cwd(), process.defaultApp);

function rendererRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer")
    : path.join(__dirname, "../../../web/dist");
}

async function logGpuStatus(): Promise<void> {
  try {
    console.log("[gpu] feature status:", JSON.stringify(app.getGPUFeatureStatus()));
    console.log("[gpu] info:", JSON.stringify(await app.getGPUInfo("basic")));
  } catch (error) {
    console.warn("[gpu] status unavailable:", error);
  }
}

/**
 * `hidden` builds the on-demand editor window for MCP (macOS with every window closed): it
 * stays hidden until the user brings the app forward, and is exempt from background throttling
 * so the agent's tool calls are not starved. Throttling stays on for the normal visible window.
 */
function createWindow(options: { hidden?: boolean } = {}): BrowserWindow {
  const hidden = options.hidden === true;
  const isMac = process.platform === "darwin";
  // Open filling the work area of the display under the pointer (not macOS full screen).
  const bounds = initialWindowBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    // Left unset on macOS so the vibrancy material shows through (a "#00000000"
    // colour is only honoured with transparent:true); opaque dark elsewhere.
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
      spellcheck: false,
      v8CacheOptions: "bypassHeatCheck",
      // The editor windows only: the preload starts the audio warm-up frame when it sees this.
      additionalArguments: [AUDIO_WARM_ARGUMENT],
      ...(hidden ? { backgroundThrottling: false } : {}),
    },
  });
  mark("createWindow");
  // Show once the first paint is ready; fall back after 3 s so a missed event
  // can never leave the app invisible.
  let shown = false;
  const showWindow = (): void => {
    if (hidden || shown || win.isDestroyed()) return;
    shown = true;
    clearTimeout(showFallback);
    win.show();
    // Loaded after the editor has booted (packaged builds only; idempotent). Hooked here rather than on
    // ready-to-show alone so the 3 s fallback path also wires the updater. electron-updater is ~12-15 ms of
    // main-thread evaluation, and right after the first paint the main thread is serving the editor's
    // ~55 app:// chunk requests; the update check is not time-critical, so it waits for them.
    setTimeout(initAutoUpdater, UPDATER_START_DELAY_MS);
  };
  const showFallback = setTimeout(showWindow, 3000);
  win.once("ready-to-show", () => {
    mark("ready-to-show");
    showWindow();
    // Off the startup path: the encoder smoke tests spawn ffmpeg, and electron-updater
    // (packaged builds only) is loaded after the first paint instead of at module load.
    warmEncoderProbe();
  });
  win.once("closed", () => clearTimeout(showFallback));
  win.webContents.once("did-finish-load", () => mark("did-finish-load"));
  registerEditorWindow(win);
  win.webContents.on("did-start-loading", () => openFiles.rendererLoading());
  attachUnsavedGuard(win);
  installNavigationGuard(win, APP_INDEX);
  win.loadURL(APP_INDEX);
  return win;
}

/** Brings the editor window forward, un-hiding the on-demand one an agent may have created. */
/** Menu actions that open UI in the editor window rather than act on the focused field. */
const WINDOW_LEVEL_MENU_ACTIONS = new Set(["showWelcomeSetup", "openLessons", "connectAgent"]);

function showEditorWindow(): void {
  const win = getEditorWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  mark("whenReady");
  setEditorWindowFactory(() => createWindow({ hidden: true }));
  // A previous run killed mid-export leaves `openreel-*.part` in the temp folder; they are never a finished file.
  setTimeout(() => void sweepPartFiles(tmpdir(), 60_000, "openreel-").catch(() => undefined), 15_000);
  handleAppScheme(rendererRoot());
  handleAudioWarmScheme();
  // Start the renderer load first: navigation, script fetch and parse run in the
  // renderer process while the IPC handlers below are registered. Handlers only need
  // to exist before the page issues its first invoke, which cannot happen until its
  // scripts have loaded (this callback runs to completion before any IPC is delivered).
  createWindow();
  // Diagnostics only: keep the GPU info query off the window-creation path.
  setTimeout(() => void logGpuStatus(), 1500);
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
  handle(CHANNELS.fsTempFilePath, z.object({ ext: z.string(), persist: z.boolean().optional() }), tempFilePath);
  handle(CHANNELS.fsReleaseTemp, z.object({ path: z.string() }), releaseTempFile);
  const lockOwners = new Set<number>();
  const ownerOf = (event: IpcMainInvokeEvent): string => {
    const id = event.sender.id;
    if (!lockOwners.has(id)) {
      lockOwners.add(id);
      const release = () => void projectLocks.releaseOwner(`${projectLocks.instanceId}:${id}`);
      // A reload (main-frame navigation, not an iframe load or a pushState) throws the open project
      // away; a closed or crashed window takes its locks with it. Registered once per window.
      event.sender.on("did-start-navigation", (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
        if (details.isMainFrame && !details.isSameDocument) release();
      });
      event.sender.on("render-process-gone", release);
      event.sender.once("destroyed", () => {
        lockOwners.delete(id);
        release();
      });
    }
    return `${projectLocks.instanceId}:${id}`;
  };
  handle(CHANNELS.fsLockProject, z.object({ path: z.string().min(1) }), ({ path: p }, event) => {
    // The open project's folder is always readable/writable for MCP path tools.
    noteOpenProjectFile(p);
    // A Project Manager folder brings its render files along: put them where the render cache looks.
    void restoreBundledRenderCache(p).catch(() => undefined);
    return projectLocks.acquire(p, ownerOf(event));
  });
  handle(CHANNELS.fsUnlockProject, z.object({ path: z.string().min(1) }), ({ path: p }, event) => {
    // The project is closed: its folder is no longer an implicit allowed root for agents.
    noteOpenProjectFile(null);
    return projectLocks.release(p, ownerOf(event));
  });
  mark("ipc-fs-registered");
  registerIngestIpc();
  registerProjectManagerIpc();
  registerMediaBrowserIpc();
  registerWatchFoldersIpc();
  registerRenderCacheIpc();
  registerPlughostIpc();
  handle(CHANNELS.mediaGenerateProxy, proxyArgsSchema, generateProxy);
  handle(CHANNELS.mediaTranscode, transcodeArgsSchema, transcode);
  handle(CHANNELS.mediaExtractAudioWav, extractAudioArgsSchema, extractAudioWav);
  handle(CHANNELS.mediaProbeAudioStreams, probeAudioArgsSchema, probeAudioStreams);
  handle(CHANNELS.mediaDevelopRawStill, developRawStillArgsSchema, developRawStill);
  handle(CHANNELS.mediaFetchUrl, fetchUrlArgsSchema, fetchUrl);
  handle(CHANNELS.mediaNativeProbe, nativeProbeArgsSchema, ({ path: p }) => nativeDecodeService().probe(p));
  handle(CHANNELS.mediaNativeFrame, nativeFrameArgsSchema, ({ path: p, time, width, quality, bitDepth }) =>
    nativeDecodeService().getFrame(p, time, { width, quality, bitDepth }),
  );
  handle(CHANNELS.mediaNativeStats, z.undefined(), () => nativeDecodeService().getStats());
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
  handle(CHANNELS.pluginsList, z.undefined(), () => getPluginFolderStore().list());
  handle(
    CHANNELS.pluginsPut,
    z.object({ id: z.string(), files: z.record(z.string()) }),
    ({ id, files }) => getPluginFolderStore().put(id, files),
  );
  handle(CHANNELS.pluginsRemove, z.object({ id: z.string() }), ({ id }) => getPluginFolderStore().remove(id));
  handle(CHANNELS.pluginsRevealFolder, z.undefined(), async () => {
    const root = getPluginFolderStore().root;
    await fsSync.promises.mkdir(root, { recursive: true });
    await shell.openPath(root);
  });
  handle(CHANNELS.cloudFetch, cloudFetchArgsSchema, cloudFetch);
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
  handle(CHANNELS.exportEncodeDolbyAudio, encodeDolbyAudioArgsSchema, encodeDolbyAudio);
  handle(CHANNELS.exportCancel, z.object({ jobId: z.string() }), cancelExport);
  ipcMain.handle(CHANNELS.exportSegmentsStart, (e, raw) => startSegmentExport(e.sender, raw));
  handle(CHANNELS.exportSegmentsCancel, z.object({ sessionId: z.string() }), cancelSegmentExport);
  handle(CHANNELS.exportSegmentsInit, z.object({ sessionId: z.string() }), segmentWorkerInit);
  handle(CHANNELS.exportSegmentsNext, z.object({ sessionId: z.string() }), segmentWorkerNext);
  handle(
    CHANNELS.exportSegmentsAudioChunk,
    z.object({ sessionId: z.string(), chunk: z.instanceof(ArrayBuffer), position: z.number().int().nonnegative() }),
    segmentAudioChunk,
  );
  handle(CHANNELS.exportSegmentsAudioFinish, z.object({ sessionId: z.string() }), segmentAudioFinish);
  handle(CHANNELS.exportSegmentsFail, z.object({ sessionId: z.string(), message: z.string() }), segmentWorkerFail);
  handle(CHANNELS.exportProbeSource, z.object({ path: z.string().min(1) }), ({ path: p }) => probeSource(p));
  handle(
    CHANNELS.exportProbeGopTypes,
    z.object({ path: z.string().min(1), startTime: z.number().nonnegative(), frames: z.number().int().positive().max(1200) }),
    ({ path: p, startTime, frames }) => probeGopTypes(p, startTime, frames),
  );
  handle(CHANNELS.exportProbeAudioSource, z.object({ path: z.string().min(1) }), ({ path: p }) => probeAudioSource(p));
  handle(
    CHANNELS.exportPrepareAudioCopy,
    z.object({
      jobId: z.string(),
      plan: z.object({
        codec: z.enum(["aac", "pcm"]),
        sampleRate: z.number().int().positive(),
        channels: z.number().int().positive(),
        totalSamples: z.number().int().positive(),
        segments: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("encode"), start: z.number().int().nonnegative(), end: z.number().int().positive() }),
              z.object({
                kind: z.literal("copy"),
                start: z.number().int().nonnegative(),
                end: z.number().int().positive(),
                sourcePath: z.string().min(1),
                sourceStart: z.number().int().nonnegative(),
                priming: z.number().int().nonnegative().optional(),
                sourceSize: z.number().int().nonnegative().optional(),
                sourceMtimeMs: z.number().nonnegative().optional(),
                sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
              }),
            ]),
          )
          .min(1)
          .max(20000),
      }),
    }),
    prepareAudioCopy,
  );
  handle(
    CHANNELS.exportCopyRun,
    z.object({
      jobId: z.string(),
      sourcePath: z.string().min(1),
      sourceStart: z.number().nonnegative(),
      outputStartFrame: z.number().int().nonnegative(),
      frames: z.number().int().positive(),
      sourceSize: z.number().int().nonnegative().optional(),
      sourceMtimeMs: z.number().nonnegative().optional(),
      sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    }),
    copyExportRun,
  );
  registerLinkedCompIpc();
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
  registerOnboardingIpc();
  registerOllamaIpc();
  registerMicrophoneIpc();
  installMediaPermissionHandlers();
  registerSamplesIpc();
  registerFontsIpc();
  registerMcpFilesIpc();
  handle(CHANNELS.openFilesTake, z.undefined(), () => openFiles.takePending());
  handle(CHANNELS.mcpGetClientStatus, z.undefined(), () => getMcpClientStatus());
  handle(CHANNELS.mcpGetStatus, z.undefined(), () => getMcpStatus());
  handle(CHANNELS.mcpRotateToken, z.undefined(), () => rotateMcpToken());
  handle(CHANNELS.mcpTestConnection, z.undefined(), () => testMcpConnection());
  // Resume proxy jobs a previous session left queued (low priority, one at a time by default).
  mark("ipc-registered");
  startIngestQueue();
  mark("ingest-queue");
  // Watch folders start a moment after launch so scanning never competes with the first paint.
  setTimeout(() => startWatchFolders(), 1500);
  // Drop temp files left by crashed sessions; never blocks startup.
  void sweepStaleTemp().catch(() => undefined);
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
    const focused = BrowserWindow.getFocusedWindow();
    if (!focused && WINDOW_LEVEL_MENU_ACTIONS.has(id)) {
      // Help > Welcome & Setup / Learn / Connect an Agent open UI in the editor window, so they must work
      // when no window has focus (minimized or hidden window, app activated from the Dock menu).
      showEditorWindow();
      sendMenuAction(getEditorWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null, id);
      return;
    }
    sendMenuAction(focused, id);
  });
  mark("menu-installed");
  app.on("activate", () => showEditorWindow());
});

// A second launch (blocked by the single-instance lock) surfaces the running
// window rather than starting a duplicate process.
app.on("second-instance", (_event, argv, workingDirectory) => {
  // Files named on the second launch's command line go to the running editor.
  const opened = openFiles.addArgv(argv, workingDirectory, process.defaultApp);
  if (opened.length || BrowserWindow.getAllWindows().length === 0) return;
  showEditorWindow();
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
  projectLocks.releaseAllSync(fsSync);
  disposeAuroraClient();
  nativeDecodeService().dispose();
  cancelAllSegmentExports();
  cancelAllExports();
  stopIngestQueue();
  cancelProjectManagerJobs();
  stopWatchFolders();
  disposePlughost();
  cleanupTempOnQuit();
  void stopMcpServer();
});
