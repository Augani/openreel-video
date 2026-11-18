import type {
  MediaBin,
  MediaItem,
  MediaLabelId,
  MediaSubclip,
  Project,
} from "../types/project";
import type { Clip } from "../types/timeline";

/**
 * Pure project-panel logic: label palette, bin tree, subclips, the sortable /
 * searchable metadata table. No DOM, no stores, so the editor UI, the agent
 * tools and the tests all share one implementation.
 */

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface MediaLabelDef {
  readonly id: MediaLabelId;
  readonly name: string;
  readonly color: string;
}

/** Premiere's 16 label colours (default names), in palette order. */
export const MEDIA_LABELS: readonly MediaLabelDef[] = [
  { id: "violet", name: "Violet", color: "#8a6bd1" },
  { id: "iris", name: "Iris", color: "#5b5fe0" },
  { id: "caribbean", name: "Caribbean", color: "#18b4a6" },
  { id: "lavender", name: "Lavender", color: "#b79be0" },
  { id: "cerulean", name: "Cerulean", color: "#2f9bd8" },
  { id: "forest", name: "Forest", color: "#2f8a4a" },
  { id: "rose", name: "Rose", color: "#e0627f" },
  { id: "mango", name: "Mango", color: "#f0912c" },
  { id: "purple", name: "Purple", color: "#9747c8" },
  { id: "blue", name: "Blue", color: "#3b6fe0" },
  { id: "teal", name: "Teal", color: "#2aa0a6" },
  { id: "magenta", name: "Magenta", color: "#d63aa6" },
  { id: "tan", name: "Tan", color: "#c9a86a" },
  { id: "green", name: "Green", color: "#4cbf5a" },
  { id: "brown", name: "Brown", color: "#8c5a3a" },
  { id: "yellow", name: "Yellow", color: "#e6c93a" },
];

const LABEL_BY_ID = new Map(MEDIA_LABELS.map((l) => [l.id, l]));

export function isMediaLabelId(value: unknown): value is MediaLabelId {
  return typeof value === "string" && LABEL_BY_ID.has(value as MediaLabelId);
}

export function getMediaLabel(id: MediaLabelId | null | undefined): MediaLabelDef | undefined {
  return id ? LABEL_BY_ID.get(id) : undefined;
}

/** Parse a user / agent supplied label (id or display name, any case). null = no label. */
export function parseMediaLabel(value: unknown): MediaLabelId | null | undefined {
  if (value === null || value === "none") return null;
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  return MEDIA_LABELS.find((l) => l.id === key || l.name.toLowerCase() === key)?.id;
}

