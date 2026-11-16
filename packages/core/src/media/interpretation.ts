import type { MediaItem } from "../types/project";

/**
 * "Interpret footage" (frame rate, pixel aspect ratio, field order): a per-item override of what the
 * file says about itself. It never touches the file; clips read through these helpers so timeline
 * duration, preview and export agree.
 */
export type FieldOrder = "progressive" | "upper" | "lower";
/** How interlaced footage is deinterlaced in preview and export. */
export type DeinterlaceMode = "none" | "blend" | "bob";

export interface FootageInterpretation {
  /** Conform the footage to this frame rate (frames play at this rate, so duration changes). */
  readonly frameRate?: number;
  /** Width / height of one pixel; 1 is square. Scales the displayed width. */
  readonly pixelAspectRatio?: number;
  readonly fieldOrder?: FieldOrder;
  /** Deinterlace filter for interlaced footage; absent = "blend". Ignored for progressive footage. */
  readonly deinterlace?: DeinterlaceMode;
}

export const DEINTERLACE_MODES: readonly DeinterlaceMode[] = ["none", "blend", "bob"];
export const DEFAULT_DEINTERLACE: DeinterlaceMode = "blend";

export const PIXEL_ASPECT_PRESETS: readonly { id: string; label: string; value: number }[] = [
  { id: "square", label: "Square pixels (1.0)", value: 1 },
  { id: "d1-ntsc", label: "D1/DV NTSC (0.9091)", value: 10 / 11 },
  { id: "d1-ntsc-wide", label: "D1/DV NTSC Widescreen (1.2121)", value: 40 / 33 },
  { id: "d1-pal", label: "D1/DV PAL (1.0940)", value: 59 / 54 },
  { id: "d1-pal-wide", label: "D1/DV PAL Widescreen (1.4587)", value: 118 / 81 },
  { id: "anamorphic-2x", label: "Anamorphic 2:1 (2.0)", value: 2 },
  { id: "hdv-1440", label: "HD Anamorphic 1440 (1.3333)", value: 4 / 3 },
];

export const FIELD_ORDERS: readonly FieldOrder[] = ["progressive", "upper", "lower"];

/** Returns an error message, or null when the interpretation is acceptable. */
export function validateInterpretation(value: FootageInterpretation): string | null {
  if (value.frameRate !== undefined && !(Number.isFinite(value.frameRate) && value.frameRate >= 1 && value.frameRate <= 240))
    return "Interpreted frame rate must be between 1 and 240.";
  if (
    value.pixelAspectRatio !== undefined &&
    !(Number.isFinite(value.pixelAspectRatio) && value.pixelAspectRatio >= 0.25 && value.pixelAspectRatio <= 4)
  )
    return "Pixel aspect ratio must be between 0.25 and 4.";
  if (value.fieldOrder !== undefined && !FIELD_ORDERS.includes(value.fieldOrder)) return "Unknown field order.";
  if (value.deinterlace !== undefined && !DEINTERLACE_MODES.includes(value.deinterlace)) return "Unknown deinterlace mode.";
  return null;
}

/** What the file itself reports (frame rate, container SAR, field order), the baseline overrides are compared with. */
export interface NativeFootageProperties {
  readonly frameRate: number;
  readonly pixelAspectRatio?: number;
  readonly fieldOrder?: FieldOrder;
}

/** Drop fields equal to what the file says so "no override" stays absent. Returns undefined when nothing is left. */
export function normalizeInterpretation(value: FootageInterpretation, native: NativeFootageProperties): FootageInterpretation | undefined {
  const out: { frameRate?: number; pixelAspectRatio?: number; fieldOrder?: FieldOrder; deinterlace?: DeinterlaceMode } = {};
  if (value.frameRate !== undefined && Math.abs(value.frameRate - native.frameRate) > 1e-6) out.frameRate = value.frameRate;
  if (value.pixelAspectRatio !== undefined && Math.abs(value.pixelAspectRatio - (native.pixelAspectRatio ?? 1)) > 1e-6)
    out.pixelAspectRatio = value.pixelAspectRatio;
  if (value.fieldOrder !== undefined && value.fieldOrder !== (native.fieldOrder ?? "progressive")) out.fieldOrder = value.fieldOrder;
  if (value.deinterlace !== undefined && value.deinterlace !== DEFAULT_DEINTERLACE) out.deinterlace = value.deinterlace;
  return Object.keys(out).length ? out : undefined;
}

type Interpretable = Pick<MediaItem, "metadata" | "interpretation">;

