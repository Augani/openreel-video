import { contextBridge, ipcRenderer, webUtils } from "electron";
import { CHANNELS } from "../shared/channels";
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
  samples: {
    list: () => ipcRenderer.invoke(CHANNELS.samplesList, undefined),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.samplesGet, { id }),
  },
  probeHardware: () => ipcRenderer.invoke(CHANNELS.probeHardware, undefined),
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
    onCopyProgress: (cb: (event: { requestId: string; progress: number }) => void) => {
      const handler = (_event: unknown, payload: { requestId: string; progress: number }) => cb(payload);
      ipcRenderer.on(CHANNELS.ingestCopyProgress, handler);
      return () => ipcRenderer.removeListener(CHANNELS.ingestCopyProgress, handler);
    },
    pickFolder: (args?: unknown) => ipcRenderer.invoke(CHANNELS.ingestPickFolder, args ?? {}),
    scanFolder: (args: unknown) => ipcRenderer.invoke(CHANNELS.ingestScanFolder, args),
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
      new Promise((resolve) => {
        ipcRenderer.once("openreel:export-port", (event, meta) => {
          const { jobId } = meta as { jobId: string };
          const [port] = event.ports;
          // A live MessagePort cannot survive contextBridge serialization into
          // the main world, so forward it via window.postMessage transfer (the
          // documented Electron path) and resolve with just the jobId.
          window.postMessage({ __openreelExportPort: true, jobId }, "*", [port]);
          resolve({ jobId });
        });
        ipcRenderer.invoke(CHANNELS.exportStart, args);
      }),
    writeAudioWav: (jobId: string, wav: ArrayBuffer) =>
      ipcRenderer.invoke(CHANNELS.exportWriteAudioWav, { jobId, wav }),
    writeAudioChunk: (jobId: string, chunk: ArrayBuffer, position: number) =>
      ipcRenderer.invoke(CHANNELS.exportWriteAudioChunk, { jobId, chunk, position }),
    finishAudio: (jobId: string) => ipcRenderer.invoke(CHANNELS.exportFinishAudio, { jobId }),
    cancel: (jobId: string) => ipcRenderer.invoke(CHANNELS.exportCancel, { jobId }),
    probeSource: (path: string) => ipcRenderer.invoke(CHANNELS.exportProbeSource, { path }),
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
