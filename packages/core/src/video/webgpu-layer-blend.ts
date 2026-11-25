import type { Effect } from "../types/timeline";
import { buildMotionBlendWgsl, motionBlendIndex } from "../motion/motion-gpu-blend";
import { isBlendMode } from "./blend-reference";
import type { BlendMode } from "./types";

/**
 * Layer blend for the WebGPU renderer. A layer's blend mode needs the backdrop, which a per-layer effect chain never
 * sees, so the renderer composites such a layer in its own pass: the frame so far is copied aside, the layer is drawn
 * alone onto a transparent texture, and this pass writes `blend(backdrop, layer)` back with the SAME WGSL blend functions
 * the motion compositor and the CPU reference (blend-reference.ts) use. A `blend` effect (the marker the compositor and
 * the fallback renderer understand) resolves to the layer's mode through {@link resolveLayerBlendMode}.
 */

/** The layer's blend mode: an explicit mode, else the enabled `blend` effect's `mode` param, else normal. */
export function resolveLayerBlendMode(layer: {
  readonly blendMode?: BlendMode;
  readonly effects: readonly Pick<Effect, "type" | "enabled" | "params">[];
}): BlendMode {
  if (layer.blendMode && layer.blendMode !== "normal") return layer.blendMode;
  const effect = layer.effects.find((candidate) => candidate.enabled && candidate.type === "blend");
  const mode = effect?.params?.mode;
  return isBlendMode(mode) ? mode : "normal";
}

/** Effects the processor runs: the `blend` marker is the renderer's job (it needs the backdrop). */
export function withoutBlendEffects<T extends Pick<Effect, "type">>(effects: readonly T[]): T[] {
  return effects.filter((effect) => effect.type !== "blend");
}

/** Frame buffers hold premultiplied colour (src-alpha blending onto a cleared target): unpremultiply, blend, premultiply. */
export function buildLayerBlendShader(): string {
  return `${buildMotionBlendWgsl()}
struct VSOut {
  @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VSOut {
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var out: VSOut;
  out.pos = vec4<f32>(corners[idx], 0.0, 1.0);
  return out;
}

struct BlendParams {
  mode: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};

@group(0) @binding(0) var backdropTex: texture_2d<f32>;
@group(0) @binding(1) var layerTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlendParams;

fn straight(c: vec4<f32>) -> vec4<f32> {
  if (c.a <= 0.0) { return vec4<f32>(0.0); }
  return vec4<f32>(clamp(c.rgb / c.a, vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(i32(in.pos.x), i32(in.pos.y));
  let backdrop = straight(textureLoad(backdropTex, px, 0));
  let layer = straight(textureLoad(layerTex, px, 0));
  let out = motionComposite(backdrop, layer, params.mode, vec2<u32>(u32(in.pos.x), u32(in.pos.y)));
  return vec4<f32>(out.rgb * out.a, out.a);
}
`;
}

const FORMAT: GPUTextureFormat = "rgba8unorm";

export class WebGPULayerBlender {
  private readonly pipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private transientParams: GPUBuffer[] = [];
  private backdrop: GPUTexture | null = null;
  private layer: GPUTexture | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly device: GPUDevice) {
    this.layout = device.createBindGroupLayout({
      label: "Layer Blend Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const module = device.createShaderModule({ label: "Layer Blend Shader", code: buildLayerBlendShader() });
    this.pipeline = device.createRenderPipeline({
      label: "Layer Blend Pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
  }

  private ensureTextures(width: number, height: number): void {
    if (this.backdrop && this.layer && this.width === width && this.height === height) return;
    this.backdrop?.destroy();
    this.layer?.destroy();
    this.width = width;
    this.height = height;
    this.backdrop = this.device.createTexture({
      label: "Layer Blend Backdrop",
      size: { width, height },
      format: FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.layer = this.device.createTexture({
      label: "Layer Blend Layer",
      size: { width, height },
      format: FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Composites one layer with `mode` into `frameBuffer`. `drawLayer` draws the layer (transform, opacity, effects) alone
   * into the pass it is given. No render pass of `encoder` may be open.
   */
  composite(
    encoder: GPUCommandEncoder,
    frameBuffer: GPUTexture,
    mode: BlendMode,
    drawLayer: (pass: GPURenderPassEncoder) => void,
  ): void {
    this.ensureTextures(frameBuffer.width, frameBuffer.height);
    const backdrop = this.backdrop!;
    const layer = this.layer!;
    encoder.copyTextureToTexture({ texture: frameBuffer }, { texture: backdrop }, { width: this.width, height: this.height });

    const layerPass = encoder.beginRenderPass({
      label: "Layer Blend: layer",
      colorAttachments: [{ view: layer.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    drawLayer(layerPass);
    layerPass.end();

    // One uniform buffer per blended layer: writes land before the frame's submit, so a shared buffer would give every layer the last mode.
    const params = this.device.createBuffer({
      label: "Layer Blend Params",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([motionBlendIndex(mode), 0, 0, 0]));
    this.transientParams.push(params);
    const bindGroup = this.device.createBindGroup({
      label: "Layer Blend Bind Group",
      layout: this.layout,
      entries: [
        { binding: 0, resource: backdrop.createView() },
        { binding: 1, resource: layer.createView() },
        { binding: 2, resource: { buffer: params } },
      ],
    });
    // Every pixel is rewritten from backdrop + layer, so the target is cleared first.
    const blendPass = encoder.beginRenderPass({
      label: "Layer Blend: composite",
      colorAttachments: [{ view: frameBuffer.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    blendPass.setPipeline(this.pipeline);
    blendPass.setBindGroup(0, bindGroup);
    blendPass.draw(3);
    blendPass.end();
  }

  /** Call after the frame's commands were submitted: frees the per-layer uniform buffers. */
  endFrame(): void {
    for (const buffer of this.transientParams) buffer.destroy();
    this.transientParams = [];
  }

  destroy(): void {
    this.endFrame();
    this.backdrop?.destroy();
    this.layer?.destroy();
    this.backdrop = null;
    this.layer = null;
  }
}
