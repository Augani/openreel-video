export interface HSL {
  h: number;
  s: number;
  l: number;
}

export type HarmonyType = 'complementary' | 'analogous' | 'triadic' | 'split-complementary' | 'tetradic' | 'monochromatic';

export function hexToHSL(hex: string): HSL {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 0 };

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(hsl: HSL): string {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rotateHue(hsl: HSL, degrees: number): HSL {
  return { ...hsl, h: (hsl.h + degrees + 360) % 360 };
}

function adjustLightness(hsl: HSL, amount: number): HSL {
  return { ...hsl, l: Math.max(0, Math.min(100, hsl.l + amount)) };
}

export function getComplementary(hex: string): string[] {
  const hsl = hexToHSL(hex);
  return [hslToHex(rotateHue(hsl, 180))];
}

export function getAnalogous(hex: string): string[] {
  const hsl = hexToHSL(hex);
  return [
    hslToHex(rotateHue(hsl, -30)),
    hslToHex(rotateHue(hsl, 30)),
  ];
}

export function getTriadic(hex: string): string[] {
  const hsl = hexToHSL(hex);
  return [
    hslToHex(rotateHue(hsl, 120)),
    hslToHex(rotateHue(hsl, 240)),
  ];
}

export function getSplitComplementary(hex: string): string[] {
  const hsl = hexToHSL(hex);
  return [
    hslToHex(rotateHue(hsl, 150)),
    hslToHex(rotateHue(hsl, 210)),
  ];
}

export function getTetradic(hex: string): string[] {
  const hsl = hexToHSL(hex);
  return [
    hslToHex(rotateHue(hsl, 90)),
    hslToHex(rotateHue(hsl, 180)),
    hslToHex(rotateHue(hsl, 270)),
  ];
}

export function getMonochromatic(hex: string): string[] {
  const hsl = hexToHSL(hex);
  return [
    hslToHex(adjustLightness(hsl, -20)),
    hslToHex(adjustLightness(hsl, -10)),
    hslToHex(adjustLightness(hsl, 10)),
    hslToHex(adjustLightness(hsl, 20)),
  ];
}

export interface HarmonyResult {
  type: HarmonyType;
  name: string;
  colors: string[];
}

export function getAllHarmonies(baseColor: string): HarmonyResult[] {
  return [
    { type: 'complementary', name: 'Complementary', colors: [baseColor, ...getComplementary(baseColor)] },
    { type: 'analogous', name: 'Analogous', colors: [baseColor, ...getAnalogous(baseColor)] },
    { type: 'triadic', name: 'Triadic', colors: [baseColor, ...getTriadic(baseColor)] },
    { type: 'split-complementary', name: 'Split Complementary', colors: [baseColor, ...getSplitComplementary(baseColor)] },
    { type: 'tetradic', name: 'Tetradic', colors: [baseColor, ...getTetradic(baseColor)] },
    { type: 'monochromatic', name: 'Monochromatic', colors: [baseColor, ...getMonochromatic(baseColor)] },
  ];
}
