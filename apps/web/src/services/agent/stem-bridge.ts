import type { StemExportBridge } from "@openreel/agent";
import { exportStemsAsDownloads } from "../audio-stems";

/** Agent-facing stem export: renders through the export mixdown and downloads each WAV. */
export function createStemExportBridge(): StemExportBridge {
  return {
    async exportStems({ busIds, bitDepth }) {
      const stems = await exportStemsAsDownloads({ busIds, bitDepth });
      return stems.map((stem) => ({
        busId: stem.busId,
        name: stem.name,
        fileName: stem.fileName,
        bytes: stem.wav.byteLength,
        sampleRate: stem.sampleRate,
        channels: stem.channels,
        durationSec: stem.frames / stem.sampleRate,
      }));
    },
  };
}
