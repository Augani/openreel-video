import { SURROUND_CHANNEL_NAMES, type RealtimeAudioGraph } from "@openreel/core";

export interface SignalLevel {
  readonly peak: number;
  readonly rms: number;
}
/** One level per channel of the mix: two for stereo, six (L R C LFE Ls Rs) for a 5.1 sequence. */
export type SignalLevels = readonly SignalLevel[];
/** Kept for callers written before 5.1 metering; a stereo mix reads exactly two entries. */
export type StereoSignalLevels = SignalLevels;
export const SILENT_SIGNAL_LEVELS: SignalLevels = [
  { peak: 0, rms: 0 },
  { peak: 0, rms: 0 },
];
const SILENT_SURROUND_LEVELS: SignalLevels = Array.from({ length: 6 }, () => ({ peak: 0, rms: 0 }));

/** Silence with the right number of meters for a mix of `channels` channels. */
export const silentLevels = (channels: number): SignalLevels =>
  channels === 6 ? SILENT_SURROUND_LEVELS : SILENT_SIGNAL_LEVELS;

/** Meter labels of a mix: the 5.1 speaker names in channel order, or L R. */
export const meterChannelNames = (channels: number): readonly string[] =>
  channels === 6 ? SURROUND_CHANNEL_NAMES : ["L", "R"];

function measure(samples: Float32Array): SignalLevel {
  let peak = 0;
  let energy = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  return { peak, rms: Math.sqrt(energy / samples.length) };
}

/** Channels the live mix carries (older graph stand-ins without the query are stereo). */
const mixChannels = (graph: RealtimeAudioGraph): number =>
  typeof graph.getMixChannelCount === "function" ? graph.getMixChannelCount() : 2;

/**
 * Reads actual per-channel samples (two, or six in a 5.1 sequence) without
 * routing another signal to the speakers. The tap follows the layout: it is
 * rebuilt when the mix changes between stereo and 5.1.
 */
export function createMixerSignalMeter(
  graph: RealtimeAudioGraph,
  trackId?: string,
  busId?: string,
) {
  const context = graph.getAudioContext();
  let source: GainNode | undefined;
  let stereo: GainNode | undefined;
  let splitter: ChannelSplitterNode | undefined;
  let boundChannels = 2;
  let analysers: AnalyserNode[] = [];
  let buffers: Float32Array<ArrayBuffer>[] = [];
  let disposed = false;

  const disconnect = () => {
    if (source && stereo) {
      try {
        source.disconnect(stereo);
      } catch {
        /* Playback may have removed the track. */
      }
    }
    stereo?.disconnect();
    splitter?.disconnect();
    analysers.forEach((node) => node.disconnect());
    source = undefined;
    stereo = undefined;
    splitter = undefined;
    analysers = [];
    buffers = [];
  };

  return {
    read(): SignalLevels {
      const channels = mixChannels(graph);
      if (disposed || context.state !== "running") return silentLevels(channels);
      const output = busId
        ? graph.getBusOutputGain(busId)
        : trackId
          ? graph.getTrackOutputGain(trackId)
          : graph.getMasterGain();
      // Seeking can recreate a track's nodes. Rebind the tap to its current output.
      if (output !== source || channels !== boundChannels) {
        disconnect();
        if (output) {
          source = output;
          boundChannels = channels;
          stereo = context.createGain();
          stereo.channelCount = channels;
          stereo.channelCountMode = "explicit";
          // Stereo: speaker rules (mono reaches both meters). 5.1: discrete, each speaker feed on its own meter.
          stereo.channelInterpretation = channels > 2 ? "discrete" : "speakers";
          splitter = context.createChannelSplitter(channels);
          analysers = Array.from({ length: channels }, () => context.createAnalyser());
          buffers = analysers.map((analyser, channel) => {
            analyser.fftSize = 2048;
            splitter!.connect(analyser, channel);
            return new Float32Array(analyser.fftSize);
          });
          source.connect(stereo);
          stereo.connect(splitter);
        }
      }
      if (!source) return silentLevels(channels);
      return analysers.map((analyser, index) => {
        analyser.getFloatTimeDomainData(buffers[index]);
        return measure(buffers[index]);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnect();
    },
  };
}
