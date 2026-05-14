import { describe, expect, it } from "vitest";
import { SpectralNoiseReducer, type NoiseProfile } from "./noise-reduction";

type TestAudioBuffer = AudioBuffer & {
  readonly data: Float32Array[];
};

const sampleRate = 48000;

const createAudioBuffer = (samples: Float32Array): TestAudioBuffer =>
  ({
    data: [samples],
    length: samples.length,
    duration: samples.length / sampleRate,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: (_channel: number) => samples,
  }) as TestAudioBuffer;

const createContext = (): BaseAudioContext =>
  ({
    createBuffer: (numberOfChannels: number, length: number) => {
      const channels = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(length),
      );

      return {
        data: channels,
        length,
        duration: length / sampleRate,
        sampleRate,
        numberOfChannels,
        getChannelData: (channel: number) => channels[channel],
      } as TestAudioBuffer;
    },
  }) as unknown as BaseAudioContext;

const createSine = (
  frequency: number,
  amplitude: number,
  length: number,
): Float32Array => {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
};

const estimateSineAmplitude = (samples: Float32Array, frequency: number): number => {
  let sineProjection = 0;
  let cosineProjection = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    sineProjection += samples[index] * Math.sin(phase);
    cosineProjection += samples[index] * Math.cos(phase);
  }

  return (2 / samples.length) * Math.hypot(sineProjection, cosineProjection);
};

const createSilentProfile = (): NoiseProfile => {
  const fftSize = 2048;
  const frequencyBins = new Float32Array(fftSize / 2);
  for (let index = 0; index < frequencyBins.length; index += 1) {
    frequencyBins[index] = (index * sampleRate) / fftSize;
  }

  return {
    frequencyBins,
    magnitudes: new Float32Array(fftSize / 2),
    standardDeviations: new Float32Array(fftSize / 2),
    sampleRate,
    fftSize,
  };
};

describe("SpectralNoiseReducer", () => {
  it("preserves wanted audio level when no noise profile energy is present", async () => {
    const input = createSine(440, 0.5, 8192);
    const reducer = new SpectralNoiseReducer({ reduction: 0, smoothing: 0 });
    reducer.setNoiseProfile(createSilentProfile());

    const output = await reducer.processBuffer(createAudioBuffer(input), createContext());
    const outputSamples = output.getChannelData(0);

    const inputAmplitude = estimateSineAmplitude(input, 440);
    const outputAmplitude = estimateSineAmplitude(outputSamples, 440);

    expect(outputAmplitude / inputAmplitude).toBeGreaterThan(0.9);
    expect(outputAmplitude / inputAmplitude).toBeLessThan(1.1);
  });

  it("reduces profiled high-frequency noise while retaining speech-band energy", async () => {
    const length = 8192;
    const voice = createSine(440, 0.38, length);
    const noise = createSine(6000, 0.18, length);
    const mixed = new Float32Array(length);

    for (let index = 0; index < length; index += 1) {
      mixed[index] = voice[index] + noise[index];
    }

    const reducer = new SpectralNoiseReducer({
      reduction: 0.92,
      smoothing: 0.06,
      threshold: -55,
    });
    const profile = reducer.learnNoiseProfile(createAudioBuffer(noise));
    reducer.setNoiseProfile(profile);

    const output = await reducer.processBuffer(createAudioBuffer(mixed), createContext());
    const outputSamples = output.getChannelData(0);

    const inputNoiseAmplitude = estimateSineAmplitude(mixed, 6000);
    const outputNoiseAmplitude = estimateSineAmplitude(outputSamples, 6000);
    const inputVoiceAmplitude = estimateSineAmplitude(mixed, 440);
    const outputVoiceAmplitude = estimateSineAmplitude(outputSamples, 440);

    expect(outputNoiseAmplitude / inputNoiseAmplitude).toBeLessThan(0.65);
    expect(outputVoiceAmplitude / inputVoiceAmplitude).toBeGreaterThan(0.7);
  });
});