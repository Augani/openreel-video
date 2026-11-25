import type {
  Transform,
  Keyframe,
  EasingType,
  ClipMetadata,
} from "../types/timeline";
import type {
  EmphasisAnimation,
  MotionShaderParamValue,
} from "../graphics/types";

export interface TextClip {
  readonly id: string;
  readonly trackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly text: string;
  readonly style: TextStyle;
  readonly transform: Transform;
  readonly animation?: TextAnimation;
  readonly keyframes: Keyframe[];
  /** Ordered visual effects applied after text rasterization. */
  readonly effects?: import("../types/timeline").Effect[];
  readonly blendMode?: import("../video/types").BlendMode;
  readonly blendOpacity?: number;
  readonly emphasisAnimation?: EmphasisAnimation;
  readonly behindSubject?: boolean;
  readonly metadata?: ClipMetadata;
  /**
   * Optional 3D rendering pass. When present, the text is extruded
   * via THREE.TextGeometry instead of being rasterized to a canvas
   * texture. Falls back to 2D canvas rendering if the font cannot be
   * loaded.
   */
  readonly text3d?: Text3DSettings;
  /** Roll (vertical) or crawl (horizontal) the text across the frame over the clip duration. */
  readonly scroll?: TextScroll;
  /**
   * Per-character style runs. Absent on clips authored before rich text: they
   * load as a single run (see `runsForText`). When present the run texts
   * concatenate to `text`; a mismatch is reconciled lazily on read.
   */
  readonly runs?: TextRun[];
}

export interface TextGradientStop {
  /** 0..1 along the gradient. */
  readonly offset: number;
  readonly color: string;
}

/** Solid or gradient paint for glyph fills. Gradients span the whole text block. */
export type TextFill =
  | { readonly type: "solid"; readonly color: string }
  | { readonly type: "linear"; /** Degrees, 0 = left to right, 90 = top to bottom. */ readonly angle: number; readonly stops: readonly TextGradientStop[] }
  | { readonly type: "radial"; readonly stops: readonly TextGradientStop[] };

export interface TextStroke {
  readonly color: string;
  readonly width: number;
  /** `behind` (default) paints under the fill; `over` paints on top of it. */
  readonly position?: "behind" | "over";
  readonly join?: "round" | "miter" | "bevel";
}

/** A box drawn behind the whole text block. */
export interface TextBackgroundBox {
  readonly color: string;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly radius: number;
}

/** Style overrides of one run; an absent field inherits from the clip style. */
export interface TextRunStyle {
  readonly fontFamily?: string;
  readonly fontWeight?: FontWeight;
  readonly fontStyle?: "normal" | "italic";
  readonly fontSize?: number;
  readonly color?: string;
  readonly fill?: TextFill;
  /** Tracking in pixels (same unit as TextStyle.letterSpacing). */
  readonly letterSpacing?: number;
  /** Baseline shift in pixels, positive raises the run. */
  readonly baselineShift?: number;
  readonly underline?: boolean;
  readonly smallCaps?: boolean;
  /** Standard ligatures; on by default, `false` turns them off. */
  readonly ligatures?: boolean;
  /** Tabular (fixed width) figures. */
  readonly tabularFigures?: boolean;
}

export interface TextRun {
  readonly text: string;
  readonly style: TextRunStyle;
}

/**
 * Title scrolling. `roll` moves up (credits) or down; `crawl` moves left
 * (ticker) or right. With `startOffscreen` the text begins fully outside the
 * frame, with `endOffscreen` it finishes fully outside; a side that is not
 * off-screen rests at the clip's own position.
 */
export interface TextScroll {
  readonly mode: "roll" | "crawl";
  /** roll: "up" (default) or "down"; crawl: "left" (default) or "right". */
  readonly direction?: "up" | "down" | "left" | "right";
  readonly startOffscreen: boolean;
  readonly endOffscreen: boolean;
}

export interface Text3DSettings {
  /** Enable 3D extrusion */
  readonly enabled: boolean;
  /** Extrusion depth, in world units (relative to font size) */
  readonly depth: number;
  /** Bevel thickness (0 disables bevel) */
  readonly bevelThickness: number;
  /** Bevel size on each face */
  readonly bevelSize: number;
  /** Bevel segments (round corners — higher = smoother) */
  readonly bevelSegments: number;
  /** Front-face color (hex). Defaults to TextStyle.color when omitted. */
  readonly frontColor?: string;
  /** Side / extruded color (hex). Defaults to a darker shade of frontColor. */
  readonly sideColor?: string;
  /** Metalness 0..1 — only meaningful when material is "physical". */
  readonly metalness?: number;
  /** Roughness 0..1 — only meaningful when material is "physical". */
  readonly roughness?: number;
  /** Material kind. "basic" is unlit, "physical" picks up the scene light. */
  readonly material?: "basic" | "physical";
}

