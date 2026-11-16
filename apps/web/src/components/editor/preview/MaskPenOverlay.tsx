import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deletePoint,
  editMaskStructure,
  insertPoint,
  isSmoothPoint,
  maskPathAtTime,
  moveHandle,
  movePoint,
  nearestOnPath,
  pathContains,
  penAddPoint,
  penDragHandle,
  penToPath,
  pullHandles,
  segmentControls,
  segmentCount,
  toggleSmooth,
  translatePath,
  type BezierPath,
  type BezierPoint,
  type HandleKind,
  type MaskPoint,
} from "@openreel/core";
import { useShallow } from "zustand/react/shallow";
import { useMaskPenStore } from "../../../stores/mask-pen-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  beginMaskGesture,
  commitMaskEdit,
  commitNewMask,
  type MaskGesture,
} from "../../../services/mask-pen";

/** Pointer hit radii in CSS pixels, constant at every Program zoom. */
const VERTEX_HIT = 9;
const HANDLE_HIT = 8;
const SEGMENT_HIT = 7;
const CLOSE_HIT = 11;
/** A drag shorter than this (px) is a plain click, not a handle pull. */
const DRAG_START = 3;

type Drag =
  | { kind: "draw"; downPx: MaskPoint }
  | { kind: "vertex"; index: number; gesture: MaskGesture; basePath: BezierPath }
  | { kind: "pull"; index: number; gesture: MaskGesture; basePath: BezierPath }
  | { kind: "handle"; index: number; which: HandleKind; independent: boolean; gesture: MaskGesture; basePath: BezierPath }
  | { kind: "body"; origin: MaskPoint; gesture: MaskGesture; basePath: BezierPath };

function svgPath(path: BezierPath, w: number, h: number): string {
  const n = path.points.length;
  if (n === 0) return "";
  const at = (p: MaskPoint): string => `${(p.x * w).toFixed(2)} ${(p.y * h).toFixed(2)}`;
  let d = `M ${at(path.points[0])}`;
  for (let i = 0; i < segmentCount(path); i++) {
    const [, c1, c2, p] = segmentControls(path, i);
    d += ` C ${at(c1)} ${at(c2)} ${at(p)}`;
  }
  return path.closed ? `${d} Z` : d;
}

/**
 * Program monitor overlay of the mask pen tool. It covers exactly the
 * composition frame, so every coordinate is the pointer position normalised to
 * the frame's measured box: it is independent of the Program zoom and scroll.
 *
 * Draw mode (no mask selected): click = corner vertex, click-drag = smooth
 * vertex, click the first vertex (or Enter) = close and add the mask.
 * Edit mode: drag vertices / handles / the shape, click an edge to insert a
 * vertex, double-click (or Alt-click) a vertex to switch corner/smooth,
 * Alt-drag a vertex to pull handles, Delete removes the selected vertex.
 * Each gesture is one undo step; on a keyframed mask the edit becomes a path
 * keyframe at the playhead.
 */
export function MaskPenOverlay({ disabled = false }: { disabled?: boolean }) {
  // The armed overlay follows the playhead; keep that subscription (a re-render
  // per playback tick) out of the editor entirely while the pen is off.
  const armed = useMaskPenStore((s) => s.active);
  return armed ? <MaskPenOverlayArmed disabled={disabled} /> : null;
}

