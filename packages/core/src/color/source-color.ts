/**
 * Source colour management: what a media file says its pixels mean
 * (primaries / transfer / matrix / range), how the user can override that
 * ("Interpret footage"), and which input transform the pipeline then applies.
 *
 * Detection reads container metadata only: mediabunny's decoder-config colour
 * space on every platform, and the ffmpeg stream tags on the desktop.
 */

import type { RawOutputColorSpace } from "../raw/color";
import { CAMERA_LOGS, type CameraGamutId, type CameraLogId } from "./camera-log";

export type SourcePrimaries = "bt709" | "bt2020" | "p3" | "bt601" | Exclude<CameraGamutId, "bt2020">;
export type SourceTransfer = "srgb" | "bt709" | "pq" | "hlg" | "linear" | "acescct" | CameraLogId;
export type SourceMatrix = "bt709" | "bt2020-ncl" | "bt601" | "rgb";

export interface SourceColorSpace {
  readonly primaries: SourcePrimaries;
  readonly transfer: SourceTransfer;
  readonly matrix: SourceMatrix;
  readonly fullRange: boolean;
}

/** What a file with no colour tags is read as (the editor's historic behaviour). */
export const DEFAULT_SOURCE_COLOR: SourceColorSpace = {
  primaries: "bt709",
  transfer: "bt709",
  matrix: "bt709",
  fullRange: false,
};

/** "Interpret footage" choices. `undefined` on the media item means "as tagged". */
export type StandardFootageColorPreset = "rec709" | "srgb" | "rec2020" | "p3" | "hdr10-pq" | "hlg";
/** ACES-native footage: ACEScg (linear AP1), ACES2065-1 (linear AP0, e.g. EXR), ACEScct (log AP1, e.g. from a grading round trip). */
export type AcesFootageColorPreset =
  | "aces-acescg"
  | "aces-aces2065"
  | "aces-acescct"
  | "linear-rec709"
  | "linear-rec2020"
  | "linear-p3";
/** Camera log input presets: "log-" + the curve id ("log-slog3", "log-logc4", ...). */
export type CameraFootageColorPreset = `log-${CameraLogId}`;
export type FootageColorPreset = StandardFootageColorPreset | AcesFootageColorPreset | CameraFootageColorPreset;

export interface FootageColorPresetDef {
  readonly id: FootageColorPreset;
  readonly label: string;
  readonly space: SourceColorSpace;
  /** Set on camera log presets: the picker groups them under "Camera input". */
  readonly camera?: { readonly logId: CameraLogId; readonly maker: string };
  /** Set on the scene-linear / ACES presets: the picker groups them under "ACES and linear". */
  readonly aces?: true;
}

