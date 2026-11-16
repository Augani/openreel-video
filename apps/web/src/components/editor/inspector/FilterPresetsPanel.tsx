import React, { useState, useCallback, useMemo, useRef } from "react";
import { Button, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";


import { PropertySlider } from "./shell/PropertySlider";
import { Film, Camera, Moon, Palette, Wand2, Check } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import {
  FILTER_PRESETS,
  FILTER_CATEGORIES,
  getPresetsByCategory,
  type FilterPreset,
  type FilterCategory,
} from "@openreel/core";
import { applyFilterPreset, clearFilterEffects, resolveFilterPreset, setFilterPresetIntensity, type FilterPresetSelection } from "../../../services/filter-preset-application";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  cinematic: Film,
  vintage: Camera,
  mood: Moon,
  color: Palette,
  stylized: Wand2,
};

interface PresetCardProps {
  preset: FilterPreset;
  isApplied: boolean;
  onApply: () => void;
  disabled: boolean;
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isApplied,
  onApply,
  disabled,
}) => {
  return (
    <Button variant="ghost" onClick={onApply} disabled={disabled} type="button" aria-label={`Apply ${preset.name} filter preset`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `relative w-full p-3 rounded-lg border transition-all text-left ${
        isApplied
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/50"
      }`)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] leading-5 text-fg font-medium">
              {preset.name}
            </span>
            {isApplied && <Check size={12} className="text-primary" />}
          </div>
          <span className="text-fg-2 font-normal block mt-0.5 text-[9px]">
            {preset.description}
          </span>
        </div>
      </div>
      <div className="mt-2 flex gap-1 flex-wrap">
        {preset.effects.slice(0, 3).map((effect, index) => (
          <span key={index} className="font-normal px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            {effect.type}
          </span>
        ))}
        {preset.effects.length > 3 && (
          <span className="font-normal px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            +{preset.effects.length - 3}
          </span>
        )}
      </div>
    </Button>
  );
};

interface FilterPresetsPanelProps {
  clipId?: string;
}

export const FilterPresetsPanel: React.FC<FilterPresetsPanelProps> = ({
  clipId,
}) => {
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const project = useProjectStore((state) => state.project);

  const [selectedCategory, setSelectedCategory] =
    useState<FilterCategory>("cinematic");
  const [selection, setSelection] = useState<(FilterPresetSelection & { scope: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const changingPreset = useRef(false);

  const targetClipId = clipId || selectedClipIds[0];
  const targetTrack = project.timeline.tracks.find(track => track.clips.some(clip => clip.id === targetClipId));
  const targetClip = targetTrack?.clips.find(clip => clip.id === targetClipId);
  const mediaType = project.mediaLibrary.items.find(item => item.id === targetClip?.mediaId)?.type;
  const scope = `${project.id}:${targetClipId}`;
  const applied = useMemo(() => targetClip
    ? resolveFilterPreset(targetClip.effects.map((effect, order) => ({ ...effect, type: effect.type as FilterPreset["effects"][number]["type"], order })), selection?.scope === scope ? selection : null)
    : null, [targetClip, selection, scope]);
  const presets = useMemo(
    () => getPresetsByCategory(selectedCategory),
    [selectedCategory],
  );

  const handleApplyPreset = useCallback(
    async (preset: FilterPreset) => {
      if (!targetClipId || changingPreset.current) return;
      changingPreset.current = true;
      setBusy(true);
      try {
        const result = await applyFilterPreset(project.id, targetClipId, preset);
        setSelection({ ...result, scope });
        toast.success("Filter Applied", `${preset.name} preset applied`);
      } catch (error) {
        toast.error("Filter not applied", error instanceof Error ? error.message : "Please try again.");
      } finally {
        changingPreset.current = false;
        setBusy(false);
      }
    },
    [targetClipId, project.id, scope],
  );

  const handleClearEffects = useCallback(async () => {
    if (!targetClipId || changingPreset.current) return;
    changingPreset.current = true;
    setBusy(true);
    try {
      await clearFilterEffects(project.id, targetClipId);
      setSelection(null);
      toast.info("Effects Cleared");
    } catch (error) {
      toast.error("Effects not removed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      changingPreset.current = false;
      setBusy(false);
    }
  }, [targetClipId, project.id]);

  const handleIntensity = useCallback(async (value: number) => {
    if (!targetClipId || !applied || changingPreset.current) return;
    try {
      await setFilterPresetIntensity(project.id, targetClipId, applied, value);
    } catch (error) {
      toast.error("Filter intensity not changed", error instanceof Error ? error.message : "Please try again.");
    }
  }, [targetClipId, project.id, applied]);

  if (!targetClip || (mediaType !== "video" && mediaType !== "image")) {
    return (
      <div className="p-4 text-center">
        <Palette size={24} className="mx-auto mb-2 text-fg-3" />
        <span className="text-[12px] leading-5 text-fg-2 font-normal">
          Select a video or image clip to apply filters
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Palette size={16} className="text-primary" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] leading-5 text-fg font-medium block">
            Filter Presets
          </span>
          <span className="text-fg-2 font-normal block text-[9px]">
            One-click color grades
          </span>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTER_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id] || Palette;
          return (
            <Button key={category.id} onClick={() => setSelectedCategory(category.id as FilterCategory)} type="button" aria-label={(category.name).trim() || undefined} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (selectedCategory === category.id ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"), `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-bg-2 text-fg-2 hover:text-fg"
              }`)}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Icon size={12} aria-hidden />}</span>
              {(category.name) ? <span className="truncate">{category.name}</span> : null}
            </Button>
          );
        })}
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isApplied={applied?.presetId === preset.id}
            onApply={() => handleApplyPreset(preset)}
            disabled={busy || !!targetTrack?.locked}
          />
        ))}
      </div>

      {applied && (
        <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
          <PropertySlider
            label="Intensity"
            min={0}
            max={100}
            step={1}
            value={applied.intensity}
            onChange={handleIntensity}
            isDisabled={busy || !!targetTrack?.locked}
            formatValue={(value) => `${value}%`}
          />
          <Button onClick={handleClearEffects} disabled={busy || !!targetTrack?.locked} type="button" aria-label="Remove All Effects" className="inline-flex min-w-0 items-center justify-center gap-1.5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 hover:bg-status-error/90 w-full py-2 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg transition-colors">
            <span className="truncate">{"Remove All Effects"}</span>
          </Button>
        </Card>
      )}

      <span className="text-fg-2 font-normal text-center text-[9px]">
        {FILTER_PRESETS.length} presets across {FILTER_CATEGORIES.length}{" "}
        categories
      </span>
    </div>
  );
};