export interface TextStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  readonly fontStyle: "normal" | "italic";
  readonly color: string;
  readonly backgroundColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly shadowColor?: string;
  readonly shadowBlur?: number;
  readonly shadowOffsetX?: number;
  readonly shadowOffsetY?: number;
  readonly textAlign: TextAlign;
  readonly verticalAlign: VerticalAlign;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly textDecoration?: TextDecoration;
  /** Gradient (or solid) fill; takes precedence over `color` when set. */
  readonly fill?: TextFill;
  /** Any number of strokes, painted in order; when set it replaces strokeColor/strokeWidth. */
  readonly strokes?: TextStroke[];
  /** Padded, rounded box behind the text block; replaces `backgroundColor` when set. */
  readonly backgroundBox?: TextBackgroundBox;
  readonly shader?: TextShaderStyle;
}

export interface TextShaderStyle {
  readonly shaderId: string;
  readonly params: Record<string, MotionShaderParamValue>;
  readonly progress?: number;
}

export type FontWeight =
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900
  | "normal"
  | "bold";

export type TextAlign = "left" | "center" | "right" | "justify";

export type VerticalAlign = "top" | "middle" | "bottom";

export type TextDecoration = "none" | "underline" | "line-through" | "overline";

export interface TextAnimationPhase {
  readonly preset: TextAnimationPreset;
  readonly params: TextAnimationParams;
  readonly stagger?: number; // Delay between characters/words
  readonly unit?: "character" | "word" | "line";
}

export interface TextAnimation extends TextAnimationPhase {
  readonly inDuration: number;
  readonly outDuration: number;
  /** Independent exit. Omitted in legacy projects, which reuse the entry preset. */
  readonly out?: TextAnimationPhase;
}

export type TextAnimationPreset =
  | "none"
  | "typewriter"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "scale"
  | "blur"
  | "bounce"
  | "rotate"
  | "wave"
  | "shake"
  | "pop"
  | "glitch"
  | "split"
  | "flip"
  | "word-by-word"
  | "rainbow"
  | "rise"
  | "drop"
  | "elastic"
  | "swing"
  | "zoom-blur"
  | "cascade";

export interface TextAnimationParams {
  // Fade parameters
  readonly fadeOpacity?: { start: number; end: number };

  // Slide parameters
  readonly slideDistance?: number;

  // Scale parameters
  readonly scaleFrom?: number;
  readonly scaleTo?: number;

  // Blur parameters
  readonly blurAmount?: number;

  // Bounce parameters
  readonly bounceHeight?: number;
  readonly bounceCount?: number;

  // Rotate parameters
  readonly rotateAngle?: number;

  // Wave parameters
  readonly waveAmplitude?: number;
  readonly waveFrequency?: number;

  // Shake parameters
  readonly shakeIntensity?: number;
  readonly shakeSpeed?: number;

  // Pop parameters
  readonly popOvershoot?: number;

  // Glitch parameters
  readonly glitchIntensity?: number;
  readonly glitchSpeed?: number;
  readonly splitDirection?: "horizontal" | "vertical";

  // Flip parameters
  readonly flipAxis?: "x" | "y";

  // Rainbow parameters
  readonly rainbowSpeed?: number;

  // Word-by-word parameters
  readonly wordDelay?: number;

  // Easing
  readonly easing?: EasingType;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Inter",
  fontSize: 48,
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#ffffff",
  strokeColor: "#111827",
  strokeWidth: 2,
  textAlign: "center",
  verticalAlign: "middle",
  lineHeight: 1.2,
  letterSpacing: 0,
};

export const DEFAULT_TEXT_TRANSFORM: Transform = {
  position: { x: 0.5, y: 0.5 }, // Normalized 0-1
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

export interface TextRenderResult {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
  readonly textMetrics: TextMetrics;
}

export interface TextMetrics {
  readonly width: number;
  readonly height: number;
  readonly lines: TextLineMetrics[];
}

export interface TextLineMetrics {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
}
