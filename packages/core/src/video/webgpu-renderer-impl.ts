import type { Effect } from "../types/timeline";
import type { Renderer, RendererConfig, RenderLayer } from "./renderer-factory";
import {
  WebGPUEffectsProcessor,
  type EffectsChangeCallback,
} from "./webgpu-effects-processor";
import {
  compositeShaderSource,
  transformShaderSource,
  borderRadiusShaderSource,
  createLayerUniformsBuffer,
  createTransformUniformsBuffer,
  createTransformMatrix,
} from "./shaders";
import { TextureCache, calculateTextureSize } from "./texture-cache";

export class WebGPURenderer implements Renderer {
  readonly type = "webgpu" as const;

  private canvas: OffscreenCanvas;
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private width: number;
  private height: number;
  private _maxTextureCache: number;
  private deviceLostCallbacks: Array<() => void> = [];
  private layers: RenderLayer[] = [];
  private isDeviceLost = false;
  private deviceRecreationInProgress = false;
  private _config: RendererConfig;

  // Double buffering
  private frameBuffers: GPUTexture[] = [];
  private currentFrameBuffer = 0;

  // Pipeline resources
  private compositePipeline: GPURenderPipeline | null = null;
  private transformPipeline: GPURenderPipeline | null = null;
  private borderRadiusPipeline: GPURenderPipeline | null = null;

  // Bind group layouts
  private compositeUniformLayout: GPUBindGroupLayout | null = null;
  private compositeTextureLayout: GPUBindGroupLayout | null = null;
  private transformUniformLayout: GPUBindGroupLayout | null = null;
  private transformTextureLayout: GPUBindGroupLayout | null = null;
  private borderRadiusUniformLayout: GPUBindGroupLayout | null = null;
  private borderRadiusTextureLayout: GPUBindGroupLayout | null = null;

  // Uniform buffers
  private layerUniformBuffer: GPUBuffer | null = null;
  private transformUniformBuffer: GPUBuffer | null = null;
  private borderRadiusUniformBuffer: GPUBuffer | null = null;

  // Sampler for texture sampling
  private textureSampler: GPUSampler | null = null;

  // Effects processor for GPU-accelerated effects
  private effectsProcessor: WebGPUEffectsProcessor | null = null;

  // Re-render tracking for effects changes
  private effectsChangeCallbacks: EffectsChangeCallback[] = [];
  private currentFrameTexture: GPUTexture | null = null;
  private lastRenderTime = 0;

  // Frame cache for decoded video frames
  private frameCache: TextureCache | null = null;
  private frameCacheHits = 0;
  private frameCacheMisses = 0;

  private renderPipelineRef: GPURenderPipeline | null = null;
  private bindGroupLayoutRef: GPUBindGroupLayout | null = null;

  constructor(config: RendererConfig) {
    this._config = config;
    this.width = config.width;
    this.height = config.height;
    this._maxTextureCache = config.maxTextureCache ?? 500 * 1024 * 1024;
    this.canvas = new OffscreenCanvas(config.width, config.height);
    void this.renderPipelineRef;
    void this.bindGroupLayoutRef;
  }

  /** Get the max texture cache size */
  get maxTextureCache(): number {
    return this._maxTextureCache;
  }

  /** Get the renderer config */
  get config(): RendererConfig {
    return this._config;
  }

