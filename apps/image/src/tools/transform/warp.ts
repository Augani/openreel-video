export interface WarpGrid {
  rows: number;
  cols: number;
  points: WarpPoint[][];
}

export interface WarpPoint {
  x: number;
  y: number;
  handleLeft: { x: number; y: number } | null;
  handleRight: { x: number; y: number } | null;
  handleTop: { x: number; y: number } | null;
  handleBottom: { x: number; y: number } | null;
}

export type WarpPreset =
  | 'none'
  | 'arc'
  | 'arcLower'
  | 'arcUpper'
  | 'arch'
  | 'bulge'
  | 'shellLower'
  | 'shellUpper'
  | 'flag'
  | 'wave'
  | 'fish'
  | 'rise'
  | 'fisheye'
  | 'inflate'
  | 'squeeze'
  | 'twist';

export interface WarpSettings {
  preset: WarpPreset;
  bend: number;
  horizontalDistortion: number;
  verticalDistortion: number;
  customGrid: WarpGrid | null;
}

export const DEFAULT_WARP_SETTINGS: WarpSettings = {
  preset: 'none',
  bend: 0,
  horizontalDistortion: 0,
  verticalDistortion: 0,
  customGrid: null,
};

export function createWarpGrid(
  width: number,
  height: number,
  rows: number = 4,
  cols: number = 4
): WarpGrid {
  const safeRows = Math.max(1, Math.round(rows));
  const safeCols = Math.max(1, Math.round(cols));
  const points: WarpPoint[][] = [];

  for (let row = 0; row <= safeRows; row++) {
    const rowPoints: WarpPoint[] = [];
    for (let col = 0; col <= safeCols; col++) {
      const x = (col / safeCols) * width;
      const y = (row / safeRows) * height;

      const handleOffset = Math.min(width / safeCols, height / safeRows) * 0.3;

      rowPoints.push({
        x,
        y,
        handleLeft: col > 0 ? { x: x - handleOffset, y } : null,
        handleRight: col < safeCols ? { x: x + handleOffset, y } : null,
        handleTop: row > 0 ? { x, y: y - handleOffset } : null,
        handleBottom: row < safeRows ? { x, y: y + handleOffset } : null,
      });
    }
    points.push(rowPoints);
  }

  return { rows: safeRows, cols: safeCols, points };
}

