import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from "react";
import { formatTimecode } from "./utils";
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
}

export const TimeRuler: React.FC<TimeRulerProps> = ({
  pixelsPerSecond,
  scrollX,
  viewportWidth,
  onSeek,
  onScrubStart,
  onScrubEnd,
}) => {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
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

  const scrollXRef = useRef(scrollX);
  scrollXRef.current = scrollX;

  const getTimeFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const grandparent = rulerRef.current?.parentElement?.parentElement;
      if (!grandparent) return 0;
      const rect = grandparent.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollXRef.current;
      return Math.max(0, x / safePixelsPerSecond);
    },
    [safePixelsPerSecond],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      onScrubStart?.();
      const time = getTimeFromEvent(e);
      onSeek(time);
    },
    [getTimeFromEvent, onSeek, onScrubStart],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const time = getTimeFromEvent(e);
      onSeek(time);
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setIsDragging(false);
      onScrubEnd?.();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, getTimeFromEvent, onSeek, onScrubEnd]);

  return (
    <div
      ref={rulerRef}
      className={`h-8 border-b border-border flex items-end relative bg-background-secondary select-none ${
        isDragging ? "cursor-grabbing" : "cursor-pointer"
      }`}
      onMouseDown={handleMouseDown}
      style={{ cursor: isDragging ? "grabbing" : "pointer" }}
    >
      {ticks.map((tick) => (
        <div
          key={`tick-${tick.time}`}
          className={`absolute border-l pointer-events-none ${
            tick.isMajor
              ? "border-border h-4"
              : "border-border/50 h-2"
          }`}
          style={{ left: `${tick.time * safePixelsPerSecond}px` }}
        >
          {tick.showLabel && tick.time >= 0 && (
            <span className="text-[9px] font-mono text-text-muted pl-1 whitespace-nowrap">
              {formatTimecode(Math.max(0, tick.time)).slice(3)}
            </span>
          )}
        </div>
      ))}

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
