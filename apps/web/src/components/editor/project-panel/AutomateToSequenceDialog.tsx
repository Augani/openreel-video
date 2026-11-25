import React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@openreel/ui";
import type { AssemblyMethod, AssemblyOrder } from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import {
  DEFAULT_ASSEMBLY_REQUEST,
  automateToSequence,
  defaultTransitionLabel,
  getAssemblySelection,
  previewAssembly,
  type AssemblyRequest,
} from "../../../services/assembly-commands";

const field = "h-7 rounded-[4px] border border-bg-3 bg-bg-2 px-2 text-xs text-fg";
const row = "flex items-center gap-2 text-xs";

/**
 * Automate to Sequence (Premiere): the Project panel selection, laid end to end from the playhead as one undo step.
 * Ordering, insert/overwrite, still length, the default video / audio transition and which streams to ignore.
 */
export const AutomateToSequenceDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [request, setRequest] = React.useState<AssemblyRequest>(DEFAULT_ASSEMBLY_REQUEST);
  const [still, setStill] = React.useState(String(DEFAULT_ASSEMBLY_REQUEST.stillDuration));
  const selected = React.useMemo(() => getAssemblySelection(), []);
  const transition = React.useMemo(() => defaultTransitionLabel(), []);
  const stillValue = Number(still);
  const effective: AssemblyRequest = { ...request, stillDuration: stillValue };
  const preview = React.useMemo(() => (stillValue > 0 ? previewAssembly(effective) : null), [effective.order, effective.method, effective.videoTransition, effective.audioTransition, effective.ignoreAudio, effective.ignoreVideo, stillValue]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof AssemblyRequest>(key: K, value: AssemblyRequest[K]) => setRequest((current) => ({ ...current, [key]: value }));
  const blocked = !(stillValue > 0) ? "Enter a still clip duration longer than zero." : preview && !preview.ok ? preview.message : null;

  const apply = () => {
    if (blocked) return;
    const outcome = automateToSequence(effective);
    if (outcome.success) {
      toast.success("Automate to Sequence", outcome.message ?? "Done");
      onClose();
    } else {
      toast.warning("Automate to Sequence", outcome.message ?? "Nothing was placed.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[420px] border-border bg-bg-1 text-fg" data-testid="automate-to-sequence-dialog">
        <DialogHeader>
          <DialogTitle>Automate to Sequence</DialogTitle>
          <DialogDescription>
            {selected.length} item{selected.length === 1 ? "" : "s"} selected. Clips are placed one after another from the playhead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
          <label htmlFor="assembly-order" className="text-fg-3">Ordering</label>
          <select id="assembly-order" data-testid="assembly-order" className={field} value={request.order} onChange={(event) => set("order", event.target.value as AssemblyOrder)}>
            <option value="selection">Selection order</option>
            <option value="name">Sort order (name)</option>
            <option value="date">Date imported</option>
          </select>
          <span className="text-fg-3">Placement</span>
          <span>Sequentially at playhead</span>
          <label htmlFor="assembly-method" className="text-fg-3">Method</label>
          <select id="assembly-method" data-testid="assembly-method" className={field} value={request.method} onChange={(event) => set("method", event.target.value as AssemblyMethod)}>
            <option value="insert">Insert edit</option>
            <option value="overwrite">Overwrite edit</option>
          </select>
          <label htmlFor="assembly-still" className="text-fg-3">Still clip duration</label>
          <span className={row}>
            <input id="assembly-still" data-testid="assembly-still" type="number" min={0.1} step={0.5} className={`${field} w-20`} value={still} onChange={(event) => setStill(event.target.value)} />
            seconds
          </span>
        </div>
        <fieldset className="space-y-1.5" aria-label="Options">
          <label className={row}>
            <input type="checkbox" data-testid="assembly-video-transition" checked={request.videoTransition} onChange={(event) => set("videoTransition", event.target.checked)} />
            Apply default video transition ({transition})
          </label>
          <label className={row}>
            <input type="checkbox" data-testid="assembly-audio-transition" checked={request.audioTransition} onChange={(event) => set("audioTransition", event.target.checked)} />
            Apply default audio transition (fade at each cut)
          </label>
          <label className={row}>
            <input type="checkbox" data-testid="assembly-ignore-audio" checked={request.ignoreAudio} onChange={(event) => set("ignoreAudio", event.target.checked)} />
            Ignore audio
          </label>
          <label className={row}>
            <input type="checkbox" data-testid="assembly-ignore-video" checked={request.ignoreVideo} onChange={(event) => set("ignoreVideo", event.target.checked)} />
            Ignore video
          </label>
        </fieldset>
        <p className="min-h-4 text-[11px] text-fg-3" data-testid="assembly-summary" role="status">
          {blocked ?? (preview && preview.ok ? `${preview.placed.length} clip${preview.placed.length === 1 ? "" : "s"}, ${(preview.end - preview.start).toFixed(1)}s${preview.skipped.length ? `, ${preview.skipped.length} skipped` : ""}` : "")}
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button data-testid="assembly-apply" disabled={Boolean(blocked)} onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
