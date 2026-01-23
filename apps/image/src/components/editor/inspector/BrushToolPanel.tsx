import { useUIStore } from '../../../stores/ui-store';
import { Paintbrush, RotateCcw } from 'lucide-react';

export function BrushToolPanel() {
  const { brushSettings, setBrushSettings } = useUIStore();

  const resetSettings = () => {
    setBrushSettings({
      size: 20,
      hardness: 100,
      opacity: 1,
      flow: 1,
      color: '#000000',
      blendMode: 'normal',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paintbrush size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Brush</h3>
        </div>
        <button
          onClick={resetSettings}
          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Color</span>
          </div>
          <div className="flex gap-2">
            <input
              type="color"
              value={brushSettings.color}
              onChange={(e) => setBrushSettings({ color: e.target.value })}
              className="w-10 h-10 rounded border border-border cursor-pointer"
            />
            <input
              type="text"
              value={brushSettings.color}
              onChange={(e) => setBrushSettings({ color: e.target.value })}
              className="flex-1 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Size</span>
            <span className="text-xs font-mono text-muted-foreground">{brushSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={brushSettings.size}
            onChange={(e) => setBrushSettings({ size: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Hardness</span>
            <span className="text-xs font-mono text-muted-foreground">{brushSettings.hardness}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={brushSettings.hardness}
            onChange={(e) => setBrushSettings({ hardness: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Opacity</span>
            <span className="text-xs font-mono text-muted-foreground">{Math.round(brushSettings.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={brushSettings.opacity * 100}
            onChange={(e) => setBrushSettings({ opacity: Number(e.target.value) / 100 })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Flow</span>
            <span className="text-xs font-mono text-muted-foreground">{Math.round(brushSettings.flow * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={brushSettings.flow * 100}
            onChange={(e) => setBrushSettings({ flow: Number(e.target.value) / 100 })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Blend Mode</span>
          <div className="grid grid-cols-2 gap-1">
            {(['normal', 'multiply', 'screen', 'overlay'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setBrushSettings({ blendMode: mode })}
                className={`px-2 py-1.5 text-xs rounded transition-colors capitalize ${
                  brushSettings.blendMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
