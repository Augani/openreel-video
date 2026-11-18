import React, { useCallback, useEffect, useRef, useState } from "react";
import { protectedDurations, type GraphicInstance, type Track } from "@openreel/core";
import { Link2 } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@openreel/ui";
import { calculateSnap } from "./utils";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import {
  moveGraphicCommand,
  resizeGraphicCommand,
  ungroupGraphicCommand,
} from "../../../services/graphic-commands";
import {
  detachLinkedCompositionCommand,
  openLinkedCompositionWindow,
  replaceSelectionWithLinkedComposition,
} from "../../../services/linked-comp-commands";
import { renderAndReplaceCommand } from "../../../services/linked-comp-render";

interface GraphicClipComponentProps {
  instance: GraphicInstance;
  /** Member clip id that stands for the whole graphic in selection and in e2e. */
  anchorId: string;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: (clipId: string, addToSelection: boolean) => void;
  allTracks: Track[];
}

type Gesture =
  | { kind: "move"; originX: number; startTime: number }
  | { kind: "left" | "right"; originX: number; startTime: number; duration: number };

/**
 * One bar for a whole graphic (Essential Graphics). Its member text/shape/svg
 * layers are hidden from the lane; moving and trimming the bar goes through the
 * graphic commands, so the layers are regenerated and the intro/outro animation
 * (anchored to the clip ends) is preserved when the bar is stretched.
 */
