import type { Transform, Keyframe, ClipMetadata } from "../types/timeline";
import type { Point2D } from "../video/transform-animator";

// Re-export Point2D for convenience
export type { Point2D } from "../video/transform-animator";

export interface GraphicClip {
  readonly id: string;
  readonly trackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly type: GraphicType;
  readonly transform: Transform;
  readonly keyframes: Keyframe[];
  readonly blendMode?: import("../video/types").BlendMode;
  readonly blendOpacity?: number;
  readonly emphasisAnimation?: EmphasisAnimation;
  readonly metadata?: ClipMetadata;
}

export type GraphicType = "shape" | "svg" | "sticker" | "emoji";

export interface ShapeClip extends GraphicClip {
  readonly type: "shape";
  readonly shapeType: ShapeType;
  readonly style: ShapeStyle;
  readonly points?: Point2D[]; // For polygon/path shapes
}

export interface SVGClip extends GraphicClip {
  readonly type: "svg";
  readonly svgContent: string;
  readonly viewBox: ViewBox;
  readonly preserveAspectRatio: PreserveAspectRatio;
  readonly colorStyle?: SVGColorStyle;
  readonly entryAnimation?: GraphicAnimation;
  readonly exitAnimation?: GraphicAnimation;
  readonly emphasisAnimation?: EmphasisAnimation;
}

export interface SVGColorStyle {
  readonly tintColor?: string;
  readonly tintOpacity?: number;
  readonly colorMode: "none" | "tint" | "replace";
}

export interface GraphicAnimation {
  readonly type: GraphicAnimationType;
  readonly duration: number;
  readonly easing: string;
}

export type GraphicAnimationType =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "scale"
  | "rotate"
  | "bounce"
  | "pop"
  | "draw"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"
  | "reveal-center"
  | "reveal-edges"
  | "elastic"
  | "flip-horizontal"
  | "flip-vertical";

export type EmphasisAnimationType =
  | "none"
  | "pulse"
  | "shake"
  | "bounce"
  | "float"
  | "spin"
  | "flash"
  | "heartbeat"
  | "swing"
  | "wobble"
  | "jello"
  | "rubber-band"
  | "tada"
  | "vibrate"
  | "flicker"
  | "glow"
  | "breathe"
  | "wave"
  | "tilt"
  | "zoom-pulse"
  | "focus-zoom"
  | "pan-left"
  | "pan-right"
  | "pan-up"
  | "pan-down"
  | "ken-burns";

export interface EmphasisAnimation {
  readonly type: EmphasisAnimationType;
  readonly speed: number;
  readonly intensity: number;
  readonly loop: boolean;
  readonly focusPoint?: { x: number; y: number };
  readonly zoomScale?: number;
  readonly holdDuration?: number;
  readonly startTime?: number;
  readonly animationDuration?: number;
}

export const DEFAULT_EMPHASIS_ANIMATION: EmphasisAnimation = {
  type: "none",
  speed: 1,
  intensity: 1,
  loop: true,
};

export const DEFAULT_SVG_COLOR_STYLE: SVGColorStyle = {
  colorMode: "none",
  tintColor: "#ffffff",
  tintOpacity: 1,
};

export const DEFAULT_GRAPHIC_ANIMATION: GraphicAnimation = {
  type: "none",
  duration: 0.5,
  easing: "ease-out",
};

export interface StickerClip extends GraphicClip {
  readonly type: "sticker" | "emoji";
  readonly imageUrl: string;
  readonly category?: string;
  readonly name?: string;
}

export type ShapeType =
  | "rectangle"
  | "circle"
  | "ellipse"
  | "triangle"
  | "arrow"
  | "line"
  | "polygon"
  | "star";

export interface ShapeStyle {
  readonly fill: FillStyle;
  readonly stroke: StrokeStyle;
  readonly shadow?: ShadowStyle;
  readonly cornerRadius?: number; // For rectangles
  readonly points?: number; // For stars (number of points)
  readonly innerRadius?: number; // For stars (inner radius ratio 0-1)
}

export interface FillStyle {
  readonly type: "solid" | "gradient" | "none";
  readonly color?: string;
  readonly gradient?: GradientStyle;
  readonly opacity: number;
}

export interface GradientStyle {
  readonly type: "linear" | "radial";
  readonly angle?: number; // For linear gradients (degrees)
  readonly stops: GradientStop[];
}

export interface GradientStop {
  readonly offset: number; // 0-1
  readonly color: string;
}

export interface StrokeStyle {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly dashArray?: number[];
  readonly dashOffset?: number;
  readonly lineCap?: "butt" | "round" | "square";
  readonly lineJoin?: "miter" | "round" | "bevel";
}

export interface ShadowStyle {
  readonly color: string;
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export type PreserveAspectRatio =
  | "none"
  | "xMinYMin"
  | "xMidYMin"
  | "xMaxYMin"
  | "xMinYMid"
  | "xMidYMid"
  | "xMaxYMid"
  | "xMinYMax"
  | "xMidYMax"
  | "xMaxYMax";

export interface ArrowProperties {
  readonly headWidth: number;
  readonly headLength: number;
  readonly tailWidth: number;
  readonly curved?: boolean;
  readonly doubleHeaded?: boolean;
}

export interface StickerItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly imageUrl: string;
  readonly tags?: string[];
}

export interface EmojiItem {
  readonly id: string;
  readonly emoji: string;
  readonly name: string;
  readonly category: string;
}

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: {
    type: "solid",
    color: "#3b82f6",
    opacity: 1,
  },
  stroke: {
    color: "#1d4ed8",
    width: 2,
    opacity: 1,
  },
};

export const DEFAULT_GRAPHIC_TRANSFORM: Transform = {
  position: { x: 0.5, y: 0.5 }, // Normalized 0-1
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

export interface GraphicRenderResult {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
}

export interface CreateShapeParams {
  readonly id?: string;
  readonly shapeType: ShapeType;
  readonly width: number;
  readonly height: number;
  readonly style?: Partial<ShapeStyle>;
  readonly arrowProps?: ArrowProperties;
  readonly points?: Point2D[];
  readonly metadata?: ClipMetadata;
}

export interface SVGImportResult {
  readonly svgContent: string;
  readonly viewBox: ViewBox;
  readonly width: number;
  readonly height: number;
}
