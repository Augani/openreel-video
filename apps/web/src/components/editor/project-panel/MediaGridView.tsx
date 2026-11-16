import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MediaItem } from "@openreel/core";
import { useProjectPanelStore } from "../../../stores/project-panel-store";
import { BinTile } from "./BinViews";
import type { ProjectPanelData } from "./useProjectPanelData";

/** Horizontal padding / column gap / row gap, matching `.workspace-media-grid`. */
const PAD_X = 10;
const GAP_X = 8;
const GAP_Y = 10;
/** Filename line + the 5px gap below the 16:9 thumbnail. */
const CAPTION = 20;
const MIN_TILE_WIDTH = 140;
const OVERSCAN_ROWS = 2;

export interface GridMetrics {
  readonly columns: number;
  readonly tileWidth: number;
  readonly rowHeight: number;
}

/** Pure layout maths (exported for tests): columns from width, fixed row height from the tile width. */
export function gridMetrics(width: number): GridMetrics {
  const inner = Math.max(0, width - PAD_X * 2);
  const columns = Math.max(2, Math.floor((inner + GAP_X) / (MIN_TILE_WIDTH + GAP_X)));
  const tileWidth = (inner - GAP_X * (columns - 1)) / columns;
  return { columns, tileWidth, rowHeight: Math.round((tileWidth * 9) / 16 + CAPTION + GAP_Y) };
}

/** Rows [first, last) to render for a scroll offset and viewport. */
export function visibleRowRange(
  scrollTop: number,
  viewHeight: number,
  rowHeight: number,
  rowCount: number,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const last = Math.min(rowCount, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN_ROWS);
  return { first, last };
}

export interface MediaGridViewProps {
  data: ProjectPanelData;
  renderItem: (item: MediaItem) => React.ReactNode;
  /** Final tile (the "Add media" button). */
  trailing: React.ReactNode;
  /** Rendered below the grid, in normal flow. */
  footer?: React.ReactNode;
  className?: string;
  onDrop?: React.DragEventHandler;
  onDragOver?: React.DragEventHandler;
  onDragLeave?: React.DragEventHandler;
  children?: React.ReactNode;
}

/**
 * Windowed Project grid: only the rows in (or near) the viewport are mounted,
 * so a 2,000-item library keeps a few dozen tiles in the DOM. Rows have a fixed
 * height derived from the panel width, so scroll position maps straight to rows.
 */
export const MediaGridView: React.FC<MediaGridViewProps> = ({
  data,
  renderItem,
  trailing,
  footer,
  className,
  onDrop,
  onDragOver,
  onDragLeave,
  children,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 400 });
  const revealNonce = useProjectPanelStore((s) => s.revealNonce);
  const revealMediaId = useProjectPanelStore((s) => s.revealMediaId);

  const metrics = useMemo(() => gridMetrics(size.width), [size.width]);
  const binCount = data.visibleBins.length;
  const total = binCount + data.items.length + 1; // + trailing tile
  const rowCount = Math.ceil(total / metrics.columns);
  const [range, setRange] = useState({ first: 0, last: 8 });

  const recompute = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const next = visibleRowRange(node.scrollTop, node.clientHeight || size.height, metrics.rowHeight, rowCount);
    setRange((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
  }, [metrics.rowHeight, rowCount, size.height]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth || 320, height: node.clientHeight || 400 });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(recompute, [recompute]);

  // Reveal in project: scroll the revealed tile's row into the middle of the view.
  useEffect(() => {
    if (!revealMediaId) return;
    const index = data.items.findIndex((i) => i.id === revealMediaId);
    const node = scrollRef.current;
    if (index < 0 || !node) return;
    const rowTop = Math.floor((binCount + index) / metrics.columns) * metrics.rowHeight;
    if (rowTop < node.scrollTop || rowTop + metrics.rowHeight > node.scrollTop + node.clientHeight)
      node.scrollTop = Math.max(0, rowTop - (node.clientHeight - metrics.rowHeight) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

  const cellAt = (index: number): React.ReactNode => {
    if (index < binCount) {
      const bin = data.visibleBins[index];
      return <BinTile key={`bin-${bin.id}`} bin={bin} itemCount={data.itemCounts.get(bin.id) ?? 0} />;
    }
    const itemIndex = index - binCount;
    if (itemIndex < data.items.length) {
      const item = data.items[itemIndex];
      return <React.Fragment key={item.id}>{renderItem(item)}</React.Fragment>;
    }
    return <React.Fragment key="add-tile">{trailing}</React.Fragment>;
  };

  const rows: React.ReactNode[] = [];
  for (let row = range.first; row < Math.min(range.last, rowCount); row += 1) {
    const cells: React.ReactNode[] = [];
    for (let col = 0; col < metrics.columns; col += 1) {
      const index = row * metrics.columns + col;
      if (index < total) cells.push(cellAt(index));
    }
    rows.push(
      <div
        key={row}
        data-grid-row={row}
        className="absolute"
        style={{
          top: row * metrics.rowHeight,
          left: PAD_X,
          right: PAD_X,
          height: metrics.rowHeight - GAP_Y,
          display: "grid",
          gridTemplateColumns: `repeat(${metrics.columns}, minmax(0, 1fr))`,
          columnGap: GAP_X,
          alignItems: "start",
        }}
      >
        {cells}
      </div>,
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
      <div
        ref={scrollRef}
        onScroll={recompute}
        data-testid="media-grid"
        data-columns={metrics.columns}
        data-row-height={metrics.rowHeight}
        data-rendered-rows={rows.length}
        className={`workspace-media-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-bg-1 ${className ?? ""}`}
      >
        <div className="relative" style={{ height: rowCount * metrics.rowHeight }}>
          {rows}
        </div>
        {footer && <div className="px-[10px] pb-3">{footer}</div>}
      </div>
      {children}
    </div>
  );
};
