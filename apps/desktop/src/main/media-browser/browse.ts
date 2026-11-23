import { promises as fs, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectCameraCards, groupGoProChapters, type CardClip, type CardDirEntry, type CardFs, type CardKind } from "../../../../../packages/core/src/media/camera-cards";

/** Folder listing for the Media Browser: folders, media files, and (on a camera card) clips. */

export type BrowserMediaType = "video" | "audio" | "image";

const VIDEO = new Set(["mp4", "m4v", "mov", "mkv", "webm", "avi", "mxf", "mts", "m2ts", "ts", "mpg", "mpeg", "3gp", "wmv", "flv", "ogv"]);
const AUDIO = new Set(["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "aif", "aiff", "wma"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "avif"]);

export function mediaTypeOfName(name: string): BrowserMediaType | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (IMAGE.has(ext)) return "image";
  return null;
}

export interface BrowserEntry {
  /** The path, or the clip id for a clip. */
  id: string;
  kind: "dir" | "file" | "clip";
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  mediaType?: BrowserMediaType;
  /** Clips (camera cards, chaptered GoPro): the segments in playing order. */
  clip?: BrowserClip;
}

export interface BrowserClip {
  id: string;
  name: string;
  kind: CardKind;
  spanned: boolean;
  segments: Array<{ path: string; name: string; size: number; audioPaths?: string[] }>;
  proxyPath?: string;
  sidecars: string[];
}

export interface BrowserListing {
  path: string;
  /** null at a filesystem root. */
  parent: string | null;
  /** Set when the folder is a camera card (or a copy of one): its entries are clips. */
  card?: { kinds: Array<{ kind: CardKind; label: string }> };
  entries: BrowserEntry[];
  error?: string;
}

export interface BrowserPlace {
  name: string;
  path: string;
  kind: "volume" | "place";
}

export function nodeCardFs(): CardFs {
  return {
    join: (...parts) => path.join(...parts),
    async list(dir): Promise<CardDirEntry[] | null> {
      let dirents: Dirent[];
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      const out = await Promise.all(
        dirents.map(async (d): Promise<CardDirEntry | null> => {
          try {
            const full = path.join(dir, d.name);
            const stat = d.isSymbolicLink() ? await fs.stat(full) : await fs.lstat(full);
            return { name: d.name, isDir: stat.isDirectory(), size: stat.isDirectory() ? 0 : stat.size, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      return out.filter((e): e is CardDirEntry => e !== null);
    },
    async readBytes(file, maxBytes): Promise<Uint8Array | null> {
      let handle: fs.FileHandle | undefined;
      try {
        handle = await fs.open(file, "r");
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      } catch {
        return null;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
  };
}

const HIDDEN = (name: string): boolean => name.startsWith(".") || name.startsWith("$") || name === "System Volume Information";

function clipEntry(clip: CardClip): BrowserEntry {
  const first = clip.segments[0];
  const mediaType = mediaTypeOfName(first?.name ?? "") ?? "video";
  return {
    id: clip.id,
    kind: "clip",
    name: clip.name,
    path: first?.path ?? "",
    size: clip.size,
    mtimeMs: clip.modifiedMs,
    mediaType,
    clip: {
      id: clip.id,
      name: clip.name,
      kind: clip.kind,
      spanned: clip.spanned,
      segments: clip.segments.map((s) => ({ path: s.path, name: s.name, size: s.size, ...(s.audioPaths ? { audioPaths: s.audioPaths } : {}) })),
      ...(clip.proxyPath ? { proxyPath: clip.proxyPath } : {}),
      sidecars: clip.sidecars,
    },
  };
}

export async function listDirectory(dir: string, options: { rawFolders?: boolean } = {}): Promise<BrowserListing> {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved) === resolved ? null : path.dirname(resolved);
  const cardFs = nodeCardFs();
  const listed = await cardFs.list(resolved);
  if (!listed) return { path: resolved, parent, entries: [], error: "This folder cannot be read." };
  if (!options.rawFolders) {
    const cards = await detectCameraCards(cardFs, resolved);
    if (cards.length) {
      return {
        path: resolved,
        parent,
        card: { kinds: cards.map((c) => ({ kind: c.kind, label: c.label })) },
        entries: cards.flatMap((c) => c.clips).map(clipEntry),
      };
    }
  }
  const visible = listed.filter((e) => !HIDDEN(e.name));
  const { clips, rest } = groupGoProChapters(resolved, visible, path.join);
  const entries: BrowserEntry[] = [];
  for (const entry of rest) {
    const full = path.join(resolved, entry.name);
    if (entry.isDir) entries.push({ id: full, kind: "dir", name: entry.name, path: full, size: 0, mtimeMs: entry.mtimeMs });
    else {
      const mediaType = mediaTypeOfName(entry.name);
      if (mediaType) entries.push({ id: full, kind: "file", name: entry.name, path: full, size: entry.size, mtimeMs: entry.mtimeMs, mediaType });
    }
  }
  // A GoPro recording with a single file stays a plain file; chaptered ones become one clip.
  for (const clip of clips) {
    if (clip.spanned) entries.push(clipEntry(clip));
    else {
      const seg = clip.segments[0];
      entries.push({ id: seg.path, kind: "file", name: seg.name, path: seg.path, size: seg.size, mtimeMs: clip.modifiedMs, mediaType: "video" });
    }
  }
  entries.sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { path: resolved, parent, entries };
}

async function dirsIn(base: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".")).map((e) => path.join(base, e.name));
  } catch {
    return [];
  }
}

/** Mounted volumes (macOS /Volumes, Linux /media and /mnt, Windows drive letters) and the usual places. */
export async function listPlaces(): Promise<BrowserPlace[]> {
  const places: BrowserPlace[] = [];
  const home = os.homedir();
  for (const [name, rel] of [["Home", ""], ["Desktop", "Desktop"], ["Movies", "Movies"], ["Videos", "Videos"], ["Documents", "Documents"], ["Downloads", "Downloads"], ["Pictures", "Pictures"]] as const) {
    const full = rel ? path.join(home, rel) : home;
    if (await fs.stat(full).then((s) => s.isDirectory(), () => false)) places.push({ name, path: full, kind: "place" });
  }
  const volumeDirs: string[] = [];
  if (process.platform === "darwin") volumeDirs.push(...(await dirsIn("/Volumes")));
  else if (process.platform === "linux") {
    const user = os.userInfo().username;
    for (const base of [`/media/${user}`, `/run/media/${user}`, "/media", "/mnt"]) volumeDirs.push(...(await dirsIn(base)));
  } else if (process.platform === "win32") {
    for (let code = 65; code <= 90; code++) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (await fs.access(root).then(() => true, () => false)) volumeDirs.push(root);
    }
  }
  const seen = new Set<string>();
  for (const dir of volumeDirs) {
    const real = await fs.realpath(dir).catch(() => dir);
    // The boot volume shows up in /Volumes as a link to "/".
    if (real === "/" || seen.has(real)) continue;
    seen.add(real);
    places.push({ name: path.basename(dir) || dir, path: dir, kind: "volume" });
  }
  return places;
}
