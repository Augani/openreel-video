import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  TRACK_LANE_RANGE,
  deleteLanePoint,
  insertLanePoint,
  moveLanePoint,
  type AutomationPoint,
  type Track,
  type TrackAutomationLane,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import {
  AUTOMATION_LANE_HEIGHT,
  formatLaneValue,
  laneFractionToValue,
  laneValueToFraction,
} from "./track-automation-geometry";

const LANES: readonly TrackAutomationLane[] = ["volume", "pan"];
const LANE_LABEL: Record<TrackAutomationLane, string> = { volume: "Volume", pan: "Pan" };
/** Pixels of pointer travel before a press on a point becomes a drag. */
const DRAG_SLOP = 3;

type Commit = (trackId: string, lane: TrackAutomationLane, points: AutomationPoint[] | null) => unknown;

const defaultCommit: Commit = (trackId, lane, points) =>
  useProjectStore.getState().setTrackAutomation(trackId, lane, points);

/** Labels in the header column, one per lane. */
export const TrackAutomationHeaderRows = memo(function TrackAutomationHeaderRows({ track }: { track: Track }) {
  return (
    <div data-automation-header={track.id}>
      {LANES.map((lane) => (
        <div
          key={lane}
          data-automation-header-lane={lane}
          className="flex items-center justify-between gap-2 border-b border-border bg-bg-1 px-4 text-[10px] font-medium uppercase tracking-wide text-fg-muted"
          style={{ height: AUTOMATION_LANE_HEIGHT }}
        >
          <span>{LANE_LABEL[lane]}</span>
          <span className="truncate normal-case tracking-normal">{track.name}</span>
        </div>
      ))}
    </div>
  );
});

interface LaneProps {
  track: Track;
  lane: TrackAutomationLane;
  pixelsPerSecond: number;
  width: number;
  locked: boolean;
  onCommit: Commit;
}

type Drag = { index: number; x: number; y: number; moved: boolean; inserted: boolean };

