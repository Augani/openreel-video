import {
  clampDolbyBitrate,
  dolbyEncodeArgs,
  dolbyRawMuxer,
  isDolbyFormat,
  resolveDolbyAudioSettings,
  type DolbyCodec,
  type DolbyEncodeParams,
} from "../../../../../packages/core/src/export/dolby";

export type { DolbyCodec, DolbyEncodeParams };

/** The Dolby audio of a video export, as the start request carries it. */
export interface DolbyAudioPlan {
  codec: DolbyCodec;
  channels: number;
  bitrateKbps: number;
  sampleRate: number;
  dialnorm: number;
}

/** A Dolby plan from the export request's audio fields, or null when the audio is not Dolby. Throws on settings Dolby cannot carry. */
export function dolbyPlanFromRequest(request: {
  audioCodec?: string;
  audioChannels: number;
  audioSampleRate: number;
  audioBitrateKbps?: number;
  dialnorm?: number;
}): DolbyAudioPlan | null {
  if (request.audioCodec === undefined) return null;
  if (!isDolbyFormat(request.audioCodec)) throw new Error(`Unknown audio codec "${request.audioCodec}".`);
  if (request.audioChannels !== 2 && request.audioChannels !== 6) throw new Error("Dolby Digital delivery is stereo or 5.1.");
  const resolved = resolveDolbyAudioSettings({
    format: request.audioCodec,
    sampleRate: request.audioSampleRate as 48000,
    bitDepth: 16,
    bitrate: request.audioBitrateKbps ?? 0,
    channels: request.audioChannels,
    dialnorm: request.dialnorm,
  });
  return {
    codec: request.audioCodec,
    channels: request.audioChannels,
    bitrateKbps: resolved.bitrate,
    sampleRate: resolved.sampleRate,
    dialnorm: resolved.dialnorm ?? -31,
  };
}

/** `-c:a ac3|eac3` and its options for the audio track of a video export. */
export function dolbyTrackArgs(plan: DolbyAudioPlan): string[] {
  return dolbyEncodeArgs(plan);
}

/** A whole audio-only job: WAV in, raw `.ac3` / `.ec3` elementary stream out. */
export function buildDolbyStreamArgs(inputPath: string, outputPath: string, plan: DolbyAudioPlan): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-vn",
    ...dolbyTrackArgs({ ...plan, bitrateKbps: clampDolbyBitrate(plan.codec, plan.bitrateKbps) }),
    "-f", dolbyRawMuxer(plan.codec),
    outputPath,
  ];
}
