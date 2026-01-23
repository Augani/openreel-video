export interface ColorLookupSettings {
  lutData: Float32Array | null;
  lutSize: number;
  strength: number;
}

export const DEFAULT_COLOR_LOOKUP: ColorLookupSettings = {
  lutData: null,
  lutSize: 0,
  strength: 100,
};

export function parseCubeLUT(content: string): { data: Float32Array; size: number } | null {
  const lines = content.split('\n');
  let size = 0;
  const data: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#') || trimmed === '') continue;

    if (trimmed.startsWith('LUT_3D_SIZE')) {
      const match = trimmed.match(/LUT_3D_SIZE\s+(\d+)/);
      if (match) {
        size = parseInt(match[1], 10);
      }
      continue;
    }

    if (trimmed.startsWith('TITLE') || trimmed.startsWith('DOMAIN_')) continue;

    const values = trimmed.split(/\s+/).map(parseFloat);
    if (values.length === 3 && values.every((v) => !isNaN(v))) {
      data.push(...values);
    }
  }

  if (size === 0 || data.length !== size * size * size * 3) {
    return null;
  }

  return { data: new Float32Array(data), size };
}

export function parse3dlLUT(content: string): { data: Float32Array; size: number } | null {
  const lines = content.split('\n');
  const data: number[] = [];
  let size = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const values = trimmed.split(/\s+/).map(parseFloat);

    if (values.length === 1 && size === 0) {
      size = Math.round(Math.cbrt(values[0]));
      continue;
    }

    if (values.length === 3 && values.every((v) => !isNaN(v))) {
      data.push(values[0] / 4095, values[1] / 4095, values[2] / 4095);
    }
  }

  if (size === 0) {
    size = Math.round(Math.cbrt(data.length / 3));
  }

  if (size === 0 || data.length !== size * size * size * 3) {
    return null;
  }

  return { data: new Float32Array(data), size };
}

function trilinearInterpolate(
  lutData: Float32Array,
  size: number,
  r: number,
  g: number,
  b: number
): { r: number; g: number; b: number } {
  const rScaled = r * (size - 1);
  const gScaled = g * (size - 1);
  const bScaled = b * (size - 1);

  const r0 = Math.floor(rScaled);
  const g0 = Math.floor(gScaled);
  const b0 = Math.floor(bScaled);

  const r1 = Math.min(r0 + 1, size - 1);
  const g1 = Math.min(g0 + 1, size - 1);
  const b1 = Math.min(b0 + 1, size - 1);

  const rFrac = rScaled - r0;
  const gFrac = gScaled - g0;
  const bFrac = bScaled - b0;

  const getIndex = (ri: number, gi: number, bi: number) => (bi * size * size + gi * size + ri) * 3;

  const c000 = getIndex(r0, g0, b0);
  const c100 = getIndex(r1, g0, b0);
  const c010 = getIndex(r0, g1, b0);
  const c110 = getIndex(r1, g1, b0);
  const c001 = getIndex(r0, g0, b1);
  const c101 = getIndex(r1, g0, b1);
  const c011 = getIndex(r0, g1, b1);
  const c111 = getIndex(r1, g1, b1);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const interpolate = (channel: number) => {
    const c00 = lerp(lutData[c000 + channel], lutData[c100 + channel], rFrac);
    const c01 = lerp(lutData[c001 + channel], lutData[c101 + channel], rFrac);
    const c10 = lerp(lutData[c010 + channel], lutData[c110 + channel], rFrac);
    const c11 = lerp(lutData[c011 + channel], lutData[c111 + channel], rFrac);

    const c0 = lerp(c00, c10, gFrac);
    const c1 = lerp(c01, c11, gFrac);

    return lerp(c0, c1, bFrac);
  };

  return {
    r: interpolate(0),
    g: interpolate(1),
    b: interpolate(2),
  };
}

export function applyColorLookup(imageData: ImageData, settings: ColorLookupSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  if (!settings.lutData || settings.lutSize === 0) {
    resultData.set(data);
    return new ImageData(resultData, width, height);
  }

  const strength = settings.strength / 100;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const a = data[i + 3];

    const lutColor = trilinearInterpolate(settings.lutData, settings.lutSize, r, g, b);

    resultData[i] = Math.max(0, Math.min(255, (r + (lutColor.r - r) * strength) * 255));
    resultData[i + 1] = Math.max(0, Math.min(255, (g + (lutColor.g - g) * strength) * 255));
    resultData[i + 2] = Math.max(0, Math.min(255, (b + (lutColor.b - b) * strength) * 255));
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}

export function createIdentityLUT(size: number): Float32Array {
  const data = new Float32Array(size * size * size * 3);

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const idx = (b * size * size + g * size + r) * 3;
        data[idx] = r / (size - 1);
        data[idx + 1] = g / (size - 1);
        data[idx + 2] = b / (size - 1);
      }
    }
  }

  return data;
}
