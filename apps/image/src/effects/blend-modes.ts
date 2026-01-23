export type BlendMode =
  | 'normal'
  | 'dissolve'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface BlendModeInfo {
  name: string;
  category: 'normal' | 'darken' | 'lighten' | 'contrast' | 'comparative' | 'component';
  description: string;
}

export const BLEND_MODE_INFO: Record<BlendMode, BlendModeInfo> = {
  normal: { name: 'Normal', category: 'normal', description: 'Edits or paints each pixel to make it the result color' },
  dissolve: { name: 'Dissolve', category: 'normal', description: 'Randomly replaces pixels with the blend color' },
  darken: { name: 'Darken', category: 'darken', description: 'Selects the darker of the base or blend color' },
  multiply: { name: 'Multiply', category: 'darken', description: 'Multiplies the base color by the blend color' },
  'color-burn': { name: 'Color Burn', category: 'darken', description: 'Darkens to increase the contrast' },
  'linear-burn': { name: 'Linear Burn', category: 'darken', description: 'Darkens by decreasing the brightness' },
  'darker-color': { name: 'Darker Color', category: 'darken', description: 'Compares total channel values' },
  lighten: { name: 'Lighten', category: 'lighten', description: 'Selects the lighter of the base or blend color' },
  screen: { name: 'Screen', category: 'lighten', description: 'Multiplies the inverse of the colors' },
  'color-dodge': { name: 'Color Dodge', category: 'lighten', description: 'Brightens to decrease the contrast' },
  'linear-dodge': { name: 'Linear Dodge (Add)', category: 'lighten', description: 'Brightens by increasing the brightness' },
  'lighter-color': { name: 'Lighter Color', category: 'lighten', description: 'Compares total channel values' },
  overlay: { name: 'Overlay', category: 'contrast', description: 'Multiplies or screens depending on the base color' },
  'soft-light': { name: 'Soft Light', category: 'contrast', description: 'Darkens or lightens depending on the blend color' },
  'hard-light': { name: 'Hard Light', category: 'contrast', description: 'Multiplies or screens depending on the blend color' },
  'vivid-light': { name: 'Vivid Light', category: 'contrast', description: 'Burns or dodges by increasing or decreasing the contrast' },
  'linear-light': { name: 'Linear Light', category: 'contrast', description: 'Burns or dodges by decreasing or increasing the brightness' },
  'pin-light': { name: 'Pin Light', category: 'contrast', description: 'Replaces colors depending on the blend color' },
  'hard-mix': { name: 'Hard Mix', category: 'contrast', description: 'Reduces colors to 8 colors' },
  difference: { name: 'Difference', category: 'comparative', description: 'Subtracts the darker color from the lighter color' },
  exclusion: { name: 'Exclusion', category: 'comparative', description: 'Similar to Difference but lower contrast' },
  subtract: { name: 'Subtract', category: 'comparative', description: 'Subtracts the blend color from the base color' },
  divide: { name: 'Divide', category: 'comparative', description: 'Divides the base color by the blend color' },
  hue: { name: 'Hue', category: 'component', description: 'Creates a result with the hue of the blend color' },
  saturation: { name: 'Saturation', category: 'component', description: 'Creates a result with the saturation of the blend color' },
  color: { name: 'Color', category: 'component', description: 'Creates a result with the hue and saturation of the blend color' },
  luminosity: { name: 'Luminosity', category: 'component', description: 'Creates a result with the luminosity of the blend color' },
};

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function blendNormal(_base: number, blend: number): number {
  return blend;
}

function blendDissolve(base: number, blend: number, opacity: number): number {
  return Math.random() < opacity ? blend : base;
}

function blendDarken(base: number, blend: number): number {
  return Math.min(base, blend);
}

function blendMultiply(base: number, blend: number): number {
  return (base * blend) / 255;
}

function blendColorBurn(base: number, blend: number): number {
  if (blend === 0) return 0;
  return clamp(255 - ((255 - base) * 255) / blend);
}

function blendLinearBurn(base: number, blend: number): number {
  return clamp(base + blend - 255);
}

