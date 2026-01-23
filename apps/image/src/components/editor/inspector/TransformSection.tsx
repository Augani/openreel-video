import { FlipHorizontal2, FlipVertical2, RotateCw, RotateCcw } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';

interface Props {
  layer: Layer;
}

export function TransformSection({ layer }: Props) {
  const { updateLayer, updateLayerTransform } = useProjectStore();

  const { x, y, width, height, rotation, skewX, skewY, opacity } = layer.transform;
  const flipH = layer.flipHorizontal ?? false;
  const flipV = layer.flipVertical ?? false;

  const handleChange = (key: string, value: number) => {
    updateLayerTransform(layer.id, { [key]: value });
  };

  const handleFlipHorizontal = () => {
    updateLayer(layer.id, { flipHorizontal: !flipH });
  };

  const handleFlipVertical = () => {
    updateLayer(layer.id, { flipVertical: !flipV });
  };

  const handleRotate = (degrees: number) => {
    updateLayerTransform(layer.id, {
      rotation: (rotation + degrees) % 360,
    });
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Transform
      </h4>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">X</label>
          <input
            type="number"
            value={Math.round(x)}
            onChange={(e) => handleChange('x', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Y</label>
          <input
            type="number"
            value={Math.round(y)}
            onChange={(e) => handleChange('y', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Width</label>
          <input
            type="number"
            value={Math.round(width)}
            onChange={(e) => handleChange('width', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            min={1}
          />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Height</label>
          <input
            type="number"
            value={Math.round(height)}
            onChange={(e) => handleChange('height', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            min={1}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Rotation</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={Math.round(rotation)}
              onChange={(e) => handleChange('rotation', Number(e.target.value))}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">°</span>
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Opacity</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={Math.round(opacity * 100)}
              onChange={(e) => handleChange('opacity', Number(e.target.value) / 100)}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              min={0}
              max={100}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Skew X</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={Math.round(skewX ?? 0)}
              onChange={(e) => handleChange('skewX', Number(e.target.value))}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              min={-89}
              max={89}
            />
            <span className="text-xs text-muted-foreground">°</span>
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Skew Y</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={Math.round(skewY ?? 0)}
              onChange={(e) => handleChange('skewY', Number(e.target.value))}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              min={-89}
              max={89}
            />
            <span className="text-xs text-muted-foreground">°</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button
          onClick={handleFlipHorizontal}
          className={`flex items-center justify-center gap-1 p-2 rounded-md border transition-all ${
            flipH
              ? 'bg-primary/20 border-primary text-primary'
              : 'bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
          title="Flip Horizontal"
        >
          <FlipHorizontal2 size={14} />
        </button>

        <button
          onClick={handleFlipVertical}
          className={`flex items-center justify-center gap-1 p-2 rounded-md border transition-all ${
            flipV
              ? 'bg-primary/20 border-primary text-primary'
              : 'bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
          title="Flip Vertical"
        >
          <FlipVertical2 size={14} />
        </button>

        <button
          onClick={() => handleRotate(-90)}
          className="flex items-center justify-center gap-1 p-2 rounded-md bg-secondary/50 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          title="Rotate 90° Counter-clockwise"
        >
          <RotateCcw size={14} />
        </button>

        <button
          onClick={() => handleRotate(90)}
          className="flex items-center justify-center gap-1 p-2 rounded-md bg-secondary/50 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          title="Rotate 90° Clockwise"
        >
          <RotateCw size={14} />
        </button>
      </div>
    </div>
  );
}
