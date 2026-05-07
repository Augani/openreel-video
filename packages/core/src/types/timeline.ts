import type { TransitionType } from "./effects";
import type { EmphasisAnimation } from "../graphics/types";

export interface Timeline {
  readonly tracks: Track[];
  readonly subtitles: Subtitle[];
  readonly duration: number;
  readonly markers: Marker[];
  readonly beatMarkers?: TimelineBeatMarker[];
  readonly beatAnalysis?: TimelineBeatAnalysis;
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
  readonly volume: number;
  readonly fade?: { fadeIn: number; fadeOut: number };
  readonly automation?: {
    volume?: AutomationPoint[];
    pan?: AutomationPoint[];
  };
  readonly keyframes: Keyframe[];
  readonly speed?: number;
  readonly reversed?: boolean;
  readonly emphasisAnimation?: EmphasisAnimation;
  /** Zero-based index of the audio track within the source media file to use for this clip.
   * Undefined or 0 means the primary/first audio track. */
  readonly audioTrackIndex?: number;
}

export interface Effect {
  readonly id: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
  readonly enabled: boolean;
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
}

export type EasingType =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "bezier"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInQuint"
  | "easeOutQuint"
  | "easeInOutQuint"
  | "easeInSine"
  | "easeOutSine"
  | "easeInOutSine"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInCirc"
  | "easeOutCirc"
  | "easeInOutCirc"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack"
  | "easeInElastic"
  | "easeOutElastic"
  | "easeInOutElastic"
  | "easeInBounce"
  | "easeOutBounce"
  | "easeInOutBounce";

export interface Marker {
  readonly id: string;
  readonly time: number;
  readonly label: string;
  readonly color: string;
}

export interface Transition {
  readonly id: string;
  readonly clipAId: string;
  readonly clipBId: string;
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
