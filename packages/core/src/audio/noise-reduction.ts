import { FFT } from "./fft";
import { WasmFFT, getWasmFFT, initWasmFFT } from "../wasm/fft";

export interface NoiseProfile {
  readonly frequencyBins: Float32Array;
  readonly magnitudes: Float32Array;
  readonly standardDeviations: Float32Array;
  readonly sampleRate: number;
  readonly fftSize: number;
}

export interface NoiseReductionConfig {
  threshold: number;
  reduction: number;
  attack: number;
  release: number;
  smoothing: number;
}

export const DEFAULT_NOISE_REDUCTION_CONFIG: NoiseReductionConfig = {
  threshold: -40,
  reduction: 0.5,
  attack: 10,
  release: 100,
  smoothing: 0.5,
};

export class SpectralNoiseReducer {
  private config: NoiseReductionConfig;
  private noiseProfile: NoiseProfile | null = null;
  private fftSize: number;
  private hopSize: number;
  private fft: FFT | WasmFFT;
  private wasmInitialized: boolean = false;

  constructor(config: Partial<NoiseReductionConfig> = {}) {
    this.config = { ...DEFAULT_NOISE_REDUCTION_CONFIG, ...config };
    this.fftSize = 2048;
    this.hopSize = this.fftSize / 4;
    this.fft = getWasmFFT(this.fftSize);
    this.initWasm();
  }

  private async initWasm(): Promise<void> {
    if (this.wasmInitialized) return;
    try {
      await initWasmFFT();
      if (this.fft instanceof WasmFFT) {
        await this.fft.ensureWasm();
      }
      this.wasmInitialized = true;
    } catch {
      this.wasmInitialized = false;
    }
  }

  learnNoiseProfile(noiseBuffer: AudioBuffer): NoiseProfile {
    const channelData = noiseBuffer.getChannelData(0);
    const sampleRate = noiseBuffer.sampleRate;
    const numFrames =
      Math.floor((channelData.length - this.fftSize) / this.hopSize) + 1;

    if (numFrames < 1) {
      throw new Error("Noise sample too short for analysis");
    }

    const halfFFT = this.fftSize / 2;
    const magnitudeSum = new Float32Array(halfFFT);
    const magnitudeSumSq = new Float32Array(halfFFT);

    // Analyze each frame
    for (let frame = 0; frame < numFrames; frame++) {
      const start = frame * this.hopSize;
      const frameData = this.extractFrame(channelData, start);
      const magnitudes = this.computeMagnitudeSpectrum(frameData);

      for (let i = 0; i < halfFFT; i++) {
        magnitudeSum[i] += magnitudes[i];
        magnitudeSumSq[i] += magnitudes[i] * magnitudes[i];
      }
    }
    const meanMagnitudes = new Float32Array(halfFFT);
    const stdMagnitudes = new Float32Array(halfFFT);

    for (let i = 0; i < halfFFT; i++) {
      meanMagnitudes[i] = magnitudeSum[i] / numFrames;
      const variance =
        magnitudeSumSq[i] / numFrames - meanMagnitudes[i] * meanMagnitudes[i];
      stdMagnitudes[i] = Math.sqrt(Math.max(0, variance));
    }
    const frequencyBins = new Float32Array(halfFFT);
    const binWidth = sampleRate / this.fftSize;
    for (let i = 0; i < halfFFT; i++) {
      frequencyBins[i] = i * binWidth;
    }

    this.noiseProfile = {
      frequencyBins,
      magnitudes: meanMagnitudes,
      standardDeviations: stdMagnitudes,
      sampleRate,
      fftSize: this.fftSize,
    };

    return this.noiseProfile;
  }

  getNoiseProfile(): NoiseProfile | null {
    return this.noiseProfile;
  }

  setNoiseProfile(profile: NoiseProfile): void {
    this.noiseProfile = profile;
    if (this.fftSize !== profile.fftSize) {
      this.fftSize = profile.fftSize;
      this.hopSize = this.fftSize / 4;
      this.fft = getWasmFFT(this.fftSize);
      this.initWasm();
    }
  }

  async processBuffer(
    inputBuffer: AudioBuffer,
    context: BaseAudioContext,
  ): Promise<AudioBuffer> {
    if (!this.noiseProfile) {
      throw new Error("No noise profile set. Call learnNoiseProfile() first.");
    }

    const numChannels = inputBuffer.numberOfChannels;
    const outputBuffer = context.createBuffer(
      numChannels,
      inputBuffer.length,
      inputBuffer.sampleRate,
    );

    for (let channel = 0; channel < numChannels; channel++) {
      const inputData = inputBuffer.getChannelData(channel);
      const outputData = outputBuffer.getChannelData(channel);
      this.processChannel(inputData, outputData);
    }

    return outputBuffer;
  }

