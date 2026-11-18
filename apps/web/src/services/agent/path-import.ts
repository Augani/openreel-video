import {
  HostFileError,
  type EditingHost,
  type ImportedFileRef,
  type ImportMediaFromPathOptions,
  type ImportMediaFromPathResult,
  type ProjectFileRef,
} from "@openreel/agent";
import { isRawFileName } from "@openreel/core";
import type { Project } from "@openreel/core/types/project";
import { useProjectStore } from "../../stores/project-store";
import { projectManager } from "../project-manager";
import { activateOpenedProject } from "../project-replacement";
import { requireLocalFileAccess, resolveOne } from "./path-access";

/**
 * Local-file operations behind the MCP path tools: import media by path, open a project file, save a
 * project to a path. The allowed-roots check happens in the main process (see path-access.ts); this
 * module feeds the results into the same pipelines the UI uses (importMedia, project load, save).
 */

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo",
  mxf: "application/mxf", mts: "video/mp2t", m2ts: "video/mp2t", ts: "video/mp2t", mpg: "video/mpeg", mpeg: "video/mpeg", wmv: "video/x-ms-wmv",
  flv: "video/x-flv", "3gp": "video/3gpp", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/opus",
  aif: "audio/aiff", aiff: "audio/aiff", wma: "audio/x-ms-wma", caf: "audio/x-caf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", tif: "image/tiff",
  tiff: "image/tiff", heic: "image/heic", heif: "image/heif", avif: "image/avif", svg: "image/svg+xml",
  dng: "image/x-adobe-dng", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3", nef: "image/x-nikon-nef", arw: "image/x-sony-arw",
  raf: "image/x-fuji-raf", orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2", braw: "application/octet-stream", r3d: "application/octet-stream",
};

/** Reading goes through one IPC ArrayBuffer, so very large files are left to the Assets panel. */
export const MAX_PATH_IMPORT_BYTES = 1024 * 1024 * 1024;

const baseName = (path: string): string => path.replace(/^.*[\\/]/, "");
const extOf = (path: string): string => baseName(path).split(".").pop()?.toLowerCase() ?? "";

function resolveBinId(project: Project, ref: string): string {
  const bins = project.bins ?? [];
  const byId = bins.find((bin) => bin.id === ref);
  if (byId) return byId.id;
  const byName = bins.filter((bin) => bin.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0].id;
  throw new HostFileError(
    "INVALID_PARAMS",
    byName.length > 1 ? `More than one bin is named "${ref}".` : `No bin "${ref}".`,
    byName.length > 1 ? "Use the bin's id (list_bins)." : "Create it with create_bin first, or call list_bins to see the names.",
  );
}

type ImportHost = Pick<EditingHost, "applyAction" | "proxies">;

export async function importMediaFromPaths(host: ImportHost, options: ImportMediaFromPathOptions): Promise<ImportMediaFromPathResult> {
  const access = requireLocalFileAccess();
  const wantsCopy = options.copyToProject === true || options.ingestPreset === "copy";
  const wantsProxies = options.createProxies === true || options.ingestPreset === "proxies";
  if (wantsCopy && !host.proxies?.desktop) {
    throw new HostFileError("UNSUPPORTED", "Copy to project is available on the desktop app only.", "Drop copyToProject / ingestPreset copy, or run OpenReel desktop.");
  }
  const binId = options.bin ? resolveBinId(useProjectStore.getState().project, options.bin) : undefined;

  const resolved = await access.resolve(options.paths, { mode: "read", recursive: options.recursive === true });
  const skipped: Array<{ path: string; code: ImportMediaFromPathResult["skipped"][number]["code"]; message: string }> = resolved.rejected.map((entry) => ({ ...entry }));
  const imported: ImportedFileRef[] = [];
  const seen = new Set<string>();

  for (const entry of resolved.resolved) {
    if (entry.kind !== "file" || seen.has(entry.realPath)) continue;
    seen.add(entry.realPath);
    const ext = extOf(entry.path);
    const mime = MIME_BY_EXT[ext];
    if (!mime) {
      skipped.push({ path: entry.path, code: "UNSUPPORTED_TYPE", message: `.${ext || "(none)"} is not a supported media type.` });
      continue;
    }
    if (entry.sizeBytes > MAX_PATH_IMPORT_BYTES) {
      skipped.push({ path: entry.path, code: "UNREADABLE", message: "The file is larger than 1 GiB; import it with the Assets panel instead." });
      continue;
    }
    let file: File;
    try {
      file = new File([(await access.readBytes(entry.realPath)) as unknown as BlobPart], baseName(entry.path), { type: mime });
    } catch (error) {
      skipped.push({ path: entry.path, code: "UNREADABLE", message: error instanceof Error ? error.message : "Could not read the file." });
      continue;
    }
    const result = await useProjectStore.getState().importMedia(file);
    if (!result.success || !result.actionId) {
      skipped.push({ path: entry.path, code: "UNSUPPORTED_TYPE", message: result.error?.message ?? "OpenReel could not decode this file." });
      continue;
    }
    const mediaId = result.actionId;
    // The bytes came over IPC, so the browser File has no disk path; record it so native decode, relink and copy work.
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          ...state.project.mediaLibrary,
          items: state.project.mediaLibrary.items.map((item) =>
            item.id === mediaId
              ? { ...item, sourceFile: { name: item.sourceFile?.name ?? file.name, size: item.sourceFile?.size ?? file.size, lastModified: item.sourceFile?.lastModified ?? 0, ...item.sourceFile, path: entry.realPath } }
              : item,
          ),
        },
      },
    }));
    const item = useProjectStore.getState().project.mediaLibrary.items.find((candidate) => candidate.id === mediaId);
    imported.push({
      mediaId,
      path: entry.path,
      name: item?.name ?? file.name,
      kind: isRawFileName(file.name) ? "raw" : (item?.type ?? "video"),
      durationSec: item?.metadata?.duration ?? 0,
      ...(item?.metadata?.width ? { width: item.metadata.width } : {}),
      ...(item?.metadata?.height ? { height: item.metadata.height } : {}),
      ...(item?.metadata?.frameRate ? { frameRate: item.metadata.frameRate } : {}),
      ...(item?.metadata?.codec ? { codec: item.metadata.codec } : {}),
    });
  }

  const warnings: string[] = [];
  const ids = imported.map((entry) => entry.mediaId);
  if (binId && ids.length) {
    const itemPatches = Object.fromEntries(ids.map((id) => [id, { binId }]));
    const outcome = await host.applyAction({
      type: "media/organize",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { label: "Move imported media to bin", itemPatches },
    });
    if (!outcome.success) warnings.push(`Imported but could not file in bin "${options.bin}": ${outcome.error?.message ?? "unknown error"}`);
  }
  if (wantsCopy && ids.length && host.proxies?.desktop) {
    try {
      const report = await host.proxies.desktop.copyToProject(ids);
      for (const entry of report.skipped) warnings.push(`Not copied to the project folder: ${entry.name} (${entry.reason})`);
    } catch (error) {
      warnings.push(`Imported but not copied to the project folder: ${error instanceof Error ? error.message : "copy failed"}`);
    }
  }
  if (wantsProxies && host.proxies) {
    const videoIds = imported.filter((entry) => entry.kind === "video").map((entry) => entry.mediaId);
    if (videoIds.length) {
      try {
        host.proxies.create(videoIds, "medium", false);
      } catch (error) {
        warnings.push(`Imported but proxies were not queued: ${error instanceof Error ? error.message : "proxy build failed"}`);
      }
    }
  }
  return { imported, skipped, ...(warnings.length ? { warnings } : {}) };
}

