import path from "node:path";
import { classifyOpenFile, type OpenFileItem } from "../shared/file-associations";

/**
 * Routing of files the operating system hands to the app: macOS `open-file`, the command line of a first launch
 * (Windows / Linux double-click) and the argv of a second launch (`second-instance`). Pure and testable: electron
 * specifics (the window, `app.on`) live in index.ts.
 */

export interface ArgvOptions {
  /** Working directory of the process that was started (a relative path in argv means this folder). */
  cwd: string;
  /** `process.defaultApp`: started as `electron <app> files...`, so argv has two leading entries before the files. */
  defaultApp?: boolean;
  /** Existence check; a path that does not exist is dropped. Default: keep everything. */
  exists?: (filePath: string) => boolean;
}

/**
 * Files named on a command line, as absolute paths in order, without duplicates. Chromium / Electron switches
 * (`--flag`, `--flag=value`) and anything that is not an associated file type are ignored.
 */
export function extractOpenPaths(argv: readonly string[], options: ArgvOptions): OpenFileItem[] {
  const skip = options.defaultApp ? 2 : 1;
  const out: OpenFileItem[] = [];
  const seen = new Set<string>();
  for (const raw of argv.slice(skip)) {
    if (!raw || raw.startsWith("-")) continue;
    const value = raw.replace(/^"(.*)"$/, "$1");
    const kind = classifyOpenFile(value);
    if (!kind) continue;
    const absolute = path.isAbsolute(value) ? path.normalize(value) : path.resolve(options.cwd, value);
    if (options.exists && !options.exists(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push({ kind, path: absolute });
  }
  return out;
}

export interface OpenFileRouterDeps {
  /** Send items to the editor window. Returns false when there is no window to receive them. */
  send(items: OpenFileItem[]): boolean;
  /** Bring the editor window forward (creating it when none exists). */
  show(): void;
  exists?: (filePath: string) => boolean;
}

/**
 * Holds files until the editor's renderer is ready to receive them. Files that arrive before the window exists or
 * has loaded (a launch by double-click, macOS `open-file` before `ready`) are queued and handed over when the renderer
 * asks; later files are sent straight away and the window is brought forward.
 */
export class OpenFileRouter {
  private pending: OpenFileItem[] = [];
  private rendererReady = false;

  constructor(private readonly deps: OpenFileRouterDeps) {}

  /** Files from `open-file` (macOS) or any other path source. */
  addPaths(paths: readonly string[], cwd = process.cwd()): OpenFileItem[] {
    return this.addItems(extractOpenPaths(["", ...paths], { cwd, exists: this.deps.exists }));
  }

  /** Files from a command line (`second-instance`, or the argv of this process at launch). */
  addArgv(argv: readonly string[], cwd: string, defaultApp = false): OpenFileItem[] {
    return this.addItems(extractOpenPaths(argv, { cwd, defaultApp, exists: this.deps.exists }));
  }

  private addItems(items: OpenFileItem[]): OpenFileItem[] {
    if (!items.length) return [];
    const known = new Set(this.pending.map((item) => item.path));
    const fresh = items.filter((item) => !known.has(item.path));
    if (this.rendererReady) {
      this.deps.show();
      if (this.deps.send(items)) return items;
    }
    this.pending.push(...fresh);
    // A running app with a hidden window or none: surface it so the file is not opened invisibly.
    this.deps.show();
    return items;
  }

  /** The renderer asks for what arrived before it could receive it; from now on files are sent directly. */
  takePending(): OpenFileItem[] {
    this.rendererReady = true;
    const items = this.pending;
    this.pending = [];
    return items;
  }

  /** The editor page is (re)loading: hold files again until it asks. */
  rendererLoading(): void {
    this.rendererReady = false;
  }

  /** Test hook. */
  pendingCount(): number {
    return this.pending.length;
  }
}
