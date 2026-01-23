import { ChevronDown, Minus, Plus, Maximize2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Slider,
} from '@openreel/ui';
import { useUIStore } from '../../../stores/ui-store';
import { useProjectStore } from '../../../stores/project-store';

const ZOOM_PRESETS = [
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
  { label: '400%', value: 4 },
];

export function ZoomControl() {
  const { zoom, setZoom, zoomIn, zoomOut, resetView } = useUIStore();
  const { project } = useProjectStore();

  const handleZoomToFit = () => {
    const activeId = project?.activeArtboardId;
    const artboard = activeId ? project?.artboards.find((a) => a.id === activeId) : null;
    if (!artboard) {
      resetView();
      return;
    }

    const viewportWidth = window.innerWidth - 600;
    const viewportHeight = window.innerHeight - 200;

    if (artboard.size.width <= 0 || artboard.size.height <= 0) {
      resetView();
      return;
    }

    const fitZoom = Math.min(
      viewportWidth / artboard.size.width,
      viewportHeight / artboard.size.height,
      1
    );

    setZoom(Math.max(0.1, Math.min(fitZoom * 0.9, 1)));
  };

  const handleZoomToFill = () => {
    const activeId = project?.activeArtboardId;
    const artboard = activeId ? project?.artboards.find((a) => a.id === activeId) : null;
    if (!artboard) {
      resetView();
      return;
    }

    const viewportWidth = window.innerWidth - 600;
    const viewportHeight = window.innerHeight - 200;

    if (artboard.size.width <= 0 || artboard.size.height <= 0) {
      resetView();
      return;
    }

    const fillZoom = Math.max(
      viewportWidth / artboard.size.width,
      viewportHeight / artboard.size.height
    );

    setZoom(Math.min(fillZoom * 0.9, 4));
  };

  const handleSliderChange = (values: number[]) => {
    const logValue = values[0];
    const zoom = Math.pow(10, logValue);
    setZoom(zoom);
  };

  const logZoom = Math.log10(zoom);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={zoomOut}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Zoom out (-)"
      >
        <Minus size={14} />
      </button>

      <div className="w-20 px-1">
        <Slider
          value={[logZoom]}
          onValueChange={handleSliderChange}
          min={Math.log10(0.1)}
          max={Math.log10(8)}
          step={0.01}
          className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
        />
      </div>

      <button
        onClick={zoomIn}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Zoom in (+)"
      >
        <Plus size={14} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors min-w-[52px] justify-center">
            {Math.round(zoom * 100)}%
            <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[120px]">
          {ZOOM_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.value}
              onClick={() => setZoom(preset.value)}
              className={zoom === preset.value ? 'bg-accent' : ''}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleZoomToFit}>
            <Maximize2 size={14} className="mr-2" />
            Fit to Canvas
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleZoomToFill}>
            <Maximize2 size={14} className="mr-2" />
            Fill View
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={resetView}>
            Reset (100%)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
