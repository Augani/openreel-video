import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import { readFileSync, writeFileSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { desktopProxyFileName } from "../../../../../packages/core/src/media/desktop-ingest";
import { CHANNELS } from "../../shared/channels";
import {
  ingestCopyEnqueueArgsSchema,
  ingestCopyToProjectArgsSchema,
  ingestPickFolderArgsSchema,
  ingestProxyEnqueueArgsSchema,
  ingestProxyIdsArgsSchema,
  ingestProxyListArgsSchema,
  ingestProxySetConcurrencyArgsSchema,
  ingestReadProxyArgsSchema,
  ingestResolveFoldersArgsSchema,
  ingestScanFolderArgsSchema,
  ingestStatArgsSchema,
} from "../../shared/ipc-contract";
import { handle } from "../ipc";
import { withNativeDialog } from "../native-dialog-state";
import { copyIntoFolder } from "./copy-ingest";
import { copyJobFollowUpInput } from "./follow-up";
import { isReadableProxyPath, proxyOutDir, resolveIngestFolders } from "./folders";
import { probeMediaFile } from "./probe-media";
import { ProxyQueue, kindOfJob, type ProxyJob, type ProxyQueueStore } from "./proxy-queue";
import { runProxyJob } from "./proxy-runner";
import { runCopyJob } from "./copy-runner";
import { scanFolderForMedia } from "./relink-scan";

type IngestProject = z.infer<typeof ingestResolveFoldersArgsSchema>;

function queueFile(): string {
  return path.join(app.getPath("userData"), "proxy-queue.json");
}

/** Persists the queue as one small JSON file next to the app's other state. */
function createFileStore(): ProxyQueueStore {
  return {
    load(): ProxyJob[] {
      try {
        const parsed = JSON.parse(readFileSync(queueFile(), "utf8")) as { version?: number; jobs?: unknown };
        return parsed.version === 1 && Array.isArray(parsed.jobs) ? (parsed.jobs as ProxyJob[]) : [];
      } catch {
        return [];
      }
    },
    save(jobs): void {
      try {
        mkdirSync(path.dirname(queueFile()), { recursive: true });
        // Written in place: the file is tiny and only this process writes it.
        writeFileSync(queueFile(), JSON.stringify({ version: 1, jobs }));
      } catch {
        // A read-only profile only loses resume-after-restart.
      }
    },
  };
}

let queue: ProxyQueue | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function getQueue(): ProxyQueue {
  if (queue) return queue;
  const created: ProxyQueue = new ProxyQueue({
    store: createFileStore(),
    emit: (event) => broadcast(CHANNELS.ingestProxyEvent, event),
    run: (job, onProgress, signal) => (kindOfJob(job) === "copy" ? runCopyJob(job, onProgress, signal) : runProxyJob(job, onProgress, signal, created.getConcurrency())),
    // "Copy and create proxies": the proxy job is queued here, in the main process, so it survives a restart
    // and runs even when the window that asked for it has been closed.
    onDone: (job) => {
      const next = copyJobFollowUpInput(job);
      if (next) created.enqueue([next], { force: true });
    },
  });
  queue = created;
  created.restore();
  return created;
}

/** Start the queue at launch so jobs interrupted by a quit resume without waiting for a project to open. */
export function startIngestQueue(): void {
  getQueue();
}

/** Quit: stop ffmpeg and keep interrupted jobs on disk for the next launch. */
export function stopIngestQueue(): void {
  queue?.shutdown();
}

/** Test hook: the live queue. */
export function ingestQueueForTests(): ProxyQueue {
  return getQueue();
}

function foldersFor(args: IngestProject): ReturnType<typeof resolveIngestFolders> {
  return resolveIngestFolders({
    projectPath: args.projectPath,
    projectId: args.projectId,
    config: args.config,
    userDataDir: app.getPath("userData"),
  });
}

async function readProxy(args: { path: string }): Promise<ArrayBuffer> {
  // A project file is untrusted: only video containers are read back through this channel.
  if (!isReadableProxyPath(path.basename(args.path))) throw new Error("Not a video file.");
  const buf = await fs.readFile(args.path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let copyChain: Promise<unknown> = Promise.resolve();

export function registerIngestIpc(): void {
  handle(CHANNELS.ingestResolveFolders, ingestResolveFoldersArgsSchema, (args) => foldersFor(args));

  handle(CHANNELS.ingestProxyEnqueue, ingestProxyEnqueueArgsSchema, (args) => {
    const folders = foldersFor(args);
    const q = getQueue();
    if (args.config?.concurrency) q.setConcurrency(args.config.concurrency);
    return q.enqueue(
      args.items.map((item) => ({
        projectKey: args.projectId,
        mediaId: item.mediaId,
        name: item.name,
        srcPath: item.srcPath,
        outDir: proxyOutDir(item.profile, folders.proxyDir, item.srcPath, folders.projectDir),
        fileName: desktopProxyFileName({ id: item.mediaId, name: item.name }, item.profile),
        profile: item.profile,
        previewTwin: item.previewTwin,
      })),
      { force: args.force },
    );
  });
  handle(CHANNELS.ingestCopyEnqueue, ingestCopyEnqueueArgsSchema, (args) => {
    const folders = foldersFor(args);
    if (!folders.projectSaved) throw new Error("Save the project first so its Media folder has a home.");
    const algorithm = args.algorithm ?? "sha256";
    return getQueue().enqueue(
      args.items.map((item) => ({
        kind: "copy" as const,
        projectKey: args.projectId,
        mediaId: item.mediaId,
        name: item.name,
        srcPath: item.srcPath,
        outDir: folders.mediaDir,
        fileName: item.name,
        profile: args.thenProxies?.profile ?? args.config?.proxyProfile ?? { codec: "h264" as const, size: "half" as const },
        previewTwin: args.thenProxies?.previewTwin ?? false,
        copy: { algorithm, ...(args.thenProxies ? { followUp: { profile: args.thenProxies.profile, previewTwin: args.thenProxies.previewTwin, proxyDir: folders.proxyDir } } : {}) },
      })),
    );
  });
  handle(CHANNELS.ingestProxyList, ingestProxyListArgsSchema, ({ projectId }) => getQueue().list(projectId));
  handle(CHANNELS.ingestProxyCancel, ingestProxyIdsArgsSchema, ({ ids }) => getQueue().cancel(ids));
  handle(CHANNELS.ingestProxyRetryFailed, ingestProxyListArgsSchema, ({ projectId }) => getQueue().retryFailed(projectId));
  handle(CHANNELS.ingestProxyAck, ingestProxyIdsArgsSchema, ({ ids }) => getQueue().acknowledge(ids));
  handle(CHANNELS.ingestProxySetConcurrency, ingestProxySetConcurrencyArgsSchema, ({ concurrency }) => getQueue().setConcurrency(concurrency));

  handle(CHANNELS.ingestStat, ingestStatArgsSchema, async ({ paths }) => {
    const out: Record<string, { exists: boolean; size: number }> = {};
    await Promise.all(
      paths.map(async (p) => {
        const stat = await fs.stat(p).catch(() => null);
        out[p] = { exists: Boolean(stat?.isFile()), size: stat?.size ?? 0 };
      }),
    );
    return out;
  });
  handle(CHANNELS.ingestReadProxy, ingestReadProxyArgsSchema, readProxy);

  handle(CHANNELS.ingestCopyToProject, ingestCopyToProjectArgsSchema, (args, event) => {
    const folders = foldersFor(args);
    if (!folders.projectSaved) throw new Error("Save the project first so its Media folder has a home.");
    // Copies run one at a time: a second disk-to-disk stream only slows the first.
    const run = copyChain.then(() =>
      copyIntoFolder({
        srcPath: args.srcPath,
        destDir: folders.mediaDir,
        algorithm: args.algorithm ?? args.config?.checksum,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.ingestCopyProgress, { requestId: args.requestId, progress });
        },
      }),
    );
    copyChain = run.catch(() => undefined);
    return run;
  });

  handle(CHANNELS.ingestPickFolder, ingestPickFolderArgsSchema, async (args, event: IpcMainInvokeEvent) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const options = { title: args.title, defaultPath: args.defaultPath, properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const res = await withNativeDialog(() => (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)));
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  handle(CHANNELS.ingestScanFolder, ingestScanFolderArgsSchema, (args) =>
    scanFolderForMedia({ root: args.root, names: args.names, mode: args.mode, proxyPattern: args.proxyPattern, probe: probeMediaFile }),
  );
}
