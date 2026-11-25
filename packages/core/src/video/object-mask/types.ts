import type { RGBAFrame } from "../time-interpolation/frame-blend";

export type { RGBAFrame };

export interface RasterPoint {
  x: number;
  y: number;
}

/** A brush stroke painted on the frame, in frame pixels. `include` strokes mark the object, the others mark what is not. */
export interface SegmentStroke {
  points: readonly RasterPoint[];
  radius: number;
  include: boolean;
}

/**
 * What the user told the segmenter. Everything is in the pixels of the frame handed to `segment`.
 * A click is an `include` point; shift / alt clicks add `exclude` points; brush drags are strokes.
 * `prior` is the previous frame's mask propagated to this frame (tracking): the segmenter then refines it
 * instead of growing a new region from a click.
 */
export interface SegmentPrompt {
  readonly include?: readonly RasterPoint[];
  readonly exclude?: readonly RasterPoint[];
  readonly strokes?: readonly SegmentStroke[];
  readonly prior?: Uint8Array;
  /** How far (frame pixels) the object may have moved or changed shape from `prior`. */
  readonly band?: number;
}

export interface SegmentResult {
  readonly width: number;
  readonly height: number;
  /** 1 = object, 0 = background, `width * height` entries. */
  readonly mask: Uint8Array;
  /** 0..1 self-assessed quality (colour separation of the cut). */
  readonly confidence: number;
}

/**
 * The seam an ML segmenter plugs into later: anything that turns a frame plus a click / brush / prior mask into an
 * object mask. The classical GrabCut segmenter in this folder is the default; a model-backed one only has to
 * implement `segment` (and may ignore the prompt parts it does not use).
 */
export interface ObjectSegmenter {
  readonly id: string;
  segment(image: RGBAFrame, prompt: SegmentPrompt): Promise<SegmentResult> | SegmentResult;
}

/** The mask look the project's mask system applies on top of any object mask. */
export interface ObjectMaskLook {
  /** Pixels of blur on the matte edge (0..100, like Mask.feathering). */
  readonly feathering: number;
  /** Pixels the matte grows (>0) or shrinks (<0), like Mask.expansion. */
  readonly expansion: number;
  readonly inverted: boolean;
  readonly opacity: number;
}
