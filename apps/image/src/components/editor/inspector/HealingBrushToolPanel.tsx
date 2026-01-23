import { useUIStore } from '../../../stores/ui-store';
import { Bandage, RotateCcw } from 'lucide-react';

export function HealingBrushToolPanel() {
  const { healingBrushSettings, setHealingBrushSettings } = useUIStore();

  const resetSettings = () => {
    setHealingBrushSettings({
      size: 30,
      hardness: 50,
      mode: 'normal',
      sourcePoint: null,
      aligned: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bandage size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Healing Brush</h3>
        </div>
        <button
          onClick={resetSettings}
          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Hold Alt/Option and click to set source, then paint to heal while matching texture and lighting.
      </p>

      {healingBrushSettings.sourcePoint && (
        <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded">
          Source: ({Math.round(healingBrushSettings.sourcePoint.x)}, {Math.round(healingBrushSettings.sourcePoint.y)})
        </div>
      )}

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Size</span>
            <span className="text-xs font-mono text-muted-foreground">{healingBrushSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={healingBrushSettings.size}
            onChange={(e) => setHealingBrushSettings({ size: Number(e.target.value) })}
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
            <span className="text-xs font-mono text-muted-foreground">{healingBrushSettings.hardness}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={healingBrushSettings.hardness}
            onChange={(e) => setHealingBrushSettings({ hardness: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Mode</span>
          <div className="grid grid-cols-2 gap-1">
            {(['normal', 'replace', 'multiply', 'screen'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setHealingBrushSettings({ mode })}
                className={`px-2 py-1.5 text-xs rounded transition-colors capitalize ${
                  healingBrushSettings.mode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={healingBrushSettings.aligned}
              onChange={(e) => setHealingBrushSettings({ aligned: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Aligned
          </label>
        </div>
      </div>
    </div>
  );
}
