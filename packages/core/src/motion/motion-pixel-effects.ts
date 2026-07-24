export interface MotionPixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface MotionLevelsOptions {
  readonly inputBlack: number;
  readonly inputWhite: number;
  readonly gamma: number;
  readonly outputBlack: number;
  readonly outputWhite: number;
}

const clampByte = (value: number): number =>
  value < 0 ? 0 : value > 255 ? 255 : value;

export function buildMotionLevelsLut(
  options: MotionLevelsOptions,
): Uint8ClampedArray {
  const inputBlack = clampByte(options.inputBlack);
  const inputWhite = Math.max(inputBlack + 1, clampByte(options.inputWhite));
  const gamma = options.gamma > 0 ? options.gamma : 1;
  const outputBlack = clampByte(options.outputBlack);
  const outputWhite = clampByte(options.outputWhite);
  const lut = new Uint8ClampedArray(256);
  const inputRange = inputWhite - inputBlack;
  const outputRange = outputWhite - outputBlack;
  for (let value = 0; value < 256; value += 1) {
    const normalized = clamp01((value - inputBlack) / inputRange);
    const corrected = Math.pow(normalized, 1 / gamma);
    lut[value] = clampByte(outputBlack + corrected * outputRange);
  }
  return lut;
}

export function applyMotionLevels(
  buffer: MotionPixelBuffer,
  options: MotionLevelsOptions,
): void {
  const lut = buildMotionLevelsLut(options);
  const { data } = buffer;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = lut[data[index]];
    data[index + 1] = lut[data[index + 1]];
    data[index + 2] = lut[data[index + 2]];
  }
}

export function applyMotionPosterize(
  buffer: MotionPixelBuffer,
  levels: number,
): void {
  const steps = Math.max(2, Math.min(255, Math.round(levels)));
  const stepSize = 255 / (steps - 1);
  const { data } = buffer;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampByte(Math.round(data[index] / stepSize) * stepSize);
    data[index + 1] = clampByte(Math.round(data[index + 1] / stepSize) * stepSize);
    data[index + 2] = clampByte(Math.round(data[index + 2] / stepSize) * stepSize);
  }
}

export function applyMotionNoise(
  buffer: MotionPixelBuffer,
  amount: number,
  seed: number,
): void {
  const strength = Math.max(0, Math.min(1, amount)) * 255;
  if (strength <= 0) return;
  const { data } = buffer;
  let state = (Math.floor(seed) || 1) >>> 0;
  const nextRandom = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff - 0.5) * 2;
  };
  for (let index = 0; index < data.length; index += 4) {
    const delta = nextRandom() * strength;
    data[index] = clampByte(data[index] + delta);
    data[index + 1] = clampByte(data[index + 1] + delta);
    data[index + 2] = clampByte(data[index + 2] + delta);
  }
}

export function applyMotionSharpen(
  buffer: MotionPixelBuffer,
  amount: number,
): void {
  const strength = Math.max(0, amount);
  if (strength <= 0) return;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const center = 1 + 4 * strength;
  const side = -strength;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const c = source[index + channel];
        const left = source[((y * width + Math.max(0, x - 1)) * 4) + channel];
        const right =
          source[((y * width + Math.min(width - 1, x + 1)) * 4) + channel];
        const up = source[((Math.max(0, y - 1) * width + x) * 4) + channel];
        const down =
          source[((Math.min(height - 1, y + 1) * width + x) * 4) + channel];
        data[index + channel] = clampByte(
          c * center + (left + right + up + down) * side,
        );
      }
    }
  }
}

export function applyMotionDirectionalBlur(
  buffer: MotionPixelBuffer,
  angleDegrees: number,
  distance: number,
): void {
  const length = Math.max(0, Math.round(distance));
  if (length <= 0) return;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const radians = (angleDegrees * Math.PI) / 180;
  const stepX = Math.cos(radians);
  const stepY = Math.sin(radians);
  const samples = length * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let step = -length; step <= length; step += 1) {
        const sampleX = Math.min(
          width - 1,
          Math.max(0, Math.round(x + stepX * step)),
        );
        const sampleY = Math.min(
          height - 1,
          Math.max(0, Math.round(y + stepY * step)),
        );
        const sampleIndex = (sampleY * width + sampleX) * 4;
        r += source[sampleIndex];
        g += source[sampleIndex + 1];
        b += source[sampleIndex + 2];
        a += source[sampleIndex + 3];
      }
      data[index] = clampByte(r / samples);
      data[index + 1] = clampByte(g / samples);
      data[index + 2] = clampByte(b / samples);
      data[index + 3] = clampByte(a / samples);
    }
  }
}