/** The label a timeline clip shows: its own, else its media's. null = none. */
export function resolveClipLabel(
  clip: Pick<Clip, "label">,
  media: Pick<MediaItem, "label"> | undefined,
): MediaLabelId | null {
  if (clip.label === null) return null;
  return clip.label ?? media?.label ?? null;
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

export function binsOf(project: Pick<Project, "bins">): readonly MediaBin[] {
  return project.bins ?? [];
}

export function childBins(bins: readonly MediaBin[], parentId: string | undefined): MediaBin[] {
  return bins.filter((b) => (b.parentId ?? undefined) === (parentId ?? undefined));
}

/** Root-first chain of bins down to `binId` (empty for the root). */
export function binPath(bins: readonly MediaBin[], binId: string | undefined): MediaBin[] {
  const byId = new Map(bins.map((b) => [b.id, b]));
  const path: MediaBin[] = [];
  const seen = new Set<string>();
  let cursor = binId ? byId.get(binId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

/** `binId` plus every bin nested below it. */
export function binSubtreeIds(bins: readonly MediaBin[], binId: string): Set<string> {
  const ids = new Set<string>([binId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const bin of bins) {
      if (bin.parentId && ids.has(bin.parentId) && !ids.has(bin.id)) {
        ids.add(bin.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function itemsInBin(items: readonly MediaItem[], binId: string | undefined): MediaItem[] {
  return items.filter((i) => (i.binId ?? undefined) === (binId ?? undefined));
}

/** What deleting a bin removes: nested bins, their media, and clips using it. */
export function binDeletionImpact(
  project: Pick<Project, "bins" | "mediaLibrary" | "timeline">,
  binId: string,
): { binIds: string[]; mediaIds: string[]; clipCount: number } {
  const bins = binsOf(project);
  const subtree = binSubtreeIds(bins, binId);
  const mediaIds = project.mediaLibrary.items
    .filter((i) => i.binId && subtree.has(i.binId))
    .map((i) => i.id);
  const doomed = new Set(mediaIds);
  let clipCount = 0;
  for (const track of project.timeline.tracks)
    for (const clip of track.clips) if (doomed.has(clip.mediaId)) clipCount += 1;
  return { binIds: [...subtree], mediaIds, clipCount };
}

/** A sibling-unique bin name: "Bin", "Bin 2", "Bin 3"... */
export function uniqueBinName(
  bins: readonly MediaBin[],
  parentId: string | undefined,
  base = "Bin",
): string {
  const taken = new Set(childBins(bins, parentId).map((b) => b.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Would moving `binId` under `newParentId` create a cycle? */
export function wouldCreateBinCycle(
  bins: readonly MediaBin[],
  binId: string,
  newParentId: string | undefined,
): boolean {
  if (!newParentId) return false;
  return binSubtreeIds(bins, binId).has(newParentId);
}

const rootOf = (b: MediaBin): MediaBin => ({
  id: b.id,
  name: b.name,
  ...(b.label ? { label: b.label } : {}),
});

/**
 * Repair a stored bin tree: drop duplicate ids / blank names, hoist bins whose
 * parent is missing or cyclic to the root.
 */
export function normalizeBins(value: unknown): MediaBin[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const clean: MediaBin[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const bin = raw as Partial<MediaBin>;
    if (typeof bin.id !== "string" || !bin.id || seen.has(bin.id)) continue;
    seen.add(bin.id);
    clean.push({
      id: bin.id,
      name: typeof bin.name === "string" && bin.name.trim() ? bin.name : "Bin",
      ...(typeof bin.parentId === "string" && bin.parentId ? { parentId: bin.parentId } : {}),
      ...(isMediaLabelId(bin.label) ? { label: bin.label } : {}),
    });
  }
  const ids = new Set(clean.map((b) => b.id));
  let fixed = clean.map((b) =>
    b.parentId && (!ids.has(b.parentId) || b.parentId === b.id) ? rootOf(b) : b,
  );
  // Break remaining cycles by hoisting the member that closes each loop.
  for (const bin of fixed) {
    const chain = new Set<string>([bin.id]);
    let cursor: MediaBin | undefined = bin;
    while (cursor?.parentId) {
      const parentId: string = cursor.parentId;
      if (chain.has(parentId)) {
        const closing = cursor.id;
        fixed = fixed.map((b) => (b.id === closing ? rootOf(b) : b));
        break;
      }
      chain.add(parentId);
      cursor = fixed.find((b) => b.id === parentId);
    }
  }
  return fixed;
}

// ---------------------------------------------------------------------------
// Subclips
// ---------------------------------------------------------------------------

/** The source window a media item places by default: its subclip range, else null. */
export function subclipRange(
  media: Pick<MediaItem, "subclip">,
): { start: number; end: number } | null {
  const sub = media.subclip;
  return sub && Number.isFinite(sub.inPoint) && Number.isFinite(sub.outPoint)
    ? { start: sub.inPoint, end: sub.outPoint }
    : null;
}

/** Length shown / placed for an item: subclip window, else full duration. */
export function mediaDisplayDuration(media: Pick<MediaItem, "subclip" | "metadata">): number {
  const range = subclipRange(media);
  return range ? Math.max(0, range.end - range.start) : media.metadata.duration;
}

/** Source bounds clip trims must stay inside, or null when unrestricted. */
export function mediaTrimBounds(
  media: Pick<MediaItem, "subclip"> | undefined,
): { min: number; max: number } | null {
  const sub = media?.subclip;
  if (!sub?.restrictTrims) return null;
  return { min: sub.inPoint, max: sub.outPoint };
}

export interface MakeSubclipOptions {
  readonly id: string;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly name?: string;
  readonly restrictTrims?: boolean;
  readonly now?: number;
}

/** The root (non-subclip) source of a media item. */
export function resolveSubclipParent(items: readonly MediaItem[], media: MediaItem): MediaItem {
  let cursor = media;
  const seen = new Set<string>();
  while (cursor.subclip && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parent = items.find((i) => i.id === cursor.subclip!.parentId);
    if (!parent) break;
    cursor = parent;
  }
  return cursor;
}

/**
 * A subclip item over `[inPoint, outPoint]` of `parent`'s source. Shares the
 * parent's file, thumbnail and waveform; lives in the parent's bin.
 */
export function createSubclipItem(
  items: readonly MediaItem[],
  parent: MediaItem,
  options: MakeSubclipOptions,
): MediaItem {
  if (parent.type === "image") throw new Error("Still images cannot be subclipped.");
  const root = resolveSubclipParent(items, parent);
  const full = root.metadata.duration;
  const a = Math.max(0, options.inPoint);
  const b = full > 0 ? Math.min(full, options.outPoint) : options.outPoint;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a <= 1e-6)
    throw new Error("A subclip needs an Out point after its In point.");
  const taken = new Set(items.map((i) => i.name));
  const baseName = options.name?.trim() || `${root.name.replace(/\.[^.]+$/, "")} Subclip`;
  let name = baseName;
  for (let n = 2; taken.has(name); n += 1) name = `${baseName} ${n}`;
  const subclip: MediaSubclip = {
    parentId: root.id,
    inPoint: a,
    outPoint: b,
    restrictTrims: options.restrictTrims ?? false,
  };
  // Inherit the file/metadata only: the subclip's bin comes from the item it was
  // made from (not the root's), and notes belong to the original.
  const { comment: _comment, description: _description, binId: _binId, ...rest } = root;
  void _comment;
  void _description;
  void _binId;
  return {
    ...rest,
    id: options.id,
    name,
    subclip,
    importedAt: options.now ?? Date.now(),
    ...(parent.binId ? { binId: parent.binId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Table: columns, usage, sort, filter
// ---------------------------------------------------------------------------

export type MediaColumnId =
  | "name"
  | "label"
  | "type"
  | "duration"
  | "frameRate"
  | "resolution"
  | "codec"
  | "audio"
  | "fileSize"
  | "startTimecode"
  | "importedAt"
  | "usage"
  | "comment"
  | "description"
  | "scene"
  | "shot"
  | "take"
  | "goodTake";

export interface MediaColumnDef {
  readonly id: MediaColumnId;
  readonly title: string;
  readonly width: number;
  readonly numeric: boolean;
  /** Hidden by default. */
  readonly optional: boolean;
}

export const MEDIA_COLUMNS: readonly MediaColumnDef[] = [
  { id: "name", title: "Name", width: 110, numeric: false, optional: false },
  { id: "label", title: "Label", width: 90, numeric: false, optional: true },
  { id: "type", title: "Media type", width: 84, numeric: false, optional: true },
  { id: "duration", title: "Duration", width: 92, numeric: true, optional: false },
  { id: "frameRate", title: "Frame rate", width: 84, numeric: true, optional: true },
  { id: "resolution", title: "Resolution", width: 84, numeric: true, optional: false },
  { id: "codec", title: "Codec", width: 90, numeric: false, optional: true },
  { id: "audio", title: "Audio", width: 120, numeric: true, optional: true },
  { id: "fileSize", title: "File size", width: 84, numeric: true, optional: true },
  { id: "startTimecode", title: "Start TC", width: 96, numeric: true, optional: true },
  { id: "importedAt", title: "Date imported", width: 130, numeric: true, optional: true },
  { id: "usage", title: "Usage", width: 64, numeric: true, optional: true },
  { id: "comment", title: "Comment", width: 160, numeric: false, optional: true },
  { id: "description", title: "Description", width: 180, numeric: false, optional: true },
  { id: "scene", title: "Scene", width: 64, numeric: false, optional: true },
  { id: "shot", title: "Shot", width: 64, numeric: false, optional: true },
  { id: "take", title: "Take", width: 64, numeric: false, optional: true },
  { id: "goodTake", title: "Good", width: 56, numeric: false, optional: true },
];

/** Columns whose cell is free text the user edits in place (one `media/organize` undo step each). */
export const EDITABLE_TEXT_COLUMNS = ["comment", "description", "scene", "shot", "take"] as const;
export type EditableTextColumn = (typeof EDITABLE_TEXT_COLUMNS)[number];
export function isEditableTextColumn(value: unknown): value is EditableTextColumn {
  return (EDITABLE_TEXT_COLUMNS as readonly unknown[]).includes(value);
}

export const DEFAULT_VISIBLE_COLUMNS: readonly MediaColumnId[] = MEDIA_COLUMNS.filter(
  (c) => !c.optional,
).map((c) => c.id);

export function isMediaColumnId(value: unknown): value is MediaColumnId {
  return MEDIA_COLUMNS.some((c) => c.id === value);
}

export interface MediaTableContext {
  /** Clip count per media id (see computeMediaUsage). */
  readonly usage: ReadonlyMap<string, number>;
}

/** Timeline clips per media id. */
export function computeMediaUsage(project: Pick<Project, "timeline">): Map<string, number> {
  const usage = new Map<string, number>();
  for (const track of project.timeline.tracks)
    for (const clip of track.clips) usage.set(clip.mediaId, (usage.get(clip.mediaId) ?? 0) + 1);
  return usage;
}

/** Raw sortable value: number for numeric columns, lower-cased string else. */
export function mediaColumnSortValue(
  item: MediaItem,
  column: MediaColumnId,
  ctx: MediaTableContext,
): number | string {
  const m = item.metadata;
  switch (column) {
    case "name":
      return item.name.toLowerCase();
    case "label": {
      const index = item.label ? MEDIA_LABELS.findIndex((l) => l.id === item.label) : -1;
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }
    case "type":
      return item.subclip ? "subclip" : item.type;
    case "duration":
      return mediaDisplayDuration(item) || 0;
    case "frameRate":
      return m.frameRate || 0;
    case "resolution":
      return (m.width || 0) * (m.height || 0);
    case "codec":
      return (m.codec || "").toLowerCase();
    case "audio":
      return (m.channels || 0) * 1_000_000 + (m.sampleRate || 0);
    case "fileSize":
      return m.fileSize || 0;
    case "startTimecode":
      return m.startTimecode ?? -1;
    case "importedAt":
      return item.importedAt ?? 0;
    case "usage":
      return ctx.usage.get(item.id) ?? 0;
    case "comment":
      return (item.comment ?? "").toLowerCase();
    case "description":
      return (item.description ?? "").toLowerCase();
    case "scene":
      return (item.scene ?? "").toLowerCase();
    case "shot":
      return (item.shot ?? "").toLowerCase();
    case "take":
      return (item.take ?? "").toLowerCase();
    case "goodTake":
      return item.goodTake ? 1 : 0;
  }
}

/** HH:MM:SS:FF. */
export function formatMediaDuration(seconds: number, frameRate = 30): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const fps = Math.max(1, Math.round(frameRate || 30));
  let total = Math.floor(seconds);
  let frames = Math.round((seconds - total) * fps);
  if (frames >= fps) {
    frames = 0;
    total += 1;
  }
  const h = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(mm)}:${p(ss)}:${p(frames)}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Display text for a cell (also what column search matches). */
export function mediaColumnText(
  item: MediaItem,
  column: MediaColumnId,
  ctx: MediaTableContext,
): string {
  const m = item.metadata;
  switch (column) {
    case "name":
      return item.name;
    case "label":
      return getMediaLabel(item.label)?.name ?? "";
    case "type":
      return item.subclip ? "Subclip" : item.type.charAt(0).toUpperCase() + item.type.slice(1);
    case "duration":
      return item.type === "image" ? "" : formatMediaDuration(mediaDisplayDuration(item), m.frameRate);
    case "frameRate":
      return m.frameRate ? `${Number(m.frameRate.toFixed(3))} fps` : "";
    case "resolution":
      return m.width && m.height ? `${m.width} x ${m.height}` : "";
    case "codec":
      return m.codec ?? "";
    case "audio": {
      if (!m.channels && !m.sampleRate) return "";
      const rate = m.sampleRate ? `${Number((m.sampleRate / 1000).toFixed(1))} kHz` : "";
      const ch =
        m.channels === 1 ? "Mono" : m.channels === 2 ? "Stereo" : m.channels ? `${m.channels} ch` : "";
      return [rate, ch].filter(Boolean).join(" ");
    }
    case "fileSize":
      return formatBytes(m.fileSize);
    case "startTimecode":
      return m.startTimecodeText ?? "";
    case "importedAt":
      return item.importedAt
        ? new Date(item.importedAt).toISOString().slice(0, 16).replace("T", " ")
        : "";
    case "usage":
      return String(ctx.usage.get(item.id) ?? 0);
    case "comment":
      return item.comment ?? "";
    case "description":
      return item.description ?? "";
    case "scene":
      return item.scene ?? "";
    case "shot":
      return item.shot ?? "";
    case "take":
      return item.take ?? "";
    case "goodTake":
      return item.goodTake ? "Good take" : "";
  }
}

const FIELD_ALIASES: ReadonlyMap<string, MediaColumnId> = new Map<string, MediaColumnId>([
  ...MEDIA_COLUMNS.map((c): [string, MediaColumnId] => [c.id.toLowerCase(), c.id]),
  ["good", "goodTake"],
  ["log", "description"],
  ["notes", "comment"],
]);

export type SortDirection = "asc" | "desc";

/** Stable sort by one column; ties fall back to name. Returns a new array. */
export function sortMediaItems(
  items: readonly MediaItem[],
  column: MediaColumnId,
  direction: SortDirection,
  ctx: MediaTableContext,
): MediaItem[] {
  const sign = direction === "desc" ? -1 : 1;
  const keyed = items.map((item, index) => ({
    item,
    index,
    key: mediaColumnSortValue(item, column, ctx),
    name: item.name.toLowerCase(),
  }));
  keyed.sort((a, b) => {
    let c: number;
    if (typeof a.key === "number" && typeof b.key === "number") {
      // Unlabelled (Infinity) always sorts last regardless of direction.
      if (a.key === b.key) c = 0;
      else if (!Number.isFinite(a.key)) return 1;
      else if (!Number.isFinite(b.key)) return -1;
      else c = a.key - b.key;
    } else c = String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
    if (c !== 0) return c * sign;
    c = a.name.localeCompare(b.name, undefined, { numeric: true });
    return c !== 0 ? c : a.index - b.index;
  });
  return keyed.map((k) => k.item);
}

/**
 * Filter by free text. `column` limits matching to one column's displayed text;
 * "all" matches any column. Every whitespace-separated term must match.
 */
export function filterMediaItems(
  items: readonly MediaItem[],
  query: string,
  column: MediaColumnId | "all",
  ctx: MediaTableContext,
): MediaItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items.slice();
  const columns: readonly MediaColumnId[] =
    column === "all" ? MEDIA_COLUMNS.map((c) => c.id) : [column];
  const parsed = terms.map((term) => {
    // `scene:12` / `good:yes` limit a term to one column (only for known column names).
    const colon = term.indexOf(":");
    const field = colon > 0 ? FIELD_ALIASES.get(term.slice(0, colon)) : undefined;
    return field && colon < term.length - 1 ? { field, text: term.slice(colon + 1) } : { field: undefined, text: term };
  });
  return items.filter((item) => {
    const haystack = columns.map((c) => mediaColumnText(item, c, ctx).toLowerCase());
    return parsed.every(({ field, text }) => {
      if (!field) return haystack.some((h) => h.includes(text));
      if (field === "goodTake") {
        if (["yes", "true", "1", "good"].includes(text)) return !!item.goodTake;
        if (["no", "false", "0"].includes(text)) return !item.goodTake;
      }
      return mediaColumnText(item, field, ctx).toLowerCase().includes(text);
    });
  });
}
