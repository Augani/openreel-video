import { promises as fs } from "node:fs";
import path from "node:path";
import { parsePluginPackage } from "../../../../../packages/core/src/plugins/package";

/**
 * Effect plugins installed on this machine: one folder per plugin id under
 * `<userData>/plugins/<id>/` holding plugin.json, the WGSL shader and the
 * optional CPU file. Nothing here is trusted: every package is re-validated
 * with the same parser the renderer uses before it is written, and every
 * folder is re-validated when listed (a hand-edited or corrupt folder is
 * skipped, never executed).
 */
export class PluginFolderStore {
  constructor(readonly root: string) {}

  private folder(id: string): string {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) throw new Error(`invalid plugin id: ${id}`);
    return path.join(this.root, id);
  }

  async list(): Promise<Array<Record<string, string>>> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch {
      return [];
    }
    const out: Array<Record<string, string>> = [];
    for (const entry of entries.sort()) {
      const dir = path.join(this.root, entry);
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
        const files: Record<string, string> = {};
        for (const name of await fs.readdir(dir)) {
          const file = path.join(dir, name);
          const stat = await fs.stat(file);
          if (stat.isFile() && stat.size <= 1024 * 1024) files[name] = await fs.readFile(file, "utf8");
        }
        const parsed = parsePluginPackage(new Map(Object.entries(files)));
        if (parsed.ok && parsed.plugin.manifest.id === entry) out.push(files);
      } catch {
        /* skip unreadable folders */
      }
    }
    return out;
  }

  /** Validate and install (or upgrade) a plugin. The previous version is replaced atomically. */
  async put(id: string, files: Record<string, string>): Promise<void> {
    const parsed = parsePluginPackage(new Map(Object.entries(files)));
    if (!parsed.ok) throw new Error(`invalid plugin package: ${parsed.errors.join("; ")}`);
    if (parsed.plugin.manifest.id !== id) throw new Error("plugin id does not match its manifest");
    const target = this.folder(id);
    await fs.mkdir(this.root, { recursive: true });
    const staging = `${target}.installing-${process.pid}-${Date.now()}`;
    await fs.mkdir(staging, { recursive: true });
    try {
      for (const [name, content] of Object.entries(files)) {
        // package.ts allows one nested level only through a stripped root; store flat, safe names.
        const safe = path.basename(name);
        if (safe !== name || safe.startsWith(".")) continue;
        await fs.writeFile(path.join(staging, safe), content, "utf8");
      }
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(staging, target);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.folder(id), { recursive: true, force: true });
  }
}

let singleton: PluginFolderStore | null = null;

export function getPluginFolderStore(): PluginFolderStore {
  if (!singleton) {
    const { app } = require("electron") as typeof import("electron");
    singleton = new PluginFolderStore(path.join(app.getPath("userData"), "plugins"));
  }
  return singleton;
}
