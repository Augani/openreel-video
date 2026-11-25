import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { maskPathAtTime, segmentCount, segmentControls, type BezierPath, type MaskPoint } from "@openreel/core";
import { useShallow } from "zustand/react/shallow";
import { useObjectMaskStore } from "../../../stores/object-mask-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { applyObjectSegmentation, displayPathOf } from "../../../services/object-mask";

const ACCENT = "#4da3ff";
/** A pointer travel shorter than this (CSS px) is a click, not a brush stroke. */
const STROKE_START = 4;

function svgPath(path: BezierPath, w: number, h: number): string {
  if (path.points.length === 0) return "";
  const at = (p: MaskPoint): string => `${(p.x * w).toFixed(2)} ${(p.y * h).toFixed(2)}`;
  let d = `M ${at(path.points[0])}`;
  for (let i = 0; i < segmentCount(path); i++) {
    const [, c1, c2, p] = segmentControls(path, i);
    d += ` C ${at(c1)} ${at(c2)} ${at(p)}`;
  }
  return path.closed ? `${d} Z` : d;
}

/**
 * Program monitor overlay of the object mask tool. It covers exactly the composition frame. Click an object to
 * mask it (Alt-click removes what the cut leaked into, a further click adds what it missed); in brush mode paint
 * over the object instead (Alt-brush paints what is not the object). Each result is one undo step.
 */
export function ObjectMaskOverlay({ disabled = false }: { disabled?: boolean }) {
  const armed = useObjectMaskStore((s) => s.active);
  return armed ? <ObjectMaskOverlayArmed disabled={disabled} /> : null;
}

function ObjectMaskOverlayArmed({ disabled }: { disabled: boolean }) {
  const { clipId, mode, maskId, busy, error, prompt } = useObjectMaskStore(
    useShallow((s) => ({ clipId: s.clipId, mode: s.mode, maskId: s.maskId, busy: s.busy, error: s.error, prompt: s.prompt })),
  );
  const mask = useProjectStore((s) => (maskId ? (s.project.masks ?? []).find((m) => m.id === maskId && m.clipId === clipId) : undefined));
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const clipExists = useProjectStore((s) => (clipId ? s.project.timeline.tracks.some((t) => t.clips.some((c) => c.id === clipId)) : false));
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const dragRef = useRef<{ start: { x: number; y: number }; points: MaskPoint[]; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<MaskPoint[]>([]);

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
  }, []);

  useEffect(() => {
    if (!clipExists) useObjectMaskStore.getState().disarm();
  }, [clipExists]);

  const disarm = useCallback(() => useObjectMaskStore.getState().disarm(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopPropagation();
        disarm();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [disarm]);

  const run = useCallback(async () => {
    const state = useObjectMaskStore.getState();
    if (!state.clipId) return;
    state.setBusy(true);
    try {
      const id = await applyObjectSegmentation(state.clipId, state.prompt, state.maskId);
      useObjectMaskStore.getState().setMask(id);
      useObjectMaskStore.getState().setBusy(false);
    } catch (e) {
      useObjectMaskStore.getState().setBusy(false, e instanceof Error ? e.message : "Segmentation failed");
    }
  }, []);

  const normalise = (e: React.PointerEvent): { n: MaskPoint; px: { x: number; y: number } } => {
    const box = rootRef.current!.getBoundingClientRect();
    const px = { x: e.clientX - box.left, y: e.clientY - box.top };
    return { n: { x: px.x / Math.max(1, box.width), y: px.y / Math.max(1, box.height) }, px };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || busy || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { n, px } = normalise(e);
    dragRef.current = { start: px, points: [n], moved: false };
    setDraft([n]);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { n, px } = normalise(e);
    if (!drag.moved && Math.hypot(px.x - drag.start.x, px.y - drag.start.y) >= STROKE_START) drag.moved = true;
    if (drag.moved && mode === "brush") {
      drag.points.push(n);
      setDraft([...drag.points]);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraft([]);
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const exclude = e.altKey;
    const store = useObjectMaskStore.getState();
    if (mode === "brush" && drag.moved) store.addStroke(drag.points, !exclude);
    else store.addPoint(exclude ? "exclude" : "include", drag.points[0]);
    void run();
  };

  const w = size.w;
  const h = size.h;
  // A stabilized clip moves the tracked outline with the warp, so it is redrawn when the warp changes.
  const stabilization = useProjectStore((s) => (clipId ? s.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)?.stabilization : undefined));
  const shown = useMemo(() => (mask && clipId ? displayPathOf(clipId, mask, playhead) : mask ? maskPathAtTime(mask, playhead) : null), [mask, clipId, playhead, stabilization]);
  const marks = [...prompt.include.map((p) => ({ p, include: true })), ...prompt.exclude.map((p) => ({ p, include: false }))];

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="object-mask-overlay"
      data-object-mask-mode={mode}
      data-object-mask-busy={busy ? "true" : "false"}
      aria-label={`Object mask: ${mode}`}
      className="absolute inset-0 z-40 outline-none"
      style={{ cursor: disabled ? "not-allowed" : busy ? "progress" : "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; setDraft([]); }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width={w} height={h} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
        {shown && (
          <>
            <path d={svgPath(shown, w, h)} fill="rgba(77,163,255,0.16)" stroke="rgba(0,0,0,0.65)" strokeWidth={3.5} />
            <path d={svgPath(shown, w, h)} fill="none" stroke={ACCENT} strokeWidth={1.5} data-testid="object-mask-outline" />
          </>
        )}
        {draft.length > 1 && (
          <polyline points={draft.map((p) => `${p.x * w},${p.y * h}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
        )}
        {prompt.strokes.map((s, i) => (
          <polyline key={i} points={s.points.map((p) => `${p.x * w},${p.y * h}`).join(" ")} fill="none" stroke={s.include ? "#3ddc84" : "#ff5d5d"} strokeWidth={3} strokeLinecap="round" opacity={0.6} />
        ))}
        {marks.map((m, i) => (
          <circle key={i} cx={m.p.x * w} cy={m.p.y * h} r={4.5} fill={m.include ? "#3ddc84" : "#ff5d5d"} stroke="#fff" strokeWidth={1.5} />
        ))}
      </svg>
      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/65 px-2 py-1 text-[10px] font-medium text-white/90" onPointerDown={(e) => e.stopPropagation()}>
        <span>{busy ? "Segmenting…" : mode === "click" ? "Object mask · click an object (Alt-click removes)" : "Object mask · brush over the object (Alt-brush removes)"}</span>
        {(["click", "brush"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-label={`Object mask ${m} mode`}
            aria-pressed={mode === m}
            onClick={(e) => { e.stopPropagation(); useObjectMaskStore.getState().setMode(m); }}
            className={`rounded px-1.5 py-0.5 capitalize ${mode === m ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}
          >
            {m}
          </button>
        ))}
        <button type="button" aria-label="Finish object mask" onClick={(e) => { e.stopPropagation(); disarm(); }} className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20">
          Done
        </button>
      </div>
      {error && (
        <div role="alert" className="pointer-events-none absolute left-2 top-9 max-w-[80%] rounded bg-red-900/80 px-2 py-1 text-[10px] text-white">
          {error}
        </div>
      )}
    </div>
  );
}
