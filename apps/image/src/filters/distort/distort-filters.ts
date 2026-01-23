export interface SpherizeSettings {
  amount: number;
  mode: 'normal' | 'horizontal' | 'vertical';
  centerX: number;
  centerY: number;
}

export interface PinchSettings {
  amount: number;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface TwirlSettings {
  angle: number;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface WaveSettings {
  generators: number;
  wavelengthMin: number;
  wavelengthMax: number;
  amplitudeMin: number;
  amplitudeMax: number;
  scaleX: number;
  scaleY: number;
  type: 'sine' | 'triangle' | 'square';
  wrapAround: boolean;
}

export interface RippleSettings {
  amount: number;
  size: 'small' | 'medium' | 'large';
}

export interface ZigZagSettings {
  amount: number;
  ridges: number;
  style: 'around-center' | 'out-from-center' | 'pond-ripples';
  centerX: number;
  centerY: number;
}

export interface PolarCoordinatesSettings {
  mode: 'rectangular-to-polar' | 'polar-to-rectangular';
}

export const DEFAULT_SPHERIZE: SpherizeSettings = {
  amount: 100,
  mode: 'normal',
  centerX: 0.5,
  centerY: 0.5,
};

export const DEFAULT_PINCH: PinchSettings = {
  amount: 50,
  centerX: 0.5,
  centerY: 0.5,
  radius: 0.5,
};

export const DEFAULT_TWIRL: TwirlSettings = {
  angle: 50,
  centerX: 0.5,
  centerY: 0.5,
  radius: 0.5,
};

export const DEFAULT_WAVE: WaveSettings = {
  generators: 5,
  wavelengthMin: 10,
  wavelengthMax: 120,
  amplitudeMin: 5,
  amplitudeMax: 35,
  scaleX: 100,
  scaleY: 100,
  type: 'sine',
  wrapAround: true,
};

export const DEFAULT_RIPPLE: RippleSettings = {
  amount: 100,
  size: 'medium',
};

export const DEFAULT_ZIGZAG: ZigZagSettings = {
  amount: 100,
  ridges: 5,
  style: 'pond-ripples',
  centerX: 0.5,
  centerY: 0.5,
};

export const DEFAULT_POLAR_COORDINATES: PolarCoordinatesSettings = {
  mode: 'rectangular-to-polar',
};

function bilinearSample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const fx = x - x0;
  const fy = y - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const result: [number, number, number, number] = [0, 0, 0, 0];

  for (let c = 0; c < 4; c++) {
    const v00 = data[idx00 + c];
    const v10 = data[idx10 + c];
    const v01 = data[idx01 + c];
    const v11 = data[idx11 + c];

    result[c] = (1 - fx) * (1 - fy) * v00 +
                fx * (1 - fy) * v10 +
                (1 - fx) * fy * v01 +
                fx * fy * v11;
  }

  return result;
}

export function applySpherize(imageData: ImageData, settings: SpherizeSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const centerX = width * settings.centerX;
  const centerY = height * settings.centerY;
  const radius = Math.min(width, height) / 2;
  const amount = settings.amount / 100;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = (x - centerX) / radius;
      let dy = (y - centerY) / radius;

      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) {
        const sphereDist = Math.sqrt(1 - dist * dist);
        const factor = (1 - sphereDist) * amount + (1 - amount);

        if (settings.mode === 'normal' || settings.mode === 'horizontal') {
          dx *= factor;
        }
        if (settings.mode === 'normal' || settings.mode === 'vertical') {
          dy *= factor;
        }
      }

      const sx = centerX + dx * radius;
      const sy = centerY + dy * radius;

