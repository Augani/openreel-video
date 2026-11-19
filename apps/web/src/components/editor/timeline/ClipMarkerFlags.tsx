import { memo, useMemo } from "react";
import { resolveClipMarkers, type Clip, type MediaItem } from "@openreel/core";

interface ClipMarkerFlagsProps {
  clip: Clip;
  media: Pick<MediaItem, "markers"> | undefined;
  pixelsPerSecond: number;
}

/**
 * Clip and master-clip markers drawn along the bottom edge of a timeline clip, at the timeline
 * offset that honours the clip's in point, speed and reverse. Range markers show as a bar. Master
 * markers (from the Source monitor) are drawn solid, clip markers with a lighter outline.
 */
function ClipMarkerFlagsImpl({ clip, media, pixelsPerSecond }: ClipMarkerFlagsProps) {
  const resolved = useMemo(() => resolveClipMarkers(clip, media), [clip, media]);
  if (resolved.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[10px]" data-testid="clip-marker-flags" aria-hidden="true">
      {resolved.map((r) => {
        const x = (r.timelineTime - clip.startTime) * pixelsPerSecond;
        const w = r.timelineDuration * pixelsPerSecond;
        return (
          <div
            key={`${r.scope}-${r.marker.id}`}
            data-testid="clip-marker-flag"
            data-scope={r.scope}
            data-marker-id={r.marker.id}
            title={`${r.scope === "master" ? "Master clip marker" : "Clip marker"}: ${r.marker.label}`}
            className="absolute bottom-0"
            style={{ left: x, width: w > 4 ? w : undefined }}
          >
            {w > 4 && <div className="absolute bottom-0 h-[3px] w-full opacity-80" style={{ backgroundColor: r.marker.color }} />}
            <svg
              width="9"
              height="10"
              viewBox="0 0 9 10"
              className="absolute bottom-0 left-0 -translate-x-[4px] drop-shadow-[0_0_1px_rgba(0,0,0,0.9)]"
            >
              <path
                d="M0.5 0.5h8v6l-4 3-4-3z"
                fill={r.marker.color}
                stroke={r.scope === "clip" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.55)"}
                strokeWidth="1"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export const ClipMarkerFlags = memo(ClipMarkerFlagsImpl);
