import { useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';
import type { ColorBalanceValues } from '../../../types/adjustments';
import { DEFAULT_COLOR_BALANCE } from '../../../types/adjustments';
import { Palette, RotateCcw } from 'lucide-react';

interface Props {
  layer: Layer;
}

type ToneType = 'shadows' | 'midtones' | 'highlights';

interface BalanceSliderProps {
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
  value: number;
  onChange: (value: number) => void;
}

function BalanceSlider({
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
  value,
  onChange,
}: BalanceSliderProps) {
  const percentage = ((value + 100) / 200) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: leftColor }}>
          {leftLabel}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">{value}</span>
        <span className="text-[10px]" style={{ color: rightColor }}>
          {rightLabel}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={-100}
        max={100}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-2.5
          [&::-webkit-slider-thumb]:h-2.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-foreground
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${leftColor} 0%, hsl(var(--secondary)) ${percentage}%, ${rightColor} 100%)`,
        }}
      />
    </div>
  );
}

export function ColorBalanceSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [activeTone, setActiveTone] = useState<ToneType>('midtones');
  const [isExpanded, setIsExpanded] = useState(true);

  const colorBalance = layer.colorBalance;
  const currentTone = colorBalance[activeTone];

  const handleToneChange = (key: keyof ColorBalanceValues, value: number) => {
    updateLayer(layer.id, {
      colorBalance: {
        ...colorBalance,
        [activeTone]: {
          ...currentTone,
          [key]: value,
        },
      },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      colorBalance: {
        ...colorBalance,
        enabled,
      },
    });
  };

  const handlePreserveLuminosityChange = (preserveLuminosity: boolean) => {
    updateLayer(layer.id, {
      colorBalance: {
        ...colorBalance,
        preserveLuminosity,
      },
    });
  };

  const resetColorBalance = () => {
    updateLayer(layer.id, {
      colorBalance: { ...DEFAULT_COLOR_BALANCE },
    });
  };

  const tones: { id: ToneType; label: string }[] = [
    { id: 'shadows', label: 'Shadows' },
    { id: 'midtones', label: 'Midtones' },
    { id: 'highlights', label: 'Highlights' },
  ];

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Color Balance</span>
          {colorBalance.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={colorBalance.enabled}
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
              {tones.map((tone) => (
                <button
                  key={tone.id}
                  onClick={() => setActiveTone(tone.id)}
                  className={`px-2 py-1 text-[10px] rounded transition-colors ${
                    activeTone === tone.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tone.label}
                </button>
              ))}
            </div>
            <button
              onClick={resetColorBalance}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset Color Balance"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="space-y-3 pt-1">
            <BalanceSlider
              leftLabel="Cyan"
              rightLabel="Red"
              leftColor="#00bcd4"
              rightColor="#f44336"
              value={currentTone.cyanRed}
              onChange={(v) => handleToneChange('cyanRed', v)}
            />

            <BalanceSlider
              leftLabel="Magenta"
              rightLabel="Green"
              leftColor="#e91e63"
              rightColor="#4caf50"
              value={currentTone.magentaGreen}
              onChange={(v) => handleToneChange('magentaGreen', v)}
            />

            <BalanceSlider
              leftLabel="Yellow"
              rightLabel="Blue"
              leftColor="#ffeb3b"
              rightColor="#2196f3"
              value={currentTone.yellowBlue}
              onChange={(v) => handleToneChange('yellowBlue', v)}
            />
          </div>

          <label className="flex items-center gap-2 pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={colorBalance.preserveLuminosity}
              onChange={(e) => handlePreserveLuminosityChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border"
            />
            <span className="text-[10px] text-muted-foreground">Preserve Luminosity</span>
          </label>
        </div>
      )}
    </div>
  );
}
