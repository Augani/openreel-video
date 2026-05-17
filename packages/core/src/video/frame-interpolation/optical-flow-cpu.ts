import type { FlowField, InterpolationConfig } from "./types";

export class OpticalFlowCPU {
  private config: InterpolationConfig;

  constructor(config: InterpolationConfig) {
    this.config = config;
  }

  async computeFlowField(
    frame1: ImageData,
    frame2: ImageData,
  ): Promise<FlowField> {
    const { blockSize, searchRadius, pyramidLevels } = this.config;

    const pyramid1 = this.buildPyramid(frame1, pyramidLevels);
    const pyramid2 = this.buildPyramid(frame2, pyramidLevels);

    const coarsestWidth = pyramid1[pyramidLevels - 1].width;
    const coarsestHeight = pyramid1[pyramidLevels - 1].height;
    const blocksX = Math.ceil(coarsestWidth / blockSize);
    const blocksY = Math.ceil(coarsestHeight / blockSize);

    let flowField: FlowField = {
      width: blocksX,
      height: blocksY,
      vectors: new Float32Array(blocksX * blocksY * 2),
    };

    for (let level = pyramidLevels - 1; level >= 0; level--) {
      const img1 = pyramid1[level];
      const img2 = pyramid2[level];
      const levelBlocksX = Math.ceil(img1.width / blockSize);
      const levelBlocksY = Math.ceil(img1.height / blockSize);
      const levelFlow: FlowField = {
        width: levelBlocksX,
        height: levelBlocksY,
        vectors: new Float32Array(levelBlocksX * levelBlocksY * 2),
      };

      const scale = level < pyramidLevels - 1 ? 2 : 1;
      const effectiveSearchRadius = Math.ceil(searchRadius / (level + 1));

      for (let by = 0; by < levelBlocksY; by++) {
        for (let bx = 0; bx < levelBlocksX; bx++) {
          let initialDx = 0;
          let initialDy = 0;

          if (level < pyramidLevels - 1) {
            const prevBx = Math.min(
              Math.floor(bx / scale),
              flowField.width - 1,
            );
            const prevBy = Math.min(
              Math.floor(by / scale),
              flowField.height - 1,
            );
            const prevIdx = (prevBy * flowField.width + prevBx) * 2;
            initialDx = flowField.vectors[prevIdx] * scale;
            initialDy = flowField.vectors[prevIdx + 1] * scale;
          }

          const { dx, dy } = this.blockMatch(
            img1,
            img2,
            bx * blockSize,
            by * blockSize,
            blockSize,
            effectiveSearchRadius,
            initialDx,
            initialDy,
          );

          const idx = (by * levelBlocksX + bx) * 2;
          levelFlow.vectors[idx] = dx;
          levelFlow.vectors[idx + 1] = dy;
        }
      }

      flowField = levelFlow;
    }

    return flowField;
  }

