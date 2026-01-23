export interface BlackWhiteSettings {
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  tint: {
    enabled: boolean;
    hue: number;
    saturation: number;
  };
}

export const DEFAULT_BLACK_WHITE: BlackWhiteSettings = {
  reds: 40,
  yellows: 60,
  greens: 40,
  cyans: 60,
  blues: 20,
  magentas: 80,
  tint: {
    enabled: false,
    hue: 30,
    saturation: 25,
  },
};

export const BLACK_WHITE_PRESETS = {
  default: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 },
  highContrast: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 },
  infrared: { reds: -70, yellows: 200, greens: -70, cyans: 200, blues: -20, magentas: -20 },
  maximumWhite: { reds: 100, yellows: 100, greens: 100, cyans: 100, blues: 100, magentas: 100 },
  maximumBlack: { reds: -200, yellows: -200, greens: -200, cyans: -200, blues: -200, magentas: -200 },
  neutral: { reds: 33, yellows: 33, greens: 33, cyans: 33, blues: 33, magentas: 33 },
  redFilter: { reds: 106, yellows: 52, greens: -10, cyans: -40, blues: -30, magentas: 94 },
  yellowFilter: { reds: 34, yellows: 106, greens: 54, cyans: -26, blues: -50, magentas: 14 },
  greenFilter: { reds: -44, yellows: 64, greens: 106, cyans: 60, blues: -30, magentas: -70 },
  blueFilter: { reds: -30, yellows: -46, greens: -16, cyans: 30, blues: 106, magentas: 30 },
};

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function getColorWeight(hue: number, targetHue: number, spread: number = 60): number {
  let diff = Math.abs(hue - targetHue);
  if (diff > 180) diff = 360 - diff;
  if (diff >= spread) return 0;
  return 1 - diff / spread;
}

export function applyBlackWhite(imageData: ImageData, settings: BlackWhiteSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const { h, s } = rgbToHsl(r, g, b);
    const hue = h * 360;

    let gray = (r + g + b) / 3;

    if (s > 0.05) {
      const redWeight = getColorWeight(hue, 0) + getColorWeight(hue, 360);
      const yellowWeight = getColorWeight(hue, 60);
      const greenWeight = getColorWeight(hue, 120);
      const cyanWeight = getColorWeight(hue, 180);
      const blueWeight = getColorWeight(hue, 240);
      const magentaWeight = getColorWeight(hue, 300);

      const totalWeight = redWeight + yellowWeight + greenWeight + cyanWeight + blueWeight + magentaWeight;

      if (totalWeight > 0) {
        const adjustment =
          (redWeight * settings.reds +
            yellowWeight * settings.yellows +
            greenWeight * settings.greens +
            cyanWeight * settings.cyans +
            blueWeight * settings.blues +
            magentaWeight * settings.magentas) / totalWeight;

        gray = gray * (1 + (adjustment - 50) / 100 * s);
      }
    }

    gray = Math.max(0, Math.min(255, gray));

    let finalR = gray;
    let finalG = gray;
    let finalB = gray;

    if (settings.tint.enabled) {
      const tintH = settings.tint.hue / 360;
      const tintS = settings.tint.saturation / 100;
      const tintL = gray / 255;

      const tinted = hslToRgb(tintH, tintS, tintL);
      finalR = tinted.r;
      finalG = tinted.g;
      finalB = tinted.b;
    }

    resultData[i] = finalR;
    resultData[i + 1] = finalG;
    resultData[i + 2] = finalB;
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}
