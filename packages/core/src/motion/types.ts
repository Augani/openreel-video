import type {
  Keyframe,
  Marker,
  TimelineBeatAnalysis,
  TimelineBeatMarker,
  Transform,
} from "../types/timeline";
import type { BlendMode } from "../video/types";
import type {
  CornerRadii,
  GradientStyle,
  MotionShaderFill,
  MotionShaderParamValue,
  ShadowStyle,
  ShapeStyle,
  ShapeType,
} from "../graphics/types";
import type { MotionShapePathPoint } from "./motion-shape-path";

export type MotionLayerType =
  | "text"
  | "shape"
  | "image"
  | "video"
  | "group"
  | "null"
  | "composition"
  | "adjustment"
  | "particle"
  | "scene3d";
export type MotionEffectType =
  | "blur"
  | "drop-shadow"
  | "glow"
  | "color-adjust"
  | "invert"
  | "grayscale"
  | "sepia"
  | "levels"
  | "sharpen"
  | "posterize"
  | "directional-blur"
  | "noise"
  | "radial-blur"
  | "displace"
  | "threshold"
  | "mosaic"
  | "chromatic-aberration"
  | "vignette"
  | "backdrop-blur"
  | "shader"
  | "slider-control"
  | "checkbox-control"
  | "angle-control";
export type MotionMaskShape = "rectangle" | "ellipse" | "polygon" | "path";
export type MotionMaskMode = "add" | "subtract";
export type MotionTrackMatteType =
  | "alpha"
  | "alpha-inverted"
  | "luma"
  | "luma-inverted";
export type MotionExpressionType =
  | "sine"
  | "wiggle"
  | "drift"
  | "spring"
  | "loop"
  | "ping-pong"
  | "random"
  | "posterize"
  | "expression";
export type MotionShapeModifierType =
  | "trim-paths"
  | "repeater"
  | "zig-zag"
  | "round-corners"
  | "wiggle-paths"
  | "offset-paths"
  | "pucker-bloat"
  | "twist";

export const MOTION_SHAPE_MODIFIER_TYPES: readonly MotionShapeModifierType[] = [
  "trim-paths",
  "repeater",
  "zig-zag",
  "round-corners",
  "wiggle-paths",
  "offset-paths",
  "pucker-bloat",
  "twist",
];

export type MotionShapeMergeMode =
  | "none"
  | "union"
  | "subtract"
  | "intersect"
  | "exclude";
export type MotionTextAnimatorBasedOn = "characters" | "words";
export type MotionTextAnimatorDirection = "forward" | "reverse" | "center";
export type MotionTextAnimatorEasing = "linear" | "ease" | "ease-in" | "ease-out";
export type MotionLightType = "ambient" | "point" | "directional";
export type MotionParticleShape = "circle" | "square";
export type MotionTrackingApplyMode = "position" | "position-scale-rotation";

