import type { BlendMode } from "./types";

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface ChromaKeyConfig {
  keyColor: RGBColor;
  tolerance: number;
  edgeSoftness: number;
  spillSuppression: number;
}

export interface CompositeLayerInput {
  image: ImageBitmap;
  blendMode: BlendMode;
  opacity: number;
  visible: boolean;
}

export interface CompositeResult {
  image: ImageBitmap;
  processingTime: number;
  layerCount: number;
}

export interface CompositeChromaKeyResult {
  image: ImageBitmap;
  processingTime: number;
}

export interface CompositeEngineConfig {
  width: number;
  height: number;
}

export const CHROMA_KEY_PRESETS = {
  greenScreen: {
    keyColor: { r: 0, g: 1, b: 0 },
    tolerance: 0.3,
    edgeSoftness: 0.1,
    spillSuppression: 0.5,
  },
  blueScreen: {
    keyColor: { r: 0, g: 0, b: 1 },
    tolerance: 0.3,
    edgeSoftness: 0.1,
    spillSuppression: 0.5,
  },
} as const;

export class CompositeEngine {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private tempCanvas: OffscreenCanvas;
  private tempCtx: OffscreenCanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(config: CompositeEngineConfig) {
    this.width = config.width;
    this.height = config.height;

    this.canvas = new OffscreenCanvas(config.width, config.height);
    this.ctx = this.canvas.getContext("2d")!;

    this.tempCanvas = new OffscreenCanvas(config.width, config.height);
    this.tempCtx = this.tempCanvas.getContext("2d")!;
  }

