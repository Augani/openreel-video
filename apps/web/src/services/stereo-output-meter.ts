import type { RealtimeAudioGraph } from "@openreel/core";

export type StereoOutputLevels = readonly [number, number];
export const OUTPUT_METER_FLOOR = -60;

function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak > 0
    ? Math.max(OUTPUT_METER_FLOOR, Math.min(0, 20 * Math.log10(peak)))
    : OUTPUT_METER_FLOOR;
}

/** A silent analysis branch after master volume and preview mute. */
export function createStereoOutputMeter(graph: RealtimeAudioGraph) {
  const context = graph.getAudioContext();
  const output = graph.getMasterGain();
  const stereo = context.createGain();
  // Match speaker upmix at the output: mono material reaches both meters.
  stereo.channelCount = 2;
  stereo.channelCountMode = "explicit";
  stereo.channelInterpretation = "speakers";
  const splitter = context.createChannelSplitter(2);
  const analysers = [context.createAnalyser(), context.createAnalyser()];
  const buffers = analysers.map((analyser, channel) => {
    analyser.fftSize = 2048;
    splitter.connect(analyser, channel);
    return new Float32Array(analyser.fftSize);
  });
  output.connect(stereo);
  stereo.connect(splitter);
  let disposed = false;
  return {
    read(): StereoOutputLevels {
      if (disposed || context.state !== "running")
        return [OUTPUT_METER_FLOOR, OUTPUT_METER_FLOOR];
      const values = analysers.map((analyser, index) => {
        analyser.getFloatTimeDomainData(buffers[index]);
        return Math.round(peakDb(buffers[index]) * 10) / 10;
      });
      return [values[0], values[1]];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        output.disconnect(stereo);
      } catch {
        // The preview graph may already have disconnected during shutdown.
      }
      stereo.disconnect();
      splitter.disconnect();
      analysers.forEach((analyser) => analyser.disconnect());
    },
  };
}
