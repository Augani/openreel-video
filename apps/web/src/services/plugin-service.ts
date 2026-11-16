/**
 * Effect plugin installation for the editor.
 *
 * Web: plugins live in IndexedDB. Desktop: the main process keeps them in the
 * user-data `plugins` folder (Effects > Manage Plugins). Either way the
 * renderer-side registry is the single lookup that preview and export render
 * from, and every package is validated here (and again by the desktop main
 * process before it touches disk).
 */

import {
  IndexedDbPluginStore,
  getPluginHost,
  getPluginRegistry,
  parsePluginArchive,
  parsePluginPackage,
  pluginToFiles,
  type LoadedPlugin,
  type PluginStore,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

export type PluginInstallResult =
  | { ok: true; plugin: LoadedPlugin; warnings: string[]; replaced: string | null }
  | { ok: false; errors: string[] };

class DesktopPluginStore implements PluginStore {
  private get api() {
    const api = window.openreel?.plugins;
    if (!api) throw new Error("Desktop plugin storage is unavailable");
    return api;
  }

  async list(): Promise<LoadedPlugin[]> {
    const rows = await this.api.list();
    const out: LoadedPlugin[] = [];
    for (const files of rows) {
      const parsed = parsePluginPackage(new Map(Object.entries(files)));
      if (parsed.ok) out.push(parsed.plugin);
    }
    return out;
  }

  async put(plugin: LoadedPlugin): Promise<void> {
    await this.api.put(plugin.manifest.id, pluginToFiles(plugin));
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
  }
}

export function isDesktopPluginStorage(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop" && !!window.openreel.plugins;
}

let initPromise: Promise<void> | null = null;

/** Hydrate the shared registry from persistent storage (idempotent). */
export function initPluginRegistry(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const registry = getPluginRegistry();
      if (isDesktopPluginStorage()) registry.setStore(new DesktopPluginStore());
      else if (typeof indexedDB !== "undefined") registry.setStore(new IndexedDbPluginStore());
      // A storage backend that never answers (private browsing) must not block installs or the editor.
      await Promise.race([registry.hydrate(), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
      // Projects opened before the plugins finished loading render their plugin effects now.
      refreshPluginEffectsInProject();
    })().catch((error) => {
      initPromise = null;
      console.warn("[plugins] could not load installed plugins:", error);
    });
  }
  return initPromise;
}

/** Name used in file inputs and drag and drop. */
export const PLUGIN_FILE_ACCEPT = ".orplugin,.zip,application/zip";

const readText = (file: File): Promise<string> => file.text();

/**
 * Parse files chosen by the user: one `.orplugin`/`.zip` archive, or the loose
 * files / a folder of a plugin (plugin.json next to its shader and cpu files).
 */
export async function readPluginFiles(files: readonly File[]): Promise<PluginInstallResult> {
  if (files.length === 0) return { ok: false, errors: ["No file was chosen"] };
  const archive = files.length === 1 && /\.(orplugin|zip)$/i.test(files[0].name) ? files[0] : null;
  const parsed = archive
    ? await parsePluginArchive(new Uint8Array(await archive.arrayBuffer()))
    : parsePluginPackage(await collectLooseFiles(files));
  if (!parsed.ok) return { ok: false, errors: [...parsed.errors] };
  return { ok: true, plugin: parsed.plugin, warnings: [...parsed.warnings], replaced: null };
}

async function collectLooseFiles(files: readonly File[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const file of files) {
    // A picked folder prefixes every path with the folder name; package.ts strips one shared root.
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    map.set(rel, await readText(file));
  }
  return map;
}

/**
 * Install (or upgrade) a plugin. A WGSL compile error rejects a shader-only
 * plugin; with a CPU fallback it installs and the error is reported as a warning.
 */
export async function installPlugin(plugin: LoadedPlugin): Promise<PluginInstallResult> {
  // The manager can open before the editor has started (desktop menu on the welcome screen): make sure
  // the persistent store is attached first, otherwise the install would not survive a restart.
  await initPluginRegistry();
  const registry = getPluginRegistry();
  const shaderError = plugin.wgsl === undefined ? null : await getPluginHost().validateShader(plugin);
  const warnings: string[] = [];
  if (shaderError) {
    if (plugin.cpu === undefined) return { ok: false, errors: [shaderError] };
    warnings.push(`${shaderError}\nThe CPU fallback will be used instead.`);
  }
  const previous = registry.get(plugin.manifest.id)?.manifest.version ?? null;
  await registry.install(plugin);
  refreshPluginEffectsInProject();
  return { ok: true, plugin, warnings, replaced: previous };
}

export async function installPluginFromFiles(files: readonly File[]): Promise<PluginInstallResult> {
  const read = await readPluginFiles(files);
  if (!read.ok) return read;
  const installed = await installPlugin(read.plugin);
  return installed.ok ? { ...installed, warnings: [...read.warnings, ...installed.warnings] } : installed;
}

export async function uninstallPlugin(id: string): Promise<boolean> {
  await initPluginRegistry();
  const removed = await getPluginRegistry().uninstall(id);
  refreshPluginEffectsInProject();
  return removed;
}

/** Retry a plugin that was bypassed after repeated failures. */
export function retryPlugin(id: string): void {
  getPluginRegistry().resetHealth(id);
  refreshPluginEffectsInProject();
}

/**
 * Plugin effects in an open project resolve against the registry, so when it
 * changes the preview has to render the current frame again. Republish the
 * project reference (no data change) when a clip carries a plugin effect.
 */
export function refreshPluginEffectsInProject(): void {
  try {
    const { project } = useProjectStore.getState();
    const hasPlugin = project.timeline.tracks.some((track) =>
      track.clips.some((clip) => clip.effects?.some((effect) => effect.type.startsWith("plugin:"))),
    );
    if (hasPlugin) useProjectStore.setState({ project: { ...project } });
  } catch {
    /* no project open yet */
  }
}
