import React from "react";
import { useTimelineToolPreview } from "./timeline-tool-preview";
import { useT } from "@openreel/i18n/react";
export const TimelineToolGhost = React.memo(function TimelineToolGhost({
  trackId,
  pixelsPerSecond,
}: {
  trackId: string;
  pixelsPerSecond: number;
}) {
  const t = useT();
  // Only tracks the ghost touches re-render while a gesture streams previews.
  const state = useTimelineToolPreview((value) => {
    const ghost = value.ghost;
    if (!ghost) return null;
    if (ghost.trackId === trackId) return ghost;
    const touches = (ghost.neighbors ?? (ghost.neighbor ? [ghost.neighbor] : [])).some(
      (neighbor) => neighbor.trackId === trackId,
    );
    return touches ? ghost : null;
  });
  if (!state) return null;
  const ghost = state.trackId === trackId ? state : null;
  const neighbors = (
    state.neighbors ?? (state.neighbor ? [state.neighbor] : [])
  ).filter((neighbor) => neighbor.trackId === trackId);
  if (!ghost && !neighbors.length) return null;
  return (
    <>
      {ghost && (
        <div
          aria-hidden
          className="workspace-timeline-tool-ghost"
          style={{
            left: ghost.startTime * pixelsPerSecond,
            width: Math.max(1, ghost.duration * pixelsPerSecond),
          }}
        >
          <span>{t(ghost.label)}</span>
        </div>
      )}
      {neighbors.map((neighbor, index) => (
        <div
          key={index}
          aria-hidden
          className="workspace-timeline-tool-ghost"
          data-neighbor-ghost=""
          style={{
            left: neighbor.startTime * pixelsPerSecond,
            width: Math.max(1, neighbor.duration * pixelsPerSecond),
          }}
        >
          {t(neighbor.label ?? "") && <span>{t(neighbor.label ?? "")}</span>}
        </div>
      ))}
    </>
  );
});
