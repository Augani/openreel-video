import React, { useState, useCallback, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
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
import { useTranslation } from "react-i18next";

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
  return (
    <ClickableCard
      label={`Apply ${preset.name} filter preset`}
      onClick={onApply}
      className={`relative w-full p-3 rounded-lg border transition-all text-left ${
        isApplied
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Text type="supporting" color="primary" weight="medium">
              {preset.name}
            </Text>
            {isApplied && <Check size={12} className="text-primary" />}
          </div>
          <Text type="supporting" color="secondary" display="block" className="mt-0.5 text-[9px]">
            {preset.description}
          </Text>
        </div>
      </div>
      <div className="mt-2 flex gap-1 flex-wrap">
        {preset.effects.slice(0, 3).map((effect, index) => (
          <Text
            key={index}
            type="supporting"
            color="secondary"
            className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            {effect.type}
          </Text>
        ))}
        {preset.effects.length > 3 && (
          <Text
            type="supporting"
            color="secondary"
            className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            +{preset.effects.length - 3}
          </Text>
        )}
      </div>
    </ClickableCard>
  );
};

interface FilterPresetsPanelProps {
  clipId?: string;
}

export const FilterPresetsPanel: React.FC<FilterPresetsPanelProps> = ({
  clipId,
}) => {
  const { t } = useTranslation();
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
    async (preset: FilterPreset) => {
      if (!targetClipId) return;

      const existingEffects = getVideoEffects(targetClipId);
      for (const effect of existingEffects) {
        await removeVideoEffect(targetClipId, effect.id);
      }

      for (const filterEffect of preset.effects) {
        await addVideoEffect(
          targetClipId,
          filterEffect.type,
          filterEffect.params,
        );
      }

      setAppliedPresetId(preset.id);
      toast.success("Filter Applied", `${preset.name} preset applied`);
    },
    [targetClipId, addVideoEffect, getVideoEffects, removeVideoEffect],
  );

  const handleClearEffects = useCallback(async () => {
    if (!targetClipId) return;

    const existingEffects = getVideoEffects(targetClipId);
    for (const effect of existingEffects) {
      await removeVideoEffect(targetClipId, effect.id);
    }

    setAppliedPresetId(null);
    toast.info("Effects Cleared");
  }, [targetClipId, getVideoEffects, removeVideoEffect]);

  if (!targetClipId) {
    return (
      <div className="p-4 text-center">
        <Palette size={24} className="mx-auto mb-2 text-fg-3" />
        <Text type="supporting" color="secondary">
          {t("Select a video clip to apply filters")}</Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Palette size={16} className="text-primary" />
        <div className="flex flex-col gap-0.5">
          <Text type="supporting" color="primary" weight="medium" display="block">
            {t("Filter Presets")}</Text>
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">
            {t("One-click color grades")}</Text>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTER_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id] || Palette;
          return (
            <Button
              key={category.id}
              label={t(category.name)}
              size="sm"
              variant={selectedCategory === category.id ? "primary" : "secondary"}
              icon={<Icon size={12} aria-hidden />}
              onClick={() => setSelectedCategory(category.id as FilterCategory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-bg-2 text-fg-2 hover:text-fg"
              }`}
            />
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
        <Card variant="muted" padding={3} className="space-y-3">
          <PropertySlider
            label={t("Intensity")}
            min={0}
            max={100}
            step={1}
            value={intensityValue}
            onChange={setIntensityValue}
            formatValue={(value) => `${value}%`}
          />
          <Button
            label={t("Remove All Effects")}
            size="sm"
            variant="destructive"
            onClick={handleClearEffects}
            className="w-full py-2 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg transition-colors"
          />
        </Card>
      )}

      <Text type="supporting" color="secondary" className="text-center text-[9px]">
        {FILTER_PRESETS.length} {t(" presets across ")}{FILTER_CATEGORIES.length}{" "}
        {t("categories")}</Text>
    </div>
  );
};

export default FilterPresetsPanel;
