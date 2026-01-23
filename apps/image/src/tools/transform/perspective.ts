export interface PerspectiveCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
}

export interface PerspectiveMatrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
  m20: number;
  m21: number;
  m22: number;
}

export function createPerspectiveCornersFromRect(
  x: number,
  y: number,
  width: number,
  height: number
): PerspectiveCorners {
  return {
    topLeft: { x, y },
    topRight: { x: x + width, y },
    bottomLeft: { x, y: y + height },
    bottomRight: { x: x + width, y: y + height },
  };
}

export function computePerspectiveMatrix(
  srcCorners: PerspectiveCorners,
  dstCorners: PerspectiveCorners
): PerspectiveMatrix {
  const src = [
    srcCorners.topLeft,
    srcCorners.topRight,
    srcCorners.bottomRight,
    srcCorners.bottomLeft,
  ];

  const dst = [
    dstCorners.topLeft,
    dstCorners.topRight,
    dstCorners.bottomRight,
    dstCorners.bottomLeft,
  ];

  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    B.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    B.push(dy);
  }

  const coeffs = solveLinearSystem(A, B);

  if (!coeffs) {
    return {
      m00: 1, m01: 0, m02: 0,
      m10: 0, m11: 1, m12: 0,
      m20: 0, m21: 0, m22: 1,
    };
  }

  return {
    m00: coeffs[0],
    m01: coeffs[1],
    m02: coeffs[2],
    m10: coeffs[3],
    m11: coeffs[4],
    m12: coeffs[5],
    m20: coeffs[6],
    m21: coeffs[7],
    m22: 1,
  };
}

function solveLinearSystem(A: number[][], B: number[]): number[] | null {
  const n = B.length;
  const augmented = A.map((row, i) => [...row, B[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
        maxRow = row;
      }
    }

    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    if (Math.abs(augmented[col][col]) < 1e-10) {
      return null;
    }

    for (let row = col + 1; row < n; row++) {
      const factor = augmented[row][col] / augmented[col][col];
      for (let j = col; j <= n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= augmented[i][j] * x[j];
    }
    x[i] = sum / augmented[i][i];
  }

  return x;
}

export function transformPointPerspective(
  x: number,
  y: number,
  matrix: PerspectiveMatrix
): { x: number; y: number } {
  const w = matrix.m20 * x + matrix.m21 * y + matrix.m22;

  if (Math.abs(w) < 1e-10) {
    return { x: 0, y: 0 };
  }

  return {
    x: (matrix.m00 * x + matrix.m01 * y + matrix.m02) / w,
    y: (matrix.m10 * x + matrix.m11 * y + matrix.m12) / w,
  };
}

export function invertPerspectiveMatrix(matrix: PerspectiveMatrix): PerspectiveMatrix | null {
  const { m00, m01, m02, m10, m11, m12, m20, m21, m22 } = matrix;

  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);

  if (Math.abs(det) < 1e-10) {
    return null;
  }

  const invDet = 1 / det;

  return {
    m00: (m11 * m22 - m12 * m21) * invDet,
    m01: (m02 * m21 - m01 * m22) * invDet,
    m02: (m01 * m12 - m02 * m11) * invDet,
    m10: (m12 * m20 - m10 * m22) * invDet,
    m11: (m00 * m22 - m02 * m20) * invDet,
    m12: (m02 * m10 - m00 * m12) * invDet,
    m20: (m10 * m21 - m11 * m20) * invDet,
    m21: (m01 * m20 - m00 * m21) * invDet,
    m22: (m00 * m11 - m01 * m10) * invDet,
  };
}

export function applyPerspectiveTransform(
  imageData: ImageData,
  srcCorners: PerspectiveCorners,
  dstCorners: PerspectiveCorners,
  outputWidth?: number,
  outputHeight?: number,
  interpolation: 'nearest' | 'bilinear' = 'bilinear'
): ImageData {
  const { width: srcWidth, height: srcHeight, data: srcData } = imageData;

  const dstBounds = getDstBounds(dstCorners);
  const dstWidth = outputWidth ?? Math.ceil(dstBounds.width);
  const dstHeight = outputHeight ?? Math.ceil(dstBounds.height);
  const dstData = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  const matrix = computePerspectiveMatrix(srcCorners, dstCorners);
  const invMatrix = invertPerspectiveMatrix(matrix);

  if (!invMatrix) {
    return new ImageData(dstData, dstWidth, dstHeight);
  }

  for (let dstY = 0; dstY < dstHeight; dstY++) {
    for (let dstX = 0; dstX < dstWidth; dstX++) {
      const worldX = dstBounds.x + dstX;
      const worldY = dstBounds.y + dstY;

      const srcPoint = transformPointPerspective(worldX, worldY, invMatrix);

      if (srcPoint.x < 0 || srcPoint.x >= srcWidth || srcPoint.y < 0 || srcPoint.y >= srcHeight) {
        continue;
      }

      const dstIdx = (dstY * dstWidth + dstX) * 4;

      if (interpolation === 'nearest') {
        const srcX = Math.round(srcPoint.x);
        const srcY = Math.round(srcPoint.y);
        const srcIdx = (srcY * srcWidth + srcX) * 4;

        dstData[dstIdx] = srcData[srcIdx];
        dstData[dstIdx + 1] = srcData[srcIdx + 1];
        dstData[dstIdx + 2] = srcData[srcIdx + 2];
        dstData[dstIdx + 3] = srcData[srcIdx + 3];
      } else {
        const x0 = Math.floor(srcPoint.x);
        const y0 = Math.floor(srcPoint.y);
        const x1 = Math.min(x0 + 1, srcWidth - 1);
        const y1 = Math.min(y0 + 1, srcHeight - 1);

        const fx = srcPoint.x - x0;
        const fy = srcPoint.y - y0;

        const idx00 = (y0 * srcWidth + x0) * 4;
        const idx10 = (y0 * srcWidth + x1) * 4;
        const idx01 = (y1 * srcWidth + x0) * 4;
        const idx11 = (y1 * srcWidth + x1) * 4;

        for (let c = 0; c < 4; c++) {
          const v00 = srcData[idx00 + c];
          const v10 = srcData[idx10 + c];
          const v01 = srcData[idx01 + c];
          const v11 = srcData[idx11 + c];

          const v =
            v00 * (1 - fx) * (1 - fy) +
            v10 * fx * (1 - fy) +
            v01 * (1 - fx) * fy +
            v11 * fx * fy;

          dstData[dstIdx + c] = Math.round(v);
        }
      }
    }
  }

  return new ImageData(dstData, dstWidth, dstHeight);
}

