import { existsSync } from "node:fs";
import path from "node:path";
import type { HelperSpawnOptions } from "./helper-process";

export const PLUGHOST_BINARY = "openreel-plughost";

export function plughostRelativePath(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}/${platform === "win32" ? `${PLUGHOST_BINARY}.exe` : PLUGHOST_BINARY}`;
}

export interface PlughostPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  /** Directory of the bundled main process (dist/main in development). */
  readonly dirname: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (file: string) => boolean;
}

/** Absolute path of the helper, or null when this build has none for the platform. */
export function resolvePlughostPath(options: PlughostPathOptions): string | null {
  const exists = options.exists ?? existsSync;
  // Development and test override (never honoured in a packaged build): run against another helper binary.
  const override = options.env?.OPENREEL_PLUGHOST_PATH;
  if (override && !options.isPackaged) return exists(override) ? override : null;
  const rel = plughostRelativePath(options.platform ?? process.platform, options.arch ?? process.arch);
  const base = options.isPackaged ? path.join(options.resourcesPath, "plughost") : path.join(options.dirname, "../../resources/plughost");
  const full = path.join(base, rel);
  return exists(full) ? full : null;
}

export const VST3HOST_BINARY = "openreel-vst3host";

export function vst3hostRelativePath(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}/${platform === "win32" ? `${VST3HOST_BINARY}.exe` : VST3HOST_BINARY}`;
}

/** Absolute path of the VST3 helper (built by scripts/build-vst3host.mjs), or null when this build has none for the platform. */
export function resolveVst3hostPath(options: PlughostPathOptions): string | null {
  const exists = options.exists ?? existsSync;
  const override = options.env?.OPENREEL_VST3HOST_PATH;
  if (override && !options.isPackaged) return exists(override) ? override : null;
  const rel = vst3hostRelativePath(options.platform ?? process.platform, options.arch ?? process.arch);
  const base = options.isPackaged ? path.join(options.resourcesPath, "vst3host") : path.join(options.dirname, "../../resources/vst3host");
  const full = path.join(base, rel);
  return exists(full) ? full : null;
}

/** `helper(mode)` for the scanner and the host service: the command line of one helper process, or null without a helper. */
export function helperSpawner(binary: string | null, env?: NodeJS.ProcessEnv): (mode: string, format?: PluginHelperFormat) => HelperSpawnOptions | null {
  return (mode) => (binary ? { command: binary, args: [mode], ...(env ? { env } : {}) } : null);
}

/** The two helpers speak the same protocol; the plugin format picks the binary (Audio Units: openreel-plughost, VST3: openreel-vst3host). */
export type PluginHelperFormat = "au" | "vst3";

export function formatHelperSpawner(binaries: { readonly au: string | null; readonly vst3: string | null }, env?: NodeJS.ProcessEnv): (mode: string, format?: PluginHelperFormat) => HelperSpawnOptions | null {
  return (mode, format = "au") => {
    const binary = binaries[format];
    return binary ? { command: binary, args: [mode], ...(env ? { env } : {}) } : null;
  };
}
