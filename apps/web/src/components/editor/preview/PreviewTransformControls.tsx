import type { CSSProperties, MouseEvent } from "react";
import { Button } from "@openreel/ui";
import { Lock, LockOpen, Move } from "lucide-react";
import type { HandlePosition } from "./types";

const handles: { position: HandlePosition; label: string; className: string }[] = [
  { position: "nw", label: "top left", className: "left-0 top-0 h-4 w-4 cursor-nw-resize" },
  { position: "ne", label: "top right", className: "left-full top-0 h-4 w-4 cursor-ne-resize" },
  { position: "sw", label: "bottom left", className: "left-0 top-full h-4 w-4 cursor-sw-resize" },
  { position: "se", label: "bottom right", className: "left-full top-full h-4 w-4 cursor-se-resize" },
  { position: "n", label: "top", className: "left-1/2 top-0 h-4 w-6 cursor-n-resize" },
  { position: "s", label: "bottom", className: "left-1/2 top-full h-4 w-6 cursor-s-resize" },
  { position: "w", label: "left", className: "top-1/2 left-0 h-6 w-4 cursor-w-resize" },
  { position: "e", label: "right", className: "top-1/2 left-full h-6 w-4 cursor-e-resize" },
];

export function PreviewTransformControls({ kind, aspectLocked, onToggleAspect, onMove, onResize, onFocusCanvas, moveStyle, showBorder = true }: {
  kind: "clip" | "text" | "graphic";
  aspectLocked: boolean;
  onToggleAspect: () => void;
  onMove: (event: MouseEvent) => void;
  onResize: (event: MouseEvent, handle: HandlePosition) => void;
  onFocusCanvas: () => void;
  moveStyle?: CSSProperties;
  showBorder?: boolean;
}) {
  const AspectIcon = aspectLocked ? Lock : LockOpen;
  return <>
    {showBorder && <div className="workspace-transform-border absolute inset-0 pointer-events-none" />}
    <Button variant="ghost" size="icon"
      aria-label={`Move selected ${kind}`}
      title={`Drag to move ${kind}`}
      className="workspace-transform-move absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full p-0 cursor-move pointer-events-auto"
      style={moveStyle}
      onMouseDown={onMove}
      onClick={onFocusCanvas}
    ><Move aria-hidden="true" /></Button>
    <Button variant="ghost" size="sm"
      aria-label={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
      aria-pressed={aspectLocked}
      title={aspectLocked ? "Aspect ratio locked" : "Aspect ratio free"}
      className="workspace-transform-aspect absolute -top-8 left-1/2 -translate-x-1/2 pointer-events-auto"
      onClick={onToggleAspect}
    ><AspectIcon aria-hidden="true" /></Button>
    {handles.map(handle => <Button key={handle.position} variant="ghost" size="icon"
      // Pointer-only resize targets stay out of the tab sequence. The Move
      // control returns keyboard users to the canvas; inspector size fields
      // retain precise keyboard resizing without eight extra tab stops.
      tabIndex={-1}
      aria-label={`Resize ${kind} from ${handle.label}`}
      title={`Drag to resize from ${handle.label}`}
      data-resize-handle={handle.position}
      className={`workspace-transform-resize absolute -translate-x-1/2 -translate-y-1/2 p-0 pointer-events-auto ${handle.className}`}
      onMouseDown={event => onResize(event, handle.position)}
    ><span aria-hidden="true" className={`workspace-transform-resize-mark pointer-events-none ${handle.position === "n" || handle.position === "s" ? "h-4 w-6" : handle.position === "e" || handle.position === "w" ? "h-6 w-4" : "h-4 w-4"}`} /></Button>)}
  </>;
}
