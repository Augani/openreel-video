import type { Project, MediaBin, MediaItem, SmartBin } from "@openreel/core/types/project";
import {
  MEDIA_LABELS,
  binDeletionImpact,
  binPath,
  binSubtreeIds,
  binsOf,
  childBins,
  MEDIA_COLUMNS,
  computeMediaUsage,
  createSubclipItem,
  filterMediaItems,
  isMediaColumnId,
  mediaColumnText,
  parseMediaLabel,
  uniqueBinName,
} from "@openreel/core/media/bins";
import {
  smartBinItems,
  smartBinsOf,
  uniqueSmartBinName,
} from "@openreel/core/media/smart-bins";
import { DEINTERLACE_MODES, FIELD_ORDERS, validateInterpretation, type DeinterlaceMode, type FieldOrder } from "@openreel/core/media/interpretation";
import type { ClipLabelPatch, MediaItemPatch } from "@openreel/core/actions/handlers/media-organize";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Project-panel tools: bins, label colours and subclips. Each call is ONE
 * `media/organize` action, so ONE undo step, and is the same action the
 * Project panel dispatches.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const strings: JSONSchema = { type: "array", items: str };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const LABEL_DOC = `Label colour id or name: ${MEDIA_LABELS.map((l) => l.id).join(", ")}; "none" clears it.`;

function ids(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw new Error(`${name} must be an array of strings.`);
  return value as string[];
}

/** Resolve a bin by id or (case-insensitive) name; "root" / "" is the project root. */
function resolveBin(project: Project, ref: unknown, label = "bin"): string | undefined {
  if (ref === undefined || ref === null || ref === "" || ref === "root") return undefined;
  if (typeof ref !== "string") throw new Error(`${label} must be a bin id or name.`);
  const bins = binsOf(project);
  const byId = bins.find((b) => b.id === ref);
  if (byId) return byId.id;
  const byName = bins.filter((b) => b.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) throw new Error(`More than one bin is named "${ref}"; use its id.`);
  throw new Error(`No bin "${ref}". Use list_bins to see ids.`);
}

function resolveMedia(project: Project, mediaIds: string[]): MediaItem[] {
  return mediaIds.map((id) => {
    const item = project.mediaLibrary.items.find((m) => m.id === id);
    if (!item) throw new Error(`Media not found: ${id}`);
    return item;
  });
}

async function organize(
  host: EditingHost,
  params: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: ToolResult }> {
  const result = await host.applyAction({
    type: "media/organize",
    id: genId(),
    timestamp: Date.now(),
    params,
  });
  if (!result.success)
    return {
      ok: false,
      error: fail(result.error?.message ?? "The change failed", result.error?.code ?? "ACTION_FAILED"),
    };
  return { ok: true };
}

const guarded =
  (run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult): RegisteredTool["handler"] =>
  async (args, host) => {
    try {
      host.requireOpenProject();
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request");
    }
  };

const describeBin = (project: Project, bin: MediaBin) => ({
  id: bin.id,
  name: bin.name,
  parentId: bin.parentId ?? null,
  path: binPath(binsOf(project), bin.id).map((b) => b.name).join("/"),
  label: bin.label ?? null,
  itemCount: project.mediaLibrary.items.filter((i) => i.binId === bin.id).length,
  childBinCount: childBins(binsOf(project), bin.id).length,
});