  async initialize(): Promise<boolean> {
    try {
      if (!navigator.gpu) {
        console.warn("[WebGPURenderer] WebGPU not supported");
        return false;
      }

      // Request adapter; fall back to default preference if high-performance returns null (common on APUs/integrated GPUs on Linux)
      this.adapter =
        (await navigator.gpu.requestAdapter({
          powerPreference: "high-performance",
        })) ?? (await navigator.gpu.requestAdapter());

      if (!this.adapter) {
        console.warn("[WebGPURenderer] No GPU adapter available");
        return false;
      }

      // Request device with required features
      this.device = await this.adapter.requestDevice({
        requiredFeatures: [],
        requiredLimits: {
          maxTextureDimension2D: Math.max(this.width, this.height, 4096),
          maxBindGroups: 4,
          maxSampledTexturesPerShaderStage: 16,
        },
      });
      this.setupDeviceLossHandling();

      // Configure canvas context
      this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;
      if (!this.context) {
        console.warn("[WebGPURenderer] Failed to get WebGPU context");
        return false;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format,
        alphaMode: "premultiplied",
      });
      this.createFrameBuffers();
      this.createBindGroupLayouts();
      this.createUniformBuffers();
      this.createTextureSampler();
      await this.initializePipelines();
      this.effectsProcessor = new WebGPUEffectsProcessor({
        device: this.device,
        width: this.width,
        height: this.height,
      });
      await this.effectsProcessor.initialize();
      this.effectsProcessor.onEffectsChange((clipId, effects) => {
        this.triggerReRender(clipId, effects);
      });
      this.frameCache = new TextureCache({
        maxSize: this._maxTextureCache,
        onEvict: (entry) => {
          console.debug(
            `[WebGPURenderer] Evicted frame cache entry: ${entry.clipId}:${entry.frameTime}`,
          );
        },
      });

      return true;
    } catch (error) {
      console.error("[WebGPURenderer] Initialization failed:", error);
      return false;
    }
  }

  private setupDeviceLossHandling(): void {
    if (!this.device) return;

    this.device.lost.then((info: GPUDeviceLostInfo) => {
      console.warn(
        `[WebGPURenderer] Device lost: ${info.reason}`,
        info.message,
      );
      this.isDeviceLost = true;

      for (const callback of this.deviceLostCallbacks) {
        callback();
      }

      if (!this.deviceRecreationInProgress) {
        this.attemptDeviceRecreation().catch((error) => {
          console.error("[WebGPURenderer] Device recreation failed:", error);
        });
      }
    });
  }

  private async attemptDeviceRecreation(): Promise<void> {
    this.deviceRecreationInProgress = true;

    const maxAttempts = 3;
    const delayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const success = await this.recreateDevice();
      if (success) {
        this.deviceRecreationInProgress = false;
        return;
      }
    }

    console.error(
      "[WebGPURenderer] Failed to recreate device after multiple attempts",
    );
    this.deviceRecreationInProgress = false;
  }

  private createFrameBuffers(): void {
    if (!this.device) return;

    // Clean up existing frame buffers
    for (const buffer of this.frameBuffers) {
      buffer.destroy();
    }
    this.frameBuffers = [];
    for (let i = 0; i < 2; i++) {
      const texture = this.device.createTexture({
        size: { width: this.width, height: this.height },
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });
      this.frameBuffers.push(texture);
    }
  }

  private createBindGroupLayouts(): void {
    if (!this.device) return;

    // Composite shader uniform layout (group 0)
    this.compositeUniformLayout = this.device.createBindGroupLayout({
      label: "Composite Uniform Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    // Composite shader texture layout (group 1)
    this.compositeTextureLayout = this.device.createBindGroupLayout({
      label: "Composite Texture Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });
    this.transformUniformLayout = this.device.createBindGroupLayout({
      label: "Transform Uniform Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.transformTextureLayout = this.compositeTextureLayout;

    // Border radius shader uniform layout (group 0)
    this.borderRadiusUniformLayout = this.device.createBindGroupLayout({
      label: "Border Radius Uniform Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    // Border radius shader texture layout (group 1) - same as composite
    this.borderRadiusTextureLayout = this.compositeTextureLayout;

    // Legacy compatibility
    this.bindGroupLayoutRef = this.compositeUniformLayout;
  }

  private createUniformBuffers(): void {
    if (!this.device) return;

    // Layer uniform buffer for composite shader (32 bytes aligned)
    this.layerUniformBuffer = this.device.createBuffer({
      label: "Layer Uniform Buffer",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.transformUniformBuffer = this.device.createBuffer({
      label: "Transform Uniform Buffer",
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Border radius uniform buffer (80 bytes: 64 for matrix + 16 for params)
    this.borderRadiusUniformBuffer = this.device.createBuffer({
      label: "Border Radius Uniform Buffer",
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private createTextureSampler(): void {
    if (!this.device) return;

    this.textureSampler = this.device.createSampler({
      label: "Texture Sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  private async initializePipelines(): Promise<void> {
    if (!this.device) return;

    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    await this.createCompositePipeline(canvasFormat);
    await this.createTransformPipeline("rgba8unorm");
    await this.createBorderRadiusPipeline("rgba8unorm");

    // Legacy compatibility
    this.renderPipelineRef = this.compositePipeline;
  }

  private async createCompositePipeline(
    format: GPUTextureFormat,
  ): Promise<void> {
    if (
      !this.device ||
      !this.compositeUniformLayout ||
      !this.compositeTextureLayout
    )
      return;

    const shaderModule = this.device.createShaderModule({
      label: "Composite Shader",
      code: compositeShaderSource,
    });

    this.compositePipeline = this.device.createRenderPipeline({
      label: "Composite Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.compositeUniformLayout,
          this.compositeTextureLayout,
        ],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  private async createTransformPipeline(
    format: GPUTextureFormat,
  ): Promise<void> {
    if (
      !this.device ||
      !this.transformUniformLayout ||
      !this.transformTextureLayout
    )
      return;

    const shaderModule = this.device.createShaderModule({
      label: "Transform Shader",
      code: transformShaderSource,
    });

    this.transformPipeline = this.device.createRenderPipeline({
      label: "Transform Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.transformUniformLayout,
          this.transformTextureLayout,
        ],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  private async createBorderRadiusPipeline(
    format: GPUTextureFormat,
  ): Promise<void> {
    if (
      !this.device ||
      !this.borderRadiusUniformLayout ||
      !this.borderRadiusTextureLayout
    )
      return;

    const shaderModule = this.device.createShaderModule({
      label: "Border Radius Shader",
      code: borderRadiusShaderSource,
    });

    this.borderRadiusPipeline = this.device.createRenderPipeline({
      label: "Border Radius Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.borderRadiusUniformLayout,
          this.borderRadiusTextureLayout,
        ],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }

  destroy(): void {
    // Destroy effects processor
    if (this.effectsProcessor) {
      this.effectsProcessor.dispose();
      this.effectsProcessor = null;
    }
    if (this.frameCache) {
      this.frameCache.clear();
      this.frameCache = null;
    }

    // Destroy frame buffers
    for (const buffer of this.frameBuffers) {
      buffer.destroy();
    }
    this.frameBuffers = [];

    // Destroy current frame texture
    if (this.currentFrameTexture) {
      this.currentFrameTexture.destroy();
      this.currentFrameTexture = null;
    }

    // Destroy uniform buffers
    this.layerUniformBuffer?.destroy();
    this.transformUniformBuffer?.destroy();
    this.borderRadiusUniformBuffer?.destroy();
    this.layerUniformBuffer = null;
    this.transformUniformBuffer = null;
    this.borderRadiusUniformBuffer = null;
    this.compositePipeline = null;
    this.transformPipeline = null;
    this.borderRadiusPipeline = null;
    this.renderPipelineRef = null;
    this.compositeUniformLayout = null;
    this.compositeTextureLayout = null;
    this.transformUniformLayout = null;
    this.transformTextureLayout = null;
    this.borderRadiusUniformLayout = null;
    this.borderRadiusTextureLayout = null;
    this.bindGroupLayoutRef = null;
    this.textureSampler = null;

    // Destroy device
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }

    this.adapter = null;
    this.context = null;
    this.deviceLostCallbacks = [];
    this.effectsChangeCallbacks = [];
    this.layers = [];
    this.frameCacheHits = 0;
    this.frameCacheMisses = 0;
  }

  beginFrame(): void {
    if (!this.device || this.isDeviceLost) return;

    this.layers = [];
    // Swap frame buffers for double-buffering
    this.currentFrameBuffer = 1 - this.currentFrameBuffer;
  }

  renderLayer(layer: RenderLayer): void {
    this.layers.push(layer);
  }

  async endFrame(): Promise<ImageBitmap> {
    if (!this.device || !this.context || this.isDeviceLost) {
      throw new Error("WebGPU device not available");
    }

    const startTime = performance.now();
    const currentTexture = this.context.getCurrentTexture();
    const commandEncoder = this.device.createCommandEncoder({
      label: "Frame Command Encoder",
    });

    // First pass: render to frame buffer (for double-buffering)
    const frameBuffer = this.frameBuffers[this.currentFrameBuffer];
    const frameRenderPass = commandEncoder.beginRenderPass({
      label: "Frame Buffer Render Pass",
      colorAttachments: [
        {
          view: frameBuffer.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    this.renderLayersToPass(frameRenderPass);
    frameRenderPass.end();

    // Second pass: copy frame buffer to swap chain texture
    const presentRenderPass = commandEncoder.beginRenderPass({
      label: "Present Render Pass",
      colorAttachments: [
        {
          view: currentTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    this.renderFrameBufferToScreen(presentRenderPass);
    presentRenderPass.end();

    // Submit commands and wait for completion
    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);

    // Use mapAsync to ensure GPU work is done
    // Create a staging buffer to read back the frame from the frame buffer (not swap chain)
    const bytesPerRow = Math.ceil((this.width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyTextureToBuffer(
      { texture: frameBuffer },
      { buffer, bytesPerRow },
      { width: this.width, height: this.height },
    );
    this.device.queue.submit([copyEncoder.finish()]);

    await buffer.mapAsync(1); // GPUMapMode.READ = 1
    const arrayBuffer = buffer.getMappedRange();
    const srcData = new Uint8ClampedArray(arrayBuffer);

    // Copy data accounting for potential padding in bytesPerRow
    const dstData = new Uint8ClampedArray(this.width * this.height * 4);
    const srcBytesPerRow = bytesPerRow;
    const dstBytesPerRow = this.width * 4;

    for (let y = 0; y < this.height; y++) {
      const srcOffset = y * srcBytesPerRow;
      const dstOffset = y * dstBytesPerRow;
      dstData.set(
        srcData.subarray(srcOffset, srcOffset + dstBytesPerRow),
        dstOffset,
      );
    }

    buffer.unmap();
    buffer.destroy();

    const imageData = new ImageData(dstData, this.width, this.height);
    this.lastRenderTime = performance.now() - startTime;

    return createImageBitmap(imageData, {
      premultiplyAlpha: "premultiply",
    });
  }

  private renderLayersToPass(renderPass: GPURenderPassEncoder): void {
    if (!this.device || !this.textureSampler) return;

    for (const layer of this.layers) {
      // Skip if texture is not a GPUTexture
      if (!layer.texture || !("createView" in layer.texture)) {
        continue;
      }

      const gpuTexture = layer.texture as GPUTexture;
      const hasBorderRadius = layer.borderRadius > 0;
      let processedTexture = gpuTexture;
      if (layer.effects.length > 0 && this.effectsProcessor) {
        processedTexture = this.effectsProcessor.processEffects(
          gpuTexture,
          layer.effects,
        );
      }

      // Choose pipeline based on whether border radius is needed
      if (hasBorderRadius && this.borderRadiusPipeline) {
        this.renderLayerWithBorderRadius(renderPass, processedTexture, layer);
      } else if (this.transformPipeline) {
        this.renderLayerWithTransform(renderPass, processedTexture, layer);
      }
    }
  }

  private renderLayerWithTransform(
    renderPass: GPURenderPassEncoder,
    texture: GPUTexture,
    layer: RenderLayer,
  ): void {
    if (
      !this.device ||
      !this.transformPipeline ||
      !this.transformUniformBuffer ||
      !this.transformUniformLayout ||
      !this.transformTextureLayout ||
      !this.textureSampler
    ) {
      return;
    }
    const matrix = createTransformMatrix(
      layer.transform.position,
      layer.transform.scale,
      layer.transform.rotation,
      layer.transform.anchor,
      this.width,
      this.height,
    );
    const uniformData = createTransformUniformsBuffer(
      matrix,
      layer.opacity * layer.transform.opacity,
      layer.borderRadius,
      layer.transform.crop,
    );
    this.device.queue.writeBuffer(
      this.transformUniformBuffer,
      0,
      uniformData.buffer as ArrayBuffer,
    );
    const uniformBindGroup = this.device.createBindGroup({
      label: "Transform Uniform Bind Group",
      layout: this.transformUniformLayout,
      entries: [
        { binding: 0, resource: { buffer: this.transformUniformBuffer } },
      ],
    });

    const textureBindGroup = this.device.createBindGroup({
      label: "Transform Texture Bind Group",
      layout: this.transformTextureLayout,
      entries: [
        { binding: 0, resource: this.textureSampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
    renderPass.setPipeline(this.transformPipeline);
    renderPass.setBindGroup(0, uniformBindGroup);
    renderPass.setBindGroup(1, textureBindGroup);

    // Draw quad (6 vertices for 2 triangles)
    renderPass.draw(6);
  }

  private renderLayerWithBorderRadius(
    renderPass: GPURenderPassEncoder,
    texture: GPUTexture,
    layer: RenderLayer,
  ): void {
    if (
      !this.device ||
      !this.borderRadiusPipeline ||
      !this.borderRadiusUniformBuffer ||
      !this.borderRadiusUniformLayout ||
      !this.borderRadiusTextureLayout ||
      !this.textureSampler
    ) {
      return;
    }
    const matrix = createTransformMatrix(
      layer.transform.position,
      layer.transform.scale,
      layer.transform.rotation,
      layer.transform.anchor,
      this.width,
      this.height,
    );
    const normalizedRadius = Math.min(layer.borderRadius / 100, 0.5);
    const uniformData = new Float32Array(20);
    uniformData.set(matrix, 0);
    uniformData[16] = layer.opacity * layer.transform.opacity;
    uniformData[17] = normalizedRadius;
    uniformData[18] = this.width / this.height; // aspect ratio
    uniformData[19] = 0.01; // smoothness for anti-aliasing

    this.device.queue.writeBuffer(
      this.borderRadiusUniformBuffer,
      0,
      uniformData.buffer as ArrayBuffer,
    );
    const uniformBindGroup = this.device.createBindGroup({
      label: "Border Radius Uniform Bind Group",
      layout: this.borderRadiusUniformLayout,
      entries: [
        { binding: 0, resource: { buffer: this.borderRadiusUniformBuffer } },
      ],
    });

    const textureBindGroup = this.device.createBindGroup({
      label: "Border Radius Texture Bind Group",
      layout: this.borderRadiusTextureLayout,
      entries: [
        { binding: 0, resource: this.textureSampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
    renderPass.setPipeline(this.borderRadiusPipeline);
    renderPass.setBindGroup(0, uniformBindGroup);
    renderPass.setBindGroup(1, textureBindGroup);

    // Draw quad (6 vertices for 2 triangles)
    renderPass.draw(6);
  }

  private renderFrameBufferToScreen(renderPass: GPURenderPassEncoder): void {
    if (
      !this.device ||
      !this.compositePipeline ||
      !this.layerUniformBuffer ||
      !this.compositeUniformLayout ||
      !this.compositeTextureLayout ||
      !this.textureSampler
    ) {
      return;
    }

    const frameBuffer = this.frameBuffers[this.currentFrameBuffer];
    const uniformData = createLayerUniformsBuffer(1.0);
    this.device.queue.writeBuffer(
      this.layerUniformBuffer,
      0,
      uniformData.buffer as ArrayBuffer,
    );
    const uniformBindGroup = this.device.createBindGroup({
      label: "Composite Uniform Bind Group",
      layout: this.compositeUniformLayout,
      entries: [{ binding: 0, resource: { buffer: this.layerUniformBuffer } }],
    });

    const textureBindGroup = this.device.createBindGroup({
      label: "Composite Texture Bind Group",
      layout: this.compositeTextureLayout,
      entries: [
        { binding: 0, resource: this.textureSampler },
        { binding: 1, resource: frameBuffer.createView() },
      ],
    });
    renderPass.setPipeline(this.compositePipeline);
    renderPass.setBindGroup(0, uniformBindGroup);
    renderPass.setBindGroup(1, textureBindGroup);

    // Draw full-screen triangle (3 vertices)
    renderPass.draw(3);
  }

  createTextureFromImage(image: ImageBitmap): GPUTexture {
    if (!this.device) {
      throw new Error("WebGPU device not initialized");
    }

    const texture = this.device.createTexture({
      size: { width: image.width, height: image.height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Copy image to texture using copyExternalImageToTexture
    this.device.queue.copyExternalImageToTexture(
      { source: image },
      { texture },
      { width: image.width, height: image.height },
    );

    return texture;
  }

  releaseTexture(texture: GPUTexture | WebGLTexture): void {
    if (texture && "destroy" in texture) {
      (texture as GPUTexture).destroy();
    }
  }

  applyEffects(
    texture: GPUTexture | ImageBitmap,
    effects: Effect[],
  ): GPUTexture | ImageBitmap {
    if (
      !this.effectsProcessor ||
      !texture ||
      !("destroy" in texture && "createView" in texture)
    ) {
      return texture;
    }

    return this.effectsProcessor.processEffects(texture as GPUTexture, effects);
  }

  notifyEffectsChanged(clipId: string, effects: Effect[]): void {
    if (this.effectsProcessor) {
      this.effectsProcessor.notifyEffectsChanged(clipId, effects);
    }
  }

  onEffectsReRender(callback: EffectsChangeCallback): void {
    this.effectsChangeCallbacks.push(callback);
  }

  private triggerReRender(clipId: string, effects: Effect[]): void {
    const startTime = performance.now();

    // Notify all registered callbacks
    for (const callback of this.effectsChangeCallbacks) {
      callback(clipId, effects);
    }

    this.lastRenderTime = performance.now() - startTime;

    // Log if re-render exceeds 100ms target
    if (this.lastRenderTime > 100) {
      console.warn(
        `[WebGPURenderer] Re-render took ${this.lastRenderTime.toFixed(
          2,
        )}ms, exceeds 100ms target`,
      );
    }
  }

  getLastRenderTime(): number {
    return this.lastRenderTime;
  }

  getEffectsProcessingTime(): number {
    return this.effectsProcessor?.getLastProcessingTime() ?? 0;
  }

  onDeviceLost(callback: () => void): void {
    this.deviceLostCallbacks.push(callback);
  }

  async recreateDevice(): Promise<boolean> {
    this.isDeviceLost = false;
    this.destroy();
    return this.initialize();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    if (this.context && this.device) {
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format,
        alphaMode: "premultiplied",
      });

      this.createFrameBuffers();

      // Resize effects processor
      if (this.effectsProcessor) {
        this.effectsProcessor.resize(width, height);
      }
    }
  }

  getMemoryUsage(): number {
    // Approximate memory usage based on frame buffers and textures
    const frameBufferSize = this.width * this.height * 4 * 2; // 2 frame buffers, RGBA
    return frameBufferSize;
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }

  isLost(): boolean {
    return this.isDeviceLost;
  }

  getCachedFrame(clipId: string, frameTime: number): GPUTexture | null {
    if (!this.frameCache) return null;

    const texture = this.frameCache.get(clipId, frameTime);
    if (texture) {
      this.frameCacheHits++;
      return texture;
    }

    this.frameCacheMisses++;
    return null;
  }

  cacheFrame(
    clipId: string,
    frameTime: number,
    image: ImageBitmap,
  ): GPUTexture {
    if (!this.device) {
      throw new Error("WebGPU device not initialized");
    }
    const existing = this.getCachedFrame(clipId, frameTime);
    if (existing) {
      return existing;
    }
    const texture = this.createTextureFromImage(image);
    const size = calculateTextureSize(image.width, image.height, "rgba8unorm");
    if (this.frameCache) {
      this.frameCache.set(clipId, frameTime, texture, size);
    }

    return texture;
  }

  hasFrameCached(clipId: string, frameTime: number): boolean {
    return this.frameCache?.has(clipId, frameTime) ?? false;
  }

  evictClipFrames(clipId: string): void {
    this.frameCache?.evict(clipId);
  }

  getFrameCacheStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    memoryUsage: number;
    maxSize: number;
    entryCount: number;
  } {
    const total = this.frameCacheHits + this.frameCacheMisses;
    return {
      hits: this.frameCacheHits,
      misses: this.frameCacheMisses,
      hitRate: total > 0 ? this.frameCacheHits / total : 0,
      memoryUsage: this.frameCache?.getMemoryUsage() ?? 0,
      maxSize: this.frameCache?.getMaxSize() ?? 0,
      entryCount: this.frameCache?.getCount() ?? 0,
    };
  }

  clearFrameCache(): void {
    this.frameCache?.clear();
    this.frameCacheHits = 0;
    this.frameCacheMisses = 0;
  }

  getRenderPipeline(): GPURenderPipeline | null {
    return this.compositePipeline;
  }

  getTransformPipeline(): GPURenderPipeline | null {
    return this.transformPipeline;
  }

  getBorderRadiusPipeline(): GPURenderPipeline | null {
    return this.borderRadiusPipeline;
  }

  arePipelinesInitialized(): boolean {
    return (
      this.compositePipeline !== null &&
      this.transformPipeline !== null &&
      this.borderRadiusPipeline !== null
    );
  }
}
