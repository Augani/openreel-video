import { useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import type { Layer } from "../../../types/project";
import type {
  ChannelMixerAdjustment,
  ChannelMixerChannel,
} from "../../../types/adjustments";
import { DEFAULT_CHANNEL_MIXER } from "../../../types/adjustments";
import { Blend, RotateCcw } from "lucide-react";

interface Props {
  layer: Layer;
}

type OutputChannel = "red" | "green" | "blue";

const CHANNEL_COLORS: Record<OutputChannel, string> = {
  red: "bg-red-500",
  green: "bg-pink-500",
  blue: "bg-blue-500",
};

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

export function ChannelMixerSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [activeChannel, setActiveChannel] = useState<OutputChannel>("red");
  const [isExpanded, setIsExpanded] = useState(false);

  const channelMixer = layer.channelMixer;
  const currentChannel = channelMixer[activeChannel];

  const handleValueChange = (key: keyof ChannelMixerChannel, value: number) => {
    updateLayer(layer.id, {
      channelMixer: {
        ...channelMixer,
        [activeChannel]: {
          ...currentChannel,
          [key]: value,
        },
      } as ChannelMixerAdjustment,
    });
  };

  const handleMonochromeChange = (monochrome: boolean) => {
    updateLayer(layer.id, {
      channelMixer: {
        ...channelMixer,
        monochrome,
      } as ChannelMixerAdjustment,
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      channelMixer: {
        ...channelMixer,
        enabled,
      } as ChannelMixerAdjustment,
    });
  };

  const resetChannelMixer = () => {
    updateLayer(layer.id, {
      channelMixer: { ...DEFAULT_CHANNEL_MIXER },
    });
  };

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Blend size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Channel Mixer</span>
          {channelMixer.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <input
          type="checkbox"
          checked={channelMixer.enabled}
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
            <div className="flex gap-1">
              {(["red", "green", "blue"] as OutputChannel[]).map((channel) => (
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
                    className={`inline-block w-2 h-2 rounded-full mr-1 ${CHANNEL_COLORS[channel]}`}
                  />
                  {channel.charAt(0).toUpperCase() + channel.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={resetChannelMixer}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="space-y-2">
            <ChannelSlider
              label="Red"
              color="bg-red-500"
              value={currentChannel.red}
              onChange={(v) => handleValueChange("red", v)}
            />
            <ChannelSlider
              label="Green"
              color="bg-pink-500"
              value={currentChannel.green}
              onChange={(v) => handleValueChange("green", v)}
            />
            <ChannelSlider
              label="Blue"
              color="bg-blue-500"
              value={currentChannel.blue}
              onChange={(v) => handleValueChange("blue", v)}
            />
            <ChannelSlider
              label="Constant"
              color="bg-gray-500"
              value={currentChannel.constant}
              onChange={(v) => handleValueChange("constant", v)}
            />
          </div>

          <label className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/50">
            <input
              type="checkbox"
              checked={channelMixer.monochrome}
              onChange={(e) => handleMonochromeChange(e.target.checked)}
              className="w-3 h-3 rounded border-border"
            />
            Monochrome
          </label>
        </div>
      )}
    </div>
  );
}
