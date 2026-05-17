import type { ShapeStyle, ShapeType } from "../graphics/types";
import type { TextAnimation, TextStyle } from "../text/types";
import type { LayerEffectType } from "../types/effects";
import type { Clip, EasingType, Transform } from "../types/timeline";
import type { BlendMode } from "../video/types";

export type EditingTemplateCategory =
  | "cinema"
  | "glitch"
  | "retro"
  | "social"
  | "branding"
  | "color"
  | "overlay"
  | "text-effects"
  | "transitions";

export type EditingTemplateTargetType = "video" | "image";

export type EditingTemplatePrimitive = number | string | boolean;

export interface EditingTemplateBinding {
  readonly controlId: string;
}

export type EditingTemplateValue =
  | EditingTemplatePrimitive
  | EditingTemplateBinding
  | { readonly [key: string]: EditingTemplateValue }
  | EditingTemplateValue[];

export type EditingTemplateControlType =
  | "number"
  | "color"
  | "text"
  | "toggle"
  | "select";

export interface EditingTemplateControlOption {
  readonly label: string;
  readonly value: EditingTemplatePrimitive;
}

export interface EditingTemplateControlDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: EditingTemplateControlType;
  readonly defaultValue: EditingTemplatePrimitive;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly EditingTemplateControlOption[];
}

export interface EditingTemplateKeyframe {
  readonly time: number;
  readonly property: string;
  readonly value: EditingTemplateValue;
  readonly easing?: EasingType;
}

export interface EditingTemplateEffect {
  readonly id?: string;
  readonly type: LayerEffectType | string;
  readonly enabled?: boolean;
  readonly params: Readonly<Record<string, EditingTemplateValue>>;
  readonly keyframes?: readonly EditingTemplateKeyframe[];
}

export interface EditingTemplateIntroTiming {
  readonly kind: "intro";
  readonly duration: number;
}

export interface EditingTemplateOutroTiming {
  readonly kind: "outro";
  readonly duration: number;
}

export interface EditingTemplateRangeTiming {
  readonly kind: "range";
  readonly start: number;
  readonly end: number;
  readonly unit?: "seconds" | "fraction";
}

export type EditingTemplateTiming =
  | "full"
  | EditingTemplateIntroTiming
  | EditingTemplateOutroTiming
  | EditingTemplateRangeTiming;

export interface EditingTemplateVector2 {
  readonly x: EditingTemplateValue;
  readonly y: EditingTemplateValue;
}

export interface EditingTemplateTransform {
  readonly position?: EditingTemplateVector2;
  readonly scale?: EditingTemplateVector2;
  readonly rotation?: EditingTemplateValue;
  readonly anchor?: EditingTemplateVector2;
  readonly opacity?: EditingTemplateValue;
}

export interface EditingTemplateTextAnimation {
  readonly preset: TextAnimation["preset"];
  readonly inDuration: number;
  readonly outDuration: number;
  readonly stagger?: number;
  readonly unit?: TextAnimation["unit"];
  readonly params?: Partial<TextAnimation["params"]>;
}

export interface EditingTemplateEmphasisAnimation {
  readonly type: "none" | "pulse" | "shake" | "bounce" | "float" | "spin" | "flash" | "heartbeat" | "swing" | "wobble" | "jello" | "rubber-band" | "tada" | "vibrate" | "flicker" | "glow" | "breathe" | "wave" | "tilt" | "zoom-pulse" | "focus-zoom" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "ken-burns";
  readonly speed: EditingTemplateValue;
  readonly intensity: EditingTemplateValue;
  readonly loop: boolean;
  readonly focusPoint?: EditingTemplateVector2;
  readonly zoomScale?: EditingTemplateValue;
  readonly holdDuration?: EditingTemplateValue;
  readonly startTime?: EditingTemplateValue;
  readonly animationDuration?: EditingTemplateValue;
}

export interface EditingTemplateOverlayBase {
  readonly id?: string;
  readonly trackType: "text" | "graphics";
  readonly timing: EditingTemplateTiming;
  readonly transform?: EditingTemplateTransform;
  readonly keyframes?: readonly EditingTemplateKeyframe[];
  readonly blendMode?: BlendMode;
  readonly blendOpacity?: EditingTemplateValue;
  readonly emphasisAnimation?: EditingTemplateEmphasisAnimation;
}

export interface EditingTemplateTextOverlay extends EditingTemplateOverlayBase {
  readonly type: "text";
  readonly trackType: "text";
  readonly content: {
    readonly text: string;
    readonly style?: Readonly<Record<string, EditingTemplateValue>>;
    readonly animation?: EditingTemplateTextAnimation;
  };
}

export interface EditingTemplateShapeOverlay extends EditingTemplateOverlayBase {
  readonly type: "shape";
  readonly trackType: "graphics";
  readonly content: {
    readonly shapeType: ShapeType;
    readonly width: EditingTemplateValue;
    readonly height: EditingTemplateValue;
    readonly style?: Readonly<Record<string, EditingTemplateValue>>;
  };
}

