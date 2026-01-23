import type { Project, Artboard, Layer, ImageLayer, TextLayer, ShapeLayer, Filter } from '../types/project';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg' | 'pdf';
export type ExportQuality = 'low' | 'medium' | 'high' | 'max';

export interface ExportOptions {
  format: ExportFormat;
  quality: ExportQuality;
  scale: number;
  background: 'include' | 'transparent';
  artboardIds?: string[];
}

const QUALITY_MAP: Record<ExportQuality, number> = {
  low: 0.6,
  medium: 0.8,
  high: 0.92,
  max: 1.0,
};

const BLEND_MODE_MAP: Record<string, GlobalCompositeOperation> = {
  'normal': 'source-over',
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  'difference': 'difference',
  'exclusion': 'exclusion',
};

export async function exportProject(
  project: Project,
  options: ExportOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  const artboards = options.artboardIds
    ? project.artboards.filter((a) => options.artboardIds!.includes(a.id))
    : project.artboards;

  for (let i = 0; i < artboards.length; i++) {
    const artboard = artboards[i];
    onProgress?.((i / artboards.length) * 100, `Exporting ${artboard.name}...`);

    const blob = await exportArtboard(project, artboard, options);
    blobs.push(blob);
  }

  onProgress?.(100, 'Export complete');
  return blobs;
}

export async function exportArtboard(
  project: Project,
  artboard: Artboard,
  options: ExportOptions
): Promise<Blob> {
  const { scale, format, quality, background } = options;
  const width = artboard.size.width * scale;
  const height = artboard.size.height * scale;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  if (background === 'include' || format === 'jpg') {
    if (artboard.background.type === 'color') {
      ctx.fillStyle = artboard.background.color ?? '#ffffff';
      ctx.fillRect(0, 0, artboard.size.width, artboard.size.height);
    } else if (artboard.background.type === 'transparent' && format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, artboard.size.width, artboard.size.height);
    } else if (artboard.background.type === 'gradient' && artboard.background.gradient) {
      const { gradient } = artboard.background;
      const rad = (gradient.angle * Math.PI) / 180;
      const x1 = artboard.size.width / 2 - Math.cos(rad) * artboard.size.width / 2;
      const y1 = artboard.size.height / 2 - Math.sin(rad) * artboard.size.height / 2;
      const x2 = artboard.size.width / 2 + Math.cos(rad) * artboard.size.width / 2;
      const y2 = artboard.size.height / 2 + Math.sin(rad) * artboard.size.height / 2;

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      gradient.stops.forEach((stop) => {
        grad.addColorStop(stop.offset, stop.color);
      });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, artboard.size.width, artboard.size.height);
    }
  }

  const sortedLayerIds = [...artboard.layerIds].reverse();
  for (const layerId of sortedLayerIds) {
    const layer = project.layers[layerId];
    if (!layer || !layer.visible) continue;
    await renderLayerToContext(ctx, layer, project);
  }

  const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const qualityValue = format === 'png' ? undefined : QUALITY_MAP[quality];

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob!),
      mimeType,
      qualityValue
    );
  });
}

async function renderLayerToContext(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  project: Project
): Promise<void> {
  const { transform } = layer;
  const shadow = layer.shadow ?? { enabled: false, color: 'rgba(0, 0, 0, 0.5)', blur: 10, offsetX: 0, offsetY: 4 };
  const innerShadow = layer.innerShadow ?? { enabled: false, color: 'rgba(0, 0, 0, 0.5)', blur: 10, offsetX: 2, offsetY: 2 };
  const glow = layer.glow ?? { enabled: false, color: '#ffffff', blur: 20, intensity: 1 };
  const blendMode = layer.blendMode?.mode ?? 'normal';

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);

  const skewX = transform.skewX ?? 0;
  const skewY = transform.skewY ?? 0;
  if (skewX !== 0 || skewY !== 0) {
    ctx.transform(1, Math.tan(skewY * Math.PI / 180), Math.tan(skewX * Math.PI / 180), 1, 0, 0);
  }

  ctx.globalAlpha = transform.opacity;
  ctx.globalCompositeOperation = BLEND_MODE_MAP[blendMode] ?? 'source-over';

  if (glow.enabled && glow.blur > 0) {
    ctx.save();
    ctx.shadowColor = glow.color;
    ctx.shadowBlur = glow.blur * (glow.intensity ?? 1);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (let i = 0; i < 3; i++) {
      await renderLayerContent(ctx, layer, project);
    }
    ctx.restore();
  }

  if (shadow.enabled) {
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
  }

  await renderLayerContent(ctx, layer, project);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (innerShadow.enabled && innerShadow.blur > 0) {
    renderInnerShadow(ctx, layer, innerShadow);
  }

  ctx.restore();
}