const PROJECT_EXTENSIONS = new Set(["oreel", "openreel", "json"]);
/** Saving only ever targets real project extensions, so overwrite:true cannot clobber arbitrary JSON files. */
const PROJECT_SAVE_EXTENSIONS = new Set(["oreel", "openreel"]);

const toProjectFileRef = (project: Project, path: string, sizeBytes?: number): ProjectFileRef => ({
  id: project.id,
  name: project.name,
  width: project.settings.width,
  height: project.settings.height,
  frameRate: project.settings.frameRate,
  modifiedAt: project.modifiedAt,
  path,
  ...(sizeBytes !== undefined ? { sizeBytes } : {}),
});

/** Open a project file by path: same load and save-target handling as File > Open, with no dialog. */
export async function openProjectFileByPath(path: string): Promise<ProjectFileRef> {
  const access = requireLocalFileAccess();
  if (!PROJECT_EXTENSIONS.has(extOf(path))) {
    throw new HostFileError("UNSUPPORTED_TYPE", `"${baseName(path)}" is not a project file.`, "Project files end in .oreel, .openreel or .json.");
  }
  const target = await resolveOne(access, path, "read");
  const bridge = window.openreel?.fs;
  if (!bridge) throw new HostFileError("UNSUPPORTED", "File access is only available in the OpenReel desktop app.");
  let content: string;
  try {
    content = await bridge.readFile(target.realPath);
  } catch (error) {
    throw new HostFileError("UNREADABLE", error instanceof Error ? error.message : "Could not read the project file.");
  }
  let project: Project;
  try {
    project = await projectManager.parseProjectContent(content);
  } catch (error) {
    throw new HostFileError("UNSUPPORTED_TYPE", error instanceof Error ? error.message : "Not a valid project file.", "Pass a project file saved by OpenReel (.oreel).");
  }
  await projectManager.ensureInitialized().catch(() => undefined);
  await activateOpenedProject({ project, fileHandle: { kind: "native", path: target.realPath } });
  return toProjectFileRef(useProjectStore.getState().project, target.path, target.sizeBytes);
}

/** Write the open project to `path` (no dialog) and make it the save target. */
export async function saveProjectToFile(path: string, options: { overwrite: boolean }): Promise<ProjectFileRef> {
  const access = requireLocalFileAccess();
  if (!PROJECT_SAVE_EXTENSIONS.has(extOf(path))) {
    throw new HostFileError("UNSUPPORTED_TYPE", `"${baseName(path)}" does not name a project file.`, "End the path in .oreel (or .openreel).");
  }
  const state = useProjectStore.getState();
  if (!state.hasOpenProject) throw new HostFileError("NO_PROJECT", "No project is open", "Call create_project or open_project_file first.");
  const result = await access.resolve([path], { mode: "write" });
  const rejected = result.rejected[0];
  if (rejected) throw new HostFileError(rejected.code, rejected.message);
  const target = result.resolved[0];
  if (!target) throw new HostFileError("INVALID_PARAMS", "Invalid destination path.");
  if (target.exists && !options.overwrite) {
    throw new HostFileError("INVALID_PARAMS", `A file already exists at ${target.path}.`, "Pass overwrite:true to replace it, or choose another path.");
  }
  await projectManager.ensureInitialized().catch(() => undefined);
  try {
    const snapshot = await projectManager.saveProjectToPath(target.realPath, state.getFullProject(), async () => useProjectStore.getState().getFullProject());
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2)).byteLength;
    return toProjectFileRef(snapshot, target.path, bytes);
  } catch (error) {
    throw new HostFileError("UNREADABLE", error instanceof Error ? error.message : "Could not write the project file.", "Check the folder is writable and the file is not open in another OpenReel window.");
  }
}