export interface MotionVector2 {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

export interface MotionRotation3D {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

export type MotionObject3DKind =
  | "box"
  | "rounded-box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "icosahedron"
  | "plane"
  | "phone"
  | "model"
  | "text3d"
  | "soccer-ball"
  | "open-box"
  | "room";

/**
 * Baked triangle mesh (flat JSON-serializable arrays) produced by the creation
 * geometry kernel. When present on a MotionObject3D it renders directly as a
 * THREE.BufferGeometry (normalized to the object's size), so procedural geometry
 * — primitives, extrude/revolve/sweep, and displacement/subdivision modifiers —
 * renders faithfully instead of collapsing to a primitive proxy.
 */
export interface MotionObjectMeshData {
  readonly positions: readonly number[];
  readonly normals?: readonly number[];
  readonly uvs?: readonly number[];
  readonly indices: readonly number[];
  /** When true the renderer uses positions as-is (already world-scaled), skipping
   * the per-mesh center+normalize so animated/deforming frames don't jitter. */
  readonly preScaled?: boolean;
}

/**
 * A time-indexed sequence of deforming-mesh frames (shared topology, per-frame
 * positions) baked from a simulation/rig solver. When present, the renderer
 * samples the frame for the current time into `mesh`, so cloth, soft bodies,
 * skinned characters, and other vertex-animated geometry render moving instead
 * of as a static mesh plus transform keyframes.
 */
export interface MotionObjectMeshFrames {
  readonly fps: number;
  readonly indices: readonly number[];
  readonly uvs?: readonly number[];
  readonly frames: readonly (readonly number[])[];
  readonly loop?: boolean;
}

export interface MotionObject3D {
  readonly kind: MotionObject3DKind;
  /** Baked kernel mesh; when set it renders as a BufferGeometry, overriding `kind`. */
  readonly mesh?: MotionObjectMeshData;
  /** Per-frame deforming-mesh sequence; sampled by time into `mesh` at render. */
  readonly meshFrames?: MotionObjectMeshFrames;
  /** Relative size of the object within the layer bounds (0..1 of the shorter edge). */
  readonly size?: number;
  /** For box/rounded-box/phone: relative depth (z) vs width. */
  readonly depth?: number;
  /** Optional aspect override (height/width) for box-like objects. */
  readonly aspect?: number;
  readonly cornerRadius?: number;
  /** For kind="model": URL of a .glb/.gltf model to load (auto-normalized to fit). */
  readonly modelUrl?: string;
  /** For kind="text3d": the string to extrude into 3D. */
  readonly text?: string;
  /** For kind="text3d": extrusion depth as a fraction of font size (default 0.2). */
  readonly extrude?: number;
  /** For kind="soccer-ball": labels printed onto the ball (e.g. ["FIFA","WORLD CUP"]). */
  readonly panelTexts?: readonly string[];
  /**
   * For kind="model": play a GLB/glTF animation clip at render time. `clipName`
   * wins over `clipIndex`; when neither is set the first clip is used.
   */
  readonly animation?: MotionModelAnimation;
}

export interface MotionModelAnimation {
  readonly clipName?: string;
  readonly clipIndex?: number;
  readonly timeOffset?: number;
  readonly playbackRate?: number;
  readonly loop?: boolean;
}

export interface MotionMaterial3D {
  readonly kind?: "physical" | "basic";
  readonly color?: string;
  readonly metalness?: number;
  readonly roughness?: number;
  /** Optional texture: an image asset id in the composition (e.g. a screen wallpaper). */
  readonly mapAssetId?: string;
  /** Surface-detail maps: image asset ids for tangent-space normal / roughness / metalness. */
  readonly normalMapAssetId?: string;
  readonly roughnessMapAssetId?: string;
  readonly metalnessMapAssetId?: string;
  /** Emissive glow color/strength for screens or accents. */
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly opacity?: number;
  /** Physical glass: 0 opaque .. 1 fully transmissive (MeshPhysicalMaterial). */
  readonly transmission?: number;
  /** Index of refraction for transmissive materials (glass ~1.5). */
  readonly ior?: number;
  /** Clear lacquer layer 0..1 + its roughness, for coated/car-paint looks. */
  readonly clearcoat?: number;
  readonly clearcoatRoughness?: number;
}

export interface MotionScene3DLighting {
  readonly ambient?: number;
  readonly keyIntensity?: number;
  readonly keyColor?: string;
  readonly rimIntensity?: number;
  readonly environment?:
    | "studio"
    | "warm"
    | "cool"
    | "sunset"
    | "city"
    | "dark"
    | "none";
  /** Equirectangular world map for image-based lighting (.hdr/.exr/.jpg/.png); overrides the preset. */
  readonly environmentUrl?: string;
  /** Show the environment map as the scene backdrop (default off → transparent over the comp). */
  readonly environmentBackground?: boolean;
  readonly groundShadow?: boolean;
}

export interface MotionSceneVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MotionSceneObject3DTransform {
  readonly position?: MotionSceneVector3;
  /** Euler rotation in degrees. */
  readonly rotation?: MotionSceneVector3;
  readonly scale?: MotionSceneVector3;
}

/** One object inside a multi-object 3D scene (shares the scene's camera + lights). */
export interface MotionSceneObject3D {
  readonly id: string;
  readonly name?: string;
  /** Geometry/content — same vocabulary as the single-object MotionObject3D. */
  readonly object: MotionObject3D;
  readonly material?: MotionMaterial3D;
  readonly transform3d?: MotionSceneObject3DTransform;
  /** kind="open-box": initial lid angle in degrees (0 = closed). */
  readonly lidAngle?: number;
  /** Static opacity 0..1; keyframeable via scene.object.<id>.opacity. */
  readonly opacity?: number;
}

/** Cinematic camera for a multi-object scene; position/target/fov are keyframeable. */
export interface MotionScene3DCamera {
  readonly position?: MotionSceneVector3;
  readonly target?: MotionSceneVector3;
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

/** Optional enclosing room (floor + walls) the camera can fly into. */
export interface MotionScene3DRoom {
  readonly enabled?: boolean;
  readonly size?: number;
  readonly wallColor?: string;
  readonly floorColor?: string;
}

export interface MotionTransform {
  readonly position: MotionVector2;
  readonly scale: MotionVector2;
  readonly rotation: number;
  readonly rotation3d?: MotionRotation3D;
  readonly anchor: MotionVector2;
  readonly opacity: number;
  readonly perspective?: number;
  readonly transformStyle?: "flat" | "preserve-3d";
}

export interface MotionEffectBase {
  readonly id: string;
  readonly type: MotionEffectType;
  readonly name: string;
  readonly enabled: boolean;
}

export interface MotionBlurEffect extends MotionEffectBase {
  readonly type: "blur";
  readonly radius: number;
}

export interface MotionDropShadowEffect extends MotionEffectBase {
  readonly type: "drop-shadow";
  readonly color: string;
  readonly opacity: number;
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface MotionGlowEffect extends MotionEffectBase {
  readonly type: "glow";
  readonly color: string;
  readonly intensity: number;
  readonly radius: number;
}

export interface MotionBackdropBlurEffect extends MotionEffectBase {
  readonly type: "backdrop-blur";
  readonly radius: number;
}

export interface MotionColorAdjustEffect extends MotionEffectBase {
  readonly type: "color-adjust";
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly hue: number;
}

export interface MotionInvertEffect extends MotionEffectBase {
  readonly type: "invert";
  readonly amount: number;
}

export interface MotionGrayscaleEffect extends MotionEffectBase {
  readonly type: "grayscale";
  readonly amount: number;
}

export interface MotionSepiaEffect extends MotionEffectBase {
  readonly type: "sepia";
  readonly amount: number;
}

export interface MotionLevelsEffect extends MotionEffectBase {
  readonly type: "levels";
  readonly inputBlack: number;
  readonly inputWhite: number;
  readonly gamma: number;
  readonly outputBlack: number;
  readonly outputWhite: number;
}

export interface MotionSharpenEffect extends MotionEffectBase {
  readonly type: "sharpen";
  readonly amount: number;
}

export interface MotionPosterizeEffect extends MotionEffectBase {
  readonly type: "posterize";
  readonly levels: number;
}

export interface MotionDirectionalBlurEffect extends MotionEffectBase {
  readonly type: "directional-blur";
  readonly angle: number;
  readonly distance: number;
}

export interface MotionNoiseEffect extends MotionEffectBase {
  readonly type: "noise";
  readonly amount: number;
  readonly seed: number;
}

export interface MotionRadialBlurEffect extends MotionEffectBase {
  readonly type: "radial-blur";
  readonly centerX: number;
  readonly centerY: number;
  readonly amount: number;
}

export interface MotionDisplaceEffect extends MotionEffectBase {
  readonly type: "displace";
  readonly amount: number;
  readonly scale: number;
  readonly seed: number;
}

export interface MotionThresholdEffect extends MotionEffectBase {
  readonly type: "threshold";
  readonly level: number;
}

export interface MotionMosaicEffect extends MotionEffectBase {
  readonly type: "mosaic";
  readonly blockSize: number;
}

export interface MotionChromaticAberrationEffect extends MotionEffectBase {
  readonly type: "chromatic-aberration";
  readonly amount: number;
  readonly angle: number;
}

export interface MotionVignetteEffect extends MotionEffectBase {
  readonly type: "vignette";
  readonly amount: number;
  readonly softness: number;
}

export interface MotionShaderEffect extends MotionEffectBase {
  readonly type: "shader";
  readonly shaderId: string;
  readonly params: Record<string, MotionShaderParamValue>;
}

export interface MotionSliderControlEffect extends MotionEffectBase {
  readonly type: "slider-control";
  readonly value: number;
}

export interface MotionCheckboxControlEffect extends MotionEffectBase {
  readonly type: "checkbox-control";
  readonly value: number;
}

export interface MotionAngleControlEffect extends MotionEffectBase {
  readonly type: "angle-control";
  readonly value: number;
}

export type MotionEffect =
  | MotionBlurEffect
  | MotionDropShadowEffect
  | MotionGlowEffect
  | MotionColorAdjustEffect
  | MotionInvertEffect
  | MotionGrayscaleEffect
  | MotionSepiaEffect
  | MotionLevelsEffect
  | MotionSharpenEffect
  | MotionPosterizeEffect
  | MotionDirectionalBlurEffect
  | MotionNoiseEffect
  | MotionRadialBlurEffect
  | MotionDisplaceEffect
  | MotionThresholdEffect
  | MotionMosaicEffect
  | MotionChromaticAberrationEffect
  | MotionVignetteEffect
  | MotionBackdropBlurEffect
  | MotionShaderEffect
  | MotionSliderControlEffect
  | MotionCheckboxControlEffect
  | MotionAngleControlEffect;

export interface MotionMask {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly shape: MotionMaskShape;
  readonly mode: MotionMaskMode;
  readonly inverted: boolean;
  /**
   * Normalized layer-local mask bounds. `{ x: 0, y: 0, width: 1, height: 1 }`
   * covers the layer's estimated visual bounds.
   */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  /**
   * Pixel expansion applied in layer-local coordinates. Positive values grow
   * the mask edge; negative values contract it.
   */
  readonly expansion?: number;
  /**
   * Pixel feather applied to the mask edge in rendered previews and exports.
   */
  readonly feather?: number;
  /**
   * Mask alpha multiplier. `1` is fully opaque, lower values create partial
   * reveals or partial subtractive cuts.
   */
  readonly opacity?: number;
  /**
   * Polygon vertices for `shape: "polygon"`, expressed as normalized [0,1]
   * coordinates within the mask bounds rect. Ignored for rectangle/ellipse.
   */
  readonly points?: readonly MotionVector2[];
  /**
   * Bezier vertices for `shape: "path"`, expressed in layer-local pixel
   * coordinates. Requires at least three finite points. Ignored for legacy
   * rectangle/ellipse/polygon shapes.
   */
  readonly pathPoints?: readonly MotionShapePathPoint[];
  /**
   * Keyframed `pathData` snapshots animating the bezier `pathPoints` over time
   * (rotoscoping). Each keyframe stores a serialized path string. Only used for
   * `shape: "path"`; evaluated with the shared path interpolator.
   */
  readonly pathKeyframes?: readonly Keyframe[];
}

export interface MotionTrackMatte {
  readonly enabled: boolean;
  readonly sourceLayerId: string;
  readonly type: MotionTrackMatteType;
}

export interface MotionBlurSettings {
  readonly enabled: boolean;
  readonly shutterAngle: number;
  readonly shutterPhase: number;
  readonly samples: number;
}

export interface MotionCamera {
  readonly enabled: boolean;
  readonly position: MotionVector2;
  readonly zoom: number;
  readonly rotation: number;
  readonly perspective: number;
  readonly depthOfField?: {
    readonly enabled: boolean;
    readonly focusDistance: number;
    readonly aperture: number;
    readonly maxBlur: number;
  };
  readonly keyframes?: Keyframe[];
}

export interface MotionLight {
  readonly id: string;
  readonly type: MotionLightType;
  readonly name: string;
  readonly enabled: boolean;
  readonly color: string;
  readonly intensity: number;
  readonly position: MotionVector2;
  readonly radius: number;
  readonly falloff: number;
  readonly angle: number;
  readonly castsShadow: boolean;
  readonly shadowOpacity: number;
  readonly shadowSoftness: number;
  readonly keyframes?: Keyframe[];
}

export interface MotionExpression {
  readonly id: string;
  readonly property: string;
  readonly type: MotionExpressionType;
  readonly name: string;
  readonly enabled: boolean;
  readonly amplitude: number;
  readonly frequency: number;
  readonly phase: number;
  readonly seed: number;
  readonly decay: number;
  readonly code?: string;
}

export interface MotionTrimPathsModifier {
  readonly id: string;
  readonly type: "trim-paths";
  readonly name: string;
  readonly enabled: boolean;
  readonly start: number;
  readonly end: number;
  readonly offset: number;
}

export interface MotionRepeaterModifier {
  readonly id: string;
  readonly type: "repeater";
  readonly name: string;
  readonly enabled: boolean;
  readonly copies: number;
  readonly offset: number;
  readonly transform: {
    readonly position: MotionVector2;
    readonly scale: MotionVector2;
    readonly rotation: number;
    readonly opacity: number;
  };
}

export interface MotionZigZagModifier {
  readonly id: string;
  readonly type: "zig-zag";
  readonly name: string;
  readonly enabled: boolean;
  readonly size: number;
  readonly ridgesPerSegment: number;
}

export interface MotionRoundCornersModifier {
  readonly id: string;
  readonly type: "round-corners";
  readonly name: string;
  readonly enabled: boolean;
  readonly radius: number;
  readonly segments: number;
}

export interface MotionWigglePathsModifier {
  readonly id: string;
  readonly type: "wiggle-paths";
  readonly name: string;
  readonly enabled: boolean;
  readonly size: number;
  readonly detail: number;
  readonly speed: number;
  readonly seed: number;
}

export interface MotionOffsetPathsModifier {
  readonly id: string;
  readonly type: "offset-paths";
  readonly name: string;
  readonly enabled: boolean;
  readonly amount: number;
  readonly lineJoin: "miter" | "round" | "bevel";
}

export interface MotionPuckerBloatModifier {
  readonly id: string;
  readonly type: "pucker-bloat";
  readonly name: string;
  readonly enabled: boolean;
  readonly amount: number;
}

export interface MotionTwistModifier {
  readonly id: string;
  readonly type: "twist";
  readonly name: string;
  readonly enabled: boolean;
  readonly angle: number;
  readonly center: MotionVector2;
}

export type MotionShapeModifier =
  | MotionTrimPathsModifier
  | MotionRepeaterModifier
  | MotionZigZagModifier
  | MotionRoundCornersModifier
  | MotionWigglePathsModifier
  | MotionOffsetPathsModifier
  | MotionPuckerBloatModifier
  | MotionTwistModifier;

export interface MotionPuppetPin {
  readonly id: string;
  readonly name: string;
  readonly bindPosition: MotionVector2;
  readonly position: MotionVector2;
  readonly radius: number;
  readonly strength: number;
  readonly enabled: boolean;
  readonly color?: string;
}

export interface MotionTextAnimatorSelector {
  readonly basedOn: MotionTextAnimatorBasedOn;
  readonly start: number;
  readonly end: number;
  readonly offset: number;
}

export interface MotionTextAnimatorTiming {
  readonly startTime: number;
  readonly duration: number;
  readonly stagger: number;
  readonly direction: MotionTextAnimatorDirection;
  readonly easing: MotionTextAnimatorEasing;
}

export interface MotionTextAnimatorProperties {
  readonly position: MotionVector2;
  readonly scale: MotionVector2;
  readonly rotation: number;
  readonly opacity: number;
}

export interface MotionTextShaderRef {
  readonly shaderId: string;
  readonly params: Record<string, MotionShaderParamValue>;
}

export interface MotionTextAnimator {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly selector: MotionTextAnimatorSelector;
  readonly timing: MotionTextAnimatorTiming;
  readonly properties: MotionTextAnimatorProperties;
  readonly shader?: MotionTextShaderRef;
}

export interface MotionParticleEmitter {
  readonly emissionRate: number;
  readonly maxParticles: number;
  readonly lifetime: number;
  readonly speed: number;
  readonly spread: number;
  readonly gravity: number;
  readonly size: number;
  readonly sizeRandomness: number;
  readonly opacityStart: number;
  readonly opacityEnd: number;
  readonly colorStart: string;
  readonly colorEnd: string;
  readonly seed: number;
  readonly shape: MotionParticleShape;
}

export type MotionVariableBindingTarget =
  | "layer.visible"
  | "transform.opacity"
  | "text.content"
  | "text.color"
  | "shape.fill.color"
  | "shape.stroke.color"
  | "shape.width"
  | "shape.height"
  | "image.assetId";

export interface MotionVariableBinding {
  readonly id: string;
  readonly variableId: string;
  readonly target: MotionVariableBindingTarget;
}

export interface MotionLayerBase {
  readonly id: string;
  readonly type: MotionLayerType;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly solo?: boolean;
  /** Marks the layer as safe to hide from editing lists when the composition's shy switch is enabled. */
  readonly shy?: boolean;
  /** User-assigned organizational color shown in layer lists and the timeline. */
  readonly labelColor?: string;
  readonly guideLayer?: boolean;
  readonly transform: MotionTransform;
  readonly keyframes: Keyframe[];
  readonly expressions?: MotionExpression[];
  readonly effects?: MotionEffect[];
  readonly masks?: MotionMask[];
  readonly trackMatte?: MotionTrackMatte;
  readonly blendMode?: BlendMode;
  readonly motionBlur?: boolean;
  readonly autoOrient?: boolean;
  readonly parentId?: string;
  readonly variableBindings?: MotionVariableBinding[];
}

export interface MotionTextLayer extends MotionLayerBase {
  readonly type: "text";
  readonly text: string;
  readonly textAnimators?: MotionTextAnimator[];
  readonly style: {
    readonly fontFamily: string;
    readonly fontSize: number;
    readonly fontWeight?: string | number;
    readonly color: string;
    readonly align?: CanvasTextAlign;
    readonly lineHeight?: number;
    readonly letterSpacing?: number;
    /** Max line width in px; enables word wrapping when set (> 0). */
    readonly maxWidth?: number;
    /** Vertical placement of the text block relative to the layer anchor. */
    readonly verticalAlign?: "top" | "middle" | "bottom";
    /** Gradient/clipped text fill; overrides `color` when present. */
    readonly fillGradient?: GradientStyle;
    /** Procedural shader fill for the glyphs; overrides `color`/`fillGradient` when present. */
    readonly fillShader?: MotionShaderFill;
    /** Outline stroke around the glyphs; painted before the fill unless `over` is true. */
    readonly stroke?: {
      readonly color: string;
      readonly width: number;
      readonly over?: boolean;
    };
    /** Drop shadow behind the glyphs. */
    readonly shadow?: ShadowStyle;
    /** Solid background pill behind the text block (chips/badges). */
    readonly backgroundColor?: string;
    /** Padding (px) around the text block when a background is drawn. */
    readonly backgroundPadding?: number;
    /** Corner radius (px) of the text background pill. */
    readonly backgroundRadius?: number;
  };
}

export type MotionShapeOperator = MotionShapeModifier;

export interface MotionShapeGroupTransform {
  readonly anchor: MotionVector2;
  readonly position: MotionVector2;
  readonly scale: MotionVector2;
  readonly rotation: number;
  readonly opacity: number;
}

export interface MotionShapeGroupItem {
  readonly kind: "group";
  readonly id: string;
  readonly name: string;
  readonly transform: MotionShapeGroupTransform;
  readonly items: readonly MotionShapeItem[];
  readonly operators?: readonly MotionShapeOperator[];
  readonly mergeMode?: MotionShapeMergeMode;
  readonly style?: ShapeStyle;
  readonly visible?: boolean;
}

export interface MotionShapePathItem {
  readonly kind: "path";
  readonly id: string;
  readonly name: string;
  readonly shapeType: ShapeType;
  readonly width: number;
  readonly height: number;
  readonly position: MotionVector2;
  readonly pathData?: string;
  readonly pathClosed?: boolean;
  readonly style?: ShapeStyle;
  readonly visible?: boolean;
}

export type MotionShapeItem = MotionShapeGroupItem | MotionShapePathItem;

export interface MotionShapeLayer extends MotionLayerBase {
  readonly type: "shape";
  readonly shapeType: ShapeType;
  readonly width: number;
  readonly height: number;
  readonly pathData?: string;
  readonly pathClosed?: boolean;
  readonly style: ShapeStyle;
  readonly modifiers?: MotionShapeModifier[];
  readonly puppetPins?: MotionPuppetPin[];
  readonly contents?: readonly MotionShapeItem[];
}

export interface MotionImageLayer extends MotionLayerBase {
  readonly type: "image";
  readonly assetId: string;
  readonly width?: number;
  readonly height?: number;
  readonly fit?: "contain" | "cover" | "fill";
  /** Rounded-rect clip (cheap alternative to a track matte for e.g. a phone screen). */
  readonly cornerRadius?: number;
  readonly cornerRadii?: CornerRadii;
}

export interface MotionVideoLayer extends MotionLayerBase {
  readonly type: "video";
  readonly assetId: string;
  readonly width?: number;
  readonly height?: number;
  readonly fit?: "contain" | "cover" | "fill";
  readonly playbackRate?: number;
  readonly timeOffset?: number;
  readonly trimStart?: number;
  /** Repeats source media when the layer lasts longer than the footage. */
  readonly loop?: boolean;
  /** Plays backward from the source out point. */
  readonly reverse?: boolean;
  /** Holds one source frame, in source seconds, for the entire layer. */
  readonly freezeFrame?: number;
  readonly muted?: boolean;
}

export interface MotionInstanceOverride {
  readonly text?: string;
  readonly color?: string;
}

/** Per-instance overrides of a component's child layers, keyed by child layer id. */
export type MotionInstanceOverrides = Record<string, MotionInstanceOverride>;

export interface MotionCompositionLayer extends MotionLayerBase {
  readonly type: "composition";
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly timeOffset: number;
  readonly playbackRate: number;
  /** Repeats the referenced composition when parent time exceeds its duration. */
  readonly loop?: boolean;
  readonly fit?: "contain" | "cover" | "fill";
  /** Component-instance overrides applied to the referenced composition's children. */
  readonly overrides?: MotionInstanceOverrides;
}

export interface MotionAdjustmentLayer extends MotionLayerBase {
  readonly type: "adjustment";
  readonly width: number;
  readonly height: number;
}

export interface MotionAutoLayout {
  readonly direction: "horizontal" | "vertical";
  readonly gap: number;
  readonly align: "start" | "center" | "end";
}

export interface MotionGroupLayer extends MotionLayerBase {
  readonly type: "group";
  readonly children: string[];
  /** When set, children are arranged in a reflowing stack (Figma auto-layout). */
  readonly autoLayout?: MotionAutoLayout;
}

export interface MotionNullLayer extends MotionLayerBase {
  readonly type: "null";
  readonly guideColor?: string;
  readonly guideSize?: number;
}

export interface MotionParticleLayer extends MotionLayerBase {
  readonly type: "particle";
  readonly emitter: MotionParticleEmitter;
}

export interface MotionScene3DLayer extends MotionLayerBase {
  readonly type: "scene3d";
  /** Legacy single-object hero (auto-framed). Optional once `objects` is set. */
  readonly object: MotionObject3D;
  readonly material?: MotionMaterial3D;
  readonly lighting?: MotionScene3DLighting;
  /** Camera field of view (degrees) and distance multiplier. */
  readonly fov?: number;
  readonly cameraDistance?: number;
  /** Render bounds in composition px (defaults to the composition size). */
  readonly width?: number;
  readonly height?: number;
  /** Presence switches the layer into multi-object SCENE mode. */
  readonly objects?: readonly MotionSceneObject3D[];
  /** Cinematic camera (scene mode). When present, overrides auto-framing + position.z dolly. */
  readonly camera?: MotionScene3DCamera;
  /** Optional enclosing room (scene mode). */
  readonly room?: MotionScene3DRoom;
}

export type MotionLayer =
  | MotionTextLayer
  | MotionShapeLayer
  | MotionImageLayer
  | MotionVideoLayer
  | MotionCompositionLayer
  | MotionAdjustmentLayer
  | MotionNullLayer
  | MotionParticleLayer
  | MotionScene3DLayer
  | MotionGroupLayer;

export interface MotionAsset {
  readonly id: string;
  readonly type: "image" | "video" | "audio" | "svg" | "lottie" | "figma";
  readonly name: string;
  readonly url?: string;
  readonly data?: unknown;
  readonly mediaId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number;
}

export interface MotionVariable {
  readonly id: string;
  readonly name: string;
  readonly type: "text" | "number" | "color" | "boolean" | "media";
  readonly value: string | number | boolean;
}

export interface MotionAudioClip {
  readonly id: string;
  readonly name?: string;
  readonly mediaId?: string;
  readonly assetId?: string;
  readonly startTime: number;
  readonly duration: number;
  readonly trimStart?: number;
  readonly gain?: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly muted?: boolean;
}

export type MotionGuideOrientation = "horizontal" | "vertical";

export interface MotionGuide {
  readonly id: string;
  readonly orientation: MotionGuideOrientation;
  readonly position: number;
  readonly locked?: boolean;
  readonly color?: string;
}

export interface MotionTrackPointFrame {
  readonly time: number;
  readonly position: MotionVector2;
  readonly confidence?: number;
}

export interface MotionTrackPoint {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly frames: MotionTrackPointFrame[];
}

export interface MotionTrack {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly sourceAssetId?: string;
  readonly sourceLayerId?: string;
  readonly points: MotionTrackPoint[];
  readonly smoothing?: number;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface MotionFontFace {
  readonly family: string;
  /** Font source: a URL or a data: URI (woff2/woff/ttf/otf). */
  readonly source: string;
  readonly weight?: string | number;
  readonly style?: "normal" | "italic";
}

export interface MotionComposition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly backgroundColor: string;
  /** Hides layers marked `shy` from editor layer lists without affecting rendering or export. */
  readonly hideShyLayers?: boolean;
  readonly layers: MotionLayer[];
  readonly assets: MotionAsset[];
  readonly audioClips?: MotionAudioClip[];
  readonly fonts?: MotionFontFace[];
  readonly variables: MotionVariable[];
  readonly markers: Marker[];
  readonly guides?: MotionGuide[];
  readonly lights?: MotionLight[];
  readonly beatMarkers?: TimelineBeatMarker[];
  readonly beatAnalysis?: TimelineBeatAnalysis;
  readonly motionBlur?: MotionBlurSettings;
  readonly camera?: MotionCamera;
  readonly tracks?: MotionTrack[];
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface MotionCompositionInstance {
  readonly id: string;
  readonly compositionId: string;
  readonly name?: string;
  readonly trackId?: string;
  readonly startTime: number;
  readonly duration: number;
  readonly transform: Transform;
  readonly opacity: number;
  readonly blendMode?: BlendMode;
  readonly variableOverrides?: Record<string, string | number | boolean>;
}

export const DEFAULT_MOTION_TRANSFORM: MotionTransform = {
  position: { x: 960, y: 540, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  rotation3d: { x: 0, y: 0 },
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  perspective: 1000,
  transformStyle: "flat",
};

export const DEFAULT_MOTION_BLUR_SETTINGS: MotionBlurSettings = {
  enabled: false,
  shutterAngle: 180,
  shutterPhase: -90,
  samples: 8,
};

export const DEFAULT_MOTION_INSTANCE_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  fitMode: "contain",
};
