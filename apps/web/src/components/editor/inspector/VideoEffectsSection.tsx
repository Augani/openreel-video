import React, { useCallback, useMemo } from "react";
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
import { useI18n, type TranslationKey } from "../../../i18n";

const EffectSlider = LabeledSlider;

const effectLabelKeys: Record<VideoEffectType, TranslationKey> = {
  brightness: "videoEffects.effect.brightness",
  contrast: "videoEffects.effect.contrast",
  saturation: "videoEffects.effect.saturation",
  hue: "videoEffects.effect.hue",
  blur: "videoEffects.effect.blur",
  sharpen: "videoEffects.effect.sharpen",
  vignette: "videoEffects.effect.vignette",
  grain: "videoEffects.effect.grain",
  temperature: "videoEffects.effect.temperature",
  tint: "videoEffects.effect.tint",
  tonal: "videoEffects.effect.tonal",
  chromaKey: "videoEffects.effect.chromaKey",
  shadow: "videoEffects.effect.shadow",
  glow: "videoEffects.effect.glow",
  "motion-blur": "videoEffects.effect.motionBlur",
  "radial-blur": "videoEffects.effect.radialBlur",
  "chromatic-aberration": "videoEffects.effect.chromaticAberration",
};

const categoryLabelKeys = {
  basic: "videoEffects.category.basic",
  color: "videoEffects.category.color",
  blur: "videoEffects.category.blur",
  creative: "videoEffects.category.creative",
  stylize: "videoEffects.category.stylize",
} as const satisfies Record<string, TranslationKey>;

type EffectCategory = keyof typeof categoryLabelKeys;

/**
 * Effect Item Component - displays a single effect with controls
 */
const EffectItem: React.FC<{
  effect: VideoEffect;
  onUpdate: (effectId: string, params: Record<string, unknown>) => void;
  onToggle: (effectId: string, enabled: boolean) => void;
  onRemove: (effectId: string) => void;
}> = ({ effect, onUpdate, onToggle, onRemove }) => {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = React.useState(true);

  const renderParams = () => {
    switch (effect.type) {
      case "brightness":
        return (
          <EffectSlider
            label={t("videoEffects.param.value")}
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "contrast":
        return (
          <EffectSlider
            label={t("videoEffects.param.value")}
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
            label={t("videoEffects.param.value")}
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
            label={t("videoEffects.param.radius")}
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
              label={t("videoEffects.param.amount")}
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={200}
              unit="%"
            />
            <EffectSlider
              label={t("videoEffects.param.radius")}
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
              label={t("videoEffects.param.amount")}
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label={t("videoEffects.param.midpoint")}
              value={((effect.params.midpoint as number) || 0.5) * 100}
              onChange={(v) => onUpdate(effect.id, { midpoint: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label={t("videoEffects.param.feather")}
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
              label={t("videoEffects.param.amount")}
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label={t("videoEffects.param.size")}
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
            label={t("videoEffects.param.value")}
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "tint":
        return (
          <EffectSlider
            label={t("videoEffects.param.value")}
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
              label={t("videoEffects.param.offsetX")}
              value={(effect.params.offsetX as number) || 5}
              onChange={(v) => onUpdate(effect.id, { offsetX: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("videoEffects.param.offsetY")}
              value={(effect.params.offsetY as number) || 5}
              onChange={(v) => onUpdate(effect.id, { offsetY: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("videoEffects.param.blur")}
              value={(effect.params.blur as number) || 10}
              onChange={(v) => onUpdate(effect.id, { blur: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("videoEffects.param.opacity")}
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
              label={t("videoEffects.param.radius")}
              value={(effect.params.radius as number) || 10}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label={t("videoEffects.param.intensity")}
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
              label={t("videoEffects.param.angle")}
              value={(effect.params.angle as number) || 0}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
            <EffectSlider
              label={t("videoEffects.param.distance")}
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
              label={t("videoEffects.param.amount")}
              value={(effect.params.amount as number) || 20}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label={t("videoEffects.param.centerX")}
              value={(effect.params.centerX as number) || 50}
              onChange={(v) => onUpdate(effect.id, { centerX: v })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label={t("videoEffects.param.centerY")}
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
              label={t("videoEffects.param.amount")}
              value={(effect.params.amount as number) || 5}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={50}
              step={0.5}
              unit="px"
            />
            <EffectSlider
              label={t("videoEffects.param.angle")}
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
            {t(effectLabelKeys[effect.type])}
          </span>
        </button>
        <button
          onClick={() => onToggle(effect.id, !effect.enabled)}
          className="p-1 hover:bg-background-secondary rounded transition-colors"
          title={
            effect.enabled
              ? t("videoEffects.disable")
              : t("videoEffects.enable")
          }
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
          title={t("videoEffects.remove")}
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
  category: EffectCategory;
}[] = [
  { type: "brightness", category: "basic" },
  { type: "contrast", category: "basic" },
  { type: "saturation", category: "basic" },
  { type: "temperature", category: "color" },
  { type: "tint", category: "color" },
  { type: "blur", category: "blur" },
  { type: "motion-blur", category: "blur" },
  { type: "radial-blur", category: "blur" },
  { type: "sharpen", category: "creative" },
  { type: "vignette", category: "creative" },
  { type: "grain", category: "creative" },
  { type: "shadow", category: "stylize" },
  { type: "glow", category: "stylize" },
  { type: "chromatic-aberration", category: "stylize" },
];

const EFFECT_CATEGORIES = [...new Set(EFFECT_TYPES.map((e) => e.category))];

const EffectTypeSelector: React.FC<{
  onSelect: (type: VideoEffectType) => void;
}> = ({ onSelect }) => {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full py-2 bg-primary/10 border border-primary/30 rounded-lg text-[10px] text-primary hover:bg-primary/20 transition-colors">
          {t("videoEffects.add")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
        {EFFECT_CATEGORIES.map((category) => (
          <React.Fragment key={category}>
            <DropdownMenuLabel className="text-[9px] uppercase tracking-wider text-text-muted">
              {t(categoryLabelKeys[category])}
            </DropdownMenuLabel>
            {EFFECT_TYPES
              .filter((e) => e.category === category)
              .map((effect) => (
                <DropdownMenuItem
                  key={effect.type}
                  onClick={() => onSelect(effect.type)}
                  className="text-[10px]"
                >
                  {t(effectLabelKeys[effect.type])}
                </DropdownMenuItem>
              ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * VideoEffectsSection Props
 */
interface VideoEffectsSectionProps {
  clipId: string;
}

/**
 * VideoEffectsSection Component
 *
 * - 1.1: Display sliders for brightness, contrast, saturation
 * - 1.2: Apply video effects within 200ms
 * - 2.1: Blur effect with radius control
 * - 2.2: Sharpen effect with amount and radius
 * - 2.3: Vignette effect with amount, midpoint, feather
 * - 2.4: Grain effect with amount and size
 */
export const VideoEffectsSection: React.FC<VideoEffectsSectionProps> = ({
  clipId,
}) => {
  const { t } = useI18n();
  const {
    getVideoEffects,
    addVideoEffect,
    updateVideoEffect,
    removeVideoEffect,
    toggleVideoEffect,
  } = useProjectStore();

  // Subscribe to project.modifiedAt to trigger re-renders when effects change
  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);

  const effects = useMemo(
    () => getVideoEffects(clipId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {t("videoEffects.empty")}
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
