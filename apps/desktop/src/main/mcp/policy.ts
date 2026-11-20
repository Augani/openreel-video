import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpPolicy, McpSetPolicyArgs } from "../../shared/onboarding";

/**
 * Allowed-roots policy for the MCP path tools (import_media_from_path, open_project_file,
 * save_project_as, export outputPath). It lives in the main process (userData/mcp-policy.json)
 * so it is enforced where the file access happens and a renderer cannot widen it by itself.
 *
 * Default roots: Movies, Music, Pictures, Documents, Downloads, Desktop, plus the folder of the
 * project file that is currently open.
 */

const POLICY_VERSION = 1;

export interface PolicyEnv {
  /** Absolute path of the JSON file that persists the user's roots. */
  file: string;
  /** The default roots (home folders that hold the user's media and documents). */
  defaultRoots: string[];
}

export class McpPolicyStore {
  private allowed: string[] | null = null;
  private projectFolder: string | null = null;
  private watchRoots: string[] = [];

  constructor(private readonly env: PolicyEnv) {}

  private load(): string[] {
    if (this.allowed) return this.allowed;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.env.file, "utf8")) as { v?: number; allowedRoots?: unknown };
      if (parsed && parsed.v === POLICY_VERSION && Array.isArray(parsed.allowedRoots)) {
        this.allowed = normalizeRoots(parsed.allowedRoots.filter((entry): entry is string => typeof entry === "string"));
        return this.allowed;
      }
    } catch {
      /* missing or corrupt: fall back to the defaults */
    }
    this.allowed = normalizeRoots(this.env.defaultRoots);
    return this.allowed;
  }

  get(): McpPolicy {
    return { allowedRoots: [...this.load()], defaultRoots: normalizeRoots(this.env.defaultRoots) };
  }

  set(args: McpSetPolicyArgs): McpPolicy {
    const roots = normalizeRoots(args.allowedRoots, true);
    fs.mkdirSync(path.dirname(this.env.file), { recursive: true });
    const tmp = `${this.env.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: POLICY_VERSION, allowedRoots: roots }, null, 2), "utf8");
    fs.renameSync(tmp, this.env.file);
    this.allowed = roots;
    return this.get();
  }

  /** The folder of the project file that is open now; always readable and writable for agents. */
  setProjectFolder(dir: string | null): void {
    this.projectFolder = dir && path.isAbsolute(dir) ? path.resolve(dir) : null;
  }

  /**
   * Folders the user set up as watch folders (and the output folders of export watch folders). The
   * app reads from and writes to them on the user's behalf, so path checks accept them too. Not
   * persisted here: the watch-folder config owns the list.
   */
  setWatchRoots(dirs: readonly string[]): void {
    this.watchRoots = normalizeRoots(dirs);
  }

  /** What path checks use: the configured roots, the open project's folder and the watch folders. */
  effectiveRoots(): string[] {
    const roots = [...this.load()];
    if (this.projectFolder && !roots.includes(this.projectFolder)) roots.push(this.projectFolder);
    for (const root of this.watchRoots) if (!roots.includes(root)) roots.push(root);
    return roots;
  }
}

/** Resolve to absolute paths, drop duplicates. With `strict`, invalid entries throw instead of being dropped. */
export function normalizeRoots(input: readonly string[], strict = false): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.includes("\0") || !path.isAbsolute(trimmed)) {
      if (strict) throw new Error(`Allowed root must be an absolute path: ${trimmed}`);
      continue;
    }
    const resolved = path.resolve(trimmed);
    if (resolved === path.parse(resolved).root) {
      if (strict) throw new Error("The filesystem root cannot be an allowed root. Choose a folder.");
      continue;
    }
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function electronDefaults(): PolicyEnv {
  // Resolved lazily so this module stays unit-testable without an Electron runtime.
  const { app } = require("electron") as typeof import("electron");
  const userData = app.getPath("userData");
  const pick = (name: Parameters<typeof app.getPath>[0], fallback: string): string => {
    try {
      return app.getPath(name);
    } catch {
      return path.join(os.homedir(), fallback);
    }
  };
  return {
    file: path.join(userData, "mcp-policy.json"),
    defaultRoots: [
      pick("videos", "Movies"),
      pick("music", "Music"),
      pick("pictures", "Pictures"),
      pick("documents", "Documents"),
      pick("downloads", "Downloads"),
      pick("desktop", "Desktop"),
    ],
  };
}

let singleton: McpPolicyStore | null = null;

export function getMcpPolicyStore(): McpPolicyStore {
  if (!singleton) singleton = new McpPolicyStore(electronDefaults());
  return singleton;
}

/** Test seam: replace (or clear) the process-wide store. */
export function setMcpPolicyStoreForTest(store: McpPolicyStore | null): void {
  singleton = store;
}

export function getMcpPolicy(): McpPolicy {
  return getMcpPolicyStore().get();
}

export function setMcpPolicy(args: McpSetPolicyArgs): McpPolicy {
  return getMcpPolicyStore().set(args);
}

export function getEffectiveRoots(): string[] {
  return getMcpPolicyStore().effectiveRoots();
}

export function noteOpenProjectFile(filePath: string | null): void {
  getMcpPolicyStore().setProjectFolder(filePath ? path.dirname(filePath) : null);
}
