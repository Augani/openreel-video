import { useUIStore } from '../../../stores/ui-store';
import { SquareStack, RotateCcw, X, Plus } from 'lucide-react';

const gradientTypes = [
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'angle', label: 'Angle' },
  { id: 'reflected', label: 'Reflected' },
  { id: 'diamond', label: 'Diamond' },
] as const;

export function GradientToolPanel() {
  const { gradientSettings, setGradientSettings } = useUIStore();

  const resetSettings = () => {
    setGradientSettings({
      type: 'linear',
      colors: ['#000000', '#ffffff'],
      opacity: 1,
      reverse: false,
      dither: true,
    });
  };

  const updateColor = (index: number, color: string) => {
    const newColors = [...gradientSettings.colors];
    newColors[index] = color;
    setGradientSettings({ colors: newColors });
  };

  const addColor = () => {
    if (gradientSettings.colors.length >= 5) return;
    const newColors = [...gradientSettings.colors, '#808080'];
    setGradientSettings({ colors: newColors });
  };

  const removeColor = (index: number) => {
    if (gradientSettings.colors.length <= 2) return;
    const newColors = gradientSettings.colors.filter((_, i) => i !== index);
    setGradientSettings({ colors: newColors });
  };

  const gradientStyle = `linear-gradient(to right, ${gradientSettings.colors.join(', ')})`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SquareStack size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Gradient</h3>
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
        Click and drag on canvas to create gradient.
      </p>

      <div className="space-y-3">
        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Type</span>
          <div className="grid grid-cols-5 gap-1">
            {gradientTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setGradientSettings({ type: type.id })}
                className={`px-1 py-1.5 text-[10px] rounded transition-colors ${
                  gradientSettings.type === type.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs text-muted-foreground mb-1.5 block">Preview</span>
          <div
            className="h-6 rounded border border-border"
            style={{ background: gradientStyle }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Colors</span>
            {gradientSettings.colors.length < 5 && (
              <button
                onClick={addColor}
                className="p-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {gradientSettings.colors.map((color, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => updateColor(index, e.target.value)}
                  className="w-8 h-8 rounded border border-border cursor-pointer"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => updateColor(index, e.target.value)}
                  className="flex-1 px-2 py-1 text-xs font-mono bg-secondary/50 border border-border rounded"
                />
                {gradientSettings.colors.length > 2 && (
                  <button
                    onClick={() => removeColor(index)}
                    className="p-1 text-muted-foreground hover:text-destructive rounded hover:bg-secondary transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Opacity</span>
            <span className="text-xs font-mono text-muted-foreground">{Math.round(gradientSettings.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={gradientSettings.opacity * 100}
            onChange={(e) => setGradientSettings({ opacity: Number(e.target.value) / 100 })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="flex gap-4 pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={gradientSettings.reverse}
              onChange={(e) => setGradientSettings({ reverse: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Reverse
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={gradientSettings.dither}
              onChange={(e) => setGradientSettings({ dither: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            Dither
          </label>
        </div>
      </div>
    </div>
  );
}
