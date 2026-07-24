import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../shared/channels";
import type { McpBridgeRequest } from "../shared/mcp";

contextBridge.exposeInMainWorld("openreel", {
  platform: "desktop",
  publicOrigin: "https://app.openreel.video",
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
    tempFilePath: (ext: string) => ipcRenderer.invoke(CHANNELS.fsTempFilePath, { ext }),
    writeFile: (p: string, data: string) => ipcRenderer.invoke(CHANNELS.fsWriteFile, { path: p, data }),
    openWrite: (p: string) => ipcRenderer.invoke(CHANNELS.fsOpenWrite, { path: p }),
    writeChunk: (handleId: string, data: ArrayBuffer | Uint8Array, position: number) =>
      ipcRenderer.invoke(CHANNELS.fsWriteChunk, { handleId, data, position }),
    closeWrite: (handleId: string) => ipcRenderer.invoke(CHANNELS.fsCloseWrite, { handleId }),
    abortWrite: (handleId: string) => ipcRenderer.invoke(CHANNELS.fsAbortWrite, { handleId }),
    revealInFolder: (p: string) => ipcRenderer.invoke(CHANNELS.fsRevealInFolder, { path: p }),
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
      options?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => ipcRenderer.invoke(CHANNELS.cloudFetch, { service, path, ...(options ?? {}) }),
  },
  gpu: {
    uploadMedia: (args: unknown) => ipcRenderer.invoke(CHANNELS.gpuUploadMedia, args),
    uploadExport: (args: unknown) => ipcRenderer.invoke(CHANNELS.gpuUploadExport, args),
    submitJob: (args: unknown) => ipcRenderer.invoke(CHANNELS.gpuSubmitJob, args),
    jobStatus: (jobID: string) => ipcRenderer.invoke(CHANNELS.gpuJobStatus, { jobID }),
    fetchManifest: (jobID: string) => ipcRenderer.invoke(CHANNELS.gpuFetchManifest, { jobID }),
    downloadArtifact: (jobID: string, relativePath: string) =>
      ipcRenderer.invoke(CHANNELS.gpuDownloadArtifact, { jobID, relativePath }),
    cancelJob: (jobID: string) => ipcRenderer.invoke(CHANNELS.gpuCancelJob, { jobID }),
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
    fetchUrl: (args: unknown) => ipcRenderer.invoke(CHANNELS.mediaFetchUrl, args),
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
      return () => ipcRenderer.removeListener(CHANNELS.mcpRequest, listener);
    },
    getStatus: () => ipcRenderer.invoke(CHANNELS.mcpGetStatus, undefined),
    rotateToken: () => ipcRenderer.invoke(CHANNELS.mcpRotateToken, undefined),
    testConnection: () => ipcRenderer.invoke(CHANNELS.mcpTestConnection, undefined),
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
