import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openreel/ui";
import type { TimelineImportMode } from "@openreel/core/interchange/index";
import { toast } from "../../stores/notification-store";
import { commitTimelineImport, useTimelineImportStore } from "../../services/timeline-interchange";

const FORMAT_NAMES: Record<string, string> = {
  xmeml: "Final Cut Pro XML",
  fcpxml: "FCPXML",
  otio: "OpenTimelineIO",
  aaf: "AAF",
};

const MODES: { id: TimelineImportMode; label: string; hint: string }[] = [
  { id: "replace", label: "Replace the timeline", hint: "Swaps unlocked video and audio tracks and markers. Locked tracks, titles and graphics stay." },
  { id: "append", label: "Add as new tracks", hint: "Keeps everything and adds the imported tracks alongside." },
];

export function TimelineImportDialog() {
  const preview = useTimelineImportStore((s) => s.preview);
  const setPreview = useTimelineImportStore((s) => s.setPreview);
  const [mode, setMode] = useState<TimelineImportMode>("replace");
  const [busy, setBusy] = useState(false);
  if (!preview) return null;
  const { result } = preview;
  const close = () => {
    if (!busy) setPreview(null);
  };
  const apply = async () => {
    setBusy(true);
    try {
      const outcome = await commitTimelineImport(result, mode);
      if (outcome.success) {
        toast.success("Timeline imported", `${result.clipCount} clips. Undo (⌘Z) reverts the whole import.`);
        setPreview(null);
      } else {
        toast.error("Could not import the timeline", outcome.message);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        aria-describedby="timeline-import-desc"
        className="flex max-h-[90dvh] w-[calc(100vw-32px)] max-w-[520px] flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-[15px] font-semibold text-fg">Import timeline</DialogTitle>
          <DialogDescription id="timeline-import-desc" className="text-[12px] text-fg-muted">
            {preview.filename} · {FORMAT_NAMES[result.format]} · {result.sequenceName}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 text-[13px]" data-testid="timeline-import-report">
          <p>
            <span data-testid="import-clip-count">{result.clipCount}</span> clips on{" "}
            <span data-testid="import-track-count">{result.tracks.length}</span> tracks,{" "}
            {result.markers.length} markers. {result.matched.length} media files matched the media bin by filename.{result.nests && result.nests.length > 0 && (<span data-testid="import-nest-count"> {result.nests.length} compound {result.nests.length === 1 ? "clip" : "clips"} will be added as nested sequences.</span>)}{result.multicamSources && result.multicamSources.length > 0 && (<span data-testid="import-multicam-count"> {result.multicamSources.length} multi-camera {result.multicamSources.length === 1 ? "source" : "sources"} will be rebuilt with their angles.</span>)}
          </p>
          {result.unmatched.length > 0 && (
            <div role="alert" className="rounded-md border border-border bg-bg-2 p-3" data-testid="import-unmatched">
              <p className="font-medium">{result.unmatched.length} media files not in the bin</p>
              <p className="mt-1 text-[12px] text-fg-muted">
                They are added as offline placeholders; relink them from the media panel.
              </p>
              <ul className="mt-2 list-disc pl-5 text-[12px]">
                {result.unmatched.map((u) => (
                  <li key={u.name}>
                    {u.name} ({u.clipCount} {u.clipCount === 1 ? "clip" : "clips"})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-[12px] text-fg-muted">
              {result.warnings.map((w, i) => (
                <li key={`${i}-${w}`}>{w}</li>
              ))}
            </ul>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Where should it go?</legend>
            {MODES.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="timeline-import-mode"
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                  className="mt-1"
                />
                <span>
                  {m.label}
                  <span className="block text-[12px] text-fg-muted">{m.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={busy || result.clipCount === 0}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
