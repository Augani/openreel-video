export type PhotoFilterPreset =
  | 'warming-85'
  | 'warming-81'
  | 'warming-lba'
  | 'cooling-80'
  | 'cooling-82'
  | 'cooling-lbb'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'magenta'
  | 'sepia'
  | 'deep-red'
  | 'deep-blue'
  | 'deep-emerald'
  | 'deep-yellow'
  | 'underwater'
  | 'custom';

export interface PhotoFilterSettings {
  filter: PhotoFilterPreset;
  color: string;
  density: number;
  preserveLuminosity: boolean;
}

export const DEFAULT_PHOTO_FILTER: PhotoFilterSettings = {
  filter: 'warming-85',
  color: '#ec8a00',
  density: 25,
  preserveLuminosity: true,
};

export const PHOTO_FILTER_COLORS: Record<PhotoFilterPreset, string> = {
  'warming-85': '#ec8a00',
  'warming-81': '#ebb113',
  'warming-lba': '#fa9600',
  'cooling-80': '#006dff',
  'cooling-82': '#00b5ff',
  'cooling-lbb': '#005fcc',
  red: '#ea1a1a',
  orange: '#f28e00',
  yellow: '#f9d71c',
  green: '#1ab800',
  cyan: '#00e5e5',
  blue: '#0000ff',
  violet: '#8000ff',
  magenta: '#ea00ea',
  sepia: '#ac7a33',
  'deep-red': '#a10000',
  'deep-blue': '#000066',
  'deep-emerald': '#003d00',
  'deep-yellow': '#998c00',
  underwater: '#00c2b0',
  custom: '#ffffff',
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
  return { r: 255, g: 255, b: 255 };
}

function getLuminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

export function applyPhotoFilter(imageData: ImageData, settings: PhotoFilterSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const filterColor = settings.filter === 'custom'
    ? parseColor(settings.color)
    : parseColor(PHOTO_FILTER_COLORS[settings.filter]);

  const density = settings.density / 100;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const originalLuminance = getLuminance(r, g, b);

    let newR = r + (filterColor.r - r) * density;
    let newG = g + (filterColor.g - g) * density;
    let newB = b + (filterColor.b - b) * density;

    if (settings.preserveLuminosity) {
      const newLuminance = getLuminance(newR, newG, newB);
      if (newLuminance > 0) {
        const ratio = originalLuminance / newLuminance;
        newR *= ratio;
        newG *= ratio;
        newB *= ratio;
      }
    }

    resultData[i] = Math.max(0, Math.min(255, newR));
    resultData[i + 1] = Math.max(0, Math.min(255, newG));
    resultData[i + 2] = Math.max(0, Math.min(255, newB));
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}