export function applyWarpPreset(
  grid: WarpGrid,
  preset: WarpPreset,
  bend: number,
  hDistort: number,
  vDistort: number
): WarpGrid {
  const { rows, cols, points } = grid;

  const newPoints: WarpPoint[][] = points.map((row) =>
    row.map((point) => ({ ...point }))
  );

  const centerX = points[0][cols].x / 2;
  const centerY = points[rows][0].y / 2;
  const width = points[0][cols].x;
  const height = points[rows][0].y;

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const point = newPoints[row][col];
      const normalizedX = (point.x - centerX) / (width / 2);
      const normalizedY = (point.y - centerY) / (height / 2);

      let dx = 0;
      let dy = 0;

      switch (preset) {
        case 'arc': {
          const factor = bend / 100;
          dy = -factor * height * 0.3 * (1 - normalizedX * normalizedX);
          break;
        }

        case 'arcLower': {
          const factor = bend / 100;
          if (normalizedY > 0) {
            dy = factor * height * 0.3 * (1 - normalizedX * normalizedX) * normalizedY;
          }
          break;
        }

        case 'arcUpper': {
          const factor = bend / 100;
          if (normalizedY < 0) {
            dy = -factor * height * 0.3 * (1 - normalizedX * normalizedX) * Math.abs(normalizedY);
          }
          break;
        }

        case 'arch': {
          const factor = bend / 100;
          const archY = (1 - Math.pow(normalizedX, 2)) * factor * height * 0.3;
          dy = normalizedY < 0 ? -archY : 0;
          dx = normalizedX * factor * width * 0.1 * (1 - Math.abs(normalizedY));
          break;
        }

        case 'bulge': {
          const factor = bend / 100;
          const dist = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
          const bulge = Math.max(0, 1 - dist) * factor;
          dx = normalizedX * bulge * width * 0.2;
          dy = normalizedY * bulge * height * 0.2;
          break;
        }

        case 'shellLower': {
          const factor = bend / 100;
          if (normalizedY > 0) {
            dx = normalizedX * factor * width * 0.1 * normalizedY;
          }
          break;
        }

        case 'shellUpper': {
          const factor = bend / 100;
          if (normalizedY < 0) {
            dx = normalizedX * factor * width * 0.1 * Math.abs(normalizedY);
          }
          break;
        }

        case 'flag': {
          const factor = bend / 100;
          dy = Math.sin(normalizedX * Math.PI * 2) * factor * height * 0.15;
          break;
        }

        case 'wave': {
          const factor = bend / 100;
          dy = Math.sin(normalizedX * Math.PI * 3) * factor * height * 0.1;
          dx = Math.sin(normalizedY * Math.PI * 3) * factor * width * 0.05;
          break;
        }

        case 'fish': {
          const factor = bend / 100;
          const fishFactor = Math.pow(Math.abs(normalizedY), 2);
          dx = normalizedX * fishFactor * factor * width * 0.3;
          break;
        }

        case 'rise': {
          const factor = bend / 100;
          dy = normalizedX * normalizedX * factor * height * 0.2 * (normalizedY + 1);
          break;
        }

        case 'fisheye': {
          const factor = bend / 100;
          const dist = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
          const fisheyeFactor = Math.pow(dist, 2) * factor;
          dx = normalizedX * fisheyeFactor * width * 0.2;
          dy = normalizedY * fisheyeFactor * height * 0.2;
          break;
        }

        case 'inflate': {
          const factor = bend / 100;
          const dist = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
          const inflate = (1 - dist * dist) * factor;
          dx = normalizedX * inflate * width * 0.15;
          dy = normalizedY * inflate * height * 0.15;
          break;
        }

        case 'squeeze': {
          const factor = bend / 100;
          const squeeze = Math.abs(normalizedY) * factor;
          dx = -normalizedX * squeeze * width * 0.2;
          break;
        }

        case 'twist': {
          const factor = (bend / 100) * Math.PI * 0.5;
          const dist = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
          const angle = dist * factor;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const newX = normalizedX * cos - normalizedY * sin;
          const newY = normalizedX * sin + normalizedY * cos;
          dx = (newX - normalizedX) * width * 0.4;
          dy = (newY - normalizedY) * height * 0.4;
          break;
        }
      }

      dx += normalizedY * hDistort * width * 0.002;
      dy += normalizedX * vDistort * height * 0.002;

      point.x += dx;
      point.y += dy;

      if (point.handleLeft) {
        point.handleLeft.x += dx;
        point.handleLeft.y += dy;
      }
      if (point.handleRight) {
        point.handleRight.x += dx;
        point.handleRight.y += dy;
      }
      if (point.handleTop) {
        point.handleTop.x += dx;
        point.handleTop.y += dy;
      }
      if (point.handleBottom) {
        point.handleBottom.x += dx;
        point.handleBottom.y += dy;
      }
    }
  }

  return { rows, cols, points: newPoints };
}

