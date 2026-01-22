export type LiquifyTool =
  | 'push'
  | 'twirl-clockwise'
  | 'twirl-counterclockwise'
  | 'pucker'
  | 'bloat'
  | 'push-left'
  | 'freeze'
  | 'thaw'
  | 'reconstruct';

export interface LiquifyBrush {
  size: number;
  pressure: number;
  density: number;
  rate: number;
}

export interface LiquifyState {
  tool: LiquifyTool;
  brush: LiquifyBrush;
  meshSize: number;
  showMesh: boolean;
}

export interface DisplacementMesh {
  width: number;
  height: number;
  cellSize: number;
  cols: number;
  rows: number;
  displacements: Float32Array;
  frozen: Uint8Array;
}

export const DEFAULT_LIQUIFY_BRUSH: LiquifyBrush = {
  size: 100,
  pressure: 50,
  density: 50,
  rate: 80,
};

export const DEFAULT_LIQUIFY_STATE: LiquifyState = {
  tool: 'push',
  brush: DEFAULT_LIQUIFY_BRUSH,
  meshSize: 8,
  showMesh: false,
};

export function createDisplacementMesh(
  width: number,
  height: number,
  cellSize: number = 8
): DisplacementMesh {
  const cols = Math.ceil(width / cellSize) + 1;
  const rows = Math.ceil(height / cellSize) + 1;

  return {
    width,
    height,
    cellSize,
    cols,
    rows,
    displacements: new Float32Array(cols * rows * 2),
    frozen: new Uint8Array(cols * rows),
  };
}

export function resetMesh(mesh: DisplacementMesh): DisplacementMesh {
  return {
    ...mesh,
    displacements: new Float32Array(mesh.cols * mesh.rows * 2),
    frozen: new Uint8Array(mesh.cols * mesh.rows),
  };
}

function getDisplacement(
  mesh: DisplacementMesh,
  col: number,
  row: number
): { dx: number; dy: number } {
  if (col < 0 || col >= mesh.cols || row < 0 || row >= mesh.rows) {
    return { dx: 0, dy: 0 };
  }

  const idx = (row * mesh.cols + col) * 2;
  return {
    dx: mesh.displacements[idx],
    dy: mesh.displacements[idx + 1],
  };
}

function setDisplacement(
  mesh: DisplacementMesh,
  col: number,
  row: number,
  dx: number,
  dy: number
): void {
  if (col < 0 || col >= mesh.cols || row < 0 || row >= mesh.rows) {
    return;
  }

  const idx = (row * mesh.cols + col) * 2;
  const frozenIdx = row * mesh.cols + col;

  if (mesh.frozen[frozenIdx]) {
    return;
  }

  mesh.displacements[idx] = dx;
  mesh.displacements[idx + 1] = dy;
}

function isFrozen(mesh: DisplacementMesh, col: number, row: number): boolean {
  if (col < 0 || col >= mesh.cols || row < 0 || row >= mesh.rows) {
    return true;
  }
  return mesh.frozen[row * mesh.cols + col] === 1;
}

function setFrozen(mesh: DisplacementMesh, col: number, row: number, frozen: boolean): void {
  if (col < 0 || col >= mesh.cols || row < 0 || row >= mesh.rows) {
    return;
  }
  mesh.frozen[row * mesh.cols + col] = frozen ? 1 : 0;
}

function brushFalloff(distance: number, radius: number, density: number): number {
  if (distance >= radius) return 0;

  const normalized = distance / radius;
  const densityFactor = density / 100;

  return Math.pow(1 - Math.pow(normalized, 2), densityFactor * 2 + 0.5);
}

