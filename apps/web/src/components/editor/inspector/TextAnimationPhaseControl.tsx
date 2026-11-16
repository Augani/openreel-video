import { useState } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { resolveTextAnimationPhase, TEXT_ANIMATION_PRESETS, type TextAnimation, type TextAnimationPreset } from "@openreel/core";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { setTextAnimationPhasePreset, updateTextAnimationPhase, type TextAnimationSide } from "../../../services/text-animation-phases";
import { ValueField } from "./PrimaryVideoProperties";

const presetName = (preset: TextAnimationPreset) =>
  (TEXT_ANIMATION_PRESETS.find(item => item.id === preset)?.name ?? preset).replace(/ (In|Out)$/, "");

export function TextAnimationPhaseControl({ clipId, side, animation }: {
  clipId: string;
  side: TextAnimationSide;
  animation: TextAnimation | undefined;
}) {
  const [open, setOpen] = useState(false);
  const entry = side === "entry";
  const selected = animation ? resolveTextAnimationPhase(animation, entry) : undefined;
  const preset = selected?.preset ?? "none";
  const duration = preset === "none" ? 0 : entry ? animation?.inDuration ?? 0 : animation?.outDuration ?? 0;
  const label = entry ? "Entry" : "Exit";
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline">
        {entry ? "In" : "Out"} · {presetName(preset)}<small>{Number(duration.toFixed(3))}s</small>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="workspace-text-animation-phase w-[260px] space-y-3">
      <h3 className="text-sm font-medium">{label} animation</h3>
      <Select value={preset} onValueChange={value => setTextAnimationPhasePreset(clipId, side, value as TextAnimationPreset)}>
        <SelectTrigger aria-label={`${label} animation preset`}><SelectValue /></SelectTrigger>
        <SelectContent>{TEXT_ANIMATION_PRESETS.map(item => <SelectItem key={item.id} value={item.id}>{presetName(item.id)}</SelectItem>)}</SelectContent>
      </Select>
      {preset !== "none" && <div className="flex items-center justify-between gap-3 text-xs">
        <span>Duration</span>
        <ValueField label={`${label} animation duration`} value={duration} min={0} max={5} step={0.1} unit="s"
          onChange={value => updateTextAnimationPhase(clipId, side, preset,
            entry ? value : animation?.inDuration ?? 0,
            entry ? animation?.outDuration ?? 0 : value)} />
      </div>}
      <Button variant="ghost" size="sm" className="w-full" onClick={() => {
        setOpen(false);
        useInspectorNavigationStore.getState().requestSection("text-animation", clipId);
      }}>Advanced animation controls</Button>
    </PopoverContent>
  </Popover>;
}
