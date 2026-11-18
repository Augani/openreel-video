import type { MediaItem, Project, SmartBin } from "../types/project";
import {
  filterMediaItems,
  isMediaColumnId,
  type MediaColumnId,
  type MediaTableContext,
} from "./bins";

/**
 * Smart bins: saved Project-panel searches. They hold no media, only a query
 * (plus the column it is scoped to), so a bin's contents are recomputed from the
 * live library and update the moment any metadata changes.
 */

export function smartBinsOf(project: Pick<Project, "smartBins">): readonly SmartBin[] {
  return project.smartBins ?? [];
}

export function smartBinColumn(bin: Pick<SmartBin, "column">): MediaColumnId | "all" {
  return bin.column === "all" || isMediaColumnId(bin.column) ? (bin.column as MediaColumnId | "all") : "all";
}

/** Media matching a smart bin, in library order. */
export function smartBinItems(
  items: readonly MediaItem[],
  bin: Pick<SmartBin, "query" | "column">,
  ctx: MediaTableContext,
): MediaItem[] {
  if (!bin.query.trim()) return [];
  return filterMediaItems(items, bin.query, smartBinColumn(bin), ctx);
}

/** Live match counts for every smart bin (one pass per bin). */
export function smartBinCounts(
  items: readonly MediaItem[],
  bins: readonly SmartBin[],
  ctx: MediaTableContext,
): Map<string, number> {
  return new Map(bins.map((bin) => [bin.id, smartBinItems(items, bin, ctx).length]));
}

export function uniqueSmartBinName(bins: readonly SmartBin[], base = "Smart bin"): string {
  const taken = new Set(bins.map((b) => b.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Drop malformed entries and duplicate ids from stored / agent-supplied smart bins. */
export function normalizeSmartBins(value: unknown): SmartBin[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: SmartBin[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { id, name, query, column } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim() || typeof query !== "string") continue;
    seen.add(id);
    out.push({
      id,
      name: name.trim(),
      query,
      column: typeof column === "string" && (column === "all" || isMediaColumnId(column)) ? column : "all",
    });
  }
  return out;
}

/**
 * The search to save when `query` (in `column`) is typed while `active` is being viewed.
 * The panel then shows "active's matches narrowed by query", so saving the typed text alone
 * would save a wider search than the one on screen. Terms are ANDed, which is exact only when
 * both searches use the same column; otherwise there is no single saved search that equals the
 * view and this returns null.
 */
export function savableSmartBinSearch(
  active: Pick<SmartBin, "query" | "column"> | null,
  query: string,
  column: MediaColumnId | "all",
): { query: string; column: MediaColumnId | "all" } | null {
  const typed = query.trim();
  if (!typed) return null;
  if (!active) return { query: typed, column };
  if (smartBinColumn(active) !== column) return null;
  return { query: `${active.query.trim()} ${typed}`, column };
}
