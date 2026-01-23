export interface GaussianBlurSettings {
  radius: number;
}

export interface MotionBlurSettings {
  angle: number;
  distance: number;
}

export interface RadialBlurSettings {
  amount: number;
  method: 'spin' | 'zoom';
  quality: 'draft' | 'better' | 'best';
  centerX: number;
  centerY: number;
}

export interface LensBlurSettings {
  radius: number;
  irisShape: number;
  irisRotation: number;
  irisCurvature: number;
  highlightBrightness: number;
  highlightThreshold: number;
}

export interface SurfaceBlurSettings {
  radius: number;
  threshold: number;
}

export interface TiltShiftSettings {
  blur: number;
  focusY: number;
  focusHeight: number;
  transitionSize: number;
  angle: number;
}

export const DEFAULT_GAUSSIAN_BLUR: GaussianBlurSettings = {
  radius: 5,
};

export const DEFAULT_MOTION_BLUR: MotionBlurSettings = {
  angle: 0,
  distance: 10,
};

export const DEFAULT_RADIAL_BLUR: RadialBlurSettings = {
  amount: 10,
  method: 'spin',
  quality: 'better',
  centerX: 0.5,
  centerY: 0.5,
};

export const DEFAULT_LENS_BLUR: LensBlurSettings = {
  radius: 15,
  irisShape: 6,
  irisRotation: 0,
  irisCurvature: 0,
  highlightBrightness: 0,
  highlightThreshold: 255,
};

export const DEFAULT_SURFACE_BLUR: SurfaceBlurSettings = {
  radius: 5,
  threshold: 15,
};

export const DEFAULT_TILT_SHIFT: TiltShiftSettings = {
  blur: 15,
  focusY: 0.5,
  focusHeight: 0.2,
  transitionSize: 0.1,
  angle: 0,
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

export function applyGaussianBlur(imageData: ImageData, settings: GaussianBlurSettings): ImageData {
  const { width, height, data } = imageData;
  const radius = Math.max(1, Math.round(settings.radius));
  const kernel = createGaussianKernel(radius);

  const tempData = new Uint8ClampedArray(data);
  const resultData = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(Math.max(x + k, 0), width - 1);
        const idx = (y * width + sx) * 4;
        const weight = kernel[k + radius];

        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
        a += data[idx + 3] * weight;
      }

      const idx = (y * width + x) * 4;
      tempData[idx] = r;
      tempData[idx + 1] = g;
      tempData[idx + 2] = b;
      tempData[idx + 3] = a;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(Math.max(y + k, 0), height - 1);
        const idx = (sy * width + x) * 4;
        const weight = kernel[k + radius];

        r += tempData[idx] * weight;
        g += tempData[idx + 1] * weight;
        b += tempData[idx + 2] * weight;
        a += tempData[idx + 3] * weight;
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = r;
      resultData[idx + 1] = g;
      resultData[idx + 2] = b;
      resultData[idx + 3] = a;
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyMotionBlur(imageData: ImageData, settings: MotionBlurSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const angleRad = (settings.angle * Math.PI) / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  const samples = Math.max(1, Math.round(settings.distance));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;

      for (let i = -samples; i <= samples; i++) {
        const sx = Math.round(x + dx * i);
        const sy = Math.round(y + dy * i);

        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          const idx = (sy * width + sx) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          a += data[idx + 3];
          count++;
        }
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = r / count;
      resultData[idx + 1] = g / count;
      resultData[idx + 2] = b / count;
      resultData[idx + 3] = a / count;
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyRadialBlur(imageData: ImageData, settings: RadialBlurSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const centerX = width * settings.centerX;
  const centerY = height * settings.centerY;

  const qualitySamples = settings.quality === 'draft' ? 8 : settings.quality === 'better' ? 16 : 32;
  const amount = settings.amount / 100;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      for (let i = 0; i < qualitySamples; i++) {
        const t = (i / qualitySamples - 0.5) * amount;
        let sx: number, sy: number;

        if (settings.method === 'spin') {
          const newAngle = angle + t;
          sx = Math.round(centerX + Math.cos(newAngle) * dist);
          sy = Math.round(centerY + Math.sin(newAngle) * dist);
        } else {
          const scale = 1 + t;
          sx = Math.round(centerX + dx * scale);
          sy = Math.round(centerY + dy * scale);
        }

        sx = Math.min(Math.max(sx, 0), width - 1);
        sy = Math.min(Math.max(sy, 0), height - 1);

        const idx = (sy * width + sx) * 4;
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        a += data[idx + 3];
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = r / qualitySamples;
      resultData[idx + 1] = g / qualitySamples;
      resultData[idx + 2] = b / qualitySamples;
      resultData[idx + 3] = a / qualitySamples;
    }
  }

  return new ImageData(resultData, width, height);
}

function createBokehKernel(radius: number, shape: number, rotation: number): Array<{ x: number; y: number; weight: number }> {
  const kernel: Array<{ x: number; y: number; weight: number }> = [];
  const rotRad = (rotation * Math.PI) / 180;
  const safeShape = Math.max(3, Math.round(shape));

  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const rx = x * Math.cos(rotRad) - y * Math.sin(rotRad);
      const ry = x * Math.sin(rotRad) + y * Math.cos(rotRad);

      const angle = Math.atan2(ry, rx);
      const angleStep = (2 * Math.PI) / safeShape;
      const cosValue = Math.cos((angle % angleStep) - angleStep / 2);
      const polygonRadius = Math.abs(cosValue) > 0.001 ? radius / cosValue : radius;

      const dist = Math.sqrt(rx * rx + ry * ry);
      if (dist <= Math.abs(polygonRadius)) {
        kernel.push({ x, y, weight: 1 });
      }
    }
  }

  if (kernel.length === 0) {
    kernel.push({ x: 0, y: 0, weight: 1 });
  } else {
    const totalWeight = kernel.length;
    kernel.forEach(k => k.weight /= totalWeight);
  }

  return kernel;
}

