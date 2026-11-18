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
  readonly processorOptions?: { type?: string; params?: RepairParams };
}

const METER_INTERVAL_FRAMES = 2048;

class OpenReelRepairProcessor extends AudioWorkletProcessor {
  private processor: RepairProcessor | null = null;
  private disposed = false;
  private framesSinceMeter = 0;
  private lastMeter = 0;
  private readonly silent = new Float32Array(128);

  constructor(options?: Options) {
    super(options);
    const type = options?.processorOptions?.type;
    if (isDspProcessorType(type)) {
      this.processor = createRepairProcessor(type, sampleRate, options?.processorOptions?.params ?? {});
    }
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { params?: RepairParams; dispose?: boolean } | undefined;
      if (data?.dispose) this.disposed = true;
      else if (data?.params && this.processor) this.processor.setParams(data.params);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
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
    this.processor.process(ins, output, frames);
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
