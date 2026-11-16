import { Button } from "@openreel/ui";
import { LoaderCircle, Pause } from "lucide-react";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { stepEditingFrame } from "./editing-frame-rate";
import { markPreviewRange } from "./preview/preview-range-actions";

// Original paths from the authored Editor shell, inside shared shadcn buttons.
const paths = {
  in: "M10 4H6v16h4",
  start: "M19 20 9 12l10-8zM5 19V5",
  previous: "m15 18-6-6 6-6",
  play: "M7 4.5v15l12.5-7.5z",
  next: "m9 18 6-6-6-6",
  end: "m5 4 10 8-10 8zM19 5v14",
  out: "M14 4h4v16h-4",
  loop: "m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3",
  volume: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7",
  fullscreen: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
};

export function PreviewTransportIcon({ name, size = 17, strokeWidth = 2 }: {
  name: keyof typeof paths | "guides"; size?: number; strokeWidth?: number;
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === "play" ? "currentColor" : "none"}
    stroke={name === "play" ? "none" : "currentColor"} strokeWidth={strokeWidth}
    strokeLinecap={name === "guides" ? undefined : "round"} strokeLinejoin={name === "guides" ? undefined : "round"} aria-hidden="true" focusable="false">
    {name === "guides" ? <><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="6" y="8" width="12" height="8" rx="1" strokeDasharray="2 2"/></> : <path d={paths[name]}/>}
  </svg>;
}

export function PreviewTransportControls({ duration, frameRate, playing, lockedReason, exporting, onTogglePlayback }: {
  duration: number; frameRate: number; playing: boolean; lockedReason: string | null;
  exporting: boolean; onTogglePlayback: () => void;
}) {
  const disabled = !(duration > 0) || Boolean(lockedReason) || exporting;
  const blocked = () => disabled || Boolean(useTimelineStore.getState().playbackLockedReason) || useUIStore.getState().exportState.isExporting;
  const seek = (position: number) => {
    if (blocked()) return;
    const state = useTimelineStore.getState();
    state.pause();
    state.seekTo(Math.max(0, Math.min(duration, position)));
    state.scrollToPlayhead();
  };
  const step = (direction: -1 | 1) => seek(stepEditingFrame(useTimelineStore.getState().playheadPosition, direction, frameRate));
  return <div data-preview-playback className="flex items-center">
    <Button type="button" variant="ghost" size="icon" aria-label="Mark in" title="Mark In at playhead (I)" disabled={disabled} onClick={() => { if (!blocked()) markPreviewRange("in", duration, frameRate); }}><PreviewTransportIcon name="in"/></Button>
    <Button type="button" variant="ghost" size="icon" aria-label="Go to start" title="Go to start (Home)" disabled={disabled} onClick={() => seek(0)}><PreviewTransportIcon name="start"/></Button>
    <Button type="button" variant="ghost" size="icon" aria-label="Previous frame" disabled={disabled} onClick={() => step(-1)}><PreviewTransportIcon name="previous"/></Button>
    <Button type="button" variant="ghost" size="icon" data-preview-main-play aria-label={lockedReason ?? (playing ? "Pause" : "Play")}
      disabled={disabled} onClick={() => { if (!blocked()) onTogglePlayback(); }}>
      {lockedReason ? <LoaderCircle className="animate-spin"/> : playing ? <Pause fill="currentColor"/> : <PreviewTransportIcon name="play" size={16}/>}
    </Button>
    <Button type="button" variant="ghost" size="icon" aria-label="Next frame" disabled={disabled} onClick={() => step(1)}><PreviewTransportIcon name="next"/></Button>
    <Button type="button" variant="ghost" size="icon" aria-label="Go to end" title="Go to end (End)" disabled={disabled} onClick={() => seek(duration)}><PreviewTransportIcon name="end"/></Button>
    <Button type="button" variant="ghost" size="icon" aria-label="Mark out" title="Mark Out at playhead (O)" disabled={disabled} onClick={() => { if (!blocked()) markPreviewRange("out", duration, frameRate); }}><PreviewTransportIcon name="out"/></Button>
  </div>;
}