async function renderLayerContent(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  project: Project
): Promise<void> {
  switch (layer.type) {
    case 'image':
      await renderImageLayerToContext(ctx, layer as ImageLayer, project);
      break;
    case 'text':
      renderTextLayerToContext(ctx, layer as TextLayer);
      break;
    case 'shape':
      renderShapeLayerToContext(ctx, layer as ShapeLayer);
      break;
  }
}

function renderInnerShadow(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  innerShadow: { color: string; blur: number; offsetX: number; offsetY: number }
): void {
  const { width, height } = layer.transform;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.shadowColor = innerShadow.color;
  ctx.shadowBlur = innerShadow.blur;
  ctx.shadowOffsetX = innerShadow.offsetX;
  ctx.shadowOffsetY = innerShadow.offsetY;

  ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  ctx.globalCompositeOperation = 'source-atop';

  const spread = innerShadow.blur + Math.max(Math.abs(innerShadow.offsetX), Math.abs(innerShadow.offsetY)) + 50;

  ctx.beginPath();
  ctx.moveTo(-spread, -spread);
  ctx.lineTo(width + spread, -spread);
  ctx.lineTo(width + spread, height + spread);
  ctx.lineTo(-spread, height + spread);
  ctx.closePath();

  ctx.moveTo(0, 0);
  ctx.lineTo(0, height);
  ctx.lineTo(width, height);
  ctx.lineTo(width, 0);
  ctx.closePath();

  ctx.fill('evenodd');

  ctx.restore();
}

