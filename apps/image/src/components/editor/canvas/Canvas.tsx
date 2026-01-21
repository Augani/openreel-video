import { useEffect, useRef, useCallback, useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useUIStore } from '../../../stores/ui-store';
import { useCanvasStore } from '../../../stores/canvas-store';
import { calculateSnap } from '../../../utils/snapping';
import type { Layer, ImageLayer, TextLayer, ShapeLayer } from '../../../types/project';
import { Rulers } from './Rulers';

const RULER_SIZE = 20;

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const { project, selectedLayerIds, selectedArtboardId, updateLayerTransform, selectLayer, deselectAllLayers, addPathLayer } = useProjectStore();
  const { zoom, panX, panY, setPan, activeTool, showGrid, showRulers, gridSize, crop, snapToObjects, snapToGuides, snapToGrid, penSettings, drawing, startDrawing, addDrawingPoint, finishDrawing } = useUIStore();
  const { setCanvasRef, setContainerRef, startDrag, updateDrag, endDrag, isDragging, dragMode, dragCurrentX, dragCurrentY, guides, smartGuides, setSmartGuides, clearSmartGuides } = useCanvasStore();

  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);

  useEffect(() => {
    if (canvasRef.current) {
      setCanvasRef(canvasRef.current);
    }
    if (containerRef.current) {
      setContainerRef(containerRef.current);
    }
  }, [setCanvasRef, setContainerRef]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !artboard || !project) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.save();
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2 + panX;
    const centerY = canvas.height / 2 + panY;
    const artboardX = centerX - (artboard.size.width * zoom) / 2;
    const artboardY = centerY - (artboard.size.height * zoom) / 2;

    ctx.save();
    ctx.translate(artboardX, artboardY);
    ctx.scale(zoom, zoom);

    if (artboard.background.type === 'color') {
      ctx.fillStyle = artboard.background.color ?? '#ffffff';
    } else if (artboard.background.type === 'transparent') {
      const patternSize = 10;
      for (let y = 0; y < artboard.size.height; y += patternSize) {
        for (let x = 0; x < artboard.size.width; x += patternSize) {
          ctx.fillStyle = (x + y) % (patternSize * 2) === 0 ? '#ffffff' : '#e5e5e5';
          ctx.fillRect(x, y, patternSize, patternSize);
        }
      }
    } else {
      ctx.fillStyle = '#ffffff';
    }
    if (artboard.background.type !== 'transparent') {
      ctx.fillRect(0, 0, artboard.size.width, artboard.size.height);
    }

    if (showGrid) {
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
      ctx.lineWidth = 1 / zoom;
      for (let x = 0; x <= artboard.size.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, artboard.size.height);
        ctx.stroke();
      }
      for (let y = 0; y <= artboard.size.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(artboard.size.width, y);
        ctx.stroke();
      }
    }

    const sortedLayerIds = [...artboard.layerIds].reverse();
    sortedLayerIds.forEach((layerId) => {
      const layer = project.layers[layerId];
      if (!layer || !layer.visible) return;
      renderLayer(ctx, layer, project);
    });

    ctx.restore();

    selectedLayerIds.forEach((layerId) => {
      const layer = project.layers[layerId];
      if (!layer) return;
      const { x, y, width, height, rotation } = layer.transform;

      ctx.save();
      ctx.translate(artboardX + x * zoom, artboardY + y * zoom);
      ctx.rotate((rotation * Math.PI) / 180);

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(0, 0, width * zoom, height * zoom);

      const handleSize = 8;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;

      const handles = [
        { x: 0, y: 0 },
        { x: width * zoom / 2, y: 0 },
        { x: width * zoom, y: 0 },
        { x: width * zoom, y: height * zoom / 2 },
        { x: width * zoom, y: height * zoom },
        { x: width * zoom / 2, y: height * zoom },
        { x: 0, y: height * zoom },
        { x: 0, y: height * zoom / 2 },
      ];

      handles.forEach((h) => {
        ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
      });

      ctx.restore();
    });

    if (drawing.isDrawing && drawing.currentPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = penSettings.color;
      ctx.lineWidth = penSettings.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = penSettings.opacity;

      ctx.beginPath();
      ctx.moveTo(
        artboardX + drawing.currentPath[0].x * zoom,
        artboardY + drawing.currentPath[0].y * zoom
      );

      for (let i = 1; i < drawing.currentPath.length; i++) {
        ctx.lineTo(
          artboardX + drawing.currentPath[i].x * zoom,
          artboardY + drawing.currentPath[i].y * zoom
        );
      }

      ctx.stroke();
      ctx.restore();
    }

    if (smartGuides.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      smartGuides.forEach((guide) => {
        ctx.beginPath();
        if (guide.type === 'vertical') {
          ctx.moveTo(artboardX + guide.position * zoom, artboardY + guide.start * zoom);
          ctx.lineTo(artboardX + guide.position * zoom, artboardY + guide.end * zoom);
        } else {
          ctx.moveTo(artboardX + guide.start * zoom, artboardY + guide.position * zoom);
          ctx.lineTo(artboardX + guide.end * zoom, artboardY + guide.position * zoom);
        }
        ctx.stroke();
      });

      ctx.restore();
    }

    if (crop.isActive && crop.layerId && crop.cropRect) {
      const cropLayer = project.layers[crop.layerId];
      if (cropLayer) {
        const { x: layerX, y: layerY, width: layerW, height: layerH } = cropLayer.transform;
        const { x: cropX, y: cropY, width: cropW, height: cropH } = crop.cropRect;

        ctx.save();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(
          artboardX + layerX * zoom,
          artboardY + layerY * zoom,
          layerW * zoom,
          cropY * zoom
        );
        ctx.fillRect(
          artboardX + layerX * zoom,
          artboardY + (layerY + cropY + cropH) * zoom,
          layerW * zoom,
          (layerH - cropY - cropH) * zoom
        );
        ctx.fillRect(
          artboardX + layerX * zoom,
          artboardY + (layerY + cropY) * zoom,
          cropX * zoom,
          cropH * zoom
        );
        ctx.fillRect(
          artboardX + (layerX + cropX + cropW) * zoom,
          artboardY + (layerY + cropY) * zoom,
          (layerW - cropX - cropW) * zoom,
          cropH * zoom
        );

        const cX = artboardX + (layerX + cropX) * zoom;
        const cY = artboardY + (layerY + cropY) * zoom;
        const cW = cropW * zoom;
        const cH = cropH * zoom;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(cX, cY, cW, cH);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(cX + (cW * i) / 3, cY);
          ctx.lineTo(cX + (cW * i) / 3, cY + cH);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cX, cY + (cH * i) / 3);
          ctx.lineTo(cX + cW, cY + (cH * i) / 3);
          ctx.stroke();
        }

        const handleSize = 10;
        const handlePositions = [
          { x: cX, y: cY },
          { x: cX + cW / 2, y: cY },
          { x: cX + cW, y: cY },
          { x: cX + cW, y: cY + cH / 2 },
          { x: cX + cW, y: cY + cH },
          { x: cX + cW / 2, y: cY + cH },
          { x: cX, y: cY + cH },
          { x: cX, y: cY + cH / 2 },
        ];

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        handlePositions.forEach((h) => {
          ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        });

        ctx.restore();
      }
    }

    ctx.restore();
  }, [artboard, project, zoom, panX, panY, selectedLayerIds, showGrid, gridSize, crop, smartGuides, drawing, penSettings]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const handleResize = () => {
      render();
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !artboard) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const canvasX = screenX - rect.left;
      const canvasY = screenY - rect.top;

      const centerX = canvas.width / 2 + panX;
      const centerY = canvas.height / 2 + panY;
      const artboardX = centerX - (artboard.size.width * zoom) / 2;
      const artboardY = centerY - (artboard.size.height * zoom) / 2;

      return {
        x: (canvasX - artboardX) / zoom,
        y: (canvasY - artboardY) / zoom,
      };
    },
    [artboard, zoom, panX, panY]
  );

  const findLayerAtPoint = useCallback(
    (x: number, y: number): string | null => {
      if (!artboard || !project) return null;

      for (const layerId of artboard.layerIds) {
        const layer = project.layers[layerId];
        if (!layer || !layer.visible || layer.locked) continue;

        const { transform } = layer;
        if (
          x >= transform.x &&
          x <= transform.x + transform.width &&
          y >= transform.y &&
          y <= transform.y + transform.height
        ) {
          return layerId;
        }
      }
      return null;
    },
    [artboard, project]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { x, y } = screenToCanvas(e.clientX, e.clientY);

      if (activeTool === 'hand' || e.button === 1) {
        startDrag('pan', e.clientX, e.clientY);
        return;
      }

      if (activeTool === 'pen') {
        startDrawing({ x, y });
        return;
      }

      if (activeTool === 'select') {
        const layerId = findLayerAtPoint(x, y);
        if (layerId) {
          if (e.shiftKey) {
            selectLayer(layerId, true);
          } else if (!selectedLayerIds.includes(layerId)) {
            selectLayer(layerId);
          }
          startDrag('move', e.clientX, e.clientY);
        } else {
          deselectAllLayers();
        }
      }
    },
    [activeTool, screenToCanvas, findLayerAtPoint, selectLayer, deselectAllLayers, startDrag, selectedLayerIds, startDrawing]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (drawing.isDrawing) {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        addDrawingPoint({ x, y });
        render();
        return;
      }

      if (!isDragging) return;

      updateDrag(e.clientX, e.clientY);

      if (dragMode === 'pan') {
        const dx = e.clientX - dragCurrentX;
        const dy = e.clientY - dragCurrentY;
        setPan(panX + dx, panY + dy);
      } else if (dragMode === 'move' && selectedLayerIds.length > 0 && artboard) {
        const dx = (e.clientX - dragCurrentX) / zoom;
        const dy = (e.clientY - dragCurrentY) / zoom;

        const firstLayerId = selectedLayerIds[0];
        const firstLayer = project?.layers[firstLayerId];

        if (firstLayer) {
          const newX = firstLayer.transform.x + dx;
          const newY = firstLayer.transform.y + dy;

          const otherLayers = Object.values(project?.layers ?? {}).filter(
            (l) => l && !selectedLayerIds.includes(l.id)
          );

          const snapResult = calculateSnap(
            { x: newX, y: newY, width: firstLayer.transform.width, height: firstLayer.transform.height },
            otherLayers as Layer[],
            { x: 0, y: 0, width: artboard.size.width, height: artboard.size.height },
            guides,
            { snapToObjects, snapToGuides, snapToGrid, gridSize, threshold: 8 }
          );

          const adjustedDx = snapResult.x - firstLayer.transform.x;
          const adjustedDy = snapResult.y - firstLayer.transform.y;

          selectedLayerIds.forEach((layerId) => {
            const layer = project?.layers[layerId];
            if (layer) {
              updateLayerTransform(layerId, {
                x: layer.transform.x + adjustedDx,
                y: layer.transform.y + adjustedDy,
              });
            }
          });

          setSmartGuides(snapResult.guides);
        }
      }
    },
    [isDragging, dragMode, dragCurrentX, dragCurrentY, panX, panY, setPan, zoom, selectedLayerIds, project, updateLayerTransform, updateDrag, artboard, guides, snapToObjects, snapToGuides, snapToGrid, gridSize, setSmartGuides, drawing.isDrawing, screenToCanvas, addDrawingPoint, render]
  );

  const handleMouseUp = useCallback(() => {
    if (drawing.isDrawing) {
      const path = finishDrawing();
      if (path && path.length > 1) {
        addPathLayer(path, penSettings.color, penSettings.width);
      }
      render();
      return;
    }

    endDrag();
    clearSmartGuides();
  }, [endDrag, clearSmartGuides, drawing.isDrawing, finishDrawing, addPathLayer, penSettings, render]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        useUIStore.getState().setZoom(zoom * delta);
      } else {
        setPan(panX - e.deltaX, panY - e.deltaY);
      }
    },
    [zoom, panX, panY, setPan]
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden cursor-crosshair relative"
      style={{
        cursor: activeTool === 'hand' ? 'grab' : activeTool === 'select' ? 'default' : 'crosshair',
      }}
    >
      {showRulers && (
        <Rulers
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="absolute"
        style={{
          top: showRulers ? RULER_SIZE : 0,
          left: showRulers ? RULER_SIZE : 0,
          width: showRulers ? `calc(100% - ${RULER_SIZE}px)` : '100%',
          height: showRulers ? `calc(100% - ${RULER_SIZE}px)` : '100%',
        }}
      />
    </div>
  );
}

function renderLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  project: { assets: Record<string, { dataUrl?: string; blobUrl?: string }> }
) {
  const { transform, shadow, glow } = layer;

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.globalAlpha = transform.opacity;

  if (glow.enabled && glow.blur > 0) {
    ctx.save();
    ctx.shadowColor = glow.color;
    ctx.shadowBlur = glow.blur * glow.intensity;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (let i = 0; i < 3; i++) {
      renderLayerContent(ctx, layer, project);
    }
    ctx.restore();
  }

  if (shadow.enabled) {
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
  }

  renderLayerContent(ctx, layer, project);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.restore();
}

function renderLayerContent(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  project: { assets: Record<string, { dataUrl?: string; blobUrl?: string }> }
) {
  switch (layer.type) {
    case 'image':
      renderImageLayer(ctx, layer as ImageLayer, project);
      break;
    case 'text':
      renderTextLayer(ctx, layer as TextLayer);
      break;
    case 'shape':
      renderShapeLayer(ctx, layer as ShapeLayer);
      break;
  }
}

function applyMotionBlur(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  amount: number,
  angle: number
) {
  const steps = Math.min(Math.ceil(amount / 2), 20);
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) * (amount / steps);
  const dy = Math.sin(radians) * (amount / steps);

  for (let i = -steps; i <= steps; i++) {
    const alpha = 1 / (Math.abs(i) + 1);
    ctx.globalAlpha = alpha / (steps * 2);
    ctx.drawImage(img, i * dx, i * dy, width, height);
  }
  ctx.globalAlpha = 1;
}

