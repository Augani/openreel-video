import React from "react";
import { useShallow } from "zustand/react/shallow";
import { Label, ToggleGroup, ToggleGroupItem, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { SVG_ANIMATION_PRESETS, type GraphicAnimation, type GraphicAnimationType, type SVGClip } from "@openreel/core";
import { ColorSelector } from "../../../motion/components/primitives";

export const SVGSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const { project, getSVGClipById } = useProjectStore(useShallow(state => ({ project: state.project, getSVGClipById: state.getSVGClipById })));
  const exporting = useUIStore(state => state.exportState.isExporting);
  const operationLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const svgClip = getSVGClipById(clipId);
  if (!svgClip) return <span className="py-8 text-center text-xs text-fg-2">No SVG clip selected</span>;
  const colorStyle = svgClip.colorStyle ?? { colorMode: "none" as const, tintColor: "#ffffff", tintOpacity: 1 };
  const disabled = exporting || operationLocked || !project.timeline.tracks.some(track => track.id === svgClip.trackId && !track.locked);
  const update = (updates: Parameters<ReturnType<typeof useProjectStore.getState>["updateSVGClip"]>[1]) => {
    const state = useProjectStore.getState();
    const current = state.getSVGClipById(clipId);
    if (!current || state.project.id !== project.id || useUIStore.getState().exportState.isExporting
      || useTimelineStore.getState().playbackLockedReason
      || !state.project.timeline.tracks.some(track => track.id === current.trackId && !track.locked)) return;
    state.updateSVGClip(clipId, updates);
  };
  const updateColor = (changes: Partial<NonNullable<SVGClip["colorStyle"]>>) => {
    update({ colorStyle: { ...colorStyle, ...useProjectStore.getState().getSVGClipById(clipId)?.colorStyle, ...changes } });
  };
  const updateAnimation = (side: "entry" | "exit", changes: Partial<GraphicAnimation>) => {
    const key = side === "entry" ? "entryAnimation" : "exitAnimation";
    const current = useProjectStore.getState().getSVGClipById(clipId)?.[key];
    const animation: GraphicAnimation = { type: "none", duration: .5, easing: "ease-out", ...current, ...changes };
    update({ [key]: animation });
  };
  return <fieldset key={`${project.id}:${clipId}`} disabled={disabled} className="min-w-0 space-y-4 border-0 p-0">
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-fg-2">Mode</span>
        <ToggleGroup type="single" value={colorStyle.colorMode} aria-label="SVG color mode"
          onValueChange={mode => { if (mode === "none" || mode === "tint" || mode === "replace") updateColor({ colorMode: mode }); }}>
          {(["none", "tint", "replace"] as const).map(mode => <ToggleGroupItem key={mode} value={mode} className="h-[30px] px-2 text-xs capitalize">{mode}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      {colorStyle.colorMode !== "none" && <>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-2">Color</span>
          <div className="max-w-[170px]"><ColorSelector label="Select color" value={colorStyle.tintColor ?? "#ffffff"} onChange={tintColor => updateColor({ tintColor })} /></div>
        </div>
        <PropertySlider label="Opacity" value={colorStyle.tintOpacity ?? 1} onChange={tintOpacity => updateColor({ tintOpacity })}
          min={0} max={1} step={.1} formatValue={value => `${Math.round(value * 100)}%`} isDisabled={disabled} />
      </>}
    </div>
    {(["entry", "exit"] as const).map(side => {
      const animation = side === "entry" ? svgClip.entryAnimation : svgClip.exitAnimation;
      const label = side === "entry" ? "Entry Animation" : "Exit Animation";
      return <div key={side} className="space-y-3">
        <Label className="block space-y-1.5 text-xs font-normal text-fg-2">
          <span>{label}</span>
          <Select value={animation?.type ?? "none"} disabled={disabled} onValueChange={type => updateAnimation(side, { type: type as GraphicAnimationType })}>
            <SelectTrigger aria-label={label} className="h-[30px] min-w-0 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{SVG_ANIMATION_PRESETS.map(preset => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        {animation && animation.type !== "none" && <PropertySlider label="Duration" ariaLabel={`SVG ${side} duration`}
          value={animation.duration} onChange={duration => updateAnimation(side, { duration })}
          min={.1} max={3} step={.1} formatValue={value => `${value.toFixed(1)}s`} isDisabled={disabled} />}
      </div>;
    })}
  </fieldset>;
};
