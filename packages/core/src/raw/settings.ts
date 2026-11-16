import { asShotKelvinTint, TEMPERATURE_MAX, TEMPERATURE_MIN, TINT_LIMIT, type CameraColorModel, type RawOutputColorSpace } from "./color";

export type { RawOutputColorSpace } from "./color";

/** Demosaic quality: `draft` bins each 2x2 cell to one pixel (half resolution). */
export type RawDemosaicQuality = "draft" | "standard" | "high";

/**
 * RAW Source Settings: how a camera file is developed into pixels. They live
 * on the media item (`MediaItem.raw.settings`) and are changed only through
 * the undoable `media/organize` action, so preview and export, which both
 * develop from these exact values, cannot disagree.
 */
export interface RawSourceSettings {
  /** White balance colour temperature in kelvin. */
  readonly temperature: number;
  /** White balance tint: positive pushes the picture toward magenta, negative toward green (about -150..150). */
  readonly tint: number;
  /** Exposure in stops, added to the camera's own baseline exposure. */
  readonly exposure: number;
  /** 0..1: neutralises clipped highlights and rolls the top of the range off softly. */
  readonly highlightRecovery: number;
  readonly demosaic: RawDemosaicQuality;
  readonly outputColorSpace: RawOutputColorSpace;
}

export const EXPOSURE_LIMIT = 5;
export const RAW_DEMOSAIC_QUALITIES: ReadonlyArray<{ id: RawDemosaicQuality; label: string; hint: string }> = [
  { id: "draft", label: "Draft", hint: "Half resolution, fastest" },
  { id: "standard", label: "Standard", hint: "Bilinear interpolation" },
  { id: "high", label: "High", hint: "Gradient-corrected (Malvar-He-Cutler)" },
];
export const RAW_OUTPUT_COLOR_SPACES: ReadonlyArray<{ id: RawOutputColorSpace; label: string }> = [
  { id: "srgb", label: "sRGB / Rec.709" },
  { id: "display-p3", label: "Display P3" },
  { id: "rec2020", label: "Rec.2020" },
];

export function isRawDemosaicQuality(v: unknown): v is RawDemosaicQuality {
  return v === "draft" || v === "standard" || v === "high";
}

export function isRawOutputColorSpace(v: unknown): v is RawOutputColorSpace {
  return v === "srgb" || v === "display-p3" || v === "rec2020";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Clamps a partial settings object onto a base; unknown or non-finite values keep the base. */
export function normalizeRawSettings(patch: Partial<RawSourceSettings> | undefined, base: RawSourceSettings): RawSourceSettings {
  const p = patch ?? {};
  return {
    temperature: Math.round(clamp(finiteOr(p.temperature, base.temperature), TEMPERATURE_MIN, TEMPERATURE_MAX)),
    tint: Math.round(clamp(finiteOr(p.tint, base.tint), -TINT_LIMIT, TINT_LIMIT) * 10) / 10,
    exposure: Math.round(clamp(finiteOr(p.exposure, base.exposure), -EXPOSURE_LIMIT, EXPOSURE_LIMIT) * 100) / 100,
    highlightRecovery: Math.round(clamp(finiteOr(p.highlightRecovery, base.highlightRecovery), 0, 1) * 100) / 100,
    demosaic: isRawDemosaicQuality(p.demosaic) ? p.demosaic : base.demosaic,
    outputColorSpace: isRawOutputColorSpace(p.outputColorSpace) ? p.outputColorSpace : base.outputColorSpace,
  };
}

/** The "as shot" settings for a camera model: the white balance the camera recorded, everything else neutral. */
export function defaultRawSettings(model: CameraColorModel): RawSourceSettings {
  const { kelvin, tint } = asShotKelvinTint(model);
  return normalizeRawSettings(
    { temperature: kelvin, tint, exposure: 0, highlightRecovery: 0, demosaic: "standard", outputColorSpace: "srgb" },
    FALLBACK_SETTINGS,
  );
}

const FALLBACK_SETTINGS: RawSourceSettings = {
  temperature: 5003,
  tint: 0,
  exposure: 0,
  highlightRecovery: 0,
  demosaic: "standard",
  outputColorSpace: "srgb",
};

export function rawSettingsEqual(a: RawSourceSettings, b: RawSourceSettings): boolean {
  return (
    a.temperature === b.temperature &&
    a.tint === b.tint &&
    a.exposure === b.exposure &&
    a.highlightRecovery === b.highlightRecovery &&
    a.demosaic === b.demosaic &&
    a.outputColorSpace === b.outputColorSpace
  );
}

/** Stable identity of a develop: equal keys mean the same pixels. */
export function rawSettingsKey(s: RawSourceSettings): string {
  return `${s.temperature}|${s.tint}|${s.exposure}|${s.highlightRecovery}|${s.demosaic}|${s.outputColorSpace}`;
}

/** What `MediaItem.raw` stores for a camera RAW still. */
export interface RawStillInfo {
  /** Container family: "dng" is developed by OpenReel; the others were converted by the operating system. */
  readonly format: string;
  readonly developedBy: "openreel" | "macos-imageio";
  readonly make?: string;
  readonly model?: string;
  readonly bitDepth?: number;
  /** CFA layout in reading order, e.g. "RGGB". */
  readonly cfa?: string;
  /** Editable development settings; absent when the OS developed the file (settings cannot be applied). */
  readonly settings?: RawSourceSettings;
  /** The camera's recorded white balance, for the panel's "As shot" reset. */
  readonly asShot?: { readonly temperature: number; readonly tint: number };
  /** Set on media baked from a CinemaDNG sequence. */
  readonly sequence?: {
    readonly frames: number;
    readonly frameRate: number;
    readonly firstFrame: string;
    /** The settings the frames were baked with. */
    readonly bakedSettings: RawSourceSettings;
  };
}
