export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface AudioSegmentMetrics {
  start: number;
  end: number;
  rmsDb: number;
  peakDb: number;
  speechRate: number;
  isSilence: boolean;
}

export interface HighlightAnalysisResult {
  segments: AudioSegmentMetrics[];
  duration: number;
}

export function analyzeAudioForHighlights(
  buffer: AudioBuffer,
  transcript: TranscriptWord[],
  segmentDuration: number = 5,
): HighlightAnalysisResult {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;
  const segmentCount = Math.ceil(duration / segmentDuration);
  const segments: AudioSegmentMetrics[] = [];
  const silenceThreshold = Math.pow(10, -60 / 20);

  for (let i = 0; i < segmentCount; i++) {
    const segStart = i * segmentDuration;
    const segEnd = Math.min((i + 1) * segmentDuration, duration);

    const startSample = Math.floor(segStart * sampleRate);
    const endSample = Math.min(Math.floor(segEnd * sampleRate), channelData.length);

    let sumSquares = 0;
    let peak = 0;
    let maxAmp = 0;
    const sampleCount = endSample - startSample;

    for (let j = startSample; j < endSample; j++) {
      const sample = Math.abs(channelData[j]);
      sumSquares += sample * sample;
      peak = Math.max(peak, sample);
      maxAmp = Math.max(maxAmp, sample);
    }

    const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
    const rmsDb = 20 * Math.log10(rms || 0.0001);
    const peakDb = 20 * Math.log10(peak || 0.0001);
    const isSilence = maxAmp < silenceThreshold;

    const wordsInSegment = transcript.filter(
      (w) => w.start >= segStart && w.start < segEnd,
    );
    const segDuration = segEnd - segStart;
    const speechRate = segDuration > 0 ? wordsInSegment.length / segDuration : 0;

    segments.push({
      start: segStart,
      end: segEnd,
      rmsDb,
      peakDb,
      speechRate,
      isSilence,
    });
  }

  return { segments, duration };
}
