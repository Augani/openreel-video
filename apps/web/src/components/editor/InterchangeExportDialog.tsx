import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import { AAF_DECISION } from "@openreel/core/interchange/aaf-decision";
import type { InterchangeFormat } from "@openreel/core/interchange/index";
import { sequenceContentDuration } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { readSequences } from "../../services/sequence-commands";
import {
  EXPORT_LABELS,
  exportTimelineInterchange,
  useInterchangeExportPickerStore,
} from "../../services/timeline-interchange";

const FORMATS: { id: InterchangeFormat; hint: string }[] = [
  { id: "xmeml", hint: "Premiere Pro, DaVinci Resolve. Nested sequences stay nested; multicam cuts carry a multiclip." },
  { id: "fcpxml", hint: "Final Cut Pro. Nests become compound clips; multicam cuts become mc-clips." },
  { id: "edl", hint: "CMX3600, one file per video track. Nests are flattened and reported." },
  { id: "otio", hint: "OpenTimelineIO. Nested sequences stay nested (stacks)." },
  { id: "aaf", hint: "Avid Media Composer, Premiere Pro, DaVinci Resolve. Edit only: media is linked by path, never embedded; nests are flattened." },
];

const formatDuration = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** File > Export timeline > Choose sequence: export ANY sequence, not just the active one. */
export function InterchangeExportDialog() {
  const open = useInterchangeExportPickerStore((s) => s.open);
  const includeMarkers = useInterchangeExportPickerStore((s) => s.includeMarkers);
  const setIncludeMarkers = useInterchangeExportPickerStore((s) => s.setIncludeMarkers);
  const setOpen = useInterchangeExportPickerStore((s) => s.setOpen);
  const project = useProjectStore((s) => s.project);
  const [format, setFormat] = useState<InterchangeFormat>("xmeml");
  const [chosen, setChosen] = useState<string | null>(null);
  const listing = useMemo(() => (open ? readSequences(project) : null), [open, project]);
  if (!open || !listing) return null;
  const sequenceId = chosen && listing.sequences.some((s) => s.id === chosen) ? chosen : listing.activeId;
  const close = () => {
    setOpen(false);
    setChosen(null);
  };
  const confirm = () => {
    exportTimelineInterchange(format, sequenceId);
    close();
  };
  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent
        aria-describedby="interchange-picker-desc"
        className="flex max-h-[90dvh] w-[calc(100vw-32px)] max-w-[480px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg"
        data-testid="interchange-export-picker"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-[15px] font-semibold text-fg">Export timeline</DialogTitle>
          <DialogDescription id="interchange-picker-desc" className="text-[12px] text-fg-muted">
            Pick any sequence, open or not, and a format.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 text-[13px]">
          <div className="space-y-1.5">
            <span id="interchange-sequence-label" className="font-medium">Sequence</span>
            <Select value={sequenceId} onValueChange={setChosen}>
              <SelectTrigger
                aria-labelledby="interchange-sequence-label"
                data-testid="interchange-sequence-select"
                className="h-8 w-full bg-bg-2 px-2 text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {listing.sequences.map((sequence) => (
                  <SelectItem key={sequence.id} value={sequence.id} data-testid="interchange-sequence-option">
                    {sequence.name}
                    {sequence.id === listing.activeId ? " (active)" : ""} · {formatDuration(sequenceContentDuration(sequence.timeline))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Format</legend>
            {FORMATS.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="interchange-format"
                  checked={format === f.id}
                  onChange={() => setFormat(f.id)}
                  className="mt-1"
                  data-testid={`interchange-format-${f.id}`}
                />
                <span>
                  {EXPORT_LABELS[f.id]}
                  <span className="block text-[12px] text-fg-muted">{f.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeMarkers}
              onChange={(event) => setIncludeMarkers(event.target.checked)}
              data-testid="interchange-include-markers"
            />
            <span>
              Include markers
              <span className="block text-[12px] text-fg-muted">
                Names, comments and range lengths where the format has a place for them.
              </span>
            </span>
          </label>
          <p className="text-[12px] text-fg-muted" data-testid="interchange-verification-note">
            Tested against OpenReel's own importer and spec validators; round-trip in other NLEs not yet verified.
          </p>
          <p className="rounded-md border border-border bg-bg-2 p-3 text-[12px] text-fg-muted" data-testid="interchange-aaf-note">
            <span className="font-medium text-fg">AAF: </span>
            {AAF_DECISION.summary} It carries clips, speed, dissolves, levels and markers, but not effects, nested sequences or embedded media.
          </p>
        </div>
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={confirm} data-testid="interchange-export-confirm">
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
