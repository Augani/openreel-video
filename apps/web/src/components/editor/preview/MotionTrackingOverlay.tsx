import React, { useRef } from "react";
import {
  dragTrackingRegion,
  useMotionTrackingOverlayStore,
  type TrackingHandle,
} from "../../../stores/motion-tracking-overlay-store";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HANDLES: Array<{ handle: Exclude<TrackingHandle, "move">; label: string; style: React.CSSProperties; cursor: string }> = [
  { handle: "nw", label: "top left", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
  { handle: "n", label: "top", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
  { handle: "ne", label: "top right", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
  { handle: "e", label: "right", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
  { handle: "se", label: "bottom right", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
  { handle: "s", label: "bottom", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
  { handle: "sw", label: "bottom left", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
  { handle: "w", label: "left", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
];

/**
 * Draggable motion-tracking target on the Program monitor. The solid box is the
 * region the tracker follows; the dashed box around it is the area it searches
 * each frame. Drag the box to move it, drag a handle to resize it, or focus it
 * and use the arrow keys (Shift = 10 px). `bounds` is the tracked clip's picture
 * on the monitor, in the monitor frame's own pixels.
 */
export const MotionTrackingOverlay: React.FC<{ clipId: string | null; bounds: Bounds | null }> = ({ clipId, bounds }) => {
  const state = useMotionTrackingOverlayStore();
  const drag = useRef<{ handle: TrackingHandle; startX: number; startY: number; region: NonNullable<typeof state.region> } | null>(null);
  if (!clipId || !bounds || state.clipId !== clipId || !state.region || state.mediaWidth <= 0 || state.mediaHeight <= 0) return null;
  const { region, mediaWidth, mediaHeight, searchMargin, point } = state;
  const sx = bounds.width / mediaWidth, sy = bounds.height / mediaHeight;
  const box = { left: bounds.x + region.x * sx, top: bounds.y + region.y * sy, width: region.width * sx, height: region.height * sy };
  const margin = { x: searchMargin * sx, y: searchMargin * sy };

  const begin = (handle: TrackingHandle) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, startX: event.clientX, startY: event.clientY, region };
  };
  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / sx, dy = (event.clientY - current.startY) / sy;
    state.edit(dragTrackingRegion(current.region, current.handle, dx, dy, mediaWidth, mediaHeight));
  };
  const end = (event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const nudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    state.edit(dragTrackingRegion(region, "move", delta[0], delta[1], mediaWidth, mediaHeight));
  };

  return (
    <div data-testid="motion-tracking-overlay" className="pointer-events-none absolute inset-0 z-30">
      <div
        aria-hidden="true"
        data-testid="motion-tracking-search"
        className="absolute rounded-[2px] border border-dashed border-accent/70"
        style={{ left: box.left - margin.x, top: box.top - margin.y, width: box.width + margin.x * 2, height: box.height + margin.y * 2 }}
      />
      <div
        role="group"
        tabIndex={0}
        aria-label={`Motion tracking target, ${region.width} by ${region.height} at ${region.x}, ${region.y}. Drag to move, arrow keys to nudge.`}
        data-testid="motion-tracking-target"
        className="pointer-events-auto absolute cursor-move rounded-[2px] border-2 border-accent bg-accent/10 outline-none focus-visible:ring-2 focus-visible:ring-white"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height, touchAction: "none" }}
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={nudge}
      >
        {HANDLES.map(item => (
          <span
            key={item.handle}
            role="presentation"
            data-resize-handle={item.handle}
            title={`Resize from ${item.label}`}
            className="pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-black/70 bg-white"
            style={{ ...item.style, cursor: item.cursor, touchAction: "none" }}
            onPointerDown={begin(item.handle)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-accent" />
          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-accent" />
        </span>
      </div>
      {point ? (
        <span
          aria-hidden="true"
          data-testid="motion-tracking-point"
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/70 bg-yellow-300"
          style={{ left: bounds.x + point.x * sx, top: bounds.y + point.y * sy }}
        />
      ) : null}
      <span className="pointer-events-none absolute rounded bg-black/65 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85" style={{ left: box.left, top: Math.max(0, box.top - 16) }}>
        Track target
      </span>
    </div>
  );
};
