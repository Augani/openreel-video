import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Reading a local media file on behalf of the renderer - the path behind the
 * agent's import_media_from_path tool, which an external MCP client can call.
 *
 * This is the trust boundary, so every check happens here in the main
 * process, and again on the path after symlinks are resolved. The renderer's
 * own validation is a courtesy for early errors, not a guarantee.
 */

/** What may be read. Anything else is refused before the disk is touched. */
export const LOCAL_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4", "webm", "mov", "m4v", "mkv",
  "mp3", "wav", "aac", "m4a", "ogg", "flac",
  "jpg", "jpeg", "png", "webp", "gif",
]);

/** The whole file crosses IPC in memory, so there is a ceiling. */
export const LOCAL_MEDIA_MAX_BYTES = 1024 ** 3;

/**
 * Why `p` may not be read as local media on `platform`, or null when it may.
 *
 * On Windows this refuses the forms that open something other than the plain
 * file the name suggests: UNC paths (which authenticate to a remote host and
 * leak the user's NTLM hash), device namespaces (`\\?\`, `\\.\`), alternate
 * data streams (`secret.txt:x.mp4` reads a hidden stream of secret.txt) and
 * trailing dots or spaces (which Windows strips before opening).
 */
export function checkLocalMediaPath(p: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!p) return "path is empty";
  const base = p.split(/[\\/]/).pop() ?? "";

  if (platform === "win32") {
    if (/^[\\/]{2}/.test(p)) return "network and device paths are not allowed";
    if (!/^[A-Za-z]:[\\/]/.test(p)) return "path must be absolute";
    if (p.indexOf(":", 2) !== -1) return "alternate data streams are not allowed";
    if (/[. ]$/.test(base)) return "file names may not end in a dot or space";
  } else if (!path.posix.isAbsolute(p)) {
    return "path must be absolute";
  }

  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (!LOCAL_MEDIA_EXTENSIONS.has(ext)) {
    return `only media files can be imported (${[...LOCAL_MEDIA_EXTENSIONS].join(", ")})`;
  }
  return null;
}

export type LocalMediaResult =
  | { readonly ok: true; readonly name: string; readonly bytes: ArrayBuffer }
  | { readonly ok: false; readonly error: string };

export async function readLocalMedia(
  args: { path: string },
  options: { maxBytes?: number } = {},
): Promise<LocalMediaResult> {
  const maxBytes = options.maxBytes ?? LOCAL_MEDIA_MAX_BYTES;
  const refuse = (error: string): LocalMediaResult => ({ ok: false, error: `${error}: ${args.path}` });

  const shape = checkLocalMediaPath(args.path);
  if (shape) return refuse(shape);

  try {
    // A symlink or junction named clip.mp4 can point anywhere. Judge the
    // target, not the name.
    const real = await fs.realpath(args.path);
    const realShape = checkLocalMediaPath(real);
    if (realShape) return refuse(`resolved target refused (${realShape})`);

    const stat = await fs.stat(real);
    if (!stat.isFile()) return refuse("not a regular file");
    if (stat.size > maxBytes) {
      return refuse(`file is ${stat.size} bytes, over the ${maxBytes}-byte import limit`);
    }

    const buf = await fs.readFile(real);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { ok: true, name: path.basename(args.path), bytes };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return refuse(code === "ENOENT" ? "file not found" : `could not read file (${code ?? "unknown error"})`);
  }
}
