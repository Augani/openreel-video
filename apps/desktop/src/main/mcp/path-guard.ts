import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpFileErrorCode, McpFilesResolveArgs, McpFilesResolveResult } from "../../shared/onboarding";

/**
 * Path checks for the MCP file tools. Pure Node (no Electron), so it is unit-testable.
 *
 * Rules (spec 6.1):
 * - every path must be absolute;
 * - the REAL path (symlinks resolved) must sit inside an allowed root, so `..` traversal and
 *   symlinks that point out of a root are rejected;
 * - a path that is lexically outside every root is reported as OUTSIDE_ALLOWED_ROOTS whether or not
 *   it exists, so the answer is never an existence oracle for files outside the roots;
 * - "write" checks the parent directory (the target may not exist yet).
 */

export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  // video
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "mxf", "mts", "m2ts", "ts", "mpg", "mpeg", "wmv", "flv", "3gp", "ogv",
  // audio
  "mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "aif", "aiff", "wma", "caf",
  // images
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif", "svg",
  // camera raw
  "dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "braw", "r3d",
]);

/** Most files one request may expand to when a folder is given. */
export const MAX_EXPANDED_FILES = 2000;

type Entry = McpFilesResolveResult["resolved"][number];
type Rejection = McpFilesResolveResult["rejected"][number];

const reject = (p: string, code: McpFileErrorCode, message: string): Rejection => ({ path: p, code, message });

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function realRoots(roots: readonly string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const root of roots) {
    out.add(path.resolve(root));
    try {
      out.add(await fs.realpath(root));
    } catch {
      /* a root that does not exist yet allows nothing real */
    }
  }
  return [...out];
}

const insideAny = (roots: readonly string[], candidate: string): boolean => roots.some((root) => isInside(root, candidate));

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? "";
}

function outside(p: string): Rejection {
  return reject(
    p,
    "OUTSIDE_ALLOWED_ROOTS",
    "That path is outside the folders agents may access. Add its folder in OpenReel Settings > MCP > Allowed folders, or move the file into one of them.",
  );
}

export interface ResolveOptions {
  roots: readonly string[];
  maxExpanded?: number;
}

async function resolveReadEntry(
  p: string,
  roots: readonly string[],
  recursive: boolean,
  budget: { left: number },
  resolved: Entry[],
  rejected: Rejection[],
): Promise<void> {
  const lexical = path.resolve(p);
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch (error) {
    if (!insideAny(roots, lexical)) {
      rejected.push(outside(p));
    } else if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
      rejected.push(reject(p, "NOT_FOUND", "No file or folder exists at that path."));
    } else {
      rejected.push(reject(p, "UNREADABLE", `Cannot read that path (${errorCode(error) || "unknown error"}).`));
    }
    return;
  }
  if (!insideAny(roots, real)) {
    rejected.push(outside(p));
    return;
  }
  let stat;
  try {
    stat = await fs.stat(real);
  } catch (error) {
    rejected.push(reject(p, "UNREADABLE", `Cannot read that path (${errorCode(error) || "unknown error"}).`));
    return;
  }
  if (stat.isFile()) {
    if (budget.left <= 0) return void rejected.push(reject(p, "INVALID_PARAMS", "Too many files requested at once."));
    budget.left -= 1;
    resolved.push({ path: lexical, realPath: real, kind: "file", sizeBytes: stat.size, exists: true });
    return;
  }
  if (!stat.isDirectory()) {
    rejected.push(reject(p, "UNSUPPORTED_TYPE", "That path is not a regular file or folder."));
    return;
  }
  const before = resolved.length;
  await walk(real, lexical, roots, recursive, budget, resolved, rejected);
  if (resolved.length === before && !rejected.some((r) => r.path.startsWith(lexical))) {
    rejected.push(
      reject(p, "UNSUPPORTED_TYPE", recursive ? "The folder has no supported media files." : "The folder has no supported media files at its top level. Pass recursive:true to include subfolders."),
    );
  }
}

