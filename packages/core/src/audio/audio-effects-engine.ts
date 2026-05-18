import type { Effect } from "../types/timeline";
import type { AudioEffectParams, EQBand } from "../types/effects";
import { FFT } from "./fft";
import {
  isSerializedNoiseProfile,
  type SerializedNoiseProfile,
} from "./audio-effect-routing";
import {
  SpectralNoiseReducer,
  type NoiseProfile,
} from "./noise-reduction";

export interface AudioEffectChainConfig {
  readonly effects: Effect[];
  readonly sampleRate?: number;
}

export interface ReverbConfig {
  readonly roomSize: number; // 0 to 1
  readonly damping: number; // 0 to 1
  readonly wetLevel: number; // 0 to 1
  readonly dryLevel: number; // 0 to 1
  readonly preDelay: number; // 0 to 100 ms
}

export interface SimpleNoiseProfile {
  readonly frequencyBins: Float32Array;
  readonly magnitudes: Float32Array;
  readonly standardDeviations?: Float32Array;
  readonly sampleRate: number;
  readonly fftSize?: number;
}

export interface EffectProcessingResult {
  readonly buffer: AudioBuffer;
  readonly appliedEffects: string[];
}

interface EffectNodePair {
  input: AudioNode;
  output: AudioNode;
}

type NoiseReductionFocus = NonNullable<
  AudioEffectParams["noiseReduction"]["focus"]
>;

interface NoiseReductionBandSpec {
  type: BiquadFilterType;
  frequency: number;
  q: number;
  gain?: number;
}

interface NoiseReductionFocusProfile {
  minimumGain: number;
  bandWeights: number[];
  postFilters: Array<NoiseReductionBandSpec>;
}

const NOISE_REDUCTION_BAND_SPECS: NoiseReductionBandSpec[] = [
  { type: "lowpass", frequency: 90, q: 0.707 },
  { type: "bandpass", frequency: 160, q: 0.85 },
  { type: "bandpass", frequency: 315, q: 0.9 },
  { type: "bandpass", frequency: 630, q: 0.95 },
  { type: "bandpass", frequency: 1250, q: 1 },
  { type: "bandpass", frequency: 2500, q: 1 },
  { type: "bandpass", frequency: 5000, q: 0.95 },
  { type: "bandpass", frequency: 9000, q: 0.9 },
  { type: "highpass", frequency: 12000, q: 0.707 },
];

const NOISE_REDUCTION_FOCUS_PROFILES: Record<
  NoiseReductionFocus,
  NoiseReductionFocusProfile
> = {
  balanced: {
    minimumGain: 0.42,
    bandWeights: [1.05, 1, 0.95, 0.85, 0.72, 0.68, 0.8, 0.92, 1],
    postFilters: [{ type: "highpass", frequency: 55, q: 0.6 }],
  },
  speech: {
    minimumGain: 0.48,
    bandWeights: [1.15, 1.05, 0.92, 0.74, 0.58, 0.54, 0.72, 0.88, 1.02],
    postFilters: [
      { type: "highpass", frequency: 65, q: 0.7 },
      { type: "peaking", frequency: 2800, q: 0.95, gain: 1.6 },
    ],
  },
  whiteNoise: {
    minimumGain: 0.1,
    bandWeights: [1.16, 1.12, 1.02, 0.9, 0.82, 0.94, 1.24, 1.48, 1.58],
    postFilters: [
      { type: "highpass", frequency: 70, q: 0.7 },
      { type: "highshelf", frequency: 5200, q: 0.7, gain: -8.5 },
      { type: "lowpass", frequency: 15500, q: 0.7 },
      { type: "peaking", frequency: 2800, q: 0.9, gain: 1.2 },
    ],
  },
  music: {
    minimumGain: 0.18,
    bandWeights: [1.34, 1.24, 1.08, 0.92, 0.66, 0.58, 0.86, 1.1, 1.22],
    postFilters: [
      { type: "highpass", frequency: 90, q: 0.75 },
      { type: "lowshelf", frequency: 220, q: 0.8, gain: -5 },
      { type: "peaking", frequency: 520, q: 1.1, gain: -3.5 },
      { type: "highshelf", frequency: 6400, q: 0.7, gain: -4.5 },
      { type: "peaking", frequency: 3000, q: 0.9, gain: 2 },
    ],
  },
  heavy: {
    minimumGain: 0.16,
    bandWeights: [1.28, 1.22, 1.12, 1, 0.86, 0.82, 0.96, 1.08, 1.14],
    postFilters: [
      { type: "highpass", frequency: 70, q: 0.7 },
      { type: "highshelf", frequency: 7000, q: 0.7, gain: -4 },
      { type: "lowpass", frequency: 14500, q: 0.7 },
    ],
  },
  wind: {
    minimumGain: 0.12,
    bandWeights: [1.4, 1.34, 1.14, 0.86, 0.67, 0.62, 0.76, 0.9, 1],
    postFilters: [
      { type: "highpass", frequency: 110, q: 0.8 },
      { type: "lowshelf", frequency: 180, q: 0.8, gain: -6 },
    ],
  },
  hum: {
    minimumGain: 0.18,
    bandWeights: [1.32, 1.22, 1.06, 0.9, 0.72, 0.66, 0.8, 0.94, 1],
    postFilters: [
      { type: "highpass", frequency: 70, q: 0.7 },
      { type: "notch", frequency: 60, q: 18 },
      { type: "notch", frequency: 120, q: 14 },
      { type: "notch", frequency: 180, q: 10 },
    ],
  },
};

