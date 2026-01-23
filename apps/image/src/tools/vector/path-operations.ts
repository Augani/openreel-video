import { VectorPath, BezierPoint, pathToPath2D, createPath, createBezierPoint } from './pen-tool';

export type PathOperation = 'union' | 'subtract' | 'intersect' | 'exclude';

export interface PathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getPathBounds(path: VectorPath): PathBounds {
  const { points } = path;

  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);

    if (point.handleIn) {
      minX = Math.min(minX, point.handleIn.x);
      minY = Math.min(minY, point.handleIn.y);
      maxX = Math.max(maxX, point.handleIn.x);
      maxY = Math.max(maxY, point.handleIn.y);
    }

    if (point.handleOut) {
      minX = Math.min(minX, point.handleOut.x);
      minY = Math.min(minY, point.handleOut.y);
      maxX = Math.max(maxX, point.handleOut.x);
      maxY = Math.max(maxY, point.handleOut.y);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function translatePath(path: VectorPath, dx: number, dy: number): VectorPath {
  const newPoints: BezierPoint[] = path.points.map((point) => ({
    ...point,
    x: point.x + dx,
    y: point.y + dy,
    handleIn: point.handleIn
      ? { x: point.handleIn.x + dx, y: point.handleIn.y + dy }
      : null,
    handleOut: point.handleOut
      ? { x: point.handleOut.x + dx, y: point.handleOut.y + dy }
      : null,
  }));

  return { ...path, points: newPoints };
}

export function scalePath(
  path: VectorPath,
  scaleX: number,
  scaleY: number,
  originX?: number,
  originY?: number
): VectorPath {
  const bounds = getPathBounds(path);
  const ox = originX ?? bounds.x + bounds.width / 2;
  const oy = originY ?? bounds.y + bounds.height / 2;

  const newPoints: BezierPoint[] = path.points.map((point) => ({
    ...point,
    x: ox + (point.x - ox) * scaleX,
    y: oy + (point.y - oy) * scaleY,
    handleIn: point.handleIn
      ? {
          x: ox + (point.handleIn.x - ox) * scaleX,
          y: oy + (point.handleIn.y - oy) * scaleY,
        }
      : null,
    handleOut: point.handleOut
      ? {
          x: ox + (point.handleOut.x - ox) * scaleX,
          y: oy + (point.handleOut.y - oy) * scaleY,
        }
      : null,
  }));

  return { ...path, points: newPoints };
}

export function rotatePath(
  path: VectorPath,
  angle: number,
  originX?: number,
  originY?: number
): VectorPath {
  const bounds = getPathBounds(path);
  const ox = originX ?? bounds.x + bounds.width / 2;
  const oy = originY ?? bounds.y + bounds.height / 2;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotatePoint = (x: number, y: number) => ({
    x: ox + (x - ox) * cos - (y - oy) * sin,
    y: oy + (x - ox) * sin + (y - oy) * cos,
  });

  const newPoints: BezierPoint[] = path.points.map((point) => {
    const rotated = rotatePoint(point.x, point.y);
    return {
      ...point,
      ...rotated,
      handleIn: point.handleIn ? rotatePoint(point.handleIn.x, point.handleIn.y) : null,
      handleOut: point.handleOut ? rotatePoint(point.handleOut.x, point.handleOut.y) : null,
    };
  });

  return { ...path, points: newPoints };
}

export function flipPathHorizontal(path: VectorPath, originX?: number): VectorPath {
  const bounds = getPathBounds(path);
  const ox = originX ?? bounds.x + bounds.width / 2;

  const newPoints: BezierPoint[] = path.points.map((point) => ({
    ...point,
    x: ox * 2 - point.x,
    handleIn: point.handleIn
      ? { x: ox * 2 - point.handleIn.x, y: point.handleIn.y }
      : null,
    handleOut: point.handleOut
      ? { x: ox * 2 - point.handleOut.x, y: point.handleOut.y }
      : null,
  }));

  return { ...path, points: newPoints.reverse() };
}

export function flipPathVertical(path: VectorPath, originY?: number): VectorPath {
  const bounds = getPathBounds(path);
  const oy = originY ?? bounds.y + bounds.height / 2;

  const newPoints: BezierPoint[] = path.points.map((point) => ({
    ...point,
    y: oy * 2 - point.y,
    handleIn: point.handleIn
      ? { x: point.handleIn.x, y: oy * 2 - point.handleIn.y }
      : null,
    handleOut: point.handleOut
      ? { x: point.handleOut.x, y: oy * 2 - point.handleOut.y }
      : null,
  }));

  return { ...path, points: newPoints.reverse() };
}

export function reversePath(path: VectorPath): VectorPath {
  const newPoints: BezierPoint[] = path.points
    .slice()
    .reverse()
    .map((point) => ({
      ...point,
      handleIn: point.handleOut,
      handleOut: point.handleIn,
    }));

  return { ...path, points: newPoints };
}

export function offsetPath(path: VectorPath, distance: number): VectorPath {
  const { points, closed } = path;
  if (points.length < 2) return path;

  const newPoints: BezierPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];

    const toPrev = { x: prev.x - current.x, y: prev.y - current.y };
    const toNext = { x: next.x - current.x, y: next.y - current.y };

    const prevLen = Math.hypot(toPrev.x, toPrev.y);
    const nextLen = Math.hypot(toNext.x, toNext.y);

    if (prevLen === 0 || nextLen === 0) {
      newPoints.push(current);
      continue;
    }

    const normPrev = { x: toPrev.x / prevLen, y: toPrev.y / prevLen };
    const normNext = { x: toNext.x / nextLen, y: toNext.y / nextLen };

    const perpPrev = { x: -normPrev.y, y: normPrev.x };
    const perpNext = { x: -normNext.y, y: normNext.x };

    const bisector = {
      x: (perpPrev.x + perpNext.x) / 2,
      y: (perpPrev.y + perpNext.y) / 2,
    };

    const bisectorLen = Math.hypot(bisector.x, bisector.y);
    if (bisectorLen === 0) {
      newPoints.push(current);
      continue;
    }

    const cross = normPrev.x * normNext.y - normPrev.y * normNext.x;
    const dot = normPrev.x * normNext.x + normPrev.y * normNext.y;
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;
    const cosHalfAngle = Math.cos(halfAngle);
    const miterLength = cosHalfAngle > 0.01 ? distance / cosHalfAngle : distance * 10;

    const sign = cross >= 0 ? 1 : -1;
    const offsetX = (bisector.x / bisectorLen) * miterLength * sign;
    const offsetY = (bisector.y / bisectorLen) * miterLength * sign;

    newPoints.push({
      ...current,
      x: current.x + offsetX,
      y: current.y + offsetY,
      handleIn: current.handleIn
        ? { x: current.handleIn.x + offsetX, y: current.handleIn.y + offsetY }
        : null,
      handleOut: current.handleOut
        ? { x: current.handleOut.x + offsetX, y: current.handleOut.y + offsetY }
        : null,
    });
  }

  if (!closed && points.length >= 2) {
    const first = points[0];
    const second = points[1];
    const toSecond = { x: second.x - first.x, y: second.y - first.y };
    const len = Math.hypot(toSecond.x, toSecond.y);
    if (len > 0) {
      const perp = { x: -toSecond.y / len, y: toSecond.x / len };
      newPoints[0] = {
        ...newPoints[0],
        x: first.x + perp.x * distance,
        y: first.y + perp.y * distance,
      };
    }

    const last = points[points.length - 1];
    const secondLast = points[points.length - 2];
    const toSecondLast = { x: secondLast.x - last.x, y: secondLast.y - last.y };
    const lastLen = Math.hypot(toSecondLast.x, toSecondLast.y);
    if (lastLen > 0) {
      const perp = { x: toSecondLast.y / lastLen, y: -toSecondLast.x / lastLen };
      newPoints[newPoints.length - 1] = {
        ...newPoints[newPoints.length - 1],
        x: last.x + perp.x * distance,
        y: last.y + perp.y * distance,
      };
    }
  }

  return { ...path, points: newPoints };
}

