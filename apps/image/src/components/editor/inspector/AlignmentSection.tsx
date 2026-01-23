import { useProjectStore } from '../../../stores/project-store';
import type { Layer } from '../../../types/project';
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
} from 'lucide-react';

interface Props {
  layers: Layer[];
}

export function AlignmentSection({ layers }: Props) {
  const { project, selectedArtboardId, updateLayerTransform } = useProjectStore();

  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);

  if (!artboard || layers.length === 0) return null;

  const alignLeft = () => {
    if (layers.length === 1) {
      updateLayerTransform(layers[0].id, { x: 0 });
    } else {
      const minX = Math.min(...layers.map((l) => l.transform.x));
      layers.forEach((layer) => {
        updateLayerTransform(layer.id, { x: minX });
      });
    }
  };

  const alignCenterH = () => {
    if (layers.length === 1) {
      const layer = layers[0];
      updateLayerTransform(layer.id, {
        x: (artboard.size.width - layer.transform.width) / 2,
      });
    } else {
      const bounds = getBounds(layers);
      const centerX = bounds.x + bounds.width / 2;
      layers.forEach((layer) => {
        updateLayerTransform(layer.id, {
          x: centerX - layer.transform.width / 2,
        });
      });
    }
  };

  const alignRight = () => {
    if (layers.length === 1) {
      const layer = layers[0];
      updateLayerTransform(layer.id, {
        x: artboard.size.width - layer.transform.width,
      });
    } else {
      const maxRight = Math.max(...layers.map((l) => l.transform.x + l.transform.width));
      layers.forEach((layer) => {
        updateLayerTransform(layer.id, {
          x: maxRight - layer.transform.width,
        });
      });
    }
  };

  const alignTop = () => {
    if (layers.length === 1) {
      updateLayerTransform(layers[0].id, { y: 0 });
    } else {
      const minY = Math.min(...layers.map((l) => l.transform.y));
      layers.forEach((layer) => {
        updateLayerTransform(layer.id, { y: minY });
      });
    }
  };

  const alignCenterV = () => {
    if (layers.length === 1) {
      const layer = layers[0];
      updateLayerTransform(layer.id, {
        y: (artboard.size.height - layer.transform.height) / 2,
      });
    } else {
      const bounds = getBounds(layers);
      const centerY = bounds.y + bounds.height / 2;
      layers.forEach((layer) => {
        updateLayerTransform(layer.id, {
          y: centerY - layer.transform.height / 2,
        });
      });
    }
  };

  const alignBottom = () => {
    if (layers.length === 1) {
      const layer = layers[0];
      updateLayerTransform(layer.id, {
        y: artboard.size.height - layer.transform.height,
      });
    } else {
      const maxBottom = Math.max(...layers.map((l) => l.transform.y + l.transform.height));
      layers.forEach((layer) => {
        updateLayerTransform(layer.id, {
          y: maxBottom - layer.transform.height,
        });
      });
    }
  };

  const distributeH = () => {
    if (layers.length < 3) return;

    const sorted = [...layers].sort((a, b) => a.transform.x - b.transform.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalWidth = last.transform.x + last.transform.width - first.transform.x;
    const layersWidth = sorted.reduce((sum, l) => sum + l.transform.width, 0);
    const gap = (totalWidth - layersWidth) / (sorted.length - 1);

    let x = first.transform.x;
    sorted.forEach((layer) => {
      updateLayerTransform(layer.id, { x });
      x += layer.transform.width + gap;
    });
  };

  const distributeV = () => {
    if (layers.length < 3) return;

    const sorted = [...layers].sort((a, b) => a.transform.y - b.transform.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalHeight = last.transform.y + last.transform.height - first.transform.y;
    const layersHeight = sorted.reduce((sum, l) => sum + l.transform.height, 0);
    const gap = (totalHeight - layersHeight) / (sorted.length - 1);

    let y = first.transform.y;
    sorted.forEach((layer) => {
      updateLayerTransform(layer.id, { y });
      y += layer.transform.height + gap;
    });
  };

  const isSingleLayer = layers.length === 1;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Alignment
      </h4>

      <div className="grid grid-cols-6 gap-1">
        <AlignButton
          icon={<AlignHorizontalJustifyStart size={14} />}
          onClick={alignLeft}
          title={isSingleLayer ? 'Align to canvas left' : 'Align left edges'}
        />
        <AlignButton
          icon={<AlignHorizontalJustifyCenter size={14} />}
          onClick={alignCenterH}
          title={isSingleLayer ? 'Center horizontally on canvas' : 'Align horizontal centers'}
        />
        <AlignButton
          icon={<AlignHorizontalJustifyEnd size={14} />}
          onClick={alignRight}
          title={isSingleLayer ? 'Align to canvas right' : 'Align right edges'}
        />
        <AlignButton
          icon={<AlignVerticalJustifyStart size={14} />}
          onClick={alignTop}
          title={isSingleLayer ? 'Align to canvas top' : 'Align top edges'}
        />
        <AlignButton
          icon={<AlignVerticalJustifyCenter size={14} />}
          onClick={alignCenterV}
          title={isSingleLayer ? 'Center vertically on canvas' : 'Align vertical centers'}
        />
        <AlignButton
          icon={<AlignVerticalJustifyEnd size={14} />}
          onClick={alignBottom}
          title={isSingleLayer ? 'Align to canvas bottom' : 'Align bottom edges'}
        />
      </div>

      {layers.length >= 3 && (
        <div className="grid grid-cols-2 gap-1 pt-2 border-t border-border">
          <AlignButton
            icon={<AlignHorizontalSpaceBetween size={14} />}
            onClick={distributeH}
            title="Distribute horizontally"
            label="Distribute H"
          />
          <AlignButton
            icon={<AlignVerticalSpaceBetween size={14} />}
            onClick={distributeV}
            title="Distribute vertically"
            label="Distribute V"
          />
        </div>
      )}
    </div>
  );
}

interface AlignButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  label?: string;
}

function AlignButton({ icon, onClick, title, label }: AlignButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center gap-1 p-2 rounded-md bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
    >
      {icon}
      {label && <span className="text-[9px]">{label}</span>}
    </button>
  );
}

function getBounds(layers: Layer[]): { x: number; y: number; width: number; height: number } {
  const minX = Math.min(...layers.map((l) => l.transform.x));
  const minY = Math.min(...layers.map((l) => l.transform.y));
  const maxX = Math.max(...layers.map((l) => l.transform.x + l.transform.width));
  const maxY = Math.max(...layers.map((l) => l.transform.y + l.transform.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
