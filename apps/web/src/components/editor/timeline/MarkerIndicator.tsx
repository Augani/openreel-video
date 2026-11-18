import React from "react";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Input,
} from "@openreel/ui";
import { Flag, X } from "@/icons/lucide-compat";
import type { Marker } from "@openreel/core";
import { MARKER_COLORS } from "../../../services/marker-commands";
import { OPEN_COMMENT_COLOR, RESOLVED_COMMENT_COLOR } from "../../../services/review-commands";

type DragMode = "move" | "start" | "end";

interface MarkerIndicatorProps {
  marker: Marker;
  pixelsPerSecond: number;
  scrollX: number;
  /** "lane" draws the line and label over the tracks; "ruler" draws the draggable bar on the ruler. */
  variant?: "lane" | "ruler";
  selected?: boolean;
  frameRate?: number;
  onSeek?: (time: number) => void;
  onSelect?: (markerId: string) => void;
  onEdit?: (markerId: string) => void;
  onRemove?: (markerId: string) => void;
  onUpdate?: (markerId: string, updates: Partial<Marker>) => void;
}

/**
 * Where a marker lands when a drag of `deltaSeconds` is applied. Moving keeps
 * the length; the start handle moves the in point and keeps the out point; the
 * end handle changes the length. Everything snaps to whole frames and a range
 * is never shorter than one frame.
 */
export function dragMarker(
  marker: Pick<Marker, "time" | "duration">,
  mode: DragMode,
  deltaSeconds: number,
  frameRate = 30,
): { time: number; duration: number } {
  const frame = 1 / Math.max(1, frameRate);
  const snap = (t: number) => Math.round(t / frame) * frame;
  const duration = marker.duration ?? 0;
  const end = marker.time + duration;
  if (mode === "move") return { time: Math.max(0, snap(marker.time + deltaSeconds)), duration };
  if (mode === "start") {
    const start = Math.min(Math.max(0, snap(marker.time + deltaSeconds)), end - frame);
    return { time: start, duration: end - start };
  }
  const newEnd = Math.max(marker.time + frame, snap(end + deltaSeconds));
  return { time: marker.time, duration: newEnd - marker.time };
}

const DRAG_THRESHOLD_PX = 3;