/** Valid detected pixel aspect (0.25..4), else undefined. */
function detectedPixelAspect(item: Interpretable): number | undefined {
  const par = item.metadata?.pixelAspectRatio;
  return par !== undefined && Number.isFinite(par) && par >= 0.25 && par <= 4 ? par : undefined;
}

/** Frame rate the footage plays at: the override, else the file's own. */
export function effectiveFrameRate(item: Interpretable): number {
  return item.interpretation?.frameRate ?? item.metadata?.frameRate;
}

export function effectivePixelAspect(item: Interpretable): number {
  return item.interpretation?.pixelAspectRatio ?? detectedPixelAspect(item) ?? 1;
}

export function effectiveFieldOrder(item: Interpretable): FieldOrder {
  return item.interpretation?.fieldOrder ?? item.metadata?.fieldOrder ?? "progressive";
}

export function effectiveDeinterlace(item: Interpretable): DeinterlaceMode {
  return item.interpretation?.deinterlace ?? DEFAULT_DEINTERLACE;
}

/**
 * Playback speed that conforms the file's frames to the interpreted rate: a 30 fps file read as
 * 24 fps plays at 24/30 = 0.8x. 1 when there is no override.
 */
export function interpretationSpeed(item: Interpretable): number {
  const native = item.metadata?.frameRate ?? 0;
  const interp = item.interpretation?.frameRate;
  if (!interp || !(native > 0)) return 1;
  return interp / native;
}

/** Duration of the whole file on the timeline once conformed. */
export function interpretedDuration(item: Interpretable): number {
  return (item.metadata?.duration ?? 0) / interpretationSpeed(item);
}

/** Display size of a stored frame of `width` x `height` with the given pixel aspect (width stretched, rounded to an even number). */
export function displaySizeFor(width: number, height: number, pixelAspect: number): { width: number; height: number } {
  if (!(pixelAspect > 0) || Math.abs(pixelAspect - 1) < 1e-9) return { width, height };
  return { width: Math.max(2, Math.round((width * pixelAspect) / 2) * 2), height };
}

/** Display size: width stretched by the pixel aspect ratio (rounded to an even number). */
export function interpretedDisplaySize(item: Interpretable): { width: number; height: number } {
  return displaySizeFor(item.metadata?.width ?? 0, item.metadata?.height ?? 0, effectivePixelAspect(item));
}

/** The frame-level treatment preview and export apply to a clip's decoded frames; null when the footage needs none. */
export interface FrameConform {
  readonly pixelAspect: number;
  readonly fieldOrder: FieldOrder;
  readonly deinterlace: DeinterlaceMode;
}

export function frameConformFor(item: Interpretable): FrameConform | null {
  const pixelAspect = effectivePixelAspect(item);
  const fieldOrder = effectiveFieldOrder(item);
  const deinterlace = fieldOrder === "progressive" ? "none" : effectiveDeinterlace(item);
  if (Math.abs(pixelAspect - 1) < 1e-9 && deinterlace === "none") return null;
  return { pixelAspect, fieldOrder, deinterlace };
}

/**
 * Pixel size of a thumbnail of `targetWidth` for a stored `width` x `height` frame with the given pixel
 * aspect: the frame is stretched to its display aspect (1440x1080 at PAR 4/3 -> 16:9). Square pixels
 * keep the stored aspect, exactly as before.
 */
export function thumbnailSizeFor(width: number, height: number, pixelAspect: number, targetWidth: number): { width: number; height: number } {
  const par = pixelAspect > 0 && Number.isFinite(pixelAspect) ? pixelAspect : 1;
  const displayAspect = (Math.max(1, width) * par) / Math.max(1, height);
  return { width: targetWidth, height: Math.max(1, Math.round(targetWidth / displayAspect)) };
}

/** Pixel aspect the item's stored thumbnails were generated for (absent = square). */
export function thumbnailPixelAspectOf(item: Pick<MediaItem, "thumbnailPixelAspect">): number {
  return item.thumbnailPixelAspect ?? 1;
}

/** True when a video item's stored thumbnails no longer match its effective pixel aspect. */
export function thumbnailsNeedRefresh(item: Interpretable & Pick<MediaItem, "type" | "thumbnailPixelAspect"> & { readonly thumbnailUrl?: string | null }): boolean {
  if (item.type !== "video") return false;
  // The marker only describes frames that still exist: with no thumbnail, or a transient blob: URL
  // that is about to be regenerated square, it is meaningless and must not mask a stale thumbnail.
  const hasPersistedFrames = typeof item.thumbnailUrl === "string" && !item.thumbnailUrl.startsWith("blob:");
  const made = hasPersistedFrames ? thumbnailPixelAspectOf(item) : 1;
  return Math.abs(effectivePixelAspect(item) - made) > 1e-6;
}