  async compositeLayers(
    layers: CompositeLayerInput[],
    backgroundColor?: RGBColor,
  ): Promise<CompositeResult> {
    const startTime = performance.now();
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Fill background if specified
    if (backgroundColor) {
      this.ctx.fillStyle = `rgb(${backgroundColor.r * 255}, ${
        backgroundColor.g * 255
      }, ${backgroundColor.b * 255})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }

    let layerCount = 0;

    // Composite each visible layer
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) continue;

      await this.compositeLayer(layer);
      layerCount++;
    }

    const result = await createImageBitmap(this.canvas);

    return {
      image: result,
      processingTime: performance.now() - startTime,
      layerCount,
    };
  }

  private async compositeLayer(layer: CompositeLayerInput): Promise<void> {
    const { image, blendMode, opacity } = layer;

    // For normal blend mode, use canvas composite operations
    if (blendMode === "normal") {
      this.ctx.globalAlpha = opacity;
      this.ctx.drawImage(image, 0, 0, this.width, this.height);
      this.ctx.globalAlpha = 1;
      return;
    }

    // For other blend modes, use pixel-level blending
    await this.blendLayerPixels(image, blendMode, opacity);
  }

  private async blendLayerPixels(
    image: ImageBitmap,
    blendMode: BlendMode,
    opacity: number,
  ): Promise<void> {
    // Draw layer to temp canvas
    this.tempCtx.clearRect(0, 0, this.width, this.height);
    this.tempCtx.drawImage(image, 0, 0, this.width, this.height);
    const baseData = this.ctx.getImageData(0, 0, this.width, this.height);
    const layerData = this.tempCtx.getImageData(0, 0, this.width, this.height);
    const base = baseData.data;
    const layer = layerData.data;
    for (let i = 0; i < base.length; i += 4) {
      const baseR = base[i] / 255;
      const baseG = base[i + 1] / 255;
      const baseB = base[i + 2] / 255;
      const baseA = base[i + 3] / 255;

      const layerR = layer[i] / 255;
      const layerG = layer[i + 1] / 255;
      const layerB = layer[i + 2] / 255;
      const layerA = (layer[i + 3] / 255) * opacity;

      if (layerA === 0) continue;
      const blended = this.applyBlendMode(
        { r: baseR, g: baseG, b: baseB },
        { r: layerR, g: layerG, b: layerB },
        blendMode,
      );

      // Alpha compositing
      const outA = layerA + baseA * (1 - layerA);
      if (outA > 0) {
        const outR = (blended.r * layerA + baseR * baseA * (1 - layerA)) / outA;
        const outG = (blended.g * layerA + baseG * baseA * (1 - layerA)) / outA;
        const outB = (blended.b * layerA + baseB * baseA * (1 - layerA)) / outA;

        base[i] = Math.round(outR * 255);
        base[i + 1] = Math.round(outG * 255);
        base[i + 2] = Math.round(outB * 255);
        base[i + 3] = Math.round(outA * 255);
      }
    }

    this.ctx.putImageData(baseData, 0, 0);
  }

  private applyBlendMode(
    base: RGBColor,
    layer: RGBColor,
    mode: BlendMode,
  ): RGBColor {
    switch (mode) {
      case "multiply":
        return {
          r: base.r * layer.r,
          g: base.g * layer.g,
          b: base.b * layer.b,
        };

      case "screen":
        return {
          r: 1 - (1 - base.r) * (1 - layer.r),
          g: 1 - (1 - base.g) * (1 - layer.g),
          b: 1 - (1 - base.b) * (1 - layer.b),
        };

      case "overlay":
        return {
          r: this.overlayChannel(base.r, layer.r),
          g: this.overlayChannel(base.g, layer.g),
          b: this.overlayChannel(base.b, layer.b),
        };

      case "darken":
        return {
          r: Math.min(base.r, layer.r),
          g: Math.min(base.g, layer.g),
          b: Math.min(base.b, layer.b),
        };

      case "lighten":
        return {
          r: Math.max(base.r, layer.r),
          g: Math.max(base.g, layer.g),
          b: Math.max(base.b, layer.b),
        };

      case "color-dodge":
        return {
          r: this.colorDodgeChannel(base.r, layer.r),
          g: this.colorDodgeChannel(base.g, layer.g),
          b: this.colorDodgeChannel(base.b, layer.b),
        };

      case "color-burn":
        return {
          r: this.colorBurnChannel(base.r, layer.r),
          g: this.colorBurnChannel(base.g, layer.g),
          b: this.colorBurnChannel(base.b, layer.b),
        };

      case "hard-light":
        return {
          r: this.hardLightChannel(base.r, layer.r),
          g: this.hardLightChannel(base.g, layer.g),
          b: this.hardLightChannel(base.b, layer.b),
        };

      case "soft-light":
        return {
          r: this.softLightChannel(base.r, layer.r),
          g: this.softLightChannel(base.g, layer.g),
          b: this.softLightChannel(base.b, layer.b),
        };

      case "difference":
        return {
          r: Math.abs(base.r - layer.r),
          g: Math.abs(base.g - layer.g),
          b: Math.abs(base.b - layer.b),
        };

      case "exclusion":
        return {
          r: base.r + layer.r - 2 * base.r * layer.r,
          g: base.g + layer.g - 2 * base.g * layer.g,
          b: base.b + layer.b - 2 * base.b * layer.b,
        };

      case "normal":
      default:
        return layer;
    }
  }

  private overlayChannel(base: number, layer: number): number {
    if (base < 0.5) {
      return 2 * base * layer;
    }
    return 1 - 2 * (1 - base) * (1 - layer);
  }

  private colorDodgeChannel(base: number, layer: number): number {
    if (layer >= 1) return 1;
    return Math.min(1, base / (1 - layer));
  }

  private colorBurnChannel(base: number, layer: number): number {
    if (layer <= 0) return 0;
    return Math.max(0, 1 - (1 - base) / layer);
  }

  private hardLightChannel(base: number, layer: number): number {
    if (layer < 0.5) {
      return 2 * base * layer;
    }
    return 1 - 2 * (1 - base) * (1 - layer);
  }

  private softLightChannel(base: number, layer: number): number {
    if (layer < 0.5) {
      return base - (1 - 2 * layer) * base * (1 - base);
    }
    const d =
      base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
    return base + (2 * layer - 1) * (d - base);
  }

  async applyChromaKey(
    image: ImageBitmap,
    config: ChromaKeyConfig,
  ): Promise<CompositeChromaKeyResult> {
    const startTime = performance.now();

    // Draw image to canvas
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(image, 0, 0, this.width, this.height);
    const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;

    const keyR = config.keyColor.r;
    const keyG = config.keyColor.g;
    const keyB = config.keyColor.b;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const distance = Math.sqrt(
        (r - keyR) ** 2 + (g - keyG) ** 2 + (b - keyB) ** 2,
      );

      // Normalize distance (max distance in RGB space is sqrt(3))
      const normalizedDistance = distance / Math.sqrt(3);
      const innerEdge = config.tolerance - config.edgeSoftness;
      const outerEdge = config.tolerance + config.edgeSoftness;

      let alpha: number;
      if (normalizedDistance <= innerEdge) {
        alpha = 0; // Fully transparent
      } else if (normalizedDistance >= outerEdge) {
        alpha = 1; // Fully opaque
      } else {
        // Smooth transition
        alpha = (normalizedDistance - innerEdge) / (outerEdge - innerEdge);
      }
      if (alpha > 0 && config.spillSuppression > 0) {
        const spillResult = this.suppressSpill(
          { r, g, b },
          config.keyColor,
          config.spillSuppression,
        );
        data[i] = Math.round(spillResult.r * 255);
        data[i + 1] = Math.round(spillResult.g * 255);
        data[i + 2] = Math.round(spillResult.b * 255);
      }
      data[i + 3] = Math.round(alpha * data[i + 3]);
    }

    this.ctx.putImageData(imageData, 0, 0);

    const result = await createImageBitmap(this.canvas);

    return {
      image: result,
      processingTime: performance.now() - startTime,
    };
  }

  private suppressSpill(
    color: RGBColor,
    keyColor: RGBColor,
    amount: number,
  ): RGBColor {
    // Determine which channel is the key (highest in key color)
    const maxKey = Math.max(keyColor.r, keyColor.g, keyColor.b);

    let result = { ...color };

    if (keyColor.g === maxKey) {
      // Green screen - reduce green spill
      const spillAmount = Math.max(0, color.g - Math.max(color.r, color.b));
      result.g = color.g - spillAmount * amount;
    } else if (keyColor.b === maxKey) {
      // Blue screen - reduce blue spill
      const spillAmount = Math.max(0, color.b - Math.max(color.r, color.g));
      result.b = color.b - spillAmount * amount;
    } else {
      // Red screen (less common) - reduce red spill
      const spillAmount = Math.max(0, color.r - Math.max(color.g, color.b));
      result.r = color.r - spillAmount * amount;
    }

    return result;
  }

  async sampleKeyColor(
    image: ImageBitmap,
    x: number,
    y: number,
    sampleRadius: number = 5,
  ): Promise<RGBColor> {
    // Draw image to temp canvas
    this.tempCtx.clearRect(0, 0, this.width, this.height);
    this.tempCtx.drawImage(image, 0, 0, this.width, this.height);

    // Sample area
    const startX = Math.max(0, Math.floor(x - sampleRadius));
    const startY = Math.max(0, Math.floor(y - sampleRadius));
    const endX = Math.min(this.width, Math.ceil(x + sampleRadius));
    const endY = Math.min(this.height, Math.ceil(y + sampleRadius));

    const imageData = this.tempCtx.getImageData(
      startX,
      startY,
      endX - startX,
      endY - startY,
    );
    const data = imageData.data;

    // Average the colors
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      totalR += data[i];
      totalG += data[i + 1];
      totalB += data[i + 2];
      count++;
    }

    return {
      r: totalR / count / 255,
      g: totalG / count / 255,
      b: totalB / count / 255,
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.tempCanvas.width = width;
    this.tempCanvas.height = height;
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}

export function getAvailableBlendModes(): BlendMode[] {
  return [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
  ];
}

export function getBlendModeName(mode: BlendMode): string {
  const names: Record<BlendMode, string> = {
    normal: "Normal",
    multiply: "Multiply",
    screen: "Screen",
    overlay: "Overlay",
    darken: "Darken",
    lighten: "Lighten",
    "color-dodge": "Color Dodge",
    "color-burn": "Color Burn",
    "hard-light": "Hard Light",
    "soft-light": "Soft Light",
    difference: "Difference",
    exclusion: "Exclusion",
    hue: "Hue",
    saturation: "Saturation",
    color: "Color",
    luminosity: "Luminosity",
    add: "Add",
    "linear-dodge": "Linear Dodge",
  };
  return names[mode] || mode;
}
