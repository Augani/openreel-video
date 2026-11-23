import { app, dialog } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CHANNELS } from "../../shared/channels";
import {
  projectKeySchema,
  renderCacheDeleteArgsSchema,
  renderCacheGetArgsSchema,
  renderCachePutArgsSchema,
  renderCacheProjectArgsSchema,
  renderCacheSetCapArgsSchema,
  renderCacheStatArgsSchema,
  type RenderCacheSettings,
} from "../../shared/render-cache";
import { handle } from "../ipc";
import { withNativeDialog } from "../native-dialog-state";
import { RenderCacheDisk } from "./disk-store";
import {
  freeBytes,
  isAcceptableScratchDir,
  loadRenderCacheSettings,
  probeWritable,
  saveRenderCacheSettings,
  type StoredRenderCacheSettings,
} from "./settings";

/** Electron wiring of the scratch-disk render cache: one settings file in userData, frame files under the scratch folder. */

const STALE_PROJECT_MS = 30 * 24 * 60 * 60 * 1000;
const TRIM_EVERY_MS = 20_000;

let settings: StoredRenderCacheSettings | null = null;
let disk: RenderCacheDisk | null = null;
let activeProject: string | null = null;
let lastTrim = 0;
let trimming: Promise<unknown> | null = null;

function settingsFile(): string {
  return path.join(app.getPath("userData"), "render-cache-settings.json");
}

function defaultScratchDir(): string {
  return path.join(app.getPath("userData"), "render-cache");
}

function current(): StoredRenderCacheSettings {
  if (!settings) settings = loadRenderCacheSettings(settingsFile());
  return settings;
}

function store(): RenderCacheDisk {
  if (!disk) disk = new RenderCacheDisk(current().scratchDir ?? defaultScratchDir());
  return disk;
}

async function view(): Promise<RenderCacheSettings> {
  const s = current();
  const scratchDir = s.scratchDir ?? defaultScratchDir();
  return { scratchDir, isDefault: s.scratchDir === null, capBytes: s.capBytes, freeBytes: await freeBytes(scratchDir) };
}

function maybeTrim(force = false): void {
  const now = Date.now();
  if (trimming || (!force && now - lastTrim < TRIM_EVERY_MS)) return;
  lastTrim = now;
  trimming = store()
    .trim(current().capBytes, activeProject)
    .catch(() => undefined)
    .finally(() => {
      trimming = null;
    });
}

/** The folder holding every project's render files (Project Manager copies a project's folder out of it). */
export function renderCacheRoot(): string {
  return store().root;
}

/**
 * A project folder made by Project Manager carries its render files in `Render Cache/<key>`. Opening that project on a
 * machine (or scratch disk) that does not have them yet puts them where the render cache looks.
 */
export async function restoreBundledRenderCache(projectFilePath: string): Promise<void> {
  const bundled = path.join(path.dirname(projectFilePath), "Render Cache");
  let keys: string[];
  try {
    keys = await fs.readdir(bundled);
  } catch {
    return;
  }
  for (const key of keys) {
    if (!projectKeySchema.safeParse(key).success) continue;
    const target = path.join(store().root, key);
    if (await fs.stat(target).then(() => true, () => false)) continue;
    await fs.mkdir(target, { recursive: true });
    for (const name of await fs.readdir(path.join(bundled, key)).catch(() => [] as string[])) {
      if (/^(f\d{1,9}\.frm|index\.json)$/.test(name)) await fs.copyFile(path.join(bundled, key, name), path.join(target, name)).catch(() => undefined);
    }
  }
}

export function registerRenderCacheIpc(): void {
  handle(CHANNELS.renderCacheGetSettings, renderCacheProjectArgsSchema.partial(), () => view());
  handle(CHANNELS.renderCachePickScratch, renderCacheProjectArgsSchema.partial(), async () => {
    const picked = await withNativeDialog(() =>
      dialog.showOpenDialog({
        title: "Choose the scratch disk folder for render files",
        properties: ["openDirectory", "createDirectory"],
      }),
    );
    const dir = picked.canceled ? undefined : picked.filePaths[0];
    if (!dir) return { changed: false, error: null as string | null, settings: await view() };
    if (!isAcceptableScratchDir(dir)) {
      return { changed: false, error: "Pick a regular folder, not a drive root or your home folder.", settings: await view() };
    }
    if (!(await probeWritable(dir))) {
      return { changed: false, error: "That folder is not writable.", settings: await view() };
    }
    settings = { ...current(), scratchDir: dir };
    saveRenderCacheSettings(settingsFile(), settings);
    disk = new RenderCacheDisk(dir);
    return { changed: true, error: null as string | null, settings: await view() };
  });
  handle(CHANNELS.renderCacheResetScratch, renderCacheProjectArgsSchema.partial(), async () => {
    settings = { ...current(), scratchDir: null };
    saveRenderCacheSettings(settingsFile(), settings);
    disk = new RenderCacheDisk(defaultScratchDir());
    return view();
  });
  handle(CHANNELS.renderCacheSetCap, renderCacheSetCapArgsSchema, async ({ capBytes }) => {
    settings = { ...current(), capBytes };
    saveRenderCacheSettings(settingsFile(), settings);
    maybeTrim(true);
    return view();
  });
  handle(CHANNELS.renderCacheOpen, renderCacheProjectArgsSchema, ({ project }) => {
    activeProject = project;
    // Abandoned projects and anything over the cap go before the open one is used.
    void store()
      .sweepStale(STALE_PROJECT_MS, project)
      .catch(() => undefined)
      .then(() => maybeTrim(true));
    return true;
  });
  handle(CHANNELS.renderCachePut, renderCachePutArgsSchema, async ({ project, key, data }) => {
    await store().put(project, key, data);
    if (key === "__index__") maybeTrim();
    return true;
  });
  handle(CHANNELS.renderCacheGet, renderCacheGetArgsSchema, ({ project, key }) => store().get(project, key));
  handle(CHANNELS.renderCacheDelete, renderCacheDeleteArgsSchema, async ({ project, keys }) => {
    await store().delete(project, keys);
    return true;
  });
  handle(CHANNELS.renderCacheList, renderCacheProjectArgsSchema, ({ project }) => store().list(project));
  handle(CHANNELS.renderCacheClearProject, renderCacheProjectArgsSchema, async ({ project }) => {
    await store().clearProject(project);
    return true;
  });
  handle(CHANNELS.renderCacheClearAll, renderCacheProjectArgsSchema.partial(), async () => {
    await store().clearAll();
    return true;
  });
  // Size and mtime of source media files, folded into the persisted content hashes (a file replaced at the same path).
  handle(CHANNELS.renderCacheStat, renderCacheStatArgsSchema, async ({ paths }) =>
    Promise.all(
      paths.map(async (p) => {
        try {
          const st = await fs.stat(p);
          return st.isFile() ? { size: st.size, mtimeMs: Math.floor(st.mtimeMs) } : null;
        } catch {
          return null;
        }
      }),
    ),
  );
  handle(CHANNELS.renderCacheUsage, renderCacheProjectArgsSchema.partial(), () => store().usage());
}
