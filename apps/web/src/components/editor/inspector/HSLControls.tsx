import React, { useCallback, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import type { HSLValues } from "@openreel/core";

export const DEFAULT_HSL_VALUES: HSLValues = {
  hue: [0, 0, 0, 0, 0, 0, 0, 0],
  saturation: [0, 0, 0, 0, 0, 0, 0, 0],
  luminance: [0, 0, 0, 0, 0, 0, 0, 0],
};

const COLOR_RANGES = [
  { key: "reds", label: "R", fullLabel: "hsl.reds", color: "#ef4444", index: 0 },
  {
    key: "oranges",
    label: "O",
    fullLabel: "hsl.oranges",
    color: "#f97316",
    index: 1,
  },
  {
    key: "yellows",
    label: "Y",
    fullLabel: "hsl.yellows",
    color: "#eab308",
    index: 2,
  },
  {
    key: "greens",
    label: "G",
    fullLabel: "hsl.greens",
    color: "#22c55e",
    index: 3,
  },
  { key: "cyans", label: "C", fullLabel: "hsl.cyans", color: "#06b6d4", index: 4 },
  { key: "blues", label: "B", fullLabel: "hsl.blues", color: "#3b82f6", index: 5 },
  {
    key: "purples",
    label: "P",
    fullLabel: "hsl.purples",
    color: "#a855f7",
    index: 6,
  },
  {
    key: "magentas",
    label: "M",
    fullLabel: "hsl.magentas",
    color: "#ec4899",
    index: 7,
  },
] as const;

/**
 * Props for the HSLControls component
 */
interface HSLControlsProps {
  values: HSLValues;
  onChange: (values: HSLValues) => void;
  onReset?: () => void;
}

/**
 * Color range tab component
 */
const ColorTab: React.FC<{
  color: (typeof COLOR_RANGES)[number];
  isActive: boolean;
  onClick: () => void;
  title: string;
}> = ({ color, isActive, onClick, title }) => (
  <button
    onClick={onClick}
    className={`flex-1 py-1.5 text-[9px] font-medium rounded transition-all ${
      isActive
        ? "bg-background-tertiary text-text-primary shadow-sm"
        : "text-text-muted hover:text-text-secondary"
    }`}
    style={{
      borderBottom: isActive
        ? `2px solid ${color.color}`
        : "2px solid transparent",
    }}
    title={title}
  >
    {color.label}
  </button>
);

/**
 * HSL Slider component
 */
const HSLSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  unit?: string;
  color?: string;
}> = ({ label, value, onChange, min, max, unit = "", color }) => {
  // Calculate percentage for slider position (handle negative ranges)
  const range = max - min;
  const percentage = ((value - min) / range) * 100;

  // Calculate center position for bipolar sliders
  const centerPercentage = ((0 - min) / range) * 100;
  const isBipolar = min < 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary">{label}</span>
        <span className="text-[10px] font-mono text-text-primary">
          {value > 0 ? "+" : ""}
          {Math.round(value)}
          {unit}
        </span>
      </div>
      <div className="h-1.5 bg-background-tertiary rounded-full relative overflow-hidden">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        {/* Fill bar */}
        {isBipolar ? (
          // Bipolar slider: fill from center
          <div
            className="absolute top-0 h-full rounded-full transition-all"
            style={{
              backgroundColor: color || "rgb(var(--text-secondary))",
              left: value >= 0 ? `${centerPercentage}%` : `${percentage}%`,
              width: `${Math.abs(percentage - centerPercentage)}%`,
            }}
          />
        ) : (
          // Standard slider: fill from left
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-all"
            style={{
              backgroundColor: color || "rgb(var(--text-secondary))",
              width: `${percentage}%`,
            }}
          />
        )}
        {/* Center line for bipolar sliders */}
        {isBipolar && (
          <div
            className="absolute top-0 w-0.5 h-full bg-text-muted/50"
            style={{ left: `${centerPercentage}%` }}
          />
        )}
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-sm pointer-events-none transition-all"
          style={{ left: `calc(${percentage}% - 5px)` }}
        />
      </div>
    </div>
  );
};

/**
 * HSLControls Component
 *
 * - 7.1: Display H/S/L sliders for 8 color ranges
 * - 7.2: Shift only pixels within target hue range
 * - 7.3: Increase/decrease saturation for target hue range
 * - 7.4: Brighten/darken only pixels within target hue range
 */
