import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Film, Folder, Image as ImageIcon, Music, Scissors } from "@/icons/lucide-compat";
import {
  MEDIA_COLUMNS,
  mediaColumnText,
  type EditableTextColumn,
  type MediaBin,
  type MediaColumnDef,
  type MediaColumnId,
  type MediaItem,
} from "@openreel/core";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectPanelStore } from "../../../stores/project-panel-store";
import { runOrganize, setGoodTake, setMediaText } from "../../../services/project-panel-commands";
import { LabelChip, MediaItemContextMenu } from "./ProjectPanelMenus";
import { BinContextMenu, BinNameEditor, useBinDropTarget } from "./BinViews";
import { writeBinDrag, writeMediaDrag } from "./dnd";
import type { ProjectPanelData } from "./useProjectPanelData";

export const LIST_ROW_HEIGHT = 26;
const HEADER_HEIGHT = 26;
const OVERSCAN = 10;

type Row = { kind: "bin"; bin: MediaBin } | { kind: "item"; item: MediaItem };

export interface MediaListViewProps {
  data: ProjectPanelData;
  onSelectItem: (item: MediaItem, event: React.MouseEvent | React.KeyboardEvent, ordered: readonly string[]) => void;
  onOpenInSource: (item: MediaItem) => void;
  onAddToTimeline: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onDragStart: (event: React.DragEvent, item: MediaItem) => void;
}

const TypeIcon: React.FC<{ item: MediaItem }> = ({ item }) => {
  if (item.subclip) return <Scissors size={12} className="shrink-0 text-accent" aria-hidden />;
  const Icon = item.type === "audio" ? Music : item.type === "image" ? ImageIcon : Film;
  return <Icon size={12} className="shrink-0 text-fg-muted" aria-hidden />;
};

