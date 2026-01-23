export interface PosterizeSettings {
  levels: number;
}

export interface ThresholdSettings {
  level: number;
}

export const DEFAULT_POSTERIZE: PosterizeSettings = {
  levels: 4,
};

export const DEFAULT_THRESHOLD: ThresholdSettings = {
  level: 128,
};

export function applyPosterize(imageData: ImageData, settings: PosterizeSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const levels = Math.max(2, Math.min(255, Math.round(settings.levels)));
  const step = 255 / (levels - 1);
  const divisor = 256 / levels;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    resultData[i] = Math.round(Math.floor(r / divisor) * step);
    resultData[i + 1] = Math.round(Math.floor(g / divisor) * step);
    resultData[i + 2] = Math.round(Math.floor(b / divisor) * step);
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}

export function applyThreshold(imageData: ImageData, settings: ThresholdSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const level = Math.max(0, Math.min(255, settings.level));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const luminance = r * 0.299 + g * 0.587 + b * 0.114;
    const value = luminance >= level ? 255 : 0;

    resultData[i] = value;
    resultData[i + 1] = value;
    resultData[i + 2] = value;
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}

export function applyAdaptiveThreshold(
  imageData: ImageData,
  blockSize: number = 11,
  constant: number = 2
): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const grayData = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    grayData[idx] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  const halfBlock = Math.floor(blockSize / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let by = -halfBlock; by <= halfBlock; by++) {
        for (let bx = -halfBlock; bx <= halfBlock; bx++) {
          const nx = Math.min(Math.max(x + bx, 0), width - 1);
          const ny = Math.min(Math.max(y + by, 0), height - 1);
          sum += grayData[ny * width + nx];
          count++;
        }
      }

      const mean = sum / count;
      const threshold = mean - constant;
      const pixelIdx = y * width + x;
      const value = grayData[pixelIdx] > threshold ? 255 : 0;

      const i = pixelIdx * 4;
      resultData[i] = value;
      resultData[i + 1] = value;
      resultData[i + 2] = value;
      resultData[i + 3] = data[i + 3];
    }
  }

  return new ImageData(resultData, width, height);
}
