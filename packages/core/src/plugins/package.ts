/**
 * Turn the files of a `.orplugin` package (zip or folder) into a validated,
 * self-contained LoadedPlugin. Pure: works in the browser, the desktop main
 * process and tests.
 */

import { lintCpuSource } from "./cpu-source";
import { validatePluginManifest, type PluginManifest } from "./manifest";
import { lintPluginShader } from "./shader-source";
import { readZip } from "./zip";

export const PLUGIN_MANIFEST_FILE = "plugin.json";
export const PLUGIN_PACKAGE_EXTENSION = ".orplugin";

/** An installed plugin: manifest plus the text of its implementation files. */
export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly wgsl?: string;
  readonly cpu?: string;
}

export type PluginPackageResult =
  | { readonly ok: true; readonly plugin: LoadedPlugin; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

export type PackageFiles = ReadonlyMap<string, Uint8Array | string>;

const text = (v: Uint8Array | string): string =>
  typeof v === "string" ? v : new TextDecoder("utf-8", { fatal: false }).decode(v);

function normalise(files: PackageFiles): Map<string, Uint8Array | string> {
  const out = new Map<string, Uint8Array | string>();
  for (const [name, data] of files) {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    if (clean.startsWith("__MACOSX/") || clean.endsWith(".DS_Store")) continue;
    out.set(clean, data);
  }
  // A zip of a folder keeps one top-level directory: strip it when plugin.json lives there.
  if (!out.has(PLUGIN_MANIFEST_FILE)) {
    const roots = new Set([...out.keys()].map((k) => k.split("/")[0]));
    if (roots.size === 1) {
      const root = [...roots][0];
      if (out.has(`${root}/${PLUGIN_MANIFEST_FILE}`)) {
        const stripped = new Map<string, Uint8Array | string>();
        for (const [k, v] of out) stripped.set(k.slice(root.length + 1), v);
        return stripped;
      }
    }
  }
  return out;
}

/** Validate package files. Never throws. */
export function parsePluginPackage(files: PackageFiles): PluginPackageResult {
  const map = normalise(files);
  const manifestRaw = map.get(PLUGIN_MANIFEST_FILE);
  if (manifestRaw === undefined) {
    return { ok: false, errors: [`package has no ${PLUGIN_MANIFEST_FILE}`] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text(manifestRaw));
  } catch (error) {
    return { ok: false, errors: [`${PLUGIN_MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`] };
  }
  const validated = validatePluginManifest(json);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const { manifest } = validated;

  const errors: string[] = [];
  const warnings: string[] = [];
  let wgsl: string | undefined;
  let cpu: string | undefined;

  if (manifest.shader) {
    const raw = map.get(manifest.shader.file);
    if (raw === undefined) errors.push(`shader file "${manifest.shader.file}" is missing from the package`);
    else {
      wgsl = text(raw);
      for (const p of lintPluginShader(wgsl)) errors.push(`${manifest.shader.file}: ${p}`);
    }
  }
  if (manifest.cpu) {
    const raw = map.get(manifest.cpu.file);
    if (raw === undefined) errors.push(`cpu file "${manifest.cpu.file}" is missing from the package`);
    else {
      cpu = text(raw);
      for (const p of lintCpuSource(cpu)) errors.push(`${manifest.cpu.file}: ${p}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  if (manifest.cpu && !manifest.shader) warnings.push("CPU-only plugin: it runs in a Worker and is slower than a WGSL shader");
  return { ok: true, plugin: { manifest, ...(wgsl !== undefined ? { wgsl } : {}), ...(cpu !== undefined ? { cpu } : {}) }, warnings };
}

/** Read a `.orplugin` zip archive. */
export async function parsePluginArchive(bytes: Uint8Array): Promise<PluginPackageResult> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(bytes);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
  return parsePluginPackage(files);
}

/** The package files of an installed plugin, for writing a plugin folder or re-zipping. */
export function pluginToFiles(plugin: LoadedPlugin): Record<string, string> {
  const files: Record<string, string> = {
    [PLUGIN_MANIFEST_FILE]: JSON.stringify(plugin.manifest, null, 2),
  };
  if (plugin.manifest.shader && plugin.wgsl !== undefined) files[plugin.manifest.shader.file] = plugin.wgsl;
  if (plugin.manifest.cpu && plugin.cpu !== undefined) files[plugin.manifest.cpu.file] = plugin.cpu;
  return files;
}
