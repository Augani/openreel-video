import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { importTimelineFile, applyTimelineImport } from "@openreel/core/interchange/index";
import { HostFileError, type EditingHost, type HostFileErrorCode } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Local-file tools: bring the user's footage and project files in by absolute path, open and save
 * project files, and import a timeline file. They make a windowless workflow possible (no file
 * picker, no drag and drop).
 *
 * Access rules live where the file access happens (the desktop main process): every path is
 * resolved with symlinks followed and must sit inside the allowed folders (Settings > MCP). Errors
 * carry a stable `code` and a `hint` that names the fix.
 */

const str: JSONSchema = { type: "string" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const DEFAULT_HINTS: Record<HostFileErrorCode, string> = {
  NO_PROJECT: "Call create_project (or open_project_file) first.",
  NO_WINDOW: "Open the OpenReel window and retry.",
  NOT_FOUND: "Check the path: pass an absolute path to an existing file or folder.",
  OUTSIDE_ALLOWED_ROOTS:
    "Move the file into an allowed folder (get_app_state lists them in mcp.allowedRoots) or add its folder in OpenReel Settings > MCP > Allowed folders.",
  UNSUPPORTED_TYPE: "Pass a video, audio, image or camera RAW file (or a folder of them).",
  UNREADABLE: "The file exists but cannot be read. Check its permissions and that it is not locked by another app.",
  UNSUPPORTED: "This needs the OpenReel desktop app.",
  INVALID_PARAMS: "Check the arguments against the tool's input schema.",
};

export function fileFailure(code: HostFileErrorCode, message: string, hint?: string, data?: unknown): ToolResult {
  const finalHint = hint ?? DEFAULT_HINTS[code];
  return {
    ok: false,
    summary: `${message} ${finalHint}`.trim(),
    error: { code, message, hint: finalHint },
    ...(data !== undefined ? { data } : {}),
  };
}

function fromError(error: unknown): ToolResult {
  if (error instanceof HostFileError) return fileFailure(error.code, error.message, error.hint);
  const message = error instanceof Error ? error.message : "The operation failed";
  if (/no project is open/i.test(message)) return fileFailure("NO_PROJECT", "No project is open");
  return fileFailure("UNREADABLE", message, "Retry; if it keeps failing, check the file and the OpenReel window.");
}

const noProject = (): ToolResult => fileFailure("NO_PROJECT", "No project is open");

function hasOpenProject(host: EditingHost): boolean {
  try {
    host.requireOpenProject();
    return true;
  } catch {
    return false;
  }
}

const PROJECT_EXTENSIONS = ["oreel", "openreel", "json"] as const;
/** Save targets are limited to real project extensions: overwrite:true must not replace arbitrary .json files. */
const PROJECT_SAVE_EXTENSIONS = ["oreel", "openreel"] as const;
const extensionOf = (p: string): string => p.replace(/^.*[\\/]/, "").split(".").pop()?.toLowerCase() ?? "";
const isAbsolutePath = (p: string): boolean => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");

function readPath(args: Record<string, unknown>, field = "path"): { ok: true; path: string } | { ok: false; result: ToolResult } {
  const value = args[field];
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, result: fileFailure("INVALID_PARAMS", `${field} is required.`, `Pass ${field} as an absolute path string.`) };
  }
  if (!isAbsolutePath(value.trim())) {
    return { ok: false, result: fileFailure("INVALID_PARAMS", `${field} must be an absolute path.`, "Pass the full path, starting with / (macOS, Linux) or a drive letter (Windows).") };
  }
  return { ok: true, path: value.trim() };
}

const INGEST_PRESETS = ["none", "proxies", "copy"] as const;

