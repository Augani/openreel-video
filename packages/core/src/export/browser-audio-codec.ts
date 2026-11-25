import type { AudioCodec } from "mediabunny";
import type { VideoExportSettings } from "./types";

type Library = Pick<typeof import("mediabunny"), "getFirstEncodableAudioCodec">;
let aacRegistration: Promise<void> | undefined;
let softwareAacRegistered = false;

/** The preflight, main encoder and worker must agree on what goes into the file. */
export async function browserAudioCodec(
  library: Library,
  settings: Pick<VideoExportSettings, "format" | "audioSettings">,
  containerCodecs: AudioCodec[],
): Promise<{ codec: AudioCodec; bitrate: number; softwareAac: boolean } | null> {
  const { format, audioSettings } = settings;
  const wantsAac = format === "mp4" || (format === "mov" && audioSettings.format === "aac");
  const candidates: AudioCodec[] = wantsAac ? ["aac"] : containerCodecs;
  const bitrates = new Set([audioSettings.bitrate * 1000, 192000, 128000, 96000]);
  const probe = async () => {
    for (const bitrate of bitrates) {
      const codec = await library.getFirstEncodableAudioCodec(candidates, {
        numberOfChannels: audioSettings.channels, sampleRate: audioSettings.sampleRate, bitrate,
      });
      if (codec && candidates.includes(codec)) return { codec, bitrate, softwareAac: codec === "aac" && softwareAacRegistered };
    }
    return null;
  };
  const native = await probe();
  if (native || !wantsAac) return native;
  aacRegistration ??= import("@mediabunny/aac-encoder")
    .then(({ registerAacEncoder }) => { registerAacEncoder(); softwareAacRegistered = true; })
    .catch((error: unknown) => { aacRegistration = undefined; throw error; });
  await aacRegistration;
  return probe();
}
