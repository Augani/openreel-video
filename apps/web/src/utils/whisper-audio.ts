const WHISPER_SAMPLE_RATE = 16_000;

/** Mix an AudioBuffer to mono and resample only the selected source range. */
export function audioBufferToWhisperSamples(
  audioBuffer: AudioBuffer,
  startTime = 0,
  endTime = audioBuffer.duration,
): Float32Array {
  const sourceRate = audioBuffer.sampleRate;
  const startFrame = Math.max(
    0,
    Math.min(audioBuffer.length, Math.floor(startTime * sourceRate)),
  );
  const endFrame = Math.max(
    startFrame,
    Math.min(audioBuffer.length, Math.ceil(endTime * sourceRate)),
  );
  const sourceLength = endFrame - startFrame;
  if (sourceLength === 0) return new Float32Array();

  const outputLength = Math.max(
    1,
    Math.round((sourceLength * WHISPER_SAMPLE_RATE) / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index),
  );
  const sourceFramesPerOutput = sourceRate / WHISPER_SAMPLE_RATE;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = startFrame + outputIndex * sourceFramesPerOutput;
    const leftIndex = Math.min(endFrame - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(endFrame - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    let mixed = 0;
    for (const channel of channels) {
      mixed +=
        channel[leftIndex] +
        (channel[rightIndex] - channel[leftIndex]) * fraction;
    }
    output[outputIndex] = mixed / channels.length;
  }

  return output;
}

export { WHISPER_SAMPLE_RATE };
