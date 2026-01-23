import { useUIStore } from '../../../stores/ui-store';
import { Waves, RotateCcw, ArrowRight, Undo2, Sparkles, RotateCw, RotateCcw as Counterclockwise, Minus, Plus, ArrowLeft, Snowflake, Flame } from 'lucide-react';

const liquifyTools = [
  { id: 'forward-warp', label: 'Forward Warp', icon: ArrowRight },
  { id: 'reconstruct', label: 'Reconstruct', icon: Undo2 },
  { id: 'smooth', label: 'Smooth', icon: Sparkles },
  { id: 'twirl-clockwise', label: 'Twirl CW', icon: RotateCw },
  { id: 'twirl-counterclockwise', label: 'Twirl CCW', icon: Counterclockwise },
  { id: 'pucker', label: 'Pucker', icon: Minus },
  { id: 'bloat', label: 'Bloat', icon: Plus },
  { id: 'push-left', label: 'Push Left', icon: ArrowLeft },
  { id: 'freeze', label: 'Freeze', icon: Snowflake },
  { id: 'thaw', label: 'Thaw', icon: Flame },
] as const;

export function LiquifyToolPanel() {
  const { liquifySettings, setLiquifySettings } = useUIStore();

  const resetSettings = () => {
    setLiquifySettings({
      brushSize: 100,
      brushDensity: 50,
      brushPressure: 100,
      brushRate: 80,
      tool: 'forward-warp',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Liquify</h3>
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
          <span className="text-xs text-muted-foreground mb-1.5 block">Tool</span>
          <div className="grid grid-cols-5 gap-1">
            {liquifyTools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setLiquifySettings({ tool: tool.id })}
                  className={`p-2 rounded transition-colors ${
                    liquifySettings.tool === tool.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                  title={tool.label}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Brush Size</span>
            <span className="text-xs font-mono text-muted-foreground">{liquifySettings.brushSize}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={1500}
            value={liquifySettings.brushSize}
            onChange={(e) => setLiquifySettings({ brushSize: Number(e.target.value) })}
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
            <span className="text-xs text-muted-foreground">Density</span>
            <span className="text-xs font-mono text-muted-foreground">{liquifySettings.brushDensity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={liquifySettings.brushDensity}
            onChange={(e) => setLiquifySettings({ brushDensity: Number(e.target.value) })}
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
            <span className="text-xs text-muted-foreground">Pressure</span>
            <span className="text-xs font-mono text-muted-foreground">{liquifySettings.brushPressure}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={liquifySettings.brushPressure}
            onChange={(e) => setLiquifySettings({ brushPressure: Number(e.target.value) })}
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
            <span className="text-xs text-muted-foreground">Rate</span>
            <span className="text-xs font-mono text-muted-foreground">{liquifySettings.brushRate}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={liquifySettings.brushRate}
            onChange={(e) => setLiquifySettings({ brushRate: Number(e.target.value) })}
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