export const BIN_TOOLS: RegisteredTool[] = [
  {
    name: "list_bins",
    domain: "media",
    title: "List bins",
    description:
      "List the Project panel's bins (nested folders) with their ids, paths, label colours and item counts, plus how many media items sit at the project root.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((_args, host) => {
      const project = host.getProject();
      const bins = binsOf(project).map((b) => describeBin(project, b));
      return ok(`${bins.length} bin(s)`, {
        bins,
        rootItemCount: project.mediaLibrary.items.filter((i) => !i.binId).length,
      });
    }),
  },
  {
    name: "create_bin",
    domain: "media",
    title: "Create bin",
    description:
      'Create a bin (folder) in the media library, optionally inside another bin ("parent": id or name) and optionally filling it with existing media ("mediaIds") like "New bin from selection". One undo step.',
    inputSchema: obj(
      {
        name: { ...str, description: "Bin name; made unique among siblings if it already exists." },
        parent: { ...str, description: 'Parent bin id or name; omit or "root" for top level.' },
        mediaIds: { ...strings, description: "Media to move into the new bin." },
        label: { ...str, description: LABEL_DOC },
      },
      ["name"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      if (typeof args.name !== "string" || !args.name.trim()) return fail("name is required.");
      const parentId = resolveBin(project, args.parent, "parent");
      const mediaIds = ids(args.mediaIds, "mediaIds");
      resolveMedia(project, mediaIds);
      const label = args.label === undefined ? undefined : parseMediaLabel(args.label);
      if (args.label !== undefined && label === undefined) return fail(`Unknown label "${String(args.label)}".`);
      const bins = binsOf(project);
      const bin: MediaBin = {
        id: genId(),
        name: uniqueBinName(bins, parentId, args.name.trim()),
        ...(parentId ? { parentId } : {}),
        ...(label ? { label } : {}),
      };
      const itemPatches: Record<string, MediaItemPatch> = {};
      for (const id of mediaIds) itemPatches[id] = { binId: bin.id };
      const result = await organize(host, {
        label: mediaIds.length ? "New bin from selection" : "New bin",
        bins: [...bins, bin],
        ...(mediaIds.length ? { itemPatches } : {}),
      });
      if (!result.ok) return result.error;
      return ok(`Created bin "${bin.name}"${mediaIds.length ? ` with ${mediaIds.length} item(s)` : ""}`, {
        binId: bin.id,
        name: bin.name,
        moved: mediaIds.length,
      });
    }),
  },
  {
    name: "move_to_bin",
    domain: "media",
    title: "Move to bin",
    description:
      'Move media items (and/or whole bins) into a bin, or back to the project root ("bin": "root" or omitted). Bins cannot be moved into themselves. One undo step.',
    inputSchema: obj({
      mediaIds: { ...strings, description: "Media items to move." },
      binIds: { ...strings, description: "Bins to move (nest) into the destination." },
      bin: { ...str, description: 'Destination bin id or name; "root" for the top level.' },
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const mediaIds = ids(args.mediaIds, "mediaIds");
      const binIds = ids(args.binIds, "binIds");
      if (!mediaIds.length && !binIds.length) return fail("Give mediaIds and/or binIds to move.");
      const dest = resolveBin(project, args.bin, "bin");
      resolveMedia(project, mediaIds);
      const bins = binsOf(project);
      for (const id of binIds) {
        if (!bins.some((b) => b.id === id)) throw new Error(`Bin not found: ${id}`);
        if (dest && binSubtreeIds(bins, id).has(dest)) throw new Error("A bin cannot be moved into itself.");
      }
      const moving = new Set(binIds);
      const nextBins = bins.map((b) => {
        if (!moving.has(b.id)) return b;
        const { parentId: _parent, ...rest } = b;
        void _parent;
        return dest ? { ...rest, parentId: dest } : rest;
      });
      const itemPatches: Record<string, MediaItemPatch> = {};
      for (const id of mediaIds) itemPatches[id] = { binId: dest ?? null };
      const where = dest ? `"${bins.find((b) => b.id === dest)!.name}"` : "the project root";
      const result = await organize(host, {
        label: "Move to bin",
        ...(binIds.length ? { bins: nextBins } : {}),
        ...(mediaIds.length ? { itemPatches } : {}),
      });
      if (!result.ok) return result.error;
      return ok(`Moved ${mediaIds.length} item(s) and ${binIds.length} bin(s) to ${where}`, {
        moved: mediaIds.length,
        binsMoved: binIds.length,
        binId: dest ?? null,
      });
    }),
  },
  {
    name: "rename_bin",
    domain: "media",
    title: "Rename bin",
    description: "Rename a bin. One undo step.",
    inputSchema: obj({ bin: str, name: str }, ["bin", "name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const id = resolveBin(project, args.bin);
      if (!id) return fail("bin is required.");
      if (typeof args.name !== "string" || !args.name.trim()) return fail("name is required.");
      const bins = binsOf(project);
      const result = await organize(host, {
        label: "Rename bin",
        bins: bins.map((b) => (b.id === id ? { ...b, name: (args.name as string).trim() } : b)),
      });
      if (!result.ok) return result.error;
      return ok(`Renamed bin to "${(args.name as string).trim()}"`, { binId: id });
    }),
  },
  {
    name: "delete_bin",
    domain: "media",
    title: "Delete bin",
    description:
      "Delete a bin together with its nested bins, every media item inside, and the timeline clips that use that media. Pass confirm:true to proceed; without it the tool only reports what would be deleted. One undo step restores everything.",
    inputSchema: obj({ bin: str, confirm: bool }, ["bin"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const id = resolveBin(project, args.bin);
      if (!id) return fail("bin is required.");
      const impact = binDeletionImpact(project, id);
      const summary = `${impact.binIds.length} bin(s), ${impact.mediaIds.length} media item(s) and ${impact.clipCount} timeline clip(s)`;
      if (args.confirm !== true)
        return ok(`Would delete ${summary}. Call again with confirm:true to proceed.`, { ...impact, deleted: false });
      const doomed = new Set(impact.binIds);
      const result = await organize(host, {
        label: "Delete bin",
        bins: binsOf(project).filter((b) => !doomed.has(b.id)),
        removeItemIds: impact.mediaIds,
        removeClips: true,
      });
      if (!result.ok) return result.error;
      return ok(`Deleted ${summary}`, { ...impact, deleted: true });
    }),
  },
  {
    name: "set_label",
    domain: "media",
    title: "Set label colour",
    description: `Set the label colour of media items, timeline clips and/or bins. ${LABEL_DOC} For clips "inherit" goes back to following the media's label. Labels show as colour chips in the Project panel and as clip colour on the timeline. One undo step.`,
    inputSchema: obj(
      {
        label: { ...str, description: LABEL_DOC },
        mediaIds: strings,
        clipIds: strings,
        binIds: strings,
      },
      ["label"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const mediaIds = ids(args.mediaIds, "mediaIds");
      const clipIds = ids(args.clipIds, "clipIds");
      const binIds = ids(args.binIds, "binIds");
      if (!mediaIds.length && !clipIds.length && !binIds.length) return fail("Give mediaIds, clipIds and/or binIds.");
      const inherit = args.label === "inherit";
      const parsed = inherit ? null : parseMediaLabel(args.label);
      if (parsed === undefined) return fail(`Unknown label "${String(args.label)}". ${LABEL_DOC}`);
      if (inherit && (mediaIds.length || binIds.length))
        return fail('"inherit" only applies to clips.');
      resolveMedia(project, mediaIds);
      const itemPatches: Record<string, MediaItemPatch> = {};
      for (const id of mediaIds) itemPatches[id] = { label: parsed };
      const known = new Set(project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
      for (const id of clipIds) if (!known.has(id)) throw new Error(`Clip not found: ${id}`);
      const clipLabels: Record<string, ClipLabelPatch> = {};
      for (const id of clipIds) clipLabels[id] = inherit ? "inherit" : parsed;
      const bins = binsOf(project);
      for (const id of binIds) if (!bins.some((b) => b.id === id)) throw new Error(`Bin not found: ${id}`);
      const binSet = new Set(binIds);
      const result = await organize(host, {
        label: "Set label",
        ...(mediaIds.length ? { itemPatches } : {}),
        ...(clipIds.length ? { clipLabels } : {}),
        ...(binIds.length
          ? {
              bins: bins.map((b) => {
                if (!binSet.has(b.id)) return b;
                const { label: _old, ...rest } = b;
                void _old;
                return parsed ? { ...rest, label: parsed } : rest;
              }),
            }
          : {}),
      });
      if (!result.ok) return result.error;
      return ok(
        `Set label ${inherit ? "to inherit" : (parsed ?? "none")} on ${mediaIds.length} media, ${clipIds.length} clip(s), ${binIds.length} bin(s)`,
        { label: inherit ? "inherit" : parsed, media: mediaIds.length, clips: clipIds.length, bins: binIds.length },
      );
    }),
  },
  {
    name: "set_media_log",
    domain: "media",
    title: "Set media log metadata",
    description:
      'Edit the Project panel logging columns on media items: "scene", "shot", "take" (free text, "" clears), "goodTake" (boolean flag), plus "comment", "description" (the log note), XMP-style "keywords" (list; replaces, [] clears), "logComment" and "reel" (tape name). Applies to every id in mediaIds. One undo step.',
    inputSchema: obj(
      {
        mediaIds: { ...strings, description: "Media items to edit." },
        scene: str,
        shot: str,
        take: str,
        goodTake: bool,
        comment: str,
        description: str,
        keywords: { ...strings, description: "Replace the keywords (dc:subject); an empty list clears them." },
        logComment: str,
        reel: str,
      },
      ["mediaIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const mediaIds = ids(args.mediaIds, "mediaIds");
      if (!mediaIds.length) return fail("Give at least one media id.");
      resolveMedia(project, mediaIds);
      const patch: MediaItemPatch = {};
      for (const field of ["scene", "shot", "take", "comment", "description", "logComment", "reel"] as const) {
        const value = args[field];
        if (value === undefined) continue;
        if (typeof value !== "string") return fail(`${field} must be a string.`);
        patch[field] = field === "comment" || field === "description" || field === "logComment" ? value : value.trim();
      }
      if (args.keywords !== undefined) {
        if (!Array.isArray(args.keywords) || args.keywords.some((k) => typeof k !== "string")) return fail("keywords must be a list of strings.");
        patch.keywords = args.keywords as string[];
      }
      if (args.goodTake !== undefined) {
        if (typeof args.goodTake !== "boolean") return fail("goodTake must be a boolean.");
        patch.goodTake = args.goodTake;
      }
      if (!Object.keys(patch).length) return fail("Give at least one of scene, shot, take, goodTake, comment, description, keywords, logComment, reel.");
      const itemPatches: Record<string, MediaItemPatch> = {};
      for (const id of mediaIds) itemPatches[id] = patch;
      const result = await organize(host, { label: "Edit media log", itemPatches });
      if (!result.ok) return result.error;
      return ok(`Updated ${Object.keys(patch).join(", ")} on ${mediaIds.length} media item(s)`, {
        media: mediaIds.length,
        fields: Object.keys(patch),
      });
    }),
  },
  {
    name: "find_media",
    domain: "media",
    title: "Find media",
    description: `Search the media library across every Project panel column (name, label, type, codec, comment, description, keywords, log comment, reel, scene, shot, take, good take, ...). Every space-separated term must match; "scene:12" / "good:yes" / "take:2" limit a term to one column. "column" limits the whole search to one column (${MEDIA_COLUMNS.map((c) => c.id).join(", ")}).`,
    inputSchema: obj({ query: str, column: { ...str, description: 'A column id, or "all" (default).' }, limit: num }, ["query"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      const project = host.getProject();
      if (typeof args.query !== "string" || !args.query.trim()) return fail("query is required.");
      const column = args.column === undefined || args.column === "all" ? "all" : String(args.column);
      if (column !== "all" && !isMediaColumnId(column)) return fail(`Unknown column "${column}".`);
      const ctx = { usage: computeMediaUsage(project) };
      const found = filterMediaItems(project.mediaLibrary.items, args.query, column, ctx);
      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 50;
      return ok(`${found.length} match(es)`, {
        total: found.length,
        items: found.slice(0, limit).map((m) => ({
          id: m.id,
          name: m.name,
          scene: m.scene ?? null,
          shot: m.shot ?? null,
          take: m.take ?? null,
          goodTake: !!m.goodTake,
          description: m.description ?? null,
          comment: m.comment ?? null,
          keywords: m.keywords ?? [],
          logComment: m.logComment ?? null,
          reel: m.reel ?? null,
          type: mediaColumnText(m, "type", ctx),
        })),
      });
    }),
  },
  {
    name: "list_smart_bins",
    domain: "media",
    title: "List smart bins",
    description: "List the saved searches (smart bins) with their query, column and the live number of matching media items.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((_args, host) => {
      const project = host.getProject();
      const ctx = { usage: computeMediaUsage(project) };
      const bins = smartBinsOf(project).map((b) => ({
        id: b.id,
        name: b.name,
        query: b.query,
        column: b.column,
        itemCount: smartBinItems(project.mediaLibrary.items, b, ctx).length,
      }));
      return ok(`${bins.length} smart bin(s)`, { smartBins: bins });
    }),
  },
  {
    name: "create_smart_bin",
    domain: "media",
    title: "Create smart bin",
    description:
      'Save a search as a smart bin: a bin with no media of its own whose contents are the library items matching "query" (optionally limited to one "column"), recomputed live whenever metadata changes. One undo step.',
    inputSchema: obj({ name: str, query: str, column: { ...str, description: 'A column id, or "all" (default).' } }, ["name", "query"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      if (typeof args.name !== "string" || !args.name.trim()) return fail("name is required.");
      if (typeof args.query !== "string" || !args.query.trim()) return fail("query is required.");
      const column = args.column === undefined ? "all" : String(args.column);
      if (column !== "all" && !isMediaColumnId(column)) return fail(`Unknown column "${column}".`);
      const existing = smartBinsOf(project);
      const bin: SmartBin = { id: genId(), name: uniqueSmartBinName(existing, args.name.trim()), query: args.query.trim(), column };
      const result = await organize(host, { label: "New smart bin", smartBins: [...existing, bin] });
      if (!result.ok) return result.error;
      const count = smartBinItems(host.getProject().mediaLibrary.items, bin, { usage: computeMediaUsage(host.getProject()) }).length;
      return ok(`Created smart bin "${bin.name}" (${count} match(es))`, { smartBinId: bin.id, name: bin.name, itemCount: count });
    }),
  },
  {
    name: "delete_smart_bin",
    domain: "media",
    title: "Delete smart bin",
    description: "Delete a smart bin by id or name. Only the saved search is removed; no media is deleted. One undo step.",
    inputSchema: obj({ smartBin: str }, ["smartBin"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const ref = String(args.smartBin ?? "");
      const existing = smartBinsOf(project);
      const bin = existing.find((b) => b.id === ref) ?? existing.find((b) => b.name.toLowerCase() === ref.toLowerCase());
      if (!bin) return fail(`No smart bin "${ref}". Use list_smart_bins.`, "NOT_FOUND");
      const result = await organize(host, { label: "Delete smart bin", smartBins: existing.filter((b) => b.id !== bin.id) });
      if (!result.ok) return result.error;
      return ok(`Deleted smart bin "${bin.name}"`, { smartBinId: bin.id });
    }),
  },
  {
    name: "make_subclip",
    domain: "media",
    title: "Make subclip",
    description:
      'Create a subclip: a media-bin item that references a window (inPoint..outPoint, seconds or frames) of an existing video/audio item and is used like any media (drag, insert, overwrite). "restrictTrims": true keeps later trims on its clips inside the window. Omitting inPoint/outPoint uses the Source monitor marks for that media. One undo step.',
    inputSchema: obj(
      {
        mediaId: str,
        inPoint: num,
        outPoint: num,
        inFrame: num,
        outFrame: num,
        name: str,
        restrictTrims: bool,
        bin: { ...str, description: "Destination bin id or name; defaults to the parent's bin." },
      },
      ["mediaId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const [parent] = resolveMedia(project, [String(args.mediaId)]);
      const fps = project.settings.frameRate > 0 ? project.settings.frameRate : 30;
      const time = (seconds: unknown, frames: unknown): number | undefined => {
        if (typeof frames === "number" && Number.isFinite(frames)) return frames / fps;
        return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : undefined;
      };
      let inPoint = time(args.inPoint, args.inFrame);
      let outPoint = time(args.outPoint, args.outFrame);
      if (inPoint === undefined && outPoint === undefined) {
        const marks = host.sourceMonitor?.getMarks?.(parent.id);
        inPoint = marks?.in ?? undefined;
        outPoint = marks?.out ?? undefined;
      }
      if (inPoint === undefined || outPoint === undefined)
        return fail("Give inPoint and outPoint (seconds) or set In/Out marks in the Source monitor first.");
      const dest = args.bin === undefined ? undefined : resolveBin(project, args.bin);
      const item = createSubclipItem(project.mediaLibrary.items, parent, {
        id: genId(),
        inPoint,
        outPoint,
        name: typeof args.name === "string" ? args.name : undefined,
        restrictTrims: args.restrictTrims === true,
      });
      const placed: MediaItem =
        args.bin === undefined
          ? item
          : (() => {
              const { binId: _b, ...rest } = item;
              void _b;
              return dest ? { ...rest, binId: dest } : (rest as MediaItem);
            })();
      const result = await organize(host, { label: "Make subclip", addItems: [placed] });
      if (!result.ok) return result.error;
      return ok(`Created subclip "${placed.name}" (${inPoint.toFixed(3)}s to ${outPoint.toFixed(3)}s)`, {
        mediaId: placed.id,
        name: placed.name,
        parentId: placed.subclip?.parentId,
        inPoint,
        outPoint,
        restrictTrims: placed.subclip?.restrictTrims,
      });
    }),
  },
  {
    name: "interpret_footage",
    domain: "media",
    title: "Interpret footage",
    description:
      "Override how video media is read. frameRate conforms the footage to that rate (a 30 fps file read as 24 fps plays at 0.8x and runs 25% longer); clips already on the timeline are retimed (speed and duration, later clips on the same track ripple to follow; pass retimeClips:false to change only the media item) and clips placed afterwards use it. pixelAspectRatio (0.25-4; 1.3333 for HDV 1440x1080, 0.9091 for DV NTSC) stretches the frame to its display width in preview, the Program monitor, scopes and export, so fit/fill math uses the display size. fieldOrder (progressive, upper, lower) marks interlaced footage, which preview and export deinterlace with the deinterlace mode (none, blend (default), bob). The file's own pixel aspect / field order are auto-detected when the importer can read them and show in list_media. Fields you give are merged into the item's existing interpretation (others are kept); clear:true goes back to what the file says. One undo step.",
    inputSchema: obj(
      {
        mediaIds: strings,
        frameRate: num,
        pixelAspectRatio: num,
        fieldOrder: { ...str, enum: [...FIELD_ORDERS] },
        deinterlace: { ...str, enum: [...DEINTERLACE_MODES] },
        retimeClips: bool,
        clear: bool,
      },
      ["mediaIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const mediaIds = ids(args.mediaIds, "mediaIds");
      if (!mediaIds.length) return fail("Give mediaIds.");
      const items = resolveMedia(project, mediaIds);
      const clear = args.clear === true;
      const value: { frameRate?: number; pixelAspectRatio?: number; fieldOrder?: FieldOrder; deinterlace?: DeinterlaceMode } = {};
      if (args.frameRate !== undefined) value.frameRate = Number(args.frameRate);
      if (args.pixelAspectRatio !== undefined) value.pixelAspectRatio = Number(args.pixelAspectRatio);
      if (args.fieldOrder !== undefined) value.fieldOrder = args.fieldOrder as FieldOrder;
      if (args.deinterlace !== undefined) value.deinterlace = args.deinterlace as DeinterlaceMode;
      if (!clear && !Object.keys(value).length) return fail("Give frameRate, pixelAspectRatio, fieldOrder, deinterlace or clear:true.");
      if (!clear) {
        const bad = validateInterpretation(value);
        if (bad) return fail(bad);
      }
      const nonVideo = items.find((m) => m.type !== "video");
      if (nonVideo) return fail(`"${nonVideo.name}" is not video footage.`);
      const itemPatches: Record<string, MediaItemPatch> = {};
      for (const item of items) itemPatches[item.id] = { interpretation: clear ? null : { ...(item.interpretation ?? {}), ...value } };
      const result = await organize(host, {
        label: "Interpret footage",
        itemPatches,
        ...(args.retimeClips === false ? {} : { retimeClips: true }),
      });
      if (!result.ok) return result.error;
      return ok(clear ? `Cleared interpretation on ${mediaIds.length} item(s)` : `Interpreted ${mediaIds.length} item(s)`, {
        mediaIds,
        interpretation: clear ? null : value,
      });
    }),
  },
];