function applyFilters(ctx: CanvasRenderingContext2D, filters: Filter): void {
  const filterParts: string[] = [];

  let effectiveBrightness = filters.brightness;
  if (filters.exposure !== 0) {
    effectiveBrightness = effectiveBrightness * (1 + filters.exposure / 100);
  }
  if (filters.highlights > 0) {
    effectiveBrightness = effectiveBrightness * (1 + filters.highlights / 200);
  }
  if (filters.shadows > 0) {
    effectiveBrightness = effectiveBrightness * (1 + filters.shadows / 300);
  }
  if (effectiveBrightness !== 100) {
    filterParts.push(`brightness(${Math.round(effectiveBrightness)}%)`);
  }

  let effectiveContrast = filters.contrast;
  if (filters.clarity !== 0) {
    effectiveContrast = effectiveContrast * (1 + filters.clarity / 150);
  }
  if (filters.highlights < 0) {
    effectiveContrast = effectiveContrast * (1 + filters.highlights / 400);
  }
  if (filters.shadows < 0) {
    effectiveContrast = effectiveContrast * (1 + filters.shadows / 400);
  }
  if (effectiveContrast !== 100) {
    filterParts.push(`contrast(${Math.round(effectiveContrast)}%)`);
  }

  let effectiveSaturation = filters.saturation;
  if (filters.vibrance !== 0) {
    effectiveSaturation = effectiveSaturation * (1 + filters.vibrance / 150);
  }
  if (effectiveSaturation !== 100) {
    filterParts.push(`saturate(${Math.round(effectiveSaturation)}%)`);
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
}

function applyMotionBlur(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  amount: number,
  angle: number
): void {
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
): void {
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

async function renderImageLayerToContext(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  project: Project
): Promise<void> {
  const asset = project.assets[layer.sourceId];
  if (!asset) return;

  const flipH = layer.flipHorizontal ?? false;
  const flipV = layer.flipVertical ?? false;

  if (flipH || flipV) {
    ctx.save();
    ctx.translate(
      flipH ? layer.transform.width : 0,
      flipV ? layer.transform.height : 0
    );
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve) => {
    img.onload = () => {
      const { filters } = layer;

      applyFilters(ctx, filters);

      if (filters.blur > 0 && filters.blurType === 'motion') {
        applyMotionBlur(ctx, img, layer.transform.width, layer.transform.height, filters.blur, filters.blurAngle);
      } else if (filters.blur > 0 && filters.blurType === 'radial') {
        applyRadialBlur(ctx, img, layer.transform.width, layer.transform.height, filters.blur);
      } else {
        ctx.drawImage(img, 0, 0, layer.transform.width, layer.transform.height);
      }

      ctx.filter = 'none';
      resolve();
    };
    img.onerror = () => resolve();
    img.src = asset.dataUrl ?? asset.blobUrl ?? '';
  });

  if (flipH || flipV) {
    ctx.restore();
  }
}

function renderTextLayerToContext(ctx: CanvasRenderingContext2D, layer: TextLayer): void {
  const { style, content, transform } = layer;
  const flipH = layer.flipHorizontal ?? false;
  const flipV = layer.flipVertical ?? false;

  if (flipH || flipV) {
    ctx.save();
    ctx.translate(
      flipH ? transform.width : 0,
      flipV ? transform.height : 0
    );
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  }

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

  const textShadow = style.textShadow;
  if (textShadow?.enabled) {
    ctx.shadowColor = textShadow.color ?? 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = textShadow.blur ?? 4;
    ctx.shadowOffsetX = textShadow.offsetX ?? 0;
    ctx.shadowOffsetY = textShadow.offsetY ?? 2;
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

  if (textShadow?.enabled) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  if (flipH || flipV) {
    ctx.restore();
  }
}

function renderShapeLayerToContext(ctx: CanvasRenderingContext2D, layer: ShapeLayer): void {
  const { shapeType, shapeStyle, transform } = layer;
  const { width, height } = transform;
  const flipH = layer.flipHorizontal ?? false;
  const flipV = layer.flipVertical ?? false;

  if (flipH || flipV) {
    ctx.save();
    ctx.translate(
      flipH ? width : 0,
      flipV ? height : 0
    );
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  }

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

  const fillType = shapeStyle.fillType ?? 'solid';
  const hasFill = fillType === 'solid' ? !!shapeStyle.fill : fillType === 'gradient' ? !!shapeStyle.gradient : fillType === 'noise' ? !!shapeStyle.noise : false;

  if (hasFill) {
    ctx.globalAlpha *= shapeStyle.fillOpacity;

    if (fillType === 'noise' && shapeStyle.noise) {
      ctx.fillStyle = shapeStyle.noise.baseColor;
      ctx.fill();

      ctx.save();
      ctx.clip();

      const { noise } = shapeStyle;
      const noiseSize = noise.size;
      const density = noise.density;

      ctx.fillStyle = noise.noiseColor;
      for (let y = 0; y < height; y += noiseSize) {
        for (let x = 0; x < width; x += noiseSize) {
          if (Math.random() < density) {
            ctx.fillRect(x, y, noiseSize, noiseSize);
          }
        }
      }

      ctx.restore();
    } else if (fillType === 'gradient' && shapeStyle.gradient) {
      let gradient: CanvasGradient;
      if (shapeStyle.gradient.type === 'linear') {
        const angleRad = (shapeStyle.gradient.angle * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const halfW = width / 2;
        const halfH = height / 2;
        const len = Math.abs(halfW * cos) + Math.abs(halfH * sin);
        gradient = ctx.createLinearGradient(
          halfW - len * cos,
          halfH - len * sin,
          halfW + len * cos,
          halfH + len * sin
        );
      } else {
        const radius = Math.max(width, height) / 2;
        gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
      }
      shapeStyle.gradient.stops.forEach((stop) => {
        gradient.addColorStop(stop.offset, stop.color);
      });
      ctx.fillStyle = gradient;
      ctx.fill();
    } else if (shapeStyle.fill) {
      ctx.fillStyle = shapeStyle.fill;
      ctx.fill();
    }

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

  if (flipH || flipV) {
    ctx.restore();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getExportFilename(projectName: string, artboardName: string, format: ExportFormat): string {
  const safeName = `${projectName}-${artboardName}`.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  return `${safeName}.${format}`;
}