function EditableText({
  item,
  field,
  value,
}: {
  item: MediaItem;
  field: EditableTextColumn;
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  if (!editing)
    return (
      <span
        className="block min-h-[18px] truncate"
        title={value || `Double-click to add a ${field}`}
        onDoubleClick={(event) => {
          event.stopPropagation();
          done.current = false;
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (commit) void runOrganize("Edit text", setMediaText(item.id, field, draft));
  };
  return (
    <input
      autoFocus
      aria-label={`${field} for ${item.name}`}
      data-testid={`edit-${field}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="h-[18px] w-full rounded-[3px] border border-accent bg-bg-0 px-1 text-[11px] text-fg outline-none"
    />
  );
}

const BinRow: React.FC<{ bin: MediaBin; top: number; width: number; columns: MediaColumnDef[]; itemCount: number }> = ({
  bin,
  top,
  width,
  columns,
  itemCount,
}) => {
  const renaming = useProjectPanelStore((s) => s.renamingBinId === bin.id);
  const selected = useProjectPanelStore((s) => s.selectedBinIds.includes(bin.id));
  const drop = useBinDropTarget(bin.id);
  return (
    <BinContextMenu bin={bin}>
      <div
        role="row"
        aria-selected={selected}
        data-testid="bin-row"
        data-bin-id={bin.id}
        draggable={!renaming}
        onDragStart={(event) => writeBinDrag(event.dataTransfer, bin.id, useProjectPanelStore.getState().selectedBinIds)}
        onClick={() => {
          useUIStore.getState().clearSelection();
          useProjectPanelStore.getState().setSelectedBins([bin.id]);
        }}
        onDoubleClick={() => useProjectPanelStore.getState().openBin(bin.id)}
        {...drop.handlers}
        className={`absolute left-0 flex items-center border-b border-bg-2 text-[11px] ${
          drop.isOver ? "bg-accent-soft" : selected ? "bg-accent/15" : "hover:bg-bg-2"
        }`}
        style={{ top, height: LIST_ROW_HEIGHT, width }}
      >
        {columns.map((column) => (
          <div key={column.id} role="cell" data-col={column.id} className="shrink-0 truncate px-2" style={{ width: column.width }}>
            {column.id === "name" ? (
              <span className="flex items-center gap-1.5">
                <Folder size={13} className="shrink-0 text-fg-3" aria-hidden />
                {renaming ? <BinNameEditor bin={bin} className="w-full" /> : <span className="truncate text-fg-2">{bin.name}</span>}
              </span>
            ) : column.id === "label" ? (
              bin.label ? <LabelChip label={bin.label} /> : null
            ) : column.id === "type" ? (
              "Bin"
            ) : column.id === "duration" && itemCount > 0 ? (
              <span className="text-fg-3">{itemCount} {itemCount === 1 ? "item" : "items"}</span>
            ) : null}
          </div>
        ))}
      </div>
    </BinContextMenu>
  );
};

/**
 * Premiere-style Project list view: sortable, show/hide metadata columns and a
 * windowed row renderer so thousands of items stay at a handful of DOM rows.
 */
export const MediaListView: React.FC<MediaListViewProps> = ({
  data,
  onSelectItem,
  onOpenInSource,
  onAddToTimeline,
  onDelete,
  onDragStart,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const columnIds = useProjectPanelStore((s) => s.columns);
  const sort = useProjectPanelStore((s) => s.sort);
  const cycleSort = useProjectPanelStore((s) => s.cycleSort);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const selectedBins = useProjectPanelStore((s) => s.selectedBinIds);
  const revealNonce = useProjectPanelStore((s) => s.revealNonce);
  const revealMediaId = useProjectPanelStore((s) => s.revealMediaId);
  const rootDrop = useBinDropTarget(data.currentBinId);

  const columns = useMemo(
    () => MEDIA_COLUMNS.filter((c) => columnIds.includes(c.id)),
    [columnIds],
  );
  const totalWidth = useMemo(() => columns.reduce((sum, c) => sum + c.width, 0), [columns]);
  const selected = useMemo(() => new Set(selectedItems.map((s) => s.id)), [selectedItems]);

  const rows = useMemo<Row[]>(
    () => [
      ...data.visibleBins.map((bin): Row => ({ kind: "bin", bin })),
      ...data.items.map((item): Row => ({ kind: "item", item })),
    ],
    [data.visibleBins, data.items],
  );
  const orderedItemIds = useMemo(() => data.items.map((i) => i.id), [data.items]);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewHeight(node.clientHeight || 400);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Reveal in project: scroll the revealed item into the window.
  useEffect(() => {
    if (!revealMediaId) return;
    const index = rows.findIndex((r) => r.kind === "item" && r.item.id === revealMediaId);
    const node = scrollRef.current;
    if (index < 0 || !node) return;
    const top = HEADER_HEIGHT + index * LIST_ROW_HEIGHT;
    if (top < node.scrollTop + HEADER_HEIGHT || top + LIST_ROW_HEIGHT > node.scrollTop + node.clientHeight)
      node.scrollTop = Math.max(0, top - node.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop), []);

  const first = Math.max(0, Math.floor(Math.max(0, scrollTop - HEADER_HEIGHT) / LIST_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / LIST_ROW_HEIGHT) + OVERSCAN);
  const width = Math.max(totalWidth, 0);

  const cell = (item: MediaItem, column: MediaColumnId): React.ReactNode => {
    switch (column) {
      case "name":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            {item.thumbnailUrl ? (
              <img src={item.thumbnailUrl} alt="" className="h-[16px] w-[26px] shrink-0 rounded-[2px] object-cover" loading="lazy" />
            ) : (
              <TypeIcon item={item} />
            )}
            <span className={`truncate ${selected.has(item.id) ? "text-accent" : "text-fg-2"}`} title={item.name}>
              {item.name}
            </span>
          </span>
        );
      case "label":
        return item.label ? (
          <span className="flex items-center gap-1.5">
            <LabelChip label={item.label} />
            <span className="truncate text-fg-3">{mediaColumnText(item, "label", { usage: data.usage })}</span>
          </span>
        ) : null;
      case "comment":
      case "description":
      case "scene":
      case "shot":
      case "take":
        return <EditableText item={item} field={column} value={item[column] ?? ""} />;
      case "goodTake":
        return (
          <input
            type="checkbox"
            data-testid="good-take-toggle"
            aria-label={`Good take: ${item.name}`}
            checked={!!item.goodTake}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              // A checkbox on a selected row applies to the whole selection (one undo step).
              const ids = selected.has(item.id) ? [...selected] : [item.id];
              void runOrganize("Good take", setGoodTake(ids, event.target.checked));
            }}
            className="h-3 w-3 cursor-pointer accent-[var(--accent)]"
          />
        );
      default:
        return <span className="truncate text-fg-3">{mediaColumnText(item, column, { usage: data.usage })}</span>;
    }
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="grid"
      aria-label="Project media list"
      aria-rowcount={rows.length}
      data-testid="media-list"
      className={`relative min-h-0 flex-1 overflow-auto bg-bg-1 ${rootDrop.isOver ? "ring-1 ring-inset ring-accent/60" : ""}`}
      {...rootDrop.handlers}
    >
      <div style={{ width, minWidth: "100%" }}>
        <div
          role="row"
          className="sticky top-0 z-10 flex border-b border-border bg-bg-2 text-[10.5px] font-medium uppercase tracking-wide text-fg-muted"
          style={{ height: HEADER_HEIGHT, width }}
        >
          {columns.map((column) => {
            const active = sort?.column === column.id;
            return (
              <button
                key={column.id}
                type="button"
                role="columnheader"
                data-col={column.id}
                aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => cycleSort(column.id)}
                className={`flex shrink-0 items-center gap-1 px-2 text-left hover:text-fg ${active ? "text-accent" : ""} ${column.numeric ? "justify-start" : ""}`}
                style={{ width: column.width }}
              >
                <span className="truncate">{column.title}</span>
                {active && (sort!.direction === "asc" ? <ArrowUp size={10} aria-hidden /> : <ArrowDown size={10} aria-hidden />)}
              </button>
            );
          })}
        </div>
        <div style={{ height: rows.length * LIST_ROW_HEIGHT, position: "relative", width }}>
          {rows.slice(first, last).map((row, offset) => {
            const index = first + offset;
            const top = index * LIST_ROW_HEIGHT;
            if (row.kind === "bin")
              return <BinRow key={`bin-${row.bin.id}`} bin={row.bin} top={top} width={width} columns={columns} itemCount={data.itemCounts.get(row.bin.id) ?? 0} />;
            const { item } = row;
            const isSelected = selected.has(item.id);
            return (
              <MediaItemContextMenu
                key={item.id}
                item={item}
                onOpenInSource={() => onOpenInSource(item)}
                onAddToTimeline={() => onAddToTimeline(item)}
                onDelete={() => onDelete(item)}
              >
                <div
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={isSelected}
                  aria-label={`Select media ${item.name}`}
                  tabIndex={0}
                  draggable
                  data-testid="media-row"
                  data-media-id={item.id}
                  onDragStart={(event) => {
                    onDragStart(event, item);
                    writeMediaDrag(event.dataTransfer, item.id);
                  }}
                  onClick={(event) => {
                    if (selectedBins.length) useProjectPanelStore.getState().setSelectedBins([]);
                    onSelectItem(item, event, orderedItemIds);
                  }}
                  onDoubleClick={() => onOpenInSource(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpenInSource(item);
                    else if (event.key === " ") {
                      event.preventDefault();
                      onSelectItem(item, event, orderedItemIds);
                    }
                  }}
                  className={`absolute left-0 flex items-center border-b border-bg-2 text-[11px] ${
                    isSelected ? "bg-accent/15" : "hover:bg-bg-2"
                  } ${item.isPlaceholder ? "text-yellow-500" : ""}`}
                  style={{ top, height: LIST_ROW_HEIGHT, width }}
                >
                  {columns.map((column) => (
                    <div key={column.id} role="cell" data-col={column.id} className="shrink-0 truncate px-2" style={{ width: column.width }}>
                      {cell(item, column.id)}
                    </div>
                  ))}
                </div>
              </MediaItemContextMenu>
            );
          })}
        </div>
      </div>
    </div>
  );
};
