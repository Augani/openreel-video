export interface BezierPoint {
  x: number;
  y: number;
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
  type: 'corner' | 'smooth' | 'symmetric';
}

export interface VectorPath {
  id: string;
  points: BezierPoint[];
  closed: boolean;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDash: number[];
  strokeLineCap: CanvasLineCap;
  strokeLineJoin: CanvasLineJoin;
}

export interface PenToolState {
  currentPath: VectorPath | null;
  isDrawing: boolean;
  selectedPointIndex: number | null;
  selectedHandleType: 'in' | 'out' | null;
  previewPoint: { x: number; y: number } | null;
}

export const DEFAULT_PATH_STYLE = {
  fillColor: 'transparent',
  fillOpacity: 1,
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeOpacity: 1,
  strokeDash: [] as number[],
  strokeLineCap: 'round' as CanvasLineCap,
  strokeLineJoin: 'round' as CanvasLineJoin,
};

let pathIdCounter = 0;

export function createPath(style?: Partial<typeof DEFAULT_PATH_STYLE>): VectorPath {
  return {
    id: `path_${++pathIdCounter}_${Date.now()}`,
    points: [],
    closed: false,
    ...DEFAULT_PATH_STYLE,
    ...style,
  };
}

export function createBezierPoint(
  x: number,
  y: number,
  type: BezierPoint['type'] = 'smooth'
): BezierPoint {
  return {
    x,
    y,
    handleIn: null,
    handleOut: null,
    type,
  };
}

export function addPointToPath(
  path: VectorPath,
  point: BezierPoint
): VectorPath {
  return {
    ...path,
    points: [...path.points, point],
  };
}

export function updatePointInPath(
  path: VectorPath,
  index: number,
  updates: Partial<BezierPoint>
): VectorPath {
  if (index < 0 || index >= path.points.length) return path;

  const newPoints = [...path.points];
  newPoints[index] = { ...newPoints[index], ...updates };

  return { ...path, points: newPoints };
}

export function removePointFromPath(path: VectorPath, index: number): VectorPath {
  if (index < 0 || index >= path.points.length) return path;

  return {
    ...path,
    points: path.points.filter((_, i) => i !== index),
  };
}

export function closePath(path: VectorPath): VectorPath {
  return { ...path, closed: true };
}

export function setPointHandles(
  point: BezierPoint,
  handleOut: { x: number; y: number } | null,
  handleIn?: { x: number; y: number } | null
): BezierPoint {
  const updated = { ...point, handleOut };

  if (handleIn !== undefined) {
    updated.handleIn = handleIn;
  } else if (point.type === 'symmetric' && handleOut) {
    updated.handleIn = {
      x: point.x - (handleOut.x - point.x),
      y: point.y - (handleOut.y - point.y),
    };
  } else if (point.type === 'smooth' && handleOut && point.handleIn) {
    const inDist = Math.hypot(point.handleIn.x - point.x, point.handleIn.y - point.y);
    const angle = Math.atan2(point.y - handleOut.y, point.x - handleOut.x);
    updated.handleIn = {
      x: point.x + Math.cos(angle) * inDist,
      y: point.y + Math.sin(angle) * inDist,
    };
  }

  return updated;
}

export function movePoint(
  point: BezierPoint,
  dx: number,
  dy: number
): BezierPoint {
  return {
    ...point,
    x: point.x + dx,
    y: point.y + dy,
    handleIn: point.handleIn
      ? { x: point.handleIn.x + dx, y: point.handleIn.y + dy }
      : null,
    handleOut: point.handleOut
      ? { x: point.handleOut.x + dx, y: point.handleOut.y + dy }
      : null,
  };
}

function bezierCurve(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

export function pathToPath2D(vectorPath: VectorPath): Path2D {
  const path = new Path2D();
  const { points, closed } = vectorPath;

  if (points.length === 0) return path;

  path.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];

    const cp1 = current.handleOut || { x: current.x, y: current.y };
    const cp2 = next.handleIn || { x: next.x, y: next.y };

    path.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, next.x, next.y);
  }

  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];

    const cp1 = last.handleOut || { x: last.x, y: last.y };
    const cp2 = first.handleIn || { x: first.x, y: first.y };

    path.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.x, first.y);
    path.closePath();
  }

  return path;
}

