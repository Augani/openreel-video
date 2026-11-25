import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Standard plugin folders per platform. AU components are enumerated by the helper through the system's own registry; these are for VST3 and for telling the user where plugins are looked for. */

export interface ScanPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Extra VST3 folders from OPENREEL_VST3_PATH (separated like PATH), after the standard ones. Lets a user or a test point the scan at a plugin folder of their own. */
export function vst3SearchPaths(options: ScanPathOptions = {}): string[] {
  const env = options.env ?? process.env;
  const extra = (env.OPENREEL_VST3_PATH ?? "").split((options.platform ?? process.platform) === "win32" ? ";" : ":").map((p) => p.trim()).filter(Boolean);
  return [...standardVst3Paths(options), ...extra];
}

function standardVst3Paths({ platform = process.platform, home = os.homedir(), env = process.env }: ScanPathOptions = {}): string[] {
  if (platform === "darwin") return ["/Library/Audio/Plug-Ins/VST3", path.posix.join(home, "Library/Audio/Plug-Ins/VST3")];
  if (platform === "win32") {
    const common = env.COMMONPROGRAMFILES ?? "C:\\Program Files\\Common Files";
    const local = env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return [path.win32.join(common, "VST3"), path.win32.join(local, "Programs", "Common", "VST3")];
  }
  return [path.posix.join(home, ".vst3"), "/usr/lib/vst3", "/usr/local/lib/vst3"];
}

export function audioUnitSearchPaths({ platform = process.platform, home = os.homedir() }: ScanPathOptions = {}): string[] {
  if (platform !== "darwin") return [];
  return ["/Library/Audio/Plug-Ins/Components", path.posix.join(home, "Library/Audio/Plug-Ins/Components"), "/System/Library/Components"];
}

export interface Vst3Bundle {
  /** "vst3:" plus a 32 hex digit id derived from the first class id in moduleinfo.json, or from the bundle path. */
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly version?: string;
  readonly path: string;
}

const MAX_DEPTH = 3;
const MAX_BUNDLES = 2000;

function fnv128Hex(text: string): string {
  // Not cryptographic: a stable id for a plugin whose class id could not be read without loading it.
  let out = "";
  for (let seed = 0; seed < 4; seed += 1) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** Reads what a VST3 bundle declares about itself WITHOUT loading its code (moduleinfo.json, VST 3.7.5+); falls back to the bundle name. */
export async function readVst3Bundle(bundlePath: string): Promise<Vst3Bundle> {
  const base = path.basename(bundlePath).replace(/\.vst3$/i, "");
  let name = base;
  let vendor = "";
  let version: string | undefined;
  let classId: string | undefined;
  for (const candidate of [path.join(bundlePath, "Contents", "Resources", "moduleinfo.json"), path.join(bundlePath, "moduleinfo.json")]) {
    try {
      const info = JSON.parse(await fs.readFile(candidate, "utf8")) as { Name?: string; Version?: string; Factory?: { Vendor?: string }; Classes?: Array<{ CID?: string; Name?: string; Category?: string }> };
      if (typeof info.Name === "string" && info.Name) name = info.Name;
      if (typeof info.Version === "string") version = info.Version;
      if (typeof info.Factory?.Vendor === "string") vendor = info.Factory.Vendor;
      const audio = info.Classes?.find((c) => c.Category === "Audio Module Class" && typeof c.CID === "string");
      if (audio?.CID && /^[0-9A-Fa-f]{32}$/.test(audio.CID)) classId = audio.CID.toUpperCase();
      break;
    } catch {
      /* no moduleinfo: the bundle name is all there is */
    }
  }
  return { id: `vst3:${classId ?? fnv128Hex(bundlePath).toUpperCase()}`, name, vendor, ...(version ? { version } : {}), path: bundlePath };
}

/** Finds *.vst3 bundles (folders, or single files on Windows) under the given roots. Never loads or executes anything. */
export async function discoverVst3(roots: readonly string[]): Promise<Vst3Bundle[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (found.length >= MAX_BUNDLES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (/\.vst3$/i.test(entry.name)) found.push(full);
      else if (entry.isDirectory() && depth < MAX_DEPTH) await walk(full, depth + 1);
    }
  };
  for (const root of roots) await walk(root, 0);
  const bundles = await Promise.all(found.map((p) => readVst3Bundle(p)));
  return bundles.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