export const PATH_TOOLS: RegisteredTool[] = [
  {
    name: "import_media_from_path",
    domain: "media",
    title: "Import media from path",
    description:
      'Import local video, audio, image and camera RAW files into the media library by absolute path. `paths` takes files and/or folders (folders import their media files; recursive:true includes subfolders). Every path is checked against the allowed folders (Settings > MCP; get_app_state lists them): symlinks are resolved, so a link that leaves an allowed folder is refused. Optional: copyToProject (desktop: also copy into the project\'s Media folder, originals untouched), ingestPreset none|proxies|copy for this import, createProxies (build preview proxies), bin (bin id or name to file the items in). Returns data.imported[{mediaId, path, name, kind video|audio|image|raw, durationSec, width, height, frameRate, codec}] and data.skipped[{path, code NOT_FOUND|OUTSIDE_ALLOWED_ROOTS|UNSUPPORTED_TYPE|UNREADABLE, message}]; use a mediaId with add_clip. Requires an open project (create_project first). Can take a while for big folders.',
    inputSchema: obj(
      {
        paths: { type: "array", items: str, minItems: 1, maxItems: 500, description: "Absolute file or folder paths" },
        recursive: { ...bool, default: false },
        copyToProject: { ...bool, default: false },
        ingestPreset: { type: "string", enum: [...INGEST_PRESETS] },
        createProxies: { ...bool, default: false },
        bin: { ...str, description: "Bin id or name" },
      },
      ["paths"],
    ),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      if (typeof host.importMediaFromPath !== "function") {
        return fileFailure("UNSUPPORTED", "import_media_from_path is not available in this host.", "It needs the OpenReel desktop app.");
      }
      const paths = args.paths;
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > 500 || paths.some((p) => typeof p !== "string" || !p.trim())) {
        return fileFailure("INVALID_PARAMS", "paths must be 1 to 500 non-empty path strings.", "Pass paths as an array of absolute file or folder paths.");
      }
      const relative = (paths as string[]).find((p) => !isAbsolutePath(p.trim()));
      if (relative) return fileFailure("INVALID_PARAMS", `"${relative}" is not an absolute path.`, "Pass full paths starting with / (macOS, Linux) or a drive letter (Windows).");
      for (const key of ["recursive", "copyToProject", "createProxies"] as const) {
        if (args[key] !== undefined && typeof args[key] !== "boolean") return fileFailure("INVALID_PARAMS", `${key} must be true or false.`);
      }
      if (args.ingestPreset !== undefined && !(INGEST_PRESETS as readonly string[]).includes(String(args.ingestPreset))) {
        return fileFailure("INVALID_PARAMS", `ingestPreset must be one of ${INGEST_PRESETS.join(", ")}.`);
      }
      if (args.bin !== undefined && typeof args.bin !== "string") return fileFailure("INVALID_PARAMS", "bin must be a bin id or name.");
      if (!hasOpenProject(host)) return noProject();
      try {
        const result = await host.importMediaFromPath({
          paths: (paths as string[]).map((p) => p.trim()),
          ...(args.recursive === true ? { recursive: true } : {}),
          ...(args.copyToProject === true ? { copyToProject: true } : {}),
          ...(typeof args.ingestPreset === "string" ? { ingestPreset: args.ingestPreset } : {}),
          ...(args.createProxies === true ? { createProxies: true } : {}),
          ...(typeof args.bin === "string" && args.bin.trim() ? { bin: args.bin.trim() } : {}),
        });
        const data = { imported: result.imported, skipped: result.skipped, ...(result.warnings?.length ? { warnings: result.warnings } : {}) };
        if (result.imported.length === 0) {
          const first = result.skipped[0];
          return fileFailure(first?.code ?? "NOT_FOUND", first?.message ?? "Nothing was imported.", undefined, data);
        }
        const skipped = result.skipped.length ? `, ${result.skipped.length} skipped` : "";
        return { ok: true, summary: `Imported ${result.imported.length} file(s)${skipped}`, data };
      } catch (error) {
        return fromError(error);
      }
    },
  },
  {
    name: "open_project_file",
    domain: "project",
    title: "Open project file",
    description:
      "Open a saved project file (.oreel, .openreel or .json) by absolute path and make it the active project, replacing whatever is open now (the current project is saved first, so nothing is lost). The path must be inside the allowed folders (Settings > MCP; get_app_state lists them). Offline media shows as relinkable; use import_media_from_path to bring files back. Destructive to the open project's session state: requires confirmation.",
    inputSchema: obj({ path: { ...str, description: "Absolute path of the project file" } }, ["path"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      if (typeof host.openProjectFile !== "function") {
        return fileFailure("UNSUPPORTED", "open_project_file is not available in this host.", "It needs the OpenReel desktop app.");
      }
      const requested = readPath(args);
      if (!requested.ok) return requested.result;
      if (!(PROJECT_EXTENSIONS as readonly string[]).includes(extensionOf(requested.path))) {
        return fileFailure("UNSUPPORTED_TYPE", `"${requested.path}" is not a project file.`, "Project files end in .oreel, .openreel or .json.");
      }
      try {
        const ref = await host.openProjectFile(requested.path);
        return { ok: true, summary: `Opened project "${ref.name}" from ${ref.path}`, data: ref };
      } catch (error) {
        return fromError(error);
      }
    },
  },
  {
    name: "save_project_as",
    domain: "project",
    title: "Save project as",
    description:
      "Write the active project to a project file at an absolute path (.oreel or .openreel) and make that file the project's save target, so later saves update it. The path must be inside the allowed folders (Settings > MCP). An existing file is not replaced unless overwrite:true. Requires an open project. Unlike save_project (which only keeps the app's autosave), this produces a file you can hand back or reopen with open_project_file.",
    inputSchema: obj(
      { path: { ...str, description: "Absolute destination path" }, overwrite: { ...bool, default: false } },
      ["path"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      if (typeof host.saveProjectAs !== "function") {
        return fileFailure("UNSUPPORTED", "save_project_as is not available in this host.", "It needs the OpenReel desktop app.");
      }
      const requested = readPath(args);
      if (!requested.ok) return requested.result;
      if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") return fileFailure("INVALID_PARAMS", "overwrite must be true or false.");
      if (!(PROJECT_SAVE_EXTENSIONS as readonly string[]).includes(extensionOf(requested.path))) {
        return fileFailure("UNSUPPORTED_TYPE", `"${requested.path}" does not name a project file.`, "End the path in .oreel (or .openreel).");
      }
      if (!hasOpenProject(host)) return noProject();
      try {
        const ref = await host.saveProjectAs(requested.path, { overwrite: args.overwrite === true });
        return { ok: true, summary: `Saved project "${ref.name}" to ${ref.path}`, data: ref };
      } catch (error) {
        return fromError(error);
      }
    },
  },
  {
    name: "import_timeline_from_path",
    domain: "project",
    title: "Import timeline from path",
    description:
      'Import a timeline file by absolute path: Final Cut Pro XML (xmeml, from Premiere / Resolve / FCP7), FCPXML, OpenTimelineIO (.otio) or AAF. format "auto" (default) detects it; naming a format that does not match the file is an error. EDL files cannot be imported (export xmeml, FCPXML or OTIO instead). Media is relinked to the media bin by filename (import_media_from_path first); files not in the bin become offline placeholders listed in `unmatched`. mode "replace" (default) swaps video/audio tracks and markers, "append" adds the imported tracks. dryRun:true only reports. The path must be inside the allowed folders. One undo step. Replaces the timeline in replace mode: requires confirmation.',
    inputSchema: obj(
      {
        path: { ...str, description: "Absolute path of the timeline file" },
        format: { type: "string", enum: ["auto", "xmeml", "fcpxml", "otio", "aaf", "edl"], default: "auto" },
        mode: { type: "string", enum: ["replace", "append"] },
        dryRun: bool,
      },
      ["path"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      if (!host.files) {
        return fileFailure("UNSUPPORTED", "import_timeline_from_path is not available in this host.", "It needs the OpenReel desktop app.");
      }
      const requested = readPath(args);
      if (!requested.ok) return requested.result;
      const format = args.format === undefined ? "auto" : String(args.format);
      if (!["auto", "xmeml", "fcpxml", "otio", "aaf", "edl"].includes(format)) {
        return fileFailure("INVALID_PARAMS", "format must be auto, xmeml, fcpxml, otio, aaf or edl.");
      }
      if (format === "edl" || extensionOf(requested.path) === "edl") {
        return fileFailure("UNSUPPORTED", "EDL files cannot be imported.", "Export xmeml, FCPXML or OTIO from the source editor and import that instead.");
      }
      if (!hasOpenProject(host)) return noProject();
      try {
        const resolved = await host.files.resolve([requested.path], { mode: "read" });
        const rejected = resolved.rejected[0];
        if (rejected) return fileFailure(rejected.code, rejected.message);
        const entry = resolved.resolved.find((file) => file.kind === "file");
        if (!entry) return fileFailure("NOT_FOUND", "No file exists at that path.");
        const bytes = await host.files.readBytes(entry.realPath);
        const mode = args.mode === "append" ? "append" : "replace";
        const project = host.getProject();
        let result;
        try {
          result = importTimelineFile(bytes, { mediaItems: project.mediaLibrary.items });
        } catch (error) {
          return fileFailure(
            "UNSUPPORTED_TYPE",
            error instanceof Error ? error.message : "The file is not a timeline OpenReel can import.",
            "Supported: xmeml (Premiere / Resolve / FCP7 XML), FCPXML, OTIO and AAF.",
          );
        }
        if (format !== "auto" && result.format !== format) {
          return fileFailure("INVALID_PARAMS", `The file is ${result.format}, not ${format}.`, `Pass format "${result.format}" or "auto".`);
        }
        const report = {
          format: result.format,
          sequenceName: result.sequenceName,
          clipCount: result.clipCount,
          trackCount: result.tracks.length,
          markerCount: result.markers.length,
          matched: result.matched,
          unmatched: result.unmatched,
          nestedSequences: result.nests?.map((nest) => nest.name) ?? [],
          multicamSources: result.multicamSources?.map((source) => source.name) ?? [],
          warnings: result.warnings,
          path: requested.path,
        };
        if (args.dryRun === true) {
          return { ok: true, summary: `Dry run: ${result.clipCount} clips on ${result.tracks.length} tracks`, data: { ...report, applied: false } };
        }
        if (result.clipCount === 0) return fileFailure("UNSUPPORTED_TYPE", "The file contains no importable clips.", "Check that the sequence has clips on video or audio tracks.");
        const outcome = await host.applyAction({
          type: "project/applyEditSnapshot",
          id: genId(),
          timestamp: Date.now(),
          params: { snapshot: editSnapshot(applyTimelineImport(project, result, mode)) },
        });
        if (!outcome.success) return fileFailure("UNREADABLE", outcome.error?.message ?? "The import failed", "Retry; the project was not changed.");
        return {
          ok: true,
          summary: `Imported ${result.clipCount} clips on ${result.tracks.length} tracks (${mode}); ${result.unmatched.length} media file(s) unmatched`,
          data: { ...report, applied: true, mode },
        };
      } catch (error) {
        return fromError(error);
      }
    },
  },
];