function cubicBezier(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function bicubicInterpolate(
  grid: WarpGrid,
  u: number,
  v: number
): { x: number; y: number } {
  const { rows, cols, points } = grid;

  if (rows < 1 || cols < 1 || points.length === 0 || points[0].length === 0) {
    return { x: 0, y: 0 };
  }

  const colF = u * cols;
  const rowF = v * rows;

  const col = Math.max(0, Math.min(Math.floor(colF), cols - 1));
  const row = Math.max(0, Math.min(Math.floor(rowF), rows - 1));

  const localU = colF - col;
  const localV = rowF - row;

  const p00 = points[row][col];
  const p01 = points[row][col + 1];
  const p10 = points[row + 1][col];
  const p11 = points[row + 1][col + 1];

  const topX = cubicBezier(
    p00.x,
    p00.handleRight?.x ?? p00.x,
    p01.handleLeft?.x ?? p01.x,
    p01.x,
    localU
  );
  const topY = cubicBezier(
    p00.y,
    p00.handleRight?.y ?? p00.y,
    p01.handleLeft?.y ?? p01.y,
    p01.y,
    localU
  );

  const bottomX = cubicBezier(
    p10.x,
    p10.handleRight?.x ?? p10.x,
    p11.handleLeft?.x ?? p11.x,
    p11.x,
    localU
  );
  const bottomY = cubicBezier(
    p10.y,
    p10.handleRight?.y ?? p10.y,
    p11.handleLeft?.y ?? p11.y,
    p11.y,
    localU
  );

  const leftX = cubicBezier(
    p00.x,
    p00.handleBottom?.x ?? p00.x,
    p10.handleTop?.x ?? p10.x,
    p10.x,
    localV
  );
  const leftY = cubicBezier(
    p00.y,
    p00.handleBottom?.y ?? p00.y,
    p10.handleTop?.y ?? p10.y,
    p10.y,
    localV
  );

  const rightX = cubicBezier(
    p01.x,
    p01.handleBottom?.x ?? p01.x,
    p11.handleTop?.x ?? p11.x,
    p11.x,
    localV
  );
  const rightY = cubicBezier(
    p01.y,
    p01.handleBottom?.y ?? p01.y,
    p11.handleTop?.y ?? p11.y,
    p11.y,
    localV
  );

  const x = (topX + bottomX + leftX + rightX) / 4 +
    (localU - 0.5) * (rightX - leftX) / 2 +
    (localV - 0.5) * (bottomX - topX) / 2;

  const y = (topY + bottomY + leftY + rightY) / 4 +
    (localU - 0.5) * (rightY - leftY) / 2 +
    (localV - 0.5) * (bottomY - topY) / 2;

  return { x, y };
}

export function applyWarp(
  imageData: ImageData,
  grid: WarpGrid,
  interpolation: 'nearest' | 'bilinear' = 'bilinear'
): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;

      const warped = bicubicInterpolate(grid, u, v);

      const srcX = warped.x;
      const srcY = warped.y;

      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
        continue;
      }

      const dstIdx = (y * width + x) * 4;

      if (interpolation === 'nearest') {
        const sx = Math.round(srcX);
        const sy = Math.round(srcY);
        const srcIdx = (sy * width + sx) * 4;

        resultData[dstIdx] = data[srcIdx];
        resultData[dstIdx + 1] = data[srcIdx + 1];
        resultData[dstIdx + 2] = data[srcIdx + 2];
        resultData[dstIdx + 3] = data[srcIdx + 3];
      } else {
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);

        const fx = srcX - x0;
        const fy = srcY - y0;

        const idx00 = (y0 * width + x0) * 4;
        const idx10 = (y0 * width + x1) * 4;
        const idx01 = (y1 * width + x0) * 4;
        const idx11 = (y1 * width + x1) * 4;

        for (let c = 0; c < 4; c++) {
          const v00 = data[idx00 + c];
          const v10 = data[idx10 + c];
          const v01 = data[idx01 + c];
          const v11 = data[idx11 + c];

          const interpolatedValue =
            v00 * (1 - fx) * (1 - fy) +
            v10 * fx * (1 - fy) +
            v01 * (1 - fx) * fy +
            v11 * fx * fy;

          resultData[dstIdx + c] = Math.round(interpolatedValue);
        }
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function renderWarpGrid(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  grid: WarpGrid,
  options: {
    gridColor?: string;
    pointColor?: string;
    handleColor?: string;
    pointSize?: number;
    handleSize?: number;
    showHandles?: boolean;
  } = {}
): void {
  const {
    gridColor = '#0ea5e9',
    pointColor = '#ffffff',
    handleColor = '#0ea5e9',
    pointSize = 6,
    handleSize = 4,
    showHandles = true,
  } = options;

  const { rows, cols, points } = grid;

  ctx.save();

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;

  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    for (let col = 0; col <= cols; col++) {
      const point = points[row][col];
      if (col === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        const prevPoint = points[row][col - 1];
        const cp1 = prevPoint.handleRight || prevPoint;
        const cp2 = point.handleLeft || point;
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, point.x, point.y);
      }
    }
    ctx.stroke();
  }

  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    for (let row = 0; row <= rows; row++) {
      const point = points[row][col];
      if (row === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        const prevPoint = points[row - 1][col];
        const cp1 = prevPoint.handleBottom || prevPoint;
        const cp2 = point.handleTop || point;
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, point.x, point.y);
      }
    }
    ctx.stroke();
  }

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const point = points[row][col];

      if (showHandles) {
        ctx.strokeStyle = handleColor;
        ctx.lineWidth = 1;

        const handles = [point.handleLeft, point.handleRight, point.handleTop, point.handleBottom];
        for (const handle of handles) {
          if (handle) {
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(handle.x, handle.y);
            ctx.stroke();

            ctx.beginPath();
            ctx.fillStyle = handleColor;
            ctx.arc(handle.x, handle.y, handleSize / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.beginPath();
      ctx.fillStyle = pointColor;
      ctx.strokeStyle = handleColor;
      ctx.lineWidth = 1.5;
      ctx.arc(point.x, point.y, pointSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function hitTestWarpGrid(
  grid: WarpGrid,
  x: number,
  y: number,
  threshold: number = 8
): { row: number; col: number; handleType: 'point' | 'left' | 'right' | 'top' | 'bottom' } | null {
  const { rows, cols, points } = grid;

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const point = points[row][col];

      if (Math.hypot(x - point.x, y - point.y) <= threshold) {
        return { row, col, handleType: 'point' };
      }

      if (point.handleLeft && Math.hypot(x - point.handleLeft.x, y - point.handleLeft.y) <= threshold) {
        return { row, col, handleType: 'left' };
      }
      if (point.handleRight && Math.hypot(x - point.handleRight.x, y - point.handleRight.y) <= threshold) {
        return { row, col, handleType: 'right' };
      }
      if (point.handleTop && Math.hypot(x - point.handleTop.x, y - point.handleTop.y) <= threshold) {
        return { row, col, handleType: 'top' };
      }
      if (point.handleBottom && Math.hypot(x - point.handleBottom.x, y - point.handleBottom.y) <= threshold) {
        return { row, col, handleType: 'bottom' };
      }
    }
  }

  return null;
}

export function moveWarpPoint(
  grid: WarpGrid,
  row: number,
  col: number,
  handleType: 'point' | 'left' | 'right' | 'top' | 'bottom',
  dx: number,
  dy: number
): WarpGrid {
  const newPoints = grid.points.map((r) => r.map((p) => ({ ...p })));
  const point = newPoints[row][col];

  if (handleType === 'point') {
    point.x += dx;
    point.y += dy;

    if (point.handleLeft) {
      point.handleLeft = { x: point.handleLeft.x + dx, y: point.handleLeft.y + dy };
    }
    if (point.handleRight) {
      point.handleRight = { x: point.handleRight.x + dx, y: point.handleRight.y + dy };
    }
    if (point.handleTop) {
      point.handleTop = { x: point.handleTop.x + dx, y: point.handleTop.y + dy };
    }
    if (point.handleBottom) {
      point.handleBottom = { x: point.handleBottom.x + dx, y: point.handleBottom.y + dy };
    }
  } else {
    const handleMap = {
      left: 'handleLeft',
      right: 'handleRight',
      top: 'handleTop',
      bottom: 'handleBottom',
    } as const;

    const handle = point[handleMap[handleType]];
    if (handle) {
      handle.x += dx;
      handle.y += dy;
    }
  }

  return { ...grid, points: newPoints };
}
