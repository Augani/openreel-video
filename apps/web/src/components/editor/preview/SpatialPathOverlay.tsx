import React, { useMemo, useRef, useState } from "react";
import {
  SPATIAL_INTERPOLATION_LABELS,
  SPATIAL_INTERPOLATION_OPS,
  evaluateKeyframesAt,
  resolveSpatialVertices,
  sampleSpatialRoute,
  setSpatialHandle,
  type Keyframe,
} from "@openreel/core";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuLabel, ContextMenuTrigger } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { applySpatialInterpolationToClip, moveSpatialVertexOnClip, setSpatialHandleOnClip } from "../../../services/spatial-path-edit";

interface Bounds {
  /** Where position (0, 0) is on the monitor, in the overlay's own pixels. */
  originX: number;
  originY: number;
  /** Monitor pixels per project pixel, and the sequence pixel aspect ratio. */
  displayScale: number;
  par: number;
}

type Live =
  | { kind: "handle"; keyId: string; which: "in" | "out"; offset: { x: number; y: number } }
  | { kind: "vertex"; index: number; x: number; y: number };

/**
 * The position motion path of the selected clip on the Program monitor: the route, a handle pair per key
 * (Auto handles are derived, dragging one turns the key Continuous) and the key points themselves.
 * Right-click a key point for its spatial interpolation type. Drags write one undo step on release.
 * Position here is the clip's position keyframes in project pixels from the frame centre.
 */
