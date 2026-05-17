export interface LevelsChannel {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

export interface LevelsAdjustment {
  enabled: boolean;
  master: LevelsChannel;
  red: LevelsChannel;
  green: LevelsChannel;
  blue: LevelsChannel;
}

export interface CurvePoint {
  input: number;
  output: number;
}

export interface CurvesChannel {
  points: CurvePoint[];
}

export interface CurvesAdjustment {
  enabled: boolean;
  master: CurvesChannel;
  red: CurvesChannel;
  green: CurvesChannel;
  blue: CurvesChannel;
}

export interface ColorBalanceValues {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
}

export interface ColorBalanceAdjustment {
  enabled: boolean;
  shadows: ColorBalanceValues;
  midtones: ColorBalanceValues;
  highlights: ColorBalanceValues;
  preserveLuminosity: boolean;
}

export interface SelectiveColorValues {
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
}

export type SelectiveColorTarget =
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
  enabled: boolean;
  method: 'relative' | 'absolute';
  reds: SelectiveColorValues;
  yellows: SelectiveColorValues;
  greens: SelectiveColorValues;
  cyans: SelectiveColorValues;
  blues: SelectiveColorValues;
  magentas: SelectiveColorValues;
  whites: SelectiveColorValues;
  neutrals: SelectiveColorValues;
  blacks: SelectiveColorValues;
}

export interface BlackWhiteAdjustment {
  enabled: boolean;
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  tintEnabled: boolean;
  tintHue: number;
  tintSaturation: number;
}

export interface GradientMapStop {
  position: number;
  color: string;
}

export interface GradientMapAdjustment {
  enabled: boolean;
  stops: GradientMapStop[];
  reverse: boolean;
  dither: boolean;
}

export interface PosterizeAdjustment {
  enabled: boolean;
  levels: number;
}

export interface ThresholdAdjustment {
  enabled: boolean;
  level: number;
}

export interface PhotoFilterAdjustment {
  enabled: boolean;
  filter: 'warming-85' | 'warming-81' | 'cooling-80' | 'cooling-82' | 'custom';
  color: string;
  density: number;
  preserveLuminosity: boolean;
}

export interface ChannelMixerChannel {
  red: number;
  green: number;
  blue: number;
  constant: number;
}

export interface ChannelMixerAdjustment {
  enabled: boolean;
  monochrome: boolean;
  red: ChannelMixerChannel;
  green: ChannelMixerChannel;
  blue: ChannelMixerChannel;
}

export const DEFAULT_LEVELS_CHANNEL: LevelsChannel = {
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1.0,
  outputBlack: 0,
  outputWhite: 255,
};

export const DEFAULT_LEVELS: LevelsAdjustment = {
  enabled: false,
  master: { ...DEFAULT_LEVELS_CHANNEL },
  red: { ...DEFAULT_LEVELS_CHANNEL },
  green: { ...DEFAULT_LEVELS_CHANNEL },
  blue: { ...DEFAULT_LEVELS_CHANNEL },
};

export const DEFAULT_CURVES_CHANNEL: CurvesChannel = {
  points: [
    { input: 0, output: 0 },
    { input: 255, output: 255 },
  ],
};