export interface NoiseReductionNodeChain {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
}

const createNoiseReductionBandsForContext = (
  context: BaseAudioContext,
  params?: AudioEffectParams["noiseReduction"],
  focus: NoiseReductionFocus = "balanced",
): Array<{ filter: BiquadFilterNode; gate: GainNode }> => {
  const threshold = params?.threshold ?? -40;
  const reduction = params?.reduction ?? 0.5;
  const focusProfile = NOISE_REDUCTION_FOCUS_PROFILES[focus];
  const thresholdAggression = Math.min(
    1,
    Math.max(0.15, (Math.abs(threshold) - 18) / 42),
  );
  const bands: Array<{ filter: BiquadFilterNode; gate: GainNode }> = [];

  for (let i = 0; i < NOISE_REDUCTION_BAND_SPECS.length; i++) {
    const bandSpec = NOISE_REDUCTION_BAND_SPECS[i];
    const filter = context.createBiquadFilter();
    filter.type = bandSpec.type;
    filter.frequency.value = bandSpec.frequency;
    filter.Q.value = bandSpec.q;

    const gate = context.createGain();
    const attenuation =
      reduction * thresholdAggression * focusProfile.bandWeights[i];
    gate.gain.value = Math.min(
      1,
      Math.max(focusProfile.minimumGain, 1 - attenuation),
    );

    bands.push({ filter, gate });
  }

  return bands;
};

const createNoiseReductionPostFiltersForContext = (
  context: BaseAudioContext,
  focus: NoiseReductionFocus,
): BiquadFilterNode[] => {
  const focusProfile = NOISE_REDUCTION_FOCUS_PROFILES[focus];

  return focusProfile.postFilters.map((spec) => {
    const filter = context.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.frequency;
    filter.Q.value = spec.q;
    if (typeof spec.gain === "number") {
      filter.gain.value = spec.gain;
    }
    return filter;
  });
};

const calculateNoiseStatistics = (magnitudes: Float32Array): {
  mean: number;
  stdDev: number;
} => {
  let sum = 0;
  for (let index = 0; index < magnitudes.length; index += 1) {
    sum += magnitudes[index];
  }

  const mean = sum / magnitudes.length;
  let varianceSum = 0;

  for (let index = 0; index < magnitudes.length; index += 1) {
    const diff = magnitudes[index] - mean;
    varianceSum += diff * diff;
  }

  return {
    mean,
    stdDev: Math.sqrt(varianceSum / magnitudes.length),
  };
};

const calculateLowFrequencyEnergy = (
  magnitudes: Float32Array,
  binWidth: number,
): number => {
  const maxBin = Math.min(magnitudes.length, Math.ceil(200 / binWidth));
  let energy = 0;

  for (let index = 0; index < maxBin; index += 1) {
    energy += magnitudes[index];
  }

  return energy / maxBin;
};

const calculateRangeEnergy = (
  magnitudes: Float32Array,
  binWidth: number,
  minFrequency: number,
  maxFrequency: number,
): number => {
  const startBin = Math.max(0, Math.floor(minFrequency / binWidth));
  const endBin = Math.min(magnitudes.length - 1, Math.ceil(maxFrequency / binWidth));
  if (endBin < startBin) {
    return 0;
  }

  let energy = 0;
  for (let index = startBin; index <= endBin; index += 1) {
    energy += magnitudes[index];
  }

  return energy / (endBin - startBin + 1);
};

