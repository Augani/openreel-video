import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  GAIN_DB_MAX,
  GAIN_DB_MIN,
  dbToVolume,
  deleteAutomationPoint,
  getVolumeAutomationPointsForRange,
  insertAutomationPoint,
  moveAutomationPoint,
  scaleAutomationRange,
  volumeToDb,
  type AutomationPoint,
  type Clip,
} from "@openreel/core";
import { commitClipGainPoints, clipGainPoints } from "../../../services/clip-gain-edit";
import { dbToFraction, formatGainDb, fractionToDb } from "./clip-gain-geometry";

/** Pixels of pointer travel before a press on the line becomes a drag instead of a click. */
const DRAG_SLOP = 3;
/** Shift-dragging a point snaps it to 0 dB when it lands this close. */
const SNAP_UNITY_DB = 1.5;
const GRID_DB = [12, 6, 0, -12, -24, -48] as const;

type Gesture =
  | {
      kind: "point";
      index: number;
      start: AutomationPoint[];
      x: number;
      y: number;
      /** A point added by this very press: committing is required even without movement. */
      inserted: boolean;
      moved: boolean;
    }
  | {
      kind: "segment";
      /** Index into the full (0..duration) vertex list. */
      segment: number;
      start: AutomationPoint[];
      x: number;
      y: number;
      db: number;
      moved: boolean;
    };

interface Tip {
  x: number;
  y: number;
  text: string;
}

type Commit = (clipId: string, points: AutomationPoint[] | null) => unknown;

interface ClipGainLineProps {
  clip: Clip;
  /** Drawn width in px (the clip's width). */
  width: number;
  /** Drawn height in px (the clip's height). */
  height: number;
  locked: boolean;
  music?: boolean;
  /** Receives the finished gesture. Defaults to one undoable `audio/addAutomation`. */
  onCommit?: Commit;
}

const defaultCommit: Commit = (clipId, points) => commitClipGainPoints(clipId, points);

/** Every vertex of the audible gain curve, including the implicit ends at 0 and the clip end. */
function curveVertices(points: readonly AutomationPoint[], clip: Clip): AutomationPoint[] {
  const full = getVolumeAutomationPointsForRange(points, 0, clip.duration, clip.volume);
  return full.length
    ? full
    : [
        { time: 0, value: clip.volume },
        { time: clip.duration, value: clip.volume },
      ];
}

function valueOnCurve(vertices: readonly AutomationPoint[], time: number): number {
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i - 1];
    const b = vertices[i];
    if (time <= b.time) {
      const span = b.time - a.time;
      return span <= 0 ? b.value : a.value + ((b.value - a.value) * (time - a.time)) / span;
    }
  }
  return vertices[vertices.length - 1]?.value ?? 1;
}

