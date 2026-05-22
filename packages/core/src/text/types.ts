import type {
  Transform,
  Keyframe,
  EasingType,
  ClipMetadata,
} from "../types/timeline";
import type { EmphasisAnimation } from "../graphics/types";

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

export interface TextAnimation {
  readonly preset: TextAnimationPreset;
  readonly params: TextAnimationParams;
  readonly inDuration: number;
  readonly outDuration: number;
  readonly stagger?: number; // Delay between characters/words
  readonly unit?: "character" | "word" | "line";
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
  | "rainbow";

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