export const DEFAULT_CURVES: CurvesAdjustment = {
  enabled: false,
  master: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
  red: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
  green: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
  blue: { points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
};

export const DEFAULT_COLOR_BALANCE_VALUES: ColorBalanceValues = {
  cyanRed: 0,
  magentaGreen: 0,
  yellowBlue: 0,
};

export const DEFAULT_COLOR_BALANCE: ColorBalanceAdjustment = {
  enabled: false,
  shadows: { ...DEFAULT_COLOR_BALANCE_VALUES },
  midtones: { ...DEFAULT_COLOR_BALANCE_VALUES },
  highlights: { ...DEFAULT_COLOR_BALANCE_VALUES },
  preserveLuminosity: true,
};

export const DEFAULT_SELECTIVE_COLOR_VALUES: SelectiveColorValues = {
  cyan: 0,
  magenta: 0,
  yellow: 0,
  black: 0,
};

export const DEFAULT_SELECTIVE_COLOR: SelectiveColorAdjustment = {
  enabled: false,
  method: 'relative',
  reds: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  yellows: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  greens: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  cyans: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  blues: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  magentas: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  whites: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  neutrals: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
  blacks: { ...DEFAULT_SELECTIVE_COLOR_VALUES },
};

export const DEFAULT_BLACK_WHITE: BlackWhiteAdjustment = {
  enabled: false,
  reds: 40,
  yellows: 60,
  greens: 40,
  cyans: 60,
  blues: 20,
  magentas: 80,
  tintEnabled: false,
  tintHue: 35,
  tintSaturation: 25,
};

export const DEFAULT_GRADIENT_MAP: GradientMapAdjustment = {
  enabled: false,
  stops: [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ],
  reverse: false,
  dither: false,
};

export const DEFAULT_POSTERIZE: PosterizeAdjustment = {
  enabled: false,
  levels: 4,
};

export const DEFAULT_THRESHOLD: ThresholdAdjustment = {
  enabled: false,
  level: 128,
};

export const DEFAULT_PHOTO_FILTER: PhotoFilterAdjustment = {
  enabled: false,
  filter: 'warming-85',
  color: '#ec8a00',
  density: 25,
  preserveLuminosity: true,
};

export const DEFAULT_CHANNEL_MIXER: ChannelMixerAdjustment = {
  enabled: false,
  monochrome: false,
  red: { red: 100, green: 0, blue: 0, constant: 0 },
  green: { red: 0, green: 100, blue: 0, constant: 0 },
  blue: { red: 0, green: 0, blue: 100, constant: 0 },
};

export function applyLevels(value: number, channel: LevelsChannel): number {
  let v = value;

  v = Math.max(channel.inputBlack, Math.min(channel.inputWhite, v));
  v = ((v - channel.inputBlack) / (channel.inputWhite - channel.inputBlack)) * 255;

  v = 255 * Math.pow(v / 255, 1 / channel.gamma);

  v = channel.outputBlack + (v / 255) * (channel.outputWhite - channel.outputBlack);

  return Math.max(0, Math.min(255, Math.round(v)));
}

export function interpolateCurve(value: number, points: CurvePoint[]): number {
  if (points.length === 0) return value;
  if (points.length === 1) return points[0].output;

  const sortedPoints = [...points].sort((a, b) => a.input - b.input);

  if (value <= sortedPoints[0].input) return sortedPoints[0].output;
  if (value >= sortedPoints[sortedPoints.length - 1].input) {
    return sortedPoints[sortedPoints.length - 1].output;
  }

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i];
    const p2 = sortedPoints[i + 1];

    if (value >= p1.input && value <= p2.input) {
      const t = (value - p1.input) / (p2.input - p1.input);

      if (sortedPoints.length >= 4 && i > 0 && i < sortedPoints.length - 2) {
        const p0 = sortedPoints[i - 1];
        const p3 = sortedPoints[i + 2];
        return catmullRomInterpolate(p0.output, p1.output, p2.output, p3.output, t);
      }

      return p1.output + t * (p2.output - p1.output);
    }
  }

  return value;
}

