/**
 * Project Manager transcode presets and the size model behind the disk-space estimate.
 *
 * Bits per pixel per frame are Apple's published ProRes data rates at 1080p29.97 (LT 102, 422 147, HQ 220 Mbit/s),
 * which real camera footage lands close to; DNxHR is constant per frame, measured from the sidecar's encoder
 * (SQ 2.31, HQ 3.52); H.264 is capped by `-maxrate` at `H264_MAX_BPP`, so its estimate is a typical
 * size and its cap an upper bound.
 */

export type ConsolidatePresetId =
  | "match-source"
  | "prores-422-lt"
  | "prores-422"
  | "prores-422-hq"
  | "dnxhr-sq"
  | "dnxhr-hq"
  | "h264";

export type ConcretePresetId = Exclude<ConsolidatePresetId, "match-source">;

export interface PresetInfo {
  readonly id: ConcretePresetId;
  readonly label: string;
  readonly codec: "prores" | "dnxhd" | "h264";
  readonly container: "mov" | "mp4";
  /** `prores_ks -profile:v` or `dnxhd -profile:v`. */
  readonly profile?: string;
  /** Typical bits per pixel per frame of the encoded picture. */
  readonly bpp: number;
}

export const H264_MAX_BPP = 0.8;
const H264_TYPICAL_BPP = 0.45;

export const CONSOLIDATE_PRESETS: readonly PresetInfo[] = [
  { id: "prores-422-lt", label: "ProRes 422 LT", codec: "prores", container: "mov", profile: "1", bpp: 1.64 },
  { id: "prores-422", label: "ProRes 422", codec: "prores", container: "mov", profile: "2", bpp: 2.36 },
  { id: "prores-422-hq", label: "ProRes 422 HQ", codec: "prores", container: "mov", profile: "3", bpp: 3.54 },
  { id: "dnxhr-sq", label: "DNxHR SQ", codec: "dnxhd", container: "mov", profile: "dnxhr_sq", bpp: 2.31 },
  { id: "dnxhr-hq", label: "DNxHR HQ", codec: "dnxhd", container: "mov", profile: "dnxhr_hq", bpp: 3.52 },
  { id: "h264", label: "H.264 (high quality)", codec: "h264", container: "mp4", bpp: H264_TYPICAL_BPP },
];

export const PRESET_CHOICES: ReadonlyArray<{ id: ConsolidatePresetId; label: string }> = [
  { id: "match-source", label: "Match source" },
  ...CONSOLIDATE_PRESETS.map(({ id, label }) => ({ id, label })),
];

export function presetInfo(id: ConcretePresetId): PresetInfo {
  const found = CONSOLIDATE_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown preset ${id}`);
  return found;
}

/**
 * "Match source" keeps a source's codec family: ProRes stays ProRes (422 HQ), DNx stays DNxHR (HQ), and anything
 * else (H.264, HEVC, MPEG-4, ...) becomes high-quality H.264, the one lossy format every part of the app can read.
 */
export function resolvePreset(preset: ConsolidatePresetId, sourceCodec: string | undefined): ConcretePresetId {
  if (preset !== "match-source") return preset;
  const codec = (sourceCodec ?? "").toLowerCase();
  if (codec === "prores") return "prores-422-hq";
  if (codec === "dnxhd" || codec === "dnxhr") return "dnxhr-hq";
  return "h264";
}

/** Bytes per second of the encoded picture. */
export function videoBytesPerSecond(preset: ConcretePresetId, width: number, height: number, fps: number): number {
  const info = presetInfo(preset);
  return (info.bpp * Math.max(1, width) * Math.max(1, height) * Math.max(1, fps)) / 8;
}

/** Bytes per second of the PCM audio written next to the picture. */
export function audioBytesPerSecond(channels: number, sampleRate: number, bytesPerSample = 2): number {
  return Math.max(1, channels) * Math.max(8000, sampleRate) * bytesPerSample;
}

/** Hard ceiling for the `-maxrate` of an H.264 preset, bits per second. */
export function h264MaxRateBits(width: number, height: number, fps: number): number {
  return Math.round(H264_MAX_BPP * Math.max(1, width) * Math.max(1, height) * Math.max(1, fps));
}