export const createProfileBasedNoiseReductionFilters = (
  context: BaseAudioContext,
  profile: SimpleNoiseProfile,
  reduction: number,
  focus: NoiseReductionFocus,
  includePostFilters: boolean = true,
): BiquadFilterNode[] => {
  const filters: BiquadFilterNode[] = [];
  const magnitudes = profile.magnitudes;
  const frequencyBins = profile.frequencyBins;
  const { mean, stdDev } = calculateNoiseStatistics(magnitudes);
  const peakThreshold = mean + stdDev * 2;
  const addressedBins = new Set<number>();

  for (let index = 2; index < magnitudes.length - 2; index += 1) {
    const magnitude = magnitudes[index];
    const frequency = frequencyBins[index];

    if (frequency < 60 || addressedBins.has(index)) {
      continue;
    }

    const isPeak =
      magnitude > magnitudes[index - 2] &&
      magnitude > magnitudes[index - 1] &&
      magnitude > magnitudes[index + 1] &&
      magnitude > magnitudes[index + 2] &&
      magnitude > peakThreshold;

    if (!isPeak) {
      continue;
    }

    const filter = context.createBiquadFilter();
    filter.type = "notch";
    filter.frequency.value = Math.max(20, Math.min(20000, frequency));
    const peakSharpness =
      magnitude / ((magnitudes[index - 1] + magnitudes[index + 1]) / 2);
    filter.Q.value = Math.min(30, Math.max(5, peakSharpness * 10));
    filters.push(filter);

    for (let bin = index - 2; bin <= index + 2; bin += 1) {
      addressedBins.add(bin);
    }
  }

  const bandCenters = [125, 250, 500, 1000, 2000, 4000, 8000];
  const binWidth = profile.sampleRate / (magnitudes.length * 2);
  const safeMean = Math.max(mean, 1e-6);
  const peak = Math.max(...Array.from(magnitudes));
  const spectralFlatness = Math.min(1, Math.max(0, mean / Math.max(peak, 1e-6)));
  const airEnergy = calculateRangeEnergy(magnitudes, binWidth, 6000, 18000);
  const voiceEnergy = calculateRangeEnergy(magnitudes, binWidth, 250, 4000);
  const lowMidEnergy = calculateRangeEnergy(magnitudes, binWidth, 180, 1200);
  const airBias = airEnergy / Math.max(voiceEnergy, 1e-6);

  for (const centerFrequency of bandCenters) {
    const binIndex = Math.round(centerFrequency / binWidth);
    if (binIndex >= magnitudes.length || addressedBins.has(binIndex)) {
      continue;
    }

    const bandStart = Math.max(0, binIndex - 5);
    const bandEnd = Math.min(magnitudes.length - 1, binIndex + 5);
    let bandAverage = 0;

    for (let index = bandStart; index <= bandEnd; index += 1) {
      bandAverage += magnitudes[index];
    }

    bandAverage /= bandEnd - bandStart + 1;

    if (bandAverage <= safeMean * 1.2) {
      continue;
    }

    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = centerFrequency;
    filter.Q.value = 1.4;
    const noiseRatio = (bandAverage - safeMean) / safeMean;
    filter.gain.value = -reduction * Math.min(12, noiseRatio * 6);
    filters.push(filter);
  }

  if (focus === "whiteNoise" || spectralFlatness > 0.58 || airBias > 1.25) {
    const airShelf = context.createBiquadFilter();
    airShelf.type = "highshelf";
    airShelf.frequency.value = 5200;
    airShelf.Q.value = 0.7;
    airShelf.gain.value = -Math.min(12, 5 + reduction * 7 + Math.max(0, airBias - 1) * 2);
    filters.push(airShelf);

    const hissPeak = context.createBiquadFilter();
    hissPeak.type = "peaking";
    hissPeak.frequency.value = 9000;
    hissPeak.Q.value = 0.8;
    hissPeak.gain.value = -Math.min(10, 4 + reduction * 6);
    filters.push(hissPeak);
  }

  if (focus === "music" || (lowMidEnergy > safeMean * 1.35 && spectralFlatness < 0.58)) {
    const lowMusicShelf = context.createBiquadFilter();
    lowMusicShelf.type = "lowshelf";
    lowMusicShelf.frequency.value = 220;
    lowMusicShelf.Q.value = 0.8;
    lowMusicShelf.gain.value = -Math.min(8, 3 + reduction * 5);
    filters.push(lowMusicShelf);

    const lowMidMusicCut = context.createBiquadFilter();
    lowMidMusicCut.type = "peaking";
    lowMidMusicCut.frequency.value = 650;
    lowMidMusicCut.Q.value = 1.05;
    lowMidMusicCut.gain.value = -Math.min(7, 2.5 + reduction * 4.5);
    filters.push(lowMidMusicCut);

    const speechPresence = context.createBiquadFilter();
    speechPresence.type = "peaking";
    speechPresence.frequency.value = 3000;
    speechPresence.Q.value = 0.9;
    speechPresence.gain.value = 1.5;
    filters.push(speechPresence);
  }

  const lowFrequencyEnergy = calculateLowFrequencyEnergy(magnitudes, binWidth);
  if (lowFrequencyEnergy > safeMean * 1.5) {
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.707;
    filters.push(highpass);
  }

  if (includePostFilters) {
    filters.push(...createNoiseReductionPostFiltersForContext(context, focus));
  }

  if (filters.length === 0) {
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 60;
    highpass.Q.value = 0.5;
    filters.push(highpass);
  }

  return filters;
};

