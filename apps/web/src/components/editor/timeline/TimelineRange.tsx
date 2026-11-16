import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
} from "@openreel/ui";
import { useShallow } from "zustand/react/shallow";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import { resolvePlaybackLoop } from "../../../utils/playback-loop";
import { editingFrameStepSeconds } from "../editing-frame-rate";
import { markPreviewRange } from "../preview/preview-range-actions";

function useRangeOwner() {
  return useProjectStore(
    useShallow((state) => ({
      projectId: state.project.id,
      executor: state.actionExecutor,
    })),
  );
}

type RangeOwner = ReturnType<typeof useRangeOwner>;
function isCurrentOwner(owner: RangeOwner) {
  const state = useProjectStore.getState();
  return (
    state.project.id === owner.projectId &&
    state.actionExecutor === owner.executor
  );
}
function editsLocked() {
  return (
    Boolean(useTimelineStore.getState().playbackLockedReason) ||
    useUIStore.getState().exportState.isExporting
  );
}

export function TimelineRangeActions({
  duration,
  frameRate,
}: {
  duration: number;
  frameRate: number;
}) {
  const owner = useRangeOwner();
  const locked = useTimelineStore((state) =>
    Boolean(state.playbackLockedReason),
  );
  const start = useTimelineStore((state) => state.loopStart);
  const end = useTimelineStore((state) => state.loopEnd);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [owner]);
  const range = resolvePlaybackLoop(
    { loopEnabled: true, loopStart: start, loopEnd: end },
    duration,
  );
  const marked = end > start;
  const disabled = !range || locked || exporting;
  const inTime = formatFrameTimecode(range?.start ?? 0, frameRate);
  const outTime = formatFrameTimecode(range?.end ?? 0, frameRate);
  const mark = (edge: "in" | "out") => {
    if (disabled || !isCurrentOwner(owner) || editsLocked()) return;
    markPreviewRange(edge, duration, frameRate);
  };
  return (
    <div className="workspace-timeline-range-actions">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            className="workspace-timeline-range-summary"
            aria-label="Preview range controls"
            title="Set preview In and Out points"
          >
            <span>
              In {inTime} · Out {outTime}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="workspace-timeline-range-popover"
          aria-label="Preview range"
        >
          <p>Preview range</p>
          <Button
            variant="ghost"
            type="button"
            disabled={disabled}
            aria-label="Mark In point"
            title="Mark In at playhead (I)"
            onClick={() => mark("in")}
          >
            <span>
              Mark In <kbd>I</kbd>
            </span>
            <time>{inTime}</time>
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={disabled}
            aria-label="Mark Out point"
            title="Mark Out at playhead (O)"
            onClick={() => mark("out")}
          >
            <span>
              Mark Out <kbd>O</kbd>
            </span>
            <time>{outTime}</time>
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!marked || locked || exporting}
            aria-label="Clear preview range"
            onClick={() => {
              if (isCurrentOwner(owner) && !editsLocked())
                useTimelineStore.getState().clearLoopRange();
            }}
          >
            Clear range
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function TimelineRange({
  duration,
  frameRate,
  pixelsPerSecond,
}: {
  duration: number;
  frameRate: number;
  pixelsPerSecond: number;
}) {
  const owner = useRangeOwner();
  const start = useTimelineStore((state) => state.loopStart);
  const end = useTimelineStore((state) => state.loopEnd);
  const enabled = useTimelineStore((state) => state.loopEnabled);
  const locked = useTimelineStore((state) =>
    Boolean(state.playbackLockedReason),
  );
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const gesture = useRef<{
    owner: RangeOwner;
    start: number;
    end: number;
    pointerId: number;
    cancelled: boolean;
    lastWritten: { start: number; end: number } | null;
    target: HTMLElement;
    edge: "in" | "out";
    timeOffset: number;
  } | null>(null);
  useEffect(() => {
    const drag = gesture.current;
    if (drag && !isCurrentOwner(drag.owner)) {
      drag.cancelled = true;
      if (drag.target.hasPointerCapture?.(drag.pointerId))
        drag.target.releasePointerCapture?.(drag.pointerId);
    }
  }, [owner]);
  const range = resolvePlaybackLoop(
    { loopEnabled: true, loopStart: start, loopEnd: end },
    duration,
  );
  if (
    !range ||
    !(end > start) ||
    !Number.isFinite(pixelsPerSecond) ||
    pixelsPerSecond <= 0
  )
    return null;
  const frame = Math.min(duration, editingFrameStepSeconds(frameRate));
  const gap = Math.min(frame, range.end - range.start);
  const disabled = locked || exporting || duration <= frame;
  const change = (edge: "in" | "out", value: number) => {
    const drag = gesture.current;
    if (
      disabled ||
      editsLocked() ||
      !isCurrentOwner(owner) ||
      (drag && (drag.cancelled || !isCurrentOwner(drag.owner)))
    )
      return;
    const state = useTimelineStore.getState();
    const expected = drag?.lastWritten ?? drag;
    if (
      drag &&
      expected &&
      (state.loopStart !== expected.start || state.loopEnd !== expected.end)
    ) {
      drag.cancelled = true;
      return;
    }
    const snapped = Math.round(value / frame) * frame;
    const nextStart =
      edge === "in"
        ? Math.max(0, Math.min(range.end - gap, snapped))
        : range.start;
    const nextEnd =
      edge === "out"
        ? Math.min(duration, Math.max(range.start + gap, snapped))
        : range.end;
    if (state.loopStart === nextStart && state.loopEnd === nextEnd) return;
    state.setLoopRange(nextStart, nextEnd);
    if (drag) drag.lastWritten = { start: nextStart, end: nextEnd };
  };
  const cancel = (event: { pointerId: number }) => {
    const drag = gesture.current;
    if (drag && drag.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (!drag || drag.cancelled || !isCurrentOwner(drag.owner) || editsLocked())
      return;
    const state = useTimelineStore.getState();
    // A cancelled pointer must not overwrite another range edit made meanwhile.
    if (
      drag.lastWritten &&
      state.loopStart === drag.lastWritten.start &&
      state.loopEnd === drag.lastWritten.end
    ) {
      state.setLoopRange(drag.start, drag.end);
    }
  };
  return (
    <>
      <div
        aria-hidden
        data-timeline-range
        className={`absolute inset-y-0 pointer-events-none border-y ${enabled ? "bg-accent/20 border-accent/50" : "bg-accent/10 border-accent/25"}`}
        style={{
          left: range.start * pixelsPerSecond,
          width: (range.end - range.start) * pixelsPerSecond,
        }}
      />
      {(["in", "out"] as const).map((edge) => (
        <Slider
          key={edge}
          className="workspace-timeline-range-slider"
          data-range-edge={edge}
          aria-label={edge === "in" ? "Range In point" : "Range Out point"}
          aria-valuetext={formatFrameTimecode(
            edge === "in" ? range.start : range.end,
            frameRate,
          )}
          aria-valuemin={edge === "in" ? 0 : range.start + gap}
          aria-valuemax={edge === "in" ? range.end - gap : duration}
          min={0}
          max={duration}
          step={frame}
          value={[edge === "in" ? range.start : range.end]}
          disabled={disabled}
          style={
            {
              width: duration * pixelsPerSecond,
              "--range-grip-fraction":
                (edge === "in" ? range.start : range.end) / duration,
            } as CSSProperties
          }
          onValueChange={([value]) => change(edge, value)}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (
              disabled ||
              editsLocked() ||
              !isCurrentOwner(owner) ||
              event.button !== 0 ||
              (gesture.current && !gesture.current.cancelled)
            ) {
              event.preventDefault();
              return;
            }
            useTimelineStore.getState().pause();
            gesture.current = {
              owner,
              start,
              end,
              pointerId: event.pointerId,
              cancelled: false,
              lastWritten: null,
              target: event.target as HTMLElement,
              edge,
              timeOffset:
                (edge === "in" ? range.start : range.end) -
                (event.clientX -
                  event.currentTarget.getBoundingClientRect().left) /
                  pixelsPerSecond,
            };
          }}
          onPointerMove={(event) => {
            const drag = gesture.current;
            if (
              !drag ||
              drag.pointerId !== event.pointerId ||
              drag.edge !== edge
            )
              return;
            event.preventDefault();
            // Retain where the grip was grabbed, including when the ruler scrolls.
            // A wide hit target must not jump to its center on the first move.
            change(
              edge,
              (event.clientX -
                event.currentTarget.getBoundingClientRect().left) /
                pixelsPerSecond +
                drag.timeOffset,
            );
          }}
          onPointerUp={(event) => {
            if (gesture.current?.pointerId === event.pointerId)
              gesture.current = null;
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(event) => {
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              return;
            event.stopPropagation();
            if (disabled || editsLocked() || !isCurrentOwner(owner)) {
              event.preventDefault();
              return;
            }
            useTimelineStore.getState().pause();
          }}
        />
      ))}
    </>
  );
}