function ClipGainLineImpl({ clip, width, height, locked, music = false, onCommit = defaultCommit }: ClipGainLineProps) {
  const stored = clipGainPoints(clip);
  const [draft, setDraftState] = useState<AutomationPoint[] | null>(null);
  // The latest preview, readable synchronously when the pointer is released.
  const draftRef = useRef<AutomationPoint[] | null>(null);
  const setDraft = useCallback((next: AutomationPoint[] | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef({ clip, stored });
  latest.current = { clip, stored };

  useEffect(() => () => cleanup.current?.(), []);

  const shown = draft ?? stored;
  const vertices = curveVertices(shown, clip);
  const w = Math.max(width, 1);
  const px = (time: number) => (clip.duration > 0 ? (time / clip.duration) * w : 0);
  const py = (value: number) => dbToFraction(volumeToDb(value)) * height;
  const line = vertices.map((v) => `${px(v.time)},${py(v.value)}`).join(" ");
  const color = music ? "var(--c-music-waveform)" : "var(--c-audio-waveform)";

  const rectOf = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const timeAt = (clientX: number, rect: DOMRect) =>
    Math.max(0, Math.min(clip.duration, ((clientX - rect.left) / rect.width) * clip.duration));

  const finish = useCallback(
    (next: AutomationPoint[] | null) => {
      const { clip: current } = latest.current;
      Promise.resolve(onCommit(current.id, next && next.length ? next : null)).finally(() => setDraft(null));
    },
    [onCommit, setDraft],
  );

  const begin = (g: Gesture, event: React.PointerEvent) => {
    gesture.current = g;
    const rect = rectOf();
    const onMove = (e: PointerEvent) => {
      const active = gesture.current;
      const box = rectOf() ?? rect;
      if (!active || !box) return;
      const dx = e.clientX - active.x;
      const dy = e.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      active.moved = true;
      if (active.kind === "point") {
        const origin = active.start[active.index];
        const db = fractionToDb(dbToFraction(volumeToDb(origin.value)) + dy / box.height);
        const next = moveAutomationPoint(
          active.start,
          active.index,
          e.shiftKey ? 0 : (dx / box.width) * clip.duration,
          dbToVolume(db) - origin.value,
          { maxTime: clip.duration, snapUnityDb: e.shiftKey ? SNAP_UNITY_DB : undefined },
        );
        setDraft(next);
        const moved = next[active.index];
        setTip({ x: px(moved.time), y: py(moved.value), text: `${formatGainDb(volumeToDb(moved.value))}  ${moved.time.toFixed(2)}s` });
      } else {
        const delta = fractionToDb(dbToFraction(active.db) + dy / box.height) - active.db;
        const a = active.start[active.segment];
        const b = active.start[active.segment + 1];
        setDraft(scaleAutomationRange(active.start, a.time, b.time, delta));
        setTip({ x: px((a.time + b.time) / 2), y: py(dbToVolume(active.db + delta)), text: `${delta >= 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)} dB` });
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      cleanup.current = null;
      gesture.current = null;
      setTip(null);
    };
    const onUp = (e: PointerEvent) => {
      const active = gesture.current;
      if (!active) return stop();
      onMove(e);
      const box = rectOf() ?? rect;
      stop();
      if (active.kind === "point") {
        if (!active.moved && !active.inserted) return setDraft(null);
        finish(draftRef.current ?? active.start);
        return;
      }
      if (active.moved) {
        finish(draftRef.current ?? active.start);
        return;
      }
      // A plain click on the line adds a point where it was pressed.
      if (!box) return;
      const t = timeAt(e.clientX, box);
      finish(insertAutomationPoint(latest.current.stored, t, valueOnCurve(active.start, t)));
    };
    const onCancel = () => {
      stop();
      setDraft(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    cleanup.current = stop;
    event.stopPropagation();
  };

  const swallow = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  /** A press on a locked track goes through the same action so the user sees the engine's own refusal. */
  const refuse = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    finish(latest.current.stored);
  };

  const pressPoint = (event: React.PointerEvent, index: number) => {
    if (event.button !== 0) return;
    if (locked) return refuse(event);
    event.preventDefault();
    if (event.altKey) {
      event.stopPropagation();
      finish(deleteAutomationPoint(stored, index));
      return;
    }
    begin({ kind: "point", index, start: stored.map((p) => ({ ...p })), x: event.clientX, y: event.clientY, inserted: false, moved: false }, event);
  };

  const pressLine = (event: React.PointerEvent, segment: number) => {
    if (event.button !== 0) return;
    if (locked) return refuse(event);
    event.preventDefault();
    const box = rectOf();
    if (!box) return;
    const t = timeAt(event.clientX, box);
    if (event.metaKey || event.ctrlKey) {
      // Pen click: add a point and keep dragging it in the same gesture.
      const next = insertAutomationPoint(stored, t, valueOnCurve(vertices, t));
      const index = next.findIndex((p) => p.time === t);
      setDraft(next);
      begin({ kind: "point", index, start: next, x: event.clientX, y: event.clientY, inserted: true, moved: false }, event);
      return;
    }
    // Drag the segment between two vertices. The implicit ends become real points if the drag commits.
    const full = curveVertices(stored, clip);
    begin(
      { kind: "segment", segment, start: full, x: event.clientX, y: event.clientY, db: volumeToDb(valueOnCurve(full, t)), moved: false },
      event,
    );
  };

  // Delete removes the point under the pointer. It must win over the global
  // "delete selected clip" shortcut, so it listens in the capture phase.
  useEffect(() => {
    if (hoverIndex === null || locked) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const index = hoverIndex;
      setHoverIndex(null);
      setTip(null);
      finish(deleteAutomationPoint(latest.current.stored, index));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hoverIndex, locked, finish]);

  const hoverLine = (event: React.PointerEvent) => {
    if (gesture.current) return;
    const box = rectOf();
    if (!box) return;
    const t = timeAt(event.clientX, box);
    const value = valueOnCurve(vertices, t);
    setTip({ x: px(t), y: py(value), text: `${formatGainDb(volumeToDb(value))}  ${t.toFixed(2)}s` });
  };

  const hoverPoint = (index: number) => {
    const p = shown[index];
    if (!p || gesture.current) return;
    setHoverIndex(index);
    setTip({ x: px(p.time), y: py(p.value), text: `${formatGainDb(volumeToDb(p.value))}  ${p.time.toFixed(2)}s` });
  };

  if (width <= 24 || clip.duration <= 0) return null;
  const real = draft ?? stored;
  const tipLeft = tip ? Math.max(2, Math.min(w - 96, tip.x - 40)) : 0;
  const tipTop = tip ? (tip.y < 18 ? tip.y + 8 : tip.y - 18) : 0;

  return (
    <div
      data-clip-gain-line
      data-locked={locked ? "true" : undefined}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: locked ? 0.5 : 1 }}
    >
      <svg
        ref={svgRef}
        aria-label="Clip gain"
        className="absolute left-0 top-0"
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        {GRID_DB.filter((db) => db <= GAIN_DB_MAX && db >= GAIN_DB_MIN).map((db) => (
          <line
            key={db}
            data-gain-grid={db}
            x1={0}
            x2={w}
            y1={dbToFraction(db) * height}
            y2={dbToFraction(db) * height}
            stroke="currentColor"
            strokeOpacity={db === 0 ? 0.28 : 0.1}
            strokeDasharray={db === 0 ? "none" : "2 3"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          data-gain-curve
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,.6))" }}
        />
        {vertices.slice(0, -1).map((a, segment) => {
          const b = vertices[segment + 1];
          return (
            <line
              key={`hit-${segment}`}
              data-gain-segment={segment}
              x1={px(a.time)}
              y1={py(a.value)}
              x2={px(b.time)}
              y2={py(b.value)}
              stroke="transparent"
              strokeWidth={10}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "stroke", cursor: locked ? "not-allowed" : "ns-resize" }}
              onPointerDown={(event) => pressLine(event, segment)}
              onPointerMove={hoverLine}
              onPointerLeave={() => !gesture.current && setTip(null)}
              onMouseDown={swallow}
              onClick={swallow}
              onDoubleClick={swallow}
            />
          );
        })}
        {real.map((p, index) => {
          const cx = Math.max(5, Math.min(w - 5, px(p.time)));
          return (
            <g key={`${index}-${p.time}`}>
              <circle
                data-gain-point={index}
                data-gain-time={p.time.toFixed(3)}
                data-gain-value={p.value.toFixed(4)}
                cx={cx}
                cy={py(p.value)}
                r={3.4}
                fill="var(--c-bg, #111)"
                stroke={color}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={cx}
                cy={py(p.value)}
                data-gain-hit={index}
                r={8}
                fill="transparent"
                style={{ pointerEvents: "all", cursor: locked ? "not-allowed" : "grab" }}
                onPointerDown={(event) => pressPoint(event, index)}
                onPointerEnter={() => hoverPoint(index)}
                onPointerLeave={() => {
                  setHoverIndex(null);
                  if (!gesture.current) setTip(null);
                }}
                onMouseDown={swallow}
                onClick={swallow}
                onDoubleClick={swallow}
              />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          data-gain-tip
          className="absolute rounded-sm px-1 text-[10px] leading-4 font-medium tabular-nums bg-black/80 text-white whitespace-nowrap"
          style={{ left: tipLeft, top: tipTop }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

export const ClipGainLine = memo(ClipGainLineImpl);