export const createNoiseReductionNodeChain = (
  context: BaseAudioContext,
  effect: Effect,
): NoiseReductionNodeChain => {
  const params = effect.params as AudioEffectParams["noiseReduction"];
  const focus = params?.focus ?? "balanced";

  const inputGain = context.createGain();
  const outputGain = context.createGain();

  const bands = createNoiseReductionBandsForContext(context, params, focus);
  const nodes: AudioNode[] = [inputGain, outputGain];
  let bandInput: AudioNode = inputGain;

  if (params?.profile && isSerializedNoiseProfile(params.profile)) {
    const profileFilters = createProfileBasedNoiseReductionFilters(
      context,
      toSimpleNoiseProfile(params.profile),
      params.reduction ?? 0.5,
      focus,
      false,
    );

    for (const filter of profileFilters) {
      nodes.push(filter);
      bandInput.connect(filter);
      bandInput = filter;
    }
  }

  for (const band of bands) {
    nodes.push(band.filter, band.gate);
    bandInput.connect(band.filter);
    band.filter.connect(band.gate);
    band.gate.connect(outputGain);
  }

  let lastNode: AudioNode = outputGain;

  for (const filter of createNoiseReductionPostFiltersForContext(context, focus)) {
    nodes.push(filter);
    lastNode.connect(filter);
    lastNode = filter;
  }

  return { input: inputGain, output: lastNode, nodes };
};

const toSimpleNoiseProfile = (
  profile: SerializedNoiseProfile,
): SimpleNoiseProfile => ({
  frequencyBins: new Float32Array(profile.frequencyBins),
  magnitudes: new Float32Array(profile.magnitudes),
  standardDeviations: profile.standardDeviations
    ? new Float32Array(profile.standardDeviations)
    : undefined,
  sampleRate: profile.sampleRate,
  fftSize: profile.fftSize,
});

const toSpectralNoiseProfile = (
  profile: SimpleNoiseProfile,
): NoiseProfile => {
  const standardDeviations = profile.standardDeviations
    ? new Float32Array(profile.standardDeviations)
    : Float32Array.from(profile.magnitudes, (magnitude) => magnitude * 0.08);

  return {
    frequencyBins: new Float32Array(profile.frequencyBins),
    magnitudes: new Float32Array(profile.magnitudes),
    standardDeviations,
    sampleRate: profile.sampleRate,
    fftSize: profile.fftSize ?? profile.magnitudes.length * 2,
  };
};

const getSpectralSmoothingForFocus = (
  focus: NoiseReductionFocus,
  reduction: number,
): number => {
  const baseSmoothing: Record<NoiseReductionFocus, number> = {
    balanced: 0.22,
    speech: 0.2,
    whiteNoise: 0.08,
    music: 0.12,
    heavy: 0.1,
    wind: 0.12,
    hum: 0.16,
  };

  return Math.max(0.04, baseSmoothing[focus] - Math.max(0, reduction - 0.75) * 0.12);
};

const getBufferPeak = (buffer: AudioBuffer): number => {
  let peak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < channelData.length; index += 1) {
      const sample = channelData[index];
      if (!Number.isFinite(sample)) {
        return Number.NaN;
      }
      peak = Math.max(peak, Math.abs(sample));
    }
  }

  return peak;
};

const getBufferRms = (buffer: AudioBuffer): number => {
  let sumSquares = 0;
  let sampleCount = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    sampleCount += channelData.length;
    for (let index = 0; index < channelData.length; index += 1) {
      const sample = channelData[index];
      if (!Number.isFinite(sample)) {
        return Number.NaN;
      }
      sumSquares += sample * sample;
    }
  }

  if (sampleCount === 0) {
    return 0;
  }

  return Math.sqrt(sumSquares / sampleCount);
};

const isBufferUsable = (
  candidate: AudioBuffer,
  reference: AudioBuffer,
  minimumRatio: number,
): boolean => {
  if (
    candidate.length !== reference.length ||
    candidate.numberOfChannels !== reference.numberOfChannels ||
    candidate.sampleRate !== reference.sampleRate
  ) {
    return false;
  }

  const candidatePeak = getBufferPeak(candidate);
  const referencePeak = getBufferPeak(reference);
  const candidateRms = getBufferRms(candidate);
  const referenceRms = getBufferRms(reference);

  if (
    !Number.isFinite(candidatePeak) ||
    !Number.isFinite(referencePeak) ||
    !Number.isFinite(candidateRms) ||
    !Number.isFinite(referenceRms)
  ) {
    return false;
  }

  if (referencePeak < 1e-5 && referenceRms < 1e-5) {
    return true;
  }

  return (
    candidatePeak >= Math.max(1e-5, referencePeak * minimumRatio) &&
    candidateRms >= Math.max(1e-5, referenceRms * minimumRatio)
  );
};

