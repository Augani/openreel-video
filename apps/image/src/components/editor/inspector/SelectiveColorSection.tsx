import { useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import type { Layer } from "../../../types/project";
import type {
  SelectiveColorValues,
  SelectiveColorAdjustment,
} from "../../../types/adjustments";
import { DEFAULT_SELECTIVE_COLOR } from "../../../types/adjustments";
import { Palette, RotateCcw } from "lucide-react";

interface Props {
  layer: Layer;
}

type ColorRange =
  | "reds"
  | "yellows"
  | "greens"
  | "cyans"
  | "blues"
  | "magentas"
  | "whites"
  | "neutrals"
  | "blacks";

const COLOR_RANGES: { id: ColorRange; label: string; color: string }[] = [
  { id: "reds", label: "Reds", color: "bg-red-500" },
  { id: "yellows", label: "Yellows", color: "bg-yellow-500" },
  { id: "greens", label: "Greens", color: "bg-pink-500" },
  { id: "cyans", label: "Cyans", color: "bg-cyan-500" },
  { id: "blues", label: "Blues", color: "bg-blue-500" },
  { id: "magentas", label: "Magentas", color: "bg-pink-500" },
  { id: "whites", label: "Whites", color: "bg-white border border-border" },
  { id: "neutrals", label: "Neutrals", color: "bg-gray-500" },
  { id: "blacks", label: "Blacks", color: "bg-gray-900" },
];

function ColorSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const percentage = ((value + 100) / 200) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {value}%
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={-100}
        max={100}
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
          background: `linear-gradient(to right, hsl(var(--secondary)) 0%, hsl(var(--secondary)) 50%, hsl(var(--primary)) 50%, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%, hsl(var(--secondary)) 100%)`,
        }}
      />
    </div>
  );
}

export function SelectiveColorSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [activeRange, setActiveRange] = useState<ColorRange>("reds");
  const [isExpanded, setIsExpanded] = useState(false);

  const selectiveColor = layer.selectiveColor;
  const currentRange = selectiveColor[activeRange];

  const handleValueChange = (
    key: keyof SelectiveColorValues,
    value: number,
  ) => {
    updateLayer(layer.id, {
      selectiveColor: {
        ...selectiveColor,
        [activeRange]: {
          ...currentRange,
          [key]: value,
        },
      } as SelectiveColorAdjustment,
    });
  };

  const handleMethodChange = (method: "relative" | "absolute") => {
    updateLayer(layer.id, {
      selectiveColor: {
        ...selectiveColor,
        method,
      } as SelectiveColorAdjustment,
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      selectiveColor: {
        ...selectiveColor,
        enabled,
      } as SelectiveColorAdjustment,
    });
  };

  const resetSelectiveColor = () => {
    updateLayer(layer.id, {
      selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
    });
  };

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Selective Color</span>
          {selectiveColor.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={selectiveColor.enabled}
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
            <div className="flex flex-wrap gap-1">
              {COLOR_RANGES.map((range) => (
                <button
                  key={range.id}
                  onClick={() => setActiveRange(range.id)}
                  className={`w-5 h-5 rounded transition-all ${range.color} ${
                    activeRange === range.id
                      ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                      : ""
                  }`}
                  title={range.label}
                />
              ))}
            </div>
            <button
              onClick={resetSelectiveColor}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="space-y-2">
            <ColorSlider
              label="Cyan"
              value={currentRange.cyan}
              onChange={(v) => handleValueChange("cyan", v)}
            />
            <ColorSlider
              label="Magenta"
              value={currentRange.magenta}
              onChange={(v) => handleValueChange("magenta", v)}
            />
            <ColorSlider
              label="Yellow"
              value={currentRange.yellow}
              onChange={(v) => handleValueChange("yellow", v)}
            />
            <ColorSlider
              label="Black"
              value={currentRange.black}
              onChange={(v) => handleValueChange("black", v)}
            />
          </div>

          <div className="flex gap-1 pt-1">
            {(["relative", "absolute"] as const).map((method) => (
              <button
                key={method}
                onClick={() => handleMethodChange(method)}
                className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
                  selectiveColor.method === method
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {method.charAt(0).toUpperCase() + method.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
