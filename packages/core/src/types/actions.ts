import type { ProjectSettings } from "./project";
import type {
  Transform,
  EasingType,
  SubtitleStyle,
  AutomationPoint,
} from "./timeline";
import type { TransitionType } from "./effects";
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
  | { type: "project/rename"; params: { name: string } };

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
  | { type: "track/remove"; params: { trackId: string } }
  | { type: "track/reorder"; params: { trackId: string; newPosition: number } }
  | { type: "track/lock"; params: { trackId: string; locked: boolean } }
  | { type: "track/hide"; params: { trackId: string; hidden: boolean } }
  | { type: "track/mute"; params: { trackId: string; muted: boolean } }
  | { type: "track/solo"; params: { trackId: string; solo: boolean } };

// Clip actions
export type ClipAction =
  | {
      type: "clip/add";
      params: { trackId: string; mediaId: string; startTime: number };
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
  | { type: "clip/rippleDelete"; params: { clipId: string } };

// Effect actions
export type EffectAction =
  | {
      type: "effect/add";
      params: {
        clipId: string;
        effectType: string;
        params?: Record<string, unknown>;
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
      type: "effect/reorder";
      params: { clipId: string; effectId: string; newIndex: number };
    };
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
  | { type: "transition/remove"; params: { transitionId: string } }
  | {
      type: "transition/update";
      params: {
        transitionId: string;
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
  | { type: "subtitle/setStyle"; params: { style: SubtitleStyle } };
export type TimelineAction =
  | ProjectAction
  | MediaAction
  | TrackAction
  | ClipAction
  | EffectAction
  | TransformAction
  | KeyframeAction
  | TransitionAction
  | AudioAction
  | SubtitleAction;
