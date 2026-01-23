import { useUIStore } from '../../../stores/ui-store';
import { Move, RotateCcw, Scale, RotateCw, ArrowUpDown, Maximize2, Grid3x3 } from 'lucide-react';

const transformModes = [
  { id: 'free', label: 'Free', icon: Move },
  { id: 'scale', label: 'Scale', icon: Scale },
  { id: 'rotate', label: 'Rotate', icon: RotateCw },
  { id: 'skew', label: 'Skew', icon: ArrowUpDown },
  { id: 'distort', label: 'Distort', icon: Maximize2 },
  { id: 'perspective', label: 'Perspective', icon: Maximize2 },
  { id: 'warp', label: 'Warp', icon: Grid3x3 },
] as const;

export function TransformToolPanel() {
  const { transformSettings, setTransformSettings } = useUIStore();

  const resetSettings = () => {
    setTransformSettings({
      mode: 'free',
      maintainAspectRatio: false,
      interpolation: 'bicubic',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Move size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Transform</h3>
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
        Select a layer and use handles to transform. Press Enter to apply, Escape to cancel.
      </p>

      <div className="space-y-3">
        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Mode</span>
          <div className="grid grid-cols-4 gap-1">
            {transformModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  onClick={() => setTransformSettings({ mode: mode.id })}
                  className={`flex flex-col items-center gap-1 p-2 rounded transition-colors ${
                    transformSettings.mode === mode.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                  title={mode.label}
                >
                  <Icon size={14} />
                  <span className="text-[9px]">{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Interpolation</span>
          <div className="grid grid-cols-3 gap-1">
            {(['nearest', 'bilinear', 'bicubic'] as const).map((interp) => (
              <button
                key={interp}
                onClick={() => setTransformSettings({ interpolation: interp })}
                className={`px-2 py-1.5 text-xs rounded transition-colors capitalize ${
                  transformSettings.interpolation === interp
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {interp}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={transformSettings.maintainAspectRatio}
              onChange={(e) => setTransformSettings({ maintainAspectRatio: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Maintain Aspect Ratio (Shift)
          </label>
        </div>
      </div>
    </div>
  );
}
