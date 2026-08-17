import React, { useCallback, useState, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { RotateCcw } from "@/icons/lucide-compat";
import type { HSLValues } from "@openreel/core";
import { useTranslation } from "react-i18next";

export const DEFAULT_HSL_VALUES: HSLValues = {
  hue: [0, 0, 0, 0, 0, 0, 0, 0],
  saturation: [0, 0, 0, 0, 0, 0, 0, 0],
  luminance: [0, 0, 0, 0, 0, 0, 0, 0],
};

const COLOR_RANGES = [
  { key: "reds", label: "R", fullLabel: "Reds", color: "#ef4444", index: 0 },
  {
    key: "oranges",
    label: "O",
    fullLabel: "Oranges",
    color: "#f97316",
    index: 1,
  },
  {
    key: "yellows",
    label: "Y",
    fullLabel: "Yellows",
    color: "#eab308",
    index: 2,
  },
  {
    key: "greens",
    label: "G",
    fullLabel: "Greens",
    color: "#22c55e",
    index: 3,
  },
  { key: "cyans", label: "C", fullLabel: "Cyans", color: "#06b6d4", index: 4 },
  { key: "blues", label: "B", fullLabel: "Blues", color: "#3b82f6", index: 5 },
  {
    key: "purples",
    label: "P",
    fullLabel: "Purples",
    color: "#a855f7",
    index: 6,
  },
  {
    key: "magentas",
    label: "M",
    fullLabel: "Magentas",
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
}> = ({ color, isActive, onClick }) => {
  const { t } = useTranslation();
  return (
  <ClickableCard
    label={color.fullLabel}
    onClick={onClick}
    className={`flex-1 py-1.5 text-[9px] font-medium rounded transition-all ${
      isActive
        ? "bg-bg-2 text-fg shadow-sm"
        : "text-fg-3 hover:text-fg-2"
    }`}
    style={{
      borderBottom: isActive
        ? `2px solid ${color.color}`
        : "2px solid transparent",
    }}
  >
    {t(color.label)}
  </ClickableCard>
);
};

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
}> = ({ label, value, onChange, min, max, unit = "" }) => (
  <PropertySlider
    label={label}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={1}
    formatValue={(nextValue) =>
      `${nextValue > 0 ? "+" : ""}${Math.round(nextValue)}${unit}`
    }
  />
);

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
          <Button
            label={t("Reset All")}
            icon={<RotateCcw size={10} />}
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-fg-3 hover:text-fg transition-colors"
          />
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
          <Text type="supporting" color="primary" className="text-[11px] font-medium">
            {activeColor.fullLabel}
          </Text>
        </div>
        {hasAdjustments && (
          <Button
            label={t("Reset")}
            variant="ghost"
            size="sm"
            onClick={handleResetColor}
            className="text-[9px] text-fg-3 hover:text-fg-2 transition-colors"
          />
        )}
      </div>

      {/* HSL Sliders */}
      <div className="space-y-3">
        <HSLSlider
          label={t("Hue")}
          value={currentHue}
          onChange={handleHueChange}
          min={-180}
          max={180}
          unit="°"
          color={activeColor.color}
        />
        <HSLSlider
          label={t("Saturation")}
          value={currentSaturation}
          onChange={handleSaturationChange}
          min={-100}
          max={100}
          unit="%"
          color={activeColor.color}
        />
        <HSLSlider
          label={t("Luminance")}
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
                title={`${color.fullLabel}${hasAdj ? " (adjusted)" : ""}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HSLControls;
