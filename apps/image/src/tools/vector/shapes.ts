export type ShapeType =
  | 'rectangle'
  | 'roundedRect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'triangle'
  | 'diamond'
  | 'heart'
  | 'cross'
  | 'ring';

export interface Point {
  x: number;
  y: number;
}

export interface ShapeStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDash: number[];
  strokeLineCap: CanvasLineCap;
  strokeLineJoin: CanvasLineJoin;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface RectangleOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number | [number, number, number, number];
}

export interface EllipseOptions {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  startAngle?: number;
  endAngle?: number;
}

export interface PolygonOptions {
  cx: number;
  cy: number;
  radius: number;
  sides: number;
  rotation?: number;
}

export interface StarOptions {
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  points: number;
  rotation?: number;
}

export interface LineOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ArrowOptions extends LineOptions {
  headLength?: number;
  headWidth?: number;
  doubleHead?: boolean;
}

export interface TriangleOptions {
  cx: number;
  cy: number;
  size: number;
  rotation?: number;
}

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fillColor: '#3b82f6',
  fillOpacity: 1,
  strokeColor: '#1d4ed8',
  strokeWidth: 2,
  strokeOpacity: 1,
  strokeDash: [],
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  shadowColor: 'transparent',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

function applyStyle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  style: Partial<ShapeStyle>
): void {
  const s = { ...DEFAULT_SHAPE_STYLE, ...style };

  if (s.shadowColor !== 'transparent') {
    ctx.shadowColor = s.shadowColor;
    ctx.shadowBlur = s.shadowBlur;
    ctx.shadowOffsetX = s.shadowOffsetX;
    ctx.shadowOffsetY = s.shadowOffsetY;
  }

  if (s.fillColor !== 'transparent') {
    ctx.fillStyle = s.fillColor;
    ctx.globalAlpha = s.fillOpacity;
    ctx.fill();
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (s.strokeWidth > 0 && s.strokeColor !== 'transparent') {
    ctx.strokeStyle = s.strokeColor;
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = s.strokeLineCap;
    ctx.lineJoin = s.strokeLineJoin;
    ctx.globalAlpha = s.strokeOpacity;
    ctx.setLineDash(s.strokeDash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = 1;
}

export function drawRectangle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: RectangleOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  const { x, y, width, height, cornerRadius = 0 } = options;
  const path = new Path2D();

  if (cornerRadius === 0 || (Array.isArray(cornerRadius) && cornerRadius.every((r) => r === 0))) {
    path.rect(x, y, width, height);
  } else {
    const radii = Array.isArray(cornerRadius)
      ? cornerRadius
      : [cornerRadius, cornerRadius, cornerRadius, cornerRadius];

    const [tl, tr, br, bl] = radii.map((r) => Math.min(r, width / 2, height / 2));

    path.moveTo(x + tl, y);
    path.lineTo(x + width - tr, y);
    path.arcTo(x + width, y, x + width, y + tr, tr);
    path.lineTo(x + width, y + height - br);
    path.arcTo(x + width, y + height, x + width - br, y + height, br);
    path.lineTo(x + bl, y + height);
    path.arcTo(x, y + height, x, y + height - bl, bl);
    path.lineTo(x, y + tl);
    path.arcTo(x, y, x + tl, y, tl);
    path.closePath();
  }

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawEllipse(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: EllipseOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  const { cx, cy, rx, ry, startAngle = 0, endAngle = Math.PI * 2 } = options;
  const path = new Path2D();

  path.ellipse(cx, cy, rx, ry, 0, startAngle, endAngle);
  if (endAngle - startAngle < Math.PI * 2) {
    path.lineTo(cx, cy);
    path.closePath();
  }

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawPolygon(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: PolygonOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  const { cx, cy, radius, sides, rotation = -Math.PI / 2 } = options;
  const path = new Path2D();
  const safeSides = Math.max(3, Math.round(sides));

  const angleStep = (Math.PI * 2) / safeSides;

  for (let i = 0; i <= safeSides; i++) {
    const angle = rotation + i * angleStep;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);

    if (i === 0) {
      path.moveTo(px, py);
    } else {
      path.lineTo(px, py);
    }
  }
  path.closePath();

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawStar(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: StarOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  const { cx, cy, outerRadius, innerRadius, points, rotation = -Math.PI / 2 } = options;
  const path = new Path2D();
  const safePoints = Math.max(3, Math.round(points));

  const angleStep = Math.PI / safePoints;

  for (let i = 0; i < safePoints * 2; i++) {
    const angle = rotation + i * angleStep;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);

    if (i === 0) {
      path.moveTo(px, py);
    } else {
      path.lineTo(px, py);
    }
  }
  path.closePath();

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawLine(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: LineOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  const { x1, y1, x2, y2 } = options;
  const path = new Path2D();

  path.moveTo(x1, y1);
  path.lineTo(x2, y2);

  ctx.beginPath();
  ctx.save();
  const lineStyle = { ...style, fillColor: 'transparent' };
  applyStyle(ctx, lineStyle);
  ctx.restore();

  return path;
}

export function drawArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: ArrowOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  const { x1, y1, x2, y2, headLength = 15, headWidth = 10, doubleHead = false } = options;
  const path = new Path2D();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  if (doubleHead) {
    const startX = x1 + headLength * cos;
    const startY = y1 + headLength * sin;
    path.moveTo(startX, startY);
  } else {
    path.moveTo(x1, y1);
  }

  const endX = x2 - headLength * cos;
  const endY = y2 - headLength * sin;
  path.lineTo(endX, endY);

  path.moveTo(x2, y2);
  path.lineTo(
    x2 - headLength * cos + (headWidth / 2) * sin,
    y2 - headLength * sin - (headWidth / 2) * cos
  );
  path.moveTo(x2, y2);
  path.lineTo(
    x2 - headLength * cos - (headWidth / 2) * sin,
    y2 - headLength * sin + (headWidth / 2) * cos
  );

  if (doubleHead) {
    path.moveTo(x1, y1);
    path.lineTo(
      x1 + headLength * cos + (headWidth / 2) * sin,
      y1 + headLength * sin - (headWidth / 2) * cos
    );
    path.moveTo(x1, y1);
    path.lineTo(
      x1 + headLength * cos - (headWidth / 2) * sin,
      y1 + headLength * sin + (headWidth / 2) * cos
    );
  }

  ctx.beginPath();
  ctx.save();
  const arrowStyle = { ...style, fillColor: 'transparent' };
  applyStyle(ctx, arrowStyle);
  ctx.restore();

  return path;
}

export function drawTriangle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: TriangleOptions,
  style?: Partial<ShapeStyle>
): Path2D {
  return drawPolygon(ctx, { ...options, radius: options.size, sides: 3 }, style);
}

export function drawDiamond(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  height: number,
  style?: Partial<ShapeStyle>
): Path2D {
  const path = new Path2D();

  path.moveTo(cx, cy - height / 2);
  path.lineTo(cx + width / 2, cy);
  path.lineTo(cx, cy + height / 2);
  path.lineTo(cx - width / 2, cy);
  path.closePath();

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawHeart(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  style?: Partial<ShapeStyle>
): Path2D {
  const path = new Path2D();
  const width = size;
  const height = size;
  const topCurveHeight = height * 0.3;

  path.moveTo(cx, cy + height / 2);
  path.bezierCurveTo(
    cx - width / 2,
    cy + height / 4,
    cx - width / 2,
    cy - topCurveHeight,
    cx,
    cy - topCurveHeight
  );
  path.bezierCurveTo(
    cx + width / 2,
    cy - topCurveHeight,
    cx + width / 2,
    cy + height / 4,
    cx,
    cy + height / 2
  );
  path.closePath();

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawCross(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  thickness: number,
  style?: Partial<ShapeStyle>
): Path2D {
  const path = new Path2D();
  const half = size / 2;
  const t = thickness / 2;

  path.moveTo(cx - t, cy - half);
  path.lineTo(cx + t, cy - half);
  path.lineTo(cx + t, cy - t);
  path.lineTo(cx + half, cy - t);
  path.lineTo(cx + half, cy + t);
  path.lineTo(cx + t, cy + t);
  path.lineTo(cx + t, cy + half);
  path.lineTo(cx - t, cy + half);
  path.lineTo(cx - t, cy + t);
  path.lineTo(cx - half, cy + t);
  path.lineTo(cx - half, cy - t);
  path.lineTo(cx - t, cy - t);
  path.closePath();

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function drawRing(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  style?: Partial<ShapeStyle>
): Path2D {
  const path = new Path2D();

  path.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  path.moveTo(cx + innerRadius, cy);
  path.arc(cx, cy, innerRadius, 0, Math.PI * 2, true);

  ctx.beginPath();
  ctx.save();
  applyStyle(ctx, style || {});
  ctx.restore();

  return path;
}

export function getShapeBounds(_path: Path2D, _ctx: CanvasRenderingContext2D): DOMRect | null {
  return null;
}

export function pointInShape(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  path: Path2D,
  x: number,
  y: number,
  fillRule: CanvasFillRule = 'nonzero'
): boolean {
  return ctx.isPointInPath(path, x, y, fillRule);
}

export function strokeContainsPoint(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  path: Path2D,
  x: number,
  y: number
): boolean {
  return ctx.isPointInStroke(path, x, y);
}
