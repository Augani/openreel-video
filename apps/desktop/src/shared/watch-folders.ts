import { z } from "zod";

/**
 * Watch folders (desktop). Shared by the main process, the preload bridge and (mirrored in
 * apps/web/src/types/global.d.ts) the renderer.
 *
 * An ingest folder imports media that appears in it into the open project. An export folder
 * renders media (and optionally project) files that appear in it with an export preset into an
 * output folder, then moves the source into `done/` or `failed/`.
 */

export const WATCH_FOLDER_KINDS = ["ingest", "export"] as const;
export type WatchFolderKind = (typeof WATCH_FOLDER_KINDS)[number];

/** Presets an export folder can render. Same ids as the Export dialog's quick presets. */
export const WATCH_EXPORT_PRESET_IDS = ["mp4", "1080p-high", "1080p-60", "4k", "wav"] as const;
export type WatchExportPresetId = (typeof WATCH_EXPORT_PRESET_IDS)[number];

export interface WatchFolderConfig {
  id: string;
  kind: WatchFolderKind;
  /** Absolute path of the watched folder. Only ever set from the native folder dialog (or a seeded config file). */
  path: string;
  paused: boolean;
  /** Ingest: bin (by name) the imported media goes into. Created when missing. Empty = project root. */
  bin: string;
  /** Ingest: also build preview proxies for what is imported. */
  createProxies: boolean;
  /** Export: preset id from WATCH_EXPORT_PRESET_IDS. */
  presetId: string;
  /** Export: where rendered files go. Absolute. */
  outputDir: string;
  /** Export: also render `.oreel` / `.openreel` project files through the editor's export queue. */
  includeProjects: boolean;
  /** False until the files already in the folder when it was added have been recorded (and skipped, unless processExisting). */
  baselined: boolean;
  /** Also process the files that are already in the folder when it is added. */
  processExisting: boolean;
}

export const watchFolderPatchSchema = z
  .object({
    paused: z.boolean(),
    bin: z.string().max(200),
    createProxies: z.boolean(),
    presetId: z.enum(WATCH_EXPORT_PRESET_IDS),
    includeProjects: z.boolean(),
    processExisting: z.boolean(),
  })
  .partial()
  .strict();
export type WatchFolderPatch = z.infer<typeof watchFolderPatchSchema>;

export const watchFolderAddArgsSchema = z.object({ kind: z.enum(WATCH_FOLDER_KINDS) });
export const watchFolderIdArgsSchema = z.object({ id: z.string().min(1) });
export const watchFolderUpdateArgsSchema = z.object({ id: z.string().min(1), patch: watchFolderPatchSchema });
export const watchItemIdArgsSchema = z.object({ itemId: z.string().min(1) });

export type WatchItemState =
  | "detecting" // seen, waiting for the size to stop changing
  | "queued"
  | "waiting" // ingest: no project is open in the editor yet
  | "running"
  | "done"
  | "failed"
  | "duplicate"
  | "cancelled";

export interface WatchItem {
  id: string;
  folderId: string;
  name: string;
  path: string;
  state: WatchItemState;
  /** 0..1 while running, null when unknown. */
  progress: number | null;
  detail?: string;
  error?: string;
  outputPath?: string;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
}

export type WatchFolderState = "watching" | "paused" | "missing" | "error";

export interface WatchFolderStatus {
  state: WatchFolderState;
  message?: string;
  detecting: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  duplicates: number;
}

export interface WatchFoldersSnapshot {
  folders: Array<{ config: WatchFolderConfig; status: WatchFolderStatus }>;
  /** Newest first, capped. */
  items: WatchItem[];
}