function MaskPenOverlayArmed({ disabled = false }: { disabled?: boolean }) {
  const { active, clipId, maskId, vertex } = useMaskPenStore(
    useShallow((s) => ({ active: s.active, clipId: s.clipId, maskId: s.maskId, vertex: s.vertex })),
  );
  const mask = useProjectStore((s) =>
    maskId ? (s.project.masks ?? []).find((m) => m.id === maskId && m.clipId === clipId) : undefined,
  );
  const playhead = useTimelineStore((s) => s.playheadPosition);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [draft, setDraft] = useState<BezierPoint[]>([]);
  const draftRef = useRef<BezierPoint[]>([]);
  const [hover, setHover] = useState<MaskPoint | null>(null);
  const [live, setLive] = useState<BezierPath | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  const setDraftBoth = useCallback((points: BezierPoint[]) => {
    draftRef.current = points;
    setDraft(points);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // A mask that disappeared (deleted / undone) drops the tool back to drawing.
  useEffect(() => {
    if (active && maskId && !mask) useMaskPenStore.getState().setMask(null);
  }, [active, maskId, mask]);

  // The tool belongs to one clip: leaving it (project change, clip removed) disarms it.
  const clipExists = useProjectStore((s) =>
    clipId ? s.project.timeline.tracks.some((t) => t.clips.some((c) => c.id === clipId)) : false,
  );
  useEffect(() => {
    if (active && !clipExists) useMaskPenStore.getState().disarm();
  }, [active, clipExists]);

  useEffect(() => {
    if (!active) {
      setDraftBoth([]);
      setLive(null);
      dragRef.current = null;
    }
  }, [active, setDraftBoth]);

  const shownPath: BezierPath | null = useMemo(
    () => live ?? (mask ? maskPathAtTime(mask, playhead) : null),
    [live, mask, playhead],
  );

  const toNorm = useCallback((e: { clientX: number; clientY: number }): { n: MaskPoint; px: MaskPoint } => {
    const r = rootRef.current!.getBoundingClientRect();
    const px = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { n: { x: px.x / r.width, y: px.y / r.height }, px };
  }, []);

  const toPx = useCallback(
    (p: MaskPoint): MaskPoint => ({ x: p.x * size.w, y: p.y * size.h }),
    [size],
  );

  const dist = (a: MaskPoint, b: MaskPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

  /** What the pointer is over in edit mode. */
  const hitTest = useCallback(
    (px: MaskPoint, n: MaskPoint, path: BezierPath) => {
      const sel = useMaskPenStore.getState().vertex;
      if (sel !== null && path.points[sel]) {
        const p = path.points[sel];
        for (const which of ["in", "out"] as const) {
          const h = which === "in" ? p.handleIn : p.handleOut;
          if (h && dist(px, toPx(h)) <= HANDLE_HIT) return { kind: "handle" as const, index: sel, which };
        }
      }
      let best = -1;
      let bestD = VERTEX_HIT;
      path.points.forEach((p, i) => {
        const d = dist(px, toPx(p));
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) return { kind: "vertex" as const, index: best };
      const hit = nearestOnPath(path, n);
      if (hit && dist(px, toPx(hit.point)) <= SEGMENT_HIT) {
        return { kind: "segment" as const, segment: hit.segment, t: hit.t };
      }
      if (pathContains(path, n)) return { kind: "body" as const };
      return { kind: "none" as const };
    },
    [toPx],
  );

  const finishDraft = useCallback(async () => {
    const pts = draftRef.current;
    const path = penToPath(pts);
    if (!path || !clipId) return;
    setDraftBoth([]);
    const id = await commitNewMask(clipId, path);
    if (id) useMaskPenStore.getState().setMask(id);
  }, [clipId, setDraftBoth]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !clipId || e.button !== 0) return;
    e.stopPropagation();
    rootRef.current?.focus({ preventScroll: true });
    const { n, px } = toNorm(e);

    // ---- draw mode ---------------------------------------------------------
    if (!maskId || !mask) {
      const pts = draftRef.current;
      if (pts.length >= 3 && dist(px, toPx(pts[0])) <= CLOSE_HIT) {
        void finishDraft();
        return;
      }
      setDraftBoth(penAddPoint(pts, n));
      dragRef.current = { kind: "draw", downPx: px };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // ---- edit mode ---------------------------------------------------------
    const path = shownPath;
    if (!path) return;
    const hit = hitTest(px, n, path);
    const begin = () => beginMaskGesture(clipId, maskId);

    if (hit.kind === "handle") {
      const gesture = begin();
      if (!gesture) return;
      dragRef.current = { kind: "handle", index: hit.index, which: hit.which, independent: e.altKey, gesture, basePath: path };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (hit.kind === "vertex") {
      useMaskPenStore.getState().setVertex(hit.index);
      if (e.detail >= 2 || (e.altKey && isSmoothPoint(path.points[hit.index]))) {
        void commitMaskEdit(clipId, maskId, (m) => editMaskStructure(m, (p) => toggleSmooth(p, hit.index)));
        return;
      }
      const gesture = begin();
      if (!gesture) return;
      dragRef.current = { kind: e.altKey ? "pull" : "vertex", index: hit.index, gesture, basePath: path };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (hit.kind === "segment") {
      void (async () => {
        const ok = await commitMaskEdit(clipId, maskId, (m) =>
          editMaskStructure(m, (p) => insertPoint(p, hit.segment, hit.t)),
        );
        if (ok) useMaskPenStore.getState().setVertex(hit.segment + 1);
      })();
    } else if (hit.kind === "body") {
      useMaskPenStore.getState().setVertex(null);
      const gesture = begin();
      if (!gesture) return;
      dragRef.current = { kind: "body", origin: n, gesture, basePath: path };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      useMaskPenStore.getState().setVertex(null);
      // Clicking empty canvas with a mask open starts a new one, like the pen tool does.
      useMaskPenStore.getState().setMask(null);
      setDraftBoth(penAddPoint([], n));
      dragRef.current = { kind: "draw", downPx: px };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !active) return;
    const { n, px } = toNorm(e);
    const drag = dragRef.current;
    if (!drag) {
      setHover(n);
      if (maskId && mask && shownPath) {
        const hit = hitTest(px, n, shownPath);
        setCursor(
          hit.kind === "vertex" || hit.kind === "handle" ? "move" : hit.kind === "segment" ? "copy" : hit.kind === "body" ? "grab" : "crosshair",
        );
      } else {
        const pts = draftRef.current;
        setCursor(pts.length >= 3 && dist(px, toPx(pts[0])) <= CLOSE_HIT ? "pointer" : "crosshair");
      }
      return;
    }
    if (drag.kind === "draw") {
      if (dist(px, drag.downPx) >= DRAG_START) setDraftBoth(penDragHandle(draftRef.current, n));
      return;
    }
    let next: BezierPath;
    if (drag.kind === "vertex") next = movePoint(drag.basePath, drag.index, n);
    else if (drag.kind === "pull") next = pullHandles(drag.basePath, drag.index, n);
    else if (drag.kind === "handle") next = moveHandle(drag.basePath, drag.index, drag.which, n, drag.independent || e.altKey);
    else next = translatePath(drag.basePath, n.x - drag.origin.x, n.y - drag.origin.y);
    setLive(next);
    drag.gesture.update(next);
  };

  const endDrag = async (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
    if (!drag || drag.kind === "draw") return;
    await drag.gesture.end();
    setLive(null);
  };

  // ---- keyboard ------------------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (draftRef.current.length > 0) setDraftBoth([]);
        else useMaskPenStore.getState().disarm();
      } else if (e.key === "Enter" && draftRef.current.length >= 3) {
        e.stopPropagation();
        void finishDraft();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !disabled) {
        const sel = useMaskPenStore.getState().vertex;
        const st = useMaskPenStore.getState();
        if (draftRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setDraftBoth(draftRef.current.slice(0, -1));
        } else if (sel !== null && st.clipId && st.maskId) {
          e.preventDefault();
          e.stopImmediatePropagation();
          void commitMaskEdit(st.clipId, st.maskId, (m) => editMaskStructure(m, (p) => deletePoint(p, sel)));
          useMaskPenStore.getState().setVertex(null);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, disabled, finishDraft, setDraftBoth]);

  if (!active || !clipId) return null;

  const w = size.w;
  const h = size.h;
  const editing = Boolean(maskId && mask && shownPath);
  const draftPath: BezierPath | null = draft.length >= 2 ? { closed: false, points: draft } : null;
  const sel = vertex !== null && shownPath ? shownPath.points[vertex] : undefined;
  const ACCENT = "var(--accent, #4da3ff)";
  const rubber =
    !editing && draft.length > 0 && hover && !dragRef.current
      ? { a: toPx(draft[draft.length - 1]), b: toPx(hover) }
      : null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="mask-pen-overlay"
      data-mask-pen-mode={editing ? "edit" : "draw"}
      aria-label={editing ? "Mask pen: edit mask" : "Mask pen: draw mask"}
      className="absolute inset-0 z-40 outline-none"
      style={{ cursor: disabled ? "not-allowed" : cursor, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => void endDrag(e)}
      onPointerCancel={(e) => void endDrag(e)}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width={w} height={h} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
        {editing && shownPath && (
          <>
            <path d={svgPath(shownPath, w, h)} fill="rgba(77,163,255,0.10)" stroke="rgba(0,0,0,0.65)" strokeWidth={3.5} data-testid="mask-pen-outline-shadow" />
            <path d={svgPath(shownPath, w, h)} fill="none" stroke={ACCENT} strokeWidth={1.5} data-testid="mask-pen-outline" />
            {sel && (
              <>
                {(["in", "out"] as const).map((which) => {
                  const hd = which === "in" ? sel.handleIn : sel.handleOut;
                  if (!hd) return null;
                  const a = toPx(sel);
                  const b = toPx(hd);
                  return (
                    <g key={which}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={1} />
                      <circle cx={b.x} cy={b.y} r={4} fill="#fff" stroke={ACCENT} strokeWidth={1.5} data-testid={`mask-handle-${which}`} />
                    </g>
                  );
                })}
              </>
            )}
            {shownPath.points.map((p, i) => {
              const c = toPx(p);
              const smooth = isSmoothPoint(p);
              const selected = i === vertex;
              return smooth ? (
                <circle
                  key={i}
                  cx={c.x}
                  cy={c.y}
                  r={5}
                  fill={selected ? ACCENT : "#fff"}
                  stroke={selected ? "#fff" : ACCENT}
                  strokeWidth={1.5}
                  data-testid="mask-vertex"
                  data-index={i}
                  data-smooth="true"
                />
              ) : (
                <rect
                  key={i}
                  x={c.x - 4.5}
                  y={c.y - 4.5}
                  width={9}
                  height={9}
                  fill={selected ? ACCENT : "#fff"}
                  stroke={selected ? "#fff" : ACCENT}
                  strokeWidth={1.5}
                  data-testid="mask-vertex"
                  data-index={i}
                  data-smooth="false"
                />
              );
            })}
          </>
        )}
        {!editing && draftPath && (
          <>
            <path d={svgPath(draftPath, w, h)} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth={3.5} />
            <path d={svgPath(draftPath, w, h)} fill="none" stroke={ACCENT} strokeWidth={1.5} data-testid="mask-pen-draft" />
          </>
        )}
        {!editing && rubber && (
          <line x1={rubber.a.x} y1={rubber.a.y} x2={rubber.b.x} y2={rubber.b.y} stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" />
        )}
        {!editing &&
          draft.map((p, i) => {
            const c = toPx(p);
            const first = i === 0;
            return (
              <g key={i}>
                {p.handleOut && p.handleIn && (
                  <>
                    <line x1={toPx(p.handleIn).x} y1={toPx(p.handleIn).y} x2={toPx(p.handleOut).x} y2={toPx(p.handleOut).y} stroke={ACCENT} strokeWidth={1} />
                    <circle cx={toPx(p.handleOut).x} cy={toPx(p.handleOut).y} r={3.5} fill="#fff" stroke={ACCENT} strokeWidth={1.5} />
                    <circle cx={toPx(p.handleIn).x} cy={toPx(p.handleIn).y} r={3.5} fill="#fff" stroke={ACCENT} strokeWidth={1.5} />
                  </>
                )}
                <rect
                  x={c.x - 4.5}
                  y={c.y - 4.5}
                  width={9}
                  height={9}
                  fill={first && draft.length >= 3 ? ACCENT : "#fff"}
                  stroke={first && draft.length >= 3 ? "#fff" : ACCENT}
                  strokeWidth={1.5}
                  data-testid="mask-draft-vertex"
                  data-index={i}
                />
              </g>
            );
          })}
      </svg>
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] font-medium text-white/90">
        {editing
          ? "Pen · drag points · click edge to add · double-click to smooth/corner · Del removes · Esc exits"
          : draft.length >= 3
            ? "Pen · click the first point or press Enter to close · Esc cancels"
            : "Pen · click for a corner, drag for a smooth point"}
      </div>
    </div>
  );
}