export function combinePaths(
  pathA: VectorPath,
  pathB: VectorPath,
  operation: PathOperation,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
): VectorPath {
  const path2dA = pathToPath2D(pathA);
  const path2dB = pathToPath2D(pathB);

  const boundsA = getPathBounds(pathA);
  const boundsB = getPathBounds(pathB);

  const minX = Math.min(boundsA.x, boundsB.x);
  const minY = Math.min(boundsA.y, boundsB.y);
  const maxX = Math.max(boundsA.x + boundsA.width, boundsB.x + boundsB.width);
  const maxY = Math.max(boundsA.y + boundsA.height, boundsB.y + boundsB.height);

  const samplePoints: Array<{ x: number; y: number }> = [];
  const step = 5;

  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const inA = ctx.isPointInPath(path2dA, x, y);
      const inB = ctx.isPointInPath(path2dB, x, y);

      let include = false;
      switch (operation) {
        case 'union':
          include = inA || inB;
          break;
        case 'subtract':
          include = inA && !inB;
          break;
        case 'intersect':
          include = inA && inB;
          break;
        case 'exclude':
          include = (inA && !inB) || (!inA && inB);
          break;
      }

      if (include) {
        samplePoints.push({ x, y });
      }
    }
  }

  const contourPoints = findContourPoints(samplePoints, step);

  const resultPath = createPath({
    fillColor: pathA.fillColor,
    fillOpacity: pathA.fillOpacity,
    strokeColor: pathA.strokeColor,
    strokeWidth: pathA.strokeWidth,
  });

  resultPath.points = contourPoints.map((p) =>
    createBezierPoint(p.x, p.y, 'corner')
  );
  resultPath.closed = true;

  return resultPath;
}

