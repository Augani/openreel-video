import React, { useEffect, useState, useMemo } from "react";
import {
  getBeatSyncBridge,
  type BeatSyncState,
} from "../../../bridges/beat-sync-bridge";

interface BeatMarkerOverlayProps {
  pixelsPerSecond: number;
  scrollX: number;
  viewportWidth: number;
  totalHeight: number;
  originX?: number;
}

export const BeatMarkerOverlay: React.FC<BeatMarkerOverlayProps> = ({
  pixelsPerSecond,
  scrollX,
  viewportWidth,
  totalHeight,
  originX = 0,
}) => {
  const [beatState, setBeatState] = useState<BeatSyncState>(() =>
    getBeatSyncBridge().getState(),
  );

  useEffect(() => {
    const bridge = getBeatSyncBridge();
    const unsubscribe = bridge.subscribe(setBeatState);
    return unsubscribe;
  }, []);

  const visibleMarkers = useMemo(() => {
    if (beatState.beatMarkers.length === 0) return [];

    const startTime = scrollX / pixelsPerSecond;
    const endTime = (scrollX + viewportWidth) / pixelsPerSecond;
    const buffer = 1;

    return beatState.beatMarkers.filter(
      (marker) =>
        marker.time >= startTime - buffer && marker.time <= endTime + buffer,
    );
  }, [beatState.beatMarkers, scrollX, viewportWidth, pixelsPerSecond]);

  if (visibleMarkers.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-5">
      {visibleMarkers.map((marker) => {
        const xPos = marker.time * pixelsPerSecond + originX;
        const isDownbeat = marker.isDownbeat;

        return (
          <div
            key={`beat-${marker.index}`}
            className="absolute top-0"
            style={{
              left: `${xPos}px`,
              height: `${totalHeight}px`,
            }}
          >
            <div
              className={`h-full transition-opacity ${
                isDownbeat
                  ? "w-[2px] bg-orange-500/60"
                  : "w-px bg-orange-400/30"
              }`}
            />
            {isDownbeat && (
              <div
                className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-orange-500"
                title={`Beat ${marker.index + 1}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
