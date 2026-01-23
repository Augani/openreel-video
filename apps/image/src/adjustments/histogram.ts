export interface HistogramData {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luminosity: Uint32Array;
}

export interface HistogramStatistics {
  mean: number;
  stdDev: number;
  median: number;
  min: number;
  max: number;
  pixelCount: number;
  shadowsClipped: number;
  highlightsClipped: number;
}

export interface HistogramResult {
  data: HistogramData;
  statistics: {
    red: HistogramStatistics;
    green: HistogramStatistics;
    blue: HistogramStatistics;
    luminosity: HistogramStatistics;
  };
}

export interface ColorInfo {
  rgb: { r: number; g: number; b: number };
  hsb: { h: number; s: number; b: number };
  hsl: { h: number; s: number; l: number };
  lab: { l: number; a: number; b: number };
  cmyk: { c: number; m: number; y: number; k: number };
  hex: string;
}

function calculateStatistics(histogram: Uint32Array, totalPixels: number): HistogramStatistics {
  let sum = 0;
  let min = 255;
  let max = 0;
  let pixelCount = 0;

  for (let i = 0; i < 256; i++) {
    const count = histogram[i];
    if (count > 0) {
      sum += i * count;
      pixelCount += count;
      if (i < min) min = i;
      if (i > max) max = i;
    }
  }

  const mean = pixelCount > 0 ? sum / pixelCount : 0;

  let varianceSum = 0;
  for (let i = 0; i < 256; i++) {
    const count = histogram[i];
    if (count > 0) {
      varianceSum += count * Math.pow(i - mean, 2);
    }
  }
  const stdDev = pixelCount > 0 ? Math.sqrt(varianceSum / pixelCount) : 0;

  let medianCount = 0;
  let median = 0;
  const halfCount = pixelCount / 2;
  for (let i = 0; i < 256; i++) {
    medianCount += histogram[i];
    if (medianCount >= halfCount) {
      median = i;
      break;
    }
  }

  const shadowsClipped = (histogram[0] / totalPixels) * 100;
  const highlightsClipped = (histogram[255] / totalPixels) * 100;

  return {
    mean,
    stdDev,
    median,
    min: pixelCount > 0 ? min : 0,
    max: pixelCount > 0 ? max : 0,
    pixelCount,
    shadowsClipped,
    highlightsClipped,
  };
}

export function calculateHistogram(imageData: ImageData): HistogramResult {
  const { data } = imageData;

  const histogramData: HistogramData = {
    red: new Uint32Array(256),
    green: new Uint32Array(256),
    blue: new Uint32Array(256),
    luminosity: new Uint32Array(256),
  };

  const totalPixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    histogramData.red[r]++;
    histogramData.green[g]++;
    histogramData.blue[b]++;

    const luminosity = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    histogramData.luminosity[luminosity]++;
  }

  return {
    data: histogramData,
    statistics: {
      red: calculateStatistics(histogramData.red, totalPixels),
      green: calculateStatistics(histogramData.green, totalPixels),
      blue: calculateStatistics(histogramData.blue, totalPixels),
      luminosity: calculateStatistics(histogramData.luminosity, totalPixels),
    },
  };
}

export function getColorInfo(r: number, g: number, b: number): ColorInfo {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) / 6;
    } else if (max === gNorm) {
      h = ((bNorm - rNorm) / delta + 2) / 6;
    } else {
      h = ((rNorm - gNorm) / delta + 4) / 6;
    }
  }

  const l = (max + min) / 2;
  const sHsl = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  const sBrightness = max === 0 ? 0 : delta / max;

  const k = 1 - max;
  const c = max === 0 ? 0 : (1 - rNorm - k) / (1 - k);
  const m = max === 0 ? 0 : (1 - gNorm - k) / (1 - k);
  const y = max === 0 ? 0 : (1 - bNorm - k) / (1 - k);

  const xyzR = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  const xyzG = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  const xyzB = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  const x = (xyzR * 0.4124564 + xyzG * 0.3575761 + xyzB * 0.1804375) / 0.95047;
  const yVal = xyzR * 0.2126729 + xyzG * 0.7151522 + xyzB * 0.0721750;
  const z = (xyzR * 0.0193339 + xyzG * 0.1191920 + xyzB * 0.9503041) / 1.08883;

  const f = (t: number) => t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;

  const labL = 116 * f(yVal) - 16;
  const labA = 500 * (f(x) - f(yVal));
  const labB = 200 * (f(yVal) - f(z));

  const hex = '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0');

  return {
    rgb: { r, g, b },
    hsb: {
      h: Math.round(h * 360),
      s: Math.round(sBrightness * 100),
      b: Math.round(max * 100),
    },
    hsl: {
      h: Math.round(h * 360),
      s: Math.round(sHsl * 100),
      l: Math.round(l * 100),
    },
    lab: {
      l: Math.round(labL),
      a: Math.round(labA),
      b: Math.round(labB),
    },
    cmyk: {
      c: Math.round(c * 100),
      m: Math.round(m * 100),
      y: Math.round(y * 100),
      k: Math.round(k * 100),
    },
    hex,
  };
}

export function renderHistogram(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  histogram: Uint32Array,
  color: string,
  width: number,
  height: number,
  logarithmic: boolean = false
): void {
  const maxValue = Math.max(...histogram);
  if (maxValue === 0) return;

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;

  const barWidth = width / 256;

  for (let i = 0; i < 256; i++) {
    let normalizedValue: number;
    if (logarithmic && histogram[i] > 0) {
      normalizedValue = Math.log10(histogram[i] + 1) / Math.log10(maxValue + 1);
    } else {
      normalizedValue = histogram[i] / maxValue;
    }

    const barHeight = normalizedValue * height;
    ctx.fillRect(i * barWidth, height - barHeight, barWidth, barHeight);
  }

  ctx.globalAlpha = 1;
}

export function autoLevels(imageData: ImageData, clipPercent: number = 0.1): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  const histogram = calculateHistogram(imageData);
  const totalPixels = data.length / 4;
  const clipPixels = Math.round(totalPixels * (clipPercent / 100));

  const findClipPoint = (hist: Uint32Array, fromStart: boolean): number => {
    let count = 0;
    if (fromStart) {
      for (let i = 0; i < 256; i++) {
        count += hist[i];
        if (count > clipPixels) return i;
      }
      return 0;
    } else {
      for (let i = 255; i >= 0; i--) {
        count += hist[i];
        if (count > clipPixels) return i;
      }
      return 255;
    }
  };

  const channels = ['red', 'green', 'blue'] as const;
  const adjustments = channels.map((channel) => {
    const hist = histogram.data[channel];
    const inputBlack = findClipPoint(hist, true);
    const inputWhite = findClipPoint(hist, false);
    return { inputBlack, inputWhite };
  });

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const { inputBlack, inputWhite } = adjustments[c];
      const range = inputWhite - inputBlack || 1;
      const value = data[i + c];
      const adjusted = ((value - inputBlack) / range) * 255;
      resultData[i + c] = Math.max(0, Math.min(255, Math.round(adjusted)));
    }
    resultData[i + 3] = data[i + 3];
  }

  return new ImageData(resultData, width, height);
}

export function autoContrast(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const range = maxLum - minLum || 1;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const adjusted = ((data[i + c] - minLum) / range) * 255;
      resultData[i + c] = Math.max(0, Math.min(255, Math.round(adjusted)));
    }
    resultData[i + 3] = data[i + 3];
  }

  return new ImageData(resultData, width, height);
}