  private processChannel(input: Float32Array, output: Float32Array): void {
    const numFrames = Math.max(
      1,
      Math.ceil(Math.max(0, input.length - this.fftSize) / this.hopSize) + 1,
    );
    output.fill(0);

    // Overlap-add buffer for reconstruction
    const overlapBuffer = new Float32Array(input.length);
    const normalizationBuffer = new Float32Array(input.length);
    for (let frame = 0; frame < numFrames; frame++) {
      const start = frame * this.hopSize;
      const frameData = this.extractFrame(input, start);

      // Compute magnitude and phase
      const { magnitudes, phases } = this.computeSpectrum(frameData);
      const processedMagnitudes = this.applySpectralSubtraction(magnitudes);

      // Reconstruct time-domain signal
      const reconstructed = this.reconstructFrame(processedMagnitudes, phases);

      // Overlap-add
      for (let i = 0; i < this.fftSize; i++) {
        const outputIndex = start + i;
        if (outputIndex < overlapBuffer.length) {
          const window = this.getWindowValue(i);
          overlapBuffer[outputIndex] += reconstructed[i];
          normalizationBuffer[outputIndex] += window * window;
        }
      }
    }

    for (let i = 0; i < output.length; i++) {
      const normalization = normalizationBuffer[i];
      output[i] =
        normalization > 1e-6 ? overlapBuffer[i] / normalization : input[i];
    }
  }

  private extractFrame(input: Float32Array, start: number): Float32Array {
    const frame = new Float32Array(this.fftSize);

    for (let i = 0; i < this.fftSize; i++) {
      const idx = start + i;
      const sample = idx < input.length ? input[idx] : 0;
      const window = this.getWindowValue(i);
      frame[i] = sample * window;
    }

    return frame;
  }

  private getWindowValue(index: number): number {
    return 0.5 * (1 - Math.cos((2 * Math.PI * index) / (this.fftSize - 1)));
  }

  private computeMagnitudeSpectrum(frame: Float32Array): Float32Array {
    const { real, imag } = this.fft.forward(frame);
    return this.fft.getMagnitude(real, imag);
  }

  private computeSpectrum(frame: Float32Array): {
    magnitudes: Float32Array;
    phases: Float32Array;
  } {
    const { real, imag } = this.fft.forward(frame);
    return this.fft.getMagnitudeAndPhase(real, imag);
  }

  private applySpectralSubtraction(magnitudes: Float32Array): Float32Array {
    if (!this.noiseProfile) {
      return magnitudes;
    }

    const halfFFT = magnitudes.length;
    const result = new Float32Array(halfFFT);
    const thresholdLinear = Math.pow(10, this.config.threshold / 20);

    for (let i = 0; i < halfFFT; i++) {
      const noiseMag = this.noiseProfile.magnitudes[i] || 0;
      const noiseStd = this.noiseProfile.standardDeviations[i] || 0;

      // Spectral subtraction with over-subtraction factor
      const overSubtraction = 1 + this.config.reduction;
      const subtracted =
        magnitudes[i] - overSubtraction * (noiseMag + noiseStd);

      // Spectral floor to prevent musical noise
      const floor = noiseMag * (1 - this.config.reduction) * thresholdLinear;
      const smoothed = Math.max(subtracted, floor);
      result[i] =
        smoothed * (1 - this.config.smoothing) +
        magnitudes[i] * this.config.smoothing;
    }

    return result;
  }

  private reconstructFrame(
    magnitudes: Float32Array,
    phases: Float32Array,
  ): Float32Array {
    const { real, imag } = this.fft.fromMagnitudeAndPhase(magnitudes, phases);
    const timeDomain = this.fft.inverse(real, imag);
    return this.fft.applySynthesisWindow(timeDomain);
  }

  setConfig(config: Partial<NoiseReductionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): NoiseReductionConfig {
    return { ...this.config };
  }
}

