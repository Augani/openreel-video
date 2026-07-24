import React, { useCallback, useEffect, useRef, useState } from "react";
import { Layers } from "@/icons/lucide-compat";
import type { AdjustmentLayer } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

interface AdjustmentLayerTimelineItemProps {
  layer: AdjustmentLayer;
  pixelsPerSecond: number;
  frameRate: number;
  onSelectOwner: () => void;
}

const MIN_FRAMES = 1;

export const AdjustmentLayerTimelineItem: React.FC<AdjustmentLayerTimelineItemProps> = ({
  layer,
  pixelsPerSecond,
  frameRate,
  onSelectOwner,
}) => {
  const [gesture, setGesture] = useState<"move" | "left" | "right" | null>(null);
  const startRef = useRef({ x: 0, startTime: 0, duration: 0 });

  const commitTiming = useCallback((startTime: number, duration: number) => {
    const project = useProjectStore.getState().project;
    const layers = (project.adjustmentLayers ?? []).map((candidate) =>
      candidate.id === layer.id ? { ...candidate, startTime, duration } : candidate,
    );
    void useProjectStore.getState().executeAction({
      type: "adjustment/setAll",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { layers },
    });
  }, [layer.id]);

  const startGesture = (event: React.MouseEvent, kind: "move" | "left" | "right") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectOwner();
    startRef.current = { x: event.clientX, startTime: layer.startTime, duration: layer.duration };
    useProjectStore.getState().beginHistoryGroup(
      kind === "move" ? "Move adjustment layer" : "Trim adjustment layer",
    );
    setGesture(kind);
  };

  useEffect(() => {
    if (!gesture) return;
    const frameDuration = 1 / Math.max(1, frameRate);
    const snap = (value: number) => Math.round(value / frameDuration) * frameDuration;
    const handleMove = (event: MouseEvent) => {
      const delta = snap((event.clientX - startRef.current.x) / pixelsPerSecond);
      if (gesture === "move") {
        commitTiming(Math.max(0, startRef.current.startTime + delta), startRef.current.duration);
      } else if (gesture === "left") {
        const end = startRef.current.startTime + startRef.current.duration;
        const nextStart = Math.min(
          end - frameDuration * MIN_FRAMES,
          Math.max(0, startRef.current.startTime + delta),
        );
        commitTiming(nextStart, end - nextStart);
      } else {
        commitTiming(
          startRef.current.startTime,
          Math.max(frameDuration * MIN_FRAMES, startRef.current.duration + delta),
        );
      }
    };
    const handleUp = () => {
      setGesture(null);
      useProjectStore.getState().endHistoryGroup();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = gesture === "move" ? "grabbing" : "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [commitTiming, frameRate, gesture, pixelsPerSecond]);

  return (
    <div
      data-testid="adjustment-layer-timeline-item"
      aria-label={`${layer.name}, adjustment layer`}
      className={`absolute top-1 z-20 flex h-5 min-w-[12px] items-center overflow-hidden rounded border text-[9px] font-semibold shadow-sm ${
        layer.enabled
          ? "border-violet-300/70 bg-violet-500/85 text-white"
          : "border-violet-400/30 bg-violet-500/30 text-violet-100/60"
      } ${gesture === "move" ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        left: layer.startTime * pixelsPerSecond,
        width: Math.max(12, layer.duration * pixelsPerSecond),
      }}
      onMouseDown={(event) => startGesture(event, "move")}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Trim start of ${layer.name}`}
        className="h-full w-1.5 shrink-0 cursor-ew-resize bg-white/20 hover:bg-white/50"
        onMouseDown={(event) => startGesture(event, "left")}
      />
      <Layers size={10} className="ml-1 shrink-0" aria-hidden />
      <span className="truncate px-1">FX · {layer.name}</span>
      <button
        type="button"
        aria-label={`Trim end of ${layer.name}`}
        className="ml-auto h-full w-1.5 shrink-0 cursor-ew-resize bg-white/20 hover:bg-white/50"
        onMouseDown={(event) => startGesture(event, "right")}
      />
    </div>
  );
};
