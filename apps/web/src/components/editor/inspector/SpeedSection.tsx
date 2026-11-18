import React, { useRef, useState } from "react";
import { Button, Card, Input, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, cn } from "@openreel/ui";
import { RotateCcw, Sparkles } from "@/icons/lucide-compat";
import { SPEED_MIN, SPEED_MAX, type Clip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { editClipSpeed, linkedSpeedClipIds, type ClipSpeedChange } from "../../../services/clip-speed-edit";
import { useNumericDraft } from "./shell/useNumericDraft";
import { formatSpeed } from "../../../utils/format-speed";
import { InspectorToggle } from "./shell/InspectorControls";
import { trackEditorDraftWrite } from "../../../services/editor-field-drafts";
import { toast } from "../../../stores/notification-store";

const SPEED_PRESETS = [
  { label: "0.25×", value: 0.25 },
  { label: "0.5×", value: 0.5 },
  { label: "0.75×", value: 0.75 },
  { label: "1×", value: 1 },
  { label: "1.25×", value: 1.25 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
  { label: "3×", value: 3 },
  { label: "5×", value: 5 },
];

export const SpeedSection: React.FC<{ clip: Pick<Clip, "id"> }> = ({ clip }) => {
  const project = useProjectStore(state => state.project);
  const current = project.timeline.tracks.flatMap(track => track.clips).find(item => item.id === clip.id);
  if (!current) return <p className="text-xs text-fg-2">No media clip selected</p>;
  return <SpeedControls key={`${project.id}:${clip.id}`} clip={current} projectId={project.id} />;
};

function SpeedControls({ clip, projectId }: { clip: Clip; projectId: string }) {
  const [affectAudio, setAffectAudio] = useState(true);
  const queue = useRef(Promise.resolve());
  const exporting = useUIStore(state => state.exportState.isExporting);
  const operationLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const locked = useProjectStore(state => !state.project.timeline.tracks.some(track => track.id === clip.trackId && !track.locked));
  const currentSpeed = clip.speed ?? 1;
  const isReversed = clip.reversed ?? false;
  const disabled = exporting || operationLocked || locked;
  const hasAudio = linkedSpeedClipIds(clip.id).length > 1;
  const enqueue = (change: ClipSpeedChange | ((current: Clip) => ClipSpeedChange)) => {
    const audio = affectAudio;
    const owner = useProjectStore.getState().actionHistory;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (useProjectStore.getState().actionHistory !== owner) return;
      const current = useProjectStore.getState().getClip(clip.id);
      if (!current) return;
      const changes = typeof change === "function" ? change(current) : change;
      const applied = await editClipSpeed(projectId, clip.id, changes, audio);
      if (!applied && useProjectStore.getState().actionHistory === owner) {
        const latest = useProjectStore.getState().getClip(clip.id);
        if (latest && Object.entries(changes).some(([key, value]) => {
          const actual = key === "speed" ? latest.speed ?? 1 : key === "reversed" ? latest.reversed ?? false
            : key === "smoothSlowMo" ? latest.smoothSlowMo ?? false : latest.interpolationQuality ?? "medium";
          return actual !== value;
        })) throw new Error("The speed edit could not be applied. Unlock the clip and finish processing before retrying.");
      }
    });
    trackEditorDraftWrite(queue.current, { projectId, history: owner });
    void queue.current.catch(error => toast.error("Speed edit failed", error instanceof Error ? error.message : "Try the change again."));
    return queue.current;
  };
  const custom = useNumericDraft({ value: currentSpeed, onChange: speed => enqueue({ speed }),
    min: SPEED_MIN, max: SPEED_MAX, step: .1, live: false, format: formatSpeed });
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0">
    <div className="grid grid-cols-3 gap-2">
      {SPEED_PRESETS.map(preset => <Button key={preset.value} type="button" variant="outline"
        aria-label={`Set speed to ${preset.label}`} aria-pressed={currentSpeed === preset.value}
        onClick={() => enqueue({ speed: preset.value })}
        className={cn("h-[30px] rounded-[6px] px-2 text-xs font-medium", currentSpeed === preset.value && "border-accent bg-accent text-accent-fg")}>
        {preset.label}
      </Button>)}
    </div>
    <div className="space-y-2">
      <Label className="flex min-w-0 items-center justify-between gap-3 text-xs font-normal text-fg-2">
        <span>Custom Speed</span>
        <span className="flex h-[30px] w-[120px] min-w-0 items-center gap-1 rounded-[6px] border border-border bg-bg-1 px-2 focus-within:border-accent">
          <Input {...custom} aria-label="Custom Speed" type="text" inputMode="decimal"
            className="h-5 min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[11px] shadow-none focus-visible:ring-0" />
          <span className="text-fg-3">×</span>
        </span>
      </Label>
      <p className="text-[11px] text-fg-3">Range: {SPEED_MIN}× (slowest) to {SPEED_MAX}× (fastest)</p>
    </div>
    {hasAudio && <Card className="flex min-w-0 items-center justify-between rounded-[7px] border-border bg-bg-2 p-3 shadow-none">
      <span className="text-xs text-fg-2">Apply speed to audio</span>
      <InspectorToggle checked={affectAudio} onChange={setAffectAudio} ariaLabel="Apply speed to audio" isDisabled={disabled} />
    </Card>}
    <Button type="button" variant={isReversed ? "default" : "outline"} aria-label={isReversed ? "Reversed" : "Reverse Clip"}
      aria-pressed={isReversed} className="h-[30px] w-full rounded-[6px] text-xs"
      onClick={() => enqueue(current => ({ reversed: !current.reversed }))}><RotateCcw size={14} aria-hidden />{isReversed ? "Reversed" : "Reverse Clip"}</Button>
    {currentSpeed < 1 && <Card className="min-w-0 space-y-2 rounded-[7px] border-border bg-bg-2 p-3 shadow-none">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-fg-2"><Sparkles size={14} aria-hidden />Smooth Slow Motion</span>
        <InspectorToggle ariaLabel="Smooth Slow Motion" checked={clip.smoothSlowMo ?? false}
          onChange={smoothSlowMo => enqueue({ smoothSlowMo })} isDisabled={disabled} />
      </div>
      {clip.smoothSlowMo && <div className="space-y-1.5">
        <Label className="block space-y-1.5 text-xs font-normal text-fg-2"><span>Quality</span>
          <Select value={clip.interpolationQuality ?? "medium"} disabled={disabled}
            onValueChange={value => { if (value === "low" || value === "medium" || value === "high") enqueue({ interpolationQuality: value }); }}>
            <SelectTrigger aria-label="Quality" className="h-[30px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="low">Low (faster)</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High (slower)</SelectItem></SelectContent>
          </Select>
        </Label>
        <p className="text-[10px] text-fg-3">Uses optical flow to generate smooth in-between frames</p>
      </div>}
    </Card>}
    {(currentSpeed !== 1 || isReversed) && <Card className="min-w-0 rounded-[7px] border-border bg-bg-2 p-3 shadow-none">
      <p className="mb-1 text-xs text-fg-2">Current Settings</p>
      <p className="text-sm text-fg">Speed: {formatSpeed(currentSpeed)}× {isReversed && "• Reversed"}{clip.smoothSlowMo && " • Smooth"}</p>
    </Card>}
  </fieldset>;
}
