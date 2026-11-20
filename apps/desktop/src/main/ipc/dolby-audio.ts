import { promises as fs } from "node:fs";
import { MediaJob } from "../sidecar/media-job";
import { buildDolbyStreamArgs, type DolbyAudioPlan } from "../sidecar/dolby-args";
import { newTempPathReady, releaseTemp } from "../temp-dir";

/**
 * Audio-only Dolby export: the renderer's mixdown arrives as a WAV (L R C LFE Ls Rs for 5.1) and leaves as a raw
 * AC-3 / E-AC-3 elementary stream, encoded by the ffmpeg sidecar. The temp files are removed on every outcome.
 */
export async function encodeDolbyAudio(args: DolbyAudioPlan & { wav: ArrayBuffer }): Promise<ArrayBuffer> {
  const input = await newTempPathReady("openreel-dolby-in", "wav");
  const output = await newTempPathReady("openreel-dolby-out", args.codec === "eac3" ? "ec3" : "ac3");
  try {
    await fs.writeFile(input, Buffer.from(args.wav));
    await new MediaJob(buildDolbyStreamArgs(input, output, args)).run();
    const bytes = await fs.readFile(output);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    await Promise.allSettled([releaseTemp(input), releaseTemp(output)]);
  }
}