export const MarkerIndicator: React.FC<MarkerIndicatorProps> = ({
  marker,
  pixelsPerSecond,
  scrollX,
  variant = "lane",
  selected = false,
  frameRate = 30,
  onSeek,
  onSelect,
  onEdit,
  onRemove,
  onUpdate,
}) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedLabel, setEditedLabel] = React.useState(marker.label);
  const [drag, setDrag] = React.useState<{ mode: DragMode; delta: number } | null>(null);

  const isRange = (marker.duration ?? 0) > 0;
  const shown = drag
    ? dragMarker(marker, drag.mode, drag.delta, frameRate)
    : { time: marker.time, duration: marker.duration ?? 0 };
  const x = shown.time * pixelsPerSecond - scrollX;
  const width = shown.duration * pixelsPerSecond;

  const select = () => onSelect?.(marker.id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    select();
    if (onSeek) {
      onSeek(marker.time);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) {
      onEdit(marker.id);
      return;
    }
    setEditedLabel(marker.label);
    setIsEditing(true);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove(marker.id);
    }
  };

  const handleLabelChange = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      if (onUpdate && editedLabel.trim() && editedLabel.trim() !== marker.label) {
        onUpdate(marker.id, { label: editedLabel.trim() });
      }
      setIsEditing(false);
    } else if (e.key === "Escape") {
      setEditedLabel(marker.label);
      setIsEditing(false);
    }
  };

  const beginDrag = (mode: DragMode) => (event: React.MouseEvent) => {
    if (event.button !== 0 || !onUpdate) return;
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    let delta = 0;
    let moved = false;
    const onMove = (move: MouseEvent) => {
      if (Math.abs(move.clientX - startX) >= DRAG_THRESHOLD_PX) moved = true;
      delta = (move.clientX - startX) / pixelsPerSecond;
      if (moved) setDrag({ mode, delta });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      if (!moved) {
        select();
        if (mode === "move") onSeek?.(marker.time);
        return;
      }
      const next = dragMarker(marker, mode, delta, frameRate);
      const updates: Partial<Marker> = {};
      if (Math.abs(next.time - marker.time) > 1e-6) Object.assign(updates, { time: next.time });
      if (mode !== "move" && Math.abs(next.duration - (marker.duration ?? 0)) > 1e-6) {
        Object.assign(updates, { duration: next.duration });
      }
      if (Object.keys(updates).length > 0) onUpdate(marker.id, updates);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const isComment = marker.author !== undefined || marker.status !== undefined;
  const resolvedComment = marker.status === "resolved";
  const tooltip = [marker.author ? `${marker.author}:` : "", marker.label, marker.comment && marker.comment !== marker.label ? marker.comment : ""]
    .filter(Boolean)
    .join(" ");

  const menu = (
    <ContextMenuContent className="min-w-[160px]" data-testid="marker-context-menu">
      <ContextMenuItem onSelect={() => onEdit?.(marker.id)} disabled={!onEdit}>
        Edit marker
      </ContextMenuItem>
      {isComment && (
        <ContextMenuItem
          onSelect={() =>
            onUpdate?.(marker.id, {
              status: resolvedComment ? "open" : "resolved",
              color: resolvedComment ? OPEN_COMMENT_COLOR : RESOLVED_COMMENT_COLOR,
            })
          }
          disabled={!onUpdate}
          data-testid="marker-toggle-resolved"
        >
          {resolvedComment ? "Reopen comment" : "Resolve comment"}
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!onUpdate}>Change colour</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {MARKER_COLORS.map((color) => (
            <ContextMenuItem
              key={color.value}
              onSelect={() => onUpdate?.(marker.id, { color: color.value })}
              className="gap-2"
            >
              <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: color.value }} />
              {color.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onRemove?.(marker.id)} disabled={!onRemove}>
        Delete marker
      </ContextMenuItem>
    </ContextMenuContent>
  );

  if (variant === "ruler") {
    const barWidth = isRange ? Math.max(width, 4) : 0;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-testid={isRange ? "ruler-marker-range" : "ruler-marker"}
            data-marker-id={marker.id}
            data-review-status={isComment ? (resolvedComment ? "resolved" : "open") : undefined}
            title={isComment ? tooltip : [marker.label, marker.comment].filter(Boolean).join(": ")}
            className={`absolute bottom-0 z-10 h-[10px] ${drag ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ left: `${x}px`, width: isRange ? `${barWidth}px` : 0, opacity: resolvedComment ? 0.55 : undefined }}
            onMouseDown={beginDrag("move")}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={handleDoubleClick}
          >
            {isRange ? (
              <>
                <div
                  className="h-full w-full rounded-[2px]"
                  style={{
                    backgroundColor: marker.color,
                    opacity: selected ? 1 : 0.8,
                    outline: selected ? "1px solid var(--fg, #fff)" : undefined,
                  }}
                />
                <div
                  data-testid="marker-handle-start"
                  aria-label="Resize marker start"
                  className="absolute left-0 top-0 h-full w-[6px] cursor-ew-resize"
                  onMouseDown={beginDrag("start")}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
                <div
                  data-testid="marker-handle-end"
                  aria-label="Resize marker end"
                  className="absolute right-0 top-0 h-full w-[6px] cursor-ew-resize"
                  onMouseDown={beginDrag("end")}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
              </>
            ) : (
              <div
                className="absolute bottom-0 h-[10px] w-[10px] -translate-x-1/2 rounded-b-[3px]"
                style={{
                  backgroundColor: marker.color,
                  clipPath: "polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)",
                  outline: selected ? "1px solid var(--fg, #fff)" : undefined,
                }}
              />
            )}
          </div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="absolute top-0 bottom-0 flex flex-col items-center cursor-pointer z-20"
          style={{ left: `${x}px` }}
          data-marker-id={marker.id}
          data-selected={selected || undefined}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {isRange && (
            <div
              aria-hidden="true"
              data-testid="marker-range-band"
              className="pointer-events-none absolute inset-y-0 left-0"
              style={{ width: `${width}px`, backgroundColor: marker.color, opacity: selected ? 0.22 : 0.12 }}
            />
          )}
          <div
            className="w-0.5 h-full transition-opacity"
            style={{
              backgroundColor: marker.color,
              opacity: isHovered || selected ? 1 : 0.6,
            }}
          />

          <div
            className="absolute top-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap transition-all shadow-lg"
            style={{
              backgroundColor: marker.color,
              color: "#fff",
              transform: isHovered ? "scale(1.05)" : "scale(1)",
            }}
          >
            <Flag size={10} />
            {isEditing ? (
              <Input
                aria-label="Marker label"
                className="h-7 w-[92px] text-xs"
                value={editedLabel}
                onChange={(event) => setEditedLabel(event.target.value)}
                onKeyDown={handleLabelChange}
                onBlur={() => {
                  setEditedLabel(marker.label);
                  setIsEditing(false);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{marker.label}</span>
            )}
            {isHovered && onRemove && (
              <Button variant="ghost" size="icon-sm" onClick={handleRemove} type="button" aria-label="Remove marker" title="Remove marker" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg ml-1">
                {<X size={10} aria-hidden />}
              </Button>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  );
};
