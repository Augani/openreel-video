import { useUIStore } from '../../../stores/ui-store';
import { Droplets, RotateCcw } from 'lucide-react';

export function BlurSharpenToolPanel() {
  const { blurSharpenSettings, setBlurSharpenSettings } = useUIStore();

  const resetSettings = () => {
    setBlurSharpenSettings({
      size: 30,
      strength: 50,
      mode: 'blur',
      sampleAllLayers: false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">
            {blurSharpenSettings.mode === 'blur' ? 'Blur' : 'Sharpen'} Tool
          </h3>
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
        {blurSharpenSettings.mode === 'blur'
          ? 'Paint to blur and soften areas.'
          : 'Paint to sharpen and enhance details.'}
      </p>

      <div className="space-y-3">
        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Mode</span>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => setBlurSharpenSettings({ mode: 'blur' })}
              className={`px-3 py-2 text-xs rounded transition-colors ${
                blurSharpenSettings.mode === 'blur'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              Blur
            </button>
            <button
              onClick={() => setBlurSharpenSettings({ mode: 'sharpen' })}
              className={`px-3 py-2 text-xs rounded transition-colors ${
                blurSharpenSettings.mode === 'sharpen'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              Sharpen
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Size</span>
            <span className="text-xs font-mono text-muted-foreground">{blurSharpenSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={blurSharpenSettings.size}
            onChange={(e) => setBlurSharpenSettings({ size: Number(e.target.value) })}
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
            <span className="text-xs font-mono text-muted-foreground">{blurSharpenSettings.strength}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={blurSharpenSettings.strength}
            onChange={(e) => setBlurSharpenSettings({ strength: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={blurSharpenSettings.sampleAllLayers}
              onChange={(e) => setBlurSharpenSettings({ sampleAllLayers: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Sample All Layers
          </label>
        </div>
      </div>
    </div>
  );
}