const STANDARD_FOOTAGE_COLOR_PRESETS: ReadonlyArray<FootageColorPresetDef> = [
  { id: "rec709", label: "Rec.709 (SDR)", space: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false } },
  { id: "srgb", label: "sRGB (full range)", space: { primaries: "bt709", transfer: "srgb", matrix: "rgb", fullRange: true } },
  { id: "rec2020", label: "Rec.2020 (SDR)", space: { primaries: "bt2020", transfer: "bt709", matrix: "bt2020-ncl", fullRange: false } },
  { id: "p3", label: "Display P3 (SDR)", space: { primaries: "p3", transfer: "srgb", matrix: "bt709", fullRange: false } },
  { id: "hdr10-pq", label: "Rec.2020 PQ (HDR10)", space: { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false } },
  { id: "hlg", label: "Rec.2020 HLG", space: { primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl", fullRange: false } },
];

/**
 * Scene-linear input spaces: ACES-native pixels (ACEScg, ACES2065-1, ACEScct) and plain linear light in the common
 * primaries (what a linear EXR / 32-bit export carries). Full range RGB, no matrix; 1.0 is SDR reference white.
 */
export const ACES_FOOTAGE_COLOR_PRESETS: ReadonlyArray<FootageColorPresetDef> = [
  { id: "aces-acescg", label: "ACEScg (linear AP1)", space: { primaries: "ap1", transfer: "linear", matrix: "rgb", fullRange: true }, aces: true },
  { id: "aces-aces2065", label: "ACES2065-1 (linear AP0)", space: { primaries: "ap0", transfer: "linear", matrix: "rgb", fullRange: true }, aces: true },
  { id: "aces-acescct", label: "ACEScct (log AP1)", space: { primaries: "ap1", transfer: "acescct", matrix: "rgb", fullRange: true }, aces: true },
  { id: "linear-rec709", label: "Linear Rec.709", space: { primaries: "bt709", transfer: "linear", matrix: "rgb", fullRange: true }, aces: true },
  { id: "linear-rec2020", label: "Linear Rec.2020", space: { primaries: "bt2020", transfer: "linear", matrix: "rgb", fullRange: true }, aces: true },
  { id: "linear-p3", label: "Linear Display P3", space: { primaries: "p3", transfer: "linear", matrix: "rgb", fullRange: true }, aces: true },
];

/**
 * Camera log presets: the signal is the camera's log curve in its wide gamut (RGB after the decoder's YCbCr
 * conversion, so the matrix is "rgb" and the range is whatever the decoder delivered).
 */
export const CAMERA_FOOTAGE_COLOR_PRESETS: ReadonlyArray<FootageColorPresetDef> = CAMERA_LOGS.map((def) => ({
  id: `log-${def.id}` as CameraFootageColorPreset,
  label: def.label,
  space: {
    primaries: def.gamut,
    transfer: def.id,
    matrix: "rgb",
    fullRange: true,
  } satisfies SourceColorSpace,
  camera: { logId: def.id, maker: def.maker },
}));

export const FOOTAGE_COLOR_PRESETS: ReadonlyArray<FootageColorPresetDef> = [
  ...STANDARD_FOOTAGE_COLOR_PRESETS,
  ...ACES_FOOTAGE_COLOR_PRESETS,
  ...CAMERA_FOOTAGE_COLOR_PRESETS,
];

/** True for the camera log transfers (S-Log3, V-Log, LogC3, ...). */
export function isCameraLogTransfer(transfer: SourceTransfer): transfer is CameraLogId {
  return CAMERA_LOGS.some((d) => d.id === transfer);
}

/** The camera log preset a media item is interpreted as, if any. */
export function cameraPresetOf(preset: FootageColorPreset | null | undefined): FootageColorPresetDef | undefined {
  return preset ? CAMERA_FOOTAGE_COLOR_PRESETS.find((p) => p.id === preset) : undefined;
}

export function isFootageColorPreset(value: unknown): value is FootageColorPreset {
  return typeof value === "string" && FOOTAGE_COLOR_PRESETS.some((p) => p.id === value);
}

export function footageColorPresetSpace(preset: FootageColorPreset): SourceColorSpace {
  return FOOTAGE_COLOR_PRESETS.find((p) => p.id === preset)!.space;
}

/** The WebCodecs `VideoColorSpaceInit` fields (all optional / nullable), or ffmpeg's tag spellings. */
export interface VideoColorSpaceLike {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
}

function mapPrimaries(value: string | null | undefined): SourcePrimaries | undefined {
  switch (value) {
    case "bt709": return "bt709";
    case "bt2020": return "bt2020";
    case "smpte432": case "smpte431": return "p3";
    case "bt470bg": case "smpte170m": case "bt470m": return "bt601";
    default: return undefined;
  }
}

function mapTransfer(value: string | null | undefined): SourceTransfer | undefined {
  switch (value) {
    case "pq": case "smpte2084": return "pq";
    case "hlg": case "arib-std-b67": return "hlg";
    case "iec61966-2-1": case "srgb": return "srgb";
    case "linear": return "linear";
    case "bt709": case "smpte170m": case "bt470bg": case "bt2020-10": case "bt2020-12": return "bt709";
    default: return undefined;
  }
}

function mapMatrix(value: string | null | undefined): SourceMatrix | undefined {
  switch (value) {
    case "bt709": return "bt709";
    case "bt2020-ncl": case "bt2020nc": case "bt2020-cl": case "bt2020c": return "bt2020-ncl";
    case "bt470bg": case "smpte170m": case "bt601": return "bt601";
    case "rgb": case "gbr": return "rgb";
    default: return undefined;
  }
}

/**
 * Maps container tags (WebCodecs or ffmpeg spellings) to a source colour space.
 * Returns null when the file carries no usable tag at all, so callers can tell
 * "tagged Rec.709" from "untagged".
 */
export function parseSourceColor(tags: VideoColorSpaceLike | null | undefined): SourceColorSpace | null {
  if (!tags) return null;
  const primaries = mapPrimaries(tags.primaries);
  const transfer = mapTransfer(tags.transfer);
  const matrix = mapMatrix(tags.matrix);
  if (!primaries && !transfer && !matrix) return null;
  // A wide-gamut matrix without a primaries tag implies BT.2020 primaries.
  const inferredPrimaries: SourcePrimaries = primaries ?? (matrix === "bt2020-ncl" ? "bt2020" : DEFAULT_SOURCE_COLOR.primaries);
  return {
    primaries: inferredPrimaries,
    transfer: transfer ?? DEFAULT_SOURCE_COLOR.transfer,
    matrix: matrix ?? (inferredPrimaries === "bt2020" ? "bt2020-ncl" : DEFAULT_SOURCE_COLOR.matrix),
    fullRange: tags.fullRange === true,
  };
}

/** True for PQ / HLG sources. */
export function isHdrTransfer(space: Pick<SourceColorSpace, "transfer">): boolean {
  return space.transfer === "pq" || space.transfer === "hlg";
}

/** True when the pixels are not plain Rec.709/sRGB SDR (wide gamut or HDR). */
export function needsInputTransform(space: SourceColorSpace): boolean {
  return (
    isHdrTransfer(space) ||
    space.primaries === "bt2020" ||
    space.primaries === "p3" ||
    space.transfer === "linear" ||
    space.transfer === "acescct" ||
    isCameraLogTransfer(space.transfer)
  );
}

export function sourceColorEquals(a: SourceColorSpace, b: SourceColorSpace): boolean {
  return a.primaries === b.primaries && a.transfer === b.transfer && a.matrix === b.matrix && a.fullRange === b.fullRange;
}

/** Short label for the media info: "Rec.2020 / PQ / BT.2020nc / limited". */
export function describeSourceColor(space: SourceColorSpace | null | undefined): string {
  if (!space) return "Rec.709 (untagged)";
  const camera = CAMERA_LOGS.find((d) => d.id === space.transfer);
  if (camera) return camera.label;
  const primaries = ({ bt709: "Rec.709", bt2020: "Rec.2020", p3: "P3", bt601: "BT.601", ap1: "ACES AP1", ap0: "ACES AP0" } as Record<string, string>)[space.primaries] ?? space.primaries;
  const transfer = ({ srgb: "sRGB", bt709: "BT.709", pq: "PQ", hlg: "HLG", linear: "Linear", acescct: "ACEScct" } as Record<string, string>)[space.transfer] ?? space.transfer;
  const matrix = { bt709: "BT.709", "bt2020-ncl": "BT.2020nc", bt601: "BT.601", rgb: "RGB" }[space.matrix];
  return `${primaries} / ${transfer} / ${matrix} / ${space.fullRange ? "full" : "limited"}`;
}

/** The slice of a media item colour management needs. */
export interface FootageColorSource {
  readonly metadata?: { readonly sourceColor?: SourceColorSpace };
  readonly colorInterpretation?: FootageColorPreset;
  readonly nativeSource?: unknown;
  /** Camera RAW still: the developer outputs sRGB-encoded pixels in this colour space's primaries. */
  readonly raw?: { readonly developedBy: string; readonly settings?: { readonly outputColorSpace: RawOutputColorSpace } };
}

/** The colour space the RAW developer writes for an output choice (sRGB transfer, the choice's primaries). */
export function rawOutputSourceSpace(output: RawOutputColorSpace): SourceColorSpace {
  const primaries: SourcePrimaries = output === "display-p3" ? "p3" : output === "rec2020" ? "bt2020" : "bt709";
  return { primaries, transfer: "srgb", matrix: "rgb", fullRange: true };
}

/**
 * What the footage is, after the user's override: tags, else the Rec.709 default. `clipOverride` is the timeline clip's own
 * Interpret Footage preset (`Clip.colorInterpretation`); it wins over the footage item's.
 */
export function effectiveSourceColor(item: FootageColorSource, clipOverride?: FootageColorPreset | null): SourceColorSpace {
  if (clipOverride && isFootageColorPreset(clipOverride)) return footageColorPresetSpace(clipOverride);
  if (item.colorInterpretation && isFootageColorPreset(item.colorInterpretation)) {
    return footageColorPresetSpace(item.colorInterpretation);
  }
  return item.metadata?.sourceColor ?? DEFAULT_SOURCE_COLOR;
}

/**
 * The colour space the pipeline must undo for this item, or null when the
 * pixels already arrive as display-referred sRGB/Rec.709 and nothing is done
 * (every Rec.709 SDR clip, byte-identical to before).
 *
 * Decoder paths differ in what they hand over:
 *  - WebCodecs / canvas decode: the browser has already converted tagged
 *    wide-gamut and HDR frames to its SDR canvas, so a file's own tags need no
 *    second transform. An explicit "Interpret footage" override is the user
 *    saying the delivered code values really are that space (untagged or
 *    mis-tagged files), so it is honoured.
 *  - Desktop native (ffmpeg) decode: frames are raw RGBA codes in the
 *    source's own transfer and primaries, so the file's tags apply too.
 */
export function inputSpaceForItem(item: FootageColorSource, clipOverride?: FootageColorPreset | null): SourceColorSpace | null {
  // RAW stills are developed by OpenReel into the chosen output primaries, whatever the decode path.
  if (item.raw?.developedBy === "openreel" && item.raw.settings) {
    const space = rawOutputSourceSpace(item.raw.settings.outputColorSpace);
    return needsInputTransform(space) ? space : null;
  }
  const override = (!!clipOverride && isFootageColorPreset(clipOverride)) || (!!item.colorInterpretation && isFootageColorPreset(item.colorInterpretation));
  if (!override && !item.nativeSource) return null;
  const space = effectiveSourceColor(item, clipOverride);
  return needsInputTransform(space) ? space : null;
}
