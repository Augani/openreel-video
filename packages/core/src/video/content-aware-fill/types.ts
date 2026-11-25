/**
 * Content-Aware Fill (Remove Object): the saved settings on a clip and the analysis they point at.
 * The analysis (one small RGBA patch per frame) is far too big for the project file, so the project keeps only
 * the settings and the `analysisKey` (a hash of everything the analysis depends on); the patches live in the
 * analysis cache (memory + the app's IndexedDB), see `registry.ts`.
 */
export interface ObjectRemovalSettings {
  readonly enabled: boolean;
  /** The mask that marks the object. While removal is on, that mask only defines what is removed. */
  readonly maskId: string;
  /** Hash of the inputs of the analysis the clip renders with; absent until the clip was analysed. */
  readonly analysisKey?: string;
  /** The clip's source timing when it was analysed (`removalTimingOf`); the fill is only laid over footage that still has it. */
  readonly timing?: string;
  /** Pixels the removed area grows beyond the mask, per 1000 px of the frame's long side. */
  readonly dilate: number;
  /** Width of the soft edge between the fill and the picture, per 1000 px of the frame's long side. */
  readonly feather: number;
}

export const DEFAULT_OBJECT_REMOVAL: Pick<ObjectRemovalSettings, "dilate" | "feather"> = { dilate: 10, feather: 5 };

export const OBJECT_REMOVAL_LIMITS = { dilate: { min: 0, max: 60 }, feather: { min: 0, max: 30 } } as const;

/** What replaces the picture inside one frame's removed area: colour in RGB, how much of it to show in alpha. */
export interface FillPatch {
  /** Position of the patch in the analysis frame, in analysis pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** RGBA, `width * height * 4`. Alpha is the blend (soft at the edge, 255 inside). */
  readonly data: Uint8ClampedArray;
}

export interface RemovalAnalysis {
  readonly key: string;
  /** Size of the analysis frames (the footage, scaled so its long side is at most the analysis size). */
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** One entry per clip frame; null where the mask is empty (nothing to remove). */
  readonly frames: ReadonlyArray<FillPatch | null>;
}

/** The only fields of a loose object that `isObjectRemovalSettings` needs to see to accept it. */
export function isObjectRemovalSettings(value: unknown): value is ObjectRemovalSettings {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.maskId === "string" &&
    (v.analysisKey === undefined || typeof v.analysisKey === "string") &&
    (v.timing === undefined || typeof v.timing === "string") &&
    typeof v.dilate === "number" && Number.isFinite(v.dilate) && v.dilate >= OBJECT_REMOVAL_LIMITS.dilate.min && v.dilate <= OBJECT_REMOVAL_LIMITS.dilate.max &&
    typeof v.feather === "number" && Number.isFinite(v.feather) && v.feather >= OBJECT_REMOVAL_LIMITS.feather.min && v.feather <= OBJECT_REMOVAL_LIMITS.feather.max
  );
}
