import type { ProjectSettings } from "./project";
import type {
  Transform,
  EasingType,
  SubtitleStyle,
  Subtitle,
  AutomationPoint,
  Marker,
  Effect,
  Clip,
  Keyframe,
  ChromaKeySettings,
  SpeedKeyframe,
  FreezeFrame,
} from "./timeline";
import type { TransitionType } from "./effects";
import type { Transition } from "./timeline";
import type { BlendMode } from "../video/types";
import type { EmphasisAnimation } from "../graphics/types";
import type { ClipColorGrading } from "../video/color-grading-engine";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";
import type { AdjustmentLayer } from "../video/adjustment-layer-engine";
import type { Mask } from "../video/mask-engine";
import type { MultiCamGroup } from "../video/multicam-engine";
import type {
  CompoundClip,
  CompoundClipInstance,
} from "../timeline/nested-sequence-engine";
import type {
  MotionComposition,
  MotionCompositionInstance,
} from "../motion/types";
import type { MotionShaderDef } from "../motion/shaders/types";
export interface Action {
  readonly type: string;
  readonly id: string;
  readonly timestamp: number;
  readonly params: Record<string, unknown>;
}

// Action result returned after execution
export interface ActionResult {
  readonly success: boolean;
  readonly error?: ActionError;
  readonly warnings?: string[];
  readonly actionId?: string;
}

// Error codes for action validation and execution
export type ActionErrorCode =
  | "INVALID_PARAMS" // Missing or malformed parameters
  | "CLIP_NOT_FOUND" // Referenced clip doesn't exist
  | "TRACK_NOT_FOUND" // Referenced track doesn't exist
  | "TRACK_LOCKED" // Attempting to modify locked track
  | "INCOMPATIBLE_TYPE" // e.g., video clip on audio track
  | "OVERLAP_DETECTED" // Clip placement would cause overlap
  | "INSUFFICIENT_HANDLES" // Not enough frames for transition
  | "MEDIA_NOT_FOUND" // Referenced media doesn't exist
  | "UNSUPPORTED_FORMAT" // Media format not supported
  | "STORAGE_FULL" // IndexedDB quota exceeded
  | "DECODE_ERROR" // Failed to decode media
  | "EXPORT_ERROR" // Failed during export
  | "INVALID_TIME_RANGE"
  | "OUT_OF_BOUNDS" // Time or position outside valid range
  | "CIRCULAR_REFERENCE" // Nested sequence references itself
  | "EFFECT_NOT_FOUND" // Referenced effect doesn't exist
  | "KEYFRAME_CONFLICT"; // Keyframe already exists at time

// Action error with detailed information
export interface ActionError {
  readonly code: ActionErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly suggestion?: string; // User-friendly recovery suggestion
}

// Validation result for action parameters
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ValidationError[];
}