function applyRadialBlur(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  amount: number
) {
  const steps = Math.min(Math.ceil(amount / 2), 15);
  const centerX = width / 2;
  const centerY = height / 2;

  for (let i = 0; i < steps; i++) {
    const scale = 1 + (i * amount) / (steps * 100);
    const alpha = 1 / (i + 1);
    ctx.globalAlpha = alpha / steps;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);
    ctx.drawImage(img, 0, 0, width, height);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function renderImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  project: { assets: Record<string, { dataUrl?: string; blobUrl?: string }> }
) {
  const asset = project.assets[layer.sourceId];
  if (!asset) {
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(0, 0, layer.transform.width, layer.transform.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Image', layer.transform.width / 2, layer.transform.height / 2);
    return;
  }

  const img = new window.Image();
  img.src = asset.dataUrl ?? asset.blobUrl ?? '';
  if (img.complete) {
    const { filters } = layer;
    const filterParts: string[] = [];

    if (filters.brightness !== 100) {
      filterParts.push(`brightness(${filters.brightness}%)`);
    }
    if (filters.contrast !== 100) {
      filterParts.push(`contrast(${filters.contrast}%)`);
    }
    if (filters.saturation !== 100) {
      filterParts.push(`saturate(${filters.saturation}%)`);
    }
    if (filters.hue !== 0) {
      filterParts.push(`hue-rotate(${filters.hue}deg)`);
    }
    if (filters.sepia > 0) {
      filterParts.push(`sepia(${filters.sepia}%)`);
    }
    if (filters.invert > 0) {
      filterParts.push(`invert(${filters.invert}%)`);
    }

    if (filters.blur > 0 && filters.blurType === 'gaussian') {
      filterParts.push(`blur(${filters.blur}px)`);
    }

    if (filterParts.length > 0) {
      ctx.filter = filterParts.join(' ');
    }

    if (filters.blur > 0 && filters.blurType === 'motion') {
      applyMotionBlur(ctx, img, layer.transform.width, layer.transform.height, filters.blur, filters.blurAngle);
    } else if (filters.blur > 0 && filters.blurType === 'radial') {
      applyRadialBlur(ctx, img, layer.transform.width, layer.transform.height, filters.blur);
    } else {
      ctx.drawImage(img, 0, 0, layer.transform.width, layer.transform.height);
    }

    ctx.filter = 'none';
  }
}

function renderTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer) {
  const { style, content, transform } = layer;

  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  ctx.textAlign = style.textAlign as CanvasTextAlign;
  ctx.textBaseline = 'top';

  const lines = content.split('\n');
  const lineHeight = style.fontSize * style.lineHeight;

  let textX = 0;
  if (style.textAlign === 'center') textX = transform.width / 2;
  else if (style.textAlign === 'right') textX = transform.width;

  if (style.backgroundColor) {
    const padding = style.backgroundPadding ?? 8;
    const radius = style.backgroundRadius ?? 4;
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const textHeight = lines.length * lineHeight;

    let bgX = -padding;
    if (style.textAlign === 'center') bgX = (transform.width - textWidth) / 2 - padding;
    else if (style.textAlign === 'right') bgX = transform.width - textWidth - padding;

    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    const bgW = textWidth + padding * 2;
    const bgH = textHeight + padding * 2;
    const bgY = -padding;
    const r = Math.min(radius, bgW / 2, bgH / 2);
    ctx.moveTo(bgX + r, bgY);
    ctx.lineTo(bgX + bgW - r, bgY);
    ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + r);
    ctx.lineTo(bgX + bgW, bgY + bgH - r);
    ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - r, bgY + bgH);
    ctx.lineTo(bgX + r, bgY + bgH);
    ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - r);
    ctx.lineTo(bgX, bgY + r);
    ctx.quadraticCurveTo(bgX, bgY, bgX + r, bgY);
    ctx.closePath();
    ctx.fill();
  }

  let fillStyle: string | CanvasGradient = style.color;
  if (style.fillType === 'gradient' && style.gradient && lines.length > 0) {
    const lineWidths = lines.map((line) => ctx.measureText(line).width);
    const textWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
    const textHeight = lines.length * lineHeight;

    if (textWidth > 0 && textHeight > 0) {
      let gradientStartX = 0;
      if (style.textAlign === 'center') gradientStartX = (transform.width - textWidth) / 2;
      else if (style.textAlign === 'right') gradientStartX = transform.width - textWidth;

      if (style.gradient.type === 'linear') {
        const angleRad = (style.gradient.angle * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const halfWidth = textWidth / 2;
        const halfHeight = textHeight / 2;
        const len = Math.abs(halfWidth * cos) + Math.abs(halfHeight * sin);

        const centerX = gradientStartX + halfWidth;
        const centerY = halfHeight;
        const gradient = ctx.createLinearGradient(
          centerX - len * cos,
          centerY - len * sin,
          centerX + len * cos,
          centerY + len * sin
        );
        style.gradient.stops.forEach((stop) => {
          gradient.addColorStop(stop.offset, stop.color);
        });
        fillStyle = gradient;
      } else {
        const centerX = gradientStartX + textWidth / 2;
        const centerY = textHeight / 2;
        const radius = Math.max(textWidth, textHeight) / 2;
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        style.gradient.stops.forEach((stop) => {
          gradient.addColorStop(stop.offset, stop.color);
        });
        fillStyle = gradient;
      }
    }
  }

  if (style.textShadow?.enabled) {
    ctx.shadowColor = style.textShadow.color;
    ctx.shadowBlur = style.textShadow.blur;
    ctx.shadowOffsetX = style.textShadow.offsetX;
    ctx.shadowOffsetY = style.textShadow.offsetY;
  }

  lines.forEach((line, i) => {
    const y = i * lineHeight;

    if (style.strokeColor && (style.strokeWidth ?? 0) > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth ?? 1;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, textX, y);
    }

    ctx.fillStyle = fillStyle;
    ctx.fillText(line, textX, y);
  });

  if (style.textShadow?.enabled) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

