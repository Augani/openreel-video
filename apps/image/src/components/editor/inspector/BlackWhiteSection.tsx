import { useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import type { Layer } from "../../../types/project";
import type { BlackWhiteAdjustment } from "../../../types/adjustments";
import { DEFAULT_BLACK_WHITE } from "../../../types/adjustments";
import { BLACK_WHITE_PRESETS } from "../../../adjustments/black-white";
import { SunMoon, RotateCcw } from "lucide-react";

interface Props {
  layer: Layer;
}

const COLOR_SLIDERS: {
  key: keyof BlackWhiteAdjustment;
  label: string;
  color: string;
}[] = [
  { key: "reds", label: "Reds", color: "bg-red-500" },
  { key: "yellows", label: "Yellows", color: "bg-yellow-500" },
  { key: "greens", label: "Greens", color: "bg-pink-500" },
  { key: "cyans", label: "Cyans", color: "bg-cyan-500" },
  { key: "blues", label: "Blues", color: "bg-blue-500" },
  { key: "magentas", label: "Magentas", color: "bg-pink-500" },
];

const PRESET_OPTIONS = [
  { id: "default", label: "Default" },
  { id: "highContrast", label: "High Contrast" },
  { id: "infrared", label: "Infrared" },
  { id: "maximumBlack", label: "Maximum Black" },
  { id: "maximumWhite", label: "Maximum White" },
  { id: "neutralDensity", label: "Neutral Density" },
  { id: "redFilter", label: "Red Filter" },
  { id: "yellowFilter", label: "Yellow Filter" },
  { id: "greenFilter", label: "Green Filter" },
  { id: "blueFilter", label: "Blue Filter" },
] as const;

function ChannelSlider({
  label,
  color,
  value,
  onChange,
}: {
  label: string;
  color: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const percentage = ((value + 200) / 400) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${color}`} />
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {value}%
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={-200}
        max={200}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-2.5
          [&::-webkit-slider-thumb]:h-2.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, hsl(var(--secondary)) 0%, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%, hsl(var(--secondary)) 100%)`,
        }}
      />
    </div>
  );
}

export function BlackWhiteSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const blackWhite = layer.blackWhite;

  const handleValueChange = (
    key: keyof BlackWhiteAdjustment,
    value: number | boolean,
  ) => {
    updateLayer(layer.id, {
      blackWhite: {
        ...blackWhite,
        [key]: value,
      },
    });
  };

  const handlePresetChange = (presetId: string) => {
    const preset =
      BLACK_WHITE_PRESETS[presetId as keyof typeof BLACK_WHITE_PRESETS];
    if (preset) {
      updateLayer(layer.id, {
        blackWhite: {
          ...blackWhite,
          ...preset,
        },
      });
    }
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      blackWhite: {
        ...blackWhite,
        enabled,
      },
    });
  };

  const resetBlackWhite = () => {
    updateLayer(layer.id, {
      blackWhite: { ...DEFAULT_BLACK_WHITE },
    });
  };

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SunMoon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Black & White</span>
          {blackWhite.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={blackWhite.enabled}
          onChange={(e) => {
            e.stopPropagation();
            handleEnabledChange(e.target.checked);
          }}
          className="w-3.5 h-3.5 rounded border-border"
        />
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <select
              value=""
              onChange={(e) => handlePresetChange(e.target.value)}
              className="text-[10px] bg-secondary border-none rounded px-2 py-1 text-foreground"
            >
              <option value="">Preset</option>
              {PRESET_OPTIONS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <button
              onClick={resetBlackWhite}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="space-y-2">
            {COLOR_SLIDERS.map(({ key, label, color }) => (
              <ChannelSlider
                key={key}
                label={label}
                color={color}
                value={blackWhite[key] as number}
                onChange={(v) => handleValueChange(key, v)}
              />
            ))}
          </div>

          <div className="space-y-2 pt-2 border-t border-border/50">
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={blackWhite.tintEnabled}
                onChange={(e) =>
                  handleValueChange("tintEnabled", e.target.checked)
                }
                className="w-3 h-3 rounded border-border"
              />
              Tint
            </label>
            {blackWhite.tintEnabled && (
              <div className="space-y-2 pl-5">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      Hue
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {blackWhite.tintHue}°
                    </span>
                  </div>
                  <input
                    type="range"
                    value={blackWhite.tintHue}
                    min={0}
                    max={360}
                    onChange={(e) =>
                      handleValueChange("tintHue", Number(e.target.value))
                    }
                    className="w-full h-1.5 appearance-none rounded-full cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, hsl(0, 70%, 50%), hsl(60, 70%, 50%), hsl(120, 70%, 50%), hsl(180, 70%, 50%), hsl(240, 70%, 50%), hsl(300, 70%, 50%), hsl(360, 70%, 50%))`,
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      Saturation
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {blackWhite.tintSaturation}%
                    </span>
                  </div>
                  <input
                    type="range"
                    value={blackWhite.tintSaturation}
                    min={0}
                    max={100}
                    onChange={(e) =>
                      handleValueChange(
                        "tintSaturation",
                        Number(e.target.value),
                      )
                    }
                    className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:w-2.5
                      [&::-webkit-slider-thumb]:h-2.5
                      [&::-webkit-slider-thumb]:rounded-full
                      [&::-webkit-slider-thumb]:bg-primary
                      [&::-webkit-slider-thumb]:shadow-sm
                      [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