function getDstBounds(corners: PerspectiveCorners): { x: number; y: number; width: number; height: number } {
  const xs = [corners.topLeft.x, corners.topRight.x, corners.bottomLeft.x, corners.bottomRight.x];
  const ys = [corners.topLeft.y, corners.topRight.y, corners.bottomLeft.y, corners.bottomRight.y];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function renderPerspectiveBox(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  corners: PerspectiveCorners,
  options: {
    lineColor?: string;
    handleColor?: string;
    handleFillColor?: string;
    handleSize?: number;
    showGrid?: boolean;
    gridDivisions?: number;
  } = {}
): void {
  const {
    lineColor = '#0ea5e9',
    handleColor = '#0ea5e9',
    handleFillColor = '#ffffff',
    handleSize = 8,
    showGrid = true,
    gridDivisions = 3,
  } = options;

  ctx.save();

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(corners.topLeft.x, corners.topLeft.y);
  ctx.lineTo(corners.topRight.x, corners.topRight.y);
  ctx.lineTo(corners.bottomRight.x, corners.bottomRight.y);
  ctx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();

  if (showGrid) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);

    for (let i = 1; i < gridDivisions; i++) {
      const t = i / gridDivisions;

      const leftX = corners.topLeft.x + (corners.bottomLeft.x - corners.topLeft.x) * t;
      const leftY = corners.topLeft.y + (corners.bottomLeft.y - corners.topLeft.y) * t;
      const rightX = corners.topRight.x + (corners.bottomRight.x - corners.topRight.x) * t;
      const rightY = corners.topRight.y + (corners.bottomRight.y - corners.topRight.y) * t;

      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.stroke();

      const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * t;
      const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * t;
      const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * t;
      const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * t;

      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(bottomX, bottomY);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  const cornerPoints = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];

  for (const corner of cornerPoints) {
    ctx.beginPath();
    ctx.fillStyle = handleFillColor;
    ctx.strokeStyle = handleColor;
    ctx.lineWidth = 1.5;
    ctx.rect(
      corner.x - handleSize / 2,
      corner.y - handleSize / 2,
      handleSize,
      handleSize
    );
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

export function hitTestPerspectiveCorner(
  x: number,
  y: number,
  corners: PerspectiveCorners,
  threshold: number = 10
): 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | null {
  const cornerMap: Array<{ key: keyof PerspectiveCorners; point: { x: number; y: number } }> = [
    { key: 'topLeft', point: corners.topLeft },
    { key: 'topRight', point: corners.topRight },
    { key: 'bottomLeft', point: corners.bottomLeft },
    { key: 'bottomRight', point: corners.bottomRight },
  ];

  for (const { key, point } of cornerMap) {
    if (Math.hypot(x - point.x, y - point.y) <= threshold) {
      return key;
    }
  }

  return null;
}

export function moveCorner(
  corners: PerspectiveCorners,
  corner: keyof PerspectiveCorners,
  dx: number,
  dy: number
): PerspectiveCorners {
  return {
    ...corners,
    [corner]: {
      x: corners[corner].x + dx,
      y: corners[corner].y + dy,
    },
  };
}

export function isValidPerspective(corners: PerspectiveCorners): boolean {
  const crossProduct = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];

  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const o = points[i];
    const a = points[(i + 1) % 4];
    const b = points[(i + 2) % 4];
    const cross = crossProduct(o, a, b);

    if (cross !== 0) {
      if (sign === 0) {
        sign = Math.sign(cross);
      } else if (Math.sign(cross) !== sign) {
        return false;
      }
    }
  }

  return true;
}

export function constrainPerspective(
  corners: PerspectiveCorners,
  maxSkew: number = 0.8
): PerspectiveCorners {
  const centerX = (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4;
  const centerY = (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4;

  const constrain = (corner: { x: number; y: number }) => {
    const dx = corner.x - centerX;
    const dy = corner.y - centerY;
    const dist = Math.hypot(dx, dy);
    const maxDist = Math.max(Math.abs(dx), Math.abs(dy)) / maxSkew;

    if (dist > maxDist && maxDist > 0) {
      const scale = maxDist / dist;
      return {
        x: centerX + dx * scale,
        y: centerY + dy * scale,
      };
    }

    return corner;
  };

  return {
    topLeft: constrain(corners.topLeft),
    topRight: constrain(corners.topRight),
    bottomLeft: constrain(corners.bottomLeft),
    bottomRight: constrain(corners.bottomRight),
  };
}