function renderShapeLayer(ctx: CanvasRenderingContext2D, layer: ShapeLayer) {
  const { shapeType, shapeStyle, transform } = layer;
  const { width, height } = transform;

  ctx.beginPath();

  switch (shapeType) {
    case 'rectangle': {
      let tl = 0, tr = 0, br = 0, bl = 0;

      if (shapeStyle.individualCorners && shapeStyle.corners) {
        tl = Math.min(shapeStyle.corners.topLeft, width / 2, height / 2);
        tr = Math.min(shapeStyle.corners.topRight, width / 2, height / 2);
        br = Math.min(shapeStyle.corners.bottomRight, width / 2, height / 2);
        bl = Math.min(shapeStyle.corners.bottomLeft, width / 2, height / 2);
      } else if (shapeStyle.cornerRadius > 0) {
        const r = Math.min(shapeStyle.cornerRadius, width / 2, height / 2);
        tl = tr = br = bl = r;
      }

      if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        ctx.moveTo(tl, 0);
        ctx.lineTo(width - tr, 0);
        if (tr > 0) ctx.quadraticCurveTo(width, 0, width, tr);
        else ctx.lineTo(width, 0);
        ctx.lineTo(width, height - br);
        if (br > 0) ctx.quadraticCurveTo(width, height, width - br, height);
        else ctx.lineTo(width, height);
        ctx.lineTo(bl, height);
        if (bl > 0) ctx.quadraticCurveTo(0, height, 0, height - bl);
        else ctx.lineTo(0, height);
        ctx.lineTo(0, tl);
        if (tl > 0) ctx.quadraticCurveTo(0, 0, tl, 0);
        else ctx.lineTo(0, 0);
        ctx.closePath();
      } else {
        ctx.rect(0, 0, width, height);
      }
      break;
    }

    case 'ellipse':
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      break;

    case 'triangle':
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      break;

    case 'polygon': {
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) / 2;
      const sides = layer.sides ?? 6;
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case 'star': {
      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.min(width, height) / 2;
      const innerRatio = layer.innerRadius ?? 0.4;
      const innerRadius = outerRadius * innerRatio;
      const points = layer.sides ?? 5;
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case 'line':
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      break;

    case 'arrow': {
      const arrowHeadSize = Math.min(width, height) * 0.3;
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width - arrowHeadSize, height / 2);
      ctx.moveTo(width, height / 2);
      ctx.lineTo(width - arrowHeadSize, height / 2 - arrowHeadSize / 2);
      ctx.moveTo(width, height / 2);
      ctx.lineTo(width - arrowHeadSize, height / 2 + arrowHeadSize / 2);
      break;
    }

    case 'path':
      if (layer.points && layer.points.length > 1) {
        ctx.moveTo(layer.points[0].x, layer.points[0].y);
        for (let i = 1; i < layer.points.length; i++) {
          ctx.lineTo(layer.points[i].x, layer.points[i].y);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      break;

    default:
      ctx.rect(0, 0, width, height);
  }

  if (shapeStyle.fill) {
    ctx.fillStyle = shapeStyle.fill;
    ctx.globalAlpha *= shapeStyle.fillOpacity;
    ctx.fill();
    ctx.globalAlpha /= shapeStyle.fillOpacity;
  }

  if (shapeStyle.stroke) {
    ctx.strokeStyle = shapeStyle.stroke;
    ctx.lineWidth = shapeStyle.strokeWidth;
    ctx.globalAlpha *= shapeStyle.strokeOpacity;

    const sw = shapeStyle.strokeWidth;
    switch (shapeStyle.strokeDash ?? 'solid') {
      case 'dashed':
        ctx.setLineDash([sw * 3, sw * 2]);
        break;
      case 'dotted':
        ctx.setLineDash([sw, sw * 2]);
        ctx.lineCap = 'round';
        break;
      case 'dash-dot':
        ctx.setLineDash([sw * 4, sw * 2, sw, sw * 2]);
        break;
      case 'long-dash':
        ctx.setLineDash([sw * 6, sw * 3]);
        break;
      default:
        ctx.setLineDash([]);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }
}
