export interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface TransformState {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  originX: number;
  originY: number;
}

export interface TransformHandle {
  type: 'corner' | 'edge' | 'rotation' | 'origin';
  position: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'center';
  x: number;
  y: number;
}

export interface TransformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  corners: { nw: Point; ne: Point; se: Point; sw: Point };
}

interface Point {
  x: number;
  y: number;
}

export const DEFAULT_TRANSFORM: TransformState = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  originX: 0.5,
  originY: 0.5,
};

export function createIdentityMatrix(): TransformMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function multiplyMatrices(m1: TransformMatrix, m2: TransformMatrix): TransformMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invertMatrix(m: TransformMatrix): TransformMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-10) return null;

  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    e: (m.c * m.f - m.d * m.e) * invDet,
    f: (m.b * m.e - m.a * m.f) * invDet,
  };
}

export function transformPoint(point: Point, matrix: TransformMatrix): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function createTranslateMatrix(tx: number, ty: number): TransformMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function createScaleMatrix(sx: number, sy: number): TransformMatrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function createRotateMatrix(angle: number): TransformMatrix {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function createSkewMatrix(skewX: number, skewY: number): TransformMatrix {
  const maxSkew = Math.PI / 2 - 0.01;
  const clampedSkewX = Math.max(-maxSkew, Math.min(maxSkew, skewX));
  const clampedSkewY = Math.max(-maxSkew, Math.min(maxSkew, skewY));

  return {
    a: 1,
    b: Math.tan(clampedSkewY),
    c: Math.tan(clampedSkewX),
    d: 1,
    e: 0,
    f: 0,
  };
}

export function stateToMatrix(state: TransformState): TransformMatrix {
  const { x, y, width, height, rotation, scaleX, scaleY, skewX, skewY, originX, originY } = state;

  const ox = x + width * originX;
  const oy = y + height * originY;

  let matrix = createIdentityMatrix();

  matrix = multiplyMatrices(matrix, createTranslateMatrix(ox, oy));
  matrix = multiplyMatrices(matrix, createRotateMatrix(rotation));
  matrix = multiplyMatrices(matrix, createSkewMatrix(skewX, skewY));
  matrix = multiplyMatrices(matrix, createScaleMatrix(scaleX, scaleY));
  matrix = multiplyMatrices(matrix, createTranslateMatrix(-ox, -oy));
  matrix = multiplyMatrices(matrix, createTranslateMatrix(x, y));

  return matrix;
}

export function matrixToState(matrix: TransformMatrix, width: number, height: number): TransformState {
  const scaleX = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
  const scaleY = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);

  const rotation = Math.atan2(matrix.b, matrix.a);

  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const skewX = Math.atan2(matrix.c * cos + matrix.d * sin, matrix.a * cos + matrix.b * sin);
  const skewY = 0;

  return {
    x: matrix.e,
    y: matrix.f,
    width,
    height,
    rotation,
    scaleX,
    scaleY,
    skewX,
    skewY,
    originX: 0.5,
    originY: 0.5,
  };
}

export function getTransformBounds(state: TransformState): TransformBounds {
  const { width, height } = state;
  const matrix = stateToMatrix(state);

  const corners = {
    nw: transformPoint({ x: 0, y: 0 }, matrix),
    ne: transformPoint({ x: width, y: 0 }, matrix),
    se: transformPoint({ x: width, y: height }, matrix),
    sw: transformPoint({ x: 0, y: height }, matrix),
  };

  const xs = [corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x];
  const ys = [corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    corners,
  };
}

export function getTransformHandles(state: TransformState, _handleSize: number = 8): TransformHandle[] {
  const bounds = getTransformBounds(state);
  const { corners } = bounds;

  const midTop = {
    x: (corners.nw.x + corners.ne.x) / 2,
    y: (corners.nw.y + corners.ne.y) / 2,
  };
  const midRight = {
    x: (corners.ne.x + corners.se.x) / 2,
    y: (corners.ne.y + corners.se.y) / 2,
  };
  const midBottom = {
    x: (corners.se.x + corners.sw.x) / 2,
    y: (corners.se.y + corners.sw.y) / 2,
  };
  const midLeft = {
    x: (corners.sw.x + corners.nw.x) / 2,
    y: (corners.sw.y + corners.nw.y) / 2,
  };
  const center = {
    x: (corners.nw.x + corners.se.x) / 2,
    y: (corners.nw.y + corners.se.y) / 2,
  };

  const rotationOffset = 20;
  const rotationHandle = {
    x: midTop.x - Math.sin(state.rotation) * rotationOffset,
    y: midTop.y - Math.cos(state.rotation) * rotationOffset,
  };

  return [
    { type: 'corner', position: 'nw', x: corners.nw.x, y: corners.nw.y },
    { type: 'edge', position: 'n', x: midTop.x, y: midTop.y },
    { type: 'corner', position: 'ne', x: corners.ne.x, y: corners.ne.y },
    { type: 'edge', position: 'e', x: midRight.x, y: midRight.y },
    { type: 'corner', position: 'se', x: corners.se.x, y: corners.se.y },
    { type: 'edge', position: 's', x: midBottom.x, y: midBottom.y },
    { type: 'corner', position: 'sw', x: corners.sw.x, y: corners.sw.y },
    { type: 'edge', position: 'w', x: midLeft.x, y: midLeft.y },
    { type: 'rotation', position: 'n', x: rotationHandle.x, y: rotationHandle.y },
    { type: 'origin', position: 'center', x: center.x, y: center.y },
  ];
}

