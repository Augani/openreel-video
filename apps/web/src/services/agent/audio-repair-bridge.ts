import type { AudioRepairBridge } from "@openreel/agent";
import { analyzeClip } from "../audio-repair";

/** Agent-facing clip audio analysis: decodes the clip through the export mixdown and runs the issue detectors. */
export function createAudioRepairBridge(): AudioRepairBridge {
  return {
    async analyze(clipId) {
      const { report, suggestions } = await analyzeClip(clipId);
      return { report, suggestions };
    },
  };
}
