/**
 * Dolby Digital (AC-3) and Dolby Digital Plus (E-AC-3) delivery: the pure rules shared by the export dialog, the
 * export engine and the two encoders (the desktop ffmpeg sidecar and the browser's ffmpeg.wasm core).
 *
 * Both encoders are ffmpeg's `ac3` / `eac3`. The mix reaches them as a Stereo or 5.1 buffer in the order the 5.1
 * mixer produces, L R C LFE Ls Rs (Web Audio / SMPTE, WAV mask 0x3F); ffmpeg's `5.1(side)` layout lists the same
 * six channels in the same order, which is what AC-3 carries (acmod 7 with the LFE flag).
 */

import type { AudioExportSettings } from "./types";

export type DolbyCodec = "ac3" | "eac3";

/** Audio export formats that are Dolby: the raw elementary stream (`.ac3` / `.ec3`) or the audio track of a video file. */
export type DolbyAudioFormat = DolbyCodec;

export const DOLBY_CODECS: readonly DolbyCodec[] = ["ac3", "eac3"];

export const isDolbyFormat = (format: string | undefined): format is DolbyAudioFormat => format === "ac3" || format === "eac3";

/** Display names: "Dolby Digital" is AC-3, "Dolby Digital Plus" is E-AC-3. */
export const DOLBY_LABEL: Record<DolbyCodec, string> = {
  ac3: "Dolby Digital (AC-3)",
  eac3: "Dolby Digital Plus (E-AC-3)",
};

/** File extension of a raw elementary stream: `.ac3` for AC-3, `.ec3` for E-AC-3. */
export const dolbyFileExtension = (codec: DolbyCodec): "ac3" | "ec3" => (codec === "eac3" ? "ec3" : "ac3");

export const dolbyMimeType = (codec: DolbyCodec): string => (codec === "eac3" ? "audio/eac3" : "audio/ac3");

/**
 * Bitrates (kbps) the delivery offers. AC-3 is defined from 32 to 640 kbps in fixed steps (ATSC A/52 table
 * 5.18); the picker offers the broadcast / DVD / Blu-ray range, 192 to 640. E-AC-3 goes higher: the picker stops
 * at 1024 kbps, the limit of the broadcast and streaming profiles (the encoder itself accepts more).
 */
export const DOLBY_BITRATES: Record<DolbyCodec, readonly number[]> = {
  ac3: [192, 224, 256, 320, 384, 448, 512, 576, 640],
  eac3: [192, 256, 320, 384, 448, 512, 576, 640, 768, 896, 1024],
};

/** Every bitrate the AC-3 bitstream can signal, kbps. */
export const AC3_VALID_BITRATES: readonly number[] = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640];

/** Typical delivery rate: 192 kbps stereo AC-3, 448 kbps 5.1 AC-3 (DVD / broadcast), 640 kbps 5.1 E-AC-3. */
export function defaultDolbyBitrate(codec: DolbyCodec, channels: number): number {
  if (codec === "eac3") return channels > 2 ? 640 : 256;
  return channels > 2 ? 448 : 192;
}

/** The nearest offered bitrate at or above `kbps` (below the first offer: the first; above the last: the last). */
export function clampDolbyBitrate(codec: DolbyCodec, kbps: number): number {
  const options = DOLBY_BITRATES[codec];
  if (!Number.isFinite(kbps)) return options[0];
  const requested = Math.round(kbps);
  return options.find((option) => option >= requested) ?? options[options.length - 1];
}

/** Dialogue level metadata in dB (dBFS, A-weighted dialogue average): -31 (no attenuation by the decoder) to -1. */
export const DIALNORM_MIN = -31;
export const DIALNORM_MAX = -1;
export const DEFAULT_DIALNORM = -31;

export const clampDialnorm = (value: number): number =>
  Number.isFinite(value) ? Math.max(DIALNORM_MIN, Math.min(DIALNORM_MAX, Math.round(value))) : DEFAULT_DIALNORM;

/**
 * The dialnorm to write. An explicit value wins. Without one, a loudness-targeted export declares the target it
 * normalised to (so a -24 LUFS broadcast mix is flagged -24), and anything else leaves the decoder level alone (-31).
 */
export function resolveDialnorm(audio: { dialnorm?: number; loudness?: { enabled?: boolean; targetLufs?: number } }): number {
  if (audio.dialnorm !== undefined) return clampDialnorm(audio.dialnorm);
  const loudness = audio.loudness;
  if (loudness?.enabled && typeof loudness.targetLufs === "number") return clampDialnorm(loudness.targetLufs);
  return DEFAULT_DIALNORM;
}

/** AC-3 and E-AC-3 carry 32, 44.1 or 48 kHz; the delivery is 48 kHz and a 96 kHz setting is written at 48 kHz. */
export const dolbySampleRate = (requested: number): 44100 | 48000 => (requested === 44100 ? 44100 : 48000);

/** Channel counts the delivery supports: stereo and 5.1. */
export const isDolbyChannelCount = (channels: number): channels is 2 | 6 => channels === 2 || channels === 6;