function blendLighten(base: number, blend: number): number {
  return Math.max(base, blend);
}

function blendScreen(base: number, blend: number): number {
  return 255 - ((255 - base) * (255 - blend)) / 255;
}

function blendColorDodge(base: number, blend: number): number {
  if (blend === 255) return 255;
  return clamp((base * 255) / (255 - blend));
}

function blendLinearDodge(base: number, blend: number): number {
  return clamp(base + blend);
}

function blendOverlay(base: number, blend: number): number {
  if (base < 128) {
    return (2 * base * blend) / 255;
  }
  return 255 - (2 * (255 - base) * (255 - blend)) / 255;
}

function blendSoftLight(base: number, blend: number): number {
  if (blend < 128) {
    return base - ((255 - 2 * blend) * base * (255 - base)) / (255 * 255);
  }
  const d = base < 64 ? ((16 * base - 12 * 255) * base + 4 * 255) * base / (255 * 255) : Math.sqrt(base / 255) * 255;
  return base + ((2 * blend - 255) * (d - base)) / 255;
}

function blendHardLight(base: number, blend: number): number {
  if (blend < 128) {
    return (2 * base * blend) / 255;
  }
  return 255 - (2 * (255 - base) * (255 - blend)) / 255;
}

function blendVividLight(base: number, blend: number): number {
  if (blend < 128) {
    return blendColorBurn(base, 2 * blend);
  }
  return blendColorDodge(base, 2 * (blend - 128));
}

function blendLinearLight(base: number, blend: number): number {
  if (blend < 128) {
    return blendLinearBurn(base, 2 * blend);
  }
  return blendLinearDodge(base, 2 * (blend - 128));
}

function blendPinLight(base: number, blend: number): number {
  if (blend < 128) {
    return Math.min(base, 2 * blend);
  }
  return Math.max(base, 2 * (blend - 128));
}

function blendHardMix(base: number, blend: number): number {
  return blendVividLight(base, blend) < 128 ? 0 : 255;
}

function blendDifference(base: number, blend: number): number {
  return Math.abs(base - blend);
}

function blendExclusion(base: number, blend: number): number {
  return base + blend - (2 * base * blend) / 255;
}

function blendSubtract(base: number, blend: number): number {
  return clamp(base - blend);
}

