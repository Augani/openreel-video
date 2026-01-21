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

const EffectSlider = LabeledSlider;

/**
 * Effect Item Component - displays a single effect with controls
 */
const EffectItem: React.FC<{
  effect: VideoEffect;
  onUpdate: (effectId: string, params: Record<string, unknown>) => void;
  onToggle: (effectId: string, enabled: boolean) => void;
  onRemove: (effectId: string) => void;
}> = ({ effect, onUpdate, onToggle, onRemove }) => {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const effectLabels: Record<VideoEffectType, string> = {
    brightness: "Brightness",
    contrast: "Contrast",
    saturation: "Saturation",
    hue: "Hue",
    blur: "Blur",
    sharpen: "Sharpen",
    vignette: "Vignette",
    grain: "Grain",
    temperature: "Temperature",
    tint: "Tint",
    tonal: "Tonal",
    chromaKey: "Chroma Key",
    shadow: "Drop Shadow",
    glow: "Glow",
    "motion-blur": "Motion Blur",
    "radial-blur": "Radial Blur",
    "chromatic-aberration": "Chromatic Aberration",
  };

  const renderParams = () => {
    switch (effect.type) {
      case "brightness":
        return (
          <EffectSlider
            label="Value"
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "contrast":
        return (
          <EffectSlider
            label="Value"
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
            label="Value"
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
            label="Radius"
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
              label="Amount"
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={200}
              unit="%"
            />
            <EffectSlider
              label="Radius"
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
              label="Amount"
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label="Midpoint"
              value={((effect.params.midpoint as number) || 0.5) * 100}
              onChange={(v) => onUpdate(effect.id, { midpoint: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label="Feather"
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
              label="Amount"
              value={(effect.params.amount as number) || 0}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label="Size"
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
            label="Value"
            value={(effect.params.value as number) || 0}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "tint":
        return (
          <EffectSlider
            label="Value"
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
              label="Offset X"
              value={(effect.params.offsetX as number) || 5}
              onChange={(v) => onUpdate(effect.id, { offsetX: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Offset Y"
              value={(effect.params.offsetY as number) || 5}
              onChange={(v) => onUpdate(effect.id, { offsetY: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Blur"
              value={(effect.params.blur as number) || 10}
              onChange={(v) => onUpdate(effect.id, { blur: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Opacity"
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
              label="Radius"
              value={(effect.params.radius as number) || 10}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Intensity"
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
              label="Angle"
              value={(effect.params.angle as number) || 0}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
            <EffectSlider
              label="Distance"
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
              label="Amount"
              value={(effect.params.amount as number) || 20}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label="Center X"
              value={(effect.params.centerX as number) || 50}
              onChange={(v) => onUpdate(effect.id, { centerX: v })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label="Center Y"
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
              label="Amount"
              value={(effect.params.amount as number) || 5}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={50}
              step={0.5}
              unit="px"
            />
            <EffectSlider
              label="Angle"
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
            {effectLabels[effect.type] || effect.type}
          </span>
        </button>
        <button
          onClick={() => onToggle(effect.id, !effect.enabled)}
          className="p-1 hover:bg-background-secondary rounded transition-colors"
          title={effect.enabled ? "Disable effect" : "Enable effect"}
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
          title="Remove effect"
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
  label: string;
  category: string;
}[] = [
  { type: "brightness", label: "Brightness", category: "Basic" },
  { type: "contrast", label: "Contrast", category: "Basic" },
  { type: "saturation", label: "Saturation", category: "Basic" },
  { type: "temperature", label: "Temperature", category: "Color" },
  { type: "tint", label: "Tint", category: "Color" },
  { type: "blur", label: "Blur", category: "Blur" },
  { type: "motion-blur", label: "Motion Blur", category: "Blur" },
  { type: "radial-blur", label: "Radial Blur", category: "Blur" },
  { type: "sharpen", label: "Sharpen", category: "Creative" },
  { type: "vignette", label: "Vignette", category: "Creative" },
  { type: "grain", label: "Film Grain", category: "Creative" },
  { type: "shadow", label: "Drop Shadow", category: "Stylize" },
  { type: "glow", label: "Glow", category: "Stylize" },
  { type: "chromatic-aberration", label: "Chromatic Aberration", category: "Stylize" },
];

const EFFECT_CATEGORIES = [...new Set(EFFECT_TYPES.map((e) => e.category))];

const EffectTypeSelector: React.FC<{
  onSelect: (type: VideoEffectType) => void;
}> = ({ onSelect }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full py-2 bg-primary/10 border border-primary/30 rounded-lg text-[10px] text-primary hover:bg-primary/20 transition-colors">
          + Add Effect
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
        {EFFECT_CATEGORIES.map((category) => (
          <React.Fragment key={category}>
            <DropdownMenuLabel className="text-[9px] uppercase tracking-wider text-text-muted">
              {category}
            </DropdownMenuLabel>
            {EFFECT_TYPES
              .filter((e) => e.category === category)
              .map((effect) => (
                <DropdownMenuItem
                  key={effect.type}
                  onClick={() => onSelect(effect.type)}
                  className="text-[10px]"
                >
                  {effect.label}
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
          No effects applied
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