/** Video containers that carry AC-3 / E-AC-3 (`ac-3` / `ec-3` sample entries in MP4 and MOV, A_AC3 / A_EAC3 in Matroska). */
export const DOLBY_VIDEO_CONTAINERS: readonly string[] = ["mp4", "mov", "mkv"];

/** Why `container` cannot carry Dolby audio, or null when it can. */
export function dolbyContainerProblem(container: string): string | null {
  if (DOLBY_VIDEO_CONTAINERS.includes(container)) return null;
  if (container === "webm") return "WebM cannot carry AC-3 or E-AC-3 (it takes Opus or Vorbis). Choose MP4, MOV or MKV.";
  if (container === "mxf") return "MXF deliveries carry PCM audio here. Choose MP4, MOV or MKV for Dolby Digital audio.";
  return `${container.toUpperCase()} cannot carry AC-3 or E-AC-3.`;
}

/** Why an AC-3 / E-AC-3 delivery cannot be written with this many channels, or null. */
export function dolbyChannelsProblem(channels: number): string | null {
  return isDolbyChannelCount(channels) ? null : "Dolby Digital delivery is stereo or 5.1. Mono and other layouts are not supported.";
}

/**
 * The reason Dolby delivery needs the desktop app, shown where the choice is made. The browser build cannot mux
 * AC-3 into a video file (MediaBunny has no AC-3 track, and WebCodecs has no AC-3 encoder); the audio-only
 * `.ac3` / `.ec3` export runs on the ffmpeg.wasm core.
 */
export const DOLBY_VIDEO_DESKTOP_ONLY_REASON =
  "AC-3 and E-AC-3 audio in a video file needs the desktop app. The browser muxer (MediaBunny) cannot write an AC-3 track; audio-only .ac3 / .ec3 export works in the browser.";

/** Settings problems of a Dolby delivery (empty when fine); used by validation before any work starts. */
export function dolbyDeliveryProblems(
  audio: { format: string; channels: number },
  container?: string,
): string[] {
  if (!isDolbyFormat(audio.format)) return [];
  const problems: string[] = [];
  const channels = dolbyChannelsProblem(audio.channels);
  if (channels) problems.push(channels);
  if (container) {
    const problem = dolbyContainerProblem(container);
    if (problem) problems.push(problem);
  }
  return problems;
}

/**
 * ffmpeg `-b:a` value for a Dolby delivery; the bitrate is snapped to an offered rate (AC-3 can only signal a
 * fixed list, an unlisted value would be refused by the encoder or silently rounded).
 */
export function dolbyEncoderBitrateKbps(codec: DolbyCodec, requested: number): number {
  return clampDolbyBitrate(codec, requested);
}

/**
 * Where `ffmpeg -i <wav>` puts the channels is already the AC-3 order, so only the label needs fixing: a plain
 * six-channel WAV reads as 5.1(back) and the encoder carries 5.1(side); `channelmap` by index relabels without
 * mixing. Measured against the shipped ffmpeg: every channel decodes back at 0.0 dB on its own slot.
 */
export const DOLBY_5_1_CHANNELMAP = "channelmap=map=0|1|2|3|4|5:channel_layout=5.1(side)";

/**
 * The audio settings a Dolby delivery actually uses: 44.1 or 48 kHz, an offered bitrate (a stereo-sized or
 * AAC-sized value is snapped, an unset one gets the usual rate for the channel count) and the dialnorm to write.
 * Other formats are returned unchanged.
 */
export function resolveDolbyAudioSettings(audio: AudioExportSettings): AudioExportSettings {
  if (!isDolbyFormat(audio.format)) return audio;
  const codec = audio.format;
  const bitrate = audio.bitrate > 0 ? clampDolbyBitrate(codec, audio.bitrate) : defaultDolbyBitrate(codec, audio.channels);
  return { ...audio, sampleRate: dolbySampleRate(audio.sampleRate), bitrate, dialnorm: resolveDialnorm(audio) };
}

export interface DolbyEncodeParams {
  codec: DolbyCodec;
  /** 2 (stereo) or 6 (5.1, L R C LFE Ls Rs). */
  channels: number;
  bitrateKbps: number;
  sampleRate: number;
  /** dB, -31 to -1. */
  dialnorm: number;
}

/**
 * The ffmpeg audio options that encode a PCM input into AC-3 / E-AC-3: the `ac3` / `eac3` encoder at an offered
 * bitrate and 44.1 / 48 kHz, the dialnorm, and for 5.1 the by-index relabel to the encoder's layout. The desktop
 * sidecar and the browser's ffmpeg.wasm core both run these, so the two deliveries come out the same.
 */
export function dolbyEncodeArgs(params: DolbyEncodeParams): string[] {
  const channels = params.channels > 2 ? 6 : 2;
  return [
    ...(channels === 6 ? ["-af", DOLBY_5_1_CHANNELMAP] : []),
    "-c:a", params.codec,
    "-b:a", `${clampDolbyBitrate(params.codec, params.bitrateKbps)}k`,
    "-ar", String(dolbySampleRate(params.sampleRate)),
    "-dialnorm", String(clampDialnorm(params.dialnorm)),
  ];
}

/** ffmpeg muxer of a raw Dolby elementary stream. */
export const dolbyRawMuxer = (codec: DolbyCodec): "ac3" | "eac3" => codec;
