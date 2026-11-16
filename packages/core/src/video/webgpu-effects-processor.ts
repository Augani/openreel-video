import type { Effect } from "../types/timeline";
import {
  effectsComputeShaderSource,
  blurComputeShaderSource,
  createEffectUniformsBuffer,
  createBlurUniformsBuffer,
  createDimensionsBuffer,
} from "./shaders";

interface EffectParams {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  tint: number;
  shadows: number;
  highlights: number;
}

interface BlurParams {
  radius: number;
  sigma?: number;
}

interface EffectsProcessorConfig {
  device: GPUDevice;
  width: number;
  height: number;
}

export type EffectsChangeCallback = (clipId: string, effects: Effect[]) => void;

export class WebGPUEffectsProcessor {
  private device: GPUDevice;
  private width: number;
  private height: number;

  // Compute pipelines
  private effectsPipeline: GPUComputePipeline | null = null;
  private blurPipeline: GPUComputePipeline | null = null;

  // Bind group layouts
  private effectsBindGroupLayout: GPUBindGroupLayout | null = null;
  private blurBindGroupLayout: GPUBindGroupLayout | null = null;

  // Uniform buffers
  private effectsUniformBuffer: GPUBuffer | null = null;
  private blurUniformBuffer: GPUBuffer | null = null;
  private dimensionsBuffer: GPUBuffer | null = null;

  // Intermediate textures for ping-pong rendering
  private intermediateTextures: GPUTexture[] = [];
  private currentTextureIndex = 0;

  // Effect change tracking for re-render trigger
  private effectsChangeCallbacks: EffectsChangeCallback[] = [];
  private lastEffectsHash: Map<string, string> = new Map();
  private pendingReRenders: Map<string, NodeJS.Timeout> = new Map();

  // Performance tracking
  private lastProcessingTime = 0;

  constructor(config: EffectsProcessorConfig) {
    this.device = config.device;
    this.width = config.width;
    this.height = config.height;
  }

  async initialize(): Promise<boolean> {
    try {
      this.createBindGroupLayouts();
      await this.createPipelines();
      this.createUniformBuffers();
      this.createIntermediateTextures();

      return true;
    } catch (error) {
      console.error("[WebGPUEffectsProcessor] Initialization failed:", error);
      return false;
    }
  }

