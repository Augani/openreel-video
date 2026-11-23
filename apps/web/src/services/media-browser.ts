import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import {
  detectCameraCards,
  groupGoProChapters,
  mediaFieldsToXmpFields,
  readEmbeddedXmpPacket,
  sidecarXmpName,
  xmpFieldsFromPackets,
  xmpFieldsToMediaFields,
  type CardClip,
  type CardDirEntry,
  type CardFs,
  type XmpFields,
} from "@openreel/core";
import type { OpenReelBrowserClipRef, OpenReelBrowserEntry, OpenReelBrowserListing, OpenReelMediaBrowserBridge } from "../types/global";
import { useProjectStore } from "../stores/project-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { toast } from "../stores/notification-store";
import { rememberNativePath } from "./native-decode";
import { setMediaMetadata } from "./media-metadata-commands";

/**
 * Renderer side of the Media Browser. Desktop talks to the main process (volumes, camera cards as clips,
 * ffmpeg thumbnails / hover-scrub frames / previews, lossless joins); the web build browses a folder the
 * user picked through the File System Access API, with the same camera-card detectors and no joining.
 */

export type BrowserBackendKind = "desktop" | "web";

export function desktopBrowserBridge(): OpenReelMediaBrowserBridge | null {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop" && window.openreel.mediaBrowser ? window.openreel.mediaBrowser : null;
}

type DirPicker = () => Promise<FileSystemDirectoryHandle>;
export function webDirectoryPicker(): DirPicker | null {
  const w = typeof window === "undefined" ? undefined : (window as unknown as { showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle> });
  return w?.showDirectoryPicker ? () => w.showDirectoryPicker!({ mode: "read" }) : null;
}

export function browserBackend(): BrowserBackendKind | null {
  if (desktopBrowserBridge()) return "desktop";
  return webDirectoryPicker() ? "web" : null;
}

export const clipRefOf = (entry: OpenReelBrowserEntry): OpenReelBrowserClipRef =>
  entry.clip
    ? { name: entry.clip.name, kind: entry.clip.kind, segments: entry.clip.segments.map((s) => ({ path: s.path, ...(s.audioPaths ? { audioPaths: s.audioPaths } : {}) })) }
    : { name: entry.name, kind: "file", segments: [{ path: entry.path }] };

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg",
  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", aif: "audio/aiff", aiff: "audio/aiff",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
};
const mimeFor = (name: string): string => MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "";

/** Files bigger than this are not pulled through the main process into memory. */
export const MAX_BRIDGE_BYTES = 1.5 * 1024 ** 3;

// ---------------------------------------------------------------------------
// Web: File System Access
// ---------------------------------------------------------------------------

const webRoots = new Map<string, FileSystemDirectoryHandle>();

export function addWebRoot(handle: FileSystemDirectoryHandle): string {
  let name = handle.name || "Folder";
  let n = 1;
  while (webRoots.has(name)) name = `${handle.name} (${++n})`;
  webRoots.set(name, handle);
  return name;
}
export const webRootNames = (): string[] => [...webRoots.keys()];