const getMaximumMakeupGain = (
  focus: NoiseReductionFocus,
  reduction: number,
): number => {
  const focusMaximumGain: Record<NoiseReductionFocus, number> = {
    balanced: 1.18,
    speech: 1.24,
    whiteNoise: 1.42,
    music: 1.28,
    heavy: 1.34,
    wind: 1.32,
    hum: 1.22,
  };

  return focusMaximumGain[focus] + Math.max(0, reduction - 0.7) * 0.3;
};

const applyGainToBuffer = (buffer: AudioBuffer, gain: number): AudioBuffer => {
  if (gain <= 1.001) {
    return buffer;
  }

  const context = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.max(1, buffer.length),
    buffer.sampleRate,
  );
  const gainedBuffer = context.createBuffer(
    buffer.numberOfChannels,
    Math.max(1, buffer.length),
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const sourceData = buffer.getChannelData(channel);
    const targetData = gainedBuffer.getChannelData(channel);

    for (let index = 0; index < sourceData.length; index += 1) {
      targetData[index] = Math.max(-1, Math.min(1, sourceData[index] * gain));
    }
  }

  return gainedBuffer;
};

const restoreVoicePresence = (
  reference: AudioBuffer,
  candidate: AudioBuffer,
  focus: NoiseReductionFocus,
  reduction: number,
): AudioBuffer => {
  const referenceRms = getBufferRms(reference);
  const candidateRms = getBufferRms(candidate);
  const candidatePeak = getBufferPeak(candidate);

  if (
    !Number.isFinite(referenceRms) ||
    !Number.isFinite(candidateRms) ||
    !Number.isFinite(candidatePeak) ||
    referenceRms < 1e-5 ||
    candidateRms < 1e-5 ||
    candidatePeak < 1e-5
  ) {
    return candidate;
  }

  const targetRms =
    referenceRms * Math.max(0.82, 0.92 - Math.max(0, reduction - 0.55) * 0.22);
  const headroomGain = 0.98 / Math.max(candidatePeak, 1e-5);
  const desiredGain = targetRms / candidateRms;
  const gain = Math.max(
    1,
    Math.min(
      getMaximumMakeupGain(focus, reduction),
      headroomGain,
      desiredGain,
    ),
  );

  return applyGainToBuffer(candidate, gain);
};

export class AudioEffectsEngine {
  private audioContext: AudioContext | OfflineAudioContext | null = null;
  private impulseResponses: Map<string, AudioBuffer> = new Map();
  private noiseProfiles: Map<string, SimpleNoiseProfile> = new Map();
  private initialized = false;

  constructor(context?: AudioContext | OfflineAudioContext) {
    this.audioContext = context || null;
  }