export function hitTestHandle(
  x: number,
  y: number,
  handles: TransformHandle[],
  threshold: number = 10
): TransformHandle | null {
  for (const handle of handles) {
    const dist = Math.hypot(x - handle.x, y - handle.y);
    if (dist <= threshold) {
      return handle;
    }
  }
  return null;
}

export function scaleFromHandle(
  state: TransformState,
  handle: TransformHandle,
  dx: number,
  dy: number,
  preserveAspect: boolean = false,
  fromCenter: boolean = false
): TransformState {
  const { x, y, width, height, scaleX, scaleY, rotation } = state;

  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localDx = dx * cos - dy * sin;
  const localDy = dx * sin + dy * cos;

  let newScaleX = scaleX;
  let newScaleY = scaleY;
  let newX = x;
  let newY = y;

  switch (handle.position) {
    case 'nw':
      newScaleX = scaleX - localDx / width;
      newScaleY = scaleY - localDy / height;
      if (!fromCenter) {
        newX = x + dx;
        newY = y + dy;
      }
      break;
    case 'ne':
      newScaleX = scaleX + localDx / width;
      newScaleY = scaleY - localDy / height;
      if (!fromCenter) {
        newY = y + dy;
      }
      break;
    case 'se':
      newScaleX = scaleX + localDx / width;
      newScaleY = scaleY + localDy / height;
      break;
    case 'sw':
      newScaleX = scaleX - localDx / width;
      newScaleY = scaleY + localDy / height;
      if (!fromCenter) {
        newX = x + dx;
      }
      break;
    case 'n':
      newScaleY = scaleY - localDy / height;
      if (!fromCenter) {
        newY = y + dy;
      }
      break;
    case 's':
      newScaleY = scaleY + localDy / height;
      break;
    case 'e':
      newScaleX = scaleX + localDx / width;
      break;
    case 'w':
      newScaleX = scaleX - localDx / width;
      if (!fromCenter) {
        newX = x + dx;
      }
      break;
  }

  if (preserveAspect && handle.type === 'corner') {
    const avgScale = (Math.abs(newScaleX) + Math.abs(newScaleY)) / 2;
    newScaleX = avgScale * Math.sign(newScaleX || 1);
    newScaleY = avgScale * Math.sign(newScaleY || 1);
  }

  if (fromCenter) {
    const bounds = getTransformBounds(state);
    const centerX = (bounds.corners.nw.x + bounds.corners.se.x) / 2;
    const centerY = (bounds.corners.nw.y + bounds.corners.se.y) / 2;

    const newState = { ...state, scaleX: newScaleX, scaleY: newScaleY };
    const newBounds = getTransformBounds(newState);
    const newCenterX = (newBounds.corners.nw.x + newBounds.corners.se.x) / 2;
    const newCenterY = (newBounds.corners.nw.y + newBounds.corners.se.y) / 2;

    newX = state.x + (centerX - newCenterX);
    newY = state.y + (centerY - newCenterY);
  }

  return {
    ...state,
    x: newX,
    y: newY,
    scaleX: newScaleX,
    scaleY: newScaleY,
  };
}

export function rotateFromHandle(
  state: TransformState,
  _cx: number,
  _cy: number,
  startAngle: number,
  currentAngle: number,
  snap: boolean = false
): TransformState {
  let deltaAngle = currentAngle - startAngle;

  if (snap) {
    const snapAngle = Math.PI / 12;
    deltaAngle = Math.round(deltaAngle / snapAngle) * snapAngle;
  }

  return {
    ...state,
    rotation: state.rotation + deltaAngle,
  };
}

export function skewFromHandle(
  state: TransformState,
  handle: TransformHandle,
  dx: number,
  dy: number
): TransformState {
  const { width, height } = state;

  let newSkewX = state.skewX;
  let newSkewY = state.skewY;

  if (handle.position === 'n' || handle.position === 's') {
    newSkewX = Math.atan(dx / height) + state.skewX;
  } else if (handle.position === 'e' || handle.position === 'w') {
    newSkewY = Math.atan(dy / width) + state.skewY;
  }

  return {
    ...state,
    skewX: newSkewX,
    skewY: newSkewY,
  };
}

