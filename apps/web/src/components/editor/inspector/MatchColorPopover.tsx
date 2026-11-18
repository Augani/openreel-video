import React, { useMemo, useRef, useState } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@openreel/ui";
import { Palette } from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useColorMonitorStore } from "../../../stores/color-monitor-store";
import { grabStill } from "../../../services/comparison-service";
import {
  applyColorMatchToGrade,
  measureColorMatch,
  type ColorMatchMeasurement,
} from "../../../services/color-sampling";
import { toast } from "../../../stores/notification-store";

interface MatchColorPopoverProps {
  clipId: string;
}

interface Baseline {
  hsl: ReturnType<ReturnType<typeof useProjectStore.getState>["getColorGrading"]>["hsl"];
  tone: ReturnType<ReturnType<typeof useProjectStore.getState>["getColorGrading"]>["tone"];
}

/** A time inside `clip` for sampling: the playhead when it is over the clip, else its middle. */
function sampleTime(clip: { startTime: number; duration: number }, playhead: number): number {
  const inside = playhead >= clip.startTime && playhead <= clip.startTime + clip.duration;
  return inside ? playhead : clip.startTime + clip.duration / 2;
}

/**
 * Match Color: pick a reference clip (the reference frame is its playhead frame,
 * or its middle when the playhead is elsewhere), match this clip to it, and
 * review Before/After in the Program monitor comparison view. The intensity
 * slider re-applies the match live.
 */
export const MatchColorPopover: React.FC<MatchColorPopoverProps> = ({ clipId }) => {
  const project = useProjectStore((state) => state.project);
  const updateColorGrading = useProjectStore((state) => state.updateColorGrading);
  const [open, setOpen] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [intensity, setIntensity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const measurement = useRef<ColorMatchMeasurement | null>(null);
  const baseline = useRef<Baseline | null>(null);

  const candidates = useMemo(
    () =>
      project.timeline.tracks
        .filter((track) => track.type === "video" || track.type === "image")
        .flatMap((track) => track.clips)
        .filter((clip) => clip.id !== clipId)
        .map((clip) => ({
          clip,
          name: project.mediaLibrary.items.find((item) => item.id === clip.mediaId)?.name ?? clip.id,
        })),
    [project, clipId],
  );
  const selectedReference = candidates.find((candidate) => candidate.clip.id === referenceId)?.clip;

  const apply = async (amount: number): Promise<void> => {
    if (!measurement.current || !baseline.current) return;
    await updateColorGrading(clipId, applyColorMatchToGrade(baseline.current, measurement.current, amount));
  };

  const runMatch = async (): Promise<void> => {
    const target = useProjectStore.getState().getClip(clipId);
    if (!selectedReference || !target) return;
    setBusy(true);
    try {
      const playhead = useTimelineStore.getState().playheadPosition;
      const measured = await measureColorMatch(
        sampleTime(selectedReference, playhead),
        sampleTime(target, playhead),
      );
      if (!measured) {
        toast.error("Could not match color", "Pause playback and make sure both clips have a visible frame.");
        return;
      }
      measurement.current = measured;
      const current = useProjectStore.getState().getColorGrading(clipId);
      baseline.current = { hsl: current.hsl, tone: current.tone };
      // The "before" picture for the comparison view is the frame as it looks right now.
      const before = await grabStill({ label: "Before match" });
      await apply(intensity);
      setApplied(true);
      if (before) {
        useColorMonitorStore.getState().setComparison({ mode: "split-v", reference: "still", stillId: before.id });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label="Match Color…"
          className="h-7 gap-1 rounded-[7px] border border-border bg-bg-2 px-2 text-[10px] font-semibold text-fg-2 hover:bg-bg-3 hover:text-fg"
        >
          <Palette size={11} aria-hidden />
          <span>Match Color…</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" aria-label="Match Color" className="w-[min(280px,calc(100vw-32px))] space-y-3 p-3">
        <p className="text-[10px] leading-snug text-fg-2">
          Match this clip to a reference clip. The reference frame is taken at the playhead when it is over that clip, otherwise from its middle.
        </p>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-fg-2">Reference clip</span>
          <select
            aria-label="Reference clip"
            value={referenceId}
            onChange={(event) => {
              setReferenceId(event.target.value);
              measurement.current = null;
              setApplied(false);
            }}
            className="h-7 w-full rounded-[6px] border border-border bg-bg-1 px-1.5 text-[11px] text-fg"
          >
            <option value="">Select a clip…</option>
            {candidates.map(({ clip, name }) => (
              <option key={clip.id} value={clip.id}>
                {name} ({clip.startTime.toFixed(1)}s)
              </option>
            ))}
          </select>
        </label>
        <PropertySlider
          label="Intensity"
          ariaLabel="Match intensity"
          value={intensity}
          min={0}
          max={1}
          step={0.01}
          defaultValue={1}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => {
            setIntensity(value);
            if (applied) void apply(value);
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            disabled={!selectedReference || busy}
            aria-label="Apply match"
            onClick={() => void runMatch()}
            className="h-7 rounded-[7px] bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Matching…" : applied ? "Match again" : "Match"}
          </Button>
          {applied ? (
            <span className="text-[10px] text-fg-3" role="status">Applied. Before/After split is on in the Program monitor.</span>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