async function webDirHandle(path: string): Promise<FileSystemDirectoryHandle | null> {
  const [rootName, ...rest] = path.split("/").filter(Boolean);
  let handle = webRoots.get(rootName ?? "") ?? null;
  for (const part of rest) {
    if (!handle) return null;
    try {
      handle = await handle.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  return handle;
}
async function webFileHandle(path: string): Promise<FileSystemFileHandle | null> {
  const index = path.lastIndexOf("/");
  const dir = await webDirHandle(path.slice(0, index));
  try {
    return dir ? await dir.getFileHandle(path.slice(index + 1)) : null;
  } catch {
    return null;
  }
}

const webCardFs: CardFs = {
  join: (...parts) => parts.join("/"),
  async list(dir): Promise<CardDirEntry[] | null> {
    const handle = await webDirHandle(dir);
    if (!handle) return null;
    const out: CardDirEntry[] = [];
    try {
      for await (const [name, child] of (handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (child.kind === "directory") out.push({ name, isDir: true, size: 0, mtimeMs: 0 });
        else {
          const file = await (child as FileSystemFileHandle).getFile();
          out.push({ name, isDir: false, size: file.size, mtimeMs: file.lastModified });
        }
      }
    } catch {
      return null;
    }
    return out;
  },
  async readBytes(path, maxBytes): Promise<Uint8Array | null> {
    const handle = await webFileHandle(path);
    if (!handle) return null;
    return new Uint8Array(await (await handle.getFile()).slice(0, maxBytes).arrayBuffer());
  },
};

function typeOfName(name: string): "video" | "audio" | "image" | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["mp4", "m4v", "mov", "mkv", "webm", "avi", "mxf", "mts", "m2ts", "ts", "mpg", "mpeg", "3gp", "wmv", "flv", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "aif", "aiff", "wma"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "avif"].includes(ext)) return "image";
  return null;
}

function clipToEntry(clip: CardClip): OpenReelBrowserEntry {
  return {
    id: clip.id,
    kind: "clip",
    name: clip.name,
    path: clip.segments[0]?.path ?? "",
    size: clip.size,
    mtimeMs: clip.modifiedMs,
    mediaType: "video",
    clip: { id: clip.id, name: clip.name, kind: clip.kind, spanned: clip.spanned, segments: clip.segments.map((s) => ({ path: s.path, name: s.name, size: s.size })), sidecars: clip.sidecars },
  };
}

async function listWeb(path: string, rawFolders: boolean): Promise<OpenReelBrowserListing> {
  const parentIndex = path.lastIndexOf("/");
  const parent = parentIndex < 0 ? null : path.slice(0, parentIndex);
  const listed = await webCardFs.list(path);
  if (!listed) return { path, parent, entries: [], error: "This folder cannot be read." };
  if (!rawFolders) {
    const cards = await detectCameraCards(webCardFs, path);
    if (cards.length) return { path, parent, card: { kinds: cards.map((c) => ({ kind: c.kind, label: c.label })) }, entries: cards.flatMap((c) => c.clips).map(clipToEntry) };
  }
  const visible = listed.filter((e) => !e.name.startsWith("."));
  const { clips, rest } = groupGoProChapters(path, visible, webCardFs.join);
  const entries: OpenReelBrowserEntry[] = [];
  for (const entry of rest) {
    const full = `${path}/${entry.name}`;
    if (entry.isDir) entries.push({ id: full, kind: "dir", name: entry.name, path: full, size: 0, mtimeMs: entry.mtimeMs });
    else {
      const mediaType = typeOfName(entry.name);
      if (mediaType) entries.push({ id: full, kind: "file", name: entry.name, path: full, size: entry.size, mtimeMs: entry.mtimeMs, mediaType });
    }
  }
  for (const clip of clips) {
    if (clip.spanned) entries.push(clipToEntry(clip));
    else entries.push({ id: clip.segments[0].path, kind: "file", name: clip.segments[0].name, path: clip.segments[0].path, size: clip.size, mtimeMs: clip.modifiedMs, mediaType: "video" });
  }
  entries.sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { path, parent, entries };
}

// ---------------------------------------------------------------------------
// Listing, thumbnails, scrubbing
// ---------------------------------------------------------------------------

export async function listPath(path: string, rawFolders: boolean): Promise<OpenReelBrowserListing> {
  const desktop = desktopBrowserBridge();
  if (desktop) return desktop.list({ path, rawFolders });
  return listWeb(path, rawFolders);
}

const thumbCache = new Map<string, Promise<string | null>>();

async function webThumbnail(entry: OpenReelBrowserEntry): Promise<string | null> {
  const first = entry.clip?.segments[0]?.path ?? entry.path;
  const handle = await webFileHandle(first);
  if (!handle) return null;
  const file = await handle.getFile();
  if (entry.mediaType === "image") return URL.createObjectURL(file);
  if (entry.mediaType !== "video") return null;
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("unsupported"));
    });
    video.currentTime = Math.min(1, (video.duration || 0) / 4);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 1500);
    });
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = Math.round(240 * ((video.videoHeight || 9) / (video.videoWidth || 16)));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Thumbnail data URL of an entry (cached; null when none can be made: audio, unreadable, unsupported). */
export function thumbnailFor(entry: OpenReelBrowserEntry): Promise<string | null> {
  if (entry.kind === "dir" || entry.mediaType === "audio") return Promise.resolve(null);
  const key = `${entry.id}:${entry.mtimeMs}`;
  let hit = thumbCache.get(key);
  if (!hit) {
    const desktop = desktopBrowserBridge();
    hit = desktop ? desktop.thumbnail({ path: entry.clip?.segments[0]?.path ?? entry.path, width: 240 }).catch(() => null) : webThumbnail(entry).catch(() => null);
    thumbCache.set(key, hit);
    if (thumbCache.size > 600) thumbCache.delete(thumbCache.keys().next().value as string);
  }
  return hit;
}

