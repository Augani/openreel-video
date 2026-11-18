import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from "react";
import { useTimelineTouchGesture, listenTimelineGesture } from "./touch-gestures";
import { formatTimecode } from "./utils";
import { TimelineRange } from "./TimelineRange";
import { MarkerIndicator } from "./MarkerIndicator";
import type { Marker } from "@openreel/core";
import {
  getBeatSyncBridge,
  type BeatSyncState,
} from "../../../bridges/beat-sync-bridge";

interface TimeRulerProps {
  duration: number;
  pixelsPerSecond: number;
  scrollX: number;
  viewportWidth: number;
  onSeek: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  snapPoints?: number[];
  rangeDuration?: number;
  frameRate?: number;
  phone?: boolean;
  markers?: readonly Marker[];
  selectedMarkerId?: string | null;
  /** Alt-drag on the ruler: a range from `start` to `end` seconds (a click without dragging gives start === end). */
  onCreateRangeMarker?: (start: number, end: number) => void;
  onMarkerSelect?: (markerId: string) => void;
  onMarkerEdit?: (markerId: string) => void;
  onMarkerRemove?: (markerId: string) => void;
  onMarkerUpdate?: (markerId: string, updates: Partial<Marker>) => void;
}

export const TimeRuler: React.FC<TimeRulerProps> = ({
  pixelsPerSecond,
  scrollX,
  viewportWidth,
  onSeek,
  onScrubStart,
  onScrubEnd,
  snapPoints,
  rangeDuration = 0,
  frameRate = 30,
  phone = false,
  markers,
  selectedMarkerId,
  onCreateRangeMarker,
  onMarkerSelect,
  onMarkerEdit,
  onMarkerRemove,
  onMarkerUpdate,
}) => {
  const touchGesture = useTimelineTouchGesture();
  const rulerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<{ start: number; end: number } | null>(null);
  const [beatState, setBeatState] = useState<BeatSyncState>(() =>
    getBeatSyncBridge().getState(),
  );

  useEffect(() => {
    const bridge = getBeatSyncBridge();
    const unsubscribe = bridge.subscribe(setBeatState);
    return unsubscribe;
  }, []);

  const safePixelsPerSecond = pixelsPerSecond > 0 ? pixelsPerSecond : 100;
  const visibleStart = scrollX / safePixelsPerSecond;
  const visibleEnd = (scrollX + viewportWidth) / safePixelsPerSecond;

  const visibleBeatMarkers = useMemo(() => {
    if (beatState.beatMarkers.length === 0) return [];
    const buffer = 1;
    return beatState.beatMarkers.filter(
      (marker) =>
        marker.time >= visibleStart - buffer &&
        marker.time <= visibleEnd + buffer,
    );
  }, [beatState.beatMarkers, visibleStart, visibleEnd]);

  const getTickConfig = () => {
    if (phone && safePixelsPerSecond <= 40 && safePixelsPerSecond > 15) return { minor: 2, major: 2, labelEvery: 2 };
    if (safePixelsPerSecond > 500) {
      return { minor: 0.01, major: 0.1, labelEvery: 0.5 };
    }
    if (safePixelsPerSecond > 200) {
      return { minor: 0.05, major: 0.5, labelEvery: 1 };
    }
    if (safePixelsPerSecond > 100) {
      return { minor: 0.1, major: 1, labelEvery: 1 };
    }
    if (safePixelsPerSecond > 50) {
      return { minor: 0.5, major: 1, labelEvery: 5 };
    }
    if (safePixelsPerSecond > 20) {
      return { minor: 1, major: 5, labelEvery: 5 };
    }
    return { minor: 5, major: 10, labelEvery: 10 };
  };

  const tickConfig = getTickConfig();
  const rawStartTick = Math.floor(visibleStart / tickConfig.minor) * tickConfig.minor;
  const startTick = Math.max(0, rawStartTick);

  interface TickMark {
    time: number;
    isMajor: boolean;
    showLabel: boolean;
  }

  const ticks: TickMark[] = [];
  for (let t = startTick; t <= visibleEnd + tickConfig.minor; t += tickConfig.minor) {
    if (t < 0) continue;
    const roundedTime = Math.round(t * 10000) / 10000;
    if (!isFinite(roundedTime) || isNaN(roundedTime)) continue;
    const isMajor = roundedTime === 0 || Math.abs(roundedTime % tickConfig.major) < 0.0001;
    const showLabel = roundedTime === 0 || Math.abs(roundedTime % tickConfig.labelEvery) < 0.0001;
    ticks.push({ time: roundedTime, isMajor, showLabel });
  }

  const getTimeFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const ruler = rulerRef.current;
      if (!ruler) return 0;
      const x = e.clientX - ruler.getBoundingClientRect().left;
      return Math.max(0, x / safePixelsPerSecond);
    },
    [safePixelsPerSecond],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (touchGesture.shouldIgnoreMouse(e) || e.button !== 0) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey && onCreateRangeMarker) {
        const start = getTimeFromEvent(e);
        const frame = 1 / Math.max(1, frameRate);
        const snap = (t: number) => Math.max(0, Math.round(t / frame) * frame);
        let end = start;
        setRangeDraft({ start: snap(start), end: snap(end) });
        const onMove = (move: MouseEvent) => {
          end = getTimeFromEvent(move);
          setRangeDraft({ start: snap(start), end: snap(end) });
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          setRangeDraft(null);
          const a = snap(Math.min(start, end));
          const b = snap(Math.max(start, end));
          const tooSmall = (b - a) * safePixelsPerSecond < 3;
          onCreateRangeMarker(a, tooSmall ? a : b);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return;
      }
      setIsDragging(true);
      onScrubStart?.();
      const time = getTimeFromEvent(e);
      onSeek(time);
    },
    [getTimeFromEvent, onSeek, onScrubStart, touchGesture, onCreateRangeMarker, frameRate, safePixelsPerSecond],
  );

  const snapPointsRef = useRef(snapPoints);
  snapPointsRef.current = snapPoints;

  useEffect(() => {
    if (!isDragging) return;
    let rafId: number | null = null;
    let latestTime: number | null = null;
    let prevTime: number | null = null;
    let prevTimestamp = 0;
    let velocity = 0;

    const SNAP_THRESHOLD_PX = 8;
    const SLOW_VELOCITY_THRESHOLD = 150;

    const applySnap = (rawTime: number): number => {
      const points = snapPointsRef.current;
      if (!points || points.length === 0) return rawTime;

      if (velocity > SLOW_VELOCITY_THRESHOLD) return rawTime;

      const thresholdSec = SNAP_THRESHOLD_PX / safePixelsPerSecond;
      let bestDist = Infinity;
      let snapped = rawTime;

      for (const point of points) {
        const dist = Math.abs(rawTime - point);
        if (dist < thresholdSec && dist < bestDist) {
          bestDist = dist;
          snapped = point;
        }
      }

      return snapped;
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const rawTime = getTimeFromEvent(e);
      const now = performance.now();

      if (prevTime !== null && now - prevTimestamp > 0) {
        const dt = (now - prevTimestamp) / 1000;
        const pixelDelta = Math.abs(rawTime - prevTime) * safePixelsPerSecond;
        velocity = pixelDelta / dt;
      }
      prevTime = rawTime;
      prevTimestamp = now;

      latestTime = applySnap(rawTime);

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (latestTime !== null) {
            onSeek(latestTime);
          }
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (latestTime !== null) onSeek(latestTime);
      setIsDragging(false);
      onScrubEnd?.();
    };

    const stopListening = listenTimelineGesture(touchGesture.pointerId, handleMouseMove, handleMouseUp);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      stopListening();
    };
  }, [isDragging, getTimeFromEvent, onSeek, onScrubEnd, safePixelsPerSecond, touchGesture]);

  return (
    <div
      ref={rulerRef}
      data-timeline-ruler
      onPointerDown={(event) => touchGesture.start(event, handleMouseDown)}
      className={`workspace-time-ruler h-[26px] border-b border-border relative bg-bg-1 select-none ${
        isDragging ? "cursor-grabbing" : "cursor-pointer"
      }`}
      onMouseDown={handleMouseDown}
      style={{ cursor: isDragging ? "grabbing" : "pointer", touchAction: "none" }}
    >
      <TimelineRange duration={rangeDuration} frameRate={frameRate} pixelsPerSecond={safePixelsPerSecond} />
      {ticks.map((tick) =>
        tick.showLabel && tick.time >= 0 ? (
          <span
            key={`tick-${tick.time}`}
            className="absolute top-[4px] text-[10px] font-medium text-fg-muted whitespace-nowrap pointer-events-none"
            style={{ left: `${tick.time * safePixelsPerSecond + (phone ? -12 : 6)}px` }}
          >
            {phone ? `${Math.floor(tick.time / 60)}:${String(Math.floor(tick.time % 60)).padStart(2, "0")}` : formatTimecode(Math.max(0, tick.time), frameRate)}
          </span>
        ) : null,
      )}

      {markers?.map((marker) => (
        <MarkerIndicator
          key={marker.id}
          variant="ruler"
          marker={marker}
          pixelsPerSecond={safePixelsPerSecond}
          scrollX={0}
          frameRate={frameRate}
          selected={selectedMarkerId === marker.id}
          onSeek={onSeek}
          onSelect={onMarkerSelect}
          onEdit={onMarkerEdit}
          onRemove={onMarkerRemove}
          onUpdate={onMarkerUpdate}
        />
      ))}

      {rangeDraft && (
        <div
          aria-hidden="true"
          data-testid="marker-range-draft"
          className="pointer-events-none absolute bottom-0 z-10 h-[10px] rounded-[2px] bg-accent/70"
          style={{
            left: `${Math.min(rangeDraft.start, rangeDraft.end) * safePixelsPerSecond}px`,
            width: `${Math.abs(rangeDraft.end - rangeDraft.start) * safePixelsPerSecond}px`,
          }}
        />
      )}

      {visibleBeatMarkers.map((marker) => (
        <div
          key={`beat-ruler-${marker.index}`}
          className={`absolute bottom-0 pointer-events-none ${
            marker.isDownbeat
              ? "w-[2px] h-5 bg-orange-500"
              : "w-px h-3 bg-orange-400/50"
          }`}
          style={{ left: `${marker.time * safePixelsPerSecond}px` }}
        />
      ))}

      {beatState.beatAnalysis && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-orange-500/20 px-2 py-0.5 rounded text-[9px] text-orange-400 font-medium pointer-events-none">
          <span className="opacity-70">♪</span>
          <span>{beatState.beatAnalysis.bpm} BPM</span>
        </div>
      )}
    </div>
  );
};