export function applyLiquifyStroke(
  mesh: DisplacementMesh,
  tool: LiquifyTool,
  x: number,
  y: number,
  brush: LiquifyBrush,
  prevX?: number,
  prevY?: number
): DisplacementMesh {
  const newMesh = {
    ...mesh,
    displacements: new Float32Array(mesh.displacements),
    frozen: new Uint8Array(mesh.frozen),
  };

  const radius = brush.size / 2;
  const strength = (brush.pressure / 100) * (brush.rate / 100);

  const minCol = Math.max(0, Math.floor((x - radius) / mesh.cellSize));
  const maxCol = Math.min(mesh.cols - 1, Math.ceil((x + radius) / mesh.cellSize));
  const minRow = Math.max(0, Math.floor((y - radius) / mesh.cellSize));
  const maxRow = Math.min(mesh.rows - 1, Math.ceil((y + radius) / mesh.cellSize));

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const cellX = col * mesh.cellSize;
      const cellY = row * mesh.cellSize;
      const distance = Math.hypot(cellX - x, cellY - y);

      if (distance > radius) continue;
      if (isFrozen(newMesh, col, row) && tool !== 'thaw') continue;

      const falloff = brushFalloff(distance, radius, brush.density);
      const current = getDisplacement(newMesh, col, row);

      let dx = current.dx;
      let dy = current.dy;

      switch (tool) {
        case 'push': {
          if (prevX !== undefined && prevY !== undefined) {
            const pushDx = (x - prevX) * strength * falloff;
            const pushDy = (y - prevY) * strength * falloff;
            dx += pushDx;
            dy += pushDy;
          }
          break;
        }

        case 'twirl-clockwise':
        case 'twirl-counterclockwise': {
          const toCenterX = cellX - x;
          const toCenterY = cellY - y;
          const direction = tool === 'twirl-clockwise' ? 1 : -1;
          const angle = direction * strength * falloff * 0.1;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const rotatedX = toCenterX * cos - toCenterY * sin;
          const rotatedY = toCenterX * sin + toCenterY * cos;
          dx += (rotatedX - toCenterX) * falloff;
          dy += (rotatedY - toCenterY) * falloff;
          break;
        }

        case 'pucker': {
          const toCenterX = x - cellX;
          const toCenterY = y - cellY;
          dx += toCenterX * strength * falloff * 0.1;
          dy += toCenterY * strength * falloff * 0.1;
          break;
        }

        case 'bloat': {
          const fromCenterX = cellX - x;
          const fromCenterY = cellY - y;
          dx += fromCenterX * strength * falloff * 0.1;
          dy += fromCenterY * strength * falloff * 0.1;
          break;
        }

        case 'push-left': {
          if (prevX !== undefined && prevY !== undefined) {
            const moveX = x - prevX;
            const moveY = y - prevY;
            const moveLen = Math.hypot(moveX, moveY);
            if (moveLen > 0) {
              const perpX = -moveY / moveLen;
              const perpY = moveX / moveLen;
              dx += perpX * moveLen * strength * falloff;
              dy += perpY * moveLen * strength * falloff;
            }
          }
          break;
        }

        case 'freeze': {
          setFrozen(newMesh, col, row, true);
          continue;
        }

        case 'thaw': {
          setFrozen(newMesh, col, row, false);
          continue;
        }

        case 'reconstruct': {
          dx *= 1 - (strength * falloff * 0.5);
          dy *= 1 - (strength * falloff * 0.5);
          break;
        }
      }

      setDisplacement(newMesh, col, row, dx, dy);
    }
  }

  return newMesh;
}

function bilinearInterpolate(
  mesh: DisplacementMesh,
  x: number,
  y: number
): { dx: number; dy: number } {
  const col = x / mesh.cellSize;
  const row = y / mesh.cellSize;

  const col0 = Math.floor(col);
  const row0 = Math.floor(row);
  const col1 = col0 + 1;
  const row1 = row0 + 1;

  const fx = col - col0;
  const fy = row - row0;

  const d00 = getDisplacement(mesh, col0, row0);
  const d10 = getDisplacement(mesh, col1, row0);
  const d01 = getDisplacement(mesh, col0, row1);
  const d11 = getDisplacement(mesh, col1, row1);

  return {
    dx:
      d00.dx * (1 - fx) * (1 - fy) +
      d10.dx * fx * (1 - fy) +
      d01.dx * (1 - fx) * fy +
      d11.dx * fx * fy,
    dy:
      d00.dy * (1 - fx) * (1 - fy) +
      d10.dy * fx * (1 - fy) +
      d01.dy * (1 - fx) * fy +
      d11.dy * fx * fy,
  };
}

