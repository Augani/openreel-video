import { useUIStore } from '../../../stores/ui-store';
import { Eraser, Square, Pencil, Circle } from 'lucide-react';

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

export function EraserToolPanel() {
  const { activeTool, eraserSettings, setEraserSettings } = useUIStore();

  if (activeTool !== 'eraser') {
    return null;
  }

  const eraserModes = [
    { id: 'brush' as const, icon: Circle, label: 'Brush' },
    { id: 'pencil' as const, icon: Pencil, label: 'Pencil' },
    { id: 'block' as const, icon: Square, label: 'Block' },
  ];

  return (
    <div className="border-b border-border">
      <div className="px-3 py-2 flex items-center gap-2">
        <Eraser size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium">Eraser Tool</span>
      </div>

      <div className="px-3 pb-3 space-y-3">
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Mode</span>
          <div className="flex gap-1">
            {eraserModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setEraserSettings({ mode: mode.id })}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] rounded transition-colors ${
                  eraserSettings.mode === mode.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <mode.icon size={12} />
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Size"
          value={eraserSettings.size}
          min={1}
          max={500}
          unit="px"
          onChange={(v) => setEraserSettings({ size: v })}
        />

        <Slider
          label="Hardness"
          value={eraserSettings.hardness}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setEraserSettings({ hardness: v })}
        />

        <Slider
          label="Opacity"
          value={Math.round(eraserSettings.opacity * 100)}
          min={1}
          max={100}
          unit="%"
          onChange={(v) => setEraserSettings({ opacity: v / 100 })}
        />

        <Slider
          label="Flow"
          value={Math.round(eraserSettings.flow * 100)}
          min={1}
          max={100}
          unit="%"
          onChange={(v) => setEraserSettings({ flow: v / 100 })}
        />

        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-center p-3 bg-secondary/30 rounded-lg">
            <div
              className="rounded-full bg-foreground transition-all"
              style={{
                width: Math.min(eraserSettings.size, 100),
                height: Math.min(eraserSettings.size, 100),
                opacity: eraserSettings.opacity,
                filter: `blur(${(100 - eraserSettings.hardness) / 20}px)`,
              }}
            />
          </div>
          <p className="text-[9px] text-muted-foreground text-center mt-1.5">
            Brush preview
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Tips</span>
          <ul className="text-[9px] text-muted-foreground space-y-0.5">
            <li>• Hold Shift for straight lines</li>
            <li>• [ and ] to adjust size</li>
            <li>• Shift+[ and ] for hardness</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