// Validation error for specific parameter
export interface ValidationError {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

// Project actions
export type ProjectAction =
  | {
      type: "project/create";
      params: { name: string; settings: ProjectSettings };
    }
  | { type: "project/updateSettings"; params: Partial<ProjectSettings> }
  | {
      type: "project/setCanvasBackground";
      params: {
        backgroundFillMode?: "color" | "blur";
        layoutBackgroundColor?: string;
      };
    }
  | { type: "project/rename"; params: { name: string } }
  | {
      type: "project/registerGeneratedShader";
      params: { def: MotionShaderDef };
    }
  | {
      type: "project/removeGeneratedShader";
      params: { shaderId: string };
    };

// Media actions
export type MediaAction =
  | { type: "media/import"; params: { file: File } }
  | { type: "media/delete"; params: { mediaId: string } }
  | { type: "media/rename"; params: { mediaId: string; name: string } };

// Track actions
export type TrackAction =
  | {
      type: "track/add";
      params: {
        trackType: "video" | "audio" | "image" | "text" | "graphics";
        position?: number;
        /** Pre-assigned track ID. When omitted, the executor generates one. */
        trackId?: string;
      };
    }
  | {
      type: "track/duplicate";
      params: {
        sourceTrackId: string;
        position?: number;
        /** Pre-assigned ID enables deterministic history and collaboration. */
        trackId?: string;
      };
    }
  | { type: "track/remove"; params: { trackId: string } }
  | { type: "track/rename"; params: { trackId: string; name: string } }
  | { type: "track/reorder"; params: { trackId: string; newPosition: number } }
  | { type: "track/lock"; params: { trackId: string; locked: boolean } }
  | { type: "track/hide"; params: { trackId: string; hidden: boolean } }
  | { type: "track/mute"; params: { trackId: string; muted: boolean } }
  | { type: "track/solo"; params: { trackId: string; solo: boolean } };

// Clip actions
export type ClipAction =
  | {
      type: "clip/add";
      params: {
        trackId: string;
        mediaId: string;
        startTime: number;
        sourceClip?: Clip;
      };
    }
  | { type: "clip/remove"; params: { clipId: string } }
  | {
      type: "clip/move";
      params: { clipId: string; startTime: number; trackId?: string };
    }
  | {
      type: "clip/trim";
      params: { clipId: string; inPoint?: number; outPoint?: number };
    }
  | { type: "clip/split"; params: { clipId: string; time: number } }
  | { type: "clip/rippleDelete"; params: { clipId: string } }
  | {
      type: "clip/setBlendMode";
      params: { clipId: string; blendMode: BlendMode };
    }
  | { type: "clip/setBlendOpacity"; params: { clipId: string; opacity: number } }
  | {
      type: "clip/setEmphasisAnimation";
      params: { clipId: string; emphasisAnimation: EmphasisAnimation };
    }
  | {
      type: "clip/setColorGrading";
      params: { clipId: string; colorGrading?: ClipColorGrading };
    }
  | { type: "clip/restore"; params: { clip: Clip } }
  | { type: "clip/merge"; params: { clipId: string; originalClip: Clip } }
  | {
      type: "clip/rippleRestore";
      params: {
        clip: Clip;
        affectedClips: Array<{ id: string; originalStartTime: number }>;
      };
    }
  | { type: "clip/slip"; params: { clipId: string; delta: number } }
  | {
      type: "clip/slide";
      params: {
        clipId: string;
        delta: number;
        prevClipId?: string;
        nextClipId?: string;
      };
    }
  | {
      type: "clip/roll";
      params: { leftClipId: string; rightClipId: string; delta: number };
    }
  | {
      type: "clip/trimToPlayhead";
      params: { clipId: string; playheadTime: number; trimStart: boolean };
    }
  | { type: "clip/closeGapBefore"; params: { clipId: string } }
  | { type: "clip/setSpeed"; params: { clipId: string; speed: number } }
  | { type: "clip/setReverse"; params: { clipId: string; reversed: boolean } }
  | {
      type: "clip/setPitchCorrection";
      params: { clipId: string; pitchCorrection: boolean };
    }
  | {
      type: "clip/setStabilization";
      params: { clipId: string; stabilization?: Clip["stabilization"] };
    }
  | {
      type: "clip/setChromaKey";
      params: { clipId: string; chromaKey?: ChromaKeySettings };
    };

// Speed / time-remap actions
export type SpeedAction =
  | {
      type: "speed/setKeyframes";
      params: { clipId: string; keyframes: SpeedKeyframe[] };
    }
  | {
      type: "speed/setFreezeFrames";
      params: { clipId: string; freezeFrames: FreezeFrame[] };
    }
  | {
      type: "speed/setRampData";
      params: {
        clipId: string;
        keyframes?: SpeedKeyframe[];
        freezeFrames?: FreezeFrame[];
        pitchCorrection?: boolean;
      };
    };

// Effect actions
export type EffectAction =
  | {
      type: "effect/add";
      params: {
        clipId: string;
        effectType: string;
        params?: Record<string, unknown>;
        /** Pre-assigned effect ID. When omitted, the executor generates one. */
        effectId?: string;
        /** Optional insertion position used by effect duplication. */
        index?: number;
        /** Preserve disabled state when cloning an authored effect. */
        enabled?: boolean;
      };
    }
  | { type: "effect/remove"; params: { clipId: string; effectId: string } }
  | {
      type: "effect/update";
      params: {
        clipId: string;
        effectId: string;
        params: Record<string, unknown>;
      };
    }
  | {
      type: "effect/toggle";
      params: { clipId: string; effectId: string; enabled: boolean };
    }
  | {
      type: "effect/reorder";
      params: { clipId: string; effectId: string; newIndex: number };
    }
  | { type: "effect/setOrder"; params: { clipId: string; effectIds: string[] } }
  | { type: "effect/setStack"; params: { clipId: string; effects: Effect[] } };
export type TransformAction = {
  type: "transform/update";
  params: { clipId: string; transform: Partial<Transform> };
};

// Keyframe actions
export type KeyframeAction =
  | {
      type: "keyframe/add";
      params: {
        clipId: string;
        property: string;
        time: number;
        value: unknown;
      };
    }
  | {
      type: "keyframe/remove";
      params: { clipId: string; property: string; time: number };
    }
  | {
      type: "keyframe/update";
      params: {
        clipId: string;
        property: string;
        time: number;
        value?: unknown;
        easing?: EasingType;
      };
    }
  | {
      type: "keyframe/setAll";
      params: { clipId: string; keyframes: Keyframe[] };
    };

// Transition actions
export type TransitionAction =
  | {
      type: "transition/add";
      params: {
        clipAId: string;
        clipBId: string;
        transitionType: TransitionType;
        duration: number;
      };
    }
  | { type: "transition/set"; params: { transition: Transition } }
  | { type: "transition/remove"; params: { transitionId: string } }
  | {
      type: "transition/update";
      params: {
        transitionId: string;
        type?: TransitionType;
        duration?: number;
        params?: Record<string, unknown>;
      };
    };

// Audio actions
export type AudioAction =
  | { type: "audio/setVolume"; params: { clipId: string; volume: number } }
  | {
      type: "audio/setFade";
      params: { clipId: string; fadeIn?: number; fadeOut?: number };
    }
  | {
      type: "audio/addAutomation";
      params: { clipId: string; points: AutomationPoint[] };
    }
  | { type: "audio/addEffect"; params: { clipId: string; effect: Effect } }
  | {
      type: "audio/removeEffect";
      params: { clipId: string; effectId: string };
    }
  | {
      type: "audio/updateEffect";
      params: {
        clipId: string;
        effectId: string;
        params: Record<string, unknown>;
      };
    }
  | {
      type: "audio/toggleEffect";
      params: { clipId: string; effectId: string; enabled: boolean };
    };

// Subtitle actions
export type SubtitleAction =
  | { type: "subtitle/import"; params: { srtContent: string } }
  | {
      type: "subtitle/add";
      params: { text: string; startTime: number; endTime: number };
    }
  | {
      type: "subtitle/update";
      params: {
        subtitleId: string;
        text?: string;
        startTime?: number;
        endTime?: number;
      };
    }
  | { type: "subtitle/remove"; params: { subtitleId: string } }
  | { type: "subtitle/setStyle"; params: { style: SubtitleStyle } }
  | { type: "subtitle/replace"; params: { subtitleId: string; subtitle: Subtitle } }
  | { type: "subtitle/setAll"; params: { subtitles: Subtitle[] } };

// Marker actions
export type MarkerAction =
  | {
      type: "marker/add";
      params: { time: number; label: string; color: string };
    }
  | { type: "marker/remove"; params: { markerId: string } }
  | {
      type: "marker/update";
      params: { markerId: string; updates: Partial<Marker> };
    };
// Overlay actions (text / shape / svg / sticker clips, authoritative on the project)
export type OverlayAction =
  | { type: "text/create"; params: { clip: TextClip } }
  | { type: "text/update"; params: { clipId: string; updates: Partial<TextClip> } }
  | { type: "text/remove"; params: { clipId: string } }
  | { type: "shape/create"; params: { clip: ShapeClip } }
  | { type: "shape/update"; params: { clipId: string; updates: Partial<ShapeClip> } }
  | { type: "shape/remove"; params: { clipId: string } }
  | { type: "svg/create"; params: { clip: SVGClip } }
  | { type: "svg/update"; params: { clipId: string; updates: Partial<SVGClip> } }
  | { type: "svg/remove"; params: { clipId: string } }
  | { type: "sticker/create"; params: { clip: StickerClip } }
  | { type: "sticker/update"; params: { clipId: string; updates: Partial<StickerClip> } }
  | { type: "sticker/remove"; params: { clipId: string } };

export type MotionAction =
  | {
      type: "motion/createComposition";
      params: { composition: MotionComposition };
    }
  | {
      type: "motion/upsertComposition";
      params: { composition: MotionComposition };
    }
  | {
      type: "motion/removeComposition";
      params: { compositionId: string };
    }
  | {
      type: "motion/insertInstance";
      params: { instance: MotionCompositionInstance };
    }
  | {
      type: "motion/removeInstance";
      params: { instanceId: string };
    };

// Adjustment-layer actions (project-level overlay effects layers)
export type AdjustmentAction =
  | { type: "adjustment/setAll"; params: { layers: AdjustmentLayer[] } }
  | { type: "mask/setAll"; params: { masks: Mask[] } }
  | { type: "multicam/setAll"; params: { groups: MultiCamGroup[] } }
  | {
      type: "nested/setAll";
      params: {
        compoundClips: CompoundClip[];
        instances: CompoundClipInstance[];
      };
    };

export type TimelineAction =
  | ProjectAction
  | MediaAction
  | TrackAction
  | ClipAction
  | SpeedAction
  | OverlayAction
  | MotionAction
  | AdjustmentAction
  | EffectAction
  | TransformAction
  | KeyframeAction
  | TransitionAction
  | AudioAction
  | SubtitleAction
  | MarkerAction;