  async initialize(
    context?: AudioContext | OfflineAudioContext,
  ): Promise<void> {
    if (context) {
      this.audioContext = context;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48000,
      });
    }

    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized && this.audioContext !== null;
  }

  getAudioContext(): AudioContext | OfflineAudioContext {
    this.ensureInitialized();
    return this.audioContext!;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.audioContext) {
      throw new Error(
        "AudioEffectsEngine not initialized. Call initialize() first.",
      );
    }
  }

  async applyEffectChain(
    buffer: AudioBuffer,
    effects: Effect[],
  ): Promise<EffectProcessingResult> {
    this.ensureInitialized();

    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return { buffer, appliedEffects: [] };
    }
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    const { firstNode, lastNode, appliedEffects } = await this.buildEffectChain(
      offlineContext,
      enabledEffects,
    );
    if (firstNode && lastNode) {
      source.connect(firstNode);
      lastNode.connect(offlineContext.destination);
    } else {
      source.connect(offlineContext.destination);
    }

    source.start(0);

    const processedBuffer = await offlineContext.startRendering();

    return {
      buffer: processedBuffer,
      appliedEffects,
    };
  }

  private async buildEffectChain(
    context: BaseAudioContext,
    effects: Effect[],
  ): Promise<{
    firstNode: AudioNode | null;
    lastNode: AudioNode | null;
    appliedEffects: string[];
  }> {
    let firstNode: AudioNode | null = null;
    let lastNode: AudioNode | null = null;
    const appliedEffects: string[] = [];

    for (const effect of effects) {
      if (!effect.enabled) {
        continue;
      }

      const nodePair = await this.createEffectNode(context, effect);
      if (!nodePair) {
        continue;
      }

      appliedEffects.push(effect.type);

      if (!firstNode) {
        firstNode = nodePair.input;
      }

      if (lastNode) {
        lastNode.connect(nodePair.input);
      }

      lastNode = nodePair.output;
    }

    return { firstNode, lastNode, appliedEffects };
  }

  private async createEffectNode(
    context: BaseAudioContext,
    effect: Effect,
  ): Promise<EffectNodePair | null> {
    switch (effect.type) {
      case "eq":
        return this.createEQNodePair(context, effect);
      case "compressor":
        return this.createCompressorNodePair(context, effect);
      case "reverb":
        return await this.createReverbNode(context, effect);
      case "delay":
        return this.createDelayNode(context, effect);
      case "noiseReduction":
        return this.createNoiseReductionNodePair(context, effect);
      case "gain":
        return this.createGainNodePair(context, effect);
      default:
        return null;
    }
  }

  private createEQNodePair(
    context: BaseAudioContext,
    effect: Effect,
  ): EffectNodePair | null {
    const params = effect.params as AudioEffectParams["eq"];
    const bands = params?.bands;

    if (!bands || bands.length === 0) {
      return null;
    }

    let firstNode: BiquadFilterNode | null = null;
    let lastNode: BiquadFilterNode | null = null;

    for (const band of bands) {
      const filter = context.createBiquadFilter();
      filter.type = this.mapEQBandType(band.type);
      filter.frequency.value = Math.max(20, Math.min(20000, band.frequency));
      filter.gain.value = Math.max(-24, Math.min(24, band.gain));
      filter.Q.value = Math.max(0.1, Math.min(18, band.q));

      if (!firstNode) {
        firstNode = filter;
      }

      if (lastNode) {
        lastNode.connect(filter);
      }

      lastNode = filter;
    }

    if (!firstNode || !lastNode) return null;
    return { input: firstNode, output: lastNode };
  }

  createEQNode(context: BaseAudioContext, effect: Effect): AudioNode | null {
    const pair = this.createEQNodePair(context, effect);
    return pair?.input ?? null;
  }

  private mapEQBandType(type: EQBand["type"]): BiquadFilterType {
    const typeMap: Record<EQBand["type"], BiquadFilterType> = {
      lowshelf: "lowshelf",
      highshelf: "highshelf",
      peaking: "peaking",
      lowpass: "lowpass",
      highpass: "highpass",
      notch: "notch",
    };
    return typeMap[type] || "peaking";
  }

  private createCompressorNodePair(
    context: BaseAudioContext,
    effect: Effect,
  ): EffectNodePair {
    const compressor = this.createCompressorNode(context, effect);
    return { input: compressor, output: compressor };
  }

  createCompressorNode(
    context: BaseAudioContext,
    effect: Effect,
  ): DynamicsCompressorNode {
    const params = effect.params as AudioEffectParams["compressor"];
    const compressor = context.createDynamicsCompressor();

    compressor.threshold.value = Math.max(
      -60,
      Math.min(0, params?.threshold ?? -24),
    );
    compressor.ratio.value = Math.max(1, Math.min(20, params?.ratio ?? 4));
    compressor.attack.value = Math.max(
      0.001,
      Math.min(1, params?.attack ?? 0.003),
    );
    compressor.release.value = Math.max(
      0.01,
      Math.min(3, params?.release ?? 0.25),
    );
    compressor.knee.value = Math.max(0, Math.min(40, params?.knee ?? 30));

    return compressor;
  }

  async createReverbNode(
    context: BaseAudioContext,
    effect: Effect,
  ): Promise<EffectNodePair> {
    const params = effect.params as AudioEffectParams["reverb"];

    const inputGain = context.createGain();
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const outputGain = context.createGain();
    const convolver = context.createConvolver();

    dryGain.gain.value = params?.dryLevel ?? 0.7;
    wetGain.gain.value = params?.wetLevel ?? 0.5;

    const impulseResponse = await this.getOrCreateImpulseResponse(
      context,
      params?.roomSize ?? 0.5,
      params?.damping ?? 0.5,
    );
    convolver.buffer = impulseResponse;

    let preDelayNode: DelayNode | null = null;
    if (params?.preDelay && params.preDelay > 0) {
      preDelayNode = context.createDelay(0.1);
      preDelayNode.delayTime.value = Math.min(0.1, params.preDelay / 1000);
    }

    inputGain.connect(dryGain);
    dryGain.connect(outputGain);

    if (preDelayNode) {
      inputGain.connect(preDelayNode);
      preDelayNode.connect(convolver);
    } else {
      inputGain.connect(convolver);
    }
    convolver.connect(wetGain);
    wetGain.connect(outputGain);

    return { input: inputGain, output: outputGain };
  }

  private async getOrCreateImpulseResponse(
    context: BaseAudioContext,
    roomSize: number,
    damping: number,
  ): Promise<AudioBuffer> {
    const key = `${roomSize.toFixed(2)}_${damping.toFixed(2)}`;

    if (this.impulseResponses.has(key)) {
      return this.impulseResponses.get(key)!;
    }

    const impulseResponse = this.generateImpulseResponse(
      context,
      roomSize,
      damping,
    );
    this.impulseResponses.set(key, impulseResponse);

    return impulseResponse;
  }

  generateImpulseResponse(
    context: BaseAudioContext,
    roomSize: number,
    damping: number,
  ): AudioBuffer {
    const sampleRate = context.sampleRate;
    // Duration based on room size (0.5s to 4s)
    const duration = 0.5 + roomSize * 3.5;
    const length = Math.floor(sampleRate * duration);
    const channels = 2;

    const impulseBuffer = context.createBuffer(channels, length, sampleRate);

    for (let channel = 0; channel < channels; channel++) {
      const channelData = impulseBuffer.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        // Exponential decay
        const decay = Math.exp((-3 * t) / duration);
        // Random noise with decay
        const noise = (Math.random() * 2 - 1) * decay;
        const dampingFactor = 1 - (damping * t) / duration;
        channelData[i] = noise * dampingFactor;
      }
    }

    return impulseBuffer;
  }

  createDelayNode(context: BaseAudioContext, effect: Effect): EffectNodePair {
    const params = effect.params as AudioEffectParams["delay"];

    const inputGain = context.createGain();
    const delayNode = context.createDelay(2);
    const feedbackGain = context.createGain();
    const wetGain = context.createGain();
    const dryGain = context.createGain();
    const outputGain = context.createGain();

    delayNode.delayTime.value = Math.max(0, Math.min(2, params?.time ?? 0.5));
    feedbackGain.gain.value = Math.max(
      0,
      Math.min(0.95, params?.feedback ?? 0.3),
    );
    wetGain.gain.value = params?.wetLevel ?? 0.5;
    dryGain.gain.value = 1 - (params?.wetLevel ?? 0.5);

    inputGain.connect(dryGain);
    dryGain.connect(outputGain);

    inputGain.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    delayNode.connect(wetGain);
    wetGain.connect(outputGain);

    return { input: inputGain, output: outputGain };
  }

  private createGainNodePair(
    context: BaseAudioContext,
    effect: Effect,
  ): EffectNodePair {
    const gainNode = this.createGainNode(context, effect);
    return { input: gainNode, output: gainNode };
  }

  createGainNode(context: BaseAudioContext, effect: Effect): GainNode {
    const params = effect.params as AudioEffectParams["gain"];
    const gainNode = context.createGain();
    gainNode.gain.value = Math.max(0, Math.min(4, params?.value ?? 1));
    return gainNode;
  }

  private createNoiseReductionNodePair(
    context: BaseAudioContext,
    effect: Effect,
  ): EffectNodePair {
    const chain = createNoiseReductionNodeChain(context, effect);
    return { input: chain.input, output: chain.output };
  }

  createNoiseReductionNode(
    context: BaseAudioContext,
    effect: Effect,
  ): AudioNode {
    const pair = this.createNoiseReductionNodePair(context, effect);
    return pair.input;
  }

  async learnNoiseProfile(
    buffer: AudioBuffer,
    profileId: string,
  ): Promise<SimpleNoiseProfile> {
    this.ensureInitialized();

    const fftSize = 2048;
    const hopSize = fftSize / 2; // 50% overlap for better frequency resolution
    const channelData = buffer.getChannelData(0);
    const numFrames = Math.max(
      1,
      Math.floor((channelData.length - fftSize) / hopSize) + 1,
    );
    const fft = new FFT(fftSize);

    // Accumulate magnitude spectrum across all frames
    const magnitudes = new Float32Array(fftSize / 2);
    const magnitudeSquares = new Float32Array(fftSize / 2);
    const frameBuffer = new Float32Array(fftSize);

    for (let frame = 0; frame < numFrames; frame++) {
      const start = frame * hopSize;
      for (let i = 0; i < fftSize; i++) {
        frameBuffer[i] = channelData[start + i] || 0;
      }
      const windowedFrame = fft.applyHannWindow(frameBuffer);

      // Perform FFT
      const { real, imag } = fft.forward(windowedFrame);

      // Accumulate magnitude spectrum
      const frameMagnitude = fft.getMagnitude(real, imag);
      for (let i = 0; i < magnitudes.length; i++) {
        magnitudes[i] += frameMagnitude[i];
        magnitudeSquares[i] += frameMagnitude[i] * frameMagnitude[i];
      }
    }

    // Average the magnitudes across all frames
    const standardDeviations = new Float32Array(fftSize / 2);
    for (let i = 0; i < magnitudes.length; i++) {
      magnitudes[i] /= numFrames;
      const variance = magnitudeSquares[i] / numFrames - magnitudes[i] * magnitudes[i];
      standardDeviations[i] = Math.sqrt(Math.max(0, variance));
    }
    const frequencyBins = new Float32Array(fftSize / 2);
    const binWidth = buffer.sampleRate / fftSize;
    for (let i = 0; i < frequencyBins.length; i++) {
      frequencyBins[i] = i * binWidth;
    }

    const profile: SimpleNoiseProfile = {
      frequencyBins,
      magnitudes,
      standardDeviations,
      sampleRate: buffer.sampleRate,
      fftSize,
    };

    this.noiseProfiles.set(profileId, profile);

    return profile;
  }

  getNoiseProfile(profileId: string): SimpleNoiseProfile | undefined {
    return this.noiseProfiles.get(profileId);
  }

  async applyNoiseReductionWithProfile(
    buffer: AudioBuffer,
    profileId: string,
    reduction: number = 0.5,
    focus: NoiseReductionFocus = "balanced",
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    const profile = this.noiseProfiles.get(profileId);
    if (!profile) {
      throw new Error(`Noise profile '${profileId}' not found`);
    }

    return this.applyNoiseReductionWithProfileData(
      buffer,
      {
        frequencyBins: Array.from(profile.frequencyBins),
        magnitudes: Array.from(profile.magnitudes),
        standardDeviations: profile.standardDeviations
          ? Array.from(profile.standardDeviations)
          : undefined,
        sampleRate: profile.sampleRate,
        fftSize: profile.fftSize,
      },
      reduction,
      focus,
    );
  }

  async applyNoiseReductionWithProfileData(
    buffer: AudioBuffer,
    profileData: SerializedNoiseProfile,
    reduction: number = 0.5,
    focus: NoiseReductionFocus = "balanced",
    threshold: number = -40,
  ): Promise<AudioBuffer> {
    this.ensureInitialized();

    if (!isSerializedNoiseProfile(profileData)) {
      throw new Error("Noise profile data is invalid");
    }

    const profile = toSimpleNoiseProfile(profileData);
    const spectralReducer = new SpectralNoiseReducer({
      threshold,
      reduction: Math.max(0, Math.min(1, reduction)),
      smoothing: getSpectralSmoothingForFocus(focus, reduction),
    });
    spectralReducer.setNoiseProfile(toSpectralNoiseProfile(profile));

    const spectralBuffer = await spectralReducer.processBuffer(buffer, {
      createBuffer: (
        numberOfChannels: number,
        length: number,
        sampleRate: number,
      ) =>
        new OfflineAudioContext(
          numberOfChannels,
          Math.max(1, length),
          sampleRate,
        ).createBuffer(numberOfChannels, Math.max(1, length), sampleRate),
    } as BaseAudioContext);

    if (!isBufferUsable(spectralBuffer, buffer, 0.025)) {
      return buffer;
    }

    const offlineContext = new OfflineAudioContext(
      spectralBuffer.numberOfChannels,
      spectralBuffer.length,
      spectralBuffer.sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = spectralBuffer;
    const inputGain = offlineContext.createGain();
    const outputGain = offlineContext.createGain();
    const filters = createProfileBasedNoiseReductionFilters(
      offlineContext,
      profile,
      reduction,
      focus,
    );

    source.connect(inputGain);

    if (filters.length > 0) {
      // Chain filters in series for cumulative noise reduction
      let lastNode: AudioNode = inputGain;
      for (const filter of filters) {
        lastNode.connect(filter);
        lastNode = filter;
      }
      lastNode.connect(outputGain);
    } else {
      inputGain.connect(outputGain);
    }

    outputGain.connect(offlineContext.destination);
    source.start(0);

    const renderedBuffer = await offlineContext.startRendering();

    if (!isBufferUsable(renderedBuffer, spectralBuffer, 0.15)) {
      return restoreVoicePresence(buffer, spectralBuffer, focus, reduction);
    }

    return restoreVoicePresence(buffer, renderedBuffer, focus, reduction);
  }

  clearImpulseResponseCache(): void {
    this.impulseResponses.clear();
  }

  clearNoiseProfiles(): void {
    this.noiseProfiles.clear();
  }

  async dispose(): Promise<void> {
    this.clearImpulseResponseCache();
    this.clearNoiseProfiles();

    if (this.audioContext && "close" in this.audioContext) {
      await (this.audioContext as AudioContext).close();
    }

    this.audioContext = null;
    this.initialized = false;
  }
}
let audioEffectsEngineInstance: AudioEffectsEngine | null = null;

export function getAudioEffectsEngine(): AudioEffectsEngine {
  if (!audioEffectsEngineInstance) {
    audioEffectsEngineInstance = new AudioEffectsEngine();
  }
  return audioEffectsEngineInstance;
}

export async function initializeAudioEffectsEngine(
  context?: AudioContext | OfflineAudioContext,
): Promise<AudioEffectsEngine> {
  const engine = getAudioEffectsEngine();
  await engine.initialize(context);
  return engine;
}
