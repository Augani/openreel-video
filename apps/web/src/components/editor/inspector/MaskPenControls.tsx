import { useMemo } from "react";
import { Button, cn } from "@openreel/ui";
import { Pen, Trash2, Diamond } from "@/icons/lucide-compat";
import {
  deletePoint,
  editMaskStructure,
  findMaskKeyframe,
  isSmoothPoint,
  maskPathAtTime,
  removeMaskKeyframeAt,
  toggleSmooth,
  upsertMaskKeyframe,
  type Mask,
} from "@openreel/core";
import { useMaskPenStore } from "../../../stores/mask-pen-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { commitMaskEdit, maskKeyTolerance } from "../../../services/mask-pen";

/** "Pen" entry next to the shape buttons: arms the pen on the Program monitor to draw a new mask. */
export function MaskPenLauncher({ clipId }: { clipId: string }) {
  const active = useMaskPenStore((s) => s.active && s.clipId === clipId && s.maskId === null);
  return (
    <Button
      type="button"
      variant="outline"
      aria-label="Pen tool: draw a mask on the Program monitor"
      aria-pressed={active}
      title="Draw a free-form Bezier mask on the Program monitor"
      onClick={() => {
        const pen = useMaskPenStore.getState();
        if (active) pen.disarm();
        else pen.arm(clipId, null);
      }}
      className={cn(
        "h-8 w-full min-w-0 justify-center gap-1.5 rounded-md bg-bg-2 px-2 text-[11px] hover:border-primary/40",
        active && "border-primary bg-primary/10 text-primary",
      )}
    >
      <Pen size={14} className="shrink-0" aria-hidden />
      <span className="truncate">{active ? "Pen: drawing on monitor (Esc to stop)" : "Pen: draw a Bezier mask on the monitor"}</span>
    </Button>
  );
}

/**
 * Per-mask path tools: edit the vertices on the Program monitor, switch the
 * selected vertex between corner and smooth, remove it, and keyframe the path
 * at the playhead (path keyframes interpolate between each other).
 */
export function MaskPathTools({ mask }: { mask: Mask }) {
  const penActive = useMaskPenStore((s) => s.active);
  const penClip = useMaskPenStore((s) => s.clipId);
  const penMask = useMaskPenStore((s) => s.maskId);
  const penVertex = useMaskPenStore((s) => s.vertex);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const editing = penActive && penClip === mask.clipId && penMask === mask.id;
  const tolerance = maskKeyTolerance();
  const here = useMemo(() => findMaskKeyframe(mask, playhead, tolerance), [mask, playhead, tolerance]);
  const vertex = editing ? penVertex : null;
  const shown = maskPathAtTime(mask, playhead);
  const point = vertex !== null ? shown.points[vertex] : undefined;
  const smooth = point ? isSmoothPoint(point) : false;
  const times = mask.keyframes.map((k) => k.time);

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg-1 p-2" data-testid="mask-path-tools">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-2">Path · {shown.points.length} points</span>
        <Button
          type="button"
          variant={editing ? "secondary" : "outline"}
          size="sm"
          aria-pressed={editing}
          aria-label="Edit mask on Program monitor"
          onClick={() => {
            if (editing) useMaskPenStore.getState().disarm();
            else useMaskPenStore.getState().arm(mask.clipId, mask.id);
          }}
          className="h-7 gap-1 px-2 text-[10px]"
        >
          <Pen size={12} aria-hidden />
          {editing ? "Editing on monitor" : "Edit on monitor"}
        </Button>
      </div>
      {editing && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={smooth ? "Convert vertex to corner" : "Convert vertex to smooth"}
            disabled={vertex === null}
            onClick={() => {
              if (vertex === null) return;
              void commitMaskEdit(mask.clipId, mask.id, (m) => editMaskStructure(m, (p) => toggleSmooth(p, vertex)));
            }}
            className="h-7 flex-1 px-1.5 text-[10px]"
          >
            {smooth ? "To corner" : "To smooth"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Delete selected vertex"
            disabled={vertex === null || shown.points.length <= 3}
            onClick={() => {
              if (vertex === null) return;
              void commitMaskEdit(mask.clipId, mask.id, (m) => editMaskStructure(m, (p) => deletePoint(p, vertex)));
              useMaskPenStore.getState().setVertex(null);
            }}
            className="h-7 gap-1 px-1.5 text-[10px]"
          >
            <Trash2 size={12} aria-hidden />
            Delete point
          </Button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={here ? "secondary" : "outline"}
          size="sm"
          aria-label={here ? "Update path keyframe at playhead" : "Add path keyframe at playhead"}
          onClick={() => {
            void commitMaskEdit(mask.clipId, mask.id, (m) =>
              upsertMaskKeyframe(m, playhead, maskPathAtTime(m, playhead), maskKeyTolerance()),
            );
          }}
          className="h-7 flex-1 gap-1 px-1.5 text-[10px]"
        >
          <Diamond size={12} aria-hidden className={cn(here && "fill-current")} />
          {here ? "Update keyframe" : "Keyframe path"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove path keyframe at playhead"
          disabled={!here}
          onClick={() => {
            void commitMaskEdit(mask.clipId, mask.id, (m) => removeMaskKeyframeAt(m, playhead, maskKeyTolerance()));
          }}
          className="h-7 px-1.5 text-[10px]"
        >
          Remove
        </Button>
      </div>
      <p className="text-[10px] leading-4 text-fg-3" data-testid="mask-keyframe-summary">
        {times.length
          ? `${times.length} path keyframe${times.length === 1 ? "" : "s"} at ${times.map((t) => `${t.toFixed(2)}s`).join(", ")}. Edits at the playhead write a keyframe.`
          : "No path keyframes. Move the playhead and press Keyframe path to animate the shape."}
      </p>
    </div>
  );
}