const GraphicClipComponentImpl: React.FC<GraphicClipComponentProps> = ({
  instance,
  anchorId,
  pixelsPerSecond,
  isSelected,
  onSelect,
  allTracks,
}) => {
  const locked = allTracks.find((track) => track.id === instance.trackId)?.locked ?? false;
  const snapSettings = useUIStore((state) => state.snapSettings);
  const [live, setLive] = useState<{ startTime: number; duration: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const { intro, outro, minDuration } = protectedDurations(instance.template);

  const startTime = live?.startTime ?? instance.startTime;
  const duration = live?.duration ?? instance.duration;
  const left = startTime * pixelsPerSecond;
  const width = duration * pixelsPerSecond;

  const begin = (event: React.MouseEvent, next: Gesture) => {
    if (locked || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    gesture.current = next;
    moved.current = false;
    onSelect(anchorId, event.shiftKey || event.metaKey || event.ctrlKey);
    document.body.style.userSelect = "none";
    if (next.kind !== "move") document.body.style.cursor = "ew-resize";
  };

  const snapTime = useCallback(
    (raw: number, spanDuration: number): number => {
      const result = calculateSnap(
        Math.max(0, raw),
        instance.id,
        useProjectStore.getState().project.timeline.tracks,
        useTimelineStore.getState().playheadPosition,
        { ...snapSettings, snapToPlayhead: true },
        pixelsPerSecond,
        spanDuration,
      );
      return result.time;
    },
    [instance.id, pixelsPerSecond, snapSettings],
  );

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const current = gesture.current;
      if (!current) return;
      const dx = event.clientX - current.originX;
      if (!moved.current && Math.abs(dx) < 3) return;
      moved.current = true;
      const dt = dx / pixelsPerSecond;
      if (current.kind === "move") {
        const next = snapTime(current.startTime + dt, instance.duration);
        setLive({ startTime: next, duration: instance.duration });
      } else if (current.kind === "left") {
        const end = current.startTime + current.duration;
        const next = Math.min(snapTime(current.startTime + dt, current.duration), end - minDuration);
        setLive({ startTime: Math.max(0, next), duration: end - Math.max(0, next) });
      } else {
        const end = snapTime(current.startTime + current.duration + dt, current.duration);
        setLive({ startTime: current.startTime, duration: Math.max(minDuration, end - current.startTime) });
      }
    };
    const onUp = () => {
      const current = gesture.current;
      gesture.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const result = liveRef.current;
      if (!current || !moved.current || !result) {
        setLive(null);
        return;
      }
      void (async () => {
        if (current.kind === "move") await moveGraphicCommand(instance.id, { startTime: result.startTime });
        else await resizeGraphicCommand(instance.id, { startTime: result.startTime, duration: result.duration });
        setLive(null);
      })();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [instance.id, instance.duration, minDuration, pixelsPerSecond, snapTime]);

  const introWidth = Math.min(width / 2, intro * pixelsPerSecond);
  const outroWidth = Math.min(width / 2, outro * pixelsPerSecond);
  const interacting = live !== null;

  const linkedId = instance.linkedCompositionId;
  const bar = (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Select graphic ${instance.name}`}
      data-linked-composition={linkedId}
      onDoubleClick={linkedId ? () => { void openLinkedCompositionWindow(linkedId); } : undefined}
      aria-pressed={isSelected}
      data-timeline-clip
      data-timeline-item-id={anchorId}
      data-clip-kind="graphic"
      data-graphic-id={instance.id}
      data-locked={locked}
      data-timeline-interacting={interacting}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => begin(event, { kind: "move", originX: event.clientX, startTime: instance.startTime })}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(anchorId, event.shiftKey || event.metaKey || event.ctrlKey);
      }}
      className={`absolute top-1 bottom-1 rounded-[4px] overflow-hidden cursor-grab group border ${
        isSelected ? "ring-1 ring-accent border-accent z-10" : "border-sky-400/50 hover:border-sky-300/70 hover:brightness-110"
      }`}
      style={{
        backgroundColor: "color-mix(in srgb, #0ea5e9 38%, var(--bg-2, #1b1b1d))",
        transform: `translateX(${left}px)`,
        width: `max(1px, calc(${Math.max(width, 40)}px - var(--timeline-clip-inset, 0px) * 2))`,
        marginLeft: "var(--timeline-clip-inset, 0px)",
        willChange: interacting ? "transform, width" : "auto",
        transition: interacting ? "none" : "opacity 150ms, box-shadow 150ms",
      }}
    >
      {introWidth > 2 && (
        <div
          aria-hidden="true"
          data-graphic-intro
          className="absolute left-0 top-0 bottom-0 pointer-events-none"
          style={{ width: introWidth, background: "linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0))" }}
        />
      )}
      {outroWidth > 2 && (
        <div
          aria-hidden="true"
          data-graphic-outro
          className="absolute right-0 top-0 bottom-0 pointer-events-none"
          style={{ width: outroWidth, background: "linear-gradient(270deg, rgba(255,255,255,0.28), rgba(255,255,255,0))" }}
        />
      )}
      {(["left", "right"] as const).map((edge) => (
        <div
          key={edge}
          data-timeline-trim={edge}
          aria-label={edge === "left" ? "Trim start" : "Trim end"}
          onMouseDown={(event) =>
            begin(event, { kind: edge, originX: event.clientX, startTime: instance.startTime, duration: instance.duration })
          }
          className={`absolute ${edge === "left" ? "left-0" : "right-0"} top-0 bottom-0 w-2 cursor-ew-resize z-20 transition-opacity ${
            isSelected ? "opacity-100 bg-accent" : "opacity-0 group-hover:opacity-100 hover:bg-accent/50"
          }`}
        />
      ))}
      <div className="relative w-full h-full flex items-center gap-1 px-3 pointer-events-none">
        {linkedId && <Link2 size={10} aria-label="Linked composition" className="shrink-0 text-fg" />}
        <span className="text-[10px] font-semibold text-fg truncate">{instance.name}</span>
      </div>
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{bar}</ContextMenuTrigger>
      <ContextMenuContent className="w-[230px] [&_[role=menuitem]]:text-xs" data-testid="graphic-bar-menu">
        {linkedId ? (
          <>
            <ContextMenuItem data-testid="menu-open-linked" onSelect={() => { void openLinkedCompositionWindow(linkedId); }}>Open Linked Composition</ContextMenuItem>
            <ContextMenuItem data-testid="menu-render-replace" onSelect={() => { void renderAndReplaceCommand(instance.id); }}>Render and Replace</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => { void detachLinkedCompositionCommand(instance.id); }}>Unlink from Composition</ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem
            data-testid="menu-replace-linked"
            onSelect={() => {
              onSelect(anchorId, false);
              void replaceSelectionWithLinkedComposition(instance.name);
            }}
          >
            Replace with Linked Composition
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => { void ungroupGraphicCommand(instance.id); }}>Ungroup Layers</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export const GraphicClipComponent = React.memo(GraphicClipComponentImpl);
