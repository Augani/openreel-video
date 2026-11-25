/**
 * AudioWorklet entry for the creative / utility effects. Loaded lazily (only when a project or a live rack uses one)
 * into each AudioContext / OfflineAudioContext through `ensureCreativeFxWorklet` (creative-fx-node.ts). Parameters are
 * exposed as k-rate AudioParams `p0`..`p6` (definition order) plus the timeline clock `p7`, so the rack's keyframe automation drives them exactly
 * as it drives a native node, live and in the offline render.
 */
import { CREATIVE_FX_CLOCK_SLOT, CREATIVE_FX_DEFINITIONS, CREATIVE_FX_MAX_PARAMS, isCreativeFxType } from "./creative-fx-definitions";
import { createCreativeProcessor, type CreativeParams, type CreativeProcessor } from "./creative-fx-dsp";

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: never) => AudioWorkletProcessor): void;

interface Options {
  readonly processorOptions?: { type?: string; params?: CreativeParams };
}

class OpenReelCreativeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return Array.from({ length: CREATIVE_FX_MAX_PARAMS + 1 }, (_, i) => ({
      name: `p${i}`,
      defaultValue: 0,
      minValue: -1e6,
      maxValue: 1e6,
      automationRate: "k-rate" as const,
    }));
  }

  private processor: CreativeProcessor | null = null;
  private slots = 0;
  private disposed = false;
  private readonly values: number[] = new Array(CREATIVE_FX_MAX_PARAMS).fill(0);

  constructor(options?: Options) {
    super(options);
    const type = options?.processorOptions?.type;
    if (isCreativeFxType(type)) {
      this.processor = createCreativeProcessor(type, sampleRate, options?.processorOptions?.params ?? {});
      this.slots = CREATIVE_FX_DEFINITIONS[type].params.length;
    }
    this.port.onmessage = (event: MessageEvent) => {
      if ((event.data as { dispose?: boolean } | undefined)?.dispose) this.disposed = true;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (this.disposed) return false;
    const output = outputs[0];
    const input = inputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0].length;
    if (!this.processor) {
      for (let c = 0; c < output.length; c += 1) output[c].set(input?.[c] ?? input?.[0] ?? new Float32Array(frames));
      return true;
    }
    for (let i = 0; i < this.slots; i += 1) this.values[i] = parameters[`p${i}`]?.[0] ?? 0;
    this.processor.setValues(this.values);
    this.processor.setClock(currentTime, parameters[`p${CREATIVE_FX_CLOCK_SLOT}`]?.[0] ?? 0);
    const ins = output.map((_, c) => input?.[c] ?? input?.[0] ?? new Float32Array(frames));
    this.processor.process(ins, output, frames);
    return true;
  }
}

registerProcessor("openreel-creative-fx", OpenReelCreativeProcessor as never);
