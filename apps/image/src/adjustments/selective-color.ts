export type SelectiveColorRange =
  | 'reds'
  | 'yellows'
  | 'greens'
  | 'cyans'
  | 'blues'
  | 'magentas'
  | 'whites'
  | 'neutrals'
  | 'blacks';

export interface SelectiveColorAdjustment {
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
}

export interface SelectiveColorSettings {
  reds: SelectiveColorAdjustment;
  yellows: SelectiveColorAdjustment;
  greens: SelectiveColorAdjustment;
  cyans: SelectiveColorAdjustment;
  blues: SelectiveColorAdjustment;
  magentas: SelectiveColorAdjustment;
  whites: SelectiveColorAdjustment;
  neutrals: SelectiveColorAdjustment;
  blacks: SelectiveColorAdjustment;
  method: 'relative' | 'absolute';
}

const DEFAULT_ADJUSTMENT: SelectiveColorAdjustment = {
  cyan: 0,
  magenta: 0,
  yellow: 0,
  black: 0,
};

export const DEFAULT_SELECTIVE_COLOR: SelectiveColorSettings = {
  reds: { ...DEFAULT_ADJUSTMENT },
  yellows: { ...DEFAULT_ADJUSTMENT },
  greens: { ...DEFAULT_ADJUSTMENT },
  cyans: { ...DEFAULT_ADJUSTMENT },
  blues: { ...DEFAULT_ADJUSTMENT },
  magentas: { ...DEFAULT_ADJUSTMENT },
  whites: { ...DEFAULT_ADJUSTMENT },
  neutrals: { ...DEFAULT_ADJUSTMENT },
  blacks: { ...DEFAULT_ADJUSTMENT },
  method: 'relative',
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

function getColorRangeWeight(r: number, g: number, b: number, range: SelectiveColorRange): number {
  const { h, s, l } = rgbToHsl(r, g, b);
  const hue = h * 360;

  switch (range) {
    case 'reds':
      if (s < 0.1) return 0;
      if ((hue >= 345 || hue <= 15)) return s;
      if (hue > 15 && hue <= 45) return s * (1 - (hue - 15) / 30);
      if (hue >= 315 && hue < 345) return s * ((hue - 315) / 30);
      return 0;

    case 'yellows':
      if (s < 0.1) return 0;
      if (hue >= 45 && hue <= 75) return s;
      if (hue > 15 && hue < 45) return s * ((hue - 15) / 30);
      if (hue > 75 && hue <= 105) return s * (1 - (hue - 75) / 30);
      return 0;

    case 'greens':
      if (s < 0.1) return 0;
      if (hue >= 105 && hue <= 135) return s;
      if (hue > 75 && hue < 105) return s * ((hue - 75) / 30);
      if (hue > 135 && hue <= 165) return s * (1 - (hue - 135) / 30);
      return 0;

    case 'cyans':
      if (s < 0.1) return 0;
      if (hue >= 165 && hue <= 195) return s;
      if (hue > 135 && hue < 165) return s * ((hue - 135) / 30);
      if (hue > 195 && hue <= 225) return s * (1 - (hue - 195) / 30);
      return 0;

    case 'blues':
      if (s < 0.1) return 0;
      if (hue >= 225 && hue <= 255) return s;
      if (hue > 195 && hue < 225) return s * ((hue - 195) / 30);
      if (hue > 255 && hue <= 285) return s * (1 - (hue - 255) / 30);
      return 0;

    case 'magentas':
      if (s < 0.1) return 0;
      if (hue >= 285 && hue <= 315) return s;
      if (hue > 255 && hue < 285) return s * ((hue - 255) / 30);
      if (hue > 315 && hue <= 345) return s * (1 - (hue - 315) / 30);
      return 0;

    case 'whites':
      if (l >= 0.8) return (l - 0.8) / 0.2;
      return 0;

    case 'blacks':
      if (l <= 0.2) return (0.2 - l) / 0.2;
      return 0;

    case 'neutrals':
      if (s < 0.2 && l > 0.2 && l < 0.8) {
        return (0.2 - s) / 0.2 * Math.min((l - 0.2) / 0.3, (0.8 - l) / 0.3, 1);
      }
      return 0;
  }
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const k = 1 - Math.max(r, g, b);
  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 1 };
  }

  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);

  return { c, m, y, k };
}

function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);

  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

export function applySelectiveColor(imageData: ImageData, settings: SelectiveColorSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const ranges: SelectiveColorRange[] = [
    'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'
  ];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    let { c, m, y, k } = rgbToCmyk(r, g, b);

    for (const range of ranges) {
      const weight = getColorRangeWeight(r, g, b, range);
      if (weight <= 0) continue;

      const adj = settings[range];

      if (settings.method === 'relative') {
        c = c + (adj.cyan / 100) * c * weight;
        m = m + (adj.magenta / 100) * m * weight;
        y = y + (adj.yellow / 100) * y * weight;
        k = k + (adj.black / 100) * k * weight;
      } else {
        c = c + (adj.cyan / 100) * weight;
        m = m + (adj.magenta / 100) * weight;
        y = y + (adj.yellow / 100) * weight;
        k = k + (adj.black / 100) * weight;
      }
    }

    c = Math.max(0, Math.min(1, c));
    m = Math.max(0, Math.min(1, m));
    y = Math.max(0, Math.min(1, y));
    k = Math.max(0, Math.min(1, k));

    const rgb = cmykToRgb(c, m, y, k);

    resultData[i] = rgb.r;
    resultData[i + 1] = rgb.g;
    resultData[i + 2] = rgb.b;
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}
