import React, { useRef, useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useCornerPinOverlayStore } from "../../../stores/corner-pin-overlay-store";
import { CORNER_PIN_LIMITS, cornerPinPercentAt, moveCornerPinCorner } from "../../../services/corner-pin-edit";

const NAMES = ["top left", "top right", "bottom right", "bottom left"];

/**
 * The Corner Pin effect's four corners as draggable handles on the Program monitor. Positions are percent of the
 * program frame (the effect's own coordinates, before the clip's Transform). Dragging writes one undo step on
 * release; a corner that is keyframed gets a keyframe at the playhead, a static one changes its stored value.
 * Arrow keys nudge a focused handle by 0.1% (Shift: 1%).
 */
export const CornerPinOverlay: React.FC = () => {
  const { clipId, effectId } = useCornerPinOverlayStore();
  const clip = useProjectStore((s) => (clipId ? s.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) : undefined));
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ corner: number } | null>(null);
  const [live, setLive] = useState<number[] | null>(null);
  const effect = clip?.effects.find((e) => e.id === effectId && e.type === "corner-pin");
  if (!clip || !effect) return null;
  const localTime = playhead - clip.startTime;
  const stored = cornerPinPercentAt(clip.keyframes, effect, localTime);
  const pct = live ?? stored;
  const inside = localTime >= -1e-6 && localTime <= clip.duration + 1e-6;
  const pointer = (event: React.PointerEvent): [number, number] | null => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const clamp = (v: number) => Math.max(CORNER_PIN_LIMITS.min, Math.min(CORNER_PIN_LIMITS.max, v));
    return [clamp((event.clientX - box.left) / box.width * 100), clamp((event.clientY - box.top) / box.height * 100)];
  };
  const begin = (corner: number) => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { corner };
  };
  const move = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const at = pointer(event);
    if (at) setLive((live ?? stored).map((v, i) => (i === drag.current!.corner * 2 ? at[0] : i === drag.current!.corner * 2 + 1 ? at[1] : v)));
  };
  const end = (event: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const at = pointer(event);
    setLive(null);
    if (d && at && inside) void moveCornerPinCorner(clip.id, effect.id, d.corner, at[0], at[1], localTime);
  };
  const nudge = (corner: number) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 1 : 0.1;
    const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
    if (!delta || !inside) return;
    event.preventDefault(); event.stopPropagation();
    void moveCornerPinCorner(clip.id, effect.id, corner, stored[corner * 2] + delta[0], stored[corner * 2 + 1] + delta[1], localTime);
  };
  const points = [0, 1, 2, 3].map((i) => ({ x: pct[i * 2], y: pct[i * 2 + 1] }));
  return (
    <div ref={frame} data-testid="corner-pin-overlay" className="pointer-events-none absolute inset-0 z-30">
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-accent/10 stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="corner-pin-quad" />
      </svg>
      {points.map((p, i) => (
        <span
          key={i}
          role="slider"
          tabIndex={0}
          aria-label={`Corner pin ${NAMES[i]} corner at ${p.x.toFixed(1)}%, ${p.y.toFixed(1)}%. Drag or use arrow keys.`}
          aria-valuenow={Math.round(p.x * 10) / 10}
          data-testid={`corner-pin-handle-${i}`}
          className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-black/70 bg-white outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ left: `${p.x}%`, top: `${p.y}%`, touchAction: "none", opacity: inside ? 1 : 0.4 }}
          onPointerDown={begin(i)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => { drag.current = null; setLive(null); }}
          onKeyDown={nudge(i)}
        />
      ))}
      <span className="pointer-events-none absolute rounded bg-black/65 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85" style={{ left: `${points[0].x}%`, top: `calc(${points[0].y}% - 18px)` }}>
        Corner pin
      </span>
    </div>
  );
};
