import { useUIStore } from '../../../stores/ui-store';
import { Blend, RotateCcw } from 'lucide-react';

export function SmudgeToolPanel() {
  const { smudgeSettings, setSmudgeSettings } = useUIStore();

  const resetSettings = () => {
    setSmudgeSettings({
      size: 30,
      strength: 50,
      fingerPainting: false,
      sampleAllLayers: false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Blend size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Smudge Tool</h3>
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
        Drag to smudge and blend colors together.
      </p>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Size</span>
            <span className="text-xs font-mono text-muted-foreground">{smudgeSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={smudgeSettings.size}
            onChange={(e) => setSmudgeSettings({ size: Number(e.target.value) })}
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
            <span className="text-xs text-muted-foreground">Strength</span>
            <span className="text-xs font-mono text-muted-foreground">{smudgeSettings.strength}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={smudgeSettings.strength}
            onChange={(e) => setSmudgeSettings({ strength: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={smudgeSettings.fingerPainting}
              onChange={(e) => setSmudgeSettings({ fingerPainting: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Finger Painting
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={smudgeSettings.sampleAllLayers}
              onChange={(e) => setSmudgeSettings({ sampleAllLayers: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Sample All Layers
          </label>
        </div>
      </div>
    </div>
  );
}
