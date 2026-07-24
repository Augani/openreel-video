import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { isSoftwareEncoder } from "./encode-args";

const run = promisify(execFile);

export function parseEncoders(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[VAS]\S{5}\s/.test(line))
    .map((line) => line.split(/\s+/)[1])
    .filter(Boolean);
}

type Codec = "h264" | "h265" | "hevc" | "av1" | "prores" | "vp9";

const PREFERENCE: Partial<Record<Codec, Partial<Record<NodeJS.Platform | "any", string[]>>>> = {
  h264: {
    darwin: ["h264_videotoolbox"],
    win32: ["h264_nvenc", "h264_qsv", "h264_amf"],
    linux: ["h264_nvenc", "h264_vaapi"],
    any: ["libx264"],
  },
  hevc: {
    darwin: ["hevc_videotoolbox"],
    win32: ["hevc_nvenc", "hevc_qsv", "hevc_amf"],
    linux: ["hevc_nvenc", "hevc_vaapi"],
    any: ["libx265"],
  },
  av1: {
    win32: ["av1_nvenc", "av1_qsv", "av1_amf"],
    linux: ["av1_nvenc", "av1_vaapi"],
    any: ["libsvtav1"],
  },
  prores: {
    darwin: ["prores_videotoolbox", "prores_ks"],
    any: ["prores_ks"],
  },
};

export function selectEncoder(
  codec: string,
  platform: NodeJS.Platform,
  available: string[],
  mode: "fast" | "balanced" | "smallest" = "balanced",
): string | null {
  const key = (codec === "h265" ? "hevc" : codec) as Codec;
  const pref = PREFERENCE[key];
  if (!pref) return null;
  const hardwareFirst = [...(pref[platform] ?? []), ...(pref.any ?? [])];
  const softwareFirst = [
    ...(pref.any ?? []),
    ...(pref[platform] ?? []),
  ];
  const ordered = mode === "smallest" ? softwareFirst : hardwareFirst;
  const pick = ordered.find((c) => available.includes(c));
  if (pick) return pick;
  return (
    [...hardwareFirst, ...softwareFirst].find(
      (c) => available.includes(c) && isSoftwareEncoder(c),
    ) ??
    [...hardwareFirst].find((c) => available.includes(c)) ??
    null
  );
}

export async function probeEncoders(): Promise<string[]> {
  try {
    const { stdout } = await run(resolveFfmpegPath(), ["-hide_banner", "-encoders"], { maxBuffer: 4 * 1024 * 1024 });
    return parseEncoders(stdout);
  } catch {
    return [];
  }
}