export function detectNoiseSegments(
  buffer: AudioBuffer,
  threshold: number = -50,
  minDuration: number = 0.5,
): Array<{ start: number; end: number }> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const thresholdLinear = Math.pow(10, threshold / 20);
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows

  const segments: Array<{ start: number; end: number }> = [];
  let segmentStart: number | null = null;

  for (let i = 0; i < channelData.length; i += windowSize) {
    const end = Math.min(i + windowSize, channelData.length);
    let sumSquares = 0;
    for (let j = i; j < end; j++) {
      sumSquares += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sumSquares / (end - i));

    const isQuiet = rms < thresholdLinear;
    const currentTime = i / sampleRate;

    if (isQuiet && segmentStart === null) {
      segmentStart = currentTime;
    } else if (!isQuiet && segmentStart !== null) {
      const duration = currentTime - segmentStart;
      if (duration >= minDuration) {
        segments.push({ start: segmentStart, end: currentTime });
      }
      segmentStart = null;
    }
  }
  if (segmentStart !== null) {
    const duration = buffer.duration - segmentStart;
    if (duration >= minDuration) {
      segments.push({ start: segmentStart, end: buffer.duration });
    }
  }

  return segments;
}

export function extractAudioSegment(
  buffer: AudioBuffer,
  start: number,
  end: number,
  context: BaseAudioContext,
): AudioBuffer {
  const startSample = Math.floor(start * buffer.sampleRate);
  const endSample = Math.floor(end * buffer.sampleRate);
  const length = endSample - startSample;

  const extracted = context.createBuffer(
    buffer.numberOfChannels,
    length,
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const sourceData = buffer.getChannelData(channel);
    const destData = extracted.getChannelData(channel);

    for (let i = 0; i < length; i++) {
      destData[i] = sourceData[startSample + i] || 0;
    }
  }

  return extracted;
}

export async function autoLearnNoiseProfile(
  buffer: AudioBuffer,
  context: BaseAudioContext,
): Promise<NoiseProfile | null> {
  const segments = detectNoiseSegments(buffer, -50, 0.5);

  let noiseSegmentBuffer: AudioBuffer | null = null;

  if (segments.length > 0) {
    const longestSegment = segments.reduce((longest, current) => {
      const currentDuration = current.end - current.start;
      const longestDuration = longest.end - longest.start;
      return currentDuration > longestDuration ? current : longest;
    });
    noiseSegmentBuffer = extractAudioSegment(
      buffer,
      longestSegment.start,
      longestSegment.end,
      context,
    );
  } else {
    const quietest = findQuietestContiguousWindow(buffer, 0.5);
    if (!quietest) {
      return null;
    }
    if (!isLikelyNoiseOnly(buffer, quietest)) {
      return null;
    }
    noiseSegmentBuffer = extractAudioSegment(
      buffer,
      quietest.start,
      quietest.end,
      context,
    );
  }

  const reducer = new SpectralNoiseReducer();
  return reducer.learnNoiseProfile(noiseSegmentBuffer);
}

function findQuietestContiguousWindow(
  buffer: AudioBuffer,
  minDuration: number,
): { start: number; end: number } | null {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.05);
  const minWindows = Math.max(1, Math.ceil(minDuration / 0.05));
  const totalWindows = Math.floor(channelData.length / windowSize);

  if (totalWindows < minWindows) {
    return null;
  }

  const rmsValues: number[] = new Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSize;
    const end = start + windowSize;
    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    rmsValues[w] = Math.sqrt(sumSquares / windowSize);
  }

  let bestStart = 0;
  let bestSum = Infinity;
  let runningSum = 0;
  for (let i = 0; i < minWindows; i++) {
    runningSum += rmsValues[i];
  }
  bestSum = runningSum;
  for (let i = minWindows; i < totalWindows; i++) {
    runningSum += rmsValues[i] - rmsValues[i - minWindows];
    if (runningSum < bestSum) {
      bestSum = runningSum;
      bestStart = i - minWindows + 1;
    }
  }

  return {
    start: (bestStart * windowSize) / sampleRate,
    end: ((bestStart + minWindows) * windowSize) / sampleRate,
  };
}

function isLikelyNoiseOnly(
  buffer: AudioBuffer,
  range: { start: number; end: number },
): boolean {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(range.start * sampleRate);
  const endSample = Math.floor(range.end * sampleRate);
  const totalSamples = channelData.length;

  let segmentSumSquares = 0;
  for (let i = startSample; i < endSample; i++) {
    segmentSumSquares += channelData[i] * channelData[i];
  }
  const segmentRms = Math.sqrt(segmentSumSquares / (endSample - startSample));

  let totalSumSquares = 0;
  for (let i = 0; i < totalSamples; i++) {
    totalSumSquares += channelData[i] * channelData[i];
  }
  const totalRms = Math.sqrt(totalSumSquares / totalSamples);

  if (totalRms <= 0) {
    return false;
  }

  return segmentRms <= totalRms * 0.4;
}
