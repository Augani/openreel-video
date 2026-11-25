/**
 * AudioWorklet entry for the repair effects. Loaded once per AudioContext /
 * OfflineAudioContext through `ensureRepairWorklet` (repair-node.ts); every
 * node runs the same sample-streaming processors the unit tests exercise.
 */
import { createRepairProcessor, isDspProcessorType, type RepairParams, type RepairProcessor } from "./repair-dsp";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: never) => AudioWorkletProcessor): void;

interface Options {
  readonly processorOptions?: { type?: string; params?: RepairParams; useParams?: boolean };
}

const METER_INTERVAL_FRAMES = 2048;

/** Keyed (sidechain) compressors read their dynamics settings from these AudioParams (p0..p5) so rack automation reaches them. */
const PARAM_KEYS = ["threshold", "ratio", "attack", "release", "knee", "makeupGain"] as const;

class OpenReelRepairProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAM_KEYS.map((_, i) => ({ name: `p${i}`, defaultValue: 0, minValue: -1e6, maxValue: 1e6, automationRate: "k-rate" as const }));
  }

  private useParams = false;
  private staticParams: RepairParams = {};
  private processor: RepairProcessor | null = null;
  private disposed = false;
  private framesSinceMeter = 0;
  private lastMeter = 0;
  private readonly silent = new Float32Array(128);

  constructor(options?: Options) {
    super(options);
    const type = options?.processorOptions?.type;
    this.useParams = options?.processorOptions?.useParams === true;
    this.staticParams = options?.processorOptions?.params ?? {};
    if (isDspProcessorType(type)) {
      this.processor = createRepairProcessor(type, sampleRate, options?.processorOptions?.params ?? {});
    }
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { params?: RepairParams; dispose?: boolean } | undefined;
      if (data?.dispose) this.disposed = true;
      else if (data?.params && this.processor) {
        this.staticParams = data.params;
        this.processor.setParams(data.params);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (this.disposed) return false;
    const output = outputs[0];
    const input = inputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0].length;
    const ins = output.map((_, c) => input?.[c] ?? input?.[0] ?? this.silent.subarray(0, frames));
    if (!this.processor) {
      for (let c = 0; c < output.length; c += 1) output[c].set(ins[c]);
      return true;
    }
    if (this.useParams) {
      const merged: Record<string, number | string | boolean> = { ...this.staticParams };
      PARAM_KEYS.forEach((key, i) => {
        const value = parameters[`p${i}`]?.[0];
        if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
      });
      this.processor.setParams(merged);
    }
    this.processor.process(ins, output, frames, inputs[1]);
    this.framesSinceMeter += frames;
    if (this.framesSinceMeter >= METER_INTERVAL_FRAMES) {
      this.framesSinceMeter = 0;
      const meter = this.processor.meter;
      if (Math.abs(meter - this.lastMeter) > 0.1) {
        this.lastMeter = meter;
        this.port.postMessage({ meter });
      }
    }
    return true;
  }
}

registerProcessor("openreel-repair", OpenReelRepairProcessor as never);