  private createBindGroupLayouts(): void {
    // Effects compute shader bind group layout
    this.effectsBindGroupLayout = this.device.createBindGroupLayout({
      label: "Effects Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    // Blur compute shader bind group layout (same structure)
    this.blurBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blur Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
  }

  private async createPipelines(): Promise<void> {
    // Effects compute pipeline
    const effectsShaderModule = this.device.createShaderModule({
      label: "Effects Compute Shader",
      code: effectsComputeShaderSource,
    });

    this.effectsPipeline = this.device.createComputePipeline({
      label: "Effects Compute Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.effectsBindGroupLayout!],
      }),
      compute: {
        module: effectsShaderModule,
        entryPoint: "main",
      },
    });

    // Blur compute pipeline
    const blurShaderModule = this.device.createShaderModule({
      label: "Blur Compute Shader",
      code: blurComputeShaderSource,
    });

    this.blurPipeline = this.device.createComputePipeline({
      label: "Blur Compute Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.blurBindGroupLayout!],
      }),
      compute: {
        module: blurShaderModule,
        entryPoint: "main",
      },
    });
  }

  private createUniformBuffers(): void {
    // Effects uniform buffer (32 bytes)
    this.effectsUniformBuffer = this.device.createBuffer({
      label: "Effects Uniform Buffer",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Blur uniform buffer (16 bytes)
    this.blurUniformBuffer = this.device.createBuffer({
      label: "Blur Uniform Buffer",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Dimensions buffer (16 bytes)
    this.dimensionsBuffer = this.device.createBuffer({
      label: "Dimensions Buffer",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const dimensionsData = createDimensionsBuffer(this.width, this.height);
    this.device.queue.writeBuffer(
      this.dimensionsBuffer,
      0,
      dimensionsData.buffer as ArrayBuffer,
    );
  }

  private createIntermediateTextures(): void {
    // Clean up existing textures
    for (const texture of this.intermediateTextures) {
      texture.destroy();
    }
    this.intermediateTextures = [];
    for (let i = 0; i < 2; i++) {
      const texture = this.device.createTexture({
        label: `Intermediate Texture ${i}`,
        size: { width: this.width, height: this.height },
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      });
      this.intermediateTextures.push(texture);
    }
  }

  processEffects(inputTexture: GPUTexture, effects: Effect[]): GPUTexture {
    const startTime = performance.now();
    const enabledEffects = effects.filter((e) => e.enabled);

    if (enabledEffects.length === 0) {
      this.lastProcessingTime = performance.now() - startTime;
      return inputTexture;
    }

    // Aggregate effect parameters for single-pass processing
    const aggregatedParams = this.aggregateEffectParams(enabledEffects);
    const hasBlur = enabledEffects.some((e) => e.type === "blur");
    const blurEffect = enabledEffects.find((e) => e.type === "blur");
    const commandEncoder = this.device.createCommandEncoder({
      label: "Effects Processing",
    });

    // Copy input to first intermediate texture
    commandEncoder.copyTextureToTexture(
      { texture: inputTexture },
      { texture: this.intermediateTextures[0] },
      { width: this.width, height: this.height },
    );

    this.currentTextureIndex = 0;
    if (this.hasColorEffects(aggregatedParams)) {
      this.applyColorEffects(commandEncoder, aggregatedParams);
    }
    if (hasBlur && blurEffect) {
      const blurParams = blurEffect.params as {
        radius?: number;
        sigma?: number;
      };
      this.applyBlur(commandEncoder, {
        radius: blurParams.radius ?? 0,
        sigma: blurParams.sigma,
      });
    }

    // Submit commands
    this.device.queue.submit([commandEncoder.finish()]);

    this.lastProcessingTime = performance.now() - startTime;
    return this.intermediateTextures[this.currentTextureIndex];
  }

  private aggregateEffectParams(effects: Effect[]): EffectParams {
    const params: EffectParams = {
      brightness: 0,
      contrast: 1,
      saturation: 1,
      hue: 0,
      temperature: 0,
      tint: 0,
      shadows: 0,
      highlights: 0,
    };

    for (const effect of effects) {
      const effectParams = effect.params as Record<string, unknown>;

      switch (effect.type) {
        case "brightness":
          params.brightness += (effectParams.value as number) ?? 0;
          break;
        case "contrast":
          params.contrast *= (effectParams.value as number) ?? 1;
          break;
        case "saturation":
          params.saturation *= (effectParams.value as number) ?? 1;
          break;
        case "hue":
          params.hue += (effectParams.rotation as number) ?? 0;
          break;
        case "temperature":
          params.temperature += (effectParams.value as number) ?? 0;
          break;
        case "tint":
          params.tint += (effectParams.value as number) ?? 0;
          break;
        case "tonal":
          params.shadows += (effectParams.shadows as number) ?? 0;
          params.highlights += (effectParams.highlights as number) ?? 0;
          break;
      }
    }
    params.brightness = Math.max(-1, Math.min(1, params.brightness));
    params.contrast = Math.max(0, Math.min(4, params.contrast));
    params.saturation = Math.max(0, Math.min(4, params.saturation));
    params.hue = params.hue % 360;
    params.temperature = Math.max(-1, Math.min(1, params.temperature));
    params.tint = Math.max(-1, Math.min(1, params.tint));
    params.shadows = Math.max(-1, Math.min(1, params.shadows));
    params.highlights = Math.max(-1, Math.min(1, params.highlights));

    return params;
  }

  private hasColorEffects(params: EffectParams): boolean {
    return (
      Math.abs(params.brightness) > 0.001 ||
      Math.abs(params.contrast - 1) > 0.001 ||
      Math.abs(params.saturation - 1) > 0.001 ||
      Math.abs(params.hue) > 0.001 ||
      Math.abs(params.temperature) > 0.001 ||
      Math.abs(params.tint) > 0.001 ||
      Math.abs(params.shadows) > 0.001 ||
      Math.abs(params.highlights) > 0.001
    );
  }

  private applyColorEffects(
    commandEncoder: GPUCommandEncoder,
    params: EffectParams,
  ): void {
    const uniformData = createEffectUniformsBuffer(
      params.brightness,
      params.contrast,
      params.saturation,
      params.hue,
      params.temperature,
      params.tint,
      params.shadows,
      params.highlights,
    );
    this.device.queue.writeBuffer(
      this.effectsUniformBuffer!,
      0,
      uniformData.buffer as ArrayBuffer,
    );

    const inputTexture = this.intermediateTextures[this.currentTextureIndex];
    const outputIndex = 1 - this.currentTextureIndex;
    const outputTexture = this.intermediateTextures[outputIndex];

    const bindGroup = this.device.createBindGroup({
      label: "Effects Bind Group",
      layout: this.effectsBindGroupLayout!,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.effectsUniformBuffer! } },
        { binding: 3, resource: { buffer: this.dimensionsBuffer! } },
      ],
    });

    // Dispatch compute shader
    const computePass = commandEncoder.beginComputePass({
      label: "Effects Compute Pass",
    });
    computePass.setPipeline(this.effectsPipeline!);
    computePass.setBindGroup(0, bindGroup);
    const workgroupsX = Math.ceil(this.width / 16);
    const workgroupsY = Math.ceil(this.height / 16);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
    computePass.end();

    // Swap texture index
    this.currentTextureIndex = outputIndex;
  }

  private applyBlur(
    commandEncoder: GPUCommandEncoder,
    params: BlurParams,
  ): void {
    if (params.radius < 0.5) return;

    // Horizontal pass
    this.applyBlurPass(commandEncoder, params, 1, 0);

    // Vertical pass
    this.applyBlurPass(commandEncoder, params, 0, 1);
  }

  private applyBlurPass(
    commandEncoder: GPUCommandEncoder,
    params: BlurParams,
    dirX: number,
    dirY: number,
  ): void {
    const uniformData = createBlurUniformsBuffer(
      params.radius,
      params.sigma ?? params.radius / 3,
      dirX,
      dirY,
    );
    this.device.queue.writeBuffer(
      this.blurUniformBuffer!,
      0,
      uniformData.buffer as ArrayBuffer,
    );

    const inputTexture = this.intermediateTextures[this.currentTextureIndex];
    const outputIndex = 1 - this.currentTextureIndex;
    const outputTexture = this.intermediateTextures[outputIndex];
    const bindGroup = this.device.createBindGroup({
      label: `Blur Bind Group (${dirX},${dirY})`,
      layout: this.blurBindGroupLayout!,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.blurUniformBuffer! } },
        { binding: 3, resource: { buffer: this.dimensionsBuffer! } },
      ],
    });

    // Dispatch compute shader
    const computePass = commandEncoder.beginComputePass({
      label: `Blur Compute Pass (${dirX},${dirY})`,
    });
    computePass.setPipeline(this.blurPipeline!);
    computePass.setBindGroup(0, bindGroup);

    const workgroupsX = Math.ceil(this.width / 16);
    const workgroupsY = Math.ceil(this.height / 16);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
    computePass.end();

    // Swap texture index
    this.currentTextureIndex = outputIndex;
  }

  onEffectsChange(callback: EffectsChangeCallback): void {
    this.effectsChangeCallbacks.push(callback);
  }

  notifyEffectsChanged(clipId: string, effects: Effect[]): void {
    const effectsHash = this.calculateEffectsHash(effects);
    const previousHash = this.lastEffectsHash.get(clipId);

    if (effectsHash === previousHash) {
      return; // No actual change
    }

    this.lastEffectsHash.set(clipId, effectsHash);

    // Cancel any pending re-render for this clip
    const pendingTimeout = this.pendingReRenders.get(clipId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
    }

    // Schedule re-render with debouncing (target <100ms latency)
    const timeout = setTimeout(() => {
      this.pendingReRenders.delete(clipId);
      for (const callback of this.effectsChangeCallbacks) {
        callback(clipId, effects);
      }
    }, 16); // ~60fps debounce, well under 100ms target

    this.pendingReRenders.set(clipId, timeout);
  }

  private calculateEffectsHash(effects: Effect[]): string {
    return effects
      .filter((e) => e.enabled)
      .map((e) => `${e.id}:${e.type}:${JSON.stringify(e.params)}`)
      .join("|");
  }

  getLastProcessingTime(): number {
    return this.lastProcessingTime;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.dimensionsBuffer) {
      const dimensionsData = createDimensionsBuffer(width, height);
      this.device.queue.writeBuffer(
        this.dimensionsBuffer,
        0,
        dimensionsData.buffer as ArrayBuffer,
      );
    }

    // Recreate intermediate textures
    this.createIntermediateTextures();
  }

  dispose(): void {
    for (const timeout of this.pendingReRenders.values()) {
      clearTimeout(timeout);
    }
    this.pendingReRenders.clear();

    // Destroy textures
    for (const texture of this.intermediateTextures) {
      texture.destroy();
    }
    this.intermediateTextures = [];

    // Destroy buffers
    this.effectsUniformBuffer?.destroy();
    this.blurUniformBuffer?.destroy();
    this.dimensionsBuffer?.destroy();

    this.effectsUniformBuffer = null;
    this.blurUniformBuffer = null;
    this.dimensionsBuffer = null;
    this.effectsChangeCallbacks = [];
    this.lastEffectsHash.clear();
  }
}