function catmullRomInterpolate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function applyLevelsToImageData(
  imageData: ImageData,
  levels: LevelsAdjustment
): ImageData {
  if (!levels.enabled) return imageData;

  const result = new ImageData(imageData.width, imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    let r = imageData.data[i];
    let g = imageData.data[i + 1];
    let b = imageData.data[i + 2];

    r = applyLevels(r, levels.master);
    g = applyLevels(g, levels.master);
    b = applyLevels(b, levels.master);

    r = applyLevels(r, levels.red);
    g = applyLevels(g, levels.green);
    b = applyLevels(b, levels.blue);

    result.data[i] = r;
    result.data[i + 1] = g;
    result.data[i + 2] = b;
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

export function applyCurvesToImageData(
  imageData: ImageData,
  curves: CurvesAdjustment
): ImageData {
  if (!curves.enabled) return imageData;

  const result = new ImageData(imageData.width, imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    let r = imageData.data[i];
    let g = imageData.data[i + 1];
    let b = imageData.data[i + 2];

    r = interpolateCurve(r, curves.master.points);
    g = interpolateCurve(g, curves.master.points);
    b = interpolateCurve(b, curves.master.points);

    r = interpolateCurve(r, curves.red.points);
    g = interpolateCurve(g, curves.green.points);
    b = interpolateCurve(b, curves.blue.points);

    result.data[i] = Math.max(0, Math.min(255, Math.round(r)));
    result.data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    result.data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

export function applyColorBalanceToImageData(
  imageData: ImageData,
  colorBalance: ColorBalanceAdjustment
): ImageData {
  if (!colorBalance.enabled) return imageData;

  const result = new ImageData(imageData.width, imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    let r = imageData.data[i];
    let g = imageData.data[i + 1];
    let b = imageData.data[i + 2];

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    const shadowWeight = Math.max(0, 1 - luminance / 128);
    const highlightWeight = Math.max(0, (luminance - 128) / 127);
    const midtoneWeight = 1 - shadowWeight - highlightWeight;

    const adjustR =
      colorBalance.shadows.cyanRed * shadowWeight +
      colorBalance.midtones.cyanRed * midtoneWeight +
      colorBalance.highlights.cyanRed * highlightWeight;

    const adjustG =
      colorBalance.shadows.magentaGreen * shadowWeight +
      colorBalance.midtones.magentaGreen * midtoneWeight +
      colorBalance.highlights.magentaGreen * highlightWeight;

    const adjustB =
      colorBalance.shadows.yellowBlue * shadowWeight +
      colorBalance.midtones.yellowBlue * midtoneWeight +
      colorBalance.highlights.yellowBlue * highlightWeight;

    r = Math.max(0, Math.min(255, r + adjustR));
    g = Math.max(0, Math.min(255, g + adjustG));
    b = Math.max(0, Math.min(255, b + adjustB));

    if (colorBalance.preserveLuminosity) {
      const newLuminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (newLuminance > 0) {
        const factor = luminance / newLuminance;
        r = Math.max(0, Math.min(255, r * factor));
        g = Math.max(0, Math.min(255, g * factor));
        b = Math.max(0, Math.min(255, b * factor));
      }
    }

    result.data[i] = Math.round(r);
    result.data[i + 1] = Math.round(g);
    result.data[i + 2] = Math.round(b);
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

export function applyThresholdToImageData(
  imageData: ImageData,
  threshold: ThresholdAdjustment
): ImageData {
  if (!threshold.enabled) return imageData;

  const result = new ImageData(imageData.width, imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const value = luminance >= threshold.level ? 255 : 0;

    result.data[i] = value;
    result.data[i + 1] = value;
    result.data[i + 2] = value;
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

export function applyPosterizeToImageData(
  imageData: ImageData,
  posterize: PosterizeAdjustment
): ImageData {
  if (!posterize.enabled || posterize.levels < 2) return imageData;

  const result = new ImageData(imageData.width, imageData.height);
  const step = 255 / (posterize.levels - 1);

  for (let i = 0; i < imageData.data.length; i += 4) {
    result.data[i] = Math.round(Math.round(imageData.data[i] / step) * step);
    result.data[i + 1] = Math.round(Math.round(imageData.data[i + 1] / step) * step);
    result.data[i + 2] = Math.round(Math.round(imageData.data[i + 2] / step) * step);
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

export function applyBlackWhiteToImageData(
  imageData: ImageData,
  bw: BlackWhiteAdjustment
): ImageData {
  if (!bw.enabled) return imageData;

  const result = new ImageData(imageData.width, imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let hue = 0;
    if (delta > 0) {
      if (max === r) {
        hue = ((g - b) / delta) % 6;
      } else if (max === g) {
        hue = (b - r) / delta + 2;
      } else {
        hue = (r - g) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) hue += 360;
    }

    let weight = 0;
    if (hue < 30 || hue >= 330) {
      weight = bw.reds / 100;
    } else if (hue < 90) {
      weight = bw.yellows / 100;
    } else if (hue < 150) {
      weight = bw.greens / 100;
    } else if (hue < 210) {
      weight = bw.cyans / 100;
    } else if (hue < 270) {
      weight = bw.blues / 100;
    } else {
      weight = bw.magentas / 100;
    }

    let gray = 0.299 * r + 0.587 * g + 0.114 * b;
    gray = gray * (1 + weight * 0.5);
    gray = Math.max(0, Math.min(255, gray));

    let finalR = gray;
    let finalG = gray;
    let finalB = gray;

    if (bw.tintEnabled) {
      const tintH = bw.tintHue / 360;
      const tintS = bw.tintSaturation / 100;
      const tintL = gray / 255;

      const c = (1 - Math.abs(2 * tintL - 1)) * tintS;
      const x = c * (1 - Math.abs((tintH * 6) % 2 - 1));
      const m = tintL - c / 2;

      let rTint = 0, gTint = 0, bTint = 0;
      const h6 = tintH * 6;
      if (h6 < 1) { rTint = c; gTint = x; }
      else if (h6 < 2) { rTint = x; gTint = c; }
      else if (h6 < 3) { gTint = c; bTint = x; }
      else if (h6 < 4) { gTint = x; bTint = c; }
      else if (h6 < 5) { rTint = x; bTint = c; }
      else { rTint = c; bTint = x; }

      finalR = (rTint + m) * 255;
      finalG = (gTint + m) * 255;
      finalB = (bTint + m) * 255;
    }

    result.data[i] = Math.round(finalR);
    result.data[i + 1] = Math.round(finalG);
    result.data[i + 2] = Math.round(finalB);
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

export function applyGradientMapToImageData(
  imageData: ImageData,
  gradientMap: GradientMapAdjustment
): ImageData {
  if (!gradientMap.enabled || gradientMap.stops.length < 2) return imageData;

  const result = new ImageData(imageData.width, imageData.height);

  const stops = gradientMap.reverse
    ? [...gradientMap.stops].reverse().map((s, i, arr) => ({
        ...s,
        position: 1 - arr[arr.length - 1 - i].position,
      }))
    : gradientMap.stops;

  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    let color1 = sortedStops[0];
    let color2 = sortedStops[sortedStops.length - 1];

    for (let j = 0; j < sortedStops.length - 1; j++) {
      if (luminance >= sortedStops[j].position && luminance <= sortedStops[j + 1].position) {
        color1 = sortedStops[j];
        color2 = sortedStops[j + 1];
        break;
      }
    }

    const t = (luminance - color1.position) / (color2.position - color1.position || 1);

    const c1 = hexToRgb(color1.color);
    const c2 = hexToRgb(color2.color);

    result.data[i] = Math.round(c1.r + t * (c2.r - c1.r));
    result.data[i + 1] = Math.round(c1.g + t * (c2.g - c1.g));
    result.data[i + 2] = Math.round(c1.b + t * (c2.b - c1.b));
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}
