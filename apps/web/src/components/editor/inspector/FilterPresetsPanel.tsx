import React, { useState, useCallback, useMemo } from "react";
import { Film, Camera, Moon, Palette, Wand2, Check } from "lucide-react";
import { Slider } from "@openreel/ui";
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
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isApplied,
  onApply,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onApply}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative w-full p-3 rounded-lg border transition-all text-left ${
        isApplied
          ? "border-primary bg-primary/10"
          : "border-border bg-background-tertiary hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-text-primary">
              {preset.name}
            </span>
            {isApplied && <Check size={12} className="text-primary" />}
          </div>
          <p className="text-[9px] text-text-muted mt-0.5">
            {preset.description}
          </p>
        </div>
      </div>
      <div className="mt-2 flex gap-1 flex-wrap">
        {preset.effects.slice(0, 3).map((effect, index) => (
          <span
            key={index}
            className="px-1.5 py-0.5 text-[8px] bg-background-secondary rounded text-text-muted"
          >
            {effect.type}
          </span>
        ))}
        {preset.effects.length > 3 && (
          <span className="px-1.5 py-0.5 text-[8px] bg-background-secondary rounded text-text-muted">
            +{preset.effects.length - 3}
          </span>
        )}
      </div>
      {isHovered && !isApplied && (
        <div className="absolute inset-0 flex items-center justify-center bg-background-tertiary/80 rounded-lg">
          <span className="text-[10px] text-primary font-medium">
            Click to Apply
          </span>
        </div>
      )}
    </button>
  );
};

interface FilterPresetsPanelProps {
  clipId?: string;
}

export const FilterPresetsPanel: React.FC<FilterPresetsPanelProps> = ({
  clipId,
}) => {
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const addVideoEffect = useProjectStore((state) => state.addVideoEffect);
  const getVideoEffects = useProjectStore((state) => state.getVideoEffects);
  const removeVideoEffect = useProjectStore((state) => state.removeVideoEffect);

  const [selectedCategory, setSelectedCategory] =
    useState<FilterCategory>("cinematic");
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);
  const [intensityValue, setIntensityValue] = useState(100);

  const targetClipId = clipId || selectedClipIds[0];
  const presets = useMemo(
    () => getPresetsByCategory(selectedCategory),
    [selectedCategory],
  );

  const handleApplyPreset = useCallback(
    (preset: FilterPreset) => {
      if (!targetClipId) return;

      const existingEffects = getVideoEffects(targetClipId);
      existingEffects.forEach((effect) => {
        removeVideoEffect(targetClipId, effect.id);
      });

      preset.effects.forEach((filterEffect) => {
        addVideoEffect(targetClipId, filterEffect.type, filterEffect.params);
      });

      setAppliedPresetId(preset.id);
      toast.success("Filter Applied", `${preset.name} preset applied`);
    },
    [targetClipId, addVideoEffect, getVideoEffects, removeVideoEffect],
  );

  const handleClearEffects = useCallback(() => {
    if (!targetClipId) return;

    const existingEffects = getVideoEffects(targetClipId);
    existingEffects.forEach((effect) => {
      removeVideoEffect(targetClipId, effect.id);
    });

    setAppliedPresetId(null);
    toast.info("Effects Cleared");
  }, [targetClipId, getVideoEffects, removeVideoEffect]);

  if (!targetClipId) {
    return (
      <div className="p-4 text-center">
        <Palette size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-[10px] text-text-muted">
          Select a video clip to apply filters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Palette size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Filter Presets
          </span>
          <p className="text-[9px] text-text-muted">One-click color grades</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTER_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id] || Palette;
          return (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id as FilterCategory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon size={12} />
              {category.name}
            </button>
          );
        })}
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isApplied={appliedPresetId === preset.id}
            onApply={() => handleApplyPreset(preset)}
          />
        ))}
      </div>

      {appliedPresetId && (
        <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">Intensity</span>
            <span className="text-[10px] font-mono text-text-primary">
              {intensityValue}%
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[intensityValue]}
            onValueChange={(value) => setIntensityValue(value[0])}
          />
          <button
            onClick={handleClearEffects}
            className="w-full py-2 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg transition-colors"
          >
            Remove All Effects
          </button>
        </div>
      )}

      <p className="text-[9px] text-text-muted text-center">
        {FILTER_PRESETS.length} presets across {FILTER_CATEGORIES.length}{" "}
        categories
      </p>
    </div>
  );
};

export default FilterPresetsPanel;
