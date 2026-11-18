import type { EasingType } from "../types/timeline";
import type { ShapeStyle, ShapeType } from "../graphics/types";
import type { TextAnimationParams, TextAnimationPreset, TextStyle } from "../text/types";

/**
 * Essential Graphics (MOGRT-lite).
 *
 * A GraphicTemplate is a self-contained, serializable description of a stack of
 * graphic layers (text / shape / svg / image) authored on a fixed design frame
 * (1920x1080, origin top-left, layer position = box centre). A GraphicInstance
 * is a template placed on the timeline with its own parameter values. The
 * instance is the single source of truth; its layers are expanded into ordinary
 * text / shape / svg clips (see expand.ts), which is why preview, export, nests,
 * smart render, the render cache and the fallback renderers all agree: they only
 * ever see ordinary clips.
 */

export const GRAPHIC_TEMPLATE_SCHEMA_VERSION = 1;
export const GRAPHIC_DESIGN_WIDTH = 1920;
export const GRAPHIC_DESIGN_HEIGHT = 1080;

export type GraphicTemplateCategory =
  | "lower-third"
  | "title"
  | "callout"
  | "end-card"
  | "custom";

export type GraphicLayerKind = "text" | "shape" | "svg" | "image";

export type GraphicMotionType =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "scale"
  | "wipe-right"
  | "wipe-left"
  | "wipe-up"
  | "wipe-down";

/** An intro (anchored to the clip start) or outro (anchored to the clip end) move. */
export interface GraphicMotion {
  readonly type: GraphicMotionType;
  /** Seconds from the clip start (intro) / before the clip end (outro) before the move begins. */
  readonly delay: number;
  readonly duration: number;
  /** Slide distance in design pixels. */
  readonly distance?: number;
  readonly easing?: EasingType;
}

export type GraphicPinEdge = "start" | "end" | "center";

/**
 * Responsive pin on one axis. `to: "frame"` keeps the layer a fixed distance from
 * the video frame edge, whatever the frame aspect ratio. `to: <layerId>` keeps
 * it a fixed distance from that layer's edge (which may itself be pinned).
 */
export interface GraphicAxisPin {
  readonly edge: GraphicPinEdge;
  readonly to: "frame" | string;
  /** Design pixels between the layer edge and the target edge. */
  readonly offset: number;
}

export interface GraphicLayerPin {
  readonly horizontal?: GraphicAxisPin;
  readonly vertical?: GraphicAxisPin;
}

export interface GraphicTextContent {
  readonly text: string;
  readonly style: Partial<TextStyle>;
}

export interface GraphicShapeContent {
  readonly shapeType: ShapeType;
  readonly style: Partial<ShapeStyle>;
}

export interface GraphicSvgContent {
  readonly svgContent: string;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  /** Recolour every painted pixel (used by the `tint` parameter property). */
  readonly tintColor?: string;
}

export interface GraphicImageContent {
  /** data: URL (png/jpeg/webp/gif/svg+xml); embedded so a template is one file. */
  readonly src: string;
  readonly aspect: number;
}

export type GraphicKeyframeProperty =
  | "position.x"
  | "position.y"
  | "scale.x"
  | "scale.y"
  | "rotation"
  | "opacity";

/**
 * A raw keyframe carried over from an ordinary clip (grouping). Positions and scales are in
 * the same frame fractions / multipliers the clip used. `anchor: "start"` keys sit `time`
 * seconds after the clip start; `anchor: "end"` keys sit `time` (<= 0) seconds before the end,
 * so stretching moves only the hold between them.
 */
export interface GraphicLayerKeyframe {
  readonly time: number;
  readonly anchor: "start" | "end";
  readonly property: GraphicKeyframeProperty;
  readonly value: number;
  readonly easing: EasingType;
}

/** Text entrance/exit preset (typewriter, fade, ...), carried over from a text clip. */
export interface GraphicTextAnimation {
  readonly preset: TextAnimationPreset;
  readonly inDuration: number;
  readonly outDuration: number;
  readonly stagger?: number;
  readonly unit?: "character" | "word" | "line";
  readonly params?: Partial<TextAnimationParams>;
}

