import type { Project } from "../types/project";
import { getChannelLayout, SURROUND_CHANNELS, type ChannelLayout } from "../audio/surround";
import type { AudioExportSettings } from "./types";

/** 5.1 AAC (and AC-3 / E-AC-3) below this sounds poor; a stereo-sized bitrate is raised to it. */
export const SURROUND_MIN_AAC_BITRATE_KBPS = 384;

/** Windows channel mask of a 5.1 file: FL FR FC LFE BL BR (the order L R C LFE Ls Rs is stored in). */
export const WAV_MASK_5_1 = 0x3f;

/** Apple `chan` atom layout tag kAudioChannelLayoutTag_MPEG_5_1_A: L R C LFE Ls Rs. */
export const CHAN_TAG_MPEG_5_1_A = (121 << 16) | 6;

/**
 * Audio settings an export of `project` uses. A stereo sequence is returned
 * unchanged (same object). A 5.1 sequence delivers six channels unless the
 * export asks for "stereo" (then it is mixed in 5.1 and downmixed, see
 * `downmixSurroundToStereo`), at a bitrate that suits 5.1.
 */
export function resolveSequenceAudioSettings(project: Pick<Project, "settings">, audio: AudioExportSettings): AudioExportSettings {
  if (getChannelLayout(project.settings) !== "5.1") return audio;
  const layout: ChannelLayout = audio.channelLayout === "stereo" ? "stereo" : "5.1";
  if (layout === "stereo") return audio.channels === 2 ? audio : { ...audio, channels: 2 };
  return {
    ...audio,
    channels: SURROUND_CHANNELS,
    bitrate: Math.max(audio.bitrate, SURROUND_MIN_AAC_BITRATE_KBPS),
  };
}

/** True when the delivered audio has more than two channels. */
export const isSurroundDelivery = (audio: Pick<AudioExportSettings, "channels">): boolean => audio.channels > 2;

/** Why a 6-channel delivery cannot be written in `format`, or null when it can. */
export function surroundFormatProblem(videoFormat: "mp4" | "webm" | "mov" | "mxf" | "mkv"): string | null {
  return videoFormat === "webm"
    ? "5.1 audio needs AAC, which MP4 and MOV carry. WebM export is stereo: switch the container to MP4 or MOV, or set the audio to Stereo."
    : null;
}

/** Little-endian PCM WAV with N channels. More than two channels use WAVE_FORMAT_EXTENSIBLE with a speaker mask. */
export function encodeMultichannelWav(channels: readonly Float32Array[], sampleRate: number, bitDepth: 16 | 24 | 32, channelMask = WAV_MASK_5_1): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = bitDepth / 8;
  const extensible = count > 2;
  const fmtSize = extensible ? 40 : 16;
  const dataSize = frames * count * bytes;
  const out = new Uint8Array(12 + 8 + fmtSize + 8 + dataSize + (dataSize % 2));
  const view = new DataView(out.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  };
  const isFloat = bitDepth === 32;
  text(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, extensible ? 0xfffe : isFloat ? 3 : 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * bytes, true);
  view.setUint16(32, count * bytes, true);
  view.setUint16(34, bitDepth, true);
  if (extensible) {
    view.setUint16(36, 22, true); // cbSize
    view.setUint16(38, bitDepth, true); // valid bits
    view.setUint32(40, channelMask, true);
    // KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT: {0000000x-0000-0010-8000-00aa00389b71}
    view.setUint16(44, isFloat ? 3 : 1, true);
    out.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 46);
  }
  const dataAt = 20 + fmtSize;
  text(dataAt, "data");
  view.setUint32(dataAt + 4, dataSize, true);
  let offset = dataAt + 8;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 16) {
        view.setInt16(offset, Math.round(s < 0 ? s * 32768 : s * 32767), true);
      } else if (bitDepth === 24) {
        const v = Math.round(s < 0 ? s * 8388608 : s * 8388607);
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
      } else {
        view.setFloat32(offset, channels[c][i], true);
      }
      offset += bytes;
    }
  }
  return out;
}