export function applyLiquify(
  imageData: ImageData,
  mesh: DisplacementMesh,
  interpolation: 'nearest' | 'bilinear' = 'bilinear'
): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const displacement = bilinearInterpolate(mesh, x, y);
      const srcX = x - displacement.dx;
      const srcY = y - displacement.dy;

      const dstIdx = (y * width + x) * 4;

      if (srcX < 0 || srcX >= width - 1 || srcY < 0 || srcY >= height - 1) {
        const clampedX = Math.max(0, Math.min(width - 1, Math.round(srcX)));
        const clampedY = Math.max(0, Math.min(height - 1, Math.round(srcY)));
        const srcIdx = (clampedY * width + clampedX) * 4;

        resultData[dstIdx] = data[srcIdx];
        resultData[dstIdx + 1] = data[srcIdx + 1];
        resultData[dstIdx + 2] = data[srcIdx + 2];
        resultData[dstIdx + 3] = data[srcIdx + 3];
        continue;
      }

      if (interpolation === 'nearest') {
        const roundedX = Math.round(srcX);
        const roundedY = Math.round(srcY);
        const srcIdx = (roundedY * width + roundedX) * 4;

        resultData[dstIdx] = data[srcIdx];
        resultData[dstIdx + 1] = data[srcIdx + 1];
        resultData[dstIdx + 2] = data[srcIdx + 2];
        resultData[dstIdx + 3] = data[srcIdx + 3];
      } else {
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        const fx = srcX - x0;
        const fy = srcY - y0;

        const idx00 = (y0 * width + x0) * 4;
        const idx10 = (y0 * width + x1) * 4;
        const idx01 = (y1 * width + x0) * 4;
        const idx11 = (y1 * width + x1) * 4;

        for (let c = 0; c < 4; c++) {
          const v =
            data[idx00 + c] * (1 - fx) * (1 - fy) +
            data[idx10 + c] * fx * (1 - fy) +
            data[idx01 + c] * (1 - fx) * fy +
            data[idx11 + c] * fx * fy;

          resultData[dstIdx + c] = Math.round(v);
        }
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function renderMesh(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  mesh: DisplacementMesh,
  options: {
    meshColor?: string;
    frozenColor?: string;
    showDisplaced?: boolean;
  } = {}
): void {
  const { meshColor = 'rgba(100, 100, 255, 0.3)', frozenColor = 'rgba(255, 0, 0, 0.3)', showDisplaced = true } = options;

  ctx.save();

  ctx.strokeStyle = meshColor;
  ctx.lineWidth = 0.5;

  for (let row = 0; row < mesh.rows; row++) {
    ctx.beginPath();
    for (let col = 0; col < mesh.cols; col++) {
      let x = col * mesh.cellSize;
      let y = row * mesh.cellSize;

      if (showDisplaced) {
        const d = getDisplacement(mesh, col, row);
        x += d.dx;
        y += d.dy;
      }

      if (col === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  for (let col = 0; col < mesh.cols; col++) {
    ctx.beginPath();
    for (let row = 0; row < mesh.rows; row++) {
      let x = col * mesh.cellSize;
      let y = row * mesh.cellSize;

      if (showDisplaced) {
        const d = getDisplacement(mesh, col, row);
        x += d.dx;
        y += d.dy;
      }

      if (row === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  ctx.fillStyle = frozenColor;
  for (let row = 0; row < mesh.rows; row++) {
    for (let col = 0; col < mesh.cols; col++) {
      if (isFrozen(mesh, col, row)) {
        let x = col * mesh.cellSize;
        let y = row * mesh.cellSize;

        if (showDisplaced) {
          const d = getDisplacement(mesh, col, row);
          x += d.dx;
          y += d.dy;
        }

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

export function renderBrush(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  brush: LiquifyBrush,
  tool: LiquifyTool
): void {
  ctx.save();

  const radius = brush.size / 2;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = tool === 'freeze' ? '#ff6b6b' : tool === 'thaw' ? '#4ecdc4' : '#0ea5e9';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const innerRadius = radius * (brush.density / 100);
  ctx.beginPath();
  ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();
}

export function smoothMesh(mesh: DisplacementMesh, iterations: number = 1): DisplacementMesh {
  let result = { ...mesh, displacements: new Float32Array(mesh.displacements) };

  for (let iter = 0; iter < iterations; iter++) {
    const newDisplacements = new Float32Array(result.displacements);

    for (let row = 1; row < mesh.rows - 1; row++) {
      for (let col = 1; col < mesh.cols - 1; col++) {
        if (isFrozen(result, col, row)) continue;

        const neighbors = [
          getDisplacement(result, col - 1, row),
          getDisplacement(result, col + 1, row),
          getDisplacement(result, col, row - 1),
          getDisplacement(result, col, row + 1),
        ];

        const current = getDisplacement(result, col, row);
        const avgDx = neighbors.reduce((sum, n) => sum + n.dx, 0) / 4;
        const avgDy = neighbors.reduce((sum, n) => sum + n.dy, 0) / 4;

        const idx = (row * mesh.cols + col) * 2;
        newDisplacements[idx] = current.dx * 0.5 + avgDx * 0.5;
        newDisplacements[idx + 1] = current.dy * 0.5 + avgDy * 0.5;
      }
    }

    result.displacements = newDisplacements;
  }

  return result;
}
