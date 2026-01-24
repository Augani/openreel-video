export {
  EASING_FUNCTIONS,
  cubicBezier,
  springEasing,
  getEasingFunction,
  interpolate,
  EASING_PRESETS,
  ALL_EASING_NAMES,
  EASING_CATEGORIES,
} from "./easing-functions";

export type {
  EasingName,
  CubicBezierEasing,
  SpringEasing,
  EasingFunction,
  EasingFn,
  EasingCategory,
} from "./easing-functions";

export {
  validateAnimationSchema,
  substituteVariables,
  createEmptyAnimationSchema,
  DEFAULT_PROJECT_CONFIG,
} from "./animation-schema";

export type {
  AnimationSchema,
  ProjectConfig,
  AssetDefinitions,
  FontAsset,
  ImageAsset,
  VideoAsset,
  AudioAsset,
  LottieAsset,
  LayerType as AnimationLayerType,
  BaseLayer,
  Position as AnimationPosition,
  Scale as AnimationScale,
  BlendMode as AnimationBlendMode,
  MaskConfig,
  TextLayer,
  TextStyle as AnimationTextStyle,
  GradientFill,
  GradientStop as AnimationGradientStop,
  StrokeStyle as AnimationStrokeStyle,
  ShadowStyle as AnimationShadowStyle,
  TextAnimationConfig,
  TextAnimationPreset as AnimationTextAnimationPreset,
  ImageLayer,
  ImageFilter,
  VideoLayer,
  ShapeLayer,
  ShapeDefinition,
  RectangleShape,
  EllipseShape,
  PolygonShape,
  StarShape,
  PathShape,
  LottieLayer,
  ParticleLayer,
  ParticleEmitterConfig,
  Range,
  RangeOverLife,
  VelocityConfig,
  RotationConfig,
  GroupLayer,
  LayerDefinition,
  AnimationDefinition,
  AnimatableProperty,
  KeyframeDefinition,
  AudioConfig,
  AudioTrackConfig,
  TemplateVariable,
  AnimationTemplate,
} from "./animation-schema";

export {
  AnimationImporter,
  animationImporter,
  importAnimation,
  importAnimationFromJSON,
} from "./animation-importer";

export type { ImportResult, ImportOptions } from "./animation-importer";

export {
  AnimationExporter,
  animationExporter,
  exportAnimation,
  exportAnimationToJSON,
} from "./animation-exporter";

export type { ExportResult, ExportOptions } from "./animation-exporter";

export {
  GSAPAnimationEngine,
  getGSAPEngine,
  disposeGSAPEngine,
  easingToGSAP,
  sampleMotionPath,
  catmullRomInterpolate,
  generateBezierPath,
  generateDefaultControlPoints,
  keyframesToMotionPath,
  motionPathToKeyframes,
} from "./gsap-engine";

export type {
  GSAPMotionPathPoint,
  MotionPathConfig,
  GSAPAnimationConfig,
} from "./gsap-engine";
