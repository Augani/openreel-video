import { useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import type { Layer } from "../../../types/project";
import type { LevelsChannel } from "../../../types/adjustments";
import { DEFAULT_LEVELS } from "../../../types/adjustments";
import { Activity, RotateCcw } from "lucide-react";

interface Props {
  layer: Layer;
}

type ChannelType = "master" | "red" | "green" | "blue";

interface LevelsSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function LevelsSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: LevelsSliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
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
          background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%, hsl(var(--secondary)) 100%)`,
        }}
      />
    </div>
  );
}

export function LevelsSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [activeChannel, setActiveChannel] = useState<ChannelType>("master");
  const [isExpanded, setIsExpanded] = useState(true);

  const levels = layer.levels;
  const currentChannel = levels[activeChannel];

  const handleChannelChange = (key: keyof LevelsChannel, value: number) => {
    updateLayer(layer.id, {
      levels: {
        ...levels,
        [activeChannel]: {
          ...currentChannel,
          [key]: value,
        },
      },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      levels: {
        ...levels,
        enabled,
      },
    });
  };

  const resetLevels = () => {
    updateLayer(layer.id, {
      levels: { ...DEFAULT_LEVELS },
    });
  };

  const channelColors: Record<ChannelType, string> = {
    master: "bg-foreground",
    red: "bg-red-500",
    green: "bg-pink-500",
    blue: "bg-blue-500",
  };

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Levels</span>
          {levels.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={levels.enabled}
            onChange={(e) => {
              e.stopPropagation();
              handleEnabledChange(e.target.checked);
            }}
            className="w-3.5 h-3.5 rounded border-border"
          />
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(["master", "red", "green", "blue"] as ChannelType[]).map(
                (channel) => (
                  <button
                    key={channel}
                    onClick={() => setActiveChannel(channel)}
                    className={`px-2 py-1 text-[10px] rounded transition-colors ${
                      activeChannel === channel
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${channelColors[channel]}`}
                    />
                    {channel.charAt(0).toUpperCase()}
                  </button>
                ),
              )}
            </div>
            <button
              onClick={resetLevels}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset Levels"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground font-medium">
                Input Levels
              </span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <LevelsSlider
                    label="Black"
                    value={currentChannel.inputBlack}
                    min={0}
                    max={255}
                    onChange={(v) => handleChannelChange("inputBlack", v)}
                  />
                </div>
                <div className="flex-1">
                  <LevelsSlider
                    label="White"
                    value={currentChannel.inputWhite}
                    min={0}
                    max={255}
                    onChange={(v) => handleChannelChange("inputWhite", v)}
                  />
                </div>
              </div>
            </div>

            <LevelsSlider
              label="Gamma"
              value={currentChannel.gamma}
              min={0.1}
              max={10}
              step={0.01}
              onChange={(v) => handleChannelChange("gamma", v)}
            />

            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground font-medium">
                Output Levels
              </span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <LevelsSlider
                    label="Black"
                    value={currentChannel.outputBlack}
                    min={0}
                    max={255}
                    onChange={(v) => handleChannelChange("outputBlack", v)}
                  />
                </div>
                <div className="flex-1">
                  <LevelsSlider
                    label="White"
                    value={currentChannel.outputWhite}
                    min={0}
                    max={255}
                    onChange={(v) => handleChannelChange("outputWhite", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
