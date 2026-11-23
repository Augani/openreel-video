import type { SpectralSourceBridge } from "@openreel/agent";

/** Longest source the agent's tone / click finders will analyse; longer media is refused so a tool call cannot stall the editor. */
const MAX_ANALYSIS_SECONDS = 600;

/** The decoded source of a clip (the same decode the spectral editor uses), mixed to mono, for the tone and click finders. */
export function createSpectralSourceBridge(): SpectralSourceBridge {
  return {
    async getSource(clipId) {
      const { loadSpectralSource } = await import("../spectral-edit");
      const source = await loadSpectralSource(clipId);
      if (source.duration > MAX_ANALYSIS_SECONDS) throw new Error(`This clip's media is longer than ${MAX_ANALYSIS_SECONDS / 60} minutes; trim it before searching for tones or clicks.`);
      const { buffer } = source;
      const mono = new Float32Array(buffer.length);
      const channels = buffer.numberOfChannels;
      for (let c = 0; c < channels; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i += 1) mono[i] += data[i] / channels;
      }
      return { mono, sampleRate: buffer.sampleRate, duration: source.duration };
    },
  };
}
