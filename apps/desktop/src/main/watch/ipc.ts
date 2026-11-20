import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels";
import {
  WATCH_EXPORT_PRESET_IDS,
  WATCH_FOLDER_KINDS,
  watchFolderAddArgsSchema,
  watchFolderIdArgsSchema,
  watchFolderUpdateArgsSchema,
  watchItemIdArgsSchema,
  type WatchFolderConfig,
  type WatchFoldersSnapshot,
} from "../../shared/watch-folders";
import { handle } from "../ipc";
import { withNativeDialog } from "../native-dialog-state";
import { getMcpPolicyStore } from "../mcp/policy";
import { createWatchFolderToolCaller } from "../mcp/renderer-bridge";
import { probeMediaFile } from "../ingest/probe-media";
import { resolveFfmpegPath } from "../sidecar/ffmpeg-path";
import { getBestH264Encoder, isHardwareEncoder } from "../sidecar/encoder-probe";
import { ingestIntoOpenProject, renderProjectViaEditor } from "./editor-handlers";
import { Ledger, createFileLedgerStore } from "./ledger";
import { WatchFolderManager, type ConfigStore, type ManagerOptions } from "./manager";
import { isWatchPresetId, renderMediaFile } from "./render";

/** Electron wiring of the watch folders: persisted config and ledger in userData, IPC for the settings UI. */

const configSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(WATCH_FOLDER_KINDS),
  path: z.string().min(1),
  paused: z.boolean().default(false),
  bin: z.string().default(""),
  createProxies: z.boolean().default(false),
  presetId: z.enum(WATCH_EXPORT_PRESET_IDS).default("1080p-high"),
  outputDir: z.string().default(""),
  includeProjects: z.boolean().default(false),
  baselined: z.boolean().default(false),
  processExisting: z.boolean().default(false),
});

export function createFileConfigStore(file: string): ConfigStore {
  return {
    load(): WatchFolderConfig[] {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: number; folders?: unknown };
        if (parsed.version !== 1 || !Array.isArray(parsed.folders)) return [];
        const out: WatchFolderConfig[] = [];
        for (const entry of parsed.folders) {
          const folder = configSchema.safeParse(entry);
          if (!folder.success || !path.isAbsolute(folder.data.path)) continue;
          if (folder.data.kind === "export" && !path.isAbsolute(folder.data.outputDir)) {
            folder.data.outputDir = path.join(folder.data.path, "output");
          }
          out.push(folder.data);
        }
        return out;
      } catch {
        return [];
      }
    },
    save(folders) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, folders }, null, 2));
        fs.renameSync(tmp, file);
      } catch {
        // A read-only profile only loses the list across restarts.
      }
    },
  };
}

let manager: WatchFolderManager | null = null;
let ledger: Ledger | null = null;

function broadcast(snapshot: WatchFoldersSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.watchFoldersEvent, snapshot);
  }
}

/** Test and e2e override for how long files must be stable (ms), so the suites do not wait seconds. */
function optionsFromEnv(): Partial<ManagerOptions> {
  const settle = Number(process.env.OPENREEL_WATCH_SETTLE_MS);
  if (app.isPackaged || !Number.isFinite(settle) || settle <= 0) return {};
  return { retryWaitMs: 1000, scanner: { settleMs: settle, pollMs: Math.max(50, Math.floor(settle / 3)), rescanMs: 1000, debounceMs: 100 } };
}

function getManager(): WatchFolderManager {
  if (manager) return manager;
  const userData = app.getPath("userData");
  ledger = new Ledger(createFileLedgerStore(path.join(userData, "watch-folders-ledger.json")));
  const caller = createWatchFolderToolCaller();
  manager = new WatchFolderManager({
    configStore: createFileConfigStore(path.join(userData, "watch-folders.json")),
    ledger,
    emit: broadcast,
    onRoots: (roots) => getMcpPolicyStore().setWatchRoots(roots),
    options: optionsFromEnv(),
    handlers: {
      ingest: (context) => ingestIntoOpenProject(caller, context),
      renderMedia: ({ folder, file, onProgress, signal }) => {
        if (!isWatchPresetId(folder.presetId)) return Promise.reject(new Error(`Unknown export preset "${folder.presetId}".`));
        return renderMediaFile(
          { src: file.path, presetId: folder.presetId, outputDir: folder.outputDir, onProgress, signal },
          {
            ffmpegPath: resolveFfmpegPath,
            probe: async (src) => {
              const probe = await probeMediaFile(src, signal);
              if (!probe) throw new Error("ffmpeg could not read this file.");
              return probe;
            },
            videoEncoder: () => getBestH264Encoder(),
            isHardwareEncoder,
          },
        ).then((outputPath) => ({ outputPath }));
      },
      renderProject: (context) => renderProjectViaEditor(caller, context),
    },
  });
  return manager;
}

/** Starts the watchers. Called shortly after launch (off the cold-start path). Safe to call twice. */
export function startWatchFolders(): void {
  getManager().start();
}

/** Quit: stop watching, abort running renders and flush the duplicate ledger. */
export function stopWatchFolders(): void {
  manager?.stop();
  manager = null;
  ledger = null;
}

/** Test hook. */
export function watchFolderManagerForTests(): WatchFolderManager {
  return getManager();
}

async function pickFolder(event: IpcMainInvokeEvent, title: string): Promise<string | null> {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined;
  const options = { title, properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
  const res = await withNativeDialog(() => (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)));
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

export function registerWatchFoldersIpc(): void {
  handle(CHANNELS.watchFoldersList, z.undefined(), () => getManager().snapshot());
  // The folder path only ever comes from the native dialog, never from the renderer: a compromised page
  // cannot point a watch folder (which widens the file access of the import tools) at an arbitrary place.
  handle(CHANNELS.watchFoldersAdd, watchFolderAddArgsSchema, async ({ kind }, event) => {
    const picked = await pickFolder(event, kind === "ingest" ? "Choose a folder to import media from" : "Choose a folder to render files from");
    if (!picked) return { added: false as const };
    const config = await getManager().add(kind, picked);
    return { added: true as const, id: config.id };
  });
  handle(CHANNELS.watchFoldersUpdate, watchFolderUpdateArgsSchema, async ({ id, patch }) => {
    await getManager().update(id, patch);
  });
  handle(CHANNELS.watchFoldersPickOutput, watchFolderIdArgsSchema, async ({ id }, event) => {
    const picked = await pickFolder(event, "Choose where rendered files go");
    if (!picked) return { changed: false as const };
    await getManager().setOutputDir(id, picked);
    return { changed: true as const };
  });
  handle(CHANNELS.watchFoldersRemove, watchFolderIdArgsSchema, ({ id }) => getManager().remove(id));
  handle(CHANNELS.watchFoldersRetry, watchItemIdArgsSchema, ({ itemId }) => getManager().retry(itemId));
  handle(CHANNELS.watchFoldersClearFinished, z.undefined(), () => getManager().clearFinished());
}
