import React from "react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Clapperboard, Trash2, X } from "lucide-react";
import { Button } from "@openreel/ui";
import {
  buildRenderStatusSegments,
  type RenderStatusLevel,
  type RenderStatusSegment,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { renderCacheService, useIdleRenderState, useRenderCacheSnapshot } from "../../../services/render-cache-service";

const LEVEL_COLOR: Record<Exclude<RenderStatusLevel, "none">, string> = {
  cached: "#3fb950",
  light: "#d9a520",
  heavy: "#e5484d",
};

const LEVEL_LABEL: Record<Exclude<RenderStatusLevel, "none">, string> = {
  cached: "Rendered: plays from the render cache",
  light: "Needs render: should play in real time",
  heavy: "Needs render: effects-heavy, unlikely to play in real time",
};

export const RENDER_STATUS_BAR_HEIGHT = 5;

/**
 * Premiere-style render bar: green where a render exists, yellow where a
 * render is needed but real-time playback is likely, red where the effects are
 * too heavy for real time. Plain media shows nothing.
 */
export function useRenderStatusSegments(): RenderStatusSegment[] {
  const project = useProjectStore((state) => state.project);
  const snapshot = useRenderCacheSnapshot();
  const [segments, setSegments] = useState<RenderStatusSegment[]>([]);
  const cachedRuns = snapshot.cachedRuns;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSegments(
        buildRenderStatusSegments(project, {
          cachedRuns,
          measuredMs: (range) => renderCacheService.stats.mean(range),
        }),
      );
    }, 80);
    return () => window.clearTimeout(handle);
  }, [project, cachedRuns]);

  return segments;
}

export const RenderStatusBar = React.memo(function RenderStatusBar({
  pixelsPerSecond,
  width,
}: {
  pixelsPerSecond: number;
  width: number;
}) {
  const segments = useRenderStatusSegments();
  const snapshot = useRenderCacheSnapshot();
  const idle = useIdleRenderState();
  const visible = useMemo(() => segments.filter((segment) => segment.level !== "none"), [segments]);
  return (
    <div
      data-testid="render-status-bar"
      data-rendering={snapshot.phase === "rendering" || undefined}
      data-idle-render={idle.kind === "rendering" ? "rendering" : idle.kind === "paused" ? idle.reason : undefined}
      aria-label="Render status"
      role="img"
      style={{ position: "relative", height: RENDER_STATUS_BAR_HEIGHT, width }}
      className="bg-bg-1 pointer-events-none"
    >
      {visible.map((segment) => {
        const level = segment.level as Exclude<RenderStatusLevel, "none">;
        const style: CSSProperties = {
          position: "absolute",
          top: 1,
          height: RENDER_STATUS_BAR_HEIGHT - 2,
          left: segment.start * pixelsPerSecond,
          width: Math.max(1, (segment.end - segment.start) * pixelsPerSecond),
          background: LEVEL_COLOR[level],
        };
        return (
          <div
            key={`${segment.start}-${segment.end}-${level}`}
            data-testid="render-status-segment"
            data-level={level}
            data-start={segment.start.toFixed(3)}
            data-end={segment.end.toFixed(3)}
            title={`${LEVEL_LABEL[level]}${segment.reasons.length ? ` (${segment.reasons.join(", ")})` : ""}`}
            style={style}
          />
        );
      })}
      {snapshot.phase === "rendering" && snapshot.progress && snapshot.progress.total > 0 ? (
        <div
          data-testid="render-status-progress"
          data-idle={idle.kind === "rendering" || undefined}
          title={idle.kind === "rendering" ? "Rendering in the background" : "Rendering"}
          style={{
            position: "absolute",
            top: 0,
            height: RENDER_STATUS_BAR_HEIGHT,
            left: snapshot.progress.range.start * pixelsPerSecond,
            width: Math.max(
              2,
              (snapshot.progress.range.end - snapshot.progress.range.start) *
                pixelsPerSecond *
                Math.min(1, snapshot.progress.done / snapshot.progress.total),
            ),
            background: "#58a6ff",
            opacity: idle.kind === "rendering" ? 0.7 : 0.9,
          }}
        />
      ) : null}
    </div>
  );
});

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Toolbar cluster: Render In to Out, cancellable progress, Delete render files. */
export const RenderCacheControls = React.memo(function RenderCacheControls() {
  const snapshot = useRenderCacheSnapshot();
  const hasRange = useTimelineStore((state) => state.loopEnd > state.loopStart);
  const rendering = snapshot.phase === "rendering";
  const progress = snapshot.progress;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex items-center gap-1" data-testid="render-cache-controls">
      {rendering ? (
        <>
          <div
            role="progressbar"
            aria-label="Render progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-24 rounded bg-bg-3 overflow-hidden"
          >
            <div style={{ width: `${percent}%`, background: LEVEL_COLOR.cached }} className="h-full" />
          </div>
          <span className="text-[11px] tabular-nums text-text-secondary" data-testid="render-progress-text">
            {percent}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel render"
            title="Cancel render"
            onClick={() => renderCacheService.cancelRender()}
          >
            <X size={14} aria-hidden />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Render In to Out"
          title={hasRange ? "Render In to Out (Enter)" : "Render the whole sequence (Enter)"}
          onClick={() => void renderCacheService.renderInToOut()}
        >
          <Clapperboard size={14} aria-hidden />
          Render
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Delete render files"
        title={
          snapshot.frameCount > 0
            ? `Delete render files (${formatBytes(snapshot.bytes)} cached)`
            : "Delete render files"
        }
        disabled={snapshot.frameCount === 0 && !rendering}
        onClick={() => void renderCacheService.deleteRenderFiles()}
      >
        <Trash2 size={14} aria-hidden />
      </Button>
    </div>
  );
});
