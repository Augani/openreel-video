import { useUIStore } from '../../../stores/ui-store';
import { Pencil } from 'lucide-react';

export function PenSettingsSection() {
  const { penSettings, setPenSettings } = useUIStore();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Pencil size={16} className="text-primary" />
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Pen Settings
        </h4>
      </div>

      <div className="space-y-3 p-3 bg-secondary/30 rounded-lg border border-border/50">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-foreground font-medium">Color</label>
            <input
              type="color"
              value={penSettings.color}
              onChange={(e) => setPenSettings({ color: e.target.value })}
              className="w-8 h-6 rounded border border-border cursor-pointer"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-foreground font-medium">Width</label>
            <span className="text-[11px] font-mono text-muted-foreground">{penSettings.width}px</span>
          </div>
          <input
            type="range"
            value={penSettings.width}
            min={1}
            max={50}
            onChange={(e) => setPenSettings({ width: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-foreground font-medium">Opacity</label>
            <span className="text-[11px] font-mono text-muted-foreground">{Math.round(penSettings.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            value={penSettings.opacity}
            min={0.1}
            max={1}
            step={0.1}
            onChange={(e) => setPenSettings({ opacity: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Click and drag on the canvas to draw
      </p>
    </div>
  );
}
