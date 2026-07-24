import type { TransitionType } from "./effects";
import type { EmphasisAnimation } from "../graphics/types";
import type { StabilizationProfile } from "../video/stabilization/types";

export interface Timeline {
  readonly tracks: Track[];
  readonly subtitles: Subtitle[];
  readonly duration: number;
  readonly markers: Marker[];
  readonly beatMarkers?: TimelineBeatMarker[];
  readonly beatAnalysis?: TimelineBeatAnalysis;
  /**
   * Canvas letterbox fill behind clips whose aspect differs from the project
   * canvas. Raw values are part of the shared cross-platform project JSON
   * schema (identical on iOS/Android). `"color"` paints `layoutBackgroundColor`;
   * `"blur"` paints a blurred cover-fit copy of the base clip. Undefined keeps
   * the default black bars.
   */
  readonly backgroundFillMode?: "color" | "blur";
  readonly layoutBackgroundColor?: string;
}

export interface TimelineBeatMarker {
  readonly time: number;
  readonly strength: number;
  readonly index: number;
  readonly isDownbeat: boolean;
}

export interface TimelineBeatAnalysis {
  readonly bpm: number;
  readonly confidence: number;
  readonly sourceClipId?: string;
  readonly analyzedAt: number;
}

export interface Track {
  readonly id: string;
  readonly type: "video" | "audio" | "image" | "text" | "graphics";
  readonly name: string;
  readonly clips: Clip[];
  readonly transitions: Transition[];
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
}

export interface EditingTemplateApplicationSource {
  readonly templateId: string;
  readonly applicationId: string;
  readonly ownerClipId: string;
  readonly ownerTrackId?: string;
  readonly controlValues?: Record<string, unknown>;
}

export interface AppliedEditingTemplate {
  readonly templateId: string;
  readonly applicationId: string;
  readonly name: string;
  readonly category?: string;
  readonly appliedAt: number;
  readonly controlValues?: Record<string, unknown>;
}

export interface ClipMetadata {
  readonly templateSource?: EditingTemplateApplicationSource;
  readonly appliedTemplates?: AppliedEditingTemplate[];
  readonly templateManaged?: boolean;
  readonly templateTrackType?: "text" | "graphics";
  readonly [key: string]: unknown;
}

export interface EffectMetadata {
  readonly templateSource?: EditingTemplateApplicationSource;
  readonly [key: string]: unknown;
}

export interface ChromaKeySettings {
  readonly enabled: boolean;
  readonly keyColor: { readonly r: number; readonly g: number; readonly b: number };
  readonly tolerance: number;
  readonly edgeSoftness: number;
  readonly spillSuppression: number;
}

export interface SpeedKeyframe {
  readonly id: string;
  readonly time: number;
  readonly speed: number;
  readonly easing: EasingType;
}

export interface FreezeFrame {
  readonly id: string;
  readonly clipId: string;
  readonly sourceTime: number;
  readonly startTime: number;
  readonly duration: number;
}

export interface Clip {
  readonly id: string;
  readonly mediaId: string;
  readonly trackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly effects: Effect[];
  readonly audioEffects: Effect[];
  readonly transform: Transform;
  readonly blendMode?: import("../video/types").BlendMode;
  readonly blendOpacity?: number;
  readonly colorGrading?: import("../video/color-grading-engine").ClipColorGrading;
  readonly volume: number;
  readonly fade?: { fadeIn: number; fadeOut: number };
  readonly automation?: {
    volume?: AutomationPoint[];
    pan?: AutomationPoint[];
  };
  readonly keyframes: Keyframe[];
  readonly speed?: number;
  readonly reversed?: boolean;
  readonly smoothSlowMo?: boolean;
  readonly interpolationQuality?: "low" | "medium" | "high";
  readonly stabilization?: {
    enabled: boolean;
    strength: number;
    cropMode: "auto" | "none";
    analyzed?: boolean;
    analysisVersion?: number;
    profile?: StabilizationProfile;
  };
  readonly emphasisAnimation?: EmphasisAnimation;
  readonly chromaKey?: ChromaKeySettings;
  readonly speedKeyframes?: SpeedKeyframe[];
  readonly freezeFrames?: FreezeFrame[];
  readonly pitchCorrection?: boolean;
  /** Zero-based index of the audio track within the source media file to use for this clip.
   * Undefined or 0 means the primary/first audio track. */
  readonly audioTrackIndex?: number;
  readonly metadata?: ClipMetadata;
}

export interface Effect {
  readonly id: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
  readonly enabled: boolean;
  readonly metadata?: EffectMetadata;
}

export type FitMode = "contain" | "cover" | "stretch" | "none";

export interface Transform {
  readonly position: { x: number; y: number };
  readonly scale: { x: number; y: number };
  readonly rotation: number;
  readonly anchor: { x: number; y: number };
  readonly opacity: number;
  readonly borderRadius?: number;
  readonly fitMode?: FitMode;
  readonly rotate3d?: { x: number; y: number; z: number };
  readonly perspective?: number;
  readonly transformStyle?: "flat" | "preserve-3d";
  readonly crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Keyframe {
  readonly id: string;
  readonly time: number;
  readonly property: string;
  readonly value: unknown;
  readonly easing: EasingType;
  /**
   * Optional per-keyframe temporal bezier handles (graph editor). When set with
   * easing "bezier", the keyframe engine interpolates the OUTGOING segment using
   * these control points (in/out in normalized 0..1 time/value space), matching
   * After Effects' value-graph Bezier handles. Honored by keyframeEngine.applyEasing.
   */
  readonly bezierHandles?: {
    readonly in: { readonly x: number; readonly y: number };
    readonly out: { readonly x: number; readonly y: number };
  };
  readonly roving?: boolean;
}

export const EASING_TYPES = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "hold",
  "bezier",
  "smoothstep",
  "smootherstep",
  "snappy",
  "smooth",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInQuint",
  "easeOutQuint",
  "easeInOutQuint",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "easeInCirc",
  "easeOutCirc",
  "easeInOutCirc",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
  "easeInBackStrong",
  "easeOutBackStrong",
  "easeInOutBackStrong",
  "easeInElastic",
  "easeOutElastic",
  "easeInOutElastic",
  "easeInElasticSoft",
  "easeOutElasticSoft",
  "easeInOutElasticSoft",
  "easeInBounce",
  "easeOutBounce",
  "easeInOutBounce",
  "easeInBounceSmall",
  "easeOutBounceSmall",
  "easeInOutBounceSmall",
] as const;

export type EasingType = (typeof EASING_TYPES)[number];

export interface Marker {
  readonly id: string;
  readonly time: number;
  readonly label: string;
  readonly color: string;
}

export type TransitionEdge = "in" | "out";

export interface Transition {
  readonly id: string;
  readonly clipAId: string;
  readonly clipBId?: string;
  readonly edge?: TransitionEdge;
  readonly type: TransitionType;
  readonly duration: number;
  readonly params: Record<string, unknown>;
}

export type CaptionAnimationStyle =
  | "none"
  | "word-highlight"
  | "word-by-word"
  | "karaoke"
  | "bounce"
  | "typewriter";

export interface SubtitleWord {
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
}

export interface Subtitle {
  readonly id: string;
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly style?: SubtitleStyle;
  readonly words?: SubtitleWord[];
  readonly animationStyle?: CaptionAnimationStyle;
}

export interface SubtitleStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly color: string;
  readonly backgroundColor: string;
  readonly position: "top" | "center" | "bottom";
  readonly highlightColor?: string;
  readonly upcomingColor?: string;
}

export interface AutomationPoint {
  readonly time: number;
  readonly value: number;
}