export function renderPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  vectorPath: VectorPath
): void {
  const path2d = pathToPath2D(vectorPath);

  ctx.save();

  if (vectorPath.fillColor !== 'transparent') {
    ctx.fillStyle = vectorPath.fillColor;
    ctx.globalAlpha = vectorPath.fillOpacity;
    ctx.fill(path2d);
  }

  if (vectorPath.strokeWidth > 0 && vectorPath.strokeColor !== 'transparent') {
    ctx.strokeStyle = vectorPath.strokeColor;
    ctx.lineWidth = vectorPath.strokeWidth;
    ctx.lineCap = vectorPath.strokeLineCap;
    ctx.lineJoin = vectorPath.strokeLineJoin;
    ctx.globalAlpha = vectorPath.strokeOpacity;
    ctx.setLineDash(vectorPath.strokeDash);
    ctx.stroke(path2d);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

export function renderPathHandles(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  vectorPath: VectorPath,
  selectedIndex: number | null = null,
  handleColor: string = '#0ea5e9',
  pointColor: string = '#ffffff'
): void {
  const { points } = vectorPath;
  const pointSize = 4;
  const handleSize = 3;

  ctx.save();

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const isSelected = i === selectedIndex;

    if (point.handleIn) {
      ctx.beginPath();
      ctx.strokeStyle = handleColor;
      ctx.lineWidth = 1;
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.handleIn.x, point.handleIn.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = handleColor;
      ctx.arc(point.handleIn.x, point.handleIn.y, handleSize, 0, Math.PI * 2);
      ctx.fill();
    }

    if (point.handleOut) {
      ctx.beginPath();
      ctx.strokeStyle = handleColor;
      ctx.lineWidth = 1;
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.handleOut.x, point.handleOut.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = handleColor;
      ctx.arc(point.handleOut.x, point.handleOut.y, handleSize, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.fillStyle = isSelected ? handleColor : pointColor;
    ctx.strokeStyle = handleColor;
    ctx.lineWidth = 1.5;
    ctx.rect(point.x - pointSize / 2, point.y - pointSize / 2, pointSize, pointSize);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

export function hitTestPath(
  vectorPath: VectorPath,
  x: number,
  y: number,
  threshold: number = 5
): { type: 'point' | 'handleIn' | 'handleOut' | 'segment'; index: number } | null {
  const { points } = vectorPath;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];

    if (Math.hypot(x - point.x, y - point.y) <= threshold) {
      return { type: 'point', index: i };
    }

    if (point.handleIn && Math.hypot(x - point.handleIn.x, y - point.handleIn.y) <= threshold) {
      return { type: 'handleIn', index: i };
    }

    if (point.handleOut && Math.hypot(x - point.handleOut.x, y - point.handleOut.y) <= threshold) {
      return { type: 'handleOut', index: i };
    }
  }

  for (let i = 0; i < points.length - 1; i++) {
    if (isPointNearSegment(points[i], points[i + 1], x, y, threshold)) {
      return { type: 'segment', index: i };
    }
  }

  if (vectorPath.closed && points.length > 1) {
    if (isPointNearSegment(points[points.length - 1], points[0], x, y, threshold)) {
      return { type: 'segment', index: points.length - 1 };
    }
  }

  return null;
}

function isPointNearSegment(
  p1: BezierPoint,
  p2: BezierPoint,
  x: number,
  y: number,
  threshold: number
): boolean {
  const steps = 20;
  const cp1 = p1.handleOut || { x: p1.x, y: p1.y };
  const cp2 = p2.handleIn || { x: p2.x, y: p2.y };

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = bezierCurve(p1, cp1, cp2, p2, t);

    if (Math.hypot(x - point.x, y - point.y) <= threshold) {
      return true;
    }
  }

  return false;
}

export function getPathLength(vectorPath: VectorPath): number {
  const { points, closed } = vectorPath;
  if (points.length < 2) return 0;

  let length = 0;
  const steps = 50;

  const segmentCount = closed ? points.length : points.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const cp1 = p1.handleOut || { x: p1.x, y: p1.y };
    const cp2 = p2.handleIn || { x: p2.x, y: p2.y };

    let prevPoint = { x: p1.x, y: p1.y };
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const point = bezierCurve(p1, cp1, cp2, p2, t);
      length += Math.hypot(point.x - prevPoint.x, point.y - prevPoint.y);
      prevPoint = point;
    }
  }

  return length;
}

export function getPointAtLength(
  vectorPath: VectorPath,
  targetLength: number
): { x: number; y: number; angle: number } | null {
  const { points, closed } = vectorPath;
  if (points.length < 2) return null;

  let accumulatedLength = 0;
  const steps = 50;

  const segmentCount = closed ? points.length : points.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const cp1 = p1.handleOut || { x: p1.x, y: p1.y };
    const cp2 = p2.handleIn || { x: p2.x, y: p2.y };

    let prevPoint = { x: p1.x, y: p1.y };
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const point = bezierCurve(p1, cp1, cp2, p2, t);
      const segmentLength = Math.hypot(point.x - prevPoint.x, point.y - prevPoint.y);

      if (accumulatedLength + segmentLength >= targetLength) {
        const ratio = (targetLength - accumulatedLength) / segmentLength;
        const x = prevPoint.x + (point.x - prevPoint.x) * ratio;
        const y = prevPoint.y + (point.y - prevPoint.y) * ratio;
        const angle = Math.atan2(point.y - prevPoint.y, point.x - prevPoint.x);
        return { x, y, angle };
      }

      accumulatedLength += segmentLength;
      prevPoint = point;
    }
  }

  const lastPoint = points[points.length - 1];
  return { x: lastPoint.x, y: lastPoint.y, angle: 0 };
}

export function smoothPath(vectorPath: VectorPath, tension: number = 0.3): VectorPath {
  const { points } = vectorPath;
  if (points.length < 3) return vectorPath;

  const newPoints: BezierPoint[] = points.map((point, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    return {
      ...point,
      type: 'smooth' as const,
      handleIn: {
        x: point.x - dx * tension,
        y: point.y - dy * tension,
      },
      handleOut: {
        x: point.x + dx * tension,
        y: point.y + dy * tension,
      },
    };
  });

  if (!vectorPath.closed) {
    newPoints[0].handleIn = null;
    newPoints[newPoints.length - 1].handleOut = null;
  }

  return { ...vectorPath, points: newPoints };
}

export function simplifyPath(vectorPath: VectorPath, tolerance: number = 2): VectorPath {
  const { points } = vectorPath;
  if (points.length <= 2) return vectorPath;

  const simplified = ramerDouglasPeucker(
    points.map((p) => ({ x: p.x, y: p.y })),
    tolerance
  );

  const newPoints: BezierPoint[] = simplified.map((p) => ({
    x: p.x,
    y: p.y,
    handleIn: null,
    handleOut: null,
    type: 'corner' as const,
  }));

  return smoothPath({ ...vectorPath, points: newPoints });
}

function ramerDouglasPeucker(
  points: Array<{ x: number; y: number }>,
  epsilon: number
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy);

  if (len === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (len * len)
    )
  );

  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.hypot(point.x - projX, point.y - projY);
}