export function applyLensBlur(imageData: ImageData, settings: LensBlurSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const radius = Math.max(1, Math.round(settings.radius));
  const kernel = createBokehKernel(radius, settings.irisShape, settings.irisRotation);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      let totalWeight = 0;

      for (const k of kernel) {
        const sx = Math.min(Math.max(x + k.x, 0), width - 1);
        const sy = Math.min(Math.max(y + k.y, 0), height - 1);
        const idx = (sy * width + sx) * 4;

        const luminance = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
        let weight = k.weight;

        if (luminance > settings.highlightThreshold && settings.highlightThreshold < 255) {
          weight *= 1 + (settings.highlightBrightness / 100) * ((luminance - settings.highlightThreshold) / (255 - settings.highlightThreshold));
        }

        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
        a += data[idx + 3] * weight;
        totalWeight += weight;
      }

      const idx = (y * width + x) * 4;
      if (totalWeight > 0) {
        resultData[idx] = Math.min(255, r / totalWeight);
        resultData[idx + 1] = Math.min(255, g / totalWeight);
        resultData[idx + 2] = Math.min(255, b / totalWeight);
        resultData[idx + 3] = a / totalWeight;
      } else {
        resultData[idx] = data[idx];
        resultData[idx + 1] = data[idx + 1];
        resultData[idx + 2] = data[idx + 2];
        resultData[idx + 3] = data[idx + 3];
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function applySurfaceBlur(imageData: ImageData, settings: SurfaceBlurSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const radius = Math.max(1, Math.round(settings.radius));
  const threshold = settings.threshold;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerIdx = (y * width + x) * 4;
      const centerR = data[centerIdx];
      const centerG = data[centerIdx + 1];
      const centerB = data[centerIdx + 2];

      let r = 0, g = 0, b = 0, a = 0;
      let totalWeight = 0;

      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const sx = Math.min(Math.max(x + kx, 0), width - 1);
          const sy = Math.min(Math.max(y + ky, 0), height - 1);
          const idx = (sy * width + sx) * 4;

          const diff = Math.abs(data[idx] - centerR) +
                       Math.abs(data[idx + 1] - centerG) +
                       Math.abs(data[idx + 2] - centerB);

          const colorWeight = Math.max(0, 1 - diff / (threshold * 3));
          const spatialWeight = 1 / (1 + Math.sqrt(kx * kx + ky * ky));
          const weight = colorWeight * spatialWeight;

          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
          a += data[idx + 3] * weight;
          totalWeight += weight;
        }
      }

      resultData[centerIdx] = r / totalWeight;
      resultData[centerIdx + 1] = g / totalWeight;
      resultData[centerIdx + 2] = b / totalWeight;
      resultData[centerIdx + 3] = a / totalWeight;
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyTiltShift(imageData: ImageData, settings: TiltShiftSettings): ImageData {
  const { width, height, data } = imageData;

  const blurredData = applyGaussianBlur(imageData, { radius: settings.blur });
  const blurData = blurredData.data;
  const resultData = new Uint8ClampedArray(data.length);

  const focusCenter = height * settings.focusY;
  const focusHalfHeight = (height * settings.focusHeight) / 2;
  const transitionSize = height * settings.transitionSize;

  const angleRad = (settings.angle * Math.PI) / 180;
  const centerX = width / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const adjustedY = y + Math.tan(angleRad) * dx;

      const distFromCenter = Math.abs(adjustedY - focusCenter);
      let blurAmount: number;

      if (distFromCenter < focusHalfHeight) {
        blurAmount = 0;
      } else if (distFromCenter < focusHalfHeight + transitionSize) {
        blurAmount = (distFromCenter - focusHalfHeight) / transitionSize;
        blurAmount = blurAmount * blurAmount;
      } else {
        blurAmount = 1;
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = data[idx] * (1 - blurAmount) + blurData[idx] * blurAmount;
      resultData[idx + 1] = data[idx + 1] * (1 - blurAmount) + blurData[idx + 1] * blurAmount;
      resultData[idx + 2] = data[idx + 2] * (1 - blurAmount) + blurData[idx + 2] * blurAmount;
      resultData[idx + 3] = data[idx + 3];
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyBoxBlur(imageData: ImageData, radius: number): ImageData {
  const { width, height, data } = imageData;
  const size = radius * 2 + 1;

  const tempData = new Uint8ClampedArray(data);
  const resultData = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(Math.max(x + k, 0), width - 1);
        const idx = (y * width + sx) * 4;
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        a += data[idx + 3];
      }

      const idx = (y * width + x) * 4;
      tempData[idx] = r / size;
      tempData[idx + 1] = g / size;
      tempData[idx + 2] = b / size;
      tempData[idx + 3] = a / size;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(Math.max(y + k, 0), height - 1);
        const idx = (sy * width + x) * 4;
        r += tempData[idx];
        g += tempData[idx + 1];
        b += tempData[idx + 2];
        a += tempData[idx + 3];
      }

      const idx = (y * width + x) * 4;
      resultData[idx] = r / size;
      resultData[idx + 1] = g / size;
      resultData[idx + 2] = b / size;
      resultData[idx + 3] = a / size;
    }
  }

  return new ImageData(resultData, width, height);
}
