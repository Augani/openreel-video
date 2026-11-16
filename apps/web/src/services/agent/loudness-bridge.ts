import type { LoudnessBridge, LoudnessMeasurement } from "@openreel/agent";
import type { LoudnessAnalysis } from "@openreel/core";
import { analyzeTimelineLoudness, measureTimelineClipLoudness } from "../loudness";
import { analyzeBusLoudnessNow } from "../audio-stems";

const finite = (value: number): number | null => (Number.isFinite(value) ? value : null);

export function toLoudnessMeasurement(a: LoudnessAnalysis): LoudnessMeasurement {
  return {
    integratedLufs: finite(a.integrated),
    loudnessRangeLu: a.loudnessRange,
    truePeakDbtp: finite(a.truePeak),
    samplePeakDbfs: finite(a.samplePeak),
    momentaryMaxLufs: finite(a.momentaryMax),
    shortTermMaxLufs: finite(a.shortTermMax),
    durationSec: a.rangeDuration,
    sampleRate: a.sampleRate,
    channels: a.channels,
  };
}

/** Offline BS.1770-4 measurement through the same mixdown path the export uses. */
export function createLoudnessBridge(): LoudnessBridge {
  return {
    async measureTimeline(range) {
      return toLoudnessMeasurement(await analyzeTimelineLoudness({ range }));
    },
    async measureClip(clipId) {
      const { clipId: audibleId, measured } = await measureTimelineClipLoudness(clipId);
      return { clipId: audibleId, ...toLoudnessMeasurement(measured) };
    },
    async measureBus(busId) {
      return { busId, ...toLoudnessMeasurement(await analyzeBusLoudnessNow(busId)) };
    },
  };
}