function AutomationLaneImpl({ track, lane, pixelsPerSecond, width, locked, onCommit }: LaneProps) {
  const stored = track.automation?.[lane];
  const [draft, setDraftState] = useState<AutomationPoint[] | null>(null);
  const draftRef = useRef<AutomationPoint[] | null>(null);
  const setDraft = useCallback((next: AutomationPoint[] | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef({ stored, track });
  latest.current = { stored, track };

  useEffect(() => () => cleanup.current?.(), []);

  const points = draft ?? stored ?? [];
  const height = AUTOMATION_LANE_HEIGHT;
  const px = (time: number) => time * pixelsPerSecond;
  const py = (value: number) => laneValueToFraction(lane, value) * height;
  const rest = TRACK_LANE_RANGE[lane].rest;
  const baseY = py(rest);

  const toTimeValue = (clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return null;
    return {
      time: Math.max(0, (clientX - rect.left) / pixelsPerSecond),
      value: laneFractionToValue(lane, (clientY - rect.top) / rect.height),
    };
  };

  const finish = useCallback(
    (next: AutomationPoint[]) => {
      Promise.resolve(onCommit(latest.current.track.id, lane, next.length ? next : null)).finally(() => setDraft(null));
    },
    [onCommit, lane, setDraft],
  );

  const begin = (g: Drag, startPoints: AutomationPoint[]) => {
    drag.current = g;
    const onMove = (e: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      if (!active.moved && Math.hypot(e.clientX - active.x, e.clientY - active.y) < DRAG_SLOP) return;
      active.moved = true;
      const target = toTimeValue(e.clientX, e.clientY);
      if (target) setDraft(moveLanePoint(lane, startPoints, active.index, target.time, target.value));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      cleanup.current = null;
      drag.current = null;
    };
    const onUp = () => {
      const active = drag.current;
      const next = draftRef.current;
      stop();
      if (active && (active.moved || active.inserted) && next) finish(next);
      else setDraft(null);
    };
    const onCancel = () => {
      stop();
      setDraft(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    cleanup.current = stop;
  };

  const pressSurface = (event: React.PointerEvent) => {
    if (locked || event.button !== 0 || drag.current) return;
    const target = toTimeValue(event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const next = insertLanePoint(lane, stored, target.time, target.value);
    const index = next.findIndex((p) => Math.abs(p.time - Math.max(0, target.time)) < 1e-9);
    setDraft(next);
    begin({ index, x: event.clientX, y: event.clientY, moved: false, inserted: true }, next);
  };

  const pressPoint = (event: React.PointerEvent, index: number) => {
    if (locked || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) {
      finish(deleteLanePoint(lane, stored, index));
      return;
    }
    const startPoints = stored ?? [];
    begin({ index, x: event.clientX, y: event.clientY, moved: false, inserted: false }, startPoints);
  };

  const removePoint = (event: React.SyntheticEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    finish(deleteLanePoint(lane, stored, index));
  };

  const line = points.length
    ? [`0,${py(points[0].value)}`, ...points.map((p) => `${px(p.time)},${py(p.value)}`), `${width},${py(points[points.length - 1].value)}`].join(" ")
    : `0,${baseY} ${width},${baseY}`;

  return (
    <div
      ref={surfaceRef}
      data-automation-lane={lane}
      data-automation-track={track.id}
      role="group"
      aria-label={`${track.name} ${LANE_LABEL[lane]} automation`}
      className="relative border-b border-border/50 bg-background-secondary/10 text-fg-muted"
      style={{ height, width, cursor: locked ? "not-allowed" : "crosshair", touchAction: "none" }}
      onPointerDown={pressSurface}
      onDragOver={(e) => e.stopPropagation()}
    >
      <svg width={width} height={height} className="absolute inset-0" style={{ overflow: "visible", pointerEvents: "none" }}>
        <line x1={0} x2={width} y1={baseY} y2={baseY} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <polyline
          data-automation-curve
          points={line}
          fill="none"
          stroke={lane === "volume" ? "var(--c-audio-waveform, #4ade80)" : "var(--accent, #60a5fa)"}
          strokeWidth={1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, index) => (
          <g key={`${index}-${p.time}`}>
            <circle
              data-automation-point={index}
              data-automation-time={p.time.toFixed(3)}
              data-automation-value={p.value.toFixed(4)}
              cx={px(p.time)}
              cy={py(p.value)}
              r={3.4}
              fill="var(--c-bg, #111)"
              stroke={lane === "volume" ? "var(--c-audio-waveform, #4ade80)" : "var(--accent, #60a5fa)"}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${p.time.toFixed(2)} s, ${formatLaneValue(lane, p.value)}. Drag to move, double-click or Alt-click to delete`}</title>
            </circle>
            <circle
              data-automation-hit={index}
              cx={px(p.time)}
              cy={py(p.value)}
              r={8}
              fill="transparent"
              style={{ pointerEvents: "all", cursor: locked ? "not-allowed" : "grab" }}
              onPointerDown={(event) => pressPoint(event, index)}
              onDoubleClick={(event) => removePoint(event, index)}
              onContextMenu={(event) => removePoint(event, index)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

const AutomationLane = memo(AutomationLaneImpl);

interface TrackAutomationRowsProps {
  track: Track;
  pixelsPerSecond: number;
  /** Drawn width in px (the timeline's width). */
  width: number;
  onCommit?: Commit;
}

/** The expanded volume and pan lanes under one track, in the lane column. */
export const TrackAutomationRows = memo(function TrackAutomationRows({
  track,
  pixelsPerSecond,
  width,
  onCommit = defaultCommit,
}: TrackAutomationRowsProps) {
  return (
    <div data-automation-rows={track.id}>
      {LANES.map((lane) => (
        <AutomationLane
          key={lane}
          track={track}
          lane={lane}
          pixelsPerSecond={pixelsPerSecond}
          width={width}
          locked={track.locked}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
});
