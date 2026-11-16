import type { PointerEvent } from "react";
import { Button } from "@openreel/ui";
import { GripHorizontal } from "@/icons/lucide-compat";

export function TimelineTouchMoveHandle({ label, onPointerDown }: {
  label: string;
  onPointerDown: (event: PointerEvent) => void;
}) {
  return <Button variant="ghost" size="sm" type="button" data-timeline-move className="editor-touch-move h-auto w-auto p-0 [&_svg]:size-5" aria-label={label}
    onPointerDown={onPointerDown} onClick={(event) => event.stopPropagation()}>
    <GripHorizontal size={20} aria-hidden />
  </Button>;
}