const scrubCache = new Map<string, Promise<{ duration: number; frames: Array<string | null> } | null>>();

/** Frames spread over the whole clip for hover scrubbing (desktop; the web build does not scrub). */
export function scrubFramesFor(entry: OpenReelBrowserEntry): Promise<{ duration: number; frames: Array<string | null> } | null> {
  const desktop = desktopBrowserBridge();
  if (!desktop || entry.mediaType !== "video") return Promise.resolve(null);
  const key = `${entry.id}:${entry.mtimeMs}`;
  let hit = scrubCache.get(key);
  if (!hit) {
    hit = desktop.filmstrip({ clip: clipRefOf(entry), count: 12, width: 240 }).catch(() => null);
    scrubCache.set(key, hit);
    if (scrubCache.size > 80) scrubCache.delete(scrubCache.keys().next().value as string);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Preview in the Source monitor
// ---------------------------------------------------------------------------

async function bridgeBlob(path: string, name: string): Promise<Blob> {
  const stat = await window.openreel!.ingest?.stat([path]);
  if (stat && stat[path]?.size > MAX_BRIDGE_BYTES) throw new Error("This file is too large to preview here. Import it to work with it.");
  return new Blob([await window.openreel!.fs.readFileBytes(path)], { type: mimeFor(name) });
}

/** Show a browser entry in the Source monitor without importing it. */
export async function previewEntry(entry: OpenReelBrowserEntry, onImport?: () => void): Promise<boolean> {
  const monitor = useSourceMonitorStore.getState();
  const type = entry.mediaType ?? "video";
  const desktop = desktopBrowserBridge();
  try {
    if (desktop) {
      if (type === "video") {
        const probe = await desktop.probeClip({ clip: clipRefOf(entry) }).catch(() => null);
        const preview = await desktop.preview({ clip: clipRefOf(entry) });
        const blob = new Blob([preview.data], { type: "video/mp4" });
        const note = [entry.clip?.spanned ? `${entry.clip.segments.length} files joined` : "", preview.truncated ? "first 5 minutes" : "", "360p preview"].filter(Boolean).join(", ");
        monitor.openExternal({ id: `external:${entry.id}`, name: entry.name, blob, duration: preview.duration, frameRate: probe?.frameRate, width: probe?.width, height: probe?.height, type: "video", hasAudio: true, note, onImport });
      } else {
        const blob = await bridgeBlob(entry.path, entry.name);
        monitor.openExternal({ id: `external:${entry.id}`, name: entry.name, blob, duration: type === "image" ? 5 : await blobDuration(blob), type, hasAudio: type === "audio", onImport });
      }
      return true;
    }
    const handle = await webFileHandle(entry.clip?.segments[0]?.path ?? entry.path);
    if (!handle) throw new Error("The file is not available any more.");
    const file = await handle.getFile();
    const note = entry.clip?.spanned ? `first of ${entry.clip.segments.length} files` : undefined;
    monitor.openExternal({ id: `external:${entry.id}`, name: entry.name, blob: file, duration: type === "image" ? 5 : await blobDuration(file), type, hasAudio: type !== "image", note, onImport });
    return true;
  } catch (error) {
    toast.warning("Preview", error instanceof Error ? error.message : "The preview could not be made.");
    return false;
  }
}

function blobDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(blob.type.startsWith("audio") ? "audio" : "video");
    const done = (value: number): void => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : 0);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportReport {
  imported: number;
  failed: Array<{ name: string; reason: string }>;
}

/** XMP fields of a file on the web build (embedded packet and the sidecar next to it). */
async function webXmpFields(path: string, file: File): Promise<XmpFields | null> {
  const embedded = await readEmbeddedXmpPacket(file.name, { size: file.size, read: async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()) }).catch(() => null);
  let sidecar: string | null = null;
  const dir = await webDirHandle(path.slice(0, path.lastIndexOf("/")));
  try {
    if (dir) sidecar = await (await (await dir.getFileHandle(sidecarXmpName(file.name))).getFile()).text();
  } catch {
    sidecar = null;
  }
  return xmpFieldsFromPackets(embedded, sidecar);
}