export function moveOrigin(
  state: TransformState,
  newOriginX: number,
  newOriginY: number
): TransformState {
  return {
    ...state,
    originX: Math.max(0, Math.min(1, newOriginX)),
    originY: Math.max(0, Math.min(1, newOriginY)),
  };
}

export function applyTransformToImageData(
  imageData: ImageData,
  state: TransformState,
  interpolation: 'nearest' | 'bilinear' = 'bilinear'
): ImageData {
  const { width: srcWidth, height: srcHeight, data: srcData } = imageData;
  const bounds = getTransformBounds(state);

  const dstWidth = Math.ceil(bounds.width);
  const dstHeight = Math.ceil(bounds.height);
  const dstData = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  const matrix = stateToMatrix(state);
  const invMatrix = invertMatrix(matrix);

  if (!invMatrix) {
    return new ImageData(dstData, dstWidth, dstHeight);
  }

  for (let dstY = 0; dstY < dstHeight; dstY++) {
    for (let dstX = 0; dstX < dstWidth; dstX++) {
      const worldX = bounds.x + dstX;
      const worldY = bounds.y + dstY;

      const srcPoint = transformPoint({ x: worldX, y: worldY }, invMatrix);

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

          const v = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;

          dstData[dstIdx + c] = Math.round(v);
        }
      }
    }
  }

  return new ImageData(dstData, dstWidth, dstHeight);
}

export function renderTransformBox(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  state: TransformState,
  options: {
    handleSize?: number;
    lineColor?: string;
    handleColor?: string;
    handleFillColor?: string;
    showOrigin?: boolean;
    showRotationHandle?: boolean;
  } = {}
): void {
  const {
    handleSize = 8,
    lineColor = '#0ea5e9',
    handleColor = '#0ea5e9',
    handleFillColor = '#ffffff',
    showOrigin = true,
    showRotationHandle = true,
  } = options;

  const bounds = getTransformBounds(state);
  const handles = getTransformHandles(state, handleSize);

  ctx.save();

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.moveTo(bounds.corners.nw.x, bounds.corners.nw.y);
  ctx.lineTo(bounds.corners.ne.x, bounds.corners.ne.y);
  ctx.lineTo(bounds.corners.se.x, bounds.corners.se.y);
  ctx.lineTo(bounds.corners.sw.x, bounds.corners.sw.y);
  ctx.closePath();
  ctx.stroke();

  ctx.setLineDash([]);

  for (const handle of handles) {
    if (handle.type === 'rotation' && !showRotationHandle) continue;
    if (handle.type === 'origin' && !showOrigin) continue;

    ctx.beginPath();

    if (handle.type === 'rotation') {
      const midTop = handles.find((h) => h.type === 'edge' && h.position === 'n');
      if (midTop) {
        ctx.strokeStyle = lineColor;
        ctx.moveTo(midTop.x, midTop.y);
        ctx.lineTo(handle.x, handle.y);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(handle.x, handle.y, handleSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = handleFillColor;
      ctx.fill();
      ctx.strokeStyle = handleColor;
      ctx.stroke();
    } else if (handle.type === 'origin') {
      ctx.strokeStyle = handleColor;
      ctx.lineWidth = 1.5;
      const size = handleSize / 2;
      ctx.moveTo(handle.x - size, handle.y);
      ctx.lineTo(handle.x + size, handle.y);
      ctx.moveTo(handle.x, handle.y - size);
      ctx.lineTo(handle.x, handle.y + size);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(handle.x, handle.y, size, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.rect(
        handle.x - handleSize / 2,
        handle.y - handleSize / 2,
        handleSize,
        handleSize
      );
      ctx.fillStyle = handleFillColor;
      ctx.fill();
      ctx.strokeStyle = handleColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function getCursorForHandle(handle: TransformHandle | null, rotation: number = 0): string {
  if (!handle) return 'default';

  if (handle.type === 'rotation') return 'grab';
  if (handle.type === 'origin') return 'move';

  const cursors: Record<string, string[]> = {
    corner: ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'],
    edge: ['ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'],
  };

  const positions: Record<string, number> = {
    nw: 0, ne: 1, se: 2, sw: 3,
    n: 0, e: 1, s: 2, w: 3,
  };

  const baseCursors = cursors[handle.type];
  const baseIndex = positions[handle.position] || 0;

  const rotationSteps = Math.round((rotation * 4) / Math.PI) % 8;
  const finalIndex = (baseIndex + Math.floor(rotationSteps / 2)) % baseCursors.length;

  return baseCursors[finalIndex];
}