async function walk(
  realDir: string,
  lexicalDir: string,
  roots: readonly string[],
  recursive: boolean,
  budget: { left: number },
  resolved: Entry[],
  rejected: Rejection[],
): Promise<void> {
  let names: string[];
  try {
    names = (await fs.readdir(realDir)).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    rejected.push(reject(lexicalDir, "UNREADABLE", `Cannot read that folder (${errorCode(error) || "unknown error"}).`));
    return;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const lexical = path.join(lexicalDir, name);
    let real: string;
    try {
      real = await fs.realpath(path.join(realDir, name));
    } catch {
      continue; // dangling symlink
    }
    if (!insideAny(roots, real)) {
      rejected.push(outside(lexical));
      continue;
    }
    let stat;
    try {
      stat = await fs.stat(real);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (recursive) await walk(real, lexical, roots, recursive, budget, resolved, rejected);
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) continue;
    if (budget.left <= 0) {
      if (!rejected.some((r) => r.path === lexicalDir && r.code === "INVALID_PARAMS")) {
        rejected.push(reject(lexicalDir, "INVALID_PARAMS", `The folder holds more than ${MAX_EXPANDED_FILES} media files; import a narrower folder.`));
      }
      return;
    }
    budget.left -= 1;
    resolved.push({ path: lexical, realPath: real, kind: "file", sizeBytes: stat.size, exists: true });
  }
}

async function resolveWriteEntry(
  p: string,
  roots: readonly string[],
  resolved: Entry[],
  rejected: Rejection[],
): Promise<void> {
  const lexical = path.resolve(p);
  if (!insideAny(roots, lexical)) return void rejected.push(outside(p));
  const base = path.basename(lexical);
  if (!base || base === "." || base === "..") {
    return void rejected.push(reject(p, "INVALID_PARAMS", "The path must name a file, not a folder."));
  }
  let realParent: string;
  try {
    realParent = await fs.realpath(path.dirname(lexical));
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
      return void rejected.push(reject(p, "NOT_FOUND", "The destination folder does not exist. Create it first or pick an existing folder."));
    }
    return void rejected.push(reject(p, "UNREADABLE", `Cannot access the destination folder (${errorCode(error) || "unknown error"}).`));
  }
  if (!insideAny(roots, realParent)) return void rejected.push(outside(p));
  try {
    if (!(await fs.stat(realParent)).isDirectory()) {
      return void rejected.push(reject(p, "NOT_FOUND", "The destination folder is not a directory."));
    }
  } catch {
    return void rejected.push(reject(p, "UNREADABLE", "Cannot access the destination folder."));
  }
  const target = path.join(realParent, base);
  try {
    const real = await fs.realpath(target);
    if (!insideAny(roots, real)) return void rejected.push(outside(p));
    const stat = await fs.stat(real);
    if (stat.isDirectory()) return void rejected.push(reject(p, "INVALID_PARAMS", "The path is an existing folder, not a file."));
    resolved.push({ path: lexical, realPath: real, kind: "file", sizeBytes: stat.size, exists: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      // A dangling symlink at the target is treated as an escape risk.
      try {
        await fs.lstat(target);
        return void rejected.push(outside(p));
      } catch {
        /* really absent */
      }
      resolved.push({ path: lexical, realPath: target, kind: "file", sizeBytes: 0, exists: false });
    } else {
      rejected.push(reject(p, "UNREADABLE", `Cannot access that path (${errorCode(error) || "unknown error"}).`));
    }
  }
}

export async function resolveMcpPaths(args: McpFilesResolveArgs, options: ResolveOptions): Promise<McpFilesResolveResult> {
  const roots = await realRoots(options.roots);
  const resolved: Entry[] = [];
  const rejected: Rejection[] = [];
  const budget = { left: options.maxExpanded ?? MAX_EXPANDED_FILES };
  for (const raw of args.paths) {
    if (raw.includes("\0")) {
      rejected.push(reject(raw, "INVALID_PARAMS", "The path contains a NUL byte."));
      continue;
    }
    if (!path.isAbsolute(raw)) {
      rejected.push(reject(raw, "INVALID_PARAMS", "Pass an absolute path (it starts with / or a drive letter)."));
      continue;
    }
    if (args.mode === "write") await resolveWriteEntry(raw, roots, resolved, rejected);
    else await resolveReadEntry(raw, roots, args.recursive === true, budget, resolved, rejected);
  }
  return { resolved, rejected };
}

/** Same containment rule for one already-resolved real path (used when main finalizes an output). */
export async function isRealPathAllowed(realPath: string, roots: readonly string[]): Promise<boolean> {
  return insideAny(await realRoots(roots), realPath);
}