      const idx = (y * width + x) * 4;

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        resultData[idx] = 0;
        resultData[idx + 1] = 0;
        resultData[idx + 2] = 0;
        resultData[idx + 3] = 0;
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyPinch(imageData: ImageData, settings: PinchSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const centerX = width * settings.centerX;
  const centerY = height * settings.centerY;
  const radius = Math.min(width, height) * settings.radius;
  const amount = settings.amount / 100;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let sx = x, sy = y;

      if (dist < radius) {
        const normalizedDist = dist / radius;
        const pinchFactor = Math.pow(Math.sin(normalizedDist * Math.PI / 2), -amount);

        sx = centerX + dx * pinchFactor;
        sy = centerY + dy * pinchFactor;
      }

      const idx = (y * width + x) * 4;

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        resultData[idx] = 0;
        resultData[idx + 1] = 0;
        resultData[idx + 2] = 0;
        resultData[idx + 3] = 0;
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyTwirl(imageData: ImageData, settings: TwirlSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const centerX = width * settings.centerX;
  const centerY = height * settings.centerY;
  const radius = Math.min(width, height) * settings.radius;
  const angleRad = (settings.angle * Math.PI) / 180;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let sx = x, sy = y;

      if (dist < radius) {
        const angle = Math.atan2(dy, dx);
        const normalizedDist = dist / radius;
        const twirlAngle = angle + angleRad * (1 - normalizedDist);

        sx = centerX + Math.cos(twirlAngle) * dist;
        sy = centerY + Math.sin(twirlAngle) * dist;
      }

      const idx = (y * width + x) * 4;

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        resultData[idx] = 0;
        resultData[idx + 1] = 0;
        resultData[idx + 2] = 0;
        resultData[idx + 3] = 0;
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyWave(imageData: ImageData, settings: WaveSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const generators: Array<{
    wavelength: number;
    amplitude: number;
    phase: number;
  }> = [];

  for (let i = 0; i < settings.generators; i++) {
    const t = settings.generators > 1 ? i / (settings.generators - 1) : 0;
    generators.push({
      wavelength: settings.wavelengthMin + (settings.wavelengthMax - settings.wavelengthMin) * t,
      amplitude: settings.amplitudeMin + (settings.amplitudeMax - settings.amplitudeMin) * t,
      phase: Math.random() * Math.PI * 2,
    });
  }

  const waveFunc = (value: number): number => {
    switch (settings.type) {
      case 'triangle':
        return 2 * Math.abs(2 * (value / (Math.PI * 2) - Math.floor(value / (Math.PI * 2) + 0.5))) - 1;
      case 'square':
        return Math.sin(value) >= 0 ? 1 : -1;
      case 'sine':
      default:
        return Math.sin(value);
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let offsetX = 0;
      let offsetY = 0;

      for (const gen of generators) {
        offsetX += waveFunc(y / gen.wavelength * Math.PI * 2 + gen.phase) * gen.amplitude;
        offsetY += waveFunc(x / gen.wavelength * Math.PI * 2 + gen.phase) * gen.amplitude;
      }

      offsetX *= settings.scaleX / 100;
      offsetY *= settings.scaleY / 100;

      let sx = x + offsetX;
      let sy = y + offsetY;

      if (settings.wrapAround) {
        sx = ((sx % width) + width) % width;
        sy = ((sy % height) + height) % height;
      }

      const idx = (y * width + x) * 4;

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        resultData[idx] = 0;
        resultData[idx + 1] = 0;
        resultData[idx + 2] = 0;
        resultData[idx + 3] = 0;
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyRipple(imageData: ImageData, settings: RippleSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const sizeMap = { small: 10, medium: 25, large: 50 };
  const wavelength = sizeMap[settings.size];
  const amplitude = settings.amount / 100 * 10;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offsetX = Math.sin(y / wavelength * Math.PI * 2) * amplitude;
      const offsetY = Math.sin(x / wavelength * Math.PI * 2) * amplitude;

      const sx = Math.min(Math.max(x + offsetX, 0), width - 1);
      const sy = Math.min(Math.max(y + offsetY, 0), height - 1);

      const idx = (y * width + x) * 4;
      const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
      resultData[idx] = r;
      resultData[idx + 1] = g;
      resultData[idx + 2] = b;
      resultData[idx + 3] = a;
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyZigZag(imageData: ImageData, settings: ZigZagSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const centerX = width * settings.centerX;
  const centerY = height * settings.centerY;
  const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
  const amount = settings.amount / 100 * 20;
  const ridges = settings.ridges;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      let offset = 0;

      switch (settings.style) {
        case 'around-center':
          offset = Math.sin(angle * ridges) * amount * (dist / maxRadius);
          break;
        case 'out-from-center':
          offset = Math.sin(dist / maxRadius * ridges * Math.PI) * amount;
          break;
        case 'pond-ripples':
          offset = Math.sin(dist / maxRadius * ridges * Math.PI * 2) * amount * (1 - dist / maxRadius);
          break;
      }

      const sx = centerX + (dx + Math.cos(angle) * offset);
      const sy = centerY + (dy + Math.sin(angle) * offset);

      const idx = (y * width + x) * 4;

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        resultData[idx] = 0;
        resultData[idx + 1] = 0;
        resultData[idx + 2] = 0;
        resultData[idx + 3] = 0;
      }
    }
  }

  return new ImageData(resultData, width, height);
}

export function applyPolarCoordinates(imageData: ImageData, settings: PolarCoordinatesSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx: number, sy: number;

      if (settings.mode === 'rectangular-to-polar') {
        const normalizedX = x / width;
        const normalizedY = y / height;

        const angle = normalizedX * Math.PI * 2;
        const radius = normalizedY * maxRadius;

        sx = centerX + Math.cos(angle) * radius;
        sy = centerY + Math.sin(angle) * radius;
      } else {
        const dx = x - centerX;
        const dy = y - centerY;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        sx = ((angle + Math.PI) / (Math.PI * 2)) * width;
        sy = (radius / maxRadius) * height;
      }

      const idx = (y * width + x) * 4;

      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const [r, g, b, a] = bilinearSample(data, width, height, sx, sy);
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = a;
      } else {
        resultData[idx] = 0;
        resultData[idx + 1] = 0;
        resultData[idx + 2] = 0;
        resultData[idx + 3] = 0;
      }
    }
  }

  return new ImageData(resultData, width, height);
}