function findContourPoints(
  points: Array<{ x: number; y: number }>,
  gridSize: number
): Array<{ x: number; y: number }> {
  if (points.length === 0) return [];

  const pointSet = new Set(points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));

  const boundary: Array<{ x: number; y: number }> = [];

  for (const point of points) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);

    const neighbors = [
      [x - gridSize, y],
      [x + gridSize, y],
      [x, y - gridSize],
      [x, y + gridSize],
    ];

    const isBoundary = neighbors.some((n) => !pointSet.has(`${n[0]},${n[1]}`));

    if (isBoundary) {
      boundary.push({ x, y });
    }
  }

  if (boundary.length === 0) return points.slice(0, 1);

  return orderBoundaryPoints(boundary, gridSize);
}

function orderBoundaryPoints(
  points: Array<{ x: number; y: number }>,
  gridSize: number
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  const ordered: Array<{ x: number; y: number }> = [];
  const remaining = new Set(points.map((_, i) => i));

  let currentIdx = 0;
  remaining.delete(currentIdx);
  ordered.push(points[currentIdx]);

  while (remaining.size > 0) {
    const current = points[currentIdx];
    let closestIdx = -1;
    let closestDist = Infinity;

    for (const idx of remaining) {
      const dist = Math.hypot(points[idx].x - current.x, points[idx].y - current.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    }

    if (closestIdx === -1 || closestDist > gridSize * 2) break;

    remaining.delete(closestIdx);
    ordered.push(points[closestIdx]);
    currentIdx = closestIdx;
  }

  return ordered;
}

export function pathToSVG(path: VectorPath): string {
  const { points, closed } = path;

  if (points.length === 0) return '';

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];

    const cp1 = current.handleOut || current;
    const cp2 = next.handleIn || next;

    d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${next.x} ${next.y}`;
  }

  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    const cp1 = last.handleOut || last;
    const cp2 = first.handleIn || first;

    d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${first.x} ${first.y}`;
    d += ' Z';
  }

  return d;
}

export function svgToPath(svgPath: string): VectorPath {
  const path = createPath();
  const commands = svgPath.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g);

  if (!commands) return path;

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  for (const command of commands) {
    const type = command[0];
    const args = command
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => !isNaN(n));

    switch (type) {
      case 'M':
        currentX = args[0];
        currentY = args[1];
        startX = currentX;
        startY = currentY;
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'm':
        currentX += args[0];
        currentY += args[1];
        startX = currentX;
        startY = currentY;
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'L':
        currentX = args[0];
        currentY = args[1];
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'l':
        currentX += args[0];
        currentY += args[1];
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'H':
        currentX = args[0];
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'h':
        currentX += args[0];
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'V':
        currentY = args[0];
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'v':
        currentY += args[0];
        path.points.push(createBezierPoint(currentX, currentY, 'corner'));
        break;

      case 'C': {
        const lastPoint = path.points[path.points.length - 1];
        if (lastPoint) {
          lastPoint.handleOut = { x: args[0], y: args[1] };
        }
        const newPoint = createBezierPoint(args[4], args[5], 'smooth');
        newPoint.handleIn = { x: args[2], y: args[3] };
        path.points.push(newPoint);
        currentX = args[4];
        currentY = args[5];
        break;
      }

      case 'c': {
        const lastPoint = path.points[path.points.length - 1];
        if (lastPoint) {
          lastPoint.handleOut = { x: currentX + args[0], y: currentY + args[1] };
        }
        const newPoint = createBezierPoint(currentX + args[4], currentY + args[5], 'smooth');
        newPoint.handleIn = { x: currentX + args[2], y: currentY + args[3] };
        path.points.push(newPoint);
        currentX += args[4];
        currentY += args[5];
        break;
      }

      case 'Z':
      case 'z':
        path.closed = true;
        currentX = startX;
        currentY = startY;
        break;
    }
  }

  return path;
}

export function duplicatePath(path: VectorPath, offsetX: number = 10, offsetY: number = 10): VectorPath {
  const duplicate = translatePath(path, offsetX, offsetY);
  return {
    ...duplicate,
    id: `${path.id}_copy_${Date.now()}`,
  };
}
