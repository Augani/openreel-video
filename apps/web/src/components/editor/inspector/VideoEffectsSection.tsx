import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  RotateCcw,
  Eye,
  EyeOff,
  GripVertical,
} from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import type {
  VideoEffect,
  VideoEffectType,
} from "../../../bridges/effects-bridge";
import {
  LabeledSlider,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@openreel/ui";

const EffectSlider = LabeledSlider;

const EffectItem: React.FC<{
  effect: VideoEffect;
  onUpdate: (effectId: string, params: Record<string, unknown>) => void;
  onToggle: (effectId: string, enabled: boolean) => void;
  onRemove: (effectId: string) => void;
}> = ({ effect, onUpdate, onToggle, onRemove }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(true);

  const effectLabels: Record<VideoEffectType, string> = {
    brightness: "inspector.brightness",
    contrast: "inspector.contrast",
    saturation: "inspector.saturation",
    hue: "inspector.hue",
    blur: "inspector.blur",
    sharpen: "inspector.sharpen",
    vignette: "inspector.vignette",
    grain: "inspector.filmGrain",
    temperature: "inspector.temperature",
    tint: "inspector.tint",
    tonal: "inspector.tonal",
    chromaKey: "inspector.chromaKey",
    shadow: "inspector.shadowDrop",
    glow: "inspector.glowFx",
    "motion-blur": "inspector.motionBlur",
    "radial-blur": "inspector.radialBlur",
    "chromatic-aberration": "inspector.chromaticAberration",
  };

  const renderParams = () => {
    switch (effect.type) {
      case "brightness":
        return (
          <EffectSlider
            label={t("inspector.value")}
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "contrast":
        return (
          <EffectSlider
            label={t("inspector.value")}
            value={((effect.params.value as number) || 1) * 100}
            onChange={(v) => onUpdate(effect.id, { value: v / 100 })}
            min={0}
            max={200}
            unit="%"
          />
        );
      case "saturation":
        return (
          <EffectSlider
            label={t("inspector.value")}
            value={((effect.params.value as number) || 1) * 100}
            onChange={(v) => onUpdate(effect.id, { value: v / 100 })}
            min={0}
            max={200}
            unit="%"
          />
        );
      case "blur":
        return (
          <EffectSlider
            label={t("inspector.radius")}
            value={(effect.params.radius as number) || 0}
            onChange={(v) => onUpdate(effect.id, { radius: v })}
            min={0}
            max={100}
            unit="px"
          />
        );
      case "sharpen":
        return (
          <>
            <EffectSlider
              label={t("inspector.amount")}
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={200}
              unit="%"
            />
            <EffectSlider
              label={t("inspector.radius")}
              value={(effect.params.radius as number) || 1}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0.1}
              max={10}
              step={0.1}
            />
          </>
        );
      case "vignette":
        return (
          <>
            <EffectSlider
              label={t("inspector.amount")}
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label={t("inspector.midpoint")}
              value={((effect.params.midpoint as number) || 0.5) * 100}
              onChange={(v) => onUpdate(effect.id, { midpoint: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label={t("inspector.feather")}
              value={((effect.params.feather as number) || 0.3) * 100}
              onChange={(v) => onUpdate(effect.id, { feather: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "grain":
        return (
          <>
            <EffectSlider
              label={t("inspector.amount")}
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label={t("inspector.size")}
              value={(effect.params.size as number) || 1}
              onChange={(v) => onUpdate(effect.id, { size: v })}
              min={0.5}
              max={5}
              step={0.1}
            />
          </>
        );
      case "temperature":
        return (
          <EffectSlider
            label={t("inspector.value")}
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "tint":
        return (
          <EffectSlider
            label={t("inspector.value")}
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "shadow":
        return (
          <>
            <EffectSlider
              label={t("inspector.offsetX")}
              value={(effect.params.offsetX as number) || 5}
              onChange={(v) => onUpdate(effect.id, { offsetX: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("inspector.offsetY")}
              value={(effect.params.offsetY as number) || 5}
              onChange={(v) => onUpdate(effect.id, { offsetY: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("inspector.blur")}
              value={(effect.params.blur as number) || 10}
              onChange={(v) => onUpdate(effect.id, { blur: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("inspector.opacity")}
              value={((effect.params.opacity as number) || 0.8) * 100}
              onChange={(v) => onUpdate(effect.id, { opacity: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "glow":
        return (
          <>
            <EffectSlider
              label={t("inspector.radius")}
              value={(effect.params.radius as number) || 10}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("inspector.intensity")}
              value={((effect.params.intensity as number) || 1) * 100}
              onChange={(v) => onUpdate(effect.id, { intensity: v / 100 })}
              min={0}
              max={300}
              unit="%"
            />
          </>
        );
      case "motion-blur":
        return (
          <>
            <EffectSlider
              label={t("inspector.angle")}
              value={(effect.params.angle as number) || 0}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
            <EffectSlider
              label={t("inspector.distance")}
              value={(effect.params.distance as number) || 20}
              onChange={(v) => onUpdate(effect.id, { distance: v })}
              min={0}
              max={100}
              unit="px"
            />
          </>
        );
      case "radial-blur":
        return (
          <>
            <EffectSlider
              label={t("inspector.amount")}
              value={(effect.params.amount as number) || 20}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label={t("inspector.centerX")}
              value={(effect.params.centerX as number) || 50}
              onChange={(v) => onUpdate(effect.id, { centerX: v })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label={t("inspector.centerY")}
              value={(effect.params.centerY as number) || 50}
              onChange={(v) => onUpdate(effect.id, { centerY: v })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "chromatic-aberration":
        return (
          <>
            <EffectSlider
              label={t("inspector.amount")}
              value={(effect.params.amount as number) || 5}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={50}
              step={0.5}
              unit="px"
            />
            <EffectSlider
              label={t("inspector.angle")}
              value={(effect.params.angle as number) || 0}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`border rounded-lg ${
        effect.enabled ? "border-border" : "border-border/50 opacity-60"
      }`}
    >
      <div className="flex items-center gap-2 p-2 bg-background-tertiary rounded-t-lg">
        <GripVertical size={12} className="text-text-muted cursor-grab" />
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center gap-1 text-left"
        >
          <ChevronDown
            size={12}
            className={`transition-transform ${
              isExpanded ? "" : "-rotate-90"
            } text-text-muted`}
          />
          <span className="text-[10px] font-medium text-text-primary">
            {t(effectLabels[effect.type]) || effect.type}
          </span>
        </button>
        <button
          onClick={() => onToggle(effect.id, !effect.enabled)}
          className="p-1 hover:bg-background-secondary rounded transition-colors"
          title={effect.enabled ? t("inspector.disableEffect") : t("inspector.enableEffect")}
        >
          {effect.enabled ? (
            <Eye size={12} className="text-text-secondary" />
          ) : (
            <EyeOff size={12} className="text-text-muted" />
          )}
        </button>
        <button
          onClick={() => onRemove(effect.id)}
          className="p-1 hover:bg-red-500/20 rounded transition-colors text-text-muted hover:text-red-400"
          title={t("inspector.removeEffect")}
        >
          <RotateCcw size={12} />
        </button>
      </div>
      {isExpanded && <div className="p-3 space-y-3">{renderParams()}</div>}
    </div>
  );
};

const EFFECT_TYPES: {
  type: VideoEffectType;
  labelKey: string;
  categoryKey: string;
}[] = [
  { type: "brightness", labelKey: "inspector.brightness", categoryKey: "inspector.categoryBasic" },
  { type: "contrast", labelKey: "inspector.contrast", categoryKey: "inspector.categoryBasic" },
  { type: "saturation", labelKey: "inspector.saturation", categoryKey: "inspector.categoryBasic" },
  { type: "temperature", labelKey: "inspector.temperature", categoryKey: "inspector.categoryColor" },
  { type: "tint", labelKey: "inspector.tint", categoryKey: "inspector.categoryColor" },
  { type: "blur", labelKey: "inspector.blur", categoryKey: "inspector.categoryBlur" },
  { type: "motion-blur", labelKey: "inspector.motionBlur", categoryKey: "inspector.categoryBlur" },
  { type: "radial-blur", labelKey: "inspector.radialBlur", categoryKey: "inspector.categoryBlur" },
  { type: "sharpen", labelKey: "inspector.sharpen", categoryKey: "inspector.categoryCreative" },
  { type: "vignette", labelKey: "inspector.vignette", categoryKey: "inspector.categoryCreative" },
  { type: "grain", labelKey: "inspector.filmGrain", categoryKey: "inspector.categoryCreative" },
  { type: "shadow", labelKey: "inspector.shadowDrop", categoryKey: "inspector.categoryStylize" },
  { type: "glow", labelKey: "inspector.glowFx", categoryKey: "inspector.categoryStylize" },
  { type: "chromatic-aberration", labelKey: "inspector.chromaticAberration", categoryKey: "inspector.categoryStylize" },
];

const EFFECT_CATEGORIES = [...new Set(EFFECT_TYPES.map((e) => e.categoryKey))];

const EffectTypeSelector: React.FC<{
  onSelect: (type: VideoEffectType) => void;
}> = ({ onSelect }) => {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full py-2 bg-primary/10 border border-primary/30 rounded-lg text-[10px] text-primary hover:bg-primary/20 transition-colors">
          {t("inspector.addEffect")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
        {EFFECT_CATEGORIES.map((categoryKey) => (
          <React.Fragment key={categoryKey}>
            <DropdownMenuLabel className="text-[9px] uppercase tracking-wider text-text-muted">
              {t(categoryKey)}
            </DropdownMenuLabel>
            {EFFECT_TYPES
              .filter((e) => e.categoryKey === categoryKey)
              .map((effect) => (
                <DropdownMenuItem
                  key={effect.type}
                  onClick={() => onSelect(effect.type)}
                  className="text-[10px]"
                >
                  {t(effect.labelKey)}
                </DropdownMenuItem>
              ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface VideoEffectsSectionProps {
  clipId: string;
}

export const VideoEffectsSection: React.FC<VideoEffectsSectionProps> = ({
  clipId,
}) => {
  const { t } = useTranslation();
  const {
    getVideoEffects,
    addVideoEffect,
    updateVideoEffect,
    removeVideoEffect,
    toggleVideoEffect,
  } = useProjectStore();

  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);

  const effects = useMemo(
    () => getVideoEffects(clipId),
    [clipId, getVideoEffects, modifiedAt],
  );

  const handleAddEffect = useCallback(
    (type: VideoEffectType) => {
      addVideoEffect(clipId, type);
    },
    [clipId, addVideoEffect],
  );

  const handleUpdateEffect = useCallback(
    (effectId: string, params: Record<string, unknown>) => {
      updateVideoEffect(clipId, effectId, params);
    },
    [clipId, updateVideoEffect],
  );

  const handleToggleEffect = useCallback(
    (effectId: string, enabled: boolean) => {
      toggleVideoEffect(clipId, effectId, enabled);
    },
    [clipId, toggleVideoEffect],
  );

  const handleRemoveEffect = useCallback(
    (effectId: string) => {
      removeVideoEffect(clipId, effectId);
    },
    [clipId, removeVideoEffect],
  );

  return (
    <div className="space-y-3">
      {effects.length === 0 ? (
        <p className="text-[10px] text-text-muted text-center py-2">
          {t("inspector.noEffectsApplied")}
        </p>
      ) : (
        <div className="space-y-2">
          {effects.map((effect) => (
            <EffectItem
              key={effect.id}
              effect={effect}
              onUpdate={handleUpdateEffect}
              onToggle={handleToggleEffect}
              onRemove={handleRemoveEffect}
            />
          ))}
        </div>
      )}
      <EffectTypeSelector onSelect={handleAddEffect} />
    </div>
  );
};

export default VideoEffectsSection;
