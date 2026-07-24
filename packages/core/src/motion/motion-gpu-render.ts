import { getMotionRootLayers } from "./motion-hierarchy";
import {
  MotionGpuCompositor,
  type MotionGpuCompositeBackground,
} from "./motion-gpu-compositor";
import {
  MotionRenderer,
  resolveMotionSupersample,
  type MotionRendererAssetResolver,
} from "./motion-renderer";
import type { MotionComposition } from "./types";

export interface MotionHighQualityRenderOptions {
  readonly compositionLibrary?: readonly MotionComposition[];
  readonly assetResolver?: MotionRendererAssetResolver;
  readonly variableOverrides?: Record<string, string | number | boolean>;
  readonly supersample?: number;
  readonly preferGpu?: boolean;
}

const NAMED_COLORS: Record<string, MotionGpuCompositeBackground> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
};

export function compositionRequiresCanvas2dCompositing(
  composition: MotionComposition,
): boolean {
  return getMotionRootLayers(composition).some(
    (layer) =>
      layer.type === "adjustment" ||
      Boolean(layer.trackMatte) ||
      (layer.effects ?? []).some((effect) => effect.type === "backdrop-blur"),
  );
}

export function parseMotionBackgroundColor(
  color: string | undefined,
): MotionGpuCompositeBackground | null {
  if (!color) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const trimmed = color.trim().toLowerCase();
  if (trimmed in NAMED_COLORS) {
    return NAMED_COLORS[trimmed];
  }
  if (trimmed.startsWith("#")) {
    return parseHexColor(trimmed);
  }
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (rgbMatch) {
    const r = clampUnit(Number(rgbMatch[1]) / 255);
    const g = clampUnit(Number(rgbMatch[2]) / 255);
    const b = clampUnit(Number(rgbMatch[3]) / 255);
    const a = rgbMatch[4] === undefined ? 1 : clampUnit(Number(rgbMatch[4]));
    return { r, g, b, a };
  }
  return null;
}

function parseHexColor(
  hex: string,
): MotionGpuCompositeBackground | null {
  const value = hex.slice(1);
  if (value.length === 3 || value.length === 4) {
    const r = parseInt(value[0] + value[0], 16) / 255;
    const g = parseInt(value[1] + value[1], 16) / 255;
    const b = parseInt(value[2] + value[2], 16) / 255;
    const a =
      value.length === 4 ? parseInt(value[3] + value[3], 16) / 255 : 1;
    return validChannels(r, g, b, a);
  }
  if (value.length === 6 || value.length === 8) {
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    const a =
      value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
    return validChannels(r, g, b, a);
  }
  return null;
}

function validChannels(
  r: number,
  g: number,
  b: number,
  a: number,
): MotionGpuCompositeBackground | null {
  if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b, a };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export class MotionHighQualityRenderer {
  private readonly renderer: MotionRenderer;
  private gpu: MotionGpuCompositor | null = null;
  private gpuInit: Promise<MotionGpuCompositor | null> | null = null;
  private gpuUnavailable = false;

  constructor(renderer: MotionRenderer = new MotionRenderer()) {
    this.renderer = renderer;
  }

  getCanvas2DRenderer(): MotionRenderer {
    return this.renderer;
  }

  canUseGpu(composition: MotionComposition, preferGpu: boolean): boolean {
    return (
      preferGpu &&
      !this.gpuUnavailable &&
      MotionGpuCompositor.isSupported() &&
      !compositionRequiresCanvas2dCompositing(composition) &&
      parseMotionBackgroundColor(composition.backgroundColor) !== null
    );
  }

  async render(
    composition: MotionComposition,
    localTime: number,
    options: MotionHighQualityRenderOptions = {},
  ): Promise<ImageBitmap> {
    const supersample = options.supersample ?? 1;
    const preferGpu = options.preferGpu ?? true;

    if (this.canUseGpu(composition, preferGpu)) {
      const gpu = await this.ensureGpu();
      if (gpu) {
        try {
          return await this.renderWithGpu(
            gpu,
            composition,
            localTime,
            supersample,
            options,
          );
        } catch (error) {
          console.warn(
            "[MotionGPU] GPU compositing failed, falling back to Canvas2D",
            error,
          );
        }
      }
    }

    return this.renderer.renderComposition(composition, localTime, {
      compositionLibrary: options.compositionLibrary,
      assetResolver: options.assetResolver,
      variableOverrides: options.variableOverrides,
      supersample,
    });
  }

  destroy(): void {
    this.gpu?.destroy();
    this.gpu = null;
    this.gpuInit = null;
    this.gpuUnavailable = false;
  }

  private async ensureGpu(): Promise<MotionGpuCompositor | null> {
    if (this.gpuUnavailable) return null;
    if (this.gpu?.isReady()) return this.gpu;
    if (!this.gpuInit) {
      const compositor = new MotionGpuCompositor();
      this.gpuInit = compositor
        .initialize()
        .then((ready) => {
          if (ready) {
            this.gpu = compositor;
            return compositor;
          }
          this.gpuUnavailable = true;
          return null;
        })
        .catch(() => {
          this.gpuUnavailable = true;
          return null;
        });
    }
    return this.gpuInit;
  }

  private async renderWithGpu(
    gpu: MotionGpuCompositor,
    composition: MotionComposition,
    localTime: number,
    supersample: number,
    options: MotionHighQualityRenderOptions,
  ): Promise<ImageBitmap> {
    const background = parseMotionBackgroundColor(composition.backgroundColor);
    if (!background) {
      throw new Error("Unsupported composition background for GPU compositing");
    }
    const scale = resolveMotionSupersample(
      supersample,
      composition.width,
      composition.height,
    );
    const layers = await this.renderer.renderRootLayerImages(
      composition,
      localTime,
      {
        compositionLibrary: options.compositionLibrary,
        assetResolver: options.assetResolver,
        variableOverrides: options.variableOverrides,
        supersample,
      },
    );
    try {
      gpu.beginComposite(
        Math.round(composition.width * scale),
        Math.round(composition.height * scale),
        background,
      );
      for (const layer of layers) {
        gpu.addLayer(layer.image, layer.blendMode, 1);
      }
      return await gpu.finish(composition.width, composition.height);
    } finally {
      for (const layer of layers) {
        layer.image.close();
      }
    }
  }
}
