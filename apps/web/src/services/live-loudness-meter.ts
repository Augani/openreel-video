import { LoudnessMeter, type LoudnessSnapshot, type RealtimeAudioGraph } from "@openreel/core";

const FFT_SIZE = 32768;

/**
 * Live BS.1770 loudness tap on the master output. Two silent AnalyserNodes
 * (left/right) buffer the audio on the audio thread; every poll takes only the
 * samples that arrived since the previous poll (from AudioContext.currentTime)
 * and feeds them to the streaming meter, so nothing runs per audio frame on the
 * main thread and a 10 Hz poll costs well under a millisecond.
 */
export function createLiveLoudnessTap(graph: RealtimeAudioGraph) {
  const context = graph.getAudioContext();
  let source: AudioNode | undefined;
  let stereo: GainNode | undefined;
  let splitter: ChannelSplitterNode | undefined;
  let analysers: AnalyserNode[] = [];
  let buffers: Float32Array<ArrayBuffer>[] = [];
  // 2 channels for stereo; 6 (L R C LFE Ls Rs, BS.1770 weights 1 1 1 0 1.41 1.41) for a 5.1 sequence.
  let channelCount = graph.getMixChannelCount();
  let meter = new LoudnessMeter(context.sampleRate, channelCount);
  let lastTime = 0;
  let disposed = false;

  const disconnect = () => {
    if (source && stereo) {
      try {
        source.disconnect(stereo);
      } catch {
        /* the graph may have rebuilt the node */
      }
    }
    stereo?.disconnect();
    splitter?.disconnect();
    analysers.forEach((node) => node.disconnect());
    source = stereo = undefined;
    splitter = undefined;
    analysers = [];
    buffers = [];
  };

  const bind = (output: AudioNode) => {
    disconnect();
    source = output;
    stereo = context.createGain();
    stereo.channelCount = channelCount;
    stereo.channelCountMode = "explicit";
    // Six channels are read as they are (discrete); stereo keeps the speaker mix-down rule it always had.
    stereo.channelInterpretation = channelCount === 2 ? "speakers" : "discrete";
    splitter = context.createChannelSplitter(channelCount);
    analysers = Array.from({ length: channelCount }, () => context.createAnalyser());
    buffers = analysers.map((analyser, channel) => {
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      splitter!.connect(analyser, channel);
      return new Float32Array(analyser.fftSize);
    });
    output.connect(stereo);
    stereo.connect(splitter);
    lastTime = context.currentTime;
  };

  return {
    /** Pull newly arrived audio into the meter and return its readout. */
    read(): LoudnessSnapshot {
      if (disposed) return meter.snapshot();
      if (context.state !== "running") {
        // Nothing is being rendered, so the analysers hold stale audio; do not
        // count it when the context resumes.
        lastTime = context.currentTime;
        return meter.snapshot();
      }
      const output = graph.getMasterGain();
      const channels = graph.getMixChannelCount();
      if (channels !== channelCount) {
        // The sequence changed layout: the meter's channel weights change with it.
        channelCount = channels;
        meter = new LoudnessMeter(context.sampleRate, channelCount);
        disconnect();
      }
      if (output !== source) bind(output);
      const now = context.currentTime;
      const elapsed = Math.max(0, now - lastTime);
      lastTime = now;
      let fresh = Math.round(elapsed * context.sampleRate);
      if (fresh > 0) {
        if (fresh > FFT_SIZE) fresh = FFT_SIZE; // a throttled tab dropped audio; keep what is left
        analysers.forEach((analyser, index) => analyser.getFloatTimeDomainData(buffers[index]));
        const tail = buffers.map((buffer) => buffer.subarray(FFT_SIZE - fresh));
        meter.process(tail, fresh);
      }
      return meter.snapshot();
    },
    reset(): void {
      meter = new LoudnessMeter(context.sampleRate, channelCount);
      lastTime = context.currentTime;
    },
    dispose(): void {
      disposed = true;
      disconnect();
    },
  };
}
