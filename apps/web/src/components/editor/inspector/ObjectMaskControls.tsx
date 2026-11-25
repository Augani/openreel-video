import { useRef, useState } from "react";
import { Button, Label, Progress, ToggleGroup, ToggleGroupItem } from "@openreel/ui";
import { Eraser, StepBack, StepForward, X } from "@/icons/lucide-compat";
import type { Mask, MaskTarget } from "@openreel/core";
import { DEFAULT_OBJECT_REMOVAL, OBJECT_REMOVAL_LIMITS } from "@openreel/core/video/content-aware-fill/types";
import { useProjectStore } from "../../../stores/project-store";
import { PropertySlider } from "./shell/PropertySlider";
import { useObjectMaskStore } from "../../../stores/object-mask-store";
import { toast } from "../../../stores/notification-store";
import { trackObjectMask } from "../../../services/object-mask";
import { clearObjectRemoval, removalIsStale, removeObject, setObjectRemovalEnabled } from "../../../services/content-aware-fill";

/** What the mask controls: the clip's visibility, or only where its effects and grade show. */
export function MaskTargetToggle({ mask, edit }: { mask: Mask; edit: (update: (mask: Mask) => Mask) => void }) {
  const value: MaskTarget = mask.appliesTo ?? "visibility";
  return (
    <div className="space-y-1.5">
      <Label className="block text-[11px] text-fg-2">Mask controls</Label>
      <ToggleGroup
        type="single"
        aria-label="Mask controls"
        value={value}
        onValueChange={(next) => {
          if (next === "visibility" || next === "effects") edit((current) => ({ ...current, appliesTo: next }));
        }}
        className="grid grid-cols-2 gap-1"
      >
        <ToggleGroupItem value="visibility" aria-label="Mask controls clip visibility" className="h-7 min-w-0 border border-border px-1 text-[10px]">Clip visibility</ToggleGroupItem>
        <ToggleGroupItem value="effects" aria-label="Mask controls effects only" className="h-7 min-w-0 border border-border px-1 text-[10px]">Effects only</ToggleGroupItem>
      </ToggleGroup>
      <p className="text-[10px] leading-4 text-fg-2">
        {value === "effects"
          ? `The clip stays fully visible. Its effects and color grade show ${mask.inverted ? "outside" : "inside"} the mask only.`
          : "Only the part of the clip inside the mask is visible."}
      </p>
    </div>
  );
}

/** Track Backward / Forward from the playhead: the outline follows the object, one editable keyframe per frame. */
export function MaskTrackingControls({ mask }: { mask: Mask }) {
  const tracking = useObjectMaskStore((s) => s.tracking);
  const controller = useRef<AbortController | null>(null);
  const mine = tracking?.maskId === mask.id;
  const tolerance = useObjectMaskStore((s) => s.simplifyTolerance);
  const run = async (direction: "forward" | "backward") => {
    if (useObjectMaskStore.getState().tracking) return;
    const abort = new AbortController();
    controller.current = abort;
    const store = useObjectMaskStore.getState();
    store.setTracking({ maskId: mask.id, direction, progress: 0, lostFrames: 0 });
    try {
      const report = await trackObjectMask(mask.clipId, mask.id, direction, abort.signal, (progress, lostFrames) =>
        useObjectMaskStore.getState().setTracking({ maskId: mask.id, direction, progress, lostFrames }),
        useObjectMaskStore.getState().simplifyTolerance,
      );
      toast.success(
        direction === "forward" ? "Tracked forward" : "Tracked backward",
        report.lostFrames ? `${report.frames} frames, the object was unclear in ${report.lostFrames}. Adjust the mask there and track again.` : `${report.frames} frames, ${report.keyframes} keyframes. Edit any keyframe to correct it.`,
      );
    } catch (error) {
      if (!abort.signal.aborted) toast.error("Tracking failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      controller.current = null;
      useObjectMaskStore.getState().setTracking(null);
    }
  };
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg-1 p-2">
      <Label className="block text-[11px] text-fg-2">Track mask from the playhead</Label>
      {mine ? (
        <div className="space-y-1.5" data-testid="object-mask-tracking">
          <Progress value={tracking.progress} aria-label="Tracking progress" />
          <div className="flex items-center justify-between gap-2 text-[10px] text-fg-2">
            <span>Tracking {tracking.direction}… {Math.round(tracking.progress)}%</span>
            <Button type="button" variant="ghost" size="sm" aria-label="Cancel tracking" onClick={() => controller.current?.abort()} className="h-6 gap-1 px-1.5 text-[10px]"><X size={12} aria-hidden />Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          <Button type="button" variant="outline" size="sm" aria-label="Track mask backward" disabled={Boolean(tracking)} onClick={() => { void run("backward"); }} className="h-7 gap-1 text-[11px]"><StepBack size={12} aria-hidden />Backward</Button>
          <Button type="button" variant="outline" size="sm" aria-label="Track mask forward" disabled={Boolean(tracking)} onClick={() => { void run("forward"); }} className="h-7 gap-1 text-[11px]">Forward<StepForward size={12} aria-hidden /></Button>
        </div>
      )}
      <PropertySlider label="Keyframe tolerance" min={0} max={5} step={0.25} value={tolerance} onChange={(value) => useObjectMaskStore.getState().setSimplifyTolerance(value)} formatValue={(value) => (value === 0 ? "every frame" : `${value.toFixed(2)}px`)} />
      <p className="text-[10px] leading-4 text-fg-2">Move the playhead to a frame where the mask fits, then track. Only the keyframes the motion needs are kept, within the tolerance. Fix a frame by dragging its points, then track again from there.</p>
    </div>
  );
}

