type WasmBeatDetectionExports = {
  computeRMSEnergies(
    samples: Float32Array,
    windowSize: number,
    hopSize: number,
    energies: Float32Array,
  ): void;
  smoothArray(
    input: Float32Array,
    output: Float32Array,
    windowSize: number,
  ): void;
  calculateMedian(arr: Float32Array): number;
  findPeaks(
    energies: Float32Array,
    threshold: number,
    minDistance: number,
    peaks: Int32Array,
  ): number;
  calculateMean(arr: Float32Array): number;
  calculateStdDev(arr: Float32Array, mean: number): number;
  allocateF32(length: number): Float32Array;
  allocateI32(length: number): Int32Array;
  memory: WebAssembly.Memory;
};

let wasmModule: WasmBeatDetectionExports | null = null;
let loadPromise: Promise<WasmBeatDetectionExports | null> | null = null;

async function loadWasmModule(): Promise<WasmBeatDetectionExports | null> {
  if (typeof WebAssembly === "undefined") {
    return null;
  }

  try {
    const wasmUrl = new URL("./build/beat.wasm", import.meta.url);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      return null;
    }

    const wasmBytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
      },
    });

    return instance.exports as unknown as WasmBeatDetectionExports;
  } catch {
    return null;
  }
}

export async function initWasmBeatDetection(): Promise<boolean> {
  if (wasmModule) {
    return true;
  }

  if (!loadPromise) {
    loadPromise = loadWasmModule();
  }

  wasmModule = await loadPromise;
  return wasmModule !== null;
}

function jsComputeRMSEnergies(
  samples: Float32Array,
  windowSize: number,
  hopSize: number,
  energies: Float32Array,
): void {
  const numSamples = samples.length;
  const numFrames = energies.length;
  const invWindow = 1.0 / windowSize;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    let sum = 0.0;

    for (let i = 0; i < windowSize && start + i < numSamples; i++) {
      const s = samples[start + i];
      sum += s * s;
    }

    energies[frame] = Math.sqrt(sum * invWindow);
  }
}

function jsSmoothArray(
  input: Float32Array,
  output: Float32Array,
  windowSize: number,
): void {
  const len = input.length;
  const halfWindow = windowSize >> 1;
  const invWindow = 1.0 / windowSize;

  for (let i = 0; i < len; i++) {
    let sum = 0.0;
    const start = i - halfWindow;
    const end = i + halfWindow + 1;

    for (let j = start; j < end; j++) {
      const idx = Math.max(0, Math.min(len - 1, j));
      sum += input[idx];
    }

    output[i] = sum * invWindow;
  }
}

function jsCalculateMedian(arr: Float32Array): number {
  if (arr.length === 0) return 0;

  const sorted = Float32Array.from(arr).sort((a, b) => a - b);
  const mid = arr.length >> 1;

  if ((arr.length & 1) === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function jsFindPeaks(
  energies: Float32Array,
  threshold: number,
  minDistance: number,
  peaks: Int32Array,
): number {
  const len = energies.length;
  let peakCount = 0;
  let lastPeak = -minDistance;

  for (let i = 1; i < len - 1; i++) {
    const curr = energies[i];
    const prev = energies[i - 1];
    const next = energies[i + 1];

    if (curr > prev && curr > next && curr > threshold) {
      if (i - lastPeak >= minDistance) {
        if (peakCount < peaks.length) {
          peaks[peakCount] = i;
          peakCount++;
          lastPeak = i;
        }
      }
    }
  }

  return peakCount;
}

function jsCalculateMean(arr: Float32Array): number {
  if (arr.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}

function jsCalculateStdDev(arr: Float32Array, mean: number): number {
  if (arr.length === 0) return 0;

  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const diff = arr[i] - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / arr.length);
}

export class BeatDetectionProcessor {
  private useWasm: boolean;

  constructor() {
    this.useWasm = wasmModule !== null;
  }

  async ensureWasm(): Promise<boolean> {
    if (this.useWasm) {
      return true;
    }

    const available = await initWasmBeatDetection();
    if (available) {
      this.useWasm = true;
    }
    return this.useWasm;
  }

  computeRMSEnergies(
    samples: Float32Array,
    windowSize: number,
    hopSize: number,
    energies: Float32Array,
  ): void {
    if (this.useWasm && wasmModule) {
      wasmModule.computeRMSEnergies(samples, windowSize, hopSize, energies);
    } else {
      jsComputeRMSEnergies(samples, windowSize, hopSize, energies);
    }
  }

  smoothArray(
    input: Float32Array,
    output: Float32Array,
    windowSize: number,
  ): void {
    if (this.useWasm && wasmModule) {
      wasmModule.smoothArray(input, output, windowSize);
    } else {
      jsSmoothArray(input, output, windowSize);
    }
  }

  calculateMedian(arr: Float32Array): number {
    if (this.useWasm && wasmModule) {
      return wasmModule.calculateMedian(arr);
    }
    return jsCalculateMedian(arr);
  }

  findPeaks(
    energies: Float32Array,
    threshold: number,
    minDistance: number,
    peaks: Int32Array,
  ): number {
    if (this.useWasm && wasmModule) {
      return wasmModule.findPeaks(energies, threshold, minDistance, peaks);
    }
    return jsFindPeaks(energies, threshold, minDistance, peaks);
  }

  calculateMean(arr: Float32Array): number {
    if (this.useWasm && wasmModule) {
      return wasmModule.calculateMean(arr);
    }
    return jsCalculateMean(arr);
  }

  calculateStdDev(arr: Float32Array, mean: number): number {
    if (this.useWasm && wasmModule) {
      return wasmModule.calculateStdDev(arr, mean);
    }
    return jsCalculateStdDev(arr, mean);
  }
}

let cachedProcessor: BeatDetectionProcessor | null = null;

export function getBeatDetectionProcessor(): BeatDetectionProcessor {
  if (!cachedProcessor) {
    cachedProcessor = new BeatDetectionProcessor();
  }
  return cachedProcessor;
}
