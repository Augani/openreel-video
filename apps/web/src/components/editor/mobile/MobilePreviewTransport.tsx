import { type ReactNode } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@openreel/ui";
import { Pause, LoaderCircle } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { MobileEditorIcon } from "./MobileEditorIcon";

const shortTime = (value: number) => `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value)) % 60).padStart(2, "0")}`;
export function MobilePreviewTransport({position, duration, playing, lockedReason, onTogglePlayback, onFullscreen, children}: {
  position: number; duration: number; playing: boolean; lockedReason: string | null; onTogglePlayback: () => void; onFullscreen: () => void; children: ReactNode;
}) {
  return <div className="mobile-preview-transport">
    <div className="mobile-preview-time">
      <Popover><PopoverTrigger asChild><Button variant="ghost" aria-label="Preview position and options" title="Go to a time or adjust preview options">{shortTime(position)}<span>/ {shortTime(duration)}</span></Button></PopoverTrigger>
        <PopoverContent align="start" className="mobile-preview-options w-[min(366px,calc(100vw-24px))] p-2" aria-label="Preview controls">{children}</PopoverContent>
      </Popover>
    </div>
    <Button className="mobile-preview-play" aria-label={lockedReason ?? (playing ? "Pause" : "Play")} disabled={Boolean(lockedReason)} onClick={onTogglePlayback}>{lockedReason ? <LoaderCircle className="animate-spin"/> : playing ? <Pause fill="currentColor"/> : <MobileEditorIcon name="play" size={16}/>}</Button>
    <div className="mobile-preview-actions">
      <Button variant="ghost" size="icon" aria-label="Undo" onClick={() => void useProjectStore.getState().undo()}><MobileEditorIcon name="undo" size={20}/></Button>
      <Button variant="ghost" size="icon" aria-label="Redo" onClick={() => void useProjectStore.getState().redo()}><MobileEditorIcon name="redo" size={20}/></Button>
      <Button variant="ghost" size="icon" aria-label="Full Screen" onClick={onFullscreen}><MobileEditorIcon name="fullscreen" size={20}/></Button>
    </div>
  </div>;
}
