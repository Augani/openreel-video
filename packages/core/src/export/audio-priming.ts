type MediaBunnyModule = typeof import("mediabunny");

export interface AudioPrimingConfig {
  sampleRate: number;
  channels: number;
  bitrate: number;
}

const measurements = new Map<string, Promise<number>>();

/** Locate a known signal after a lossy codec round trip, in PCM sample units. */
export function measureSignalDelay(reference: Float32Array, decoded: Float32Array, signalStart: number, signalLength: number, maxDelay: number): number {
  let bestDelay = 0;
  let bestScore = -Infinity;
  let referenceEnergy = 0;
  for (let i = 0; i < signalLength; i++) referenceEnergy += reference[signalStart + i]! ** 2;
  for (let delay = 0; delay <= maxDelay; delay++) {
    if (signalStart + delay + signalLength > decoded.length) break;
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < signalLength; i++) {
      const value = decoded[signalStart + delay + i]!;
      dot += reference[signalStart + i]! * value;
      energy += value * value;
    }
    const score = dot / Math.sqrt(Math.max(1e-20, referenceEnergy * energy));
    if (score > bestScore) { bestScore = score; bestDelay = delay; }
  }
  if (bestScore < 0.8) throw new Error("Could not verify audio encoder timing. Try WebM or another browser.");
  return bestDelay;
}

/** AAC priming varies by platform and configuration; never assume a fixed 44 ms. */
export function getAacEncoderPriming(library: MediaBunnyModule, config: AudioPrimingConfig): Promise<number> {
  const key = JSON.stringify(config);
  let measurement = measurements.get(key);
  if (!measurement) {
    measurement = measureAacEncoderPriming(library, config).catch((error) => {
      measurements.delete(key);
      throw error;
    });
    measurements.set(key, measurement);
  }
  return measurement;
}

async function measureAacEncoderPriming(library: MediaBunnyModule, config: AudioPrimingConfig): Promise<number> {
  const { Output, BufferTarget, Mp4OutputFormat, AudioBufferSource, Input, BufferSource, ALL_FORMATS, AudioSampleSink } = library;
  const context = new OfflineAudioContext(config.channels, 16384, config.sampleRate);
  const buffer = context.createBuffer(config.channels, 16384, config.sampleRate);
  const reference = buffer.getChannelData(0);
  const signalStart = 4096;
  const signalLength = 4096;
  for (let i = 0; i < signalLength; i++) {
    const t = i / config.sampleRate;
    const phase = 2 * Math.PI * (700 * t + 2500 * config.sampleRate / signalLength * t * t);
    reference[signalStart + i] = 0.6 * Math.sin(phase) * Math.sin(Math.PI * i / signalLength) ** 2;
  }
  for (let channel = 1; channel < config.channels; channel++) buffer.copyToChannel(reference, channel);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new AudioBufferSource({ codec: "aac", bitrate: config.bitrate });
  output.addAudioTrack(source);
  let finalized = false;
  try {
    await output.start();
    await source.add(buffer);
    source.close();
    await output.finalize();
    finalized = true;
    if (!target.buffer) throw new Error("Audio timing probe produced no data.");
    // decodeAudioData applies an implicit AAC priming trim in Safari. Decode
    // timestamped packets instead so the measurement describes the stored file.
    const input = new Input({ source: new BufferSource(target.buffer), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error("Audio timing probe produced no audio track.");
      const decoded = new Float32Array(buffer.length + 8192);
      for await (const sample of new AudioSampleSink(track).samples()) {
        try {
          const pcm = sample.toAudioBuffer();
          if (pcm.sampleRate !== config.sampleRate) throw new Error("Audio timing probe changed its sample rate.");
          const offset = Math.round(sample.timestamp * config.sampleRate);
          if (offset < 0 || offset + pcm.length > decoded.length) throw new Error("Audio timing probe exceeded its sample window.");
          decoded.set(pcm.getChannelData(0), offset);
        } finally {
          sample.close();
        }
      }
      return measureSignalDelay(reference, decoded, signalStart, signalLength, 8192);
    } finally {
      input.dispose();
    }
  } finally {
    source.close();
    if (!finalized) await output.cancel().catch(() => {});
  }
}
