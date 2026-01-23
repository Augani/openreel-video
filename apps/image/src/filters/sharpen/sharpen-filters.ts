export interface UnsharpMaskSettings {
  amount: number;
  radius: number;
  threshold: number;
}

export interface SmartSharpenSettings {
  amount: number;
  radius: number;
  removeBlur: 'gaussian' | 'lens' | 'motion';
  motionAngle?: number;
  noiseReduction: number;
}

export interface HighPassSettings {
  radius: number;
}

export const DEFAULT_UNSHARP_MASK: UnsharpMaskSettings = {
  amount: 50,
  radius: 1,
  threshold: 0,
};

export const DEFAULT_SMART_SHARPEN: SmartSharpenSettings = {
  amount: 100,
  radius: 1,
  removeBlur: 'gaussian',
  noiseReduction: 0,
};

export const DEFAULT_HIGH_PASS: HighPassSettings = {
  radius: 10,
};

function createGaussianKernel(radius: number): number[] {
  const size = radius * 2 + 1;
  const kernel = new Array(size);
  const sigma = radius / 3;
  const twoSigmaSquare = 2 * sigma * sigma;
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / twoSigmaSquare);
    sum += kernel[i];
  }

  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

function gaussianBlur(data: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const kernel = createGaussianKernel(radius);
  const tempData = new Uint8ClampedArray(data);
  const resultData = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;

      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(Math.max(x + k, 0), width - 1);
        const idx = (y * width + sx) * 4;
        const weight = kernel[k + radius];

        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
      }

      const idx = (y * width + x) * 4;
      tempData[idx] = r;
      tempData[idx + 1] = g;
      tempData[idx + 2] = b;
      tempData[idx + 3] = data[idx + 3];
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;

      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(Math.max(y + k, 0), height - 1);
        const idx = (sy * width + x) * 4;
        const weight = kernel[k + radius];

        r += tempData[idx] * weight;
        g += tempData[idx + 1] * weight;
        b += tempData[idx + 2] * weight;
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = r;
      resultData[idx + 1] = g;
      resultData[idx + 2] = b;
      resultData[idx + 3] = tempData[idx + 3];
    }
  }

  return resultData;
}

export function applyUnsharpMask(imageData: ImageData, settings: UnsharpMaskSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const radius = Math.max(1, Math.round(settings.radius));
  const amount = settings.amount / 100;
  const threshold = settings.threshold;

  const blurredData = gaussianBlur(data, width, height, radius);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const original = data[i + c];
      const blurred = blurredData[i + c];
      const diff = original - blurred;

      if (Math.abs(diff) >= threshold) {
        resultData[i + c] = Math.max(0, Math.min(255, original + diff * amount));
      } else {
        resultData[i + c] = original;
      }
    }
    resultData[i + 3] = data[i + 3];
  }

  return new ImageData(resultData, width, height);
}

function motionBlur(data: Uint8ClampedArray, width: number, height: number, radius: number, angle: number): Uint8ClampedArray {
  const resultData = new Uint8ClampedArray(data.length);
  const angleRad = (angle * Math.PI) / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      let count = 0;

      for (let k = -radius; k <= radius; k++) {
        const sx = Math.round(x + dx * k);
        const sy = Math.round(y + dy * k);

        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          const idx = (sy * width + sx) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = r / count;
      resultData[idx + 1] = g / count;
      resultData[idx + 2] = b / count;
      resultData[idx + 3] = data[idx + 3];
    }
  }

  return resultData;
}

export function applySmartSharpen(imageData: ImageData, settings: SmartSharpenSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const radius = Math.max(1, Math.round(settings.radius));
  const amount = settings.amount / 100;
  const noiseReduction = settings.noiseReduction / 100;

  let blurredData: Uint8ClampedArray;

  switch (settings.removeBlur) {
    case 'motion':
      blurredData = motionBlur(data, width, height, radius, settings.motionAngle ?? 0);
      break;
    case 'lens':
      blurredData = gaussianBlur(data, width, height, radius);
      break;
    case 'gaussian':
    default:
      blurredData = gaussianBlur(data, width, height, radius);
      break;
  }

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const original = data[i + c];
      const blurred = blurredData[i + c];
      let diff = original - blurred;

      if (noiseReduction > 0) {
        const absDiff = Math.abs(diff);
        if (absDiff < 10 * noiseReduction) {
          diff *= 1 - noiseReduction;
        }
      }

      resultData[i + c] = Math.max(0, Math.min(255, original + diff * amount));
    }
    resultData[i + 3] = data[i + 3];
  }

  return new ImageData(resultData, width, height);
}

export function applyHighPass(imageData: ImageData, settings: HighPassSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const radius = Math.max(1, Math.round(settings.radius));
  const blurredData = gaussianBlur(data, width, height, radius);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const original = data[i + c];
      const blurred = blurredData[i + c];
      resultData[i + c] = Math.max(0, Math.min(255, 128 + (original - blurred)));
    }
    resultData[i + 3] = data[i + 3];
  }

  return new ImageData(resultData, width, height);
}

export function applySharpen(imageData: ImageData, amount: number = 50): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const factor = amount / 100;

  const kernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0,
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            sum += data[idx + c] * kernel[ki];
            ki++;
          }
        }

        const idx = (y * width + x) * 4;
        const original = data[idx + c];
        resultData[idx + c] = Math.max(0, Math.min(255, original + (sum - original) * factor));
      }

      const idx = (y * width + x) * 4;
      resultData[idx + 3] = data[idx + 3];
    }
  }

  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) {
      resultData[x * 4 + c] = data[x * 4 + c];
      resultData[((height - 1) * width + x) * 4 + c] = data[((height - 1) * width + x) * 4 + c];
    }
  }

  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 4; c++) {
      resultData[(y * width) * 4 + c] = data[(y * width) * 4 + c];
      resultData[(y * width + width - 1) * 4 + c] = data[(y * width + width - 1) * 4 + c];
    }
  }

  return new ImageData(resultData, width, height);
}
