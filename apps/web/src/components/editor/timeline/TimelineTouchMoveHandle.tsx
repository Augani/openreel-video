import type { PointerEvent } from "react";
import { GripHorizontal } from "@/icons/lucide-compat";

export function TimelineTouchMoveHandle({ label, onPointerDown }: {
  label: string;
  onPointerDown: (event: PointerEvent) => void;
}) {
  return <button type="button" data-timeline-move className="editor-touch-move" aria-label={label}
    onPointerDown={onPointerDown} onClick={(event) => event.stopPropagation()}>
    <GripHorizontal size={20} aria-hidden />
  </button>;
}
