import path from "node:path";
import type { DesktopIngestConfig, DesktopProxyProfile } from "../../../../../packages/core/src/types/project";

export interface IngestFolders {
  /** Folder holding the project file (or the app-data folder of an unsaved project). */
  projectDir: string;
  proxyDir: string;
  mediaDir: string;
  /** The project has a file on disk, so its folders sit beside it. */
  projectSaved: boolean;
}

/** A configured folder: absolute as given, relative to the project folder otherwise. */
function resolveConfigured(base: string, configured: string | undefined, fallbackName: string): string {
  const value = configured?.trim();
  if (!value) return path.join(base, fallbackName);
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

/**
 * Where a project's proxies and copied media live: `Proxies` and `Media` beside the project file,
 * unless the project's settings name other folders. A project that was never saved has no folder yet,
 * so its files go to a per-project folder in the app's data directory.
 */
export function resolveIngestFolders(args: {
  projectPath?: string | null;
  projectId: string;
  config?: DesktopIngestConfig | null;
  userDataDir: string;
}): IngestFolders {
  const safeId = args.projectId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "project";
  const projectSaved = Boolean(args.projectPath);
  const projectDir = args.projectPath ? path.dirname(path.resolve(args.projectPath)) : path.join(args.userDataDir, "Ingest", safeId);
  return {
    projectDir,
    proxyDir: resolveConfigured(projectDir, args.config?.proxyFolder, "Proxies"),
    mediaDir: resolveConfigured(projectDir, args.config?.mediaFolder, "Media"),
    projectSaved,
  };
}

/**
 * Where one proxy is written: the project's Proxies folder (the default), a "Proxies" folder next to the media
 * file, or a folder the preset names. A relative custom folder is taken relative to the project folder.
 */
export function proxyOutDir(profile: DesktopProxyProfile, projectProxyDir: string, srcPath: string, projectDir?: string): string {
  const dest = profile.destination;
  if (dest?.mode === "media") return path.join(path.dirname(path.resolve(srcPath)), "Proxies");
  if (dest?.mode === "custom" && dest.folder?.trim()) {
    const folder = dest.folder.trim();
    return path.isAbsolute(folder) ? path.normalize(folder) : path.resolve(projectDir ?? path.dirname(projectProxyDir), folder);
  }
  return projectProxyDir;
}

/** Names this app gives proxy files: `<name>_<size>_proxy.(mov|mp4)` and the `.preview.mp4` twin. */
export function isOwnProxyFileName(fileName: string): boolean {
  return /_(half|quarter|720p|1080p|full|w\d+)(-(lt|422|sq|lb|bn|tc|na))*_proxy(\.preview)?\.(mov|mp4)$/i.test(fileName);
}

/** The H.264 preview twin that rides along with a ProRes proxy (not a proxy of its own). */
export const isPreviewTwinName = (fileName: string): boolean => /\.preview\.[a-z0-9]+$/i.test(fileName);

/**
 * Files the proxy read-back channel may open: video containers only. A project file is untrusted, so a
 * proxy path pointing at a document or a key file is refused; relinked camera proxies keep their own names.
 */
export const isReadableProxyPath = (fileName: string): boolean => /\.(mov|mp4|m4v|mkv|webm|mxf)$/i.test(fileName);
