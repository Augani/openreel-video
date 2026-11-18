import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  binPath,
  binsOf,
  childBins,
  computeMediaUsage,
  filterMediaItems,
  itemsInBin,
  smartBinCounts,
  smartBinItems,
  smartBinsOf,
  sortMediaItems,
  type MediaBin,
  type MediaItem,
  type SmartBin,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useProjectPanelStore } from "../../../stores/project-panel-store";

export interface ProjectPanelData {
  readonly bins: readonly MediaBin[];
  readonly currentBinId: string | null;
  readonly path: MediaBin[];
  /** Bins shown in the current view (none while searching). */
  readonly visibleBins: MediaBin[];
  /** Media shown in the current view, filtered and sorted. */
  readonly items: MediaItem[];
  readonly usage: ReadonlyMap<string, number>;
  /** Direct media count per bin id. */
  readonly itemCounts: ReadonlyMap<string, number>;
  readonly searching: boolean;
  readonly totalItems: number;
  readonly smartBins: readonly SmartBin[];
  /** Live match count per smart bin id. */
  readonly smartBinCounts: ReadonlyMap<string, number>;
  /** The smart bin being viewed, if any. */
  readonly activeSmartBin: SmartBin | null;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Derived Project-panel data. A search spans the whole library (flat results);
 * otherwise the view is the current bin. Sorting and filtering are pure core
 * functions; their timings are published for diagnostics.
 */
export function useProjectPanelData(extraFilter?: (item: MediaItem) => boolean): ProjectPanelData {
  const { mediaItems, storedBins, storedSmartBins, tracks } = useProjectStore(
    useShallow((s) => ({
      mediaItems: s.project.mediaLibrary.items,
      storedBins: s.project.bins,
      storedSmartBins: s.project.smartBins,
      tracks: s.project.timeline.tracks,
    })),
  );
  const { currentBinId, query, sort, searchColumn, activeSmartBinId } = useProjectPanelStore(
    useShallow((s) => ({
      activeSmartBinId: s.activeSmartBinId,
      currentBinId: s.currentBinId,
      query: s.query,
      sort: s.sort,
      searchColumn: s.searchColumn,
    })),
  );

  const bins = useMemo(() => binsOf({ bins: storedBins }), [storedBins]);
  // A bin deleted while being viewed (undo/redo, agent) falls back to the root.
  const effectiveBin = currentBinId && bins.some((b) => b.id === currentBinId) ? currentBinId : null;
  useEffect(() => {
    if (currentBinId && !effectiveBin) useProjectPanelStore.getState().openBin(null);
  }, [currentBinId, effectiveBin]);

  // Keep the same Map instance while counts are unchanged, so a clip drag or
  // trim (new `tracks` every edit) does not re-sort / re-render a big library.
  const usageRef = useRef<ReadonlyMap<string, number>>(new Map());
  const usage = useMemo(() => {
    const next = computeMediaUsage({ timeline: { tracks } } as never);
    const prev = usageRef.current;
    const same = next.size === prev.size && [...next].every(([id, n]) => prev.get(id) === n);
    if (!same) usageRef.current = next;
    return usageRef.current;
  }, [tracks]);
  const smartBins = useMemo(() => smartBinsOf({ smartBins: storedSmartBins }), [storedSmartBins]);
  // A smart bin deleted while being viewed (undo/redo, agent) falls back to the root.
  const activeSmartBin = (activeSmartBinId && smartBins.find((b) => b.id === activeSmartBinId)) || null;
  useEffect(() => {
    if (activeSmartBinId && !activeSmartBin) useProjectPanelStore.getState().openSmartBin(null);
  }, [activeSmartBinId, activeSmartBin]);
  const searching = query.trim().length > 0 || !!activeSmartBin;

  const derived = useMemo(() => {
    const t0 = now();
    const ctx = { usage };
    const base = activeSmartBin
      ? smartBinItems(mediaItems, activeSmartBin, ctx)
      : searching
        ? mediaItems
        : itemsInBin(mediaItems, effectiveBin ?? undefined);
    const scoped = extraFilter ? base.filter(extraFilter) : base;
    const filtered = query.trim() ? filterMediaItems(scoped, query, searchColumn, ctx) : scoped;
    const t1 = now();
    const sorted = sort ? sortMediaItems(filtered, sort.column, sort.direction, ctx) : filtered;
    const t2 = now();
    return { items: sorted, filterMs: t1 - t0, sortMs: t2 - t1 };
  }, [mediaItems, usage, searching, activeSmartBin, effectiveBin, extraFilter, query, searchColumn, sort]);

  useEffect(() => {
    useProjectPanelStore.getState().setTimings({
      items: mediaItems.length,
      filterMs: derived.filterMs,
      sortMs: derived.sortMs,
      at: Date.now(),
    });
  }, [derived, mediaItems.length]);

  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of mediaItems) if (item.binId) counts.set(item.binId, (counts.get(item.binId) ?? 0) + 1);
    return counts;
  }, [mediaItems]);

  const counts = useMemo(
    () => (smartBins.length ? smartBinCounts(mediaItems, smartBins, { usage }) : new Map<string, number>()),
    [mediaItems, smartBins, usage],
  );

  const path = useMemo(() => binPath(bins, effectiveBin ?? undefined), [bins, effectiveBin]);
  const visibleBins = useMemo(
    () =>
      searching
        ? []
        : childBins(bins, effectiveBin ?? undefined).sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true }),
          ),
    [bins, effectiveBin, searching],
  );

  return {
    bins,
    currentBinId: effectiveBin,
    path,
    visibleBins,
    items: derived.items,
    usage,
    itemCounts,
    searching,
    totalItems: mediaItems.length,
    smartBins,
    smartBinCounts: counts,
    activeSmartBin,
  };
}