/** Remove Object (Content-Aware Fill): fill the masked area from other frames and from its surroundings. */
export function MaskRemoveObjectControls({ mask }: { mask: Mask }) {
  const removing = useObjectMaskStore((s) => s.removing);
  const tracking = useObjectMaskStore((s) => s.tracking);
  const settings = useProjectStore((state) => state.project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === mask.clipId)?.objectRemoval);
  // Re-read when the mask or the project changes: a key mismatch means the saved fill is out of date.
  const stale = useProjectStore((state) => { void state.project.masks; void state.project.timeline; return settings?.maskId === mask.id && removalIsStale(mask.clipId); });
  const controller = useRef<AbortController | null>(null);
  const [dilate, setDilate] = useState<number>(settings?.dilate ?? DEFAULT_OBJECT_REMOVAL.dilate);
  const [feather, setFeather] = useState<number>(settings?.feather ?? DEFAULT_OBJECT_REMOVAL.feather);
  const mine = removing?.maskId === mask.id;
  const active = settings?.maskId === mask.id ? settings : undefined;
  const run = async () => {
    if (useObjectMaskStore.getState().removing) return;
    const abort = new AbortController();
    controller.current = abort;
    useObjectMaskStore.getState().setRemoving({ maskId: mask.id, progress: 0 });
    try {
      const report = await removeObject(mask.clipId, mask.id, { dilate, feather }, abort.signal, (progress) => useObjectMaskStore.getState().setRemoving({ maskId: mask.id, progress }));
      toast.success("Object removed", `${report.filledFrames} frames filled, ${Math.round(report.temporalShare * 100)}% from other frames. Undo to bring it back.`);
    } catch (error) {
      if (!abort.signal.aborted) toast.error("Remove Object failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      controller.current = null;
      useObjectMaskStore.getState().setRemoving(null);
    }
  };
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg-1 p-2" data-testid="remove-object-controls">
      <Label className="block text-[11px] text-fg-2">Remove object</Label>
      {mine ? (
        <div className="space-y-1.5" data-testid="remove-object-progress">
          <Progress value={removing.progress} aria-label="Remove Object progress" />
          <div className="flex items-center justify-between gap-2 text-[10px] text-fg-2">
            <span>Analysing… {Math.round(removing.progress)}%</span>
            <Button type="button" variant="ghost" size="sm" aria-label="Cancel Remove Object" onClick={() => controller.current?.abort()} className="h-6 gap-1 px-1.5 text-[10px]"><X size={12} aria-hidden />Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <PropertySlider label="Grow" min={OBJECT_REMOVAL_LIMITS.dilate.min} max={OBJECT_REMOVAL_LIMITS.dilate.max} step={1} value={dilate} onChange={setDilate} formatValue={(value) => `${Math.round(value)}`} />
          <PropertySlider label="Edge blend" min={OBJECT_REMOVAL_LIMITS.feather.min} max={OBJECT_REMOVAL_LIMITS.feather.max} step={1} value={feather} onChange={setFeather} formatValue={(value) => `${Math.round(value)}`} />
          <div className="grid grid-cols-2 gap-1">
            <Button type="button" variant="outline" size="sm" aria-label="Remove Object" disabled={Boolean(removing) || Boolean(tracking)} onClick={() => { void run(); }} className="h-7 gap-1 text-[11px]"><Eraser size={12} aria-hidden />{active ? "Analyse again" : "Remove object"}</Button>
            {active && (
              <Button type="button" variant="outline" size="sm" aria-label="Turn Remove Object off" aria-pressed={active.enabled} onClick={() => { void (active.enabled ? setObjectRemovalEnabled(mask.clipId, false) : setObjectRemovalEnabled(mask.clipId, true)); }} className="h-7 text-[11px]">{active.enabled ? "On" : "Off"}</Button>
            )}
          </div>
          {active && <Button type="button" variant="ghost" size="sm" aria-label="Clear Remove Object" onClick={() => { void clearObjectRemoval(mask.clipId); }} className="h-6 px-1.5 text-[10px]">Clear</Button>}
        </>
      )}
      {active?.enabled && stale && <p className="text-[10px] leading-4 text-amber-400" data-testid="remove-object-stale">The mask or clip changed since the last analysis. Analyse again to update the fill.</p>}
      <p className="text-[10px] leading-4 text-fg-2">Track the mask over the object first. While this is on, the mask only marks what is removed. Background other frames show is used first, the rest is filled from its surroundings. Grow and Edge blend are per 1000 px of picture width.</p>
    </div>
  );
}
