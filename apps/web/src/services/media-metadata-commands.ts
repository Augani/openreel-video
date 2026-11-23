import type { MediaItem, MediaItemPatch } from "@openreel/core";
import { parseKeywordText } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import type { CommandOutcome } from "./premiere-edit-commands";
import { organize } from "./project-panel-commands";

const project = () => useProjectStore.getState().project;

/** What the Metadata panel and the importers write: any subset of the XMP-style logging fields. */
export interface MediaMetadataEdit {
  description?: string;
  keywords?: string[];
  scene?: string;
  shot?: string;
  take?: string;
  goodTake?: boolean;
  logComment?: string;
  reel?: string;
  xmpSource?: "embedded" | "sidecar" | null;
  /** Desktop: where the file lives, so a sidecar can be written and a reopened project finds it. */
  sourcePath?: string;
}

/** Only the fields that actually differ, so an unchanged edit is not an undo step. */
function metadataPatch(item: MediaItem, edit: MediaMetadataEdit): MediaItemPatch {
  const patch: MediaItemPatch = {};
  const text = ["description", "scene", "shot", "take", "logComment", "reel"] as const;
  for (const field of text) {
    const value = edit[field];
    if (value !== undefined && (item[field] ?? "") !== value) patch[field] = value;
  }
  if (edit.keywords !== undefined) {
    const words = parseKeywordText(edit.keywords.join(","));
    if ((item.keywords ?? []).join("\u0000") !== words.join("\u0000")) patch.keywords = words;
  }
  if (edit.goodTake !== undefined && !!item.goodTake !== edit.goodTake) patch.goodTake = edit.goodTake;
  if (edit.xmpSource !== undefined && (item.xmpSource ?? null) !== edit.xmpSource) patch.xmpSource = edit.xmpSource;
  if (edit.sourcePath && item.sourceFile?.path !== edit.sourcePath)
    patch.sourceFile = { name: item.sourceFile?.name ?? item.name, size: item.sourceFile?.size ?? item.metadata.fileSize, lastModified: item.sourceFile?.lastModified ?? Date.now(), ...(item.sourceFile?.folder ? { folder: item.sourceFile.folder } : {}), path: edit.sourcePath };
  return patch;
}

/** Edit XMP-style metadata on one or more media items as ONE undo step. */
export function setMediaMetadata(mediaIds: readonly string[], edit: MediaMetadataEdit, label = "Edit metadata"): Promise<CommandOutcome> {
  const itemPatches: Record<string, MediaItemPatch> = {};
  for (const id of mediaIds) {
    const item = project().mediaLibrary.items.find((i) => i.id === id);
    if (!item) continue;
    const patch = metadataPatch(item, edit);
    if (Object.keys(patch).length) itemPatches[id] = patch;
  }
  if (!Object.keys(itemPatches).length) return Promise.resolve({ success: true });
  return organize({ label, itemPatches });
}
