import { useUIStore } from '../../../stores/ui-store';
import { Droplet, RotateCcw } from 'lucide-react';

export function SpongeToolPanel() {
  const { spongeSettings, setSpongeSettings } = useUIStore();

  const resetSettings = () => {
    setSpongeSettings({
      size: 30,
      flow: 50,
      mode: 'desaturate',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplet size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Sponge Tool</h3>
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
        Paint to saturate or desaturate color in specific areas.
      </p>

      <div className="space-y-3">
        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Mode</span>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => setSpongeSettings({ mode: 'desaturate' })}
              className={`px-3 py-2 text-xs rounded transition-colors ${
                spongeSettings.mode === 'desaturate'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              Desaturate
            </button>
            <button
              onClick={() => setSpongeSettings({ mode: 'saturate' })}
              className={`px-3 py-2 text-xs rounded transition-colors ${
                spongeSettings.mode === 'saturate'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              Saturate
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Size</span>
            <span className="text-xs font-mono text-muted-foreground">{spongeSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={spongeSettings.size}
            onChange={(e) => setSpongeSettings({ size: Number(e.target.value) })}
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
            <span className="text-xs font-mono text-muted-foreground">{spongeSettings.flow}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={spongeSettings.flow}
            onChange={(e) => setSpongeSettings({ flow: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>
      </div>
    </div>
  );
}
