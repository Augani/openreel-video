import { useEffect, useRef } from 'react';
import { useUIStore } from '../../../stores/ui-store';
import { useProjectStore } from '../../../stores/project-store';

const RULER_SIZE = 20;
const RULER_BG = '#1f1f23';
const RULER_TEXT = '#71717a';
const RULER_TICK = '#3f3f46';
const RULER_HIGHLIGHT = '#3b82f6';

interface RulersProps {
  containerWidth: number;
  containerHeight: number;
}

export function Rulers({ containerWidth, containerHeight }: RulersProps) {
  const horizontalRef = useRef<HTMLCanvasElement>(null);
  const verticalRef = useRef<HTMLCanvasElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);

  const { zoom, panX, panY, showRulers } = useUIStore();
  const { project, selectedArtboardId } = useProjectStore();

  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);

  useEffect(() => {
    if (!showRulers || !artboard) return;
    if (containerWidth <= RULER_SIZE || containerHeight <= RULER_SIZE) return;

    const hCanvas = horizontalRef.current;
    const vCanvas = verticalRef.current;
    if (!hCanvas || !vCanvas) return;

    const hCtx = hCanvas.getContext('2d');
    const vCtx = vCanvas.getContext('2d');
    if (!hCtx || !vCtx) return;

    hCanvas.width = containerWidth - RULER_SIZE;
    hCanvas.height = RULER_SIZE;
    vCanvas.width = RULER_SIZE;
    vCanvas.height = containerHeight - RULER_SIZE;

    const centerX = containerWidth / 2 + panX;
    const centerY = containerHeight / 2 + panY;
    const artboardX = centerX - (artboard.size.width * zoom) / 2;
    const artboardY = centerY - (artboard.size.height * zoom) / 2;

    renderHorizontalRuler(hCtx, containerWidth, artboardX, artboard.size.width, zoom);
    renderVerticalRuler(vCtx, containerHeight, artboardY, artboard.size.height, zoom);
  }, [containerWidth, containerHeight, zoom, panX, panY, showRulers, artboard]);

  if (!showRulers) return null;

  return (
    <>
      <div
        ref={cornerRef}
        className="absolute top-0 left-0 z-20"
        style={{
          width: RULER_SIZE,
          height: RULER_SIZE,
          backgroundColor: RULER_BG,
          borderRight: `1px solid ${RULER_TICK}`,
          borderBottom: `1px solid ${RULER_TICK}`,
        }}
      />
      <canvas
        ref={horizontalRef}
        className="absolute top-0 z-10"
        style={{
          left: RULER_SIZE,
          width: containerWidth - RULER_SIZE,
          height: RULER_SIZE,
          backgroundColor: RULER_BG,
        }}
      />
      <canvas
        ref={verticalRef}
        className="absolute left-0 z-10"
        style={{
          top: RULER_SIZE,
          width: RULER_SIZE,
          height: containerHeight - RULER_SIZE,
          backgroundColor: RULER_BG,
        }}
      />
    </>
  );
}

function getTickInterval(zoom: number): { major: number; minor: number } {
  const baseUnit = 100;
  const scaledUnit = baseUnit / zoom;

  if (scaledUnit < 50) return { major: 50, minor: 10 };
  if (scaledUnit < 100) return { major: 100, minor: 20 };
  if (scaledUnit < 200) return { major: 100, minor: 25 };
  if (scaledUnit < 500) return { major: 200, minor: 50 };
  if (scaledUnit < 1000) return { major: 500, minor: 100 };
  return { major: 1000, minor: 200 };
}

function renderHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  width: number,
  artboardX: number,
  artboardWidth: number,
  zoom: number
) {
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, width, RULER_SIZE);

  const { major, minor } = getTickInterval(zoom);

  ctx.strokeStyle = RULER_TICK;
  ctx.fillStyle = RULER_TEXT;
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const startX = -Math.ceil(artboardX / (minor * zoom)) * minor;
  const endX = artboardWidth + Math.ceil((width - artboardX - artboardWidth * zoom) / (minor * zoom)) * minor;

  for (let i = startX; i <= endX; i += minor) {
    const screenX = artboardX + i * zoom - RULER_SIZE;
    if (screenX < 0 || screenX > width) continue;

    const isMajor = i % major === 0;
    const tickHeight = isMajor ? 12 : 6;

    ctx.beginPath();
    ctx.moveTo(screenX, RULER_SIZE);
    ctx.lineTo(screenX, RULER_SIZE - tickHeight);
    ctx.stroke();

    if (isMajor) {
      ctx.fillText(String(i), screenX, 2);
    }
  }

  const artboardStart = artboardX - RULER_SIZE;
  const artboardEnd = artboardX + artboardWidth * zoom - RULER_SIZE;

  ctx.strokeStyle = RULER_HIGHLIGHT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.max(0, artboardStart), RULER_SIZE - 1);
  ctx.lineTo(Math.min(width, artboardEnd), RULER_SIZE - 1);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function renderVerticalRuler(
  ctx: CanvasRenderingContext2D,
  height: number,
  artboardY: number,
  artboardHeight: number,
  zoom: number
) {
  ctx.fillStyle = RULER_BG;
  ctx.fillRect(0, 0, RULER_SIZE, height);

  const { major, minor } = getTickInterval(zoom);

  ctx.strokeStyle = RULER_TICK;
  ctx.fillStyle = RULER_TEXT;
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const startY = -Math.ceil(artboardY / (minor * zoom)) * minor;
  const endY = artboardHeight + Math.ceil((height - artboardY - artboardHeight * zoom) / (minor * zoom)) * minor;

  for (let i = startY; i <= endY; i += minor) {
    const screenY = artboardY + i * zoom - RULER_SIZE;
    if (screenY < 0 || screenY > height) continue;

    const isMajor = i % major === 0;
    const tickWidth = isMajor ? 12 : 6;

    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, screenY);
    ctx.lineTo(RULER_SIZE - tickWidth, screenY);
    ctx.stroke();

    if (isMajor) {
      ctx.save();
      ctx.translate(10, screenY);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(String(i), 0, 0);
      ctx.restore();
    }
  }

  const artboardStart = artboardY - RULER_SIZE;
  const artboardEnd = artboardY + artboardHeight * zoom - RULER_SIZE;

  ctx.strokeStyle = RULER_HIGHLIGHT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE - 1, Math.max(0, artboardStart));
  ctx.lineTo(RULER_SIZE - 1, Math.min(height, artboardEnd));
  ctx.stroke();
  ctx.lineWidth = 1;
}