export const SpatialPathOverlay: React.FC<{ clipId: string | null; bounds: Bounds | null; disabled?: boolean }> = ({ clipId, bounds, disabled = false }) => {
  const clip = useProjectStore((s) => (clipId ? s.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) : undefined));
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Live | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const keys = useMemo<Keyframe[] | null>(() => {
    if (!clip?.keyframes?.length) return null;
    if (!live) return clip.keyframes;
    return live.kind === "handle"
      ? setSpatialHandle(clip.keyframes, live.keyId, live.which, live.offset)
      : clip.keyframes.map((key) => {
          const vertices = resolveSpatialVertices(clip.keyframes);
          const vertex = vertices?.[live.index];
          return vertex && key.id === vertex.xKeyId ? { ...key, value: live.x } : vertex && key.id === vertex.yKeyId ? { ...key, value: live.y } : key;
        });
  }, [clip?.keyframes, live]);
  const vertices = useMemo(() => (keys ? resolveSpatialVertices(keys) : null), [keys]);
  const route = useMemo(() => (keys && vertices ? sampleSpatialRoute(keys, 24) : []), [keys, vertices]);
  if (!clip || !bounds || !keys || !vertices || bounds.displayScale <= 0) return null;

  const { originX, originY, displayScale, par } = bounds;
  const toScreen = (p: { x: number; y: number }) => ({ x: originX + p.x * par * displayScale, y: originY + p.y * displayScale });
  const pointerUnits = (event: React.PointerEvent): { x: number; y: number } | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: (event.clientX - box.left - originX) / (par * displayScale), y: (event.clientY - box.top - originY) / displayScale };
  };
  const begin = (next: Live) => (event: React.PointerEvent) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = next; setLive(next);
  };
  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    const at = pointerUnits(event);
    if (!current || !at) return;
    if (current.kind === "vertex") {
      const next = { ...current, x: at.x, y: at.y };
      drag.current = next; setLive(next);
    } else {
      const vertex = vertices.find((v) => v.xKeyId === current.keyId || v.yKeyId === current.keyId);
      if (!vertex) return;
      const next = { ...current, offset: { x: at.x - vertex.point.x, y: at.y - vertex.point.y } };
      drag.current = next; setLive(next);
    }
  };
  const end = (event: React.PointerEvent) => {
    const done = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setLive(null);
    if (!done || !clipId) return;
    if (done.kind === "vertex") moveSpatialVertexOnClip(clipId, done.index, done.x, done.y);
    else setSpatialHandleOnClip(clipId, done.keyId, done.which, done.offset);
  };

  const localTime = Math.max(0, playhead - clip.startTime);
  const here = evaluateKeyframesAt(keys, localTime);
  const marker = here.has("position.x") && here.has("position.y") ? toScreen({ x: here.get("position.x") as number, y: here.get("position.y") as number }) : null;
  return (
    <svg ref={svg} data-testid="spatial-path-overlay" className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible" aria-label="Position motion path">
      <polyline
        data-testid="spatial-path-route"
        points={route.map((p) => { const s = toScreen(p); return `${s.x},${s.y}`; }).join(" ")}
        fill="none" stroke="#22d3ee" strokeWidth={2} strokeDasharray="6 3" opacity={0.9}
      />
      {vertices.map((vertex) => {
        const at = toScreen(vertex.point);
        const sides = vertex.mode === "linear" ? [] : (["in", "out"] as const);
        return (
          <g key={vertex.xKeyId}>
            {sides.map((which) => {
              const tangent = which === "out" ? vertex.tangentOut : vertex.tangentIn;
              if (Math.hypot(tangent.x, tangent.y) < 1e-9) return null;
              const h = toScreen({ x: vertex.point.x + tangent.x, y: vertex.point.y + tangent.y });
              return (
                <g key={which}>
                  <line x1={at.x} y1={at.y} x2={h.x} y2={h.y} stroke="#fff" strokeWidth={1} opacity={0.8} />
                  <rect
                    data-testid={`spatial-handle-${vertex.index}-${which}`}
                    role="slider" tabIndex={0}
                    aria-label={`Path handle ${which} of keyframe ${vertex.index + 1}. Drag to shape the motion path.`}
                    aria-valuenow={Math.round(Math.hypot(tangent.x, tangent.y))}
                    x={h.x - 5} y={h.y - 5} width={10} height={10} fill="#fff" stroke="#000" strokeOpacity={0.7}
                    className="pointer-events-auto cursor-crosshair" style={{ touchAction: "none" }}
                    onPointerDown={begin({ kind: "handle", keyId: vertex.xKeyId, which, offset: tangent })}
                    onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = null; setLive(null); }}
                  />
                </g>
              );
            })}
            <ContextMenu>
              <ContextMenuTrigger asChild disabled={disabled}>
                <circle
                  data-testid={`spatial-vertex-${vertex.index}`} data-spatial-mode={vertex.mode}
                  role="slider" tabIndex={0}
                  aria-label={`Path point ${vertex.index + 1} (${SPATIAL_INTERPOLATION_LABELS[vertex.mode]}). Drag to move, right-click for the interpolation type.`}
                  aria-valuenow={Math.round(vertex.point.x)}
                  cx={at.x} cy={at.y} r={6} fill="#22d3ee" stroke="#000" strokeOpacity={0.7} strokeWidth={1.5}
                  className="pointer-events-auto cursor-move" style={{ touchAction: "none" }}
                  onPointerDown={begin({ kind: "vertex", index: vertex.index, x: vertex.point.x, y: vertex.point.y })}
                  onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = null; setLive(null); }}
                />
              </ContextMenuTrigger>
              <ContextMenuContent aria-label="Spatial interpolation">
                <ContextMenuLabel>Spatial Interpolation</ContextMenuLabel>
                {SPATIAL_INTERPOLATION_OPS.map((op) => (
                  <ContextMenuCheckboxItem key={op} checked={vertex.mode === op} onSelect={() => clipId && applySpatialInterpolationToClip(clipId, [vertex.xKeyId], op)}>
                    {SPATIAL_INTERPOLATION_LABELS[op]}
                  </ContextMenuCheckboxItem>
                ))}
              </ContextMenuContent>
            </ContextMenu>
          </g>
        );
      })}
      {marker && <circle data-testid="spatial-path-playhead" cx={marker.x} cy={marker.y} r={4} fill="#fff" stroke="#22d3ee" strokeWidth={2} />}
    </svg>
  );
};
