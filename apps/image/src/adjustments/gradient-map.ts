export interface GradientStop {
  position: number;
  color: string;
}

export interface GradientMapSettings {
  stops: GradientStop[];
  dither: boolean;
  reverse: boolean;
}

export const DEFAULT_GRADIENT_MAP: GradientMapSettings = {
  stops: [
    { position: 0, color: '#000000' },
    { position: 100, color: '#ffffff' },
  ],
  dither: false,
  reverse: false,
};

export const GRADIENT_MAP_PRESETS = {
  blackWhite: [
    { position: 0, color: '#000000' },
    { position: 100, color: '#ffffff' },
  ],
  sepiaTone: [
    { position: 0, color: '#1a0f00' },
    { position: 50, color: '#8b6914' },
    { position: 100, color: '#ffe7b3' },
  ],
  duotoneBlueOrange: [
    { position: 0, color: '#001f4d' },
    { position: 100, color: '#ff8c00' },
  ],
  duotonePurpleTeal: [
    { position: 0, color: '#2d1b4e' },
    { position: 100, color: '#00d4aa' },
  ],
  sunset: [
    { position: 0, color: '#1a0533' },
    { position: 33, color: '#6b1839' },
    { position: 66, color: '#d44d1b' },
    { position: 100, color: '#ffd700' },
  ],
  coolBlue: [
    { position: 0, color: '#000033' },
    { position: 50, color: '#0066cc' },
    { position: 100, color: '#99ccff' },
  ],
  warmRed: [
    { position: 0, color: '#1a0000' },
    { position: 50, color: '#cc3300' },
    { position: 100, color: '#ffcc99' },
  ],
  greenForest: [
    { position: 0, color: '#001a00' },
    { position: 50, color: '#336600' },
    { position: 100, color: '#99cc66' },
  ],
  infrared: [
    { position: 0, color: '#000000' },
    { position: 25, color: '#330066' },
    { position: 50, color: '#ff0066' },
    { position: 75, color: '#ffcc00' },
    { position: 100, color: '#ffffff' },
  ],
  thermal: [
    { position: 0, color: '#000033' },
    { position: 25, color: '#6600cc' },
    { position: 50, color: '#ff0000' },
    { position: 75, color: '#ffff00' },
    { position: 100, color: '#ffffff' },
  ],
};

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (match) {
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function interpolateGradient(
  stops: GradientStop[],
  position: number
): { r: number; g: number; b: number } {
  if (stops.length === 0) return { r: 0, g: 0, b: 0 };
  if (stops.length === 1) return parseColor(stops[0].color);

  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  if (position <= sortedStops[0].position) {
    return parseColor(sortedStops[0].color);
  }
  if (position >= sortedStops[sortedStops.length - 1].position) {
    return parseColor(sortedStops[sortedStops.length - 1].color);
  }

  for (let i = 0; i < sortedStops.length - 1; i++) {
    const stop1 = sortedStops[i];
    const stop2 = sortedStops[i + 1];

    if (position >= stop1.position && position <= stop2.position) {
      const t = (position - stop1.position) / (stop2.position - stop1.position);
      const c1 = parseColor(stop1.color);
      const c2 = parseColor(stop2.color);

      return {
        r: Math.round(c1.r + (c2.r - c1.r) * t),
        g: Math.round(c1.g + (c2.g - c1.g) * t),
        b: Math.round(c1.b + (c2.b - c1.b) * t),
      };
    }
  }

  return parseColor(sortedStops[sortedStops.length - 1].color);
}

function getLuminance(r: number, g: number, b: number): number {
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

export function applyGradientMap(imageData: ImageData, settings: GradientMapSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const lookupTable: Array<{ r: number; g: number; b: number }> = [];
  for (let i = 0; i < 256; i++) {
    let position = (i / 255) * 100;
    if (settings.reverse) {
      position = 100 - position;
    }
    lookupTable[i] = interpolateGradient(settings.stops, position);
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    let luminance = getLuminance(r, g, b);

    if (settings.dither) {
      const noise = (Math.random() - 0.5) * (1 / 255);
      luminance = Math.max(0, Math.min(1, luminance + noise));
    }

    const idx = Math.round(luminance * 255);
    const mappedColor = lookupTable[idx];

    resultData[i] = mappedColor.r;
    resultData[i + 1] = mappedColor.g;
    resultData[i + 2] = mappedColor.b;
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}