async function importOne(entry: OpenReelBrowserEntry, onStage: (stage: string) => void): Promise<string[]> {
  const store = useProjectStore.getState();
  const desktop = desktopBrowserBridge();
  const ids: string[] = [];
  if (desktop) {
    onStage(entry.clip?.spanned ? "Joining clips" : "Reading");
    const prepared = await desktop.prepareImport({ clip: clipRefOf(entry) });
    const stat = await window.openreel!.ingest?.stat([prepared.path]);
    if (stat && stat[prepared.path]?.size > MAX_BRIDGE_BYTES) throw new Error("The file is larger than 1.5 GB, which cannot be brought in from here yet. Use File > Import to pick it with the file chooser.");
    const bytes = await window.openreel!.fs.readFileBytes(prepared.path);
    const file = new File([bytes], prepared.name, { type: mimeFor(prepared.name), lastModified: entry.mtimeMs || Date.now() });
    rememberNativePath(file, prepared.path);
    const result = await store.importMedia(file, onStage);
    if (!result.success || !result.actionId) throw new Error(result.error?.message ?? "The file could not be imported.");
    ids.push(result.actionId);
    // Logging metadata the camera or an editor wrote: embedded XMP and the sidecar next to the first file.
    const xmp = await desktop.readXmp(entry.clip?.segments[0]?.path ?? entry.path).catch(() => null);
    await setMediaMetadata([result.actionId], { ...(xmp ? xmpFieldsToMediaFields(xmp.fields) : {}), ...(xmp ? { xmpSource: xmp.source } : {}), sourcePath: prepared.path }, "Import metadata");
    return ids;
  }
  const segments = entry.clip ? entry.clip.segments.map((s) => s.path) : [entry.path];
  for (const segmentPath of segments) {
    const handle = await webFileHandle(segmentPath);
    if (!handle) throw new Error("The file is not available any more.");
    const file = await handle.getFile();
    const result = await store.importMedia(file, onStage);
    if (!result.success || !result.actionId) throw new Error(result.error?.message ?? "The file could not be imported.");
    ids.push(result.actionId);
    const fields = await webXmpFields(segmentPath, file);
    if (fields) await setMediaMetadata([result.actionId], { ...xmpFieldsToMediaFields(fields), xmpSource: "embedded" }, "Import metadata");
  }
  return ids;
}

