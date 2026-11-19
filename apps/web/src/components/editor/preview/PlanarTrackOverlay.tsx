import React, { useRef } from "react";
import { dragPlanarCorner, dragPlanarQuad, usePlanarTrackOverlayStore } from "../../../stores/planar-track-overlay-store";

interface Bounds { x: number; y: number; width: number; height: number }
const NAMES = ["top left", "top right", "bottom right", "bottom left"];

/**
 * The tracked surface as a draggable quad on the Program monitor. Drag a corner handle (or focus it and use the
 * arrow keys, Shift = 10 px) to fit the surface; drag inside the quad to move all four. `bounds` is the clip's
 * picture on the monitor, in the monitor frame's own pixels.
 */
export const PlanarTrackOverlay: React.FC<{ clipId: string | null; bounds: Bounds | null }> = ({ clipId, bounds }) => {
  const state = usePlanarTrackOverlayStore();
  const drag = useRef<{ corner: number | "quad"; x: number; y: number; start: number[] } | null>(null);
  if (!clipId || !bounds || state.clipId !== clipId || !state.corners || state.mediaWidth <= 0 || state.mediaHeight <= 0) return null;
  const { corners, mediaWidth, mediaHeight } = state;
  const sx = bounds.width / mediaWidth, sy = bounds.height / mediaHeight;
  const pts = [0, 1, 2, 3].map(i => ({ x: bounds.x + corners[i * 2] * sx, y: bounds.y + corners[i * 2 + 1] * sy }));
  const begin = (corner: number | "quad") => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { corner, x: event.clientX, y: event.clientY, start: corners };
  };
  const move = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.x) / sx, dy = (event.clientY - d.y) / sy;
    state.edit(d.corner === "quad" ? dragPlanarQuad(d.start, dx, dy, mediaWidth, mediaHeight) : dragPlanarCorner(d.start, d.corner, dx, dy, mediaWidth, mediaHeight));
  };
  const end = (event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const nudge = (index: number) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
    if (!delta) return;
    event.preventDefault(); event.stopPropagation();
    state.edit(dragPlanarCorner(corners, index, delta[0], delta[1], mediaWidth, mediaHeight));
  };
  const path = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <div data-testid="planar-track-overlay" className="pointer-events-none absolute inset-0 z-30">
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <polygon
          points={path}
          data-testid="planar-track-quad"
          className="pointer-events-auto cursor-move fill-accent/10 stroke-accent"
          strokeWidth={2}
          style={{ touchAction: "none" }}
          onPointerDown={begin("quad")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </svg>
      {pts.map((p, i) => (
        <span
          key={i}
          role="slider"
          tabIndex={0}
          aria-label={`Planar track ${NAMES[i]} corner at ${Math.round(corners[i * 2])}, ${Math.round(corners[i * 2 + 1])}. Drag or use arrow keys.`}
          aria-valuenow={Math.round(corners[i * 2])}
          data-testid={`planar-track-corner-${i}`}
          className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-black/70 bg-white outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ left: p.x, top: p.y, touchAction: "none" }}
          onPointerDown={begin(i)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={nudge(i)}
        />
      ))}
      <span className="pointer-events-none absolute rounded bg-black/65 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85" style={{ left: pts[0].x, top: Math.max(0, pts[0].y - 18) }}>
        Planar surface
      </span>
    </div>
  );
};