  warpAndBlend(
    frame1: ImageData,
    frame2: ImageData,
    flowField: FlowField,
    t: number,
  ): ImageData {
    const width = frame1.width;
    const height = frame1.height;
    const output = new ImageData(width, height);
    const { blockSize } = this.config;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bx = Math.min(
          Math.floor(x / blockSize),
          flowField.width - 1,
        );
        const by = Math.min(
          Math.floor(y / blockSize),
          flowField.height - 1,
        );
        const flowIdx = (by * flowField.width + bx) * 2;
        const dx = flowField.vectors[flowIdx];
        const dy = flowField.vectors[flowIdx + 1];

        const src1X = x - dx * t;
        const src1Y = y - dy * t;
        const src2X = x + dx * (1 - t);
        const src2Y = y + dy * (1 - t);

        const pixel1 = this.bilinearSample(frame1, src1X, src1Y);
        const pixel2 = this.bilinearSample(frame2, src2X, src2Y);

        const outIdx = (y * width + x) * 4;
        output.data[outIdx] = pixel1[0] * (1 - t) + pixel2[0] * t;
        output.data[outIdx + 1] = pixel1[1] * (1 - t) + pixel2[1] * t;
        output.data[outIdx + 2] = pixel1[2] * (1 - t) + pixel2[2] * t;
        output.data[outIdx + 3] = 255;
      }
    }

    return output;
  }

  private blockMatch(
    img1: ImageData,
    img2: ImageData,
    blockX: number,
    blockY: number,
    blockSize: number,
    searchRadius: number,
    initialDx: number,
    initialDy: number,
  ): { dx: number; dy: number } {
    let bestDx = initialDx;
    let bestDy = initialDy;
    let bestSAD = Infinity;

    const centerSearchX = Math.round(initialDx);
    const centerSearchY = Math.round(initialDy);

    for (let sy = -searchRadius; sy <= searchRadius; sy += 2) {
      for (let sx = -searchRadius; sx <= searchRadius; sx += 2) {
        const dx = centerSearchX + sx;
        const dy = centerSearchY + sy;
        const sad = this.computeSAD(
          img1,
          img2,
          blockX,
          blockY,
          blockX + dx,
          blockY + dy,
          blockSize,
        );

        if (sad < bestSAD) {
          bestSAD = sad;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }

    for (let sy = -1; sy <= 1; sy++) {
      for (let sx = -1; sx <= 1; sx++) {
        if (sx === 0 && sy === 0) continue;
        const dx = bestDx + sx;
        const dy = bestDy + sy;
        const sad = this.computeSAD(
          img1,
          img2,
          blockX,
          blockY,
          blockX + dx,
          blockY + dy,
          blockSize,
        );

        if (sad < bestSAD) {
          bestSAD = sad;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }

    return { dx: bestDx, dy: bestDy };
  }

  private computeSAD(
    img1: ImageData,
    img2: ImageData,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    blockSize: number,
  ): number {
    let sad = 0;
    const w = img1.width;
    const h = img1.height;

    for (let dy = 0; dy < blockSize; dy++) {
      for (let dx = 0; dx < blockSize; dx++) {
        const px1 = x1 + dx;
        const py1 = y1 + dy;
        const px2 = x2 + dx;
        const py2 = y2 + dy;

        if (px1 < 0 || px1 >= w || py1 < 0 || py1 >= h) {
          sad += 128;
          continue;
        }
        if (px2 < 0 || px2 >= w || py2 < 0 || py2 >= h) {
          sad += 128;
          continue;
        }

        const idx1 = (py1 * w + px1) * 4;
        const idx2 = (py2 * w + px2) * 4;

        const gray1 =
          img1.data[idx1] * 0.299 +
          img1.data[idx1 + 1] * 0.587 +
          img1.data[idx1 + 2] * 0.114;
        const gray2 =
          img2.data[idx2] * 0.299 +
          img2.data[idx2 + 1] * 0.587 +
          img2.data[idx2 + 2] * 0.114;

        sad += Math.abs(gray1 - gray2);
      }
    }

    return sad;
  }

  private bilinearSample(
    img: ImageData,
    x: number,
    y: number,
  ): [number, number, number] {
    const w = img.width;
    const h = img.height;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;

    const idx00 = (y0 * w + x0) * 4;
    const idx10 = (y0 * w + x1) * 4;
    const idx01 = (y1 * w + x0) * 4;
    const idx11 = (y1 * w + x1) * 4;

    const r =
      img.data[idx00] * (1 - fx) * (1 - fy) +
      img.data[idx10] * fx * (1 - fy) +
      img.data[idx01] * (1 - fx) * fy +
      img.data[idx11] * fx * fy;
    const g =
      img.data[idx00 + 1] * (1 - fx) * (1 - fy) +
      img.data[idx10 + 1] * fx * (1 - fy) +
      img.data[idx01 + 1] * (1 - fx) * fy +
      img.data[idx11 + 1] * fx * fy;
    const b =
      img.data[idx00 + 2] * (1 - fx) * (1 - fy) +
      img.data[idx10 + 2] * fx * (1 - fy) +
      img.data[idx01 + 2] * (1 - fx) * fy +
      img.data[idx11 + 2] * fx * fy;

    return [r, g, b];
  }

  private buildPyramid(img: ImageData, levels: number): ImageData[] {
    const pyramid: ImageData[] = [img];

    for (let i = 1; i < levels; i++) {
      const prev = pyramid[i - 1];
      const newW = Math.max(1, Math.floor(prev.width / 2));
      const newH = Math.max(1, Math.floor(prev.height / 2));
      const downsampled = new ImageData(newW, newH);

      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          const srcX = x * 2;
          const srcY = y * 2;
          const idx = (y * newW + x) * 4;

          const s00 = (srcY * prev.width + srcX) * 4;
          const s10 = (srcY * prev.width + Math.min(srcX + 1, prev.width - 1)) * 4;
          const s01 = (Math.min(srcY + 1, prev.height - 1) * prev.width + srcX) * 4;
          const s11 =
            (Math.min(srcY + 1, prev.height - 1) * prev.width +
              Math.min(srcX + 1, prev.width - 1)) *
            4;

          downsampled.data[idx] =
            (prev.data[s00] + prev.data[s10] + prev.data[s01] + prev.data[s11]) >> 2;
          downsampled.data[idx + 1] =
            (prev.data[s00 + 1] + prev.data[s10 + 1] + prev.data[s01 + 1] + prev.data[s11 + 1]) >> 2;
          downsampled.data[idx + 2] =
            (prev.data[s00 + 2] + prev.data[s10 + 2] + prev.data[s01 + 2] + prev.data[s11 + 2]) >> 2;
          downsampled.data[idx + 3] = 255;
        }
      }

      pyramid.push(downsampled);
    }

    return pyramid;
  }
}
