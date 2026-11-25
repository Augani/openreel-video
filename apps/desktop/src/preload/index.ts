import { contextBridge, ipcRenderer, webUtils } from "electron";
import { CHANNELS } from "../shared/channels";
import { AUDIO_WARM_ARGUMENT } from "../shared/audio-warm";
import { installAudioWarmFrame } from "./audio-warm-frame";
import type { McpBridgeRequest } from "../shared/mcp";

contextBridge.exposeInMainWorld("openreel", {
  platform: "desktop",
  publicOrigin: "https://app.openreel.video",
  // Synchronous so it is known before first render. Anything but `true` (including a failed call) is false.
  automation: ((): boolean => {
    try {
      return ipcRenderer.sendSync(CHANNELS.onboardingAutomation) === true;
    } catch {
      return false;
    }
  })(),
  onboarding: {
    get: () => ipcRenderer.invoke(CHANNELS.onboardingGet, undefined),
    set: (mirror: unknown) => ipcRenderer.invoke(CHANNELS.onboardingSet, mirror),
  },
  ollama: {
    probe: () => ipcRenderer.invoke(CHANNELS.ollamaProbe, undefined),
  },
  microphone: {
    status: () => ipcRenderer.invoke(CHANNELS.microphoneStatus, undefined),
    request: () => ipcRenderer.invoke(CHANNELS.microphoneRequest, undefined),
    openSettings: () => ipcRenderer.invoke(CHANNELS.microphoneOpenSettings, undefined),
  },
  samples: {
    list: () => ipcRenderer.invoke(CHANNELS.samplesList, undefined),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.samplesGet, { id }),
  },
  fonts: {
    brotliDecompress: (data: Uint8Array) => ipcRenderer.invoke(CHANNELS.fontsBrotliDecompress, { data }),
  },
  probeHardware: () => ipcRenderer.invoke(CHANNELS.probeHardware, undefined),
  /** Files the OS opened with the app (projects, caption files): what arrived before the page loaded, and what arrives later. */
  openFiles: {
    take: () => ipcRenderer.invoke(CHANNELS.openFilesTake, undefined),
    onOpen: (cb: (items: Array<{ kind: "project" | "captions"; path: string }>) => void) => {
      const handler = (_event: unknown, items: Array<{ kind: "project" | "captions"; path: string }>) => cb(items);
      ipcRenderer.on(CHANNELS.openFilesEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.openFilesEvent, handler);
    },
  },
  onMenuAction: (cb: (id: string) => void) => {
    const handler = (_event: unknown, id: string) => cb(id);
    ipcRenderer.on("openreel:menu:action", handler);
    return () => ipcRenderer.removeListener("openreel:menu:action", handler);
  },
  fs: {
    showSaveDialog: (opts: unknown) => ipcRenderer.invoke(CHANNELS.fsShowSaveDialog, opts),
    showOpenDialog: (opts: unknown) => ipcRenderer.invoke(CHANNELS.fsShowOpenDialog, opts),
    readFile: (p: string) => ipcRenderer.invoke(CHANNELS.fsReadFile, { path: p }),
    readFileBytes: (p: string) => ipcRenderer.invoke(CHANNELS.fsReadFileBytes, { path: p }),
    tempFilePath: (ext: string, persist?: boolean) =>
      ipcRenderer.invoke(CHANNELS.fsTempFilePath, { ext, persist }),
    releaseTemp: (p: string) => ipcRenderer.invoke(CHANNELS.fsReleaseTemp, { path: p }),
    lockProject: (p: string) => ipcRenderer.invoke(CHANNELS.fsLockProject, { path: p }),
    unlockProject: (p: string) => ipcRenderer.invoke(CHANNELS.fsUnlockProject, { path: p }),
    writeFile: (p: string, data: string) => ipcRenderer.invoke(CHANNELS.fsWriteFile, { path: p, data }),
    openWrite: (p: string) => ipcRenderer.invoke(CHANNELS.fsOpenWrite, { path: p }),
    writeChunk: (handleId: string, data: ArrayBuffer | Uint8Array, position: number) =>
      ipcRenderer.invoke(CHANNELS.fsWriteChunk, { handleId, data, position }),
    closeWrite: (handleId: string) => ipcRenderer.invoke(CHANNELS.fsCloseWrite, { handleId }),
    abortWrite: (handleId: string) => ipcRenderer.invoke(CHANNELS.fsAbortWrite, { handleId }),
    revealInFolder: (p: string) => ipcRenderer.invoke(CHANNELS.fsRevealInFolder, { path: p }),
    pickFiles: (opts?: unknown) => ipcRenderer.invoke(CHANNELS.fsPickFiles, opts),
    pickProject: () => ipcRenderer.invoke(CHANNELS.fsPickProject, undefined),
    // Absolute path of a File the user picked or dropped ("" for a File that is not on disk).
    pathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    },
  },
  ingest: {
    resolveFolders: (args: unknown) => ipcRenderer.invoke(CHANNELS.ingestResolveFolders, args),
    enqueueProxies: (args: unknown) => ipcRenderer.invoke(CHANNELS.ingestProxyEnqueue, args),
    listProxyJobs: (projectId: string) => ipcRenderer.invoke(CHANNELS.ingestProxyList, { projectId }),
    cancelProxyJobs: (ids: string[]) => ipcRenderer.invoke(CHANNELS.ingestProxyCancel, { ids }),
    retryFailedProxyJobs: (projectId: string) => ipcRenderer.invoke(CHANNELS.ingestProxyRetryFailed, { projectId }),
    ackProxyJobs: (ids: string[]) => ipcRenderer.invoke(CHANNELS.ingestProxyAck, { ids }),
    setProxyConcurrency: (concurrency: number) => ipcRenderer.invoke(CHANNELS.ingestProxySetConcurrency, { concurrency }),
    onProxyEvent: (cb: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on(CHANNELS.ingestProxyEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.ingestProxyEvent, handler);
    },
    stat: (paths: string[]) => ipcRenderer.invoke(CHANNELS.ingestStat, { paths }),
    readProxy: (path: string) => ipcRenderer.invoke(CHANNELS.ingestReadProxy, { path }),
    copyToProject: (args: unknown) => ipcRenderer.invoke(CHANNELS.ingestCopyToProject, args),
    enqueueCopies: (args: unknown) => ipcRenderer.invoke(CHANNELS.ingestCopyEnqueue, args),
    onCopyProgress: (cb: (event: { requestId: string; progress: number }) => void) => {
      const handler = (_event: unknown, payload: { requestId: string; progress: number }) => cb(payload);
      ipcRenderer.on(CHANNELS.ingestCopyProgress, handler);
      return () => ipcRenderer.removeListener(CHANNELS.ingestCopyProgress, handler);
    },
    pickFolder: (args?: unknown) => ipcRenderer.invoke(CHANNELS.ingestPickFolder, args ?? {}),
    scanFolder: (args: unknown) => ipcRenderer.invoke(CHANNELS.ingestScanFolder, args),
  },
  projectManager: {
    estimate: (args: unknown) => ipcRenderer.invoke(CHANNELS.projectManagerEstimate, args),
    start: (args: unknown) => ipcRenderer.invoke(CHANNELS.projectManagerStart, args),
    cancel: (jobId: string) => ipcRenderer.invoke(CHANNELS.projectManagerCancel, { jobId }),
    onEvent: (cb: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on(CHANNELS.projectManagerEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.projectManagerEvent, handler);
    },
  },
  mediaBrowser: {
    places: () => ipcRenderer.invoke(CHANNELS.mediaBrowserPlaces, undefined),
    list: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserList, args),
    thumbnail: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserThumbnail, args),
    filmstrip: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserFilmstrip, args),
    preview: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserPreview, args),
    prepareImport: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserPrepareImport, args),
    probeClip: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserProbeClip, args),
    readXmp: (path: string) => ipcRenderer.invoke(CHANNELS.mediaBrowserReadXmp, { path }),
    writeSidecar: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaBrowserWriteSidecar, args),
  },
  plugins: {
    list: () => ipcRenderer.invoke(CHANNELS.pluginsList),
    put: (id: string, files: Record<string, string>) => ipcRenderer.invoke(CHANNELS.pluginsPut, { id, files }),
    remove: (id: string) => ipcRenderer.invoke(CHANNELS.pluginsRemove, { id }),
    revealFolder: () => ipcRenderer.invoke(CHANNELS.pluginsRevealFolder),
  },
  keychain: {
    get: (id: string) => ipcRenderer.invoke(CHANNELS.keychainGet, { id }),
    set: (id: string, value: string) => ipcRenderer.invoke(CHANNELS.keychainSet, { id, value }),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.keychainDelete, { id }),
  },
  export: {
    start: (args: unknown) =>
      new Promise((resolve, reject) => {
        const onPort = (event: Electron.IpcRendererEvent, meta: unknown) => {
          const { jobId, rawYuv420 } = meta as { jobId: string; rawYuv420?: boolean };
          const [port] = event.ports;
          // A live MessagePort cannot survive contextBridge serialization into
          // the main world, so forward it via window.postMessage transfer (the
          // documented Electron path) and resolve with just the jobId.
          window.postMessage({ __openreelExportPort: true, jobId }, "*", [port]);
          resolve({ jobId, ...(rawYuv420 ? { rawYuv420: true } : {}) });
        };
        ipcRenderer.once("openreel:export-port", onPort);
        // A refused start (for example Hardware with Two-pass VBR) rejects here instead of waiting for a port that never arrives.
        ipcRenderer.invoke(CHANNELS.exportStart, args).catch((error: unknown) => {
          ipcRenderer.removeListener("openreel:export-port", onPort);
          reject(error);
        });
      }),
    writeAudioWav: (jobId: string, wav: ArrayBuffer) =>
      ipcRenderer.invoke(CHANNELS.exportWriteAudioWav, { jobId, wav }),
    writeAudioChunk: (jobId: string, chunk: ArrayBuffer, position: number) =>
      ipcRenderer.invoke(CHANNELS.exportWriteAudioChunk, { jobId, chunk, position }),
    finishAudio: (jobId: string) => ipcRenderer.invoke(CHANNELS.exportFinishAudio, { jobId }),
    encodeDolbyAudio: (args: unknown) => ipcRenderer.invoke(CHANNELS.exportEncodeDolbyAudio, args),
    cancel: (jobId: string) => ipcRenderer.invoke(CHANNELS.exportCancel, { jobId }),
    probeSource: (path: string) => ipcRenderer.invoke(CHANNELS.exportProbeSource, { path }),
    probeGopTypes: (path: string, startTime: number, frames: number) =>
      ipcRenderer.invoke(CHANNELS.exportProbeGopTypes, { path, startTime, frames }),
    probeAudioSource: (path: string) => ipcRenderer.invoke(CHANNELS.exportProbeAudioSource, { path }),
    prepareAudioCopy: (jobId: string, plan: unknown) => ipcRenderer.invoke(CHANNELS.exportPrepareAudioCopy, { jobId, plan }),
    copyRun: (jobId: string, run: unknown) =>
      ipcRenderer.invoke(CHANNELS.exportCopyRun, { jobId, ...(run as object) }),
    // Absolute path of a File that came from disk (a picked or dropped file); "" for in-memory blobs.
    pathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    },
  },
  aurora: {
    renderPreview: (args: unknown) => ipcRenderer.invoke(CHANNELS.auroraRenderPreview, args),
    startPreviewSession: (args: unknown) =>
      ipcRenderer.invoke(CHANNELS.auroraStartPreviewSession, args),
    cancelPreviewSession: (sessionId: string) =>
      ipcRenderer.invoke(CHANNELS.auroraCancelPreviewSession, { sessionId }),
    onPreviewEvent: (cb: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on(CHANNELS.auroraPreviewEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.auroraPreviewEvent, handler);
    },
    startSequenceSession: (args: unknown) =>
      ipcRenderer.invoke(CHANNELS.auroraStartSequenceSession, args),
    cancelSequenceSession: (sessionId: string) =>
      ipcRenderer.invoke(CHANNELS.auroraCancelSequenceSession, { sessionId }),
    onSequenceEvent: (cb: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on(CHANNELS.auroraSequenceEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.auroraSequenceEvent, handler);
    },
  },
  cloud: {
    fetch: (
      service: string,
      path: string,
      options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        baseUrl?: string;
      },
    ) => ipcRenderer.invoke(CHANNELS.cloudFetch, { service, path, ...(options ?? {}) }),
  },
  win: {
    minimize: () => ipcRenderer.invoke(CHANNELS.windowControl, { action: "minimize" }),
    toggleMaximize: () => ipcRenderer.invoke(CHANNELS.windowControl, { action: "toggleMaximize" }),
    close: () => ipcRenderer.invoke(CHANNELS.windowControl, { action: "close" }),
    isMaximized: () => ipcRenderer.invoke(CHANNELS.windowIsMaximized),
  },
  media: {
    generateProxy: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaGenerateProxy, args),
    transcode: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaTranscode, args),
    extractAudioWav: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaExtractAudioWav, args),
    probeAudioStreams: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaProbeAudioStreams, args),
    developRawStill: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaDevelopRawStill, args),
    fetchUrl: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaFetchUrl, args),
    nativeProbe: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaNativeProbe, args),
    nativeFrame: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaNativeFrame, args),
    nativeStats: () => ipcRenderer.invoke(CHANNELS.mediaNativeStats, undefined),
  },
  rigging: {
    probeBackend: () => ipcRenderer.invoke(CHANNELS.riggingProbeBackend, undefined),
    rigHumanoidModel: (args: unknown) =>
      ipcRenderer.invoke(CHANNELS.riggingRigHumanoidModel, args),
  },
  updater: {
    // Auto-update status pushed from the main process (checking/available/
    // downloading/downloaded/error). The renderer surfaces an update banner and
    // drives download/install on user consent.
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_event: unknown, status: unknown) => cb(status);
      ipcRenderer.on(CHANNELS.updaterStatus, handler);
      return () => ipcRenderer.removeListener(CHANNELS.updaterStatus, handler);
    },
    download: () => ipcRenderer.invoke(CHANNELS.updaterDownload),
    install: () => ipcRenderer.invoke(CHANNELS.updaterInstall),
  },
  crash: {
    // Fire-and-forget renderer error reporting; the main process attaches app
    // version/platform and forwards to the cloud crash collector.
    report: (payload: { message: string; stack?: string; type?: string; context?: unknown }) =>
      ipcRenderer.send(CHANNELS.crashReport, payload),
  },
  plughost: {
    scan: (force?: boolean) => ipcRenderer.invoke(CHANNELS.plughostScan, force === undefined ? undefined : { force }),
    unblock: (id: string) => ipcRenderer.invoke(CHANNELS.plughostUnblock, { id }),
    render: (args: unknown) => ipcRenderer.invoke(CHANNELS.plughostRender, args),
    cancel: (jobId: string) => ipcRenderer.invoke(CHANNELS.plughostCancel, { jobId }),
    describe: (pluginId: string, state?: string) => ipcRenderer.invoke(CHANNELS.plughostDescribe, { pluginId, state }),
    openUi: (args: unknown) => ipcRenderer.invoke(CHANNELS.plughostUiOpen, args),
    closeUi: (sessionId: string) => ipcRenderer.invoke(CHANNELS.plughostUiClose, { sessionId }),
    liveOpen: (args: unknown) => ipcRenderer.invoke(CHANNELS.plughostLiveOpen, args),
    liveSet: (sessionId: string, effectId: string, values?: Record<string, number>, automation?: Record<string, Array<readonly [number, number]>>) => ipcRenderer.invoke(CHANNELS.plughostLiveSet, { sessionId, effectId, ...(values ? { values } : {}), ...(automation ? { automation } : {}) }),
    liveClose: (sessionId: string) => ipcRenderer.invoke(CHANNELS.plughostLiveClose, { sessionId }),
    liveStats: (sessionId: string) => ipcRenderer.invoke(CHANNELS.plughostLiveStats, { sessionId }),
    onProgress: (cb: (event: { jobId: string; fraction: number }) => void) => {
      const handler = (_event: unknown, payload: { jobId: string; fraction: number }) => cb(payload);
      ipcRenderer.on(CHANNELS.plughostProgress, handler);
      return () => ipcRenderer.removeListener(CHANNELS.plughostProgress, handler);
    },
    onScanProgress: (cb: (event: { done: number; total: number }) => void) => {
      const handler = (_event: unknown, payload: { done: number; total: number }) => cb(payload);
      ipcRenderer.on(CHANNELS.plughostScanProgress, handler);
      return () => ipcRenderer.removeListener(CHANNELS.plughostScanProgress, handler);
    },
    onUiEvent: (cb: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on(CHANNELS.plughostUiEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.plughostUiEvent, handler);
    },
  },
  renderCache: {
    getSettings: () => ipcRenderer.invoke(CHANNELS.renderCacheGetSettings, undefined),
    pickScratch: () => ipcRenderer.invoke(CHANNELS.renderCachePickScratch, undefined),
    resetScratch: () => ipcRenderer.invoke(CHANNELS.renderCacheResetScratch, undefined),
    setCap: (capBytes: number) => ipcRenderer.invoke(CHANNELS.renderCacheSetCap, { capBytes }),
    open: (project: string) => ipcRenderer.invoke(CHANNELS.renderCacheOpen, { project }),
    put: (project: string, key: string, data: ArrayBuffer) =>
      ipcRenderer.invoke(CHANNELS.renderCachePut, { project, key, data: new Uint8Array(data) }),
    get: (project: string, key: string) => ipcRenderer.invoke(CHANNELS.renderCacheGet, { project, key }),
    delete: (project: string, keys: string[]) => ipcRenderer.invoke(CHANNELS.renderCacheDelete, { project, keys }),
    list: (project: string) => ipcRenderer.invoke(CHANNELS.renderCacheList, { project }),
    clearProject: (project: string) => ipcRenderer.invoke(CHANNELS.renderCacheClearProject, { project }),
    clearAll: () => ipcRenderer.invoke(CHANNELS.renderCacheClearAll, undefined),
    usage: () => ipcRenderer.invoke(CHANNELS.renderCacheUsage, undefined),
    stat: (paths: string[]) => ipcRenderer.invoke(CHANNELS.renderCacheStat, { paths }),
  },
  watchFolders: {
    list: () => ipcRenderer.invoke(CHANNELS.watchFoldersList, undefined),
    add: (kind: "ingest" | "export") => ipcRenderer.invoke(CHANNELS.watchFoldersAdd, { kind }),
    update: (id: string, patch: unknown) => ipcRenderer.invoke(CHANNELS.watchFoldersUpdate, { id, patch }),
    pickOutput: (id: string) => ipcRenderer.invoke(CHANNELS.watchFoldersPickOutput, { id }),
    remove: (id: string) => ipcRenderer.invoke(CHANNELS.watchFoldersRemove, { id }),
    retry: (itemId: string) => ipcRenderer.invoke(CHANNELS.watchFoldersRetry, { itemId }),
    clearFinished: () => ipcRenderer.invoke(CHANNELS.watchFoldersClearFinished, undefined),
    onChange: (cb: (snapshot: unknown) => void) => {
      const handler = (_event: unknown, snapshot: unknown) => cb(snapshot);
      ipcRenderer.on(CHANNELS.watchFoldersEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.watchFoldersEvent, handler);
    },
  },
  mcp: {
    // The main-process MCP server pushes tool-call / list-tool requests here; the
    // renderer runs them against the live editor and replies on the result
    // channel, correlated by callId so concurrent calls don't cross-wire.
    onRequest: (
      handler: (
        req: McpBridgeRequest,
      ) => Promise<{ ok: boolean; result?: unknown; error?: string }>,
    ) => {
      const listener = (_event: unknown, req: McpBridgeRequest) => {
        void Promise.resolve()
          .then(() => handler(req))
          .then((res) =>
            ipcRenderer.send(CHANNELS.mcpResponse, { callId: req.callId, ...res }),
          )
          .catch((error) =>
            ipcRenderer.send(CHANNELS.mcpResponse, {
              callId: req.callId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      };
      ipcRenderer.on(CHANNELS.mcpRequest, listener);
      // Main queues requests until a listener exists: IPC sent to a page that has not
      // installed one yet is silently dropped, which turned early MCP calls into timeouts.
      ipcRenderer.send(CHANNELS.mcpReady);
      return () => ipcRenderer.removeListener(CHANNELS.mcpRequest, listener);
    },
    getStatus: () => ipcRenderer.invoke(CHANNELS.mcpGetStatus, undefined),
    rotateToken: () => ipcRenderer.invoke(CHANNELS.mcpRotateToken, undefined),
    testConnection: () => ipcRenderer.invoke(CHANNELS.mcpTestConnection, undefined),
    getClientStatus: () => ipcRenderer.invoke(CHANNELS.mcpGetClientStatus, undefined),
    getPolicy: () => ipcRenderer.invoke(CHANNELS.mcpGetPolicy, undefined),
    setPolicy: (policy: { allowedRoots: string[] }) => ipcRenderer.invoke(CHANNELS.mcpSetPolicy, policy),
    // Path tools (WP-E): the allowed-roots check and the export placement run in main.
    resolveFiles: (args: unknown) => ipcRenderer.invoke(CHANNELS.mcpFilesResolve, args),
    placeOutput: (args: unknown) => ipcRenderer.invoke(CHANNELS.mcpFilesPlaceOutput, args),
    getAppInfo: () => ipcRenderer.invoke(CHANNELS.mcpAppInfo, undefined),
  },
  // Linked composition windows: the editor opens them, and edits flow over IPC to the
  // editor's stores. The main process only relays validated messages between the two.
  /**
   * Parallel segment export. The editor window starts a session and listens for its events; the hidden worker
   * windows it opens (see main/ipc/segment-export.ts) take segments, write the one audio track and report failures.
   */
  exportSegments: {
    start: (args: unknown) => ipcRenderer.invoke(CHANNELS.exportSegmentsStart, args),
    cancel: (sessionId: string) => ipcRenderer.invoke(CHANNELS.exportSegmentsCancel, { sessionId }),
    init: (sessionId: string) => ipcRenderer.invoke(CHANNELS.exportSegmentsInit, { sessionId }),
    next: (sessionId: string) => ipcRenderer.invoke(CHANNELS.exportSegmentsNext, { sessionId }),
    writeAudioChunk: (sessionId: string, chunk: ArrayBuffer, position: number) =>
      ipcRenderer.invoke(CHANNELS.exportSegmentsAudioChunk, { sessionId, chunk, position }),
    finishAudio: (sessionId: string) => ipcRenderer.invoke(CHANNELS.exportSegmentsAudioFinish, { sessionId }),
    fail: (sessionId: string, message: string) => ipcRenderer.invoke(CHANNELS.exportSegmentsFail, { sessionId, message }),
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on(CHANNELS.exportSegmentsEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.exportSegmentsEvent, handler);
    },
  },
  linkedComp: {
    open: (compositionId: string) => ipcRenderer.invoke(CHANNELS.linkedCompOpen, { compositionId }),
    post: (message: unknown) => ipcRenderer.send(CHANNELS.linkedCompPost, message),
    onMessage: (cb: (message: unknown) => void) => {
      const handler = (_event: unknown, message: unknown) => cb(message);
      ipcRenderer.on(CHANNELS.linkedCompMessage, handler);
      return () => ipcRenderer.removeListener(CHANNELS.linkedCompMessage, handler);
    },
  },
  lifecycle: {
    // The main process asks (on window close / quit) whether there are unsaved
    // changes; the renderer answers synchronously from its dirty state.
    onQueryUnsaved: (handler: () => boolean) => {
      const listener = () => {
        let dirty = false;
        try {
          dirty = handler();
        } catch (error) {
          console.error("[lifecycle] unsaved query failed:", error);
        }
        ipcRenderer.send(CHANNELS.lifecycleUnsavedReply, dirty);
      };
      ipcRenderer.on(CHANNELS.lifecycleUnsavedQuery, listener);
      return () => ipcRenderer.removeListener(CHANNELS.lifecycleUnsavedQuery, listener);
    },
    // The main process asks the renderer to persist pending changes before the
    // window closes; the renderer flushes and reports whether it succeeded so
    // main can keep the window open on failure rather than dropping the edits.
    onFlush: (handler: () => Promise<void>) => {
      const listener = () => {
        void Promise.resolve()
          .then(handler)
          .then(() => ipcRenderer.send(CHANNELS.lifecycleFlushed, true))
          .catch((error) => {
            console.error("[lifecycle] flush failed:", error);
            ipcRenderer.send(CHANNELS.lifecycleFlushed, false);
          });
      };
      ipcRenderer.on(CHANNELS.lifecycleFlush, listener);
      return () => ipcRenderer.removeListener(CHANNELS.lifecycleFlush, listener);
    },
  },
});

// Editor windows only (see createWindow): warm the audio service in a throw-away frame process.
installAudioWarmFrame(document as never, process.argv, AUDIO_WARM_ARGUMENT);

// A live plugin insert's MessagePort comes from the main process with the insert's session id. contextBridge cannot carry ports,
// so it is handed to the page with window.postMessage (the documented route); the page transfers it into its AudioWorklet.
ipcRenderer.on(CHANNELS.plughostLivePort, (event, payload: { sessionId?: unknown }) => {
  if (typeof payload?.sessionId !== "string") return;
  window.postMessage({ type: "openreel:plughost-live-port", sessionId: payload.sessionId }, "*", [...event.ports]);
});
