/**
 * Phone touch timeline (stage 2), CapCut-style: the playhead is fixed in the middle and the clips
 * scroll under it with a finger — scrolling scrubs, playing scrolls. Tap a clip to select it, tap
 * empty space to clear. Reads the same stores as the desktop timeline; edits come in stage 3.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { timelineRows, type RowKind } from "./rows";

export const PIXELS_PER_SECOND = 56;
const ROW_HEIGHT: Record<RowKind, number> = { video: 56, text: 30, audio: 26 };

export const TouchTimeline: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const duration = project.timeline?.duration ?? 0;
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const playing = useTimelineStore((s) => s.playbackState === "playing");
  const seekTo = useTimelineStore((s) => s.seekTo);
  const pause = useTimelineStore((s) => s.pause);
  const selected = useUIStore((s) => s.selectedItems);
  const select = useUIStore((s) => s.select);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const rows = useMemo(() => timelineRows(project), [project]);

  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(-1);
  const [half, setHalf] = useState(180);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHalf(el.clientWidth / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Playhead (playing, seeks from elsewhere) → scroll position.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = playhead * PIXELS_PER_SECOND;
    if (Math.abs(el.scrollLeft - x) < 1) return;
    programmatic.current = x;
    el.scrollLeft = x;
  }, [playhead, half]);

  // Finger scroll → playhead.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (programmatic.current >= 0 && Math.abs(el.scrollLeft - programmatic.current) < 2) return;
    programmatic.current = -1;
    if (playing) pause();
    seekTo(Math.min(duration, Math.max(0, el.scrollLeft / PIXELS_PER_SECOND)));
  };

  const width = duration * PIXELS_PER_SECOND + half * 2;
  const isSelected = (id: string) => selected.some((s) => s.id === id);
  const ticks = Array.from({ length: Math.floor(duration) + 1 }, (_, i) => i);

  return (
    <div className="relative h-full w-full select-none bg-bg" dir="ltr" data-testid="touch-timeline" data-no-translate="">
      <div ref={scroller} onScroll={onScroll} onClick={() => clearSelection()}
        className="h-full w-full overflow-x-auto overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x pan-y" }}>
        <div className="relative" style={{ width, minHeight: "100%" }}>
          <div className="relative h-6 text-[10px] text-fg-muted" aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-border/60" style={{ left: half + t * PIXELS_PER_SECOND }}>
                {t % 2 === 0 && <span className="ms-1 tabular-nums">{t}s</span>}
              </div>
            ))}
          </div>
          <div className="space-y-1.5 py-2">
            {rows.map((row) => (
              <div key={`${row.trackId}-${row.kind}`} className="relative" style={{ height: ROW_HEIGHT[row.kind] }}>
                {row.clips.map((c) => (
                  <button key={c.id} type="button" title={c.label}
                    onClick={(e) => { e.stopPropagation(); select({ type: c.selection, id: c.id, trackId: row.trackId }); }}
                    className={`absolute top-0 h-full overflow-hidden rounded-md border-2 text-start ${isSelected(c.id) ? "border-white ring-2 ring-primary" : "border-transparent"} ${
                      row.kind === "video" ? "bg-bg-3" : row.kind === "text" ? "bg-amber-500/80" : "bg-teal-500/70"}`}
                    style={{
                      left: half + c.start * PIXELS_PER_SECOND,
                      width: Math.max(8, c.duration * PIXELS_PER_SECOND - 2),
                      ...(c.thumb ? { backgroundImage: `url(${c.thumb})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 100%" } : {}),
                    }}>
                    {row.kind !== "video" && (
                      <span className="block truncate px-1.5 text-[11px] font-medium leading-[26px] text-black" dir="auto">{c.label}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {rows.length === 0 && (
              <p className="sticky left-0 px-4 py-6 text-center text-xs text-fg-muted" dir="rtl" data-no-translate="" style={{ width: half * 2 }}>
                الخط الزمني فارغ — أضف لقطات من مكتبة عيون المخرج.
              </p>
            )}
          </div>
        </div>
      </div>
      {/* Fixed playhead in the middle. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" aria-hidden />
    </div>
  );
};