export interface EditingTemplateImageOverlay extends EditingTemplateOverlayBase {
  readonly type: "image";
  readonly trackType: "graphics";
  readonly content: {
    readonly assetId?: string;
    readonly imageUrl?: string;
    readonly name?: string;
  };
}

export type EditingTemplateOverlay =
  | EditingTemplateTextOverlay
  | EditingTemplateShapeOverlay
  | EditingTemplateImageOverlay;

export interface EditingTemplateRecipe {
  readonly effects: readonly EditingTemplateEffect[];
  readonly overlays: readonly EditingTemplateOverlay[];
  readonly audioEffects: readonly EditingTemplateEffect[];
}

export interface EditingTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: EditingTemplateCategory;
  readonly thumbnailUrl: string | null;
  readonly previewUrl?: string | null;
  readonly tags: readonly string[];
  readonly supportedTargets?: readonly EditingTemplateTargetType[];
  readonly controls?: readonly EditingTemplateControlDefinition[];
  readonly recipe: EditingTemplateRecipe;
}

export interface EditingTemplateCategoryDefinition {
  readonly id: EditingTemplateCategory;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}

export interface EditingTemplateResolutionContext {
  readonly clip: Pick<Clip, "id" | "startTime" | "duration"> & {
    readonly name?: string;
  };
  readonly now?: Date;
  readonly assetUrls?: Readonly<Record<string, string>>;
}

export interface ResolvedEditingTemplateKeyframe {
  readonly time: number;
  readonly property: string;
  readonly value: unknown;
  readonly easing: EasingType;
}

export interface ResolvedEditingTemplateEffect {
  readonly id: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly params: Record<string, unknown>;
  readonly keyframes: readonly ResolvedEditingTemplateKeyframe[];
}

export interface ResolvedEditingTemplateTiming {
  readonly startTime: number;
  readonly duration: number;
}

export interface ResolvedEditingTemplateTextOverlay {
  readonly id: string;
  readonly type: "text";
  readonly trackType: "text";
  readonly timing: ResolvedEditingTemplateTiming;
  readonly transform: Transform;
  readonly blendMode?: BlendMode;
  readonly blendOpacity?: number;
  readonly keyframes: readonly ResolvedEditingTemplateKeyframe[];
  readonly emphasisAnimation?: {
    readonly type: EditingTemplateEmphasisAnimation["type"];
    readonly speed: number;
    readonly intensity: number;
    readonly loop: boolean;
    readonly focusPoint?: { x: number; y: number };
    readonly zoomScale?: number;
    readonly holdDuration?: number;
    readonly startTime?: number;
    readonly animationDuration?: number;
  };
  readonly content: {
    readonly text: string;
    readonly style: Partial<TextStyle>;
    readonly animation?: EditingTemplateTextAnimation;
  };
}

export interface ResolvedEditingTemplateShapeOverlay {
  readonly id: string;
  readonly type: "shape";
  readonly trackType: "graphics";
  readonly timing: ResolvedEditingTemplateTiming;
  readonly transform: Transform;
  readonly blendMode?: BlendMode;
  readonly blendOpacity?: number;
  readonly keyframes: readonly ResolvedEditingTemplateKeyframe[];
  readonly emphasisAnimation?: ResolvedEditingTemplateTextOverlay["emphasisAnimation"];
  readonly content: {
    readonly shapeType: ShapeType;
    readonly width: number;
    readonly height: number;
    readonly style: Partial<ShapeStyle>;
  };
}

export interface ResolvedEditingTemplateImageOverlay {
  readonly id: string;
  readonly type: "image";
  readonly trackType: "graphics";
  readonly timing: ResolvedEditingTemplateTiming;
  readonly transform: Transform;
  readonly blendMode?: BlendMode;
  readonly blendOpacity?: number;
  readonly keyframes: readonly ResolvedEditingTemplateKeyframe[];
  readonly emphasisAnimation?: ResolvedEditingTemplateTextOverlay["emphasisAnimation"];
  readonly content: {
    readonly assetId?: string;
    readonly imageUrl?: string;
    readonly name?: string;
  };
}

export type ResolvedEditingTemplateOverlay =
  | ResolvedEditingTemplateTextOverlay
  | ResolvedEditingTemplateShapeOverlay
  | ResolvedEditingTemplateImageOverlay;

export interface ResolvedEditingTemplateApplication {
  readonly template: EditingTemplate;
  readonly controlValues: Record<string, EditingTemplatePrimitive>;
  readonly effects: readonly ResolvedEditingTemplateEffect[];
  readonly audioEffects: readonly ResolvedEditingTemplateEffect[];
  readonly overlays: readonly ResolvedEditingTemplateOverlay[];
}