export function applyMotionRadialBlur(
  buffer: MotionPixelBuffer,
  centerXNormalized: number,
  centerYNormalized: number,
  amount: number,
): void {
  const strength = Math.max(0, Math.min(1, amount));
  if (strength <= 0) return;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const centerX = clamp01(centerXNormalized) * (width - 1);
  const centerY = clamp01(centerYNormalized) * (height - 1);
  const samples = 8;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let step = 0; step < samples; step += 1) {
        const scale = 1 - (strength * 0.5 * step) / samples;
        const sampleX = Math.min(
          width - 1,
          Math.max(0, Math.round(centerX + (x - centerX) * scale)),
        );
        const sampleY = Math.min(
          height - 1,
          Math.max(0, Math.round(centerY + (y - centerY) * scale)),
        );
        const sampleIndex = (sampleY * width + sampleX) * 4;
        r += source[sampleIndex];
        g += source[sampleIndex + 1];
        b += source[sampleIndex + 2];
        a += source[sampleIndex + 3];
      }
      data[index] = clampByte(r / samples);
      data[index + 1] = clampByte(g / samples);
      data[index + 2] = clampByte(b / samples);
      data[index + 3] = clampByte(a / samples);
    }
  }
}

export function applyMotionDisplace(
  buffer: MotionPixelBuffer,
  amount: number,
  scale: number,
  seed: number,
): void {
  const magnitude = Math.max(0, amount);
  if (magnitude <= 0) return;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const frequency = 1 / Math.max(1, scale);
  const seedValue = Math.floor(seed) || 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const offsetX = valueNoise(x * frequency, y * frequency, seedValue) * magnitude;
      const offsetY =
        valueNoise(x * frequency + 31.7, y * frequency + 12.3, seedValue) * magnitude;
      const sampleX = Math.min(
        width - 1,
        Math.max(0, Math.round(x + offsetX)),
      );
      const sampleY = Math.min(
        height - 1,
        Math.max(0, Math.round(y + offsetY)),
      );
      const sampleIndex = (sampleY * width + sampleX) * 4;
      data[index] = source[sampleIndex];
      data[index + 1] = source[sampleIndex + 1];
      data[index + 2] = source[sampleIndex + 2];
      data[index + 3] = source[sampleIndex + 3];
    }
  }
}

export function applyMotionThreshold(
  buffer: MotionPixelBuffer,
  level: number,
): void {
  const threshold = clampByte(level);
  const { data } = buffer;
  for (let index = 0; index < data.length; index += 4) {
    const luminance =
      data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    const value = luminance >= threshold ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
}

export function applyMotionMosaic(
  buffer: MotionPixelBuffer,
  blockSize: number,
): void {
  const size = Math.max(1, Math.round(blockSize));
  if (size <= 1) return;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  for (let top = 0; top < height; top += size) {
    for (let left = 0; left < width; left += size) {
      const sampleX = Math.min(width - 1, left + Math.floor(size / 2));
      const sampleY = Math.min(height - 1, top + Math.floor(size / 2));
      const sample = (sampleY * width + sampleX) * 4;
      for (let y = top; y < Math.min(height, top + size); y += 1) {
        for (let x = left; x < Math.min(width, left + size); x += 1) {
          const index = (y * width + x) * 4;
          data[index] = source[sample];
          data[index + 1] = source[sample + 1];
          data[index + 2] = source[sample + 2];
          data[index + 3] = source[sample + 3];
        }
      }
    }
  }
}

export function applyMotionChromaticAberration(
  buffer: MotionPixelBuffer,
  amount: number,
  angleDegrees: number,
): void {
  const distance = Math.max(0, amount);
  if (distance <= 0) return;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const radians = (angleDegrees * Math.PI) / 180;
  const dx = Math.round(Math.cos(radians) * distance);
  const dy = Math.round(Math.sin(radians) * distance);
  const sample = (x: number, y: number, channel: number): number => {
    const sx = Math.max(0, Math.min(width - 1, x));
    const sy = Math.max(0, Math.min(height - 1, y));
    return source[(sy * width + sx) * 4 + channel];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = sample(x + dx, y + dy, 0);
      data[index + 1] = sample(x, y, 1);
      data[index + 2] = sample(x - dx, y - dy, 2);
    }
  }
}

export function applyMotionVignette(
  buffer: MotionPixelBuffer,
  amount: number,
  softness: number,
): void {
  const strength = clamp01(amount);
  if (strength <= 0) return;
  const feather = Math.max(0.01, clamp01(softness));
  const { width, height, data } = buffer;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDistance = Math.max(1, Math.hypot(cx, cy));
  const edgeStart = 1 - feather;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - cx, y - cy) / maxDistance;
      const fade = clamp01((distance - edgeStart) / feather);
      const multiplier = 1 - fade * strength;
      const index = (y * width + x) * 4;
      data[index] = clampByte(data[index] * multiplier);
      data[index + 1] = clampByte(data[index + 1] * multiplier);
      data[index + 2] = clampByte(data[index + 2] * multiplier);
    }
  }
}

function valueNoise(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
