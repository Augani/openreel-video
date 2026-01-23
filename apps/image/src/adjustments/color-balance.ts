export interface ColorBalanceSettings {
  shadows: {
    cyanRed: number;
    magentaGreen: number;
    yellowBlue: number;
  };
  midtones: {
    cyanRed: number;
    magentaGreen: number;
    yellowBlue: number;
  };
  highlights: {
    cyanRed: number;
    magentaGreen: number;
    yellowBlue: number;
  };
  preserveLuminosity: boolean;
}

export const DEFAULT_COLOR_BALANCE: ColorBalanceSettings = {
  shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  preserveLuminosity: true,
};

function getLuminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function getToneWeight(luminance: number, tone: 'shadows' | 'midtones' | 'highlights'): number {
  const normalized = luminance / 255;

  switch (tone) {
    case 'shadows':
      if (normalized <= 0.25) return 1;
      if (normalized <= 0.5) return 1 - (normalized - 0.25) / 0.25;
      return 0;

    case 'highlights':
      if (normalized >= 0.75) return 1;
      if (normalized >= 0.5) return (normalized - 0.5) / 0.25;
      return 0;

    case 'midtones':
      if (normalized >= 0.25 && normalized <= 0.75) {
        const distFromCenter = Math.abs(normalized - 0.5);
        return 1 - distFromCenter / 0.25;
      }
      return 0;
  }
}

export function applyColorBalance(imageData: ImageData, settings: ColorBalanceSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const a = data[i + 3];

    const luminance = getLuminance(r, g, b);

    const shadowWeight = getToneWeight(luminance, 'shadows');
    const midtoneWeight = getToneWeight(luminance, 'midtones');
    const highlightWeight = getToneWeight(luminance, 'highlights');

    let rShift = 0, gShift = 0, bShift = 0;

    if (shadowWeight > 0) {
      rShift += settings.shadows.cyanRed * shadowWeight;
      gShift += settings.shadows.magentaGreen * shadowWeight;
      bShift += settings.shadows.yellowBlue * shadowWeight;
    }

    if (midtoneWeight > 0) {
      rShift += settings.midtones.cyanRed * midtoneWeight;
      gShift += settings.midtones.magentaGreen * midtoneWeight;
      bShift += settings.midtones.yellowBlue * midtoneWeight;
    }

    if (highlightWeight > 0) {
      rShift += settings.highlights.cyanRed * highlightWeight;
      gShift += settings.highlights.magentaGreen * highlightWeight;
      bShift += settings.highlights.yellowBlue * highlightWeight;
    }

    r = Math.max(0, Math.min(255, r + rShift));
    g = Math.max(0, Math.min(255, g + gShift));
    b = Math.max(0, Math.min(255, b + bShift));

    if (settings.preserveLuminosity) {
      const newLuminance = getLuminance(r, g, b);
      if (newLuminance > 0) {
        const ratio = luminance / newLuminance;
        r = Math.max(0, Math.min(255, r * ratio));
        g = Math.max(0, Math.min(255, g * ratio));
        b = Math.max(0, Math.min(255, b * ratio));
      }
    }

    resultData[i] = r;
    resultData[i + 1] = g;
    resultData[i + 2] = b;
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}
