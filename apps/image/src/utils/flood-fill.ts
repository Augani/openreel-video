export interface FloodFillOptions {
  tolerance: number;
  contiguous: boolean;
  antiAlias: boolean;
  opacity: number;
}

function colorDistance(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number {
  return Math.sqrt(
    Math.pow(r1 - r2, 2) +
    Math.pow(g1 - g2, 2) +
    Math.pow(b1 - b2, 2) +
    Math.pow(a1 - a2, 2)
  );
}

function hexToRgba(hex: string): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
      255
    ];
  }
  return [0, 0, 0, 255];
}

export function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: string,
  options: FloodFillOptions
): ImageData {
  const { width, height, data } = imageData;
  const result = new ImageData(new Uint8ClampedArray(data), width, height);
  const resultData = result.data;

  const [fillR, fillG, fillB] = hexToRgba(fillColor);
  const fillA = Math.round(options.opacity * 255);

  const x = Math.floor(startX);
  const y = Math.floor(startY);

  if (x < 0 || x >= width || y < 0 || y >= height) {
    return result;
  }

  const startIdx = (y * width + x) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  const threshold = options.tolerance * Math.sqrt(4);

  if (
    colorDistance(targetR, targetG, targetB, targetA, fillR, fillG, fillB, fillA) < 1
  ) {
    return result;
  }

  const visited = new Uint8Array(width * height);

  function matchesTarget(idx: number): boolean {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    return colorDistance(r, g, b, a, targetR, targetG, targetB, targetA) <= threshold;
  }

  function fillPixel(idx: number, strength: number = 1) {
    const blendAlpha = fillA * strength;
    const srcAlpha = resultData[idx + 3];
    const outAlpha = blendAlpha + srcAlpha * (1 - blendAlpha / 255);

    if (outAlpha > 0) {
      resultData[idx] = (fillR * blendAlpha + resultData[idx] * srcAlpha * (1 - blendAlpha / 255)) / outAlpha;
      resultData[idx + 1] = (fillG * blendAlpha + resultData[idx + 1] * srcAlpha * (1 - blendAlpha / 255)) / outAlpha;
      resultData[idx + 2] = (fillB * blendAlpha + resultData[idx + 2] * srcAlpha * (1 - blendAlpha / 255)) / outAlpha;
      resultData[idx + 3] = Math.round(outAlpha);
    }
  }

  if (options.contiguous) {
    const stack: [number, number][] = [[x, y]];

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const pixelIdx = cy * width + cx;

      if (visited[pixelIdx]) continue;
      visited[pixelIdx] = 1;

      const idx = pixelIdx * 4;
      if (!matchesTarget(idx)) continue;

      fillPixel(idx);

      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx < width - 1) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy < height - 1) stack.push([cx, cy + 1]);
    }

    if (options.antiAlias) {
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const pixelIdx = py * width + px;
          if (!visited[pixelIdx]) continue;

          const neighbors = [
            px > 0 ? visited[pixelIdx - 1] : 1,
            px < width - 1 ? visited[pixelIdx + 1] : 1,
            py > 0 ? visited[pixelIdx - width] : 1,
            py < height - 1 ? visited[pixelIdx + width] : 1,
          ];

          const filledNeighbors = neighbors.filter(n => n === 1).length;
          if (filledNeighbors < 4) {
            const idx = pixelIdx * 4;
            const edgeStrength = 0.5 + filledNeighbors * 0.125;
            fillPixel(idx, edgeStrength);
          }
        }
      }
    }
  } else {
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = (py * width + px) * 4;
        if (matchesTarget(idx)) {
          fillPixel(idx);
        }
      }
    }
  }

  return result;
}

export function applyFloodFillToCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fillColor: string,
  options: FloodFillOptions
): void {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const filledData = floodFill(imageData, x, y, fillColor, options);
  ctx.putImageData(filledData, 0, 0);
}