/**
 * Import browser entries into the project, one at a time; each is one undoable import. The whole batch is one row in
 * the background-task panel (progress per entry, Cancel stops before the next entry, Retry re-runs only the entries
 * that failed). Each file also appears as its own import row from the media bridge.
 */
export async function importEntries(entries: readonly OpenReelBrowserEntry[], onStage: (message: string) => void = () => undefined): Promise<ImportReport> {
  const importable = entries.filter((e) => e.kind !== "dir");
  const report: ImportReport = { imported: 0, failed: [] };
  if (!importable.length) return report;
  const failedEntries: OpenReelBrowserEntry[] = [];
  const label = importable.length === 1 ? importable[0].name : `${importable.length} clips`;
  try {
    await backgroundTasks.track(
      {
        kind: "import",
        source: "media-browser",
        title: `Media Browser \u00b7 ${label}`,
        retry: () => void importEntries(failedEntries.length ? failedEntries : importable, onStage).catch(() => undefined),
      },
      async (ctx) => {
        for (let i = 0; i < importable.length; i++) {
          if (ctx.signal.aborted) throw new DOMException("Import cancelled.", "AbortError");
          const entry = importable[i];
          ctx.progress(i / importable.length, `${entry.name} (${i + 1}/${importable.length})`);
          try {
            await importOne(entry, (stage) => onStage(`${stage} \u00b7 ${entry.name} (${i + 1}/${importable.length})`));
            report.imported++;
          } catch (error) {
            failedEntries.push(entry);
            report.failed.push({ name: entry.name, reason: error instanceof Error ? error.message : "The import failed." });
          }
        }
        // Everything failed: show the row as failed (retryable). A partial failure keeps the row completed and says how many.
        if (!report.imported && report.failed.length) throw new Error(report.failed[0].reason);
        if (report.failed.length) ctx.progress(1, `${report.failed.length} failed`);
      },
    );
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError") && !report.failed.length) throw error;
  }
  if (report.imported) toast.success("Imported", `${report.imported} clip${report.imported === 1 ? "" : "s"} added to the project.`);
  for (const failure of report.failed) toast.warning(`Could not import ${failure.name}`, failure.reason);
  return report;
}

/** Write a sidecar `.xmp` next to the item's file (desktop). The media file itself is never rewritten. */
export async function writeSidecarForItem(mediaId: string): Promise<string | null> {
  const desktop = desktopBrowserBridge();
  const item = useProjectStore.getState().project.mediaLibrary.items.find((i) => i.id === mediaId);
  const filePath = item?.sourceFile?.path;
  if (!desktop || !item || !filePath) {
    toast.warning("Sidecar", "This clip has no file path on disk, so there is nowhere to write a sidecar.");
    return null;
  }
  try {
    const result = await desktop.writeSidecar({ path: filePath, fields: mediaFieldsToXmpFields(item) });
    return result.path;
  } catch (error) {
    toast.warning("Sidecar", error instanceof Error ? error.message : "The sidecar could not be written.");
    return null;
  }
}

/** Re-read embedded / sidecar XMP of an imported clip into the project (desktop). */
export async function rereadXmpForItem(mediaId: string): Promise<boolean> {
  const desktop = desktopBrowserBridge();
  const item = useProjectStore.getState().project.mediaLibrary.items.find((i) => i.id === mediaId);
  const filePath = item?.sourceFile?.path;
  if (!desktop || !filePath) {
    toast.warning("Read XMP", "Reading XMP needs the file on disk (desktop app).");
    return false;
  }
  const xmp = await desktop.readXmp(filePath).catch(() => null);
  if (!xmp) {
    toast.info("Read XMP", "No XMP was found in the file or next to it.");
    return false;
  }
  const outcome = await setMediaMetadata([mediaId], { ...xmpFieldsToMediaFields(xmp.fields), xmpSource: xmp.source }, "Read XMP");
  if (!outcome.success) toast.warning("Read XMP", outcome.message);
  return outcome.success;
}