function blendDivide(base: number, blend: number): number {
  if (blend === 0) return 255;
  return clamp((base * 256) / (blend + 1));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
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

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
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

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function blendHue(
  baseR: number, baseG: number, baseB: number,
  blendR: number, blendG: number, blendB: number
): [number, number, number] {
  const [h] = rgbToHsl(blendR, blendG, blendB);
  const [, s, l] = rgbToHsl(baseR, baseG, baseB);
  return hslToRgb(h, s, l);
}

function blendSaturation(
  baseR: number, baseG: number, baseB: number,
  blendR: number, blendG: number, blendB: number
): [number, number, number] {
  const [h, , l] = rgbToHsl(baseR, baseG, baseB);
  const [, s] = rgbToHsl(blendR, blendG, blendB);
  return hslToRgb(h, s, l);
}

function blendColor(
  baseR: number, baseG: number, baseB: number,
  blendR: number, blendG: number, blendB: number
): [number, number, number] {
  const [h, s] = rgbToHsl(blendR, blendG, blendB);
  const [, , l] = rgbToHsl(baseR, baseG, baseB);
  return hslToRgb(h, s, l);
}

function blendLuminosity(
  baseR: number, baseG: number, baseB: number,
  blendR: number, blendG: number, blendB: number
): [number, number, number] {
  const [h, s] = rgbToHsl(baseR, baseG, baseB);
  const [, , l] = rgbToHsl(blendR, blendG, blendB);
  return hslToRgb(h, s, l);
}

function getLuminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function blendDarkerColor(
  baseR: number, baseG: number, baseB: number,
  blendR: number, blendG: number, blendB: number
): [number, number, number] {
  const baseLum = getLuminance(baseR, baseG, baseB);
  const blendLum = getLuminance(blendR, blendG, blendB);
  return baseLum < blendLum ? [baseR, baseG, baseB] : [blendR, blendG, blendB];
}

function blendLighterColor(
  baseR: number, baseG: number, baseB: number,
  blendR: number, blendG: number, blendB: number
): [number, number, number] {
  const baseLum = getLuminance(baseR, baseG, baseB);
  const blendLum = getLuminance(blendR, blendG, blendB);
  return baseLum > blendLum ? [baseR, baseG, baseB] : [blendR, blendG, blendB];
}

export function blendPixel(
  baseR: number, baseG: number, baseB: number, baseA: number,
  blendR: number, blendG: number, blendB: number, blendA: number,
  mode: BlendMode,
  opacity: number = 1
): [number, number, number, number] {
  if (blendA === 0 || opacity === 0) {
    return [baseR, baseG, baseB, baseA];
  }

  const effectiveOpacity = (blendA / 255) * opacity;
  let resultR: number, resultG: number, resultB: number;

  switch (mode) {
    case 'normal':
      resultR = blendNormal(baseR, blendR);
      resultG = blendNormal(baseG, blendG);
      resultB = blendNormal(baseB, blendB);
      break;

    case 'dissolve':
      resultR = blendDissolve(baseR, blendR, effectiveOpacity);
      resultG = blendDissolve(baseG, blendG, effectiveOpacity);
      resultB = blendDissolve(baseB, blendB, effectiveOpacity);
      return [resultR, resultG, resultB, baseA];

    case 'darken':
      resultR = blendDarken(baseR, blendR);
      resultG = blendDarken(baseG, blendG);
      resultB = blendDarken(baseB, blendB);
      break;

    case 'multiply':
      resultR = blendMultiply(baseR, blendR);
      resultG = blendMultiply(baseG, blendG);
      resultB = blendMultiply(baseB, blendB);
      break;

    case 'color-burn':
      resultR = blendColorBurn(baseR, blendR);
      resultG = blendColorBurn(baseG, blendG);
      resultB = blendColorBurn(baseB, blendB);
      break;

    case 'linear-burn':
      resultR = blendLinearBurn(baseR, blendR);
      resultG = blendLinearBurn(baseG, blendG);
      resultB = blendLinearBurn(baseB, blendB);
      break;

    case 'darker-color':
      [resultR, resultG, resultB] = blendDarkerColor(baseR, baseG, baseB, blendR, blendG, blendB);
      break;

    case 'lighten':
      resultR = blendLighten(baseR, blendR);
      resultG = blendLighten(baseG, blendG);
      resultB = blendLighten(baseB, blendB);
      break;

    case 'screen':
      resultR = blendScreen(baseR, blendR);
      resultG = blendScreen(baseG, blendG);
      resultB = blendScreen(baseB, blendB);
      break;

    case 'color-dodge':
      resultR = blendColorDodge(baseR, blendR);
      resultG = blendColorDodge(baseG, blendG);
      resultB = blendColorDodge(baseB, blendB);
      break;

    case 'linear-dodge':
      resultR = blendLinearDodge(baseR, blendR);
      resultG = blendLinearDodge(baseG, blendG);
      resultB = blendLinearDodge(baseB, blendB);
      break;

    case 'lighter-color':
      [resultR, resultG, resultB] = blendLighterColor(baseR, baseG, baseB, blendR, blendG, blendB);
      break;

    case 'overlay':
      resultR = blendOverlay(baseR, blendR);
      resultG = blendOverlay(baseG, blendG);
      resultB = blendOverlay(baseB, blendB);
      break;

    case 'soft-light':
      resultR = blendSoftLight(baseR, blendR);
      resultG = blendSoftLight(baseG, blendG);
      resultB = blendSoftLight(baseB, blendB);
      break;

    case 'hard-light':
      resultR = blendHardLight(baseR, blendR);
      resultG = blendHardLight(baseG, blendG);
      resultB = blendHardLight(baseB, blendB);
      break;

    case 'vivid-light':
      resultR = blendVividLight(baseR, blendR);
      resultG = blendVividLight(baseG, blendG);
      resultB = blendVividLight(baseB, blendB);
      break;

    case 'linear-light':
      resultR = blendLinearLight(baseR, blendR);
      resultG = blendLinearLight(baseG, blendG);
      resultB = blendLinearLight(baseB, blendB);
      break;

    case 'pin-light':
      resultR = blendPinLight(baseR, blendR);
      resultG = blendPinLight(baseG, blendG);
      resultB = blendPinLight(baseB, blendB);
      break;

    case 'hard-mix':
      resultR = blendHardMix(baseR, blendR);
      resultG = blendHardMix(baseG, blendG);
      resultB = blendHardMix(baseB, blendB);
      break;

    case 'difference':
      resultR = blendDifference(baseR, blendR);
      resultG = blendDifference(baseG, blendG);
      resultB = blendDifference(baseB, blendB);
      break;

    case 'exclusion':
      resultR = blendExclusion(baseR, blendR);
      resultG = blendExclusion(baseG, blendG);
      resultB = blendExclusion(baseB, blendB);
      break;

    case 'subtract':
      resultR = blendSubtract(baseR, blendR);
      resultG = blendSubtract(baseG, blendG);
      resultB = blendSubtract(baseB, blendB);
      break;

    case 'divide':
      resultR = blendDivide(baseR, blendR);
      resultG = blendDivide(baseG, blendG);
      resultB = blendDivide(baseB, blendB);
      break;

    case 'hue':
      [resultR, resultG, resultB] = blendHue(baseR, baseG, baseB, blendR, blendG, blendB);
      break;

    case 'saturation':
      [resultR, resultG, resultB] = blendSaturation(baseR, baseG, baseB, blendR, blendG, blendB);
      break;

    case 'color':
      [resultR, resultG, resultB] = blendColor(baseR, baseG, baseB, blendR, blendG, blendB);
      break;

    case 'luminosity':
      [resultR, resultG, resultB] = blendLuminosity(baseR, baseG, baseB, blendR, blendG, blendB);
      break;

    default:
      resultR = blendR;
      resultG = blendG;
      resultB = blendB;
  }

  const finalR = clamp(baseR + (resultR - baseR) * effectiveOpacity);
  const finalG = clamp(baseG + (resultG - baseG) * effectiveOpacity);
  const finalB = clamp(baseB + (resultB - baseB) * effectiveOpacity);
  const finalA = Math.max(baseA, Math.round(blendA * opacity));

  return [finalR, finalG, finalB, finalA];
}

export function blendImageData(
  base: ImageData,
  blend: ImageData,
  mode: BlendMode,
  opacity: number = 1
): ImageData {
  if (base.width !== blend.width || base.height !== blend.height) {
    throw new Error('ImageData dimensions must match');
  }

  const result = new ImageData(base.width, base.height);
  const baseData = base.data;
  const blendData = blend.data;
  const resultData = result.data;

  for (let i = 0; i < baseData.length; i += 4) {
    const [r, g, b, a] = blendPixel(
      baseData[i], baseData[i + 1], baseData[i + 2], baseData[i + 3],
      blendData[i], blendData[i + 1], blendData[i + 2], blendData[i + 3],
      mode,
      opacity
    );
    resultData[i] = r;
    resultData[i + 1] = g;
    resultData[i + 2] = b;
    resultData[i + 3] = a;
  }

  return result;
}

export function getCompositeOperation(mode: BlendMode): GlobalCompositeOperation | null {
  const modeMap: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    difference: 'difference',
    exclusion: 'exclusion',
    hue: 'hue',
    saturation: 'saturation',
    color: 'color',
    luminosity: 'luminosity',
  };
  return modeMap[mode] ?? null;
}

export function requiresManualBlending(mode: BlendMode): boolean {
  return getCompositeOperation(mode) === null;
}

export const BLEND_MODE_GROUPS = {
  normal: ['normal', 'dissolve'] as BlendMode[],
  darken: ['darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color'] as BlendMode[],
  lighten: ['lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color'] as BlendMode[],
  contrast: ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'] as BlendMode[],
  comparative: ['difference', 'exclusion', 'subtract', 'divide'] as BlendMode[],
  component: ['hue', 'saturation', 'color', 'luminosity'] as BlendMode[],
};