export interface GraphicLayer {
  readonly id: string;
  readonly name: string;
  readonly kind: GraphicLayerKind;
  /** Authoring visibility; the `visible` parameter property overrides it per instance. */
  readonly visible: boolean;
  /** Box centre in design pixels. */
  readonly x: number;
  readonly y: number;
  /** Box size in design pixels. Text uses it for alignment and pinning. */
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly pin?: GraphicLayerPin;
  readonly motionIn?: GraphicMotion;
  readonly motionOut?: GraphicMotion;
  /** Raw keyframes (from grouped clips). They replace the motion preset on the properties they animate. */
  readonly keyframes?: readonly GraphicLayerKeyframe[];
  readonly textAnimation?: GraphicTextAnimation;
  readonly text?: GraphicTextContent;
  readonly shape?: GraphicShapeContent;
  readonly svg?: GraphicSvgContent;
  readonly image?: GraphicImageContent;
}

export type GraphicParamType =
  | "text"
  | "color"
  | "font"
  | "number"
  | "slider"
  | "checkbox"
  | "position";

export type GraphicParamProperty =
  | "text"
  | "textColor"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "fill"
  | "strokeColor"
  | "strokeWidth"
  | "tint"
  | "visible"
  | "x"
  | "y"
  | "position"
  | "width"
  | "height"
  | "opacity"
  | "rotation";

export interface GraphicParamTarget {
  readonly layerId: string;
  readonly property: GraphicParamProperty;
}

export type GraphicParamValue =
  | string
  | number
  | boolean
  | { readonly x: number; readonly y: number };

export interface GraphicParameter {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly type: GraphicParamType;
  readonly defaultValue: GraphicParamValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly targets: readonly GraphicParamTarget[];
}

export interface GraphicTemplate {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly category: GraphicTemplateCategory;
  readonly description: string;
  readonly tags: readonly string[];
  /** Default clip length in seconds. */
  readonly duration: number;
  /** Layers bottom to top (index 0 is painted first). */
  readonly layers: readonly GraphicLayer[];
  readonly parameters: readonly GraphicParameter[];
  /** Author-pinned protected durations; the layers' own motion may extend them. */
  readonly introDuration?: number;
  readonly outroDuration?: number;
}

/** One keyframe of an exposed (master) parameter, in seconds from the instance start. */
export interface GraphicParamKeyframe {
  readonly id: string;
  /** Seconds after the instance start. */
  readonly time: number;
  readonly value: number;
  readonly easing: EasingType;
}

/**
 * Render and Replace state of a linked composition instance: the instance is
 * represented on the timeline by one ordinary media clip (`clipId`) until
 * "Restore Unrendered" puts the live layers back.
 */
export interface GraphicBake {
  readonly mediaId: string;
  readonly clipId: string;
  /** Track the live layers sat on, so Restore puts them back there. */
  readonly originalTrackId: string;
  /** The rendered clip's track was created by Render and Replace (removed again when it empties). */
  readonly createdTrack: boolean;
  /** `LinkedComposition.revision` that was rendered; a later edit makes the render stale. */
  readonly revision: number;
}

/** A template placed on the timeline. Stored in `Project.graphicInstances`. */
export interface GraphicInstance {
  readonly id: string;
  readonly name: string;
  readonly trackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly template: GraphicTemplate;
  readonly values: Readonly<Record<string, GraphicParamValue>>;
  /**
   * Live linked composition this instance mirrors (`Project.linkedCompositions`).
   * `template` is kept equal to the composition's template by `linked-comps`.
   */
  readonly linkedCompositionId?: string;
  /** Keyframes of exposed number / slider parameters, by parameter id. */
  readonly paramKeyframes?: Readonly<Record<string, readonly GraphicParamKeyframe[]>>;
  /** Present while the instance is rendered to a media clip. */
  readonly bake?: GraphicBake;
}

export const GRAPHIC_LAYER_MEMBER_KEY = "graphicInstanceId";
export const GRAPHIC_LAYER_ID_KEY = "graphicLayerId";

/** Smallest hold (seconds) between the end of the intro and the start of the outro. */
export const GRAPHIC_MIN_HOLD = 0.1;