export const HSLControls: React.FC<HSLControlsProps> = ({
  values,
  onChange,
  onReset,
}) => {
  const { t } = useTranslation();
  const [activeColorIndex, setActiveColorIndex] = useState(0);

  // Get current color info
  const activeColor = COLOR_RANGES[activeColorIndex];

  // Get current values for active color
  const currentHue = values.hue[activeColorIndex] || 0;
  const currentSaturation = (values.saturation[activeColorIndex] || 0) * 100;
  const currentLuminance = (values.luminance[activeColorIndex] || 0) * 100;

  // Handle hue change
  const handleHueChange = useCallback(
    (hue: number) => {
      const newHue = [...values.hue];
      newHue[activeColorIndex] = hue;
      onChange({ ...values, hue: newHue });
    },
    [values, activeColorIndex, onChange],
  );

  // Handle saturation change
  const handleSaturationChange = useCallback(
    (saturation: number) => {
      const newSaturation = [...values.saturation];
      newSaturation[activeColorIndex] = saturation / 100;
      onChange({ ...values, saturation: newSaturation });
    },
    [values, activeColorIndex, onChange],
  );

  // Handle luminance change
  const handleLuminanceChange = useCallback(
    (luminance: number) => {
      const newLuminance = [...values.luminance];
      newLuminance[activeColorIndex] = luminance / 100;
      onChange({ ...values, luminance: newLuminance });
    },
    [values, activeColorIndex, onChange],
  );

  // Reset current color
  const handleResetColor = useCallback(() => {
    const newHue = [...values.hue];
    const newSaturation = [...values.saturation];
    const newLuminance = [...values.luminance];

    newHue[activeColorIndex] = 0;
    newSaturation[activeColorIndex] = 0;
    newLuminance[activeColorIndex] = 0;

    onChange({
      hue: newHue,
      saturation: newSaturation,
      luminance: newLuminance,
    });
  }, [values, activeColorIndex, onChange]);

  // Check if current color has any adjustments
  const hasAdjustments = useMemo(() => {
    return (
      currentHue !== 0 || currentSaturation !== 0 || currentLuminance !== 0
    );
  }, [currentHue, currentSaturation, currentLuminance]);

  return (
    <div className="space-y-3">
      {/* Reset All Button */}
      {onReset && (
        <div className="flex justify-end">
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          >
            <RotateCcw size={10} />
            {t('hsl.resetAll')}
          </button>
        </div>
      )}

      {/* Color Range Tabs */}
      <div className="flex gap-0.5">
        {COLOR_RANGES.map((color) => (
          <ColorTab
            key={color.key}
            color={color}
            isActive={activeColorIndex === color.index}
            onClick={() => setActiveColorIndex(color.index)}
            title={t(color.fullLabel)}
          />
        ))}
      </div>

      {/* Active Color Label */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: activeColor.color }}
          />
          <span className="text-[11px] font-medium text-text-primary">
            {t(activeColor.fullLabel)}
          </span>
        </div>
        {hasAdjustments && (
          <button
            onClick={handleResetColor}
            className="text-[9px] text-text-muted hover:text-text-secondary transition-colors"
          >
            {t('hsl.reset')}
          </button>
        )}
      </div>

      {/* HSL Sliders */}
      <div className="space-y-3">
        <HSLSlider
          label={t('hsl.hue')}
          value={currentHue}
          onChange={handleHueChange}
          min={-180}
          max={180}
          unit="°"
          color={activeColor.color}
        />
        <HSLSlider
          label={t('hsl.saturation')}
          value={currentSaturation}
          onChange={handleSaturationChange}
          min={-100}
          max={100}
          unit="%"
          color={activeColor.color}
        />
        <HSLSlider
          label={t('hsl.luminance')}
          value={currentLuminance}
          onChange={handleLuminanceChange}
          min={-100}
          max={100}
          unit="%"
          color={activeColor.color}
        />
      </div>

      {/* Visual indicator of all color adjustments */}
      <div className="pt-2 border-t border-border">
        <div className="flex gap-1">
          {COLOR_RANGES.map((color) => {
            const hasAdj =
              values.hue[color.index] !== 0 ||
              values.saturation[color.index] !== 0 ||
              values.luminance[color.index] !== 0;
            return (
              <div
                key={color.key}
                className={`flex-1 h-1 rounded-full transition-all ${
                  hasAdj ? "opacity-100" : "opacity-20"
                }`}
                style={{ backgroundColor: color.color }}
                title={hasAdj ? t('hsl.adjusted', { label: t(color.fullLabel) }) : t(color.fullLabel)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HSLControls;
