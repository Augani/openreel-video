import { useUIStore } from '../../../stores/ui-store';
import { Sun, Moon } from 'lucide-react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {value.toFixed(step < 1 ? 0 : 0)}{unit}
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

export function DodgeBurnToolPanel() {
  const { activeTool, dodgeBurnSettings, setDodgeBurnSettings } = useUIStore();

  if (activeTool !== 'dodge' && activeTool !== 'burn') {
    return null;
  }

  const toolTypes = [
    { id: 'dodge' as const, icon: Sun, label: 'Dodge' },
    { id: 'burn' as const, icon: Moon, label: 'Burn' },
  ];

  const ranges = [
    { id: 'shadows' as const, label: 'Shadows' },
    { id: 'midtones' as const, label: 'Midtones' },
    { id: 'highlights' as const, label: 'Highlights' },
  ];

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 flex items-center gap-2">
        {dodgeBurnSettings.type === 'dodge' ? (
          <Sun size={14} className="text-muted-foreground" />
        ) : (
          <Moon size={14} className="text-muted-foreground" />
        )}
        <span className="text-xs font-medium">
          {dodgeBurnSettings.type === 'dodge' ? 'Dodge Tool' : 'Burn Tool'}
        </span>
      </div>

      <div className="px-3 pb-3 space-y-3">
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Tool</span>
          <div className="flex gap-1">
            {toolTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setDodgeBurnSettings({ type: type.id })}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded transition-colors ${
                  dodgeBurnSettings.type === type.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <type.icon size={12} />
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Range</span>
          <div className="flex gap-1">
            {ranges.map((range) => (
              <button
                key={range.id}
                onClick={() => setDodgeBurnSettings({ range: range.id })}
                className={`flex-1 px-2 py-1.5 text-[10px] rounded transition-colors ${
                  dodgeBurnSettings.range === range.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Exposure"
          value={dodgeBurnSettings.exposure}
          min={1}
          max={100}
          unit="%"
          onChange={(v) => setDodgeBurnSettings({ exposure: v })}
        />

        <Slider
          label="Size"
          value={dodgeBurnSettings.size}
          min={1}
          max={500}
          unit="px"
          onChange={(v) => setDodgeBurnSettings({ size: v })}
        />

        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-center p-3 bg-secondary/30 rounded-lg">
            <div
              className="rounded-full transition-all"
              style={{
                width: Math.min(dodgeBurnSettings.size, 80),
                height: Math.min(dodgeBurnSettings.size, 80),
                background:
                  dodgeBurnSettings.type === 'dodge'
                    ? `radial-gradient(circle, rgba(255,255,255,${dodgeBurnSettings.exposure / 100}) 0%, transparent 70%)`
                    : `radial-gradient(circle, rgba(0,0,0,${dodgeBurnSettings.exposure / 100}) 0%, transparent 70%)`,
              }}
            />
          </div>
          <p className="text-[9px] text-muted-foreground text-center mt-1.5">
            {dodgeBurnSettings.type === 'dodge' ? 'Lightens' : 'Darkens'} {dodgeBurnSettings.range}
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Tips</span>
          <ul className="text-[9px] text-muted-foreground space-y-0.5">
            <li>• {dodgeBurnSettings.type === 'dodge' ? 'Lightens' : 'Darkens'} selected tonal range</li>
            <li>• Lower exposure for subtle adjustments</li>
            <li>• Build up effect with multiple strokes</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
