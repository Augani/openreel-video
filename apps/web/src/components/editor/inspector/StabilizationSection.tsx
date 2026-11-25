import React, { useSyncExternalStore } from "react";
import { Button, Card, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { Video, X } from "@/icons/lucide-compat";
import {
  DEFAULT_WARP_SETTINGS,
  ROLLING_SHUTTER_LABELS,
  ROLLING_SHUTTER_MODES,
  WARP_FRAMINGS,
  WARP_FRAMING_LABELS,
  WARP_METHODS,
  WARP_METHOD_LABELS,
  WARP_RESULTS,
  WARP_RESULT_LABELS,
  getWarpRegistry,
  isWarpAnalysis,
  normalizeWarpSettings,
  type Clip,
  type WarpSettings,
} from "@openreel/core";
import { PropertySlider } from "./shell/PropertySlider";
import { InspectorToggle } from "./shell/InspectorControls";
import {
  cancelWarpAnalysis,
  setWarpEnabled,
  startWarpStabilizer,
  updateWarpSettings,
  warpAnalysisCovers,
} from "../../../services/warp-stabilizer-service";

interface StabilizationSectionProps {
  clip: Clip;
}

const subscribe = (listener: () => void): (() => void) => getWarpRegistry().subscribe(listener);

function Choice<T extends string>({ label, value, values, labels, onChange, disabled }: {
  label: string;
  value: T;
  values: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Label className="block space-y-1.5 text-xs font-normal text-fg-2">
      <span>{label}</span>
      <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger aria-label={label} className="h-[30px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {values.map((option) => <SelectItem key={option} value={option}>{labels[option]}</SelectItem>)}
        </SelectContent>
      </Select>
    </Label>
  );
}

export const StabilizationSection: React.FC<StabilizationSectionProps> = ({ clip }) => {
  const job = useSyncExternalStore(subscribe, () => getWarpRegistry().getJob(clip.id));
  const stabilization = clip.stabilization;
  const analysed = Boolean(stabilization?.warpAnalysis && isWarpAnalysis(stabilization.warpAnalysis));
  const busy = job.status === "analysing" || job.status === "stabilizing";
  const enabled = Boolean(stabilization?.enabled && analysed);
  const warp = normalizeWarpSettings(stabilization?.warp ?? DEFAULT_WARP_SETTINGS);
  const stale = enabled && !warpAnalysisCovers(clip);
  const cropping = warp.framing === "stabilizeCrop" || warp.framing === "stabilizeCropAutoScale";
  const set = (patch: Partial<WarpSettings>) => updateWarpSettings(clip.id, patch);
  const percent = job.status === "analysing" ? Math.round(job.progress * 100) : 100;

  return (
    <div className="space-y-3" data-testid="warp-stabilizer">
      <div className="flex items-center justify-between">
        <span className="text-fg font-normal flex items-center gap-2 text-sm">
          <Video className="h-4 w-4" />
          Warp Stabilizer
        </span>
        <InspectorToggle
          ariaLabel="Enable Warp Stabilizer"
          checked={enabled || busy}
          onChange={(next) => setWarpEnabled(clip.id, next)}
        />
      </div>

      {busy && (
        <Card
          role="status"
          aria-label="Stabilizer status"
          className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 space-y-1"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-2 font-normal text-xs">
              {job.status === "analysing" ? `Analysing in background (step 1 of 2) ${percent}%` : "Stabilizing (step 2 of 2)"}
            </span>
            <Button
              type="button"
              aria-label="Cancel stabilizer analysis"
              className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-border bg-bg-2 px-2 text-[11px] text-fg-2 hover:bg-bg-3 hover:text-fg"
              onClick={() => cancelWarpAnalysis(clip.id)}
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
        </Card>
      )}

      {job.status === "failed" && !busy && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 border border-destructive/50 bg-destructive/10">
          <span className="font-normal text-[11px] text-destructive">{job.message}</span>
        </Card>
      )}

      {stale && !busy && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-center justify-between gap-2 border border-border/60 bg-muted/40">
          <span className="text-fg-2 font-normal text-[11px]">The trim changed since the analysis.</span>
          <Button
            type="button"
            aria-label="Analyse again"
            className="h-6 rounded-[6px] border border-border bg-bg-2 px-2 text-[11px] text-fg-2 hover:bg-bg-3 hover:text-fg"
            onClick={() => void startWarpStabilizer(clip.id)}
          >
            Analyse again
          </Button>
        </Card>
      )}

      {enabled && (
        <fieldset className="min-w-0 space-y-3 border-0 p-0" disabled={busy}>
          <Choice label="Result" value={warp.result} values={WARP_RESULTS} labels={WARP_RESULT_LABELS} onChange={(result) => set({ result })} />
          {warp.result === "smoothMotion" && (
            <PropertySlider
              label="Smoothness"
              value={warp.smoothness}
              min={0}
              max={100}
              step={1}
              defaultValue={DEFAULT_WARP_SETTINGS.smoothness}
              onChange={(smoothness) => set({ smoothness })}
              formatValue={(value) => `${Math.round(value)}%`}
            />
          )}
          <Choice label="Method" value={warp.method} values={WARP_METHODS} labels={WARP_METHOD_LABELS} onChange={(method) => set({ method })} />
          <Choice label="Framing" value={warp.framing} values={WARP_FRAMINGS} labels={WARP_FRAMING_LABELS} onChange={(framing) => set({ framing })} />
          {cropping && (
            <PropertySlider
              label="Crop Less / Smooth More"
              value={warp.cropLessSmoothMore}
              min={0}
              max={100}
              step={1}
              defaultValue={DEFAULT_WARP_SETTINGS.cropLessSmoothMore}
              onChange={(cropLessSmoothMore) => set({ cropLessSmoothMore })}
              formatValue={(value) => `${Math.round(value)}%`}
            />
          )}
          <Choice
            label="Rolling Shutter Ripple"
            value={warp.rollingShutter}
            values={ROLLING_SHUTTER_MODES}
            labels={ROLLING_SHUTTER_LABELS}
            onChange={(rollingShutter) => set({ rollingShutter })}
          />
          <p className="text-[10px] text-fg-3">
            {warp.framing === "synthesizeEdges"
              ? "Fills the empty borders with picture from neighbouring frames."
              : cropping
                ? "Smoothing gives way before the crop passes the budget set by Crop Less / Smooth More."
                : "Borders the correction uncovers stay empty."}
          </p>
        </fieldset>
      )}
    </div>
  );
};
