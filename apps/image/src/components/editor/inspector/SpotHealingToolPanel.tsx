import { useUIStore } from '../../../stores/ui-store';
import { Bandage, RotateCcw } from 'lucide-react';

export function SpotHealingToolPanel() {
  const { spotHealingSettings, setSpotHealingSettings } = useUIStore();

  const resetSettings = () => {
    setSpotHealingSettings({
      size: 30,
      type: 'content-aware',
      sampleAllLayers: false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bandage size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Spot Healing Brush</h3>
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
        Paint over blemishes or imperfections to automatically remove them.
      </p>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Size</span>
            <span className="text-xs font-mono text-muted-foreground">{spotHealingSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={spotHealingSettings.size}
            onChange={(e) => setSpotHealingSettings({ size: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Type</span>
          <div className="flex flex-col gap-1">
            {([
              { id: 'content-aware', label: 'Content-Aware' },
              { id: 'proximity-match', label: 'Proximity Match' },
              { id: 'create-texture', label: 'Create Texture' },
            ] as const).map((option) => (
              <button
                key={option.id}
                onClick={() => setSpotHealingSettings({ type: option.id })}
                className={`px-3 py-2 text-xs rounded transition-colors text-left ${
                  spotHealingSettings.type === option.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={spotHealingSettings.sampleAllLayers}
              onChange={(e) => setSpotHealingSettings({ sampleAllLayers: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Sample All Layers
          </label>
        </div>
      </div>
    </div>
  );
}
