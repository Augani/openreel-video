import { useProjectStore } from '../../../stores/project-store';
import type { Artboard, CanvasBackground } from '../../../types/project';

interface Props {
  artboard: Artboard;
}

export function ArtboardSection({ artboard }: Props) {
  const { updateArtboard } = useProjectStore();

  const handleSizeChange = (key: 'width' | 'height', value: number) => {
    updateArtboard(artboard.id, {
      size: { ...artboard.size, [key]: value },
    });
  };

  const handleBackgroundTypeChange = (type: CanvasBackground['type']) => {
    let background: CanvasBackground;
    switch (type) {
      case 'color':
        background = { type: 'color', color: '#ffffff' };
        break;
      case 'transparent':
        background = { type: 'transparent' };
        break;
      case 'gradient':
        background = {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 180,
            stops: [
              { offset: 0, color: '#ffffff' },
              { offset: 1, color: '#000000' },
            ],
          },
        };
        break;
      default:
        background = { type: 'color', color: '#ffffff' };
    }
    updateArtboard(artboard.id, { background });
  };

  const handleBackgroundColorChange = (color: string) => {
    updateArtboard(artboard.id, {
      background: { type: 'color', color },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] text-muted-foreground mb-1">Name</label>
        <input
          type="text"
          value={artboard.name}
          onChange={(e) => updateArtboard(artboard.id, { name: e.target.value })}
          className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Width</label>
          <input
            type="number"
            value={artboard.size.width}
            onChange={(e) => handleSizeChange('width', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            min={1}
            max={8000}
          />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Height</label>
          <input
            type="number"
            value={artboard.size.height}
            onChange={(e) => handleSizeChange('height', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            min={1}
            max={8000}
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] text-muted-foreground mb-1">Background</label>
        <select
          value={artboard.background.type}
          onChange={(e) => handleBackgroundTypeChange(e.target.value as CanvasBackground['type'])}
          className="w-full px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary mb-2"
        >
          <option value="color">Solid Color</option>
          <option value="transparent">Transparent</option>
          <option value="gradient">Gradient</option>
        </select>

        {artboard.background.type === 'color' && (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={artboard.background.color ?? '#ffffff'}
              onChange={(e) => handleBackgroundColorChange(e.target.value)}
              className="w-8 h-8 rounded border border-input cursor-pointer"
            />
            <input
              type="text"
              value={artboard.background.color ?? '#ffffff'}
              onChange={(e) => handleBackgroundColorChange(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>
        )}

        {artboard.background.type === 'transparent' && (
          <div className="p-3 rounded-md bg-background border border-input">
            <div
              className="h-8 rounded"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                backgroundSize: '10px 10px',
                backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
              }}
            />
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Transparency pattern
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